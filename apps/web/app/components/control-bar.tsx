import type { SessionStatus } from '@/lib/client/session-state';

import { EndIcon, MicIcon, MicOffIcon, TranscriptIcon, VoiceModeIcon } from './icons';

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
  onViewModeChange: (view: ConversationView) => void;
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
  onViewModeChange,
}: ControlBarProps) {
  const canRetry = status === 'error' || status === 'ended';

  return (
    <div className="control-bar">
      {audioBlocked ? (
        <div className="control-bar__audio-banner" role="status">
          <span>Audio playback is blocked by the browser.</span>
          <button type="button" className="button button--quiet" onClick={onResumeAudio}>
            Tap to enable audio
          </button>
        </div>
      ) : null}
      <div className="control-bar__buttons">
        {viewMode === 'voice' ? (
          <>
            <button
              type="button"
              className="mode-button"
              aria-label="Show text chat"
              title="Show text chat"
              onClick={() => onViewModeChange('text')}
            >
              <TranscriptIcon />
              <span>Text</span>
            </button>
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
          </>
        ) : (
          <button
            type="button"
            className="mode-button mode-button--voice"
            aria-label="Enter voice mode"
            title="Enter voice mode"
            onClick={() => onViewModeChange('voice')}
          >
            <VoiceModeIcon />
            <span>Voice</span>
          </button>
        )}
        <button
          type="button"
          className="icon-button icon-button--danger"
          aria-label="End"
          title="End the session"
          onClick={onEnd}
        >
          <EndIcon />
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
