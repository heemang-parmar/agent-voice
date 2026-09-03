'use client';

import { ThinkingOrb, type OrbState } from 'thinking-orbs';

import type { SessionStatus } from '@/lib/client/session-state';

/**
 * The orb is the agent's body, not its status line. Every status still has a
 * spoken-word label in `StatusBadge`; this mapping only decides which of the
 * nine shipped animations stands in for that status visually.
 */
const STATUS_TO_ORB_STATE: Record<SessionStatus, OrbState> = {
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

export function orbStateForStatus(status: SessionStatus): OrbState {
  return STATUS_TO_ORB_STATE[status];
}

/** `hero` is the full-focus body; `docked` is the smaller companion mark. */
export type AgentOrbScale = 'hero' | 'docked';

export interface AgentOrbProps {
  status: SessionStatus;
  scale?: AgentOrbScale;
}

/**
 * `thinking-orbs` ships exactly two tuned canvases — 64 and 20 CSS px — and
 * each is a separate design rather than a scale factor, so there is no
 * supported way to ask it for a larger canvas. We therefore render the tuned
 * 64px canvas and present it larger with a CSS transform, which keeps the
 * package's own reduced-motion, offscreen-pause and theme behaviour intact.
 * The presentation size lives in CSS (`--orb-size`) so it can respond to the
 * viewport without re-rendering the canvas.
 *
 * The canvas itself is `aria-hidden`: it is decoration for a status that is
 * already announced in text, and a second live description of the same fact
 * would only talk over the first.
 */
export function AgentOrb({ status, scale = 'hero' }: AgentOrbProps) {
  const orbState = orbStateForStatus(status);
  return (
    <div className="agent-orb" data-scale={scale} data-status={status} data-orb-state={orbState}>
      <span className="agent-orb__halo" aria-hidden="true" />
      <span className="agent-orb__rim" aria-hidden="true" />
      <ThinkingOrb
        className="agent-orb__canvas"
        state={orbState}
        size={64}
        theme="dark"
        aria-hidden="true"
      />
    </div>
  );
}
