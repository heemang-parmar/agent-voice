import type { SessionStatus } from '@/lib/client/session-state';

import { EndIcon, MicIcon, MicOffIcon } from './icons';

export type ConversationView = 'voice' | 'text';

export interface ControlBarProps {
  micEnabled: boolean;
  audioBlocked: boolean;
  status: SessionStatus;
  onToggleMic: (enabled: boolean) => void;
  /**
   * Leaves the voice view for the transcript. It is a view change and nothing
   * more: the room, the transcript and any draft all survive it.
   */
  onReturnToChat: () => void;
  onRetry: () => void;
  onResumeAudio: () => void;
  viewMode: ConversationView;
}

export function ControlBar({
  micEnabled,
  audioBlocked,
  status,
  onToggleMic,
  onReturnToChat,
  onRetry,
  onResumeAudio,
  viewMode,
}: ControlBarProps) {
  const canRetry = status === 'error';

  /*
   * A finished session never reaches the dock: the console replaces the whole
   * dock with the saved transcript, or with the start screen when there was
   * nothing to save. Restarting is offered there, not here.
   */
  if (status === 'ended') return null;

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
                className="icon-button"
                aria-label="Close voice mode"
                title="Close voice mode and return to text"
                onClick={onReturnToChat}
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
