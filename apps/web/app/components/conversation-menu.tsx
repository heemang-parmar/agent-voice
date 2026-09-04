'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { MAX_TITLE_CHARS, type LibraryGroup } from '@/lib/client/session-library';

import { MoreIcon } from './icons';

export interface ConversationMenuProps {
  /** The title as stored, so the rename field opens on the real value. */
  title: string;
  pinned: boolean;
  /** Groups this conversation is not already filed under. Empty is normal. */
  groups: LibraryGroup[];
  /** Lets the owner re-read storage before the menu paints its state. */
  onOpen?: () => void;
  onRename: (title: string) => void;
  onTogglePin: (pinned: boolean) => void;
  onMove: (groupId: string) => void;
}

type MenuMode = 'closed' | 'menu' | 'rename';

/**
 * The overflow for the conversation currently on screen.
 *
 * It offers only what the device-local library can actually do — rename, pin,
 * and file into a group that already exists. There is deliberately no share,
 * no archive and no sync here: none of those exist, and an affordance that
 * silently does nothing is worse than no affordance.
 *
 * Renaming is an inline labelled form rather than `window.prompt`, which is
 * unlabelled, unstyled, and unusable with a screen reader on mobile.
 */
export function ConversationMenu({
  title,
  pinned,
  groups,
  onOpen,
  onRename,
  onTogglePin,
  onMove,
}: ConversationMenuProps) {
  const [mode, setMode] = useState<MenuMode>('closed');
  const [value, setValue] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const fieldId = useId();

  const close = (restoreFocus: boolean): void => {
    setMode('closed');
    setValue('');
    // Dismissing with the keyboard must not drop focus to the document body.
    if (restoreFocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (mode === 'closed') return;
    const onPointerDown = (event: MouseEvent): void => {
      if (container.current?.contains(event.target as Node)) return;
      // A click elsewhere is aimed at that other thing: dismiss, but leave
      // focus to follow the pointer rather than yanking it back.
      setMode('closed');
      setValue('');
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [mode]);

  useEffect(() => {
    if (mode === 'menu') panel.current?.querySelector<HTMLElement>('button')?.focus();
    else if (mode === 'rename') field.current?.focus();
  }, [mode]);

  return (
    <div className="conversation-menu" ref={container}>
      <button
        type="button"
        ref={trigger}
        className="icon-button conversation-bar__action"
        aria-label="Current conversation options"
        title="Current conversation options"
        aria-haspopup="menu"
        aria-expanded={mode !== 'closed'}
        onClick={() => {
          if (mode !== 'closed') {
            close(false);
            return;
          }
          onOpen?.();
          setMode('menu');
        }}
      >
        <MoreIcon />
      </button>

      {mode === 'menu' ? (
        <div
          className="conversation-menu__panel"
          role="menu"
          aria-label="Current conversation"
          ref={panel}
        >
          <button
            type="button"
            role="menuitem"
            className="conversation-menu__item"
            onClick={() => {
              setValue(title);
              setMode('rename');
            }}
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className="conversation-menu__item"
            onClick={() => {
              onTogglePin(!pinned);
              close(true);
            }}
          >
            {pinned ? 'Unpin' : 'Pin'}
          </button>
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              role="menuitem"
              className="conversation-menu__item"
              onClick={() => {
                onMove(group.id);
                close(true);
              }}
            >
              {`Move to ${group.name}`}
            </button>
          ))}
        </div>
      ) : null}

      {mode === 'rename' ? (
        <form
          className="conversation-menu__panel conversation-menu__form"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = value.trim();
            if (trimmed.length > 0) onRename(trimmed);
            close(true);
          }}
        >
          <label htmlFor={fieldId} className="sr-only">
            Rename conversation
          </label>
          <input
            ref={field}
            id={fieldId}
            className="conversation-menu__field"
            type="text"
            value={value}
            maxLength={MAX_TITLE_CHARS}
            autoComplete="off"
            onChange={(event) => {
              setValue(event.target.value);
            }}
          />
          <div className="conversation-menu__form-actions">
            <button type="submit" className="button button--quiet conversation-menu__form-button">
              Save
            </button>
            <button
              type="button"
              className="button button--quiet conversation-menu__form-button"
              onClick={() => {
                close(true);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
