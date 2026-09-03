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
        viewMode="voice"
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
        viewMode="voice"
      />,
    );
    await user.click(screen.getByRole('button', { name: /unmute/i }));
    expect(onToggleMic).toHaveBeenCalledWith(true);
  });

  it('ends the session on End voice click', async () => {
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
        viewMode="voice"
      />,
    );
    await user.click(screen.getByRole('button', { name: /^end voice$/i }));
    expect(onEnd).toHaveBeenCalled();
  });

  it('offers Retry only after an error, not while live or after a normal end', async () => {
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
        viewMode="voice"
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
        viewMode="voice"
      />,
    );
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();

    rerender(
      <ControlBar
        micEnabled={false}
        audioBlocked={false}
        status="ended"
        onToggleMic={vi.fn()}
        onEnd={vi.fn()}
        onRetry={onRetry}
        onResumeAudio={vi.fn()}
        viewMode="text"
      />,
    );
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new conversation/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^end voice$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /unmute|mute/i })).not.toBeInTheDocument();
  });

  it('surfaces a resumable audio-blocked banner from a user gesture', async () => {
    const onResumeAudio = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <ControlBar
        micEnabled
        audioBlocked
        status="speaking"
        onToggleMic={vi.fn()}
        onEnd={vi.fn()}
        onRetry={vi.fn()}
        onResumeAudio={onResumeAudio}
        viewMode="voice"
      />,
    );
    expect(container.firstElementChild).toHaveClass('control-bar--audio-blocked');
    await user.click(
      screen.getByRole('button', { name: /enable audio|resume audio|tap to hear/i }),
    );
    expect(onResumeAudio).toHaveBeenCalled();
  });

  it('labels its icon-only controls and reflects the muted state with aria-pressed', () => {
    const { rerender } = render(
      <ControlBar
        micEnabled
        audioBlocked={false}
        status="listening"
        onToggleMic={vi.fn()}
        onEnd={vi.fn()}
        onRetry={vi.fn()}
        onResumeAudio={vi.fn()}
        viewMode="voice"
      />,
    );
    expect(screen.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'End voice' })).toHaveAttribute(
      'title',
      'End voice session',
    );

    rerender(
      <ControlBar
        micEnabled={false}
        audioBlocked={false}
        status="listening"
        onToggleMic={vi.fn()}
        onEnd={vi.fn()}
        onRetry={vi.fn()}
        onResumeAudio={vi.fn()}
        viewMode="voice"
      />,
    );
    expect(screen.getByRole('button', { name: 'Unmute' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps its decorative glyphs out of the accessibility tree', () => {
    const { container } = render(
      <ControlBar
        micEnabled
        audioBlocked={false}
        status="listening"
        onToggleMic={vi.fn()}
        onEnd={vi.fn()}
        onRetry={vi.fn()}
        onResumeAudio={vi.fn()}
        viewMode="voice"
      />,
    );
    const glyphs = container.querySelectorAll('svg');
    expect(glyphs.length).toBeGreaterThan(0);
    for (const glyph of glyphs) {
      expect(glyph).toHaveAttribute('aria-hidden', 'true');
    }
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
        viewMode="voice"
      />,
    );
    for (const button of screen.getAllByRole('button')) {
      expect(button.tagName).toBe('BUTTON');
    }
  });

  it('keeps the voice control row focused on microphone and ending the session', () => {
    render(
      <ControlBar
        micEnabled
        audioBlocked={false}
        status="listening"
        onToggleMic={vi.fn()}
        onEnd={vi.fn()}
        onRetry={vi.fn()}
        onResumeAudio={vi.fn()}
        viewMode="voice"
      />,
    );

    expect(screen.queryByRole('button', { name: /show text chat/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End voice' })).toBeInTheDocument();
  });
});
