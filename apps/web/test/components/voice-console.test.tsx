import { scenarios } from '@agent-voice/protocol/fixtures';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { VoiceConsole } from '@/app/components/voice-console';
import {
  addGroup,
  emptyLibrary,
  readLibrary,
  upsertConversation,
  writeLibrary,
} from '@/lib/client/session-library';
import type { Transport, TransportCallbacks, TransportFactory } from '@/lib/client/transport';
import { TransportError } from '@/lib/client/transport';

interface FakeTransport extends Transport {
  callbacks: TransportCallbacks;
  commands: unknown[];
  mic: boolean[];
  disconnects: number;
}

/** Every transport lifecycle call in the order it actually happened. */
type TransportLog = string[];

function fakeFactory(
  behaviour: {
    connect?: (signal: AbortSignal) => Promise<void>;
    setMicrophoneEnabled?: (enabled: boolean, callbacks: TransportCallbacks) => Promise<void>;
  } = {},
): {
  factory: TransportFactory;
  created: FakeTransport[];
  log: TransportLog;
} {
  const created: FakeTransport[] = [];
  const log: TransportLog = [];
  const factory: TransportFactory = (callbacks) => {
    const transport: FakeTransport = {
      callbacks,
      commands: [],
      mic: [],
      disconnects: 0,
      async connect(_mode, signal) {
        log.push('connect');
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
      sendText: () => Promise.resolve(),
      setMicrophoneEnabled(enabled) {
        transport.mic.push(enabled);
        log.push(`mic:${String(enabled)}`);
        if (behaviour.setMicrophoneEnabled) {
          return behaviour.setMicrophoneEnabled(enabled, callbacks);
        }
        callbacks.onMic(enabled);
        return Promise.resolve();
      },
      resumeAudio: () => Promise.resolve(),
      disconnect() {
        transport.disconnects += 1;
        log.push('disconnect');
        callbacks.onDisconnected('user');
        return Promise.resolve();
      },
    };
    created.push(transport);
    return transport;
  };
  return { factory, created, log };
}

/** Puts one saved conversation on this "device" before the console mounts. */
function seedLibrary(id: string, text: string): void {
  writeLibrary(
    upsertConversation(emptyLibrary(), {
      id,
      transcript: [
        { id: `user:${id}`, role: 'user', text, final: true, ts: '2026-02-01T00:00:00.000Z' },
      ],
      now: '2026-02-01T00:00:00.000Z',
    }),
    window.localStorage,
  );
}

/** Puts an empty group on this "device", as the drawer's new-group form would. */
function seedGroup(id: string, name: string): void {
  writeLibrary(
    addGroup(readLibrary(window.localStorage), { id, name, now: '2026-02-01T00:00:00.000Z' }),
    window.localStorage,
  );
}

async function openTextMode(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /start voice/i }));
  await user.click(await screen.findByRole('button', { name: /show text chat/i }));
}

