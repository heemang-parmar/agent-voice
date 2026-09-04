import type { SessionMode } from '@/lib/client/session-state';

import { AgentOrb } from './agent-orb';

export interface StartScreenProps {
  onStart: (mode: SessionMode) => void;
  missingConfig: string[];
  heading?: string;
}

/**
 * The only place a session can begin. Nothing here touches the microphone;
 * that only happens once the caller's `onStart('voice')` handler connects a
 * transport, which itself only requests media after this explicit click.
 */
export function StartScreen({
  onStart,
  missingConfig,
  heading = 'Talk to agent',
}: StartScreenProps) {
  const unconfigured = missingConfig.length > 0;

  return (
    <div className="start-screen" data-unconfigured={String(unconfigured)}>
      <div className="start-screen__focus">
        <AgentOrb status={unconfigured ? 'error' : 'idle'} />
      </div>

      {unconfigured ? (
        <div className="start-screen__panel start-screen__panel--unconfigured" role="status">
          <h2 className="start-screen__title">This deployment is not configured for voice yet</h2>
          <p className="start-screen__lede">
            Set the following environment variables and restart the server:
          </p>
          <ul className="start-screen__missing">
            {missingConfig.map((name) => (
              <li key={name}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="start-screen__panel">
          <h2 className="start-screen__title">{heading}</h2>
          <p className="start-screen__lede">
            Speak naturally, or type instead. Nothing is recorded until you start.
          </p>
          <div className="start-screen__actions">
            <button
              type="button"
              className="button button--primary button--wide"
              onClick={() => onStart('voice')}
            >
              Start voice conversation
            </button>
            <button
              type="button"
              className="button button--quiet button--wide"
              onClick={() => onStart('text')}
            >
              Type instead
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
