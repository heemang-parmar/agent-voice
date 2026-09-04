import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VoiceConsole } from '@/app/components/voice-console';
import type { Transport, TransportCallbacks, TransportFactory } from '@/lib/client/transport';

interface PendingMicChange {
  enabled: boolean;
  finish(): void;
}

interface FakeTransport extends Transport {
  callbacks: TransportCallbacks;
  mic: boolean[];
  pending: PendingMicChange[];
  disconnects: number;
}

function fakeFactory({ deferred = false }: { deferred?: boolean } = {}): {
  factory: TransportFactory;
  created: FakeTransport[];
} {
  const created: FakeTransport[] = [];
  const factory: TransportFactory = (callbacks) => {
    const transport: FakeTransport = {
      callbacks,
      mic: [],
      pending: [],
      disconnects: 0,
      async connect() {
        callbacks.onConnected();
        callbacks.onAgentPresence(true);
        callbacks.onActivity('listening');
      },
      sendCommand: () => Promise.resolve(),
      sendText: () => Promise.resolve(),
      setMicrophoneEnabled(enabled) {
        transport.mic.push(enabled);
        if (!deferred) {
          callbacks.onMic(enabled);
          return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
          transport.pending.push({
            enabled,
            finish() {
              callbacks.onMic(enabled);
              resolve();
            },
          });
        });
      },
      resumeAudio: () => Promise.resolve(),
      async disconnect() {
        transport.disconnects += 1;
        callbacks.onDisconnected('user');
      },
    };
    created.push(transport);
    return transport;
  };
  return { factory, created };
}

async function startInText(factory: TransportFactory, deferred = false) {
  const user = userEvent.setup();
  const rendered = render(<VoiceConsole createTransport={factory} />);
  await user.click(screen.getByRole('button', { name: /start voice/i }));
  const input = await screen.findByRole('textbox', { name: /message/i });
  await user.click(input);
  const button = await screen.findByRole('button', { name: /hold to talk/i });
  if (deferred) {
    // The first deferred operation is the existing voice → text microphone pause.
    const transport = (rendered.container as unknown as { __transport?: FakeTransport })
      .__transport;
    void transport;
  }
  return { user, input, button, ...rendered };
}

async function finish(change: PendingMicChange): Promise<void> {
  await act(async () => change.finish());
}

