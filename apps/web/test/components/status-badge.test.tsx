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
