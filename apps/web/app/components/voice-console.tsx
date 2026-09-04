'use client';

import { useEffect, useRef, useState } from 'react';

import { createLiveKitTransport } from '@/lib/client/livekit-transport';
import {
  addGroup,
  deriveTitle,
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
import { ConversationMenu } from './conversation-menu';
import { NewChatIcon, TranscriptIcon } from './icons';
import { SessionDrawer } from './session-drawer';
import { StartScreen } from './start-screen';
import { StatusBadge } from './status-badge';
import { TextComposer } from './text-composer';
import { TranscriptView } from './transcript-view';

const PRODUCT_NAME = 'Agent Voice';
const START_SCREEN_HEADING = 'Talk to agent';

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
  const awaitingConfig = session.state.phase === 'error' && session.missingConfig.length > 0;
  const notStarted = session.state.phase === 'idle' || awaitingConfig;

  if (notStarted) {
    return (
      <main className="stage stage--start">
        <StageHeader productName={PRODUCT_NAME} offline={awaitingConfig} />
        <StartScreen
          onStart={start}
          missingConfig={session.missingConfig}
          heading={START_SCREEN_HEADING}
        />
      </main>
    );
  }

  const archived =
    archivedId === null
      ? null
      : (library.conversations.find((record) => record.id === archivedId) ?? null);
  const shownTranscript = archived ? archived.transcript : transcript;
  const hasTranscript = shownTranscript.length > 0;
  const ended = session.status === 'ended';

  /*
   * One post-session model for both modes. A conversation that finished with
   * something in it is a saved one and reads as its transcript, whichever
   * view it happened to end in; a conversation that finished with nothing in
   * it has nothing to show, so the start screen comes back instead of an orb
   * captioned "Ended".
   */
  if (!archived && ended && !hasTranscript) {
    return (
      <main className="stage stage--start">
        <StageHeader productName={PRODUCT_NAME} />
        <StartScreen
          onStart={startFresh}
          missingConfig={session.missingConfig}
          heading={START_SCREEN_HEADING}
        />
      </main>
    );
  }

  const saved = archived !== null || ended;
  /** Saved conversations are read as text; only a live session has a choice. */
  const view: ConversationView = saved ? 'text' : viewMode;
  const currentId = archivedId ?? librarySessionId;
  const currentRecord = library.conversations.find((record) => record.id === currentId) ?? null;

  /**
   * The only way between the two views. It is a view change and nothing else:
   * the room, the transcript and any draft all survive it, and `session.end`
   * is never on this path.
   */
  const changeView = (next: ConversationView): void => {
    if (viewModeRef.current === next) {
      if (next === 'text') composerInput.current?.focus();
      return;
    }
    // This focus must remain inside the originating tap/click. Mobile Safari
    // will not open its software keyboard for the later autofocus effect.
    viewModeRef.current = next;
    if (next === 'text') {
      composerInput.current?.focus();
    } else {
      // Keep the software keyboard from covering the immersive voice view.
      composerInput.current?.blur();
    }
    setViewMode(next);
    lastMode.current = next;
    if (!connected) return;
    if (next === 'text') {
      void session.setMicrophoneEnabled(false);
    } else {
      void (async () => {
        await pushToTalk.release();
        await session.setMicrophoneEnabled(true);
      })();
    }
  };
  const switchingToText = connected && view === 'text' && session.state.micEnabled;
  const textReady =
    connected && view === 'text' && !session.state.micEnabled && session.status === 'listening';
  const microphoneOff = connected && view === 'voice' && !session.state.micEnabled;
  const voiceMuted = microphoneOff && session.status === 'listening';
  const visualStatus = textReady || voiceMuted ? 'idle' : session.status;
  const pushToTalkStatus =
    view === 'text' && pushToTalk.phase !== 'idle'
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
        data-transcript={view === 'text' && hasTranscript ? 'active' : 'empty'}
        data-view={view}
        inert={sessionsOpen}
      >
        {view === 'voice' ? (
          <VoiceHeader
            onShowText={() => changeView('text')}
            onNewConversation={() => startFresh('text')}
          />
        ) : null}

        <div className="stage__body">
          {view === 'voice' ? (
            <div className="stage__focus">
              <div className="orb-stage">
                <AgentOrb status={visualStatus} scale="hero" />
                <div className="orb-stage__telemetry">
                  <StatusBadge
                    status={session.status}
                    variant="orb"
                    visuallyHidden
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
              onNewConversation={() => startFresh('text')}
              options={
                hasTranscript ? (
                  <ConversationMenu
                    title={currentRecord?.title ?? deriveTitle(shownTranscript)}
                    pinned={currentRecord?.pinned ?? false}
                    groups={library.groups.filter((group) => group.id !== currentRecord?.groupId)}
                    onOpen={() => {
                      setLibrary(readLibrary());
                    }}
                    onRename={(title) =>
                      editLibrary((current) => renameConversation(current, currentId, title))
                    }
                    onTogglePin={(pinned) =>
                      editLibrary((current) => setConversationPinned(current, currentId, pinned))
                    }
                    onMove={(groupId) =>
                      editLibrary((current) => moveConversation(current, currentId, groupId))
                    }
                  />
                ) : undefined
              }
              status={
                <StatusBadge
                  status={saved ? 'ended' : session.status}
                  variant="compact"
                  visuallyHidden={!saved}
                  micError={saved || textReady || switchingToText ? null : session.state.micError}
                  {...(saved
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

          {view === 'text' ? (
            <div className="stage__stream" ref={stream}>
              <TranscriptView entries={shownTranscript} />
              {!archived && !saved && actions.length > 0 ? (
                <ActionTimeline
                  actions={actions}
                  onCancel={(actionId) => void session.cancelAction(actionId)}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        {saved ? null : (
          <div className="stage__dock">
            <ApprovalCard
              approval={session.state.pendingApproval}
              onRespond={(approvalId, actionId, decision) =>
                void session.respondToApproval(approvalId, actionId, decision)
              }
            />
            <div className="dock">
              <TextComposer
                disabled={!connected}
                autoFocus={connected && view === 'text'}
                inputRef={composerInput}
                onInteraction={() => changeView('text')}
                onSend={(text) => void session.sendText(text)}
                {...(view === 'text'
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
              <ControlBar
                micEnabled={session.state.micEnabled}
                audioBlocked={session.state.audioBlocked}
                status={session.status}
                onToggleMic={(enabled) => void session.setMicrophoneEnabled(enabled)}
                onReturnToChat={() => changeView('text')}
                onRetry={retry}
                onResumeAudio={() => void session.resumeAudio()}
                viewMode={view}
              />
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
function StageHeader({ productName, offline = false }: { productName: string; offline?: boolean }) {
  return (
    <header className="stage__header">
      <span className="stage__wordmark">{productName}</span>
      {offline ? (
        <span className="stage__presence">
          <span className="stage__presence-dot" aria-hidden="true" />
          Offline
        </span>
      ) : null}
    </header>
  );
}

/**
 * The voice view's own header. Leaving voice is not ending anything, so the
 * only irreversible action offered here is the deliberate reset, and it goes
 * through the same `startFresh` ordering as every other restart.
 */
function VoiceHeader({
  onShowText,
  onNewConversation,
}: {
  onShowText(): void;
  onNewConversation(): void;
}) {
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
      <button
        type="button"
        className="icon-button stage__header-action"
        aria-label="New conversation"
        title="New conversation"
        onClick={onNewConversation}
      >
        <NewChatIcon />
      </button>
    </header>
  );
}
