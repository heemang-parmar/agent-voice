'use client';

import { useEffect, useId, useRef, useState } from 'react';

import {
  MAX_GROUP_NAME_CHARS,
  MAX_TITLE_CHARS,
  librarySections,
  type LibraryConversation,
  type LibraryGroup,
  type SessionLibrary,
} from '@/lib/client/session-library';

import { MoreIcon, NewChatIcon, PinIcon, EndIcon } from './icons';

export interface SessionDrawerProps {
  open: boolean;
  library: SessionLibrary;
  /** The conversation currently on screen, live or saved. */
  activeId: string | null;
  onClose: () => void;
  onNewConversation: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onMove: (id: string, groupId: string | null) => void;
  onCreateGroup: (id: string, name: string) => void;
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * A slide-over list of everything this browser has kept.
 *
 * It is a modal dialog in the full sense: focus enters it, Tab cannot leave
 * it, Escape and the backdrop dismiss it, and focus returns to whatever
 * opened it. The console additionally marks the stage `inert` while it is
 * open, so nothing behind the panel can be clicked.
 */
export function SessionDrawer({
  open,
  library,
  activeId,
  onClose,
  onNewConversation,
  onSelect,
  onRename,
  onTogglePin,
  onMove,
  onCreateGroup,
}: SessionDrawerProps) {
  const panel = useRef<HTMLDivElement>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    return () => {
      // The opener is still in the document: the stage is only made inert,
      // never unmounted.
      opener.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      const inside = panel.current?.contains(document.activeElement) ?? false;
      if (event.shiftKey && (!inside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const sections = librarySections(library);

  const rows = (conversations: LibraryConversation[]) => (
    <ul className="session-list">
      {conversations.map((record) => (
        <SessionRow
          key={record.id}
          record={record}
          groups={library.groups}
          active={activeId === record.id}
          menuOpen={openMenuId === record.id}
          onOpenMenu={(next) => {
            setOpenMenuId(next ? record.id : null);
          }}
          onSelect={onSelect}
          onRename={onRename}
          onTogglePin={onTogglePin}
          onMove={onMove}
          onCreateGroup={onCreateGroup}
        />
      ))}
    </ul>
  );

  return (
    <div className="session-drawer">
      <button
        type="button"
        className="session-drawer__backdrop"
        data-testid="session-drawer-backdrop"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        className="session-drawer__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panel}
        tabIndex={-1}
      >
        <div className="session-drawer__head">
          <h2 id={titleId} className="session-drawer__title">
            Sessions
          </h2>
          <button
            type="button"
            className="icon-button session-drawer__close"
            aria-label="Close sessions"
            title="Close sessions"
            onClick={onClose}
          >
            <EndIcon />
          </button>
        </div>

        <button
          type="button"
          className="button button--primary button--wide session-drawer__new"
          onClick={onNewConversation}
        >
          <NewChatIcon />
          New conversation
        </button>

        <div className="session-drawer__scroll">
          {sections.pinned.length > 0 ? (
            <section className="session-section">
              <h3 className="session-section__heading">Pinned</h3>
              {rows(sections.pinned)}
            </section>
          ) : null}

          {sections.groups.map((section) => (
            <section key={section.group.id} className="session-section">
              <h3 className="session-section__heading">{section.group.name}</h3>
              {rows(section.conversations)}
            </section>
          ))}

          {sections.recent.length > 0 ? (
            <section className="session-section">
              <h3 className="session-section__heading">Recent</h3>
              {rows(sections.recent)}
            </section>
          ) : null}
        </div>

        <p className="session-drawer__footer">
          History is saved on this device only. It is not synced to an account or another device.
        </p>
      </div>
    </div>
  );
}

type RowForm = 'none' | 'rename' | 'group';

interface SessionRowProps {
  record: LibraryConversation;
  groups: LibraryGroup[];
  active: boolean;
  menuOpen: boolean;
  onOpenMenu: (open: boolean) => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onMove: (id: string, groupId: string | null) => void;
  onCreateGroup: (id: string, name: string) => void;
}

/**
 * One saved conversation, plus the overflow that owns everything you can do
 * to it. Rename and new-group are real labelled forms: `window.prompt` is
 * unlabelled, unstyled and unusable with a screen reader on mobile.
 */
function SessionRow({
  record,
  groups,
  active,
  menuOpen,
  onOpenMenu,
  onSelect,
  onRename,
  onTogglePin,
  onMove,
  onCreateGroup,
}: SessionRowProps) {
  const [form, setForm] = useState<RowForm>('none');
  const [value, setValue] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const fieldId = useId();

  useEffect(() => {
    if (form !== 'none') field.current?.focus();
  }, [form]);

  const openForm = (next: RowForm): void => {
    setValue(next === 'rename' ? record.title : '');
    setForm(next);
    onOpenMenu(false);
  };

  const closeForm = (): void => {
    setForm('none');
    setValue('');
  };

  const submit = (): void => {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      if (form === 'rename') onRename(record.id, trimmed);
      else onCreateGroup(record.id, trimmed);
    }
    closeForm();
  };

  if (form !== 'none') {
    const rename = form === 'rename';
    return (
      <li className="session-row session-row--editing">
        <form
          className="session-row__form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label htmlFor={fieldId} className="sr-only">
            {rename ? 'Rename conversation' : 'New group name'}
          </label>
          <input
            ref={field}
            id={fieldId}
            className="session-row__field"
            type="text"
            value={value}
            maxLength={rename ? MAX_TITLE_CHARS : MAX_GROUP_NAME_CHARS}
            autoComplete="off"
            onChange={(event) => {
              setValue(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                closeForm();
              }
            }}
          />
          <div className="session-row__form-actions">
            <button type="submit" className="button button--quiet session-row__form-button">
              {rename ? 'Save' : 'Create group'}
            </button>
            <button
              type="button"
              className="button button--quiet session-row__form-button"
              onClick={closeForm}
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  const others = groups.filter((group) => group.id !== record.groupId);

  return (
    <li className="session-row">
      <div className="session-row__main">
        <button
          type="button"
          className="session-row__open"
          {...(active ? { 'aria-current': 'true' as const } : {})}
          onClick={() => {
            onSelect(record.id);
          }}
        >
          {record.pinned ? <PinIcon className="icon session-row__pin" /> : null}
          <span className="session-row__title">{record.title}</span>
        </button>
        <button
          type="button"
          className="icon-button session-row__more"
          aria-label={`More actions for ${record.title}`}
          title={`More actions for ${record.title}`}
          aria-haspopup="true"
          aria-expanded={menuOpen}
          onClick={() => {
            onOpenMenu(!menuOpen);
          }}
        >
          <MoreIcon />
        </button>
      </div>

      {menuOpen ? (
        <div className="session-row__menu">
          <button
            type="button"
            className="session-row__menu-item"
            onClick={() => {
              openForm('rename');
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="session-row__menu-item"
            onClick={() => {
              onTogglePin(record.id, !record.pinned);
              onOpenMenu(false);
            }}
          >
            {record.pinned ? 'Unpin' : 'Pin'}
          </button>
          {others.map((group) => (
            <button
              key={group.id}
              type="button"
              className="session-row__menu-item"
              onClick={() => {
                onMove(record.id, group.id);
                onOpenMenu(false);
              }}
            >
              {`Move to ${group.name}`}
            </button>
          ))}
          {record.groupId === null ? null : (
            <button
              type="button"
              className="session-row__menu-item"
              onClick={() => {
                onMove(record.id, null);
                onOpenMenu(false);
              }}
            >
              Remove from group
            </button>
          )}
          <button
            type="button"
            className="session-row__menu-item"
            onClick={() => {
              openForm('group');
            }}
          >
            New group…
          </button>
        </div>
      ) : null}
    </li>
  );
}
