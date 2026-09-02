import type { SessionStatus } from '@/lib/client/session-state';

export interface ControlBarProps {
  micEnabled: boolean;
  audioBlocked: boolean;
  status: SessionStatus;
  onToggleMic: (enabled: boolean) => void;
  onEnd: () => void;
  onRetry: () => void;
  onResumeAudio: () => void;
}

export function ControlBar({
  micEnabled,
  audioBlocked,
  status,
  onToggleMic,
  onEnd,
  onRetry,
  onResumeAudio,
}: ControlBarProps) {
  const canRetry = status === 'error' || status === 'ended';

  return (
    <div className="control-bar">
      {audioBlocked ? (
        <div className="control-bar__audio-banner" role="status">
          <span>Audio playback is blocked by the browser.</span>
          <button type="button" className="button button--secondary" onClick={onResumeAudio}>
            Tap to enable audio
          </button>
        </div>
      ) : null}
      <div className="control-bar__buttons">
        <button
          type="button"
          className="button button--secondary"
          aria-pressed={!micEnabled}
          onClick={() => onToggleMic(!micEnabled)}
        >
          {micEnabled ? 'Mute' : 'Unmute'}
        </button>
        <button type="button" className="button button--secondary" onClick={onEnd}>
          End
        </button>
        {canRetry ? (
          <button type="button" className="button button--primary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}
