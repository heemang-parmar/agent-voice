import type { ReactNode } from 'react';

import { EndIcon, NewChatIcon, SessionsIcon } from './icons';

export interface ConversationBarProps {
  /** The one announced status region for the whole console. */
  status: ReactNode;
  sessionsOpen: boolean;
  onOpenSessions: () => void;
  /** Ending is only offered while a session is actually live. */
  action: 'end' | 'new';
  onEnd: () => void;
  onNewConversation: () => void;
}

/**
 * One compact row at the top of the text view: sessions on the left, the
 * dynamic status in the middle, and the single most relevant action on the
 * right. It deliberately has no title and no rule beneath it — the transcript
 * is the content, and a static "Conversation" heading only cost it space.
 */
export function ConversationBar({
  status,
  sessionsOpen,
  onOpenSessions,
  action,
  onEnd,
  onNewConversation,
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

      {action === 'end' ? (
        <button
          type="button"
          className="icon-button conversation-bar__action"
          aria-label="End conversation"
          title="End conversation"
          onClick={onEnd}
        >
          <EndIcon />
        </button>
      ) : (
        <button
          type="button"
          className="icon-button conversation-bar__action"
          aria-label="New conversation"
          title="New conversation"
          onClick={onNewConversation}
        >
          <NewChatIcon />
        </button>
      )}
    </header>
  );
}
