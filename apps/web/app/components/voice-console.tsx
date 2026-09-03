'use client';

import { useEffect, useRef, useState } from 'react';

import { createLiveKitTransport } from '@/lib/client/livekit-transport';
import {
  addGroup,
  moveConversation,
  readLibrary,
  renameConversation,
  setConversationPinned,
  upsertConversation,
  writeLibrary,
  type SessionLibrary,
} from '@/lib/client/session-library';
import { usePushToTalk } from '@/lib/client/use-push-to-talk';
import type { SessionMode } from '@/lib/client/session-state';
import type { TransportFactory } from '@/lib/client/transport';
import { useVoiceSession } from '@/lib/client/use-voice-session';

import { ActionTimeline } from './action-timeline';
import { AgentOrb } from './agent-orb';
import { ApprovalCard } from './approval-card';
import { ControlBar, type ConversationView } from './control-bar';
import { ConversationBar } from './conversation-bar';
import { TranscriptIcon } from './icons';
import { SessionDrawer } from './session-drawer';
import { StartScreen } from './start-screen';
import { StatusBadge } from './status-badge';
import { TextComposer } from './text-composer';
import { TranscriptView } from './transcript-view';

export interface VoiceConsoleProps {
  createTransport?: TransportFactory;
}

/**
 * One id per started session, minted here rather than taken from the
 * transport. `state.conversationId` is null until the first event binds the
 * room, so keying the library on it would archive the same session twice.
 */
function newLibraryId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

/**
 * The whole voice/text experience for one session. All state comes from
 * `useVoiceSession`; this component only decides what to render for it and
 * never talks to a transport directly.
 */
