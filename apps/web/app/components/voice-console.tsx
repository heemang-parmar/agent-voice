'use client';

import { useEffect, useRef, useState } from 'react';

import { createLiveKitTransport } from '@/lib/client/livekit-transport';
import type { SessionMode } from '@/lib/client/session-state';
import type { TransportFactory } from '@/lib/client/transport';
import { useVoiceSession } from '@/lib/client/use-voice-session';

import { ActionTimeline } from './action-timeline';
import { AgentOrb } from './agent-orb';
import { ApprovalCard } from './approval-card';
import { ControlBar, type ConversationView } from './control-bar';
import { StartScreen } from './start-screen';
import { StatusBadge } from './status-badge';
import { TextComposer } from './text-composer';
import { TranscriptView } from './transcript-view';

export interface VoiceConsoleProps {
  createTransport?: TransportFactory;
}

/** Statuses where the live connection is genuinely up right now. */
const LIVE_STATUSES = new Set(['listening', 'thinking', 'speaking', 'acting', 'awaiting-approval']);

/**
 * The whole voice/text experience for one session. All state comes from
 * `useVoiceSession`; this component only decides what to render for it and
 * never talks to a transport directly.
 */
export function VoiceConsole({ createTransport = createLiveKitTransport }: VoiceConsoleProps) {
  const session = useVoiceSession(createTransport);
  const lastMode = useRef<SessionMode>('voice');
  const stream = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<ConversationView>('voice');

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

  const connected = session.state.phase === 'connected';
  const hasTranscript = transcript.length > 0;
  const changeView = (view: ConversationView): void => {
    setViewMode(view);
    lastMode.current = view;
    if (connected) void session.setMicrophoneEnabled(view === 'voice');
  };
  const textReady =
    connected && viewMode === 'text' && !session.state.micEnabled && session.status === 'listening';
  const microphoneOff = connected && viewMode === 'voice' && !session.state.micEnabled;
  const voiceMuted = microphoneOff && session.status === 'listening';
  const visualStatus = textReady || voiceMuted ? 'idle' : session.status;

  return (
    <main
      className="stage"
      data-transcript={viewMode === 'text' && hasTranscript ? 'active' : 'empty'}
      data-view={viewMode}
    >
      <StageHeader
        presence={
          LIVE_STATUSES.has(session.status)
            ? 'Live'
            : session.status === 'error' || session.status === 'ended'
              ? 'Offline'
              : 'Connecting'
        }
      />

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
              micError={textReady ? null : session.state.micError}
              {...(textReady ? { label: 'Ready', description: 'Type a message to begin.' } : {})}
            />
          </div>
        )}

        {viewMode === 'text' ? (
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
          <TextComposer
            disabled={!connected}
            autoFocus={connected && viewMode === 'text'}
            onSend={(text) => void session.sendText(text)}
          />
          <ControlBar
            micEnabled={session.state.micEnabled}
            audioBlocked={session.state.audioBlocked}
            status={session.status}
            onToggleMic={(enabled) => void session.setMicrophoneEnabled(enabled)}
            onEnd={() => void session.end()}
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
