'use client';

import { useEffect, useRef, useState } from 'react';

import { createLiveKitTransport } from '@/lib/client/livekit-transport';
import { usePushToTalk } from '@/lib/client/use-push-to-talk';
import type { SessionMode } from '@/lib/client/session-state';
import type { TransportFactory } from '@/lib/client/transport';
import { useVoiceSession } from '@/lib/client/use-voice-session';

import { ActionTimeline } from './action-timeline';
import { AgentOrb } from './agent-orb';
import { ApprovalCard } from './approval-card';
import { ControlBar, type ConversationView } from './control-bar';
import { TranscriptIcon } from './icons';
import { StartScreen } from './start-screen';
import { StatusBadge } from './status-badge';
import { TextComposer } from './text-composer';
import { TranscriptView } from './transcript-view';

export interface VoiceConsoleProps {
  createTransport?: TransportFactory;
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
  const connected = session.state.phase === 'connected';
  const pushToTalk = usePushToTalk({
    enabled: connected && viewMode === 'text' && session.status !== 'ended',
    microphoneEnabled: session.state.micEnabled,
    setMicrophoneEnabled: session.setMicrophoneEnabled,
  });

  const transcript = session.state.transcript;
  const actions = session.state.actions;
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
  const retry = (): void => {
    void session.start(lastMode.current);
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

  const hasTranscript = transcript.length > 0;
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
    <main
      className="stage"
      data-transcript={viewMode === 'text' && hasTranscript ? 'active' : 'empty'}
      data-view={viewMode}
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
          <div className="stage__text-heading">
            <h1>Conversation</h1>
            <StatusBadge
              status={session.status}
              micError={
                textReady || switchingToText || session.status === 'ended'
                  ? null
                  : session.state.micError
              }
              {...(pushToTalkStatus ??
                (switchingToText
                  ? { label: 'Switching to text', description: 'Pausing the microphone…' }
                  : textReady
                    ? { label: 'Ready', description: 'Type a message or hold the mic to talk.' }
                    : {}))}
            />
          </div>
        )}

        {viewMode === 'text' && (session.status !== 'ended' || hasTranscript) ? (
          <div className="stage__stream" ref={stream}>
            <TranscriptView entries={transcript} />
            {actions.length > 0 ? (
              <ActionTimeline
                actions={actions}
                onCancel={(actionId) => void session.cancelAction(actionId)}
              />
            ) : null}
          </div>
        ) : null}
      </div>

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
          <ControlBar
            micEnabled={session.state.micEnabled}
            audioBlocked={session.state.audioBlocked}
            status={session.status}
            onToggleMic={(enabled) => void session.setMicrophoneEnabled(enabled)}
            onEnd={() =>
              void (async () => {
                await pushToTalk.release();
                await session.end();
              })()
            }
            onRetry={retry}
            onResumeAudio={() => void session.resumeAudio()}
            viewMode={viewMode}
            onViewModeChange={changeView}
          />
        </div>
      </div>
    </main>
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
