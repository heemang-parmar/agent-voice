import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentOrb, orbStateForStatus } from '@/app/components/agent-orb';
import { deriveStatus, initialSessionState, type SessionStatus } from '@/lib/client/session-state';

/**
 * Every status the reducer can derive, listed here so a new status added to
 * `SessionStatus` fails to compile until it is given an orb state on purpose.
 */
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

const EXPECTED: Record<SessionStatus, string> = {
  idle: 'breathing',
  connecting: 'connecting',
  listening: 'listening',
  thinking: 'solving',
  speaking: 'composing',
  acting: 'working',
  'awaiting-approval': 'shaping',
  reconnecting: 'connecting',
  error: 'shaping',
  ended: 'breathing',
};

function orbElement(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-orb-state]');
  if (!element) throw new Error('no orb rendered');
  return element;
}

describe('AgentOrb', () => {
  it.each(ALL_STATUSES)('renders the %s status with its mapped orb animation', (status) => {
    const { container } = render(<AgentOrb status={status} />);
    expect(orbElement(container)).toHaveAttribute('data-orb-state', EXPECTED[status]);
    expect(orbStateForStatus(status)).toBe(EXPECTED[status]);
  });

  it('covers every status the session reducer can derive', () => {
    expect(new Set(ALL_STATUSES).size).toBe(ALL_STATUSES.length);
    expect(ALL_STATUSES).toContain(deriveStatus(initialSessionState));
    for (const status of ALL_STATUSES) {
      expect(typeof orbStateForStatus(status)).toBe('string');
    }
  });

  it('uses distinct animations for listening, thinking and speaking so they never look alike', () => {
    const states = (['listening', 'thinking', 'speaking'] as const).map(orbStateForStatus);
    expect(new Set(states).size).toBe(3);
  });

  it('hides the canvas from assistive tech so the announced status is not duplicated', () => {
    const { container } = render(<AgentOrb status="listening" />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders at hero scale by default and docks when asked to', () => {
    const { container, rerender } = render(<AgentOrb status="listening" />);
    expect(orbElement(container)).toHaveAttribute('data-scale', 'hero');
    rerender(<AgentOrb status="listening" scale="docked" />);
    expect(orbElement(container)).toHaveAttribute('data-scale', 'docked');
  });
});
