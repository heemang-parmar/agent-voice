'use client';

import { useRef } from 'react';

import { createLiveKitTransport } from '@/lib/client/livekit-transport';
import type { SessionMode } from '@/lib/client/session-state';
import type { TransportFactory } from '@/lib/client/transport';
import { useVoiceSession } from '@/lib/client/use-voice-session';

import { ActionTimeline } from './action-timeline';
import { ApprovalCard } from './approval-card';
import { ControlBar } from './control-bar';
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

  const start = (mode: SessionMode): void => {
    lastMode.current = mode;
    void session.start(mode);
  };
  const retry = (): void => {
    void session.start(lastMode.current);
  };

  const awaitingConfig = session.state.phase === 'error' && session.missingConfig.length > 0;
  const notStarted = session.state.phase === 'idle' || awaitingConfig;

  if (notStarted) {
    return (
      <main className="voice-console">
        <StartScreen onStart={start} missingConfig={session.missingConfig} />
      </main>
    );
  }

  const connected = session.state.phase === 'connected';

  return (
    <main className="voice-console">
      <StatusBadge status={session.status} micError={session.state.micError} />
      {session.state.error ? (
        <p className="voice-console__error" role="status">
          {session.state.error.message}
        </p>
      ) : null}
      <TranscriptView entries={session.state.transcript} />
      <ActionTimeline
        actions={session.state.actions}
        onCancel={(actionId) => void session.cancelAction(actionId)}
      />
      <ApprovalCard
        approval={session.state.pendingApproval}
        onRespond={(approvalId, actionId, decision) =>
          void session.respondToApproval(approvalId, actionId, decision)
        }
      />
      <TextComposer disabled={!connected} onSend={(text) => void session.sendText(text)} />
      <ControlBar
        micEnabled={session.state.micEnabled}
        audioBlocked={session.state.audioBlocked}
        status={session.status}
        onToggleMic={(enabled) => void session.setMicrophoneEnabled(enabled)}
        onEnd={() => void session.end()}
        onRetry={retry}
        onResumeAudio={() => void session.resumeAudio()}
      />
    </main>
  );
}
