import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ActionTimeline } from '@/app/components/action-timeline';
import type { ActionRecord } from '@/lib/client/session-state';

function action(overrides: Partial<ActionRecord> = {}): ActionRecord {
  return {
    actionId: 'act_1',
    title: 'Check the nightly build',
    adapter: 'openai-http',
    startedAt: '2026-01-01T00:00:00.000Z',
    status: 'running',
    progress: [],
    artifacts: [],
    cancelRequested: false,
    ...overrides,
  };
}

describe('ActionTimeline', () => {
  it('shows an honest empty state when no action has started', () => {
    render(<ActionTimeline actions={[]} onCancel={vi.fn()} />);
    expect(screen.getByText(/no actions yet/i)).toBeInTheDocument();
  });

  it('lists actions with their title and progress messages', () => {
    render(
      <ActionTimeline
        actions={[
          action({
            progress: [
              { message: 'Fetching the latest run', percent: 20, ts: '2026-01-01T00:00:01.000Z' },
            ],
          }),
        ]}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('Check the nightly build')).toBeInTheDocument();
    expect(screen.getByText('Fetching the latest run')).toBeInTheDocument();
  });

  it('only claims verified when the action carries a verified result', () => {
    render(
      <ActionTimeline
        actions={[
          action({
            status: 'verified',
            result: { kind: 'verified', summary: 'Re-ran the failing jobs', method: 'ci-log' },
          }),
        ]}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/verified/i)).toBeInTheDocument();
    expect(screen.getByText('Re-ran the failing jobs')).toBeInTheDocument();
  });

  it('reports a failed action honestly with its reason, never as success', () => {
    render(
      <ActionTimeline
        actions={[
          action({
            status: 'failed',
            result: {
              kind: 'failed',
              code: 'timeout',
              summary: 'The agent did not respond in time',
              retryable: true,
            },
          }),
        ]}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
    expect(screen.getByText('The agent did not respond in time')).toBeInTheDocument();
  });

  it('lets the user cancel a running action, bound to its exact actionId', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ActionTimeline actions={[action({ actionId: 'act_42' })]} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledWith('act_42');
  });

  it('does not offer cancel for an action that already finished', () => {
    render(
      <ActionTimeline
        actions={[
          action({
            status: 'verified',
            result: { kind: 'verified', summary: 'Done', method: 'x' },
          }),
        ]}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });
});
