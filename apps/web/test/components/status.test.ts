import { describe, expect, it } from 'vitest';

import { statusInfo } from '@/app/components/status';
import type { SessionStatus } from '@/lib/client/session-state';

const ALL_STATUSES: SessionStatus[] = [
  'idle',
  'connecting',
  'listening',
  'thinking',
  'speaking',
  'acting',
  'awaiting-approval',
  'reconnecting',
  'error',
  'ended',
];

describe('statusInfo', () => {
  it('has a distinct, honest label and description for every session status', () => {
    const seen = new Set<string>();
    for (const status of ALL_STATUSES) {
      const info = statusInfo(status);
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.description.length).toBeGreaterThan(0);
      expect(seen.has(info.label)).toBe(false);
      seen.add(info.label);
    }
  });

  it('never claims an action is complete while it is only in progress', () => {
    expect(statusInfo('acting').label.toLowerCase()).not.toContain('done');
    expect(statusInfo('acting').label.toLowerCase()).not.toContain('complete');
    expect(statusInfo('thinking').description.toLowerCase()).not.toContain('done');
  });
});
