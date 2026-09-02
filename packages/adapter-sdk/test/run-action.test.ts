import { LIMITS, parseEvent, type AgentVoiceEvent } from '@agent-voice/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApprovalBroker,
  runAction,
  type ActionContext,
  type AdapterRequest,
  type AdapterResult,
  type AgentAdapter,
} from '../src/index.js';

const baseRequest = {
  conversationId: 'conv_test',
  text: 'Check the nightly build',
  sessionKey: 'session-test',
};

function makeIds() {
  let counter = 0;
  return () => `id_${String(++counter).padStart(3, '0')}`;
}

function harness(adapter: AgentAdapter, overrides: Partial<Parameters<typeof runAction>[0]> = {}) {
  const events: AgentVoiceEvent[] = [];
  const broker = new ApprovalBroker();
  const promise = runAction({
    adapter,
    request: baseRequest,
    title: 'Check the nightly build',
    timeoutMs: 5_000,
    emit: (event) => events.push(event),
    approvals: broker,
    newId: makeIds(),
    ...overrides,
  });
  return { events, broker, promise };
}

function scripted(run: AgentAdapter['run']): AgentAdapter {
  return { name: 'scripted', run };
}

const verified = (summary: string): AdapterResult => ({
  status: 'verified',
  summary,
  verification: { state: 'verified', method: 'scripted' },
  artifacts: [],
});

