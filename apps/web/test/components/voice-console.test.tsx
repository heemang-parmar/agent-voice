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
    const { factory } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    const muteButton = await screen.findByRole('button', { name: /mute/i });
    await user.click(muteButton);
    expect(await screen.findByRole('button', { name: /unmute/i })).toBeInTheDocument();
  });

  it('ends the session, then lets the user retry to start a fresh one', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));

    await user.click(await screen.findByRole('button', { name: /^end$/i }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/ended/i);
    });

    await user.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(created).toHaveLength(2));
  });

  it('sends typed text once connected', async () => {
    const { factory, created } = fakeFactory();
    const user = userEvent.setup();
    render(<VoiceConsole createTransport={factory} />);
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(created).toHaveLength(1));
    const input = await screen.findByRole('textbox', { name: /message/i });
    await user.type(input, 'hello{Enter}');
    expect(screen.getByText('hello')).toBeInTheDocument();
  });
});
