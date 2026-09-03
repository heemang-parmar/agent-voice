// @vitest-environment node
import type { AgentVoiceEvent, EventOfType } from '@agent-voice/protocol';
import { eventFixtures, scenarios } from '@agent-voice/protocol/fixtures';
import { describe, expect, it } from 'vitest';

import {
  AGENT_CAPTION_ID_PREFIX,
  MAX_AGENT_TURNS,
  MAX_TRANSCRIPT_ENTRIES,
  deriveStatus,
  initialSessionState,
  sessionReducer,
  type SessionAction,
  type SessionState,
} from '@/lib/client/session-state';

function run(actions: SessionAction[], from: SessionState = initialSessionState): SessionState {
  return actions.reduce(sessionReducer, from);
}

function events(list: AgentVoiceEvent[]): SessionAction[] {
  return list.map((event) => ({ type: 'event', event }));
}

function fixture<K extends keyof typeof eventFixtures>(key: K): EventOfType<K> {
  return eventFixtures[key] as EventOfType<K>;
}

const connectedVoice: SessionAction[] = [
  { type: 'start', mode: 'voice' },
  { type: 'connected' },
  { type: 'agent_presence', present: true },
  { type: 'activity', activity: 'listening' },
];

describe('sessionReducer: connection lifecycle', () => {
  it('starts idle with nothing to show', () => {
    expect(deriveStatus(initialSessionState)).toBe('idle');
    expect(initialSessionState.transcript).toEqual([]);
    expect(initialSessionState.actions).toEqual([]);
    expect(initialSessionState.pendingApproval).toBeNull();
  });

  it('moves through connecting → listening once the agent is present', () => {
    const connecting = run([{ type: 'start', mode: 'voice' }]);
    expect(deriveStatus(connecting)).toBe('connecting');
    expect(connecting.mode).toBe('voice');
    expect(connecting.micEnabled).toBe(true);

    const connected = run([{ type: 'connected' }], connecting);
    expect(deriveStatus(connected)).toBe('connecting'); // room joined, agent not here yet

    const ready = run(
      [
        { type: 'agent_presence', present: true },
        { type: 'activity', activity: 'listening' },
      ],
      connected,
    );
    expect(deriveStatus(ready)).toBe('listening');
  });

  it('starts text sessions with the microphone off', () => {
    const state = run([{ type: 'start', mode: 'text' }]);
    expect(state.mode).toBe('text');
    expect(state.micEnabled).toBe(false);
  });

  it('reflects agent activity while connected', () => {
    const base = run(connectedVoice);
    expect(deriveStatus(run([{ type: 'activity', activity: 'thinking' }], base))).toBe('thinking');
    expect(deriveStatus(run([{ type: 'activity', activity: 'speaking' }], base))).toBe('speaking');
  });

  it('tracks reconnecting and reconnected', () => {
    const base = run(connectedVoice);
    const reconnecting = run([{ type: 'reconnecting' }], base);
    expect(deriveStatus(reconnecting)).toBe('reconnecting');
    expect(deriveStatus(run([{ type: 'reconnected' }], reconnecting))).toBe('listening');
  });

  it('ends on disconnect and remembers why', () => {
    const state = run([{ type: 'disconnected', reason: 'server_shutdown' }], run(connectedVoice));
    expect(deriveStatus(state)).toBe('ended');
    expect(state.endReason).toBe('server_shutdown');
  });

  it('surfaces failures with a code and a human message', () => {
    const state = run([
      { type: 'start', mode: 'voice' },
      { type: 'failure', error: { code: 'not_configured', message: 'Server is not configured.' } },
    ]);
    expect(deriveStatus(state)).toBe('error');
    expect(state.error).toEqual({ code: 'not_configured', message: 'Server is not configured.' });
  });

  it('a failure after the session ended does not reopen it', () => {
    const ended = run([{ type: 'end', reason: 'user' }], run(connectedVoice));
    const after = run([{ type: 'failure', error: { code: 'connection', message: 'x' } }], ended);
    expect(deriveStatus(after)).toBe('ended');
  });

  it('start after an ended or failed session clears the previous conversation', () => {
    const first = run([
      ...connectedVoice,
      ...events(scenarios.failure.events),
      { type: 'end', reason: 'user' },
    ]);
    expect(first.transcript.length).toBeGreaterThan(0);
    const second = run([{ type: 'start', mode: 'text' }], first);
    expect(second.transcript).toEqual([]);
    expect(second.actions).toEqual([]);
    expect(second.error).toBeNull();
    expect(second.endReason).toBeNull();
    expect(second.conversationId).toBeNull();
  });

  it('tracks microphone, audio playback and agent presence flags', () => {
    const state = run(
      [
        { type: 'mic', enabled: false },
        { type: 'audio_blocked', blocked: true },
        { type: 'mic_error', message: 'Microphone permission was denied.' },
        { type: 'agent_presence', present: false },
      ],
      run(connectedVoice),
    );
    expect(state.micEnabled).toBe(false);
    expect(state.audioBlocked).toBe(true);
    expect(state.micError).toBe('Microphone permission was denied.');
    expect(state.agentPresent).toBe(false);
    expect(deriveStatus(state)).toBe('connecting');
  });
});

