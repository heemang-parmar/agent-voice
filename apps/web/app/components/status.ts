import type { SessionStatus } from '@/lib/client/session-state';

export interface StatusInfo {
  label: string;
  description: string;
}

/**
 * One honest label and description per session status. No status here ever
 * implies an action succeeded, completed, or was verified unless it did.
 */
const STATUS_INFO: Record<SessionStatus, StatusInfo> = {
  idle: { label: 'Idle', description: 'Not connected yet.' },
  connecting: { label: 'Connecting', description: 'Setting up a secure connection.' },
  listening: { label: 'Listening', description: 'The agent is listening for you.' },
  thinking: { label: 'Thinking', description: 'The agent is processing what you said.' },
  speaking: { label: 'Speaking', description: 'The agent is speaking.' },
  acting: { label: 'Working', description: 'The connected agent is performing an action.' },
  'awaiting-approval': {
    label: 'Awaiting your approval',
    description: 'An action needs your approval before it continues.',
  },
  reconnecting: {
    label: 'Reconnecting',
    description: 'The connection was interrupted and is being restored.',
  },
  error: { label: 'Error', description: 'Something went wrong. You can retry.' },
  ended: { label: 'Ended', description: 'The session has ended.' },
};

export function statusInfo(status: SessionStatus): StatusInfo {
  return STATUS_INFO[status];
}
