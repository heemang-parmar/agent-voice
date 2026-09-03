import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SessionDrawer, type SessionDrawerProps } from '@/app/components/session-drawer';
import {
  addGroup,
  emptyLibrary,
  moveConversation,
  setConversationPinned,
  upsertConversation,
  type SessionLibrary,
} from '@/lib/client/session-library';
import type { TranscriptEntry } from '@/lib/client/session-state';

function turn(text: string): TranscriptEntry[] {
  return [{ id: `user:${text}`, role: 'user', text, final: true, ts: '2026-02-01T00:00:00.000Z' }];
}

function libraryWith(ids: [string, string][]): SessionLibrary {
  let library = emptyLibrary();
  for (const [id, text] of ids) {
    library = upsertConversation(library, {
      id,
      transcript: turn(text),
      now: '2026-02-01T00:00:00.000Z',
    });
  }
  return library;
}

function props(overrides: Partial<SessionDrawerProps> = {}): SessionDrawerProps {
  return {
    open: true,
    library: emptyLibrary(),
    activeId: null,
    onClose: vi.fn(),
    onNewConversation: vi.fn(),
    onSelect: vi.fn(),
    onRename: vi.fn(),
    onTogglePin: vi.fn(),
    onMove: vi.fn(),
    onCreateGroup: vi.fn(),
    ...overrides,
  };
}

/** A realistic opener, so focus restoration has somewhere to go back to. */
function Harness({ drawer }: { drawer: Partial<SessionDrawerProps> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Sessions
      </button>
      <SessionDrawer {...props({ ...drawer, open, onClose: () => setOpen(false) })} />
    </>
  );
}