describe('text-mode push to talk', () => {
  afterEach(() => vi.useRealTimers());

  it('holds the existing microphone in one text session and releases it', async () => {
    const { factory, created } = fakeFactory();
    const { button, container } = await startInText(factory);
    const transport = created[0]!;
    transport.mic.length = 0;

    fireEvent.pointerDown(button, {
      pointerId: 1,
      pointerType: 'touch',
      button: 0,
      isPrimary: true,
    });
    await waitFor(() => expect(transport.mic).toEqual([true]));
    expect(container.querySelector('main')).toHaveAttribute('data-view', 'text');
    expect(screen.getByRole('status')).toHaveTextContent(/listening/i);
    expect(screen.getByRole('button', { name: /listening.*release to send/i })).toBe(button);

    fireEvent.pointerUp(button, { pointerId: 1, pointerType: 'touch', button: 0, isPrimary: true });
    await waitFor(() => expect(transport.mic).toEqual([true, false]));
    expect(screen.getByRole('status')).toHaveTextContent(/^ready/i);
    expect(created).toHaveLength(1);
  });

  it('serializes release behind a pending enable so a late enable cannot leave the mic on', async () => {
    const { factory, created } = fakeFactory({ deferred: true });
    const { button } = await startInText(factory, true);
    const transport = created[0]!;

    expect(transport.pending).toHaveLength(1);
    expect(transport.pending[0]!.enabled).toBe(false);
    await finish(transport.pending.shift()!);
    await screen.findByRole('button', { name: /hold to talk/i });
    transport.mic.length = 0;

    fireEvent.pointerDown(button, {
      pointerId: 2,
      pointerType: 'touch',
      button: 0,
      isPrimary: true,
    });
    await waitFor(() => expect(transport.pending).toHaveLength(1));
    expect(transport.pending[0]!.enabled).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent(/starting microphone/i);

    fireEvent.pointerUp(button, { pointerId: 2, pointerType: 'touch', button: 0, isPrimary: true });
    expect(screen.getByRole('status')).toHaveTextContent(/finishing voice input/i);
    expect(transport.mic).toEqual([true]);

    await finish(transport.pending.shift()!);
    await waitFor(() => expect(transport.pending).toHaveLength(1));
    expect(transport.pending[0]!.enabled).toBe(false);
    await finish(transport.pending.shift()!);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^ready/i));
    expect(transport.mic).toEqual([true, false]);
    expect(transport.callbacks).toBeDefined();
  });

  it('escapes a browser microphone enable that never settles and corrects it if it resolves late', async () => {
    const { factory, created } = fakeFactory({ deferred: true });
    const { button } = await startInText(factory, true);
    const transport = created[0]!;

    await finish(transport.pending.shift()!);
    await screen.findByRole('button', { name: /hold to talk/i });
    transport.mic.length = 0;
    vi.useFakeTimers();

    fireEvent.pointerDown(button, {
      pointerId: 22,
      pointerType: 'touch',
      button: 0,
      isPrimary: true,
    });
    await act(async () => Promise.resolve());
    const lateEnable = transport.pending.shift()!;
    expect(lateEnable.enabled).toBe(true);
    fireEvent.pointerUp(button, {
      pointerId: 22,
      pointerType: 'touch',
      button: 0,
      isPrimary: true,
    });

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(transport.pending[0]!.enabled).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('status')).toHaveTextContent(/^ready/i);

    await finish(lateEnable);
    await act(async () => Promise.resolve());
    expect(transport.pending.every((change) => !change.enabled)).toBe(true);
    for (const pending of transport.pending.splice(0)) await finish(pending);
    expect(transport.mic.at(-1)).toBe(false);
  });

  it('releases on pointer cancellation and lost pointer capture', async () => {
    const { factory, created } = fakeFactory();
    const { button } = await startInText(factory);
    const transport = created[0]!;
    transport.mic.length = 0;

    fireEvent.pointerDown(button, { pointerId: 3, button: 0, isPrimary: true });
    fireEvent.pointerCancel(button, { pointerId: 3, isPrimary: true });
    await waitFor(() => expect(transport.mic).toEqual([true, false]));

    fireEvent.pointerDown(button, { pointerId: 4, button: 0, isPrimary: true });
    fireEvent.lostPointerCapture(button, { pointerId: 4, isPrimary: true });
    await waitFor(() => expect(transport.mic).toEqual([true, false, true, false]));
  });

  it('uses Option+Space away from editable controls and releases even after Alt is lifted', async () => {
    const { factory, created } = fakeFactory();
    const { input } = await startInText(factory);
    const transport = created[0]!;
    transport.mic.length = 0;

    input.focus();
    fireEvent.keyDown(input, { code: 'Space', key: ' ', altKey: true });
    fireEvent.keyUp(input, { code: 'Space', key: ' ', altKey: false });
    expect(transport.mic).toEqual([]);

    input.blur();
    fireEvent.keyDown(window, { code: 'Space', key: ' ', altKey: true });
    await waitFor(() => expect(transport.mic).toEqual([true]));
    fireEvent.keyDown(window, { code: 'Space', key: ' ', altKey: true, repeat: true });
    expect(transport.mic).toEqual([true]);
    fireEvent.keyUp(window, { code: 'Space', key: ' ', altKey: false });
    await waitFor(() => expect(transport.mic).toEqual([true, false]));
  });

  it('supports keyboard press-and-hold on the focused microphone button', async () => {
    const { factory, created } = fakeFactory();
    const { button } = await startInText(factory);
    const transport = created[0]!;
    transport.mic.length = 0;

    button.focus();
    fireEvent.keyDown(button, { code: 'Space', key: ' ' });
    await waitFor(() => expect(transport.mic).toEqual([true]));
    fireEvent.keyDown(button, { code: 'Space', key: ' ', repeat: true });
    expect(transport.mic).toEqual([true]);
    fireEvent.keyUp(button, { code: 'Space', key: ' ' });
    await waitFor(() => expect(transport.mic).toEqual([true, false]));
  });

  it('releases on window blur and visibility loss', async () => {
    const { factory, created } = fakeFactory();
    const { button } = await startInText(factory);
    const transport = created[0]!;
    transport.mic.length = 0;

    fireEvent.pointerDown(button, { pointerId: 5, button: 0, isPrimary: true });
    fireEvent.blur(window);
    await waitFor(() => expect(transport.mic).toEqual([true, false]));

    fireEvent.pointerDown(button, { pointerId: 6, button: 0, isPrimary: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(transport.mic).toEqual([true, false, true, false]));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  it('cleans up PTT before entering immersive voice and does not let a stale disable win', async () => {
    const { factory, created } = fakeFactory();
    const { button, user, container } = await startInText(factory);
    const transport = created[0]!;
    transport.mic.length = 0;

    fireEvent.pointerDown(button, { pointerId: 7, button: 0, isPrimary: true });
    await user.click(screen.getByRole('button', { name: /enter voice mode/i }));

    await waitFor(() =>
      expect(container.querySelector('main')).toHaveAttribute('data-view', 'voice'),
    );
    await waitFor(() => expect(transport.mic.at(-1)).toBe(true));
    expect(transport.mic).toEqual([true, false, true]);
  });

  it('releases PTT before the new-conversation reset disconnects the old session', async () => {
    const { factory, created } = fakeFactory();
    const { button, user } = await startInText(factory);
    const transport = created[0]!;
    transport.mic.length = 0;

    fireEvent.pointerDown(button, { pointerId: 8, button: 0, isPrimary: true });
    await user.click(screen.getByRole('button', { name: /^new conversation$/i }));

    await waitFor(() => expect(transport.mic).toEqual([true, false]));
    expect(transport.disconnects).toBe(1);
    await waitFor(() => expect(created).toHaveLength(2));
  });
});
