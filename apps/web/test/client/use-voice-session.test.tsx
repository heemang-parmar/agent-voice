import { parseCommand, type AgentVoiceCommand } from '@agent-voice/protocol';
import { scenarios } from '@agent-voice/protocol/fixtures';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Transport, TransportCallbacks, TransportFactory } from '@/lib/client/transport';
import { TransportError } from '@/lib/client/transport';
import { useVoiceSession } from '@/lib/client/use-voice-session';

interface FakeTransport extends Transport {
  callbacks: TransportCallbacks;
  commands: AgentVoiceCommand[];
  texts: string[];
  mic: boolean[];
  disconnects: number;
  resumes: number;
  connectSignal: AbortSignal | null;
}

function fakeTransportFactory(
  behaviour: { connect?: (signal: AbortSignal) => Promise<void> } = {},
): { factory: TransportFactory; created: FakeTransport[] } {
  const created: FakeTransport[] = [];
  const factory: TransportFactory = (callbacks) => {
    const transport: FakeTransport = {
      callbacks,
      commands: [],
      texts: [],
      mic: [],
      disconnects: 0,
      resumes: 0,
      connectSignal: null,
      async connect(_mode, signal) {
        transport.connectSignal = signal;
        if (behaviour.connect) {
          await behaviour.connect(signal);
          return;
        }
        callbacks.onConnected();
        callbacks.onAgentPresence(true);
        callbacks.onActivity('listening');
      },
      sendCommand(command) {
        transport.commands.push(command);
        return Promise.resolve();
      },
      sendText(text) {
        transport.texts.push(text);
        return Promise.resolve();
      },
      setMicrophoneEnabled(enabled) {
        transport.mic.push(enabled);
        callbacks.onMic(enabled);
        return Promise.resolve();
      },
      resumeAudio() {
        transport.resumes += 1;
        callbacks.onAudioBlocked(false);
        return Promise.resolve();
      },
      disconnect() {
        transport.disconnects += 1;
        callbacks.onDisconnected('user');
        return Promise.resolve();
      },
    };
    created.push(transport);
    return transport;
  };
  return { factory, created };
}

async function startedSession(mode: 'voice' | 'text' = 'voice') {
  const { factory, created } = fakeTransportFactory();
  const hook = renderHook(() => useVoiceSession(factory));
  await act(async () => {
    await hook.result.current.start(mode);
  });
  const transport = created[0];
  if (!transport) throw new Error('transport not created');
  return { hook, transport, created };
}

