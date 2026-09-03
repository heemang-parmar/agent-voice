import { scenarios } from '@agent-voice/protocol/fixtures';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { VoiceConsole } from '@/app/components/voice-console';
import type { Transport, TransportCallbacks, TransportFactory } from '@/lib/client/transport';
import { TransportError } from '@/lib/client/transport';

interface FakeTransport extends Transport {
  callbacks: TransportCallbacks;
  commands: unknown[];
  mic: boolean[];
  disconnects: number;
}

function fakeFactory(behaviour: { connect?: (signal: AbortSignal) => Promise<void> } = {}): {
  factory: TransportFactory;
  created: FakeTransport[];
} {
  const created: FakeTransport[] = [];
  const factory: TransportFactory = (callbacks) => {
    const transport: FakeTransport = {
      callbacks,
      commands: [],
      mic: [],
      disconnects: 0,
      async connect(_mode, signal) {
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
        callbacks.onMic(enabled);
        return Promise.resolve();
      },
      resumeAudio: () => Promise.resolve(),
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

  it('ends the session, then offers a new conversation instead of retry', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));

    created[0]!.callbacks.onMicError('Microphone permission was not granted. You can keep typing.');
    await user.click(screen.getByRole('button', { name: /show text chat/i }));

    await user.click(await screen.findByRole('button', { name: /^end$/i }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/ended/i);
    });

    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /message/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/microphone permission was not granted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/say something, or type below/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /new conversation/i }));
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
    await user.click(screen.getByRole('button', { name: /show text chat/i }));
    expect(screen.getByText('hello')).toBeInTheDocument();
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

  it('keeps the orb dominant and reveals accumulated turns only in text view', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    const { container } = render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));

    expect(container.querySelector('[data-orb-state]')).toHaveAttribute('data-scale', 'hero');
    expect(screen.queryByRole('log')).not.toBeInTheDocument();

    await user.type(await screen.findByRole('textbox', { name: /message/i }), 'hello{Enter}');
    expect(container.querySelector('[data-orb-state]')).toHaveAttribute('data-scale', 'hero');
    expect(screen.queryByRole('log')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show text chat/i }));
    expect(await screen.findByRole('log')).toBeInTheDocument();
    expect(container.querySelector('[data-orb-state]')).not.toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: /show text chat/i }));
    expect(container.querySelector('main')).toHaveAttribute('data-view', 'text');
    expect(
      screen.queryByRole('button', { name: /retry|new conversation/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /conversation/i })).toBeInTheDocument();
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

  it('marks the session live in the header only while it is actually connected', async () => {
    const { factory } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    expect(await screen.findByText('Live')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /^end$/i }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/ended/i);
    });
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });
});