describe('VoiceConsole', () => {
  it('never touches the transport until the user explicitly starts a session', () => {
    const { factory, created } = fakeFactory();
    render(<VoiceConsole createTransport={factory} />);
    expect(screen.getByRole('button', { name: /start voice/i })).toBeInTheDocument();
    expect(created).toHaveLength(0);
  });

  it('starts a live session on click and shows an honest listening status', async () => {
    const { factory } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/listening/i);
    });
  });

  it('shows the configuration-required state instead of the live console when the server is not configured', async () => {
    const { factory } = fakeFactory({
      connect: () =>
        Promise.reject(
          new TransportError('not_configured', 'not configured', { missing: ['LIVEKIT_URL'] }),
        ),
    });
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => {
      expect(screen.getByText('LIVEKIT_URL')).toBeInTheDocument();
    });
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
  });

  it('renders an approval card bound to the exact ids and sends the matching approve command', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));
    const transport = created[0]!;

    for (const event of scenarios.delegation.events.slice(0, 9)) transport.callbacks.onEvent(event);

    const card = await screen.findByRole('alert');
    expect(card).toHaveAttribute('data-action-id', 'act_d_1');
    expect(card).toHaveAttribute('data-approval-id', 'apr_d_1');

    await user.click(within(card).getByRole('button', { name: /approve/i }));
    await waitFor(() => {
      expect(transport.commands).toContainEqual(
        expect.objectContaining({
          type: 'approval.respond',
          actionId: 'act_d_1',
          approvalId: 'apr_d_1',
          decision: 'approved',
        }),
      );
    });
  });

  it('mutes and unmutes the microphone through the control bar', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    const muteButton = await screen.findByRole('button', { name: /mute/i });
    await user.click(muteButton);
    expect(await screen.findByRole('button', { name: /unmute/i })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/muted/i);
    expect(screen.getByRole('status')).not.toHaveTextContent(/listening/i);
    expect(container.querySelector('[data-orb-state]')).toHaveAttribute(
      'data-orb-state',
      'breathing',
    );

    created[0]!.callbacks.onActivity('speaking');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/speaking/i));
    expect(screen.getByText(/mic off/i)).toBeInTheDocument();
  });

  it('settles a finished session into its saved transcript, then offers a new conversation', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));

    created[0]!.callbacks.onMicError('Microphone permission was not granted. You can keep typing.');
    await user.click(screen.getByRole('button', { name: /show text chat/i }));
    await user.type(
      await screen.findByRole('textbox', { name: /message/i }),
      'Book a table{Enter}',
    );

    created[0]!.callbacks.onDisconnected('user');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/saved/i);
    });

    expect(screen.getByText('Book a table')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /message/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/microphone permission was not granted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/say something, or type below/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^new conversation$/i }));
    await waitFor(() => expect(created).toHaveLength(2));
  });

  it('sends typed text once connected and keeps it in the text view', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));
    const input = await screen.findByRole('textbox', { name: /message/i });
    await user.type(input, 'hello{Enter}');
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /conversation/i })).not.toBeInTheDocument();
  });

  it('uses one text composer row and keeps the conversation actions in the compact bar', async () => {
    const { factory } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await user.click(await screen.findByRole('button', { name: /show text chat/i }));

    const composer = container.querySelector('.text-composer');
    const bar = container.querySelector('.conversation-bar');
    expect(composer).toContainElement(screen.getByRole('button', { name: /hold to talk/i }));
    expect(composer).toContainElement(screen.getByRole('button', { name: /enter voice mode/i }));
    expect(bar).toContainElement(screen.getByRole('button', { name: /^new conversation$/i }));
    expect(
      screen.queryByRole('button', { name: /end conversation|end voice/i }),
    ).not.toBeInTheDocument();
    expect(container.querySelector('.dock > .control-bar')).not.toBeInTheDocument();
    expect(screen.getByText('Type a message or hold the mic to talk.')).toHaveClass('sr-only');
  });

  it('moves from voice to text and pauses the microphone when the composer is tapped', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));

    const input = await screen.findByRole('textbox', { name: /message/i });
    await user.click(input);

    expect(container.querySelector('main')).toHaveAttribute('data-view', 'text');
    expect(input).toHaveFocus();
    expect(created).toHaveLength(1);
    expect(created[0]?.mic).toContain(false);
    expect(screen.getByRole('status')).toHaveTextContent(/ready/i);
    expect(screen.getByRole('status')).not.toHaveTextContent(/listening/i);
  });

  it('does not change modes when keyboard navigation only focuses the composer', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));

    await user.tab();
    expect(screen.getByRole('button', { name: /show text chat/i })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: /^new conversation$/i })).toHaveFocus();
    await user.tab();

    expect(screen.getByRole('textbox', { name: /message/i })).toHaveFocus();
    expect(container.querySelector('main')).toHaveAttribute('data-view', 'voice');
    expect(created[0]?.mic).not.toContain(false);
  });

  it('focuses the composer and pauses the mic when Show text chat is activated', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));

    const input = screen.getByRole('textbox', { name: /message/i });
    await user.click(screen.getByRole('button', { name: /show text chat/i }));

    expect(container.querySelector('main')).toHaveAttribute('data-view', 'text');
    expect(input).toHaveFocus();
    expect(created).toHaveLength(1);
    expect(created[0]?.mic).toContain(false);
  });

  it('uses a compact header transcript action without repeating live branding', async () => {
    const { factory } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/listening/i));

    const header = container.querySelector('.stage__header');
    expect(header).toContainElement(screen.getByRole('button', { name: /show text chat/i }));
    expect(header).toContainElement(screen.getByRole('button', { name: /^new conversation$/i }));
    expect(header).not.toHaveTextContent(/agent voice|live/i);
    expect(screen.queryByRole('button', { name: /^text$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mute/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close voice mode/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /end voice/i })).not.toBeInTheDocument();
  });

  it('shows the microphone transition while an explicit text-mode switch is pending', async () => {
    let finishDisablingMicrophone: (() => void) | undefined;
    const { factory, created } = fakeFactory({
      setMicrophoneEnabled(enabled, callbacks) {
        if (enabled) {
          callbacks.onMic(true);
          return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
          finishDisablingMicrophone = () => {
            callbacks.onMic(false);
            resolve();
          };
        });
      },
    });
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await user.click(await screen.findByRole('button', { name: /show text chat/i }));

    expect(screen.getByRole('status')).toHaveTextContent(/switching to text/i);
    expect(screen.getByRole('status')).toHaveTextContent(/pausing the microphone/i);
    expect(created[0]?.mic).toContain(false);

    finishDisablingMicrophone?.();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Ready/i));
  });

  it('shows the orb before a session starts and moves it to the live status once connected', async () => {
    const { factory } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);
    expect(container.querySelector('[data-orb-state]')).toHaveAttribute(
      'data-orb-state',
      'breathing',
    );

    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => {
      expect(container.querySelector('[data-orb-state]')).toHaveAttribute(
        'data-orb-state',
        'listening',
      );
    });
  });

  it('moves from the voice orb to the transcript when the user starts typing', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));

    expect(container.querySelector('[data-orb-state]')).toHaveAttribute('data-scale', 'hero');
    expect(screen.queryByRole('log')).not.toBeInTheDocument();

    await user.type(await screen.findByRole('textbox', { name: /message/i }), 'hello{Enter}');
    expect(container.querySelector('[data-orb-state]')).not.toBeInTheDocument();
    expect(await screen.findByRole('log')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('anchors one subtle announced status to the orb instead of rendering a second visual hero', async () => {
    const { factory } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/listening/i));

    const telemetry = container.querySelector('.orb-stage__telemetry');
    expect(telemetry).toContainElement(screen.getByRole('status'));
    expect(screen.getByRole('status')).toHaveAttribute('data-variant', 'orb');
    expect(screen.getByText('The agent is listening for you.')).toHaveClass('sr-only');
  });

  it('keeps exactly one announced status region while live, so the orb never doubles it', async () => {
    const { factory } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/listening/i);
    });
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('keeps the visible session error outside the sole announced status region', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));

    created[0]!.callbacks.onFailure({ code: 'network', message: 'Connection interrupted.' });

    await waitFor(() => expect(screen.getByText('Connection interrupted.')).toBeVisible());
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('switches between immersive voice and transcript-first text without replacing the session', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);

    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));
    await user.type(await screen.findByRole('textbox', { name: /message/i }), 'keep this{Enter}');

    expect(container.querySelector('main')).toHaveAttribute('data-view', 'text');
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /conversation/i })).not.toBeInTheDocument();
    expect(screen.getByText('keep this')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /message/i })).toHaveFocus();
    expect(created).toHaveLength(1);
    expect(created[0]?.mic).toContain(false);
    created[0]!.callbacks.onMicError('Microphone permission was not granted.');
    expect(screen.getByRole('status')).not.toHaveTextContent(/permission was not granted/i);

    await user.click(screen.getByRole('button', { name: /enter voice mode/i }));
    expect(container.querySelector('main')).toHaveAttribute('data-view', 'voice');
    expect(container.querySelector('[data-orb-state]')).toBeInTheDocument();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    expect(created).toHaveLength(1);
    expect(created[0]?.mic).toContain(true);

    await user.click(screen.getByRole('button', { name: /show text chat/i }));
    expect(screen.getByText('keep this')).toBeInTheDocument();
    expect(created).toHaveLength(1);
  });

  it('keeps connection truth in the single dynamic status instead of a duplicate live badge', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/listening/i);
    expect(screen.queryByText('Live')).not.toBeInTheDocument();

    await user.type(await screen.findByRole('textbox', { name: /message/i }), 'hello{Enter}');
    created[0]!.callbacks.onDisconnected('user');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/saved/i);
    });
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  it('replaces the text-mode heading block with one compact app bar', async () => {
    const { factory } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await user.click(await screen.findByRole('button', { name: /show text chat/i }));

    expect(container.querySelector('.stage__text-heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /conversation/i })).not.toBeInTheDocument();

    const bar = container.querySelector('.conversation-bar');
    expect(bar).toBeInTheDocument();
    expect(bar).toContainElement(screen.getByRole('button', { name: /sessions/i }));
    expect(bar).toContainElement(screen.getByRole('status'));
    expect(bar).toContainElement(screen.getByRole('button', { name: /^new conversation$/i }));
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('keeps the ended text state compact, with New conversation in the bar', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await user.click(await screen.findByRole('button', { name: /show text chat/i }));
    await user.type(
      await screen.findByRole('textbox', { name: /message/i }),
      'Book a table{Enter}',
    );
    created[0]!.callbacks.onDisconnected('user');

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved/i));
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(container.querySelector('.conversation-bar')).toContainElement(
      screen.getByRole('button', { name: /^new conversation$/i }),
    );
    expect(screen.getAllByRole('button', { name: /^new conversation$/i })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^end conversation$/i })).not.toBeInTheDocument();
  });

  it('offers a new conversation instead of ending one in the connected text header', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);
    await openTextMode(user);
    await waitFor(() => expect(created).toHaveLength(1));

    const bar = container.querySelector('.conversation-bar');
    expect(screen.queryByRole('button', { name: /end conversation/i })).not.toBeInTheDocument();
    expect(bar).toContainElement(screen.getByRole('button', { name: /^new conversation$/i }));
    expect(bar).toContainElement(screen.getByRole('button', { name: /sessions/i }));
    expect(screen.getAllByRole('status')).toHaveLength(1);

    // The overflow is only offered once there is a conversation to act on.
    expect(
      screen.queryByRole('button', { name: /current conversation options/i }),
    ).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /message/i }), 'Book a table{Enter}');
    expect(bar).toContainElement(
      await screen.findByRole('button', { name: /current conversation options/i }),
    );
  });

  it('returns from voice to the same conversation without disconnecting the room', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));

    await user.type(await screen.findByRole('textbox', { name: /message/i }), 'keep this{Enter}');
    await user.click(screen.getByRole('button', { name: /enter voice mode/i }));
    expect(container.querySelector('main')).toHaveAttribute('data-view', 'voice');
    created[0]!.mic.length = 0;

    await user.click(screen.getByRole('button', { name: /close voice mode/i }));

    expect(container.querySelector('main')).toHaveAttribute('data-view', 'text');
    expect(screen.getByText('keep this')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /message/i })).toHaveFocus();
    // Same room, same session: only the microphone was asked to stand down.
    expect(created).toHaveLength(1);
    expect(created[0]?.disconnects).toBe(0);
    expect(created[0]?.mic).toEqual([false]);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('starts a fresh text session from the voice header, releasing the room first', async () => {
    const { factory, created, log } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));

    const header = container.querySelector('.stage__header');
    await user.click(
      within(header as HTMLElement).getByRole('button', { name: /^new conversation$/i }),
    );

    await waitFor(() => expect(created).toHaveLength(2));
    expect(log).toEqual(['connect', 'disconnect', 'connect']);
    expect(created[0]?.disconnects).toBe(1);
    expect(container.querySelector('main')).toHaveAttribute('data-view', 'text');
    expect(await screen.findByRole('textbox', { name: /message/i })).toBeInTheDocument();
  });

  it('resolves an ended voice session with history into the saved text transcript', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));
    await user.type(
      await screen.findByRole('textbox', { name: /message/i }),
      'Book a table{Enter}',
    );
    await user.click(screen.getByRole('button', { name: /enter voice mode/i }));
    expect(container.querySelector('main')).toHaveAttribute('data-view', 'voice');

    created[0]!.callbacks.onDisconnected('agent');

    await waitFor(() =>
      expect(container.querySelector('main')).toHaveAttribute('data-view', 'text'),
    );
    expect(screen.getByText('Book a table')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/saved/i);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(container.querySelector('[data-orb-state]')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /message/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /hold to talk/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mute|unmute/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^new conversation$/i })).toBeInTheDocument();
  });

  it('hides live action controls when an in-flight action becomes part of a saved conversation', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));

    for (const event of scenarios.delegation.events.slice(0, 6))
      created[0]!.callbacks.onEvent(event);
    await user.click(screen.getByRole('button', { name: /show text chat/i }));
    expect(await screen.findByRole('list', { name: /action timeline/i })).toBeInTheDocument();

    created[0]!.callbacks.onDisconnected('agent');

    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i);
    expect(screen.queryByRole('list', { name: /action timeline/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });

  it('returns to the start screen when a session ends with nothing in it', async () => {
    const { factory, created, log } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));

    created[0]!.callbacks.onDisconnected('agent');

    const startAgain = await screen.findByRole('button', { name: /start voice/i });
    expect(container.querySelector('.stage--start')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /message/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^new conversation$/i })).not.toBeInTheDocument();

    // Restarting from here still goes through the safe reset ordering.
    await user.click(startAgain);
    await waitFor(() => expect(created).toHaveLength(2));
    expect(log).toEqual(['connect', 'connect']);
    expect(container.querySelector('main')).toHaveAttribute('data-view', 'voice');
  });

  it('persists a rename and a pin from the header menu, through later transcript turns', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));
    const input = await screen.findByRole('textbox', { name: /message/i });
    await user.type(input, 'Book a table{Enter}');
    await waitFor(() => expect(readLibrary(window.localStorage).conversations).toHaveLength(1));

    const options = await screen.findByRole('button', { name: /current conversation options/i });
    await user.click(options);
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const field = screen.getByRole('textbox', { name: /rename conversation/i });
    await user.clear(field);
    await user.type(field, 'Dinner plans');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(readLibrary(window.localStorage).conversations[0]?.title).toBe('Dinner plans'),
    );

    await user.click(options);
    await user.click(screen.getByRole('menuitem', { name: 'Pin' }));
    await waitFor(() =>
      expect(readLibrary(window.localStorage).conversations[0]?.pinned).toBe(true),
    );

    // The archiver merges into storage, so a later turn cannot undo either edit.
    await user.type(input, 'second{Enter}');
    await waitFor(() => expect(screen.getByText('second')).toBeInTheDocument());
    const saved = readLibrary(window.localStorage).conversations;
    expect(saved).toHaveLength(1);
    expect(saved[0]?.title).toBe('Dinner plans');
    expect(saved[0]?.pinned).toBe(true);

    // The drawer reads the same record, not a stale copy.
    await user.click(screen.getByRole('button', { name: /sessions/i }));
    expect(await screen.findByRole('button', { name: 'Dinner plans' })).toBeInTheDocument();
  });

  it('files the current conversation into an existing group from the header menu', async () => {
    seedGroup('grp_1', 'Travel');
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));
    const input = await screen.findByRole('textbox', { name: /message/i });
    await user.type(input, 'Book a table{Enter}');
    await waitFor(() => expect(readLibrary(window.localStorage).conversations).toHaveLength(1));

    const options = await screen.findByRole('button', { name: /current conversation options/i });
    await user.click(options);
    await user.click(screen.getByRole('menuitem', { name: 'Move to Travel' }));
    await waitFor(() =>
      expect(readLibrary(window.localStorage).conversations[0]?.groupId).toBe('grp_1'),
    );

    // Already filed there, so the move is no longer offered.
    await user.click(options);
    expect(screen.queryByRole('menuitem', { name: /move to travel/i })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.type(input, 'second{Enter}');
    await waitFor(() => expect(screen.getByText('second')).toBeInTheDocument());
    expect(readLibrary(window.localStorage).conversations[0]?.groupId).toBe('grp_1');
  });

  it('opens the session drawer from the bar and closes it back onto its opener', async () => {
    const { factory } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);
    await openTextMode(user);

    const sessions = screen.getByRole('button', { name: /sessions/i });
    await user.click(sessions);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(container.querySelector('main')).toHaveAttribute('inert');
    expect(sessions).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(container.querySelector('main')).not.toHaveAttribute('inert');
    await waitFor(() => expect(sessions).toHaveFocus());
  });

  it('keeps the live conversation in the device library as it grows', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));
    await user.type(
      await screen.findByRole('textbox', { name: /message/i }),
      'Book a table{Enter}',
    );

    await waitFor(() => {
      expect(readLibrary(window.localStorage).conversations).toHaveLength(1);
    });
    expect(readLibrary(window.localStorage).conversations[0]?.title).toBe('Book a table');

    await user.click(screen.getByRole('button', { name: /sessions/i }));
    expect(await screen.findByRole('button', { name: 'Book a table' })).toBeInTheDocument();
  });

  it('archives one record per session even after the transport binds a room id', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));

    const input = await screen.findByRole('textbox', { name: /message/i });
    await user.type(input, 'first{Enter}');
    await waitFor(() => expect(readLibrary(window.localStorage).conversations).toHaveLength(1));

    // The room id only arrives with the first event; it must not fork a record.
    for (const event of scenarios.delegation.events.slice(0, 3))
      created[0]!.callbacks.onEvent(event);
    await user.type(input, 'second{Enter}');

    await waitFor(() => expect(screen.getByText('second')).toBeInTheDocument());
    expect(readLibrary(window.localStorage).conversations).toHaveLength(1);
  });

  it('ends the live session and its microphone before showing a saved conversation', async () => {
    seedLibrary('saved_1', 'Yesterday plan');
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await openTextMode(user);
    await waitFor(() => expect(created).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: /sessions/i }));
    await user.click(await screen.findByRole('button', { name: 'Yesterday plan' }));

    await waitFor(() => expect(screen.getByText('Yesterday plan')).toBeInTheDocument());
    expect(created[0]?.disconnects).toBeGreaterThan(0);
    expect(created[0]?.mic.at(-1)).toBe(false);
    expect(created).toHaveLength(1);

    expect(screen.getByRole('status')).toHaveTextContent(/saved/i);
    expect(screen.queryByRole('textbox', { name: /message/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /hold to talk/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^end conversation$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('starts a fresh text session from the drawer and leaves the archive behind', async () => {
    seedLibrary('saved_1', 'Yesterday plan');
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);
    await openTextMode(user);
    await waitFor(() => expect(created).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: /sessions/i }));
    await user.click(await screen.findByRole('button', { name: 'Yesterday plan' }));
    await waitFor(() => expect(screen.getByText('Yesterday plan')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /sessions/i }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: /new conversation/i }),
    );

    await waitFor(() => expect(created).toHaveLength(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Yesterday plan')).not.toBeInTheDocument();
    expect(container.querySelector('main')).toHaveAttribute('data-view', 'text');
    expect(await screen.findByRole('textbox', { name: /message/i })).toBeInTheDocument();
  });

  it('does not archive a session in which nothing was ever said', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await openTextMode(user);
    await waitFor(() => expect(created).toHaveLength(1));
    await user.click(await screen.findByRole('button', { name: /^new conversation$/i }));

    await waitFor(() => expect(created).toHaveLength(2));
    expect(created[0]?.disconnects).toBeGreaterThan(0);
    expect(readLibrary(window.localStorage).conversations).toEqual([]);
  });

  it('does not re-archive the finished conversation under the new session id', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));
    await user.type(
      await screen.findByRole('textbox', { name: /message/i }),
      'Book a table{Enter}',
    );
    await waitFor(() => expect(readLibrary(window.localStorage).conversations).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: /^new conversation$/i }));
    await waitFor(() => expect(created).toHaveLength(2));

    const saved = readLibrary(window.localStorage).conversations;
    expect(saved).toHaveLength(1);
    expect(saved[0]?.title).toBe('Book a table');
  });
});
