import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApprovalCard } from '@/app/components/approval-card';
import type { PendingApproval } from '@/lib/client/session-state';

function approval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    approvalId: 'apr_1',
    actionId: 'act_1',
    title: 'Re-run the failing jobs',
    prompt: 'Re-run integration-suite and docs-build?',
    requestedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T00:02:00.000Z',
    ...overrides,
  };
}

describe('ApprovalCard', () => {
  it('renders nothing when there is no pending approval', () => {
    const { container } = render(<ApprovalCard approval={null} onRespond={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('identifies the exact action being approved, not a vague blanket approval', () => {
    render(<ApprovalCard approval={approval()} onRespond={vi.fn()} />);
    expect(screen.getByText('Re-run the failing jobs')).toBeInTheDocument();
    expect(screen.getByText('Re-run integration-suite and docs-build?')).toBeInTheDocument();
  });

  it('approves with the exact approvalId and actionId that were requested', async () => {
    const onRespond = vi.fn();
    const user = userEvent.setup();
    render(
      <ApprovalCard
        approval={approval({ approvalId: 'apr_9', actionId: 'act_9' })}
        onRespond={onRespond}
      />,
    );
    await user.click(screen.getByRole('button', { name: /approve/i }));
    expect(onRespond).toHaveBeenCalledWith('apr_9', 'act_9', 'approved');
  });

  it('rejects with the exact approvalId and actionId that were requested', async () => {
    const onRespond = vi.fn();
    const user = userEvent.setup();
    render(
      <ApprovalCard
        approval={approval({ approvalId: 'apr_9', actionId: 'act_9' })}
        onRespond={onRespond}
      />,
    );
    await user.click(screen.getByRole('button', { name: /reject/i }));
    expect(onRespond).toHaveBeenCalledWith('apr_9', 'act_9', 'rejected');
  });

  it('disables both actions while a decision is already submitting, so it cannot be double-sent', () => {
    render(<ApprovalCard approval={approval({ submitting: 'approved' })} onRespond={vi.fn()} />);
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /reject/i })).toBeDisabled();
  });

  it('is announced assertively since it blocks progress on user input', () => {
    render(<ApprovalCard approval={approval()} onRespond={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
