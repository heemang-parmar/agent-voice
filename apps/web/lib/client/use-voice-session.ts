'use client';

import { LIMITS, PROTOCOL_VERSION, type AgentVoiceCommand } from '@agent-voice/protocol';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import {
  deriveStatus,
  initialSessionState,
  sessionReducer,
  type SessionMode,
  type SessionState,
  type SessionStatus,
} from './session-state';
import {
  TransportError,
  isAbortError,
  type Transport,
  type TransportCallbacks,
  type TransportFactory,
} from './transport';

export interface VoiceSessionApi {
  state: SessionState;
  status: SessionStatus;
  /** Variable names reported by the server when it is not configured. Never values. */
  missingConfig: string[];
  invalidConfig: string[];
  start(mode: SessionMode): Promise<void>;
  end(): Promise<void>;
  respondToApproval(
    approvalId: string,
    actionId: string,
    decision: 'approved' | 'rejected',
  ): Promise<void>;
  cancelAction(actionId: string): Promise<void>;
  sendText(text: string): Promise<void>;
  setMicrophoneEnabled(enabled: boolean): Promise<void>;
  resumeAudio(): Promise<void>;
}

interface LiveSession {
  transport: Transport | null;
  controller: AbortController;
  connected: boolean;
}

type CommandBody =
  | {
      type: 'approval.respond';
      actionId: string;
      approvalId: string;
      decision: 'approved' | 'rejected';
    }
  | { type: 'action.cancel'; actionId: string }
  | { type: 'conversation.cancel' };

function newId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

function makeCommand(conversationId: string | null, body: CommandBody): AgentVoiceCommand {
  return {
    v: PROTOCOL_VERSION,
    id: newId('cmd'),
    ts: new Date().toISOString(),
    conversationId: conversationId ?? 'unbound',
    ...body,
  };
}

function warn(event: string, detail?: string): void {
  console.warn(`[agent-voice] ${event}${detail === undefined ? '' : `: ${detail}`}`);
}

/**
 * Owns one session at a time: creates the transport, routes its callbacks
 * into the reducer, and exposes the handful of verbs the UI needs. Callbacks
 * from a transport that is no longer current are ignored, so a stale
 * connection can never write into a newer session.
 */
