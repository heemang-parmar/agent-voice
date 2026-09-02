import type { TranscriptEntry } from '@/lib/client/session-state';

export interface TranscriptViewProps {
  entries: TranscriptEntry[];
}

export function TranscriptView({ entries }: TranscriptViewProps) {
  if (entries.length === 0) {
    return (
      <div className="transcript transcript--empty">
        <p>No messages yet. Say something, or type below.</p>
      </div>
    );
  }

  return (
    <ol className="transcript" role="log" aria-live="polite" aria-label="Conversation transcript">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="transcript__entry"
          data-role={entry.role}
          data-final={String(entry.final)}
        >
          <span className="transcript__speaker">{entry.role === 'user' ? 'You' : 'Agent'}</span>
          <span className="transcript__text">{entry.text}</span>
          {!entry.final ? <span className="transcript__partial-tag">…</span> : null}
        </li>
      ))}
    </ol>
  );
}
