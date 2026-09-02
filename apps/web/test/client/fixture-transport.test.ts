// @vitest-environment node
import type {
  AgentVoiceCommand,
  AgentVoiceEvent,
  CommandOfType,
  CommandType,
} from '@agent-voice/protocol';
import { scenarios } from '@agent-voice/protocol/fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFixtureTransport } from '@/lib/client/fixture-transport';
import type { Transport, TransportCallbacks } from '@/lib/client/transport';

interface Recorder {
  callbacks: TransportCallbacks;
  events: AgentVoiceEvent[];
  calls: string[];
}

function recorder(): Recorder {
  const events: AgentVoiceEvent[] = [];
  const calls: string[] = [];
  const callbacks: TransportCallbacks = {
    onConnected: () => calls.push('connected'),
    onAgentPresence: (present) => calls.push(`agent:${String(present)}`),
    onActivity: (activity) => calls.push(`activity:${activity}`),
    onEvent: (event) => {
      events.push(event);
      calls.push(`event:${event.type}`);
    },
    onDropped: (reason) => calls.push(`dropped:${reason}`),
    onReconnecting: () => calls.push('reconnecting'),
    onReconnected: () => calls.push('reconnected'),
    onDisconnected: (reason) => calls.push(`disconnected:${reason}`),
    onFailure: (error) => calls.push(`failure:${error.code}`),
    onMic: (enabled) => calls.push(`mic:${String(enabled)}`),
    onMicError: (message) => calls.push(`micError:${message ?? 'none'}`),
    onAudioBlocked: (blocked) => calls.push(`audioBlocked:${String(blocked)}`),
  };
  return { callbacks, events, calls };
}

type CommandPartial = {
  [T in CommandType]: Omit<CommandOfType<T>, 'v' | 'id' | 'ts' | 'conversationId'>;
}[CommandType];

function command(partial: CommandPartial): AgentVoiceCommand {
  return {
    v: 1,
    id: 'cmd_test',
    ts: '2026-01-01T12:00:00.000Z',
    conversationId: 'conv_delegation',
    ...partial,
  };
}

