import type { SessionStatus } from '@/lib/client/session-state';

import { statusInfo } from './status';

export interface StatusBadgeProps {
  status: SessionStatus;
  micError?: string | null;
  label?: string;
  description?: string;
  variant?: 'default' | 'orb' | 'compact';
  showDescription?: boolean;
  visuallyHidden?: boolean;
}

/**
 * The authoritative, announced statement of what the session is doing. The
 * orb mirrors this visually but never replaces it.
 */
export function StatusBadge({
  status,
  micError,
  label,
  description,
  variant = 'default',
  showDescription = false,
  visuallyHidden = false,
}: StatusBadgeProps) {
  const info = statusInfo(status);
  const descriptionClass =
    visuallyHidden || ((variant === 'orb' || variant === 'compact') && !showDescription)
      ? 'status-badge__description sr-only'
      : 'status-badge__description';
  const labelClass = visuallyHidden ? 'status-badge__label sr-only' : 'status-badge__label';
  return (
    <div
      className="status-badge"
      data-status={status}
      data-variant={variant}
      role="status"
      aria-live="polite"
    >
      <p className={labelClass}>
        <span className={`status-badge__dot status-badge__dot--${status}`} aria-hidden="true" />
        {label ?? info.label}
      </p>
      <p className={descriptionClass}>{description ?? info.description}</p>
      {micError ? <p className="status-badge__mic-error">{micError}</p> : null}
    </div>
  );
}
