import type { SessionStatus } from '@/lib/client/session-state';

import { statusInfo } from './status';

export interface StatusBadgeProps {
  status: SessionStatus;
  micError?: string | null;
}

export function StatusBadge({ status, micError }: StatusBadgeProps) {
  const info = statusInfo(status);
  return (
    <div className="status-badge" role="status" aria-live="polite">
      <span className={`status-badge__dot status-badge__dot--${status}`} aria-hidden="true" />
      <span className="status-badge__text">
        <span className="status-badge__label">{info.label}</span>
        <span className="status-badge__description">{info.description}</span>
      </span>
      {micError ? <span className="status-badge__mic-error">{micError}</span> : null}
    </div>
  );
}