export function useVoiceSession(factory: TransportFactory): VoiceSessionApi {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);
  const [configIssues, setConfigIssues] = useState<{ missing: string[]; invalid: string[] }>({
    missing: [],
    invalid: [],
  });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const factoryRef = useRef(factory);
  useEffect(() => {
    factoryRef.current = factory;
  }, [factory]);
  const sessionRef = useRef<LiveSession | null>(null);

  const teardown = useCallback(async (session: LiveSession): Promise<void> => {
    if (sessionRef.current === session) sessionRef.current = null;
    session.controller.abort();
    try {
      await session.transport?.disconnect();
    } catch (error) {
      warn('disconnect_failed', error instanceof Error ? error.name : typeof error);
    }
  }, []);

  const start = useCallback(
    async (mode: SessionMode): Promise<void> => {
      if (sessionRef.current) return;
      const session: LiveSession = {
        transport: null,
        controller: new AbortController(),
        connected: false,
      };
      sessionRef.current = session;
      setConfigIssues({ missing: [], invalid: [] });
      dispatch({ type: 'start', mode });

      const isCurrent = (): boolean => sessionRef.current === session;
      const callbacks: TransportCallbacks = {
        onConnected: () => {
          if (!isCurrent()) return;
          session.connected = true;
          dispatch({ type: 'connected' });
        },
        onAgentPresence: (present) => {
          if (isCurrent()) dispatch({ type: 'agent_presence', present });
        },
        onActivity: (activity) => {
          if (isCurrent()) dispatch({ type: 'activity', activity });
        },
        onEvent: (event) => {
          if (isCurrent()) dispatch({ type: 'event', event });
        },
        onDropped: (reason) => {
          warn('message_dropped', reason);
          if (isCurrent()) dispatch({ type: 'dropped' });
        },
        onReconnecting: () => {
          if (isCurrent()) dispatch({ type: 'reconnecting' });
        },
        onReconnected: () => {
          if (isCurrent()) dispatch({ type: 'reconnected' });
        },
        onDisconnected: (reason) => {
          if (!isCurrent()) return;
          sessionRef.current = null;
          dispatch({ type: 'disconnected', reason });
        },
        onFailure: (error) => {
          if (!isCurrent()) return;
          dispatch({ type: 'failure', error });
          void teardown(session);
        },
        onMic: (enabled) => {
          if (isCurrent()) dispatch({ type: 'mic', enabled });
        },
        onMicError: (message) => {
          if (isCurrent()) dispatch({ type: 'mic_error', message });
        },
        onAudioBlocked: (blocked) => {
          if (isCurrent()) dispatch({ type: 'audio_blocked', blocked });
        },
      };

      const transport = factoryRef.current(callbacks);
      session.transport = transport;
      try {
        await transport.connect(mode, session.controller.signal);
      } catch (error) {
        if (!isCurrent() || isAbortError(error)) return;
        sessionRef.current = null;
        if (error instanceof TransportError) {
          if (error.code === 'not_configured') {
            setConfigIssues({ missing: error.missing, invalid: error.invalid });
          }
          dispatch({ type: 'failure', error: error.toSessionError() });
        } else {
          warn('connect_failed', error instanceof Error ? error.name : typeof error);
          dispatch({
            type: 'failure',
            error: { code: 'connection', message: 'Could not connect. Please try again.' },
          });
        }
        try {
          await transport.disconnect();
        } catch {
          // Already torn down; nothing else to release.
        }
      }
    },
    [teardown],
  );

  const send = useCallback(async (body: CommandBody): Promise<boolean> => {
    const session = sessionRef.current;
    if (!session?.transport || !session.connected) return false;
    try {
      await session.transport.sendCommand(makeCommand(stateRef.current.conversationId, body));
      return true;
    } catch (error) {
      warn('command_failed', error instanceof Error ? error.name : typeof error);
      return false;
    }
  }, []);

  const end = useCallback(async (): Promise<void> => {
    const session = sessionRef.current;
    if (!session) return;
    if (session.connected) await send({ type: 'conversation.cancel' });
    dispatch({ type: 'end', reason: 'user' });
    await teardown(session);
  }, [send, teardown]);

  const respondToApproval = useCallback(
    async (
      approvalId: string,
      actionId: string,
      decision: 'approved' | 'rejected',
    ): Promise<void> => {
      const pending = stateRef.current.pendingApproval;
      if (!pending || pending.approvalId !== approvalId || pending.actionId !== actionId) return;
      if (pending.submitting) return;
      dispatch({ type: 'approval_submitting', approvalId, actionId, decision });
      await send({ type: 'approval.respond', actionId, approvalId, decision });
    },
    [send],
  );

  const cancelAction = useCallback(
    async (actionId: string): Promise<void> => {
      const action = stateRef.current.actions.find((candidate) => candidate.actionId === actionId);
      if (!action || (action.status !== 'running' && action.status !== 'awaiting-approval')) return;
      dispatch({ type: 'cancel_requested', actionId });
      await send({ type: 'action.cancel', actionId });
    },
    [send],
  );

  const sendText = useCallback(async (text: string): Promise<void> => {
    const trimmed = text.trim().slice(0, LIMITS.maxTextChars);
    const session = sessionRef.current;
    if (trimmed.length === 0 || !session?.transport || !session.connected) return;
    dispatch({
      type: 'user_text',
      id: newId('local'),
      text: trimmed,
      ts: new Date().toISOString(),
    });
    try {
      await session.transport.sendText(trimmed);
    } catch (error) {
      warn('text_failed', error instanceof Error ? error.name : typeof error);
    }
  }, []);

  const setMicrophoneEnabled = useCallback(async (enabled: boolean): Promise<void> => {
    const session = sessionRef.current;
    if (!session?.transport) return;
    try {
      await session.transport.setMicrophoneEnabled(enabled);
    } catch (error) {
      warn('microphone_failed', error instanceof Error ? error.name : typeof error);
      dispatch({ type: 'mic_error', message: 'The microphone could not be changed.' });
    }
  }, []);

  const resumeAudio = useCallback(async (): Promise<void> => {
    const session = sessionRef.current;
    if (!session?.transport) return;
    try {
      await session.transport.resumeAudio();
    } catch (error) {
      warn('audio_resume_failed', error instanceof Error ? error.name : typeof error);
    }
  }, []);

  useEffect(() => {
    return () => {
      const session = sessionRef.current;
      if (session) void teardown(session);
    };
  }, [teardown]);

  const status = deriveStatus(state);
  return useMemo(
    () => ({
      state,
      status,
      missingConfig: configIssues.missing,
      invalidConfig: configIssues.invalid,
      start,
      end,
      respondToApproval,
      cancelAction,
      sendText,
      setMicrophoneEnabled,
      resumeAudio,
    }),
    [
      state,
      status,
      configIssues,
      start,
      end,
      respondToApproval,
      cancelAction,
      sendText,
      setMicrophoneEnabled,
      resumeAudio,
    ],
  );
}
