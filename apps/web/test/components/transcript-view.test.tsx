import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TranscriptView } from '@/app/components/transcript-view';
import type { TranscriptEntry } from '@/lib/client/session-state';

const entries: TranscriptEntry[] = [
  {
    id: 'user:seg_1',
    role: 'user',
    text: 'Hello there',
    final: true,
    ts: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'agent:msg_1',
    role: 'agent',
    text: 'Hi, how can I help',
    final: false,
    ts: '2026-01-01T00:00:01.000Z',
  },
];

describe('TranscriptView', () => {
  it('renders both sides of the conversation in chronological order', () => {
    render(<TranscriptView entries={entries} />);
    const log = screen.getByRole('log');
    const items = within(log).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Hello there');
    expect(items[1]).toHaveTextContent('Hi, how can I help');
  });

  it('is a live region so new turns are announced', () => {
    render(<TranscriptView entries={entries} />);
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'polite');
  });

  it('distinguishes user and agent turns', () => {
    render(<TranscriptView entries={entries} />);
    expect(screen.getByText('Hello there').closest('[data-role]')).toHaveAttribute(
      'data-role',
      'user',
    );
    expect(screen.getByText('Hi, how can I help').closest('[data-role]')).toHaveAttribute(
      'data-role',
      'agent',
    );
  });

  it('marks a partial (not yet final) turn as in progress instead of pretending it is done', () => {
    render(<TranscriptView entries={entries} />);
    const partial = screen.getByText('Hi, how can I help').closest('[data-final]');
    expect(partial).toHaveAttribute('data-final', 'false');
  });

  it('tells assistive tech that a partial turn is still being transcribed', () => {
    render(<TranscriptView entries={entries} />);
    expect(screen.getByText(/still being transcribed/i)).toBeInTheDocument();
  });

  it('renders transcript text as plain selectable text, not as controls', () => {
    render(<TranscriptView entries={entries} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('Hello there').tagName).toBe('SPAN');
  });

  it('shows an honest empty state before any turn has happened', () => {
    render(<TranscriptView entries={[]} />);
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
  });
});
