import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ControlBar } from '@/app/components/control-bar';

describe('ControlBar', () => {
  it('shows Mute when the microphone is on and toggles it off on click', async () => {
    const onToggleMic = vi.fn();
    const user = userEvent.setup();
    render(
      <ControlBar
        micEnabled
        audioBlocked={false}
        status="listening"
        onToggleMic={onToggleMic}
        onEnd={vi.fn()}
        onRetry={vi.fn()}
        onResumeAudio={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: /mute/i });
    await user.click(button);
    expect(onToggleMic).toHaveBeenCalledWith(false);
  });

  it('shows Unmute when the microphone is off and toggles it on on click', async () => {
    const onToggleMic = vi.fn();
    const user = userEvent.setup();
    render(
      <ControlBar
        micEnabled={false}
        audioBlocked={false}
        status="listening"
        onToggleMic={onToggleMic}
        onEnd={vi.fn()}
        onRetry={vi.fn()}
        onResumeAudio={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /unmute/i }));
    expect(onToggleMic).toHaveBeenCalledWith(true);
  });

  it('ends the session on End click', async () => {
    const onEnd = vi.fn();
    const user = userEvent.setup();
    render(
      <ControlBar
        micEnabled
        audioBlocked={false}
        status="listening"
        onToggleMic={vi.fn()}
        onEnd={onEnd}
        onRetry={vi.fn()}
        onResumeAudio={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^end$/i }));
    expect(onEnd).toHaveBeenCalled();
  });

  it('offers Retry only after an error or when ended, not while live', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <ControlBar
        micEnabled
        audioBlocked={false}
        status="listening"
        onToggleMic={vi.fn()}
        onEnd={vi.fn()}
        onRetry={onRetry}
        onResumeAudio={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();

    rerender(
      <ControlBar
        micEnabled
        audioBlocked={false}
        status="error"
        onToggleMic={vi.fn()}
        onEnd={vi.fn()}
        onRetry={onRetry}
        onResumeAudio={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('surfaces a resumable audio-blocked banner from a user gesture', async () => {
    const onResumeAudio = vi.fn();
    const user = userEvent.setup();
    render(
      <ControlBar
        micEnabled
        audioBlocked
        status="speaking"
        onToggleMic={vi.fn()}
        onEnd={vi.fn()}
        onRetry={vi.fn()}
        onResumeAudio={onResumeAudio}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: /enable audio|resume audio|tap to hear/i }),
    );
    expect(onResumeAudio).toHaveBeenCalled();
  });

  it('every control is a real, keyboard-focusable button', () => {
    render(
      <ControlBar
        micEnabled
        audioBlocked={false}
        status="listening"
        onToggleMic={vi.fn()}
        onEnd={vi.fn()}
        onRetry={vi.fn()}
        onResumeAudio={vi.fn()}
      />,
    );
    for (const button of screen.getAllByRole('button')) {
      expect(button.tagName).toBe('BUTTON');
    }
  });
});