describe('SessionDrawer', () => {
  it('renders nothing at all while closed', () => {
    const { container } = render(<SessionDrawer {...props({ open: false })} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is a labelled modal dialog with a close button', () => {
    render(<SessionDrawer {...props()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName(/sessions/i);
    expect(within(dialog).getByRole('heading', { name: /sessions/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('moves focus into the drawer on open and back to the opener on close', async () => {
    const user = userEvent.setup();
    render(<Harness drawer={{}} />);
    const opener = screen.getByRole('button', { name: 'Sessions' });
    await user.click(opener);

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    await user.click(within(dialog).getByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SessionDrawer {...props({ onClose })} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when the backdrop is activated', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SessionDrawer {...props({ onClose })} />);
    await user.click(screen.getByTestId('session-drawer-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps Tab inside the dialog while it is open', async () => {
    const user = userEvent.setup();
    render(<SessionDrawer {...props({ library: libraryWith([['a', 'Book a table']]) })} />);
    const dialog = screen.getByRole('dialog');
    for (let press = 0; press < 12; press += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('offers New conversation as the primary action', async () => {
    const onNewConversation = vi.fn();
    const user = userEvent.setup();
    render(<SessionDrawer {...props({ onNewConversation })} />);
    await user.click(screen.getByRole('button', { name: /new conversation/i }));
    expect(onNewConversation).toHaveBeenCalled();
  });

  it('hides section headings that would have nothing under them', () => {
    render(<SessionDrawer {...props({ library: libraryWith([['a', 'Book a table']]) })} />);
    expect(screen.getByRole('heading', { name: /recent/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^pinned$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^groups$/i })).not.toBeInTheDocument();
  });

  it('files each conversation under exactly one heading', () => {
    let library = libraryWith([
      ['a', 'Pinned one'],
      ['b', 'Grouped one'],
      ['c', 'Loose one'],
    ]);
    library = addGroup(library, { id: 'grp_1', name: 'Travel', now: '2026-02-01T00:00:00.000Z' });
    library = moveConversation(library, 'b', 'grp_1');
    library = setConversationPinned(library, 'a', true);

    render(<SessionDrawer {...props({ library })} />);
    expect(screen.getByRole('heading', { name: /^pinned$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Travel' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^recent$/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Pinned one' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Grouped one' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Loose one' })).toHaveLength(1);
  });

  it('opens a saved conversation when its row is activated', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <SessionDrawer {...props({ library: libraryWith([['a', 'Book a table']]), onSelect })} />,
    );
    await user.click(screen.getByRole('button', { name: 'Book a table' }));
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('says plainly that history lives on this device only', () => {
    render(<SessionDrawer {...props()} />);
    expect(screen.getByText(/saved on this device/i)).toBeInTheDocument();
  });

  it('marks the conversation that is currently open', () => {
    render(
      <SessionDrawer
        {...props({ library: libraryWith([['a', 'Book a table']]), activeId: 'a' })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Book a table' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('offers a discoverable, labelled overflow control on every row', async () => {
    const user = userEvent.setup();
    render(<SessionDrawer {...props({ library: libraryWith([['a', 'Book a table']]) })} />);
    const more = screen.getByRole('button', { name: /more actions for book a table/i });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^rename$/i })).toBeInTheDocument();
  });

  it('renames through an inline form rather than window.prompt', async () => {
    const prompt = vi.spyOn(window, 'prompt');
    const onRename = vi.fn();
    const user = userEvent.setup();
    render(
      <SessionDrawer {...props({ library: libraryWith([['a', 'Book a table']]), onRename })} />,
    );
    await user.click(screen.getByRole('button', { name: /more actions for book a table/i }));
    await user.click(screen.getByRole('button', { name: /^rename$/i }));

    const field = screen.getByRole('textbox', { name: /rename conversation/i });
    expect(field).toHaveFocus();
    await user.clear(field);
    await user.type(field, 'Dinner plans{Enter}');

    expect(onRename).toHaveBeenCalledWith('a', 'Dinner plans');
    expect(prompt).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: /rename conversation/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it('abandons a rename on Cancel without reporting one', async () => {
    const onRename = vi.fn();
    const user = userEvent.setup();
    render(
      <SessionDrawer {...props({ library: libraryWith([['a', 'Book a table']]), onRename })} />,
    );
    await user.click(screen.getByRole('button', { name: /more actions for book a table/i }));
    await user.click(screen.getByRole('button', { name: /^rename$/i }));
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: /rename conversation/i })).not.toBeInTheDocument();
  });

  it('pins and unpins from the row menu', async () => {
    const onTogglePin = vi.fn();
    const user = userEvent.setup();
    const library = libraryWith([['a', 'Book a table']]);
    const { rerender } = render(<SessionDrawer {...props({ library, onTogglePin })} />);
    await user.click(screen.getByRole('button', { name: /more actions for book a table/i }));
    await user.click(screen.getByRole('button', { name: /^pin$/i }));
    expect(onTogglePin).toHaveBeenCalledWith('a', true);

    rerender(
      <SessionDrawer
        {...props({ library: setConversationPinned(library, 'a', true), onTogglePin })}
      />,
    );
    await user.click(screen.getByRole('button', { name: /more actions for book a table/i }));
    await user.click(screen.getByRole('button', { name: /^unpin$/i }));
    expect(onTogglePin).toHaveBeenCalledWith('a', false);
  });

  it('moves a conversation into an existing group and back out of it', async () => {
    const onMove = vi.fn();
    const user = userEvent.setup();
    let library = libraryWith([['a', 'Book a table']]);
    library = addGroup(library, { id: 'grp_1', name: 'Travel', now: '2026-02-01T00:00:00.000Z' });
    const { rerender } = render(<SessionDrawer {...props({ library, onMove })} />);

    await user.click(screen.getByRole('button', { name: /more actions for book a table/i }));
    await user.click(screen.getByRole('button', { name: /move to travel/i }));
    expect(onMove).toHaveBeenCalledWith('a', 'grp_1');

    rerender(
      <SessionDrawer {...props({ library: moveConversation(library, 'a', 'grp_1'), onMove })} />,
    );
    await user.click(screen.getByRole('button', { name: /more actions for book a table/i }));
    await user.click(screen.getByRole('button', { name: /remove from group/i }));
    expect(onMove).toHaveBeenCalledWith('a', null);
  });

  it('creates a group through an inline form and files the row into it', async () => {
    const onCreateGroup = vi.fn();
    const user = userEvent.setup();
    render(
      <SessionDrawer
        {...props({ library: libraryWith([['a', 'Book a table']]), onCreateGroup })}
      />,
    );
    await user.click(screen.getByRole('button', { name: /more actions for book a table/i }));
    await user.click(screen.getByRole('button', { name: /new group/i }));

    const field = screen.getByRole('textbox', { name: /group name/i });
    expect(field).toHaveFocus();
    await user.type(field, 'Travel{Enter}');
    expect(onCreateGroup).toHaveBeenCalledWith('a', 'Travel');
  });

  it('does not offer a move when there is no group to move into', async () => {
    const user = userEvent.setup();
    render(<SessionDrawer {...props({ library: libraryWith([['a', 'Book a table']]) })} />);
    await user.click(screen.getByRole('button', { name: /more actions for book a table/i }));
    expect(screen.queryByRole('button', { name: /^move to/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove from group/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new group/i })).toBeInTheDocument();
  });

  it('keeps only one row menu open at a time', async () => {
    const user = userEvent.setup();
    render(
      <SessionDrawer
        {...props({
          library: libraryWith([
            ['a', 'First one'],
            ['b', 'Second one'],
          ]),
        })}
      />,
    );
    await user.click(screen.getByRole('button', { name: /more actions for first one/i }));
    await user.click(screen.getByRole('button', { name: /more actions for second one/i }));
    expect(screen.getByRole('button', { name: /more actions for first one/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getAllByRole('button', { name: /^rename$/i })).toHaveLength(1);
  });
});
