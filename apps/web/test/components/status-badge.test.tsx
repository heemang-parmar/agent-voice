import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusBadge } from '@/app/components/status-badge';

describe('StatusBadge', () => {
  it('announces the current status politely for assistive tech', () => {
    render(<StatusBadge status="listening" />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent(/listening/i);
  });

  it('updates its label when the status changes', () => {
    const { rerender } = render(<StatusBadge status="idle" />);
    expect(screen.getByRole('status')).toHaveTextContent(/idle/i);
    rerender(<StatusBadge status="awaiting-approval" />);
    expect(screen.getByRole('status')).toHaveTextContent(/approval/i);
  });

  it('keeps orb-mode status visually compact while preserving its full accessible description', () => {
    const { rerender } = render(<StatusBadge status="speaking" variant="orb" />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('data-variant', 'orb');
    expect(screen.getByText('The agent is speaking.')).toHaveClass('sr-only');

    rerender(<StatusBadge status="error" variant="orb" showDescription />);
    expect(screen.getByText(/something went wrong/i)).not.toHaveClass('sr-only');
  });

  it('surfaces a microphone error alongside the status without hiding it', () => {
    render(
      <StatusBadge
        status="listening"
        micError="The microphone stopped working. You can keep typing."
      />,
    );
    expect(screen.getByText(/microphone stopped working/i)).toBeInTheDocument();
  });
});
