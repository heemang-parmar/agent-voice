import type { SessionStatus } from '@/lib/client/session-state';

import { EndIcon, MicIcon, MicOffIcon } from './icons';

export type ConversationView = 'voice' | 'text';

export interface ControlBarProps {
  micEnabled: boolean;
  audioBlocked: boolean;
  status: SessionStatus;
  onToggleMic: (enabled: boolean) => void;
  onEnd: () => void;
  onRetry: () => void;
  onResumeAudio: () => void;
  viewMode: ConversationView;
}

export function ControlBar({
  micEnabled,
  audioBlocked,
  status,
  onToggleMic,
  onEnd,
  onRetry,
  onResumeAudio,
  viewMode,
}: ControlBarProps) {
  const canRetry = status === 'error';

  if (status === 'ended') {
    return (
      <div className="control-bar">
        <div className="control-bar__buttons">
          <button type="button" className="button button--primary" onClick={onRetry}>
            New conversation
          </button>
        </div>
      </div>
    );
  }

  const showButtons = viewMode === 'voice' || canRetry;
  if (!audioBlocked && !showButtons) return null;

  return (
    <div className={`control-bar${audioBlocked ? ' control-bar--audio-blocked' : ''}`}>
      {audioBlocked ? (
        <div className="control-bar__audio-banner" role="status">
          <span>Audio playback is blocked by the browser.</span>
          <button type="button" className="button button--quiet" onClick={onResumeAudio}>
            Tap to enable audio
          </button>
        </div>
      ) : null}
      {showButtons ? (
        <div className="control-bar__buttons">
          {viewMode === 'voice' ? (
            <>
              <button
                type="button"
                className="icon-button"
                aria-pressed={!micEnabled}
                aria-label={micEnabled ? 'Mute' : 'Unmute'}
                title={micEnabled ? 'Mute the microphone' : 'Unmute the microphone'}
                onClick={() => onToggleMic(!micEnabled)}
              >
                {micEnabled ? <MicIcon /> : <MicOffIcon />}
              </button>
              <button
                type="button"
                className="icon-button icon-button--danger"
                aria-label="End voice"
                title="End voice session"
                onClick={onEnd}
              >
                <EndIcon />
              </button>
            </>
          ) : null}
          {canRetry ? (
            <button type="button" className="button button--primary" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