describe('createFixtureTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function connected(scenario: keyof typeof scenarios, mode: 'voice' | 'text' = 'voice') {
    const rec = recorder();
    const transport: Transport = createFixtureTransport(rec.callbacks, { scenario, stepMs: 10 });
    await transport.connect(mode, new AbortController().signal);
    return { ...rec, transport };
  }

  it('announces the room, the agent and the listening state on connect', async () => {
    const { calls } = await connected('failure');
    expect(calls.slice(0, 3)).toEqual(['connected', 'agent:true', 'activity:listening']);
  });

  it('plays a scenario to completion and pauses on the approval until the UI answers', async () => {
    const { transport, events, calls } = await connected('delegation');
    await vi.advanceTimersByTimeAsync(10 * 20);
    expect(events.at(-1)?.type).toBe('approval.requested');
    // Nothing moves while the approval is pending, however long we wait.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(events.at(-1)?.type).toBe('approval.requested');
    expect(calls.filter((call) => call.startsWith('event:')).length).toBe(9);

    await transport.sendCommand(
      command({
        type: 'approval.respond',
        actionId: 'act_d_1',
        approvalId: 'apr_d_1',
        decision: 'approved',
      }),
    );
    await vi.advanceTimersByTimeAsync(10 * 20);
    expect(events.map((event) => event.type)).toEqual(
      scenarios.delegation.events.map((event) => event.type),
    );
    const resolved = events.find((event) => event.type === 'approval.resolved');
    expect(resolved).toMatchObject({
      approvalId: 'apr_d_1',
      actionId: 'act_d_1',
      decision: 'approved',
    });
    // Speaking while an agent message plays, then back to listening.
    expect(calls).toContain('activity:speaking');
    expect(calls.at(-1)).toBe('activity:listening');
  });

  it('turns a rejection into approval.resolved + action.failed(rejected) and skips the rest of the action', async () => {
    const { transport, events } = await connected('delegation');
    await vi.advanceTimersByTimeAsync(10 * 20);
    await transport.sendCommand(
      command({
        type: 'approval.respond',
        actionId: 'act_d_1',
        approvalId: 'apr_d_1',
        decision: 'rejected',
      }),
    );
    await vi.advanceTimersByTimeAsync(10 * 30);
    const types = events.map((event) => event.type);
    expect(types).toContain('approval.resolved');
    expect(types).toContain('action.failed');
    expect(types).not.toContain('action.verified');
    expect(types).not.toContain('artifact.created');
    const failed = events.find((event) => event.type === 'action.failed');
    expect(failed).toMatchObject({ actionId: 'act_d_1', code: 'rejected', retryable: false });
  });

  it('ignores approval responses with the wrong ids', async () => {
    const { transport, events } = await connected('delegation');
    await vi.advanceTimersByTimeAsync(10 * 20);
    await transport.sendCommand(
      command({
        type: 'approval.respond',
        actionId: 'act_d_1',
        approvalId: 'apr_nope',
        decision: 'approved',
      }),
    );
    await vi.advanceTimersByTimeAsync(10 * 20);
    expect(events.at(-1)?.type).toBe('approval.requested');
  });

  it('cancels a running action on action.cancel', async () => {
    const { transport, events } = await connected('delegation');
    await vi.advanceTimersByTimeAsync(10 * 7);
    expect(events.some((event) => event.type === 'action.started')).toBe(true);
    await transport.sendCommand(command({ type: 'action.cancel', actionId: 'act_d_1' }));
    await vi.advanceTimersByTimeAsync(10 * 30);
    const failed = events.find((event) => event.type === 'action.failed');
    expect(failed).toMatchObject({ actionId: 'act_d_1', code: 'cancelled' });
    expect(events.some((event) => event.type === 'approval.requested')).toBe(false);
  });

  it('ends the conversation on conversation.cancel and reports the disconnect', async () => {
    const { transport, events, calls } = await connected('delegation');
    await vi.advanceTimersByTimeAsync(10 * 3);
    await transport.sendCommand(command({ type: 'conversation.cancel' }));
    expect(events.at(-1)).toMatchObject({ type: 'conversation.cancelled', reason: 'user' });
    await transport.disconnect();
    expect(calls.at(-1)).toBe('disconnected:user');
    await vi.advanceTimersByTimeAsync(10 * 30);
    expect(events.at(-1)?.type).toBe('conversation.cancelled');
  });

  it('echoes typed text as a final user transcript and answers as the agent', async () => {
    const { transport, events } = await connected('failure', 'text');
    await vi.advanceTimersByTimeAsync(10 * 30);
    const before = events.length;
    await transport.sendText('typed hello');
    await vi.advanceTimersByTimeAsync(10 * 5);
    const added = events.slice(before);
    expect(added[0]).toMatchObject({ type: 'user.transcript.final', text: 'typed hello' });
    expect(added.at(-1)?.type).toBe('agent.message.final');
  });

  it('reports microphone changes', async () => {
    const { transport, calls } = await connected('failure');
    await transport.setMicrophoneEnabled(false);
    expect(calls.at(-1)).toBe('mic:false');
  });

  it('fires nothing after being aborted during connect', async () => {
    const rec = recorder();
    const controller = new AbortController();
    const transport = createFixtureTransport(rec.callbacks, { scenario: 'delegation', stepMs: 10 });
    controller.abort();
    await expect(transport.connect('voice', controller.signal)).rejects.toMatchObject({
      code: 'aborted',
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(rec.calls).toEqual([]);
  });

  it('stops emitting after disconnect', async () => {
    const { transport, events } = await connected('delegation');
    await vi.advanceTimersByTimeAsync(10 * 3);
    await transport.disconnect();
    const count = events.length;
    await vi.advanceTimersByTimeAsync(10 * 30);
    expect(events.length).toBe(count);
  });
});