describe('sessionReducer: transcript', () => {
  it('upserts partial and final user segments into one entry', () => {
    const state = run(
      events([
        eventFixtures['conversation.started'],
        { ...fixture('user.transcript.partial'), segmentId: 'seg_1', text: 'Hello th' },
        { ...fixture('user.transcript.final'), segmentId: 'seg_1', text: 'Hello there.' },
      ]),
      run(connectedVoice),
    );
    expect(state.transcript).toHaveLength(1);
    expect(state.transcript[0]).toMatchObject({ role: 'user', text: 'Hello there.', final: true });
  });

  it('keeps user and agent messages in arrival order with roles', () => {
    const state = run(events(scenarios.delegation.events), run(connectedVoice));
    expect(state.transcript.map((entry) => entry.role)).toEqual(['user', 'agent', 'agent']);
    expect(state.transcript.every((entry) => entry.final)).toBe(true);
  });

  it('adds locally typed text as a final user entry', () => {
    const state = run(
      [{ type: 'user_text', id: 'local-1', text: 'typed message', ts: '2026-01-01T00:00:00.000Z' }],
      run(connectedVoice),
    );
    expect(state.transcript).toEqual([
      {
        id: 'local-1',
        role: 'user',
        text: 'typed message',
        final: true,
        ts: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('bounds the transcript length by dropping the oldest entries', () => {
    const many: AgentVoiceEvent[] = Array.from({ length: MAX_TRANSCRIPT_ENTRIES + 5 }, (_, i) => ({
      ...fixture('user.transcript.final'),
      id: `evt_${String(i)}`,
      segmentId: `seg_${String(i)}`,
      text: `line ${String(i)}`,
    }));
    const state = run(events(many), run(connectedVoice));
    expect(state.transcript).toHaveLength(MAX_TRANSCRIPT_ENTRIES);
    expect(state.transcript[0]?.text).toBe('line 5');
  });
});

describe('sessionReducer: TTS-aligned agent captions', () => {
  /** What the transport synthesises from a LiveKit agent transcription segment. */
  function caption(segmentId: string, text: string, final = false): AgentVoiceEvent {
    const base = final ? fixture('agent.message.final') : fixture('agent.message.partial');
    return { ...base, messageId: `${AGENT_CAPTION_ID_PREFIX}${segmentId}`, text };
  }

  /** What the worker emits from `conversation_item_added`, with its own id. */
  function workerFinal(messageId: string, text: string): AgentVoiceEvent {
    return { ...fixture('agent.message.final'), messageId, text };
  }

  const live = run(connectedVoice);

  it('grows one entry as the spoken caption arrives, under a single message id', () => {
    const state = run(
      events([
        caption('SG_1', 'Let me'),
        caption('SG_1', 'Let me check'),
        caption('SG_1', 'Let me check that'),
      ]),
      live,
    );
    expect(state.transcript).toHaveLength(1);
    expect(state.transcript[0]).toMatchObject({
      role: 'agent',
      text: 'Let me check that',
      final: false,
    });
  });

  it('finalises the caption entry in place when the spoken turn completes', () => {
    const state = run(
      events([caption('SG_1', 'Let me check'), caption('SG_1', 'Let me check that.', true)]),
      live,
    );
    expect(state.transcript).toHaveLength(1);
    expect(state.transcript[0]).toMatchObject({ text: 'Let me check that.', final: true });
  });

  it('reconciles the worker final into the same turn instead of adding a second entry', () => {
    const state = run(
      events([
        caption('SG_1', 'Let me check'),
        caption('SG_1', 'Let me check that.', true),
        workerFinal('item_1', 'Let me check that.'),
      ]),
      live,
    );
    expect(state.transcript).toHaveLength(1);
    expect(state.transcript[0]).toMatchObject({ text: 'Let me check that.', final: true });
    expect(state.droppedEvents).toBe(0);
  });

  it('finalises in place when the worker final races ahead of the caption final', () => {
    const racing = run(
      events([caption('SG_1', 'Let me check'), workerFinal('item_1', 'Let me check that.')]),
      live,
    );
    expect(racing.transcript).toHaveLength(1);
    // Committed by the LLM, but still actively playing and therefore partial.
    expect(racing.transcript[0]).toMatchObject({ text: 'Let me check', final: false });

    const settled = run(events([caption('SG_1', 'Let me check that.', true)]), racing);
    expect(settled.transcript).toHaveLength(1);
    expect(settled.transcript[0]).toMatchObject({ text: 'Let me check that.', final: true });
  });

  it('keeps what was actually spoken when the turn is interrupted', () => {
    const state = run(
      events([
        caption('SG_1', 'Sure, the nightly'),
        caption('SG_1', 'Sure, the nightly build', true),
        workerFinal('item_1', 'Sure, the nightly build finished an hour ago with two failures.'),
      ]),
      live,
    );
    expect(state.transcript).toHaveLength(1);
    expect(state.transcript[0]).toMatchObject({ text: 'Sure, the nightly build', final: true });
  });

  it('ignores a repeated worker final for a turn it already reconciled', () => {
    const state = run(
      events([
        caption('SG_1', 'Done.', true),
        workerFinal('item_1', 'Done.'),
        workerFinal('item_1', 'Done.'),
      ]),
      live,
    );
    expect(state.transcript).toHaveLength(1);
  });

  it('keeps identical replies in different turns as separate entries', () => {
    const state = run(
      events([
        caption('SG_1', 'Sure.', true),
        workerFinal('item_1', 'Sure.'),
        caption('SG_2', 'Sure.', true),
        workerFinal('item_2', 'Sure.'),
      ]),
      live,
    );
    expect(state.transcript).toHaveLength(2);
    expect(state.transcript.every((entry) => entry.final && entry.text === 'Sure.')).toBe(true);
  });

  it('matches worker finals to caption turns in order, not to whichever turn is newest', () => {
    const state = run(
      events([
        caption('SG_1', 'First reply.', true),
        caption('SG_2', 'Second reply.', true),
        workerFinal('item_1', 'First reply.'),
        workerFinal('item_2', 'Second reply.'),
      ]),
      live,
    );
    expect(state.transcript.map((entry) => entry.text)).toEqual(['First reply.', 'Second reply.']);
  });

  it('still records a worker final that never had captions', () => {
    const state = run(events([workerFinal('item_1', 'No audio for this one.')]), live);
    expect(state.transcript).toHaveLength(1);
    expect(state.transcript[0]).toMatchObject({ text: 'No audio for this one.', final: true });
  });

  it('lets a late first caption take over a worker-first turn without duplicating it', () => {
    const committed = run(events([workerFinal('item_1', 'The full generated answer.')]), live);
    expect(committed.transcript).toHaveLength(1);
    expect(committed.transcript[0]).toMatchObject({
      text: 'The full generated answer.',
      final: true,
    });

    const speaking = run(events([caption('SG_1', 'The full')]), committed);
    expect(speaking.transcript).toHaveLength(1);
    expect(speaking.transcript[0]).toMatchObject({ text: 'The full', final: false });

    const settled = run(events([caption('SG_1', 'The full generated answer.', true)]), speaking);
    expect(settled.transcript).toHaveLength(1);
    expect(settled.transcript[0]).toMatchObject({
      text: 'The full generated answer.',
      final: true,
    });
  });

  it('bounds the turn-reconciliation table', () => {
    const many = Array.from({ length: MAX_AGENT_TURNS + 4 }, (_, i) => [
      caption(`SG_${String(i)}`, `reply ${String(i)}`, true),
      workerFinal(`item_${String(i)}`, `reply ${String(i)}`),
    ]).flat();
    const state = run(events(many), live);
    expect(state.agentTurns.length).toBeLessThanOrEqual(MAX_AGENT_TURNS);
    expect(state.transcript).toHaveLength(MAX_AGENT_TURNS + 4);
  });
});

describe('sessionReducer: actions and approvals', () => {
  it('plays the delegation scenario into a verified action with artifacts', () => {
    const state = run(events(scenarios.delegation.events), run(connectedVoice));
    expect(state.actions).toHaveLength(1);
    const action = state.actions[0];
    expect(action).toMatchObject({
      actionId: 'act_d_1',
      title: 'Check the nightly build and re-run failures',
      status: 'verified',
      approval: { approvalId: 'apr_d_1', decision: 'approved' },
    });
    expect(action?.progress.map((p) => p.percent)).toEqual([20, 55, 80]);
    expect(action?.artifacts.map((a) => a.id)).toEqual(['art_d_1', 'art_d_2']);
    expect(action?.result).toMatchObject({ kind: 'verified', method: expect.any(String) });
    expect(state.pendingApproval).toBeNull();
    expect(deriveStatus(state)).toBe('listening');
  });

  it('holds a pending approval bound to the exact action and approval ids', () => {
    const upToRequest = scenarios.delegation.events.slice(0, 9);
    const state = run(events(upToRequest), run(connectedVoice));
    expect(deriveStatus(state)).toBe('awaiting-approval');
    expect(state.pendingApproval).toMatchObject({
      approvalId: 'apr_d_1',
      actionId: 'act_d_1',
      prompt: 'Re-run the two failed jobs on the nightly pipeline?',
      expiresAt: '2026-01-01T12:02:06.500Z',
      title: 'Check the nightly build and re-run failures',
    });
    expect(state.actions[0]?.status).toBe('awaiting-approval');
  });

  it('reports acting while an action runs without an approval', () => {
    const state = run(events(scenarios.delegation.events.slice(0, 7)), run(connectedVoice));
    expect(deriveStatus(state)).toBe('acting');
  });

  it('records an optimistic decision while the response is in flight', () => {
    const base = run(events(scenarios.delegation.events.slice(0, 9)), run(connectedVoice));
    const state = run(
      [
        {
          type: 'approval_submitting',
          approvalId: 'apr_d_1',
          actionId: 'act_d_1',
          decision: 'approved',
        },
      ],
      base,
    );
    expect(state.pendingApproval?.submitting).toBe('approved');
    // A mismatched id must not touch the pending approval.
    const other = run(
      [
        {
          type: 'approval_submitting',
          approvalId: 'apr_other',
          actionId: 'act_d_1',
          decision: 'rejected',
        },
      ],
      base,
    );
    expect(other.pendingApproval?.submitting).toBeUndefined();
  });

  it('ignores approval events that do not match the pending approval', () => {
    const base = run(events(scenarios.delegation.events.slice(0, 9)), run(connectedVoice));
    const resolvedOther: AgentVoiceEvent = {
      ...fixture('approval.resolved'),
      conversationId: 'conv_delegation',
      actionId: 'act_d_1',
      approvalId: 'apr_wrong',
      decision: 'approved',
    };
    const state = run(events([resolvedOther]), base);
    expect(state.pendingApproval?.approvalId).toBe('apr_d_1');
    expect(state.droppedEvents).toBe(1);
  });

  it('plays the cancellation scenario: rejection fails the action and ends the conversation', () => {
    const state = run(events(scenarios.cancellation.events), run(connectedVoice));
    expect(state.actions[0]).toMatchObject({
      status: 'failed',
      approval: { approvalId: 'apr_c_1', decision: 'rejected' },
      result: { kind: 'failed', code: 'rejected', retryable: false },
    });
    expect(state.pendingApproval).toBeNull();
    expect(deriveStatus(state)).toBe('ended');
    expect(state.endReason).toBe('user');
  });

  it('plays the failure scenario: unavailable adapter, retryable, conversation continues', () => {
    const state = run(events(scenarios.failure.events), run(connectedVoice));
    expect(state.actions[0]).toMatchObject({
      status: 'failed',
      result: { kind: 'failed', code: 'unavailable', retryable: true },
    });
    expect(deriveStatus(state)).toBe('listening');
    expect(state.transcript.at(-1)?.role).toBe('agent');
  });

  it('marks a cancel request on the exact action and clears it on completion', () => {
    const base = run(events(scenarios.delegation.events.slice(0, 7)), run(connectedVoice));
    const requested = run([{ type: 'cancel_requested', actionId: 'act_d_1' }], base);
    expect(requested.actions[0]?.cancelRequested).toBe(true);
    const cancelled: AgentVoiceEvent = {
      ...fixture('action.failed'),
      conversationId: 'conv_delegation',
      actionId: 'act_d_1',
      code: 'cancelled',
      summary: 'Cancelled at your request.',
      retryable: true,
    };
    const done = run(events([cancelled]), requested);
    expect(done.actions[0]).toMatchObject({ status: 'failed', result: { code: 'cancelled' } });
    expect(deriveStatus(done)).toBe('listening');
  });

  it('drops events for unknown actions or a different conversation and counts them', () => {
    const base = run(events(scenarios.delegation.events.slice(0, 1)), run(connectedVoice));
    const foreign: AgentVoiceEvent = {
      ...fixture('action.progress'),
      conversationId: 'conv_other',
    };
    const orphan: AgentVoiceEvent = { ...fixture('action.progress'), actionId: 'act_unknown' };
    const state = run(events([foreign, orphan]), base);
    expect(state.actions).toEqual([]);
    expect(state.droppedEvents).toBe(2);
  });

  it('does not accept a second concurrent action while one is in flight', () => {
    const base = run(events(scenarios.delegation.events.slice(0, 7)), run(connectedVoice));
    const second: AgentVoiceEvent = {
      ...fixture('action.started'),
      conversationId: 'conv_delegation',
      actionId: 'act_second',
    };
    const state = run(events([second]), base);
    expect(state.actions.map((a) => a.actionId)).toEqual(['act_d_1']);
    expect(state.droppedEvents).toBe(1);
  });

  it('fails in-flight actions when the conversation is cancelled', () => {
    const base = run(events(scenarios.delegation.events.slice(0, 9)), run(connectedVoice));
    const state = run(
      events([{ ...fixture('conversation.cancelled'), conversationId: 'conv_delegation' }]),
      base,
    );
    expect(state.pendingApproval).toBeNull();
    expect(state.actions[0]).toMatchObject({ status: 'failed', result: { code: 'cancelled' } });
    expect(deriveStatus(state)).toBe('ended');
  });
});