describe('useVoiceSession', () => {
  it('starts idle and connects on demand', async () => {
    const { factory, created } = fakeTransportFactory();
    const { result } = renderHook(() => useVoiceSession(factory));
    expect(result.current.status).toBe('idle');
    expect(created).toHaveLength(0);

    await act(async () => {
      await result.current.start('voice');
    });
    expect(created).toHaveLength(1);
    expect(result.current.status).toBe('listening');
    expect(result.current.state.mode).toBe('voice');
  });

  it('ignores a second start while a session is live', async () => {
    const { hook, created } = await startedSession();
    await act(async () => {
      await hook.result.current.start('text');
    });
    expect(created).toHaveLength(1);
    expect(hook.result.current.state.mode).toBe('voice');
  });

  it('feeds protocol events from the transport into the state', async () => {
    const { hook, transport } = await startedSession();
    act(() => {
      for (const event of scenarios.delegation.events.slice(0, 9))
        transport.callbacks.onEvent(event);
    });
    expect(hook.result.current.status).toBe('awaiting-approval');
    expect(hook.result.current.state.pendingApproval?.approvalId).toBe('apr_d_1');
  });

  it('answers approvals with a valid command bound to the exact ids', async () => {
    const { hook, transport } = await startedSession();
    act(() => {
      for (const event of scenarios.delegation.events.slice(0, 9))
        transport.callbacks.onEvent(event);
    });
    await act(async () => {
      await hook.result.current.respondToApproval('apr_d_1', 'act_d_1', 'approved');
    });
    expect(transport.commands).toHaveLength(1);
    const sent = transport.commands[0];
    expect(sent).toMatchObject({
      type: 'approval.respond',
      approvalId: 'apr_d_1',
      actionId: 'act_d_1',
      decision: 'approved',
      conversationId: 'conv_delegation',
      v: 1,
    });
    expect(parseCommand(JSON.stringify(sent)).ok).toBe(true);
    expect(hook.result.current.state.pendingApproval?.submitting).toBe('approved');
  });

  it('refuses to answer an approval that is not the pending one', async () => {
    const { hook, transport } = await startedSession();
    act(() => {
      for (const event of scenarios.delegation.events.slice(0, 9))
        transport.callbacks.onEvent(event);
    });
    await act(async () => {
      await hook.result.current.respondToApproval('apr_stale', 'act_d_1', 'approved');
      await hook.result.current.respondToApproval('apr_d_1', 'act_other', 'rejected');
    });
    expect(transport.commands).toHaveLength(0);
  });

  it('cancels the running action with action.cancel', async () => {
    const { hook, transport } = await startedSession();
    act(() => {
      for (const event of scenarios.delegation.events.slice(0, 7))
        transport.callbacks.onEvent(event);
    });
    expect(hook.result.current.status).toBe('acting');
    await act(async () => {
      await hook.result.current.cancelAction('act_d_1');
    });
    expect(transport.commands[0]).toMatchObject({ type: 'action.cancel', actionId: 'act_d_1' });
    expect(hook.result.current.state.actions[0]?.cancelRequested).toBe(true);
  });

  it('sends typed text and shows it in the transcript immediately', async () => {
    const { hook, transport } = await startedSession('text');
    await act(async () => {
      await hook.result.current.sendText('  hello there  ');
    });
    expect(transport.texts).toEqual(['hello there']);
    expect(hook.result.current.state.transcript).toHaveLength(1);
    expect(hook.result.current.state.transcript[0]).toMatchObject({
      role: 'user',
      text: 'hello there',
    });
  });

  it('does not send blank text', async () => {
    const { hook, transport } = await startedSession('text');
    await act(async () => {
      await hook.result.current.sendText('   ');
    });
    expect(transport.texts).toEqual([]);
  });

  it('toggles the microphone through the transport', async () => {
    const { hook, transport } = await startedSession();
    expect(hook.result.current.state.micEnabled).toBe(true);
    await act(async () => {
      await hook.result.current.setMicrophoneEnabled(false);
    });
    expect(transport.mic).toEqual([false]);
    expect(hook.result.current.state.micEnabled).toBe(false);
  });

  it('ends the session: conversation.cancel, disconnect, ended state', async () => {
    const { hook, transport } = await startedSession();
    await act(async () => {
      await hook.result.current.end();
    });
    expect(transport.commands.at(-1)).toMatchObject({ type: 'conversation.cancel' });
    expect(transport.disconnects).toBe(1);
    expect(hook.result.current.status).toBe('ended');
  });

  it('can start again after ending', async () => {
    const { hook, created } = await startedSession();
    await act(async () => {
      await hook.result.current.end();
    });
    await act(async () => {
      await hook.result.current.start('text');
    });
    expect(created).toHaveLength(2);
    expect(hook.result.current.status).toBe('listening');
    expect(hook.result.current.state.transcript).toEqual([]);
  });

  it('reports connect failures with the transport error code and message', async () => {
    const { factory } = fakeTransportFactory({
      connect: () =>
        Promise.reject(
          new TransportError('not_configured', 'This deployment is not configured for voice yet.', {
            missing: ['LIVEKIT_URL'],
          }),
        ),
    });
    const { result } = renderHook(() => useVoiceSession(factory));
    await act(async () => {
      await result.current.start('voice');
    });
    expect(result.current.status).toBe('error');
    expect(result.current.state.error).toEqual({
      code: 'not_configured',
      message: 'This deployment is not configured for voice yet.',
    });
    expect(result.current.missingConfig).toEqual(['LIVEKIT_URL']);
  });

  it('aborts a connection in progress when the user ends it, without an error state', async () => {
    let release: (() => void) | null = null;
    const { factory, created } = fakeTransportFactory({
      connect: (signal) =>
        new Promise<void>((resolve, reject) => {
          release = resolve;
          signal.addEventListener('abort', () => {
            reject(new TransportError('aborted', 'cancelled'));
          });
        }),
    });
    const { result } = renderHook(() => useVoiceSession(factory));
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.start('voice');
    });
    expect(result.current.status).toBe('connecting');
    await act(async () => {
      await result.current.end();
      await pending;
    });
    expect(created[0]?.connectSignal?.aborted).toBe(true);
    expect(created[0]?.disconnects).toBe(1);
    expect(result.current.status).toBe('ended');
    expect(result.current.state.error).toBeNull();
    expect(release).not.toBeNull();
  });

  it('disconnects on unmount', async () => {
    const { hook, transport } = await startedSession();
    hook.unmount();
    await waitFor(() => {
      expect(transport.disconnects).toBe(1);
    });
  });

  it('reflects reconnecting, reconnected, dropped messages and audio blocking', async () => {
    const { hook, transport } = await startedSession();
    act(() => {
      transport.callbacks.onReconnecting();
    });
    expect(hook.result.current.status).toBe('reconnecting');
    act(() => {
      transport.callbacks.onReconnected();
      transport.callbacks.onDropped('invalid_event');
      transport.callbacks.onAudioBlocked(true);
    });
    expect(hook.result.current.status).toBe('listening');
    expect(hook.result.current.state.droppedEvents).toBe(1);
    expect(hook.result.current.state.audioBlocked).toBe(true);
    await act(async () => {
      await hook.result.current.resumeAudio();
    });
    expect(transport.resumes).toBe(1);
    expect(hook.result.current.state.audioBlocked).toBe(false);
  });

  it('turns a transport failure into the error state and tears the transport down', async () => {
    const { hook, transport } = await startedSession();
    act(() => {
      transport.callbacks.onFailure({ code: 'connection', message: 'Lost the room.' });
    });
    expect(hook.result.current.status).toBe('error');
    await waitFor(() => {
      expect(transport.disconnects).toBe(1);
    });
  });

  it('logs dropped messages without their payload', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { transport } = await startedSession();
    act(() => {
      transport.callbacks.onDropped('too_large');
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('too_large'));
    warn.mockRestore();
  });
});
