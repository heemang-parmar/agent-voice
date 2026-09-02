import type { SessionMode } from '@/lib/client/session-state';

export interface StartScreenProps {
  onStart: (mode: SessionMode) => void;
  missingConfig: string[];
}

/**
 * The only place a session can begin. Nothing here touches the microphone;
 * that only happens once the caller's `onStart('voice')` handler connects a
 * transport, which itself only requests media after this explicit click.
 */
export function StartScreen({ onStart, missingConfig }: StartScreenProps) {
  if (missingConfig.length > 0) {
    return (
      <div className="start-screen start-screen--unconfigured" role="status">
        <h2>This deployment is not configured for voice yet</h2>
        <p>Set the following environment variables and restart the server:</p>
        <ul className="start-screen__missing">
          {missingConfig.map((name) => (
            <li key={name}>
              <code>{name}</code>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="start-screen">
      <h2>Talk to your agent</h2>
      <p>Speak naturally, or type instead. Nothing is recorded until you start.</p>
      <div className="start-screen__actions">
        <button type="button" className="button button--primary" onClick={() => onStart('voice')}>
          Start voice conversation
        </button>
        <button type="button" className="button button--secondary" onClick={() => onStart('text')}>
          Type instead
        </button>
      </div>
    </div>
  );
}
