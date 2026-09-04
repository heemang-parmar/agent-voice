import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConversationMenu } from '@/app/components/conversation-menu';
import type { LibraryGroup } from '@/lib/client/session-library';

const GROUPS: LibraryGroup[] = [
  { id: 'grp_1', name: 'Travel', createdAt: '2026-02-01T00:00:00.000Z' },
  { id: 'grp_2', name: 'Work', createdAt: '2026-02-02T00:00:00.000Z' },
];

function setup(overrides: Partial<Parameters<typeof ConversationMenu>[0]> = {}) {
  const props = {
    title: 'Book a table',
    pinned: false,
    groups: [] as LibraryGroup[],
    onRename: vi.fn(),
    onTogglePin: vi.fn(),
    onMove: vi.fn(),
    ...overrides,
  };
  const user = userEvent.setup();
  const rendered = render(<ConversationMenu {...props} />);
  return { user, props, ...rendered };
}

describe('ConversationMenu', () => {
  it('announces itself as a menu button and reflects whether the menu is open', async () => {
    const { user } = setup();
    const trigger = screen.getByRole('button', { name: 'Current conversation options' });

    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('moves focus into the menu on open and back to the trigger on Escape', async () => {
    const { user } = setup();
    const trigger = screen.getByRole('button', { name: 'Current conversation options' });

    await user.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on a click outside itself', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Current conversation options' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('renames through a labelled inline field rather than a window prompt', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null);
    const { user, props } = setup();

    await user.click(screen.getByRole('button', { name: 'Current conversation options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

    const field = screen.getByRole('textbox', { name: /rename conversation/i });
    // It opens on the real stored title, so a small edit does not retype it.
    expect(field).toHaveValue('Book a table');
    expect(field).toHaveFocus();

    await user.clear(field);
    await user.type(field, '  Dinner plans  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(props.onRename).toHaveBeenCalledWith('Dinner plans');
    expect(prompt).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: /rename conversation/i }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Current conversation options' })).toHaveFocus();
  });

  it('leaves the title alone when the rename is cancelled or emptied', async () => {
    const { user, props } = setup();
    const trigger = screen.getByRole('button', { name: 'Current conversation options' });

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onRename).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await user.clear(screen.getByRole('textbox', { name: /rename conversation/i }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it('offers the opposite of the current pin state and applies it once', async () => {
    const { user, props, rerender } = setup();

    await user.click(screen.getByRole('button', { name: 'Current conversation options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Pin' }));
    expect(props.onTogglePin).toHaveBeenCalledWith(true);
    expect(props.onTogglePin).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    rerender(<ConversationMenu {...props} pinned />);
    await user.click(screen.getByRole('button', { name: 'Current conversation options' }));
    expect(screen.getByRole('menuitem', { name: 'Unpin' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Pin' })).not.toBeInTheDocument();
  });

  it('offers a move only for groups that already exist', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Current conversation options' }));
    expect(screen.queryByRole('menuitem', { name: /move to/i })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    const withGroups = setup({ groups: GROUPS });
    await withGroups.user.click(
      screen.getAllByRole('button', { name: 'Current conversation options' })[1]!,
    );
    await withGroups.user.click(screen.getByRole('menuitem', { name: 'Move to Work' }));
    expect(withGroups.props.onMove).toHaveBeenCalledWith('grp_2');
  });

  it('offers nothing the device-local library cannot actually do', async () => {
    const { user } = setup({ groups: GROUPS });
    await user.click(screen.getByRole('button', { name: 'Current conversation options' }));

    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Rename', 'Pin', 'Move to Travel', 'Move to Work']);
    expect(
      screen.queryByRole('menuitem', { name: /share|archive|sync|settings|language|voice/i }),
    ).not.toBeInTheDocument();
  });

  it('is built from real buttons and keeps its glyph out of the accessibility tree', async () => {
    const { user, container } = setup({ groups: GROUPS });
    await user.click(screen.getByRole('button', { name: 'Current conversation options' }));

    for (const button of screen.getAllByRole('button')) expect(button.tagName).toBe('BUTTON');
    for (const glyph of container.querySelectorAll('svg')) {
      expect(glyph).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