export function VoiceConsole({ createTransport = createLiveKitTransport }: VoiceConsoleProps) {
  const session = useVoiceSession(createTransport);
  const lastMode = useRef<SessionMode>('voice');
  const viewModeRef = useRef<ConversationView>('voice');
  const composerInput = useRef<HTMLInputElement>(null);
  const stream = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<ConversationView>('voice');
  const [sessionsOpen, setSessionsOpen] = useState(false);
  /*
   * Read once, lazily. Nothing on the first paint is derived from the
   * library — the drawer renders null while closed — so the server's empty
   * result and the browser's real one produce identical markup.
   */
  const [library, setLibrary] = useState<SessionLibrary>(readLibrary);
  /** Non-null while a saved conversation is being read instead of a live one. */
  const [archivedId, setArchivedId] = useState<string | null>(null);
  const [librarySessionId, setLibrarySessionId] = useState<string>(() => newLibraryId('ui'));
  /*
   * A restart mints its id immediately, but the reducer only clears the
   * transcript once `start` dispatches. Without this latch the outgoing
   * conversation would be archived a second time under the incoming id.
   */
  const awaitingReset = useRef(false);
  const connected = session.state.phase === 'connected';
  const pushToTalk = usePushToTalk({
    enabled: connected && viewMode === 'text' && session.status !== 'ended',
    microphoneEnabled: session.state.micEnabled,
    setMicrophoneEnabled: session.setMicrophoneEnabled,
  });

  const transcript = session.state.transcript;
  const actions = session.state.actions;

  /*
   * Archive as the conversation happens, so a closed tab keeps what was said.
   * Storage is the source of truth and is merged into rather than overwritten,
   * so this can never lose an edit made from the drawer.
   */
  useEffect(() => {
    if (awaitingReset.current) {
      if (transcript.length > 0) return;
      awaitingReset.current = false;
    }
    if (archivedId !== null || transcript.length === 0) return;
    writeLibrary(
      upsertConversation(readLibrary(), {
        id: librarySessionId,
        transcript,
        now: new Date().toISOString(),
      }),
    );
  }, [transcript, archivedId, librarySessionId]);
  // Follow the newest turn. Setting scrollTop keeps the scroll inside the
  // stream, so the page itself never jumps under the dock.
  useEffect(() => {
    const element = stream.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [transcript, actions]);

  const start = (mode: SessionMode): void => {
    lastMode.current = mode;
    viewModeRef.current = mode;
    setViewMode(mode);
    void session.start(mode);
  };
  /**
   * Every path back to a live session goes through here: release any held
   * push-to-talk, end whatever is still connected, then start clean. Nothing
   * may start a session while the previous microphone is still open.
   */
  const startFresh = (mode: SessionMode): void => {
    lastMode.current = mode;
    viewModeRef.current = mode;
    setViewMode(mode);
    setSessionsOpen(false);
    setArchivedId(null);
    awaitingReset.current = true;
    setLibrarySessionId(newLibraryId('ui'));
    void (async () => {
      await pushToTalk.release();
      await session.end();
      await session.start(mode);
    })();
  };

  /**
   * Opening history is never a reconnection. The live room is released first
   * and the saved transcript is only shown once the microphone is down.
   */
  const openSaved = (id: string): void => {
    setSessionsOpen(false);
    setViewMode('text');
    viewModeRef.current = 'text';
    void (async () => {
      await pushToTalk.release();
      await session.end();
      setArchivedId(id);
    })();
  };

  /** Drawer edits read from storage, apply, then write straight back. */
  const editLibrary = (update: (current: SessionLibrary) => SessionLibrary): void => {
    const next = update(readLibrary());
    setLibrary(next);
    writeLibrary(next);
  };

  const openSessions = (): void => {
    setLibrary(readLibrary());
    setSessionsOpen(true);
  };
  const retry = (): void => {
    startFresh(lastMode.current);
  };
  const endSession = (): void => {
    void (async () => {
      await pushToTalk.release();
      await session.end();
    })();
  };

  const awaitingConfig = session.state.phase === 'error' && session.missingConfig.length > 0;
  const notStarted = session.state.phase === 'idle' || awaitingConfig;

  if (notStarted) {
    return (
      <main className="stage stage--start">
        <StageHeader presence={awaitingConfig ? 'Offline' : 'Ready'} />
        <StartScreen onStart={start} missingConfig={session.missingConfig} />
      </main>
    );
  }

  const archived =
    archivedId === null
      ? null
      : (library.conversations.find((record) => record.id === archivedId) ?? null);
  const shownTranscript = archived ? archived.transcript : transcript;
  const hasTranscript = shownTranscript.length > 0;
  const changeView = (view: ConversationView): void => {
    if (viewModeRef.current === view) {
      if (view === 'text') composerInput.current?.focus();
      return;
    }
    // This focus must remain inside the originating tap/click. Mobile Safari
    // will not open its software keyboard for the later autofocus effect.
    viewModeRef.current = view;
    if (view === 'text') {
      composerInput.current?.focus();
    } else {
      // Keep the software keyboard from covering the immersive voice view.
      composerInput.current?.blur();
    }
    setViewMode(view);
    lastMode.current = view;
    if (!connected) return;
    if (view === 'text') {
      void session.setMicrophoneEnabled(false);
    } else {
      void (async () => {
        await pushToTalk.release();
        await session.setMicrophoneEnabled(true);
      })();
    }
  };
  const switchingToText = connected && viewMode === 'text' && session.state.micEnabled;
  const textReady =
    connected && viewMode === 'text' && !session.state.micEnabled && session.status === 'listening';
  const microphoneOff = connected && viewMode === 'voice' && !session.state.micEnabled;
  const voiceMuted = microphoneOff && session.status === 'listening';
  const visualStatus = textReady || voiceMuted ? 'idle' : session.status;
  const pushToTalkStatus =
    viewMode === 'text' && pushToTalk.phase !== 'idle'
      ? pushToTalk.phase === 'starting'
        ? { label: 'Starting microphone', description: 'Preparing voice input…' }
        : pushToTalk.phase === 'listening'
          ? { label: 'Listening', description: 'Release to send.' }
          : { label: 'Finishing voice input', description: 'Processing your spoken turn…' }
      : null;

  return (
    <>
      <main
        className="stage"
        data-transcript={viewMode === 'text' && hasTranscript ? 'active' : 'empty'}
        data-view={viewMode}
        inert={sessionsOpen}
      >
        {viewMode === 'voice' ? <VoiceHeader onShowText={() => changeView('text')} /> : null}

        <div className="stage__body">
          {viewMode === 'voice' ? (
            <div className="stage__focus">
              <div className="orb-stage">
                <AgentOrb status={visualStatus} scale="hero" />
                <div className="orb-stage__telemetry">
                  <StatusBadge
                    status={session.status}
                    variant="orb"
                    showDescription={voiceMuted && Boolean(session.state.micError)}
                    micError={voiceMuted ? null : session.state.micError}
                    {...(voiceMuted
                      ? {
                          label: session.state.micError ? 'Microphone unavailable' : 'Muted',
                          description:
                            session.state.micError ?? 'The microphone is off. Unmute to speak.',
                        }
                      : {})}
                  />
                  {microphoneOff && !voiceMuted ? (
                    <p className="mic-state">
                      {session.state.micError ? 'Mic unavailable' : 'Mic off'}
                    </p>
                  ) : null}
                </div>
              </div>
              {session.state.error ? (
                <p className="stage__error">{session.state.error.message}</p>
              ) : null}
            </div>
          ) : (
            <ConversationBar
              sessionsOpen={sessionsOpen}
              onOpenSessions={openSessions}
              action={archived || session.status === 'ended' ? 'new' : 'end'}
              onEnd={endSession}
              onNewConversation={() => startFresh('text')}
              status={
                <StatusBadge
                  status={archived ? 'ended' : session.status}
                  variant="compact"
                  micError={
                    archived || textReady || switchingToText || session.status === 'ended'
                      ? null
                      : session.state.micError
                  }
                  {...(archived
                    ? {
                        label: 'Saved',
                        description:
                          'A saved conversation from this device. It is not live and cannot be continued.',
                      }
                    : (pushToTalkStatus ??
                      (switchingToText
                        ? { label: 'Switching to text', description: 'Pausing the microphone…' }
                        : textReady
                          ? {
                              label: 'Ready',
                              description: 'Type a message or hold the mic to talk.',
                            }
                          : {})))}
                />
              }
            />
          )}

          {viewMode === 'text' && (archived || session.status !== 'ended' || hasTranscript) ? (
            <div className="stage__stream" ref={stream}>
              <TranscriptView entries={shownTranscript} />
              {!archived && actions.length > 0 ? (
                <ActionTimeline
                  actions={actions}
                  onCancel={(actionId) => void session.cancelAction(actionId)}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        {archived ? null : (
          <div className="stage__dock">
            <ApprovalCard
              approval={session.state.pendingApproval}
              onRespond={(approvalId, actionId, decision) =>
                void session.respondToApproval(approvalId, actionId, decision)
              }
            />
            <div className="dock">
              {session.status !== 'ended' ? (
                <TextComposer
                  disabled={!connected}
                  autoFocus={connected && viewMode === 'text'}
                  inputRef={composerInput}
                  onInteraction={() => changeView('text')}
                  onSend={(text) => void session.sendText(text)}
                  {...(viewMode === 'text'
                    ? {
                        onEnterVoiceMode: () => changeView('voice'),
                        pushToTalk: {
                          disabled: !connected || switchingToText,
                          phase: pushToTalk.phase,
                          onStart: pushToTalk.start,
                          onRelease: () => void pushToTalk.release(),
                        },
                      }
                    : {})}
                />
              ) : null}
              {viewMode === 'text' && session.status === 'ended' ? null : (
                <ControlBar
                  micEnabled={session.state.micEnabled}
                  audioBlocked={session.state.audioBlocked}
                  status={session.status}
                  onToggleMic={(enabled) => void session.setMicrophoneEnabled(enabled)}
                  onEnd={endSession}
                  onRetry={retry}
                  onResumeAudio={() => void session.resumeAudio()}
                  viewMode={viewMode}
                />
              )}
            </div>
          </div>
        )}
      </main>

      <SessionDrawer
        open={sessionsOpen}
        library={library}
        activeId={archivedId ?? librarySessionId}
        onClose={() => setSessionsOpen(false)}
        onNewConversation={() => startFresh('text')}
        onSelect={openSaved}
        onRename={(id, title) => editLibrary((current) => renameConversation(current, id, title))}
        onTogglePin={(id, pinned) =>
          editLibrary((current) => setConversationPinned(current, id, pinned))
        }
        onMove={(id, groupId) => editLibrary((current) => moveConversation(current, id, groupId))}
        onCreateGroup={(id, name) =>
          editLibrary((current) => {
            const groupId = newLibraryId('grp');
            const now = new Date().toISOString();
            const withGroup = addGroup(current, { id: groupId, name, now });
            return withGroup === current ? current : moveConversation(withGroup, id, groupId);
          })
        }
      />
    </>
  );
}

/**
 * Lightweight identity. Deliberately not a live region: the one announced
 * status lives in `StatusBadge`, and a second one would talk over it.
 */
function StageHeader({ presence }: { presence: 'Ready' | 'Connecting' | 'Live' | 'Offline' }) {
  return (
    <header className="stage__header">
      <span className="stage__wordmark">Agent Voice</span>
      <span className="stage__presence" data-live={String(presence === 'Live')}>
        <span className="stage__presence-dot" aria-hidden="true" />
        {presence}
      </span>
    </header>
  );
}

function VoiceHeader({ onShowText }: { onShowText(): void }) {
  return (
    <header className="stage__header stage__header--voice">
      <button
        type="button"
        className="icon-button stage__header-action"
        aria-label="Show text chat"
        title="Show text chat"
        onClick={onShowText}
      >
        <TranscriptIcon />
      </button>
    </header>
  );
}
