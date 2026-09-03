import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { StartScreen } from '@/app/components/start-screen';

describe('StartScreen', () => {
  it('does not start any session on render, only on explicit user action', () => {
    const onStart = vi.fn();
    render(<StartScreen onStart={onStart} missingConfig={[]} />);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('starts a voice session only after the user clicks Start voice', async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<StartScreen onStart={onStart} missingConfig={[]} />);
    expect(onStart).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /start voice/i }));
    expect(onStart).toHaveBeenCalledWith('voice');
  });

  it('offers a text fallback that never requests the microphone', async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<StartScreen onStart={onStart} missingConfig={[]} />);
    await user.click(screen.getByRole('button', { name: /start.*text|type instead/i }));
    expect(onStart).toHaveBeenCalledWith('text');
  });

  it('is keyboard operable: Enter activates the focused start button', async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<StartScreen onStart={onStart} missingConfig={[]} />);
    await user.tab();
    expect(screen.getByRole('button', { name: /start voice/i })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onStart).toHaveBeenCalledWith('voice');
  });

  it('shows an honest configuration-required state naming only missing variables, no values', () => {
    render(<StartScreen onStart={vi.fn()} missingConfig={['LIVEKIT_URL', 'LIVEKIT_API_KEY']} />);
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
    expect(screen.getByText(/LIVEKIT_URL/)).toBeInTheDocument();
    expect(screen.getByText(/LIVEKIT_API_KEY/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start voice/i })).not.toBeInTheDocument();
  });

  it('leads with the resting orb so the start screen is the same surface as the session', () => {
    const { container } = render(<StartScreen onStart={vi.fn()} missingConfig={[]} />);
    expect(container.querySelector('[data-orb-state]')).toHaveAttribute(
      'data-orb-state',
      'breathing',
    );
  });

  it('keeps the orb present but visibly unsettled when the deployment is unconfigured', () => {
    const { container } = render(<StartScreen onStart={vi.fn()} missingConfig={['LIVEKIT_URL']} />);
    expect(container.querySelector('[data-orb-state]')).toHaveAttribute(
      'data-orb-state',
      'shaping',
    );
  });

  it('offers voice first and text second in DOM order, so tab order matches the hierarchy', () => {
    render(<StartScreen onStart={vi.fn()} missingConfig={[]} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleName(/start voice/i);
    expect(buttons[1]).toHaveAccessibleName(/type instead/i);
  });
});
