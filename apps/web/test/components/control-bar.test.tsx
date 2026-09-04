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
        onReturnToChat={vi.fn()}
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
        onReturnToChat={vi.fn()}
        onRetry={vi.fn()}
        onResumeAudio={vi.fn()}
        viewMode="voice"
      />,
    );
    await user.click(screen.getByRole('button', { name: /unmute/i }));
    expect(onToggleMic).toHaveBeenCalledWith(true);
  });

  it('returns to the text view without ending the session or touching the microphone', async () => {
    const onReturnToChat = vi.fn();
    const onToggleMic = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <ControlBar
        micEnabled
        audioBlocked={false}
        status="listening"
        onToggleMic={onToggleMic}
        onReturnToChat={onReturnToChat}
        onRetry={vi.fn()}
        onResumeAudio={vi.fn()}
        viewMode="voice"
      />,
    );

    expect(screen.queryByRole('button', { name: /end voice/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /close voice mode/i }));
    expect(onReturnToChat).toHaveBeenCalledTimes(1);
    // Leaving the voice view is not a microphone command of its own: the
    // console sequences push-to-talk release and mic disable behind it.
    expect(onToggleMic).not.toHaveBeenCalled();
    expect(container.querySelector('.icon-button--danger')).not.toBeInTheDocument();
  });

  it('offers Retry only after an error, and renders nothing at all once ended', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <ControlBar
        micEnabled
        audioBlocked={false}
        status="listening"
        onToggleMic={vi.fn()}
        onReturnToChat={vi.fn()}
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
        onReturnToChat={vi.fn()}
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
        onReturnToChat={vi.fn()}
        onRetry={onRetry}
        onResumeAudio={vi.fn()}
        viewMode="text"
      />,
    );
    // A finished session never reaches the dock: the console shows the saved
    // transcript, or the start screen, and restarting is offered there.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
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
        onReturnToChat={vi.fn()}
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
        onReturnToChat={vi.fn()}
        onRetry={vi.fn()}
        onResumeAudio={vi.fn()}
        viewMode="voice"
      />,
    );
    expect(screen.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Close voice mode' })).toHaveAttribute(
      'title',
      'Close voice mode and return to text',
    );

    rerender(
      <ControlBar
        micEnabled={false}
        audioBlocked={false}
        status="listening"
        onToggleMic={vi.fn()}
        onReturnToChat={vi.fn()}
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
        onReturnToChat={vi.fn()}
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
        onReturnToChat={vi.fn()}
        onRetry={vi.fn()}
        onResumeAudio={vi.fn()}
        viewMode="voice"
      />,
    );
    for (const button of screen.getAllByRole('button')) {
      expect(button.tagName).toBe('BUTTON');
    }
  });

  it('keeps the voice control row focused on the microphone and the way back to text', () => {
    render(
      <ControlBar
        micEnabled
        audioBlocked={false}
        status="listening"
        onToggleMic={vi.fn()}
        onReturnToChat={vi.fn()}
        onRetry={vi.fn()}
        onResumeAudio={vi.fn()}
        viewMode="voice"
      />,
    );

    expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument();
    const closeVoice = screen.getByRole('button', { name: 'Close voice mode' });
    expect(closeVoice).toHaveClass('icon-button');
    expect(closeVoice).toHaveTextContent('');
    expect(
      screen.queryByRole('button', { name: /end voice|end conversation/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^new conversation$/i })).not.toBeInTheDocument();
  });
});
