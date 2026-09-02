import type { AgentVoiceCommand, AgentVoiceEvent } from '@agent-voice/protocol';

import type { AgentActivity, SessionError, SessionMode } from './session-state';

/**
 * The UI talks to the worker through this interface only. The LiveKit
 * implementation is the real one; the fixture implementation plays the
 * canonical protocol scenarios so every screen can be exercised without
 * credentials.
 */
export interface TransportCallbacks {
  onConnected(): void;
  onAgentPresence(present: boolean): void;
  onActivity(activity: AgentActivity): void;
  onEvent(event: AgentVoiceEvent): void;
  /** A message arrived that could not be used; `reason` is a short code, never payload. */
  onDropped(reason: string): void;
  onReconnecting(): void;
  onReconnected(): void;
  onDisconnected(reason: string): void;
  onFailure(error: SessionError): void;
  onMic(enabled: boolean): void;
  onMicError(message: string | null): void;
  onAudioBlocked(blocked: boolean): void;
}

export interface Transport {
  connect(mode: SessionMode, signal: AbortSignal): Promise<void>;
  sendCommand(command: AgentVoiceCommand): Promise<void>;
  sendText(text: string): Promise<void>;
  setMicrophoneEnabled(enabled: boolean): Promise<void>;
  /** Resume audio playback after the browser blocked autoplay; call from a user gesture. */
  resumeAudio(): Promise<void>;
  disconnect(): Promise<void>;
}

export type TransportFactory = (callbacks: TransportCallbacks) => Transport;

export type TransportErrorCode =
  | 'aborted'
  | 'not_configured'
  | 'forbidden'
  | 'rate_limited'
  | 'server'
  | 'network'
  | 'connection'
  | 'media';

export class TransportError extends Error {
  readonly code: TransportErrorCode;
  readonly missing: string[];
  readonly invalid: string[];

  constructor(
    code: TransportErrorCode,
    message: string,
    details: { missing?: string[]; invalid?: string[] } = {},
  ) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
    this.missing = details.missing ?? [];
    this.invalid = details.invalid ?? [];
  }

  toSessionError(): SessionError {
    return { code: this.code, message: this.message };
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof TransportError && error.code === 'aborted') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new TransportError('aborted', 'The connection attempt was cancelled.');
}