describe('runAction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits started, progress, artifact and verified events that all validate', async () => {
    const adapter = scripted((_request: AdapterRequest, ctx: ActionContext) => {
      ctx.progress('Looking up the run', 30);
      ctx.artifact({ id: 'art_1', kind: 'link', title: 'Run', url: 'https://ci.example.com/1' });
      return Promise.resolve(verified('The nightly build passed.'));
    });
    const { events, promise } = harness(adapter);
    const outcome = await promise;

    expect(events.map((event) => event.type)).toEqual([
      'action.started',
      'action.progress',
      'artifact.created',
      'action.verified',
    ]);
    for (const event of events) {
      expect(parseEvent(event)).toEqual({ ok: true, value: event });
      expect(event.conversationId).toBe('conv_test');
    }
    const ids = new Set(events.map((event) => event.id));
    expect(ids.size).toBe(events.length);
    expect(outcome.result.status).toBe('verified');
    expect(outcome.actionId).toBe(events[0]?.['actionId' as never]);
    const terminal = events.at(-1);
    expect(terminal?.type).toBe('action.verified');
    if (terminal?.type === 'action.verified') {
      expect(terminal.summary).toBe('The nightly build passed.');
      expect(terminal.verification.state).toBe('verified');
    }
  });

  it('times out an adapter that never returns and reports a generic, retryable failure', async () => {
    let observedAbort = false;
    const adapter = scripted(
      (_request, ctx) =>
        new Promise<AdapterResult>(() => {
          ctx.signal.addEventListener('abort', () => {
            observedAbort = true;
          });
        }),
    );
    const { events, promise } = harness(adapter, { timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_001);
    const outcome = await promise;

    expect(observedAbort).toBe(true);
    expect(outcome.result.status).toBe('failed');
    const terminal = events.at(-1);
    expect(terminal?.type).toBe('action.failed');
    if (terminal?.type === 'action.failed') {
      expect(terminal.code).toBe('timeout');
      expect(terminal.retryable).toBe(true);
    }
  });

  it('cancels through an external signal and ignores late adapter activity', async () => {
    let lateContext: ActionContext | undefined;
    const controller = new AbortController();
    const adapter = scripted(
      (_request, ctx) =>
        new Promise<AdapterResult>((resolve) => {
          lateContext = ctx;
          ctx.signal.addEventListener('abort', () => {
            resolve(verified('too late'));
          });
        }),
    );
    const { events, promise } = harness(adapter, { signal: controller.signal });
    controller.abort();
    const outcome = await promise;

    expect(outcome.result.status).toBe('cancelled');
    expect(events.map((event) => event.type)).toEqual(['action.started', 'action.failed']);
    lateContext?.progress('still going');
    await vi.advanceTimersByTimeAsync(10);
    expect(events).toHaveLength(2);
    const terminal = events[1];
    if (terminal?.type === 'action.failed') expect(terminal.code).toBe('cancelled');
  });

  it('never leaks adapter exception text into events', async () => {
    const adapter = scripted(() => {
      throw new Error('token=abc123 upstream exploded');
    });
    const { events, promise } = harness(adapter);
    await promise;
    const terminal = events.at(-1);
    expect(terminal?.type).toBe('action.failed');
    expect(JSON.stringify(events)).not.toContain('abc123');
    expect(JSON.stringify(events)).not.toContain('exploded');
  });

  it('runs an approval round-trip bound to the exact action and approval ids', async () => {
    const adapter = scripted(async (_request, ctx) => {
      const decision = await ctx.requestApproval({ prompt: 'Re-run failed jobs?' });
      return decision === 'approved'
        ? verified('Re-ran the failed jobs.')
        : { ...verified(''), status: 'failed', code: 'rejected', summary: 'Not re-run.' };
    });
    const { events, broker, promise } = harness(adapter);
    await vi.advanceTimersByTimeAsync(0);

    const requested = events.find((event) => event.type === 'approval.requested');
    expect(requested).toBeDefined();
    if (requested?.type !== 'approval.requested') return;
    expect(Date.parse(requested.expiresAt)).toBeLessThanOrEqual(Date.now() + 5_000);

    expect(
      broker.resolve({
        actionId: requested.actionId,
        approvalId: 'apr_wrong',
        decision: 'approved',
      }),
    ).toBe(false);
    expect(
      broker.resolve({
        actionId: 'act_wrong',
        approvalId: requested.approvalId,
        decision: 'approved',
      }),
    ).toBe(false);
    expect(
      broker.resolve({
        actionId: requested.actionId,
        approvalId: requested.approvalId,
        decision: 'approved',
      }),
    ).toBe(true);

    const outcome = await promise;
    expect(outcome.result.status).toBe('verified');
    const resolved = events.find((event) => event.type === 'approval.resolved');
    expect(resolved).toMatchObject({ decision: 'approved', resolvedBy: 'user' });
    expect(events.at(-1)?.type).toBe('action.verified');
    // A second answer for the same approval is ignored.
    expect(
      broker.resolve({
        actionId: requested.actionId,
        approvalId: requested.approvalId,
        decision: 'rejected',
      }),
    ).toBe(false);
  });

  it('expires an unanswered approval and lets the adapter fail honestly', async () => {
    const adapter = scripted(async (_request, ctx) => {
      const decision = await ctx.requestApproval({ prompt: 'Proceed?', expiresInMs: 500 });
      expect(decision).toBe('expired');
      return {
        status: 'failed',
        code: 'expired',
        summary: 'The approval expired, so nothing was changed.',
        verification: { state: 'unverified', method: 'scripted' },
        artifacts: [],
      };
    });
    const { events, promise } = harness(adapter);
    await vi.advanceTimersByTimeAsync(501);
    const outcome = await promise;
    expect(outcome.result.status).toBe('failed');
    expect(events.find((event) => event.type === 'approval.resolved')).toMatchObject({
      decision: 'expired',
      resolvedBy: 'system',
    });
    const terminal = events.at(-1);
    if (terminal?.type === 'action.failed') expect(terminal.code).toBe('expired');
  });

  it('refuses to report a verified action when the adapter did not verify it', async () => {
    const adapter = scripted(() =>
      Promise.resolve<AdapterResult>({
        status: 'verified',
        summary: 'Done!',
        verification: { state: 'unverified', method: 'wishful' },
        artifacts: [],
      }),
    );
    const { events, promise } = harness(adapter);
    const outcome = await promise;
    expect(outcome.result.status).toBe('failed');
    expect(events.map((event) => event.type)).toEqual(['action.started', 'action.failed']);
  });

  it('rejects oversized requests before calling the adapter and bounds adapter output', async () => {
    const run = vi.fn(() => Promise.resolve(verified('x'.repeat(LIMITS.maxTextChars + 100))));
    const oversized = harness(scripted(run), {
      request: { ...baseRequest, text: 'y'.repeat(LIMITS.maxTextChars + 1) },
    });
    await oversized.promise;
    expect(run).not.toHaveBeenCalled();
    const terminal = oversized.events.at(-1);
    expect(terminal?.type).toBe('action.failed');
    if (terminal?.type === 'action.failed') expect(terminal.code).toBe('invalid');

    const artifacts = Array.from({ length: LIMITS.maxArtifacts + 5 }, (_, index) => ({
      id: `art_${index}`,
      kind: 'text' as const,
      title: 'Note',
      text: 'n',
    }));
    const bounded = harness(
      scripted(() =>
        Promise.resolve({ ...verified('s'.repeat(LIMITS.maxTextChars + 5)), artifacts }),
      ),
    );
    await bounded.promise;
    const last = bounded.events.at(-1);
    expect(last?.type).toBe('action.verified');
    if (last?.type === 'action.verified') {
      expect(last.summary.length).toBeLessThanOrEqual(LIMITS.maxTextChars);
      expect(last.artifacts?.length).toBe(LIMITS.maxArtifacts);
    }
    for (const event of bounded.events) expect(parseEvent(event).ok).toBe(true);
  });
});
