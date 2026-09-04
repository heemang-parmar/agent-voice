import type { ReactNode } from 'react';

import { NewChatIcon, SessionsIcon } from './icons';

export interface ConversationBarProps {
  /** The one announced status region for the whole console. */
  status: ReactNode;
  sessionsOpen: boolean;
  onOpenSessions: () => void;
  onNewConversation: () => void;
  /**
   * The overflow for the conversation on screen. Absent until there is one
   * with something in it: an overflow over nothing has nothing to offer.
   */
  options?: ReactNode;
}

/**
 * One compact row at the top of the text view: sessions on the left, the
 * dynamic status in the middle, and the conversation's own actions on the
 * right. It deliberately has no title and no rule beneath it — the transcript
 * is the content, and a static "Conversation" heading only cost it space.
 *
 * There is no end-conversation control. Text and voice are two views of one
 * persistent conversation, and starting a new one is the deliberate reset.
 */
export function ConversationBar({
  status,
  sessionsOpen,
  onOpenSessions,
  onNewConversation,
  options,
}: ConversationBarProps) {
  return (
    <header className="conversation-bar">
      <button
        type="button"
        className="icon-button conversation-bar__action"
        aria-label="Sessions"
        title="Saved conversations"
        aria-haspopup="dialog"
        aria-expanded={sessionsOpen}
        onClick={onOpenSessions}
      >
        <SessionsIcon />
      </button>

      <div className="conversation-bar__status">{status}</div>

      <div className="conversation-bar__actions">
        {options}
        <button
          type="button"
          className="icon-button conversation-bar__action"
          aria-label="New conversation"
          title="New conversation"
          onClick={onNewConversation}
        >
          <NewChatIcon />
        </button>
      </div>
    </header>
  );
}
