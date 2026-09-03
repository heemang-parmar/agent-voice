import type { AgentVoiceEvent, Artifact, FailureCode, LIMITS } from '@agent-voice/protocol';

/**
 * Pure state for one voice/text session. The reducer takes transport facts
 * (connected, reconnecting, agent activity) and validated protocol events; the
 * UI status is derived, never stored, so it can never disagree with the facts.
 */

export type ConnectionPhase =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'ended';

/** Mirrors the `lk.agent.state` participant attribute published by the worker. */
export type AgentActivity = 'initializing' | 'listening' | 'thinking' | 'speaking';

export type SessionStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'acting'
  | 'awaiting-approval'
  | 'reconnecting'
  | 'error'
  | 'ended';

export type SessionMode = 'voice' | 'text';

export interface TranscriptEntry {
  id: string;
  role: 'user' | 'agent';
  text: string;
  final: boolean;
  ts: string;
}

/**
 * Prefix the transport stamps on message ids it synthesises from LiveKit's
 * TTS-aligned agent transcription. It is what tells a live caption apart from
 * the worker's own `agent.message.final`, which carries the LLM chat item id:
 * the two describe the same turn but can never share an id.
 */
export const AGENT_CAPTION_ID_PREFIX = 'caption:';

export function isAgentCaptionId(messageId: string): boolean {
  return messageId.startsWith(AGENT_CAPTION_ID_PREFIX);
}

/**
 * One agent turn, seen from up to two sources. `entryId` is decided by
 * whichever source opened the turn, so both write to the same transcript row.
 */
export interface AgentTurnLink {
  entryId: string;
  /** Caption segment id, once captions have been seen for this turn. */
  captionId: string | null;
  /** Worker message id, once a worker final has been matched to this turn. */
  workerId: string | null;
}

export type ActionStatus = 'running' | 'awaiting-approval' | 'verified' | 'failed';

export interface ActionProgress {
  message: string;
  percent?: number;
  ts: string;
}

export type ActionResult =
  | { kind: 'verified'; summary: string; method: string; detail?: string }
  | { kind: 'failed'; code: FailureCode; summary: string; retryable: boolean };

export interface ActionRecord {
  actionId: string;
  title: string;
  adapter: string;
  startedAt: string;
  status: ActionStatus;
  progress: ActionProgress[];
  artifacts: Artifact[];
  approval?: { approvalId: string; decision?: 'approved' | 'rejected' | 'expired' };
  result?: ActionResult;
  cancelRequested: boolean;
}

export interface PendingApproval {
  approvalId: string;
  actionId: string;
  title: string;
  prompt: string;
  requestedAt: string;
  expiresAt: string;
  /** Set optimistically while the response command is in flight. */
  submitting?: 'approved' | 'rejected';
}

export interface SessionError {
  code: string;
  message: string;
}

export interface SessionState {
  phase: ConnectionPhase;
  mode: SessionMode | null;
  activity: AgentActivity | null;
  agentPresent: boolean;
  micEnabled: boolean;
  micError: string | null;
  audioBlocked: boolean;
  conversationId: string | null;
  transcript: TranscriptEntry[];
  /** Bounded caption/worker pairing for recent agent turns; never rendered. */
  agentTurns: AgentTurnLink[];
  actions: ActionRecord[];
  pendingApproval: PendingApproval | null;
  error: SessionError | null;
  endReason: string | null;
  /** Events that were valid but did not fit the current state (logged, never shown raw). */
  droppedEvents: number;
}

export type SessionAction =
  | { type: 'start'; mode: SessionMode }
  | { type: 'connected' }
  | { type: 'agent_presence'; present: boolean }
  | { type: 'activity'; activity: AgentActivity }
  | { type: 'reconnecting' }
  | { type: 'reconnected' }
  | { type: 'disconnected'; reason: string }
  | { type: 'failure'; error: SessionError }
  | { type: 'mic'; enabled: boolean }
  | { type: 'mic_error'; message: string | null }
  | { type: 'audio_blocked'; blocked: boolean }
  | { type: 'user_text'; id: string; text: string; ts: string }
  | { type: 'event'; event: AgentVoiceEvent }
  | {
      type: 'approval_submitting';
      approvalId: string;
      actionId: string;
      decision: 'approved' | 'rejected';
    }
  | { type: 'cancel_requested'; actionId: string }
  | { type: 'dropped' }
  | { type: 'end'; reason: string }
  | { type: 'reset' };

export const MAX_TRANSCRIPT_ENTRIES = 200;
/** Only the last few agent turns can still be waiting for their second source. */
export const MAX_AGENT_TURNS = 8;
export const MAX_ACTIONS = 50;
export const MAX_PROGRESS_ENTRIES = 20;
/** Same ceiling as the protocol's per-event artifact list. */
export const MAX_ARTIFACTS: (typeof LIMITS)['maxArtifacts'] = 20;

export const initialSessionState: SessionState = {
  phase: 'idle',
  mode: null,
  activity: null,
  agentPresent: false,
  micEnabled: false,
  micError: null,
  audioBlocked: false,
  conversationId: null,
  transcript: [],
  agentTurns: [],
  actions: [],
  pendingApproval: null,
  error: null,
  endReason: null,
  droppedEvents: 0,
};

export function deriveStatus(state: SessionState): SessionStatus {
  switch (state.phase) {
    case 'idle':
      return 'idle';
    case 'connecting':
      return 'connecting';
    case 'reconnecting':
      return 'reconnecting';
    case 'error':
      return 'error';
    case 'ended':
      return 'ended';
    case 'connected':
      break;
  }
  if (!state.agentPresent) return 'connecting';
  if (state.pendingApproval) return 'awaiting-approval';
  if (state.actions.some((action) => action.status === 'running')) return 'acting';
  switch (state.activity) {
    case 'speaking':
      return 'speaking';
    case 'thinking':
      return 'thinking';
    case 'listening':
      return 'listening';
    default:
      return 'connecting';
  }
}

function isLive(state: SessionState): boolean {
  return (
    state.phase === 'connected' || state.phase === 'reconnecting' || state.phase === 'connecting'
  );
}

function bounded<T>(list: T[], max: number): T[] {
  return list.length > max ? list.slice(list.length - max) : list;
}

function upsertTranscript(state: SessionState, entry: TranscriptEntry): SessionState {
  const index = state.transcript.findIndex((existing) => existing.id === entry.id);
  const transcript =
    index === -1
      ? bounded([...state.transcript, entry], MAX_TRANSCRIPT_ENTRIES)
      : state.transcript.map((existing, i) => (i === index ? entry : existing));
  return { ...state, transcript };
}

interface ResolvedAgentTurn {
  turns: AgentTurnLink[];
  entryId: string;
  /** False when the turn already has spoken text that must not be overwritten. */
  useText: boolean;
  source: 'caption' | 'worker';
  /** Whether this caption id was already attached before the current event. */
  captionWasKnown: boolean;
  hasCaption: boolean;
}

/**
 * Decides which transcript row an agent message belongs to.
 *
 * A spoken turn is described twice: live captions aligned to the audio, and
 * the worker's `agent.message.final` carrying the committed LLM message. They
 * use different ids, so they are paired by turn order instead: a worker final
 * claims the oldest caption turn that has not been claimed yet. That keeps a
 * late worker final from attaching itself to a newer turn, and it never
 * compares text, so two identical replies stay two turns.
 *
 * Captions win on text: once a turn has been spoken, the worker's version is
 * only allowed to finalise it, never to reveal words that were not said.
 */
function resolveAgentTurn(turns: AgentTurnLink[], messageId: string): ResolvedAgentTurn {
  if (isAgentCaptionId(messageId)) {
    const open = turns.find((turn) => turn.captionId === messageId);
    if (open) {
      return {
        turns,
        entryId: open.entryId,
        useText: true,
        source: 'caption',
        captionWasKnown: true,
        hasCaption: true,
      };
    }

    // Reliable worker data and transcription packets travel independently. A
    // very short reply can therefore commit before its first caption arrives.
    const awaitingCaption = turns.find((turn) => turn.captionId === null && turn.workerId !== null);
    if (awaitingCaption) {
      return {
        turns: turns.map((turn) =>
          turn === awaitingCaption ? { ...turn, captionId: messageId } : turn,
        ),
        entryId: awaitingCaption.entryId,
        useText: true,
        source: 'caption',
        captionWasKnown: false,
        hasCaption: true,
      };
    }

    const started: AgentTurnLink = {
      entryId: `agent:${messageId}`,
      captionId: messageId,
      workerId: null,
    };
    return {
      turns: bounded([...turns, started], MAX_AGENT_TURNS),
      entryId: started.entryId,
      useText: true,
      source: 'caption',
      captionWasKnown: false,
      hasCaption: true,
    };
  }

  const linked = turns.find((turn) => turn.workerId === messageId);
  if (linked) {
    return {
      turns,
      entryId: linked.entryId,
      useText: linked.captionId === null,
      source: 'worker',
      captionWasKnown: linked.captionId !== null,
      hasCaption: linked.captionId !== null,
    };
  }

  // Only caption turns can still be unclaimed; worker turns are born claimed.
  const unclaimed = turns.find((turn) => turn.workerId === null);
  if (unclaimed) {
    return {
      turns: turns.map((turn) => (turn === unclaimed ? { ...turn, workerId: messageId } : turn)),
      entryId: unclaimed.entryId,
      useText: false,
      source: 'worker',
      captionWasKnown: true,
      hasCaption: true,
    };
  }

  const started: AgentTurnLink = {
    entryId: `agent:${messageId}`,
    captionId: null,
    workerId: messageId,
  };
  return {
    turns: bounded([...turns, started], MAX_AGENT_TURNS),
    entryId: started.entryId,
    useText: true,
    source: 'worker',
    captionWasKnown: false,
    hasCaption: false,
  };
}

function updateAction(
  state: SessionState,
  actionId: string,
  update: (action: ActionRecord) => ActionRecord,
): SessionState | null {
  const index = state.actions.findIndex((action) => action.actionId === actionId);
  if (index === -1) return null;
  const actions = state.actions.map((action, i) => (i === index ? update(action) : action));
  return { ...state, actions };
}

function dropped(state: SessionState): SessionState {
  return { ...state, droppedEvents: state.droppedEvents + 1 };
}

function mergeArtifacts(existing: Artifact[], incoming: Artifact[]): Artifact[] {
  const seen = new Set(existing.map((artifact) => artifact.id));
  const merged = [...existing];
  for (const artifact of incoming) {
    if (seen.has(artifact.id)) continue;
    seen.add(artifact.id);
    merged.push(artifact);
  }
  return merged.slice(0, MAX_ARTIFACTS);
}

function failInFlight(state: SessionState, summary: string): SessionState {
  return {
    ...state,
    pendingApproval: null,
    actions: state.actions.map((action) =>
      action.status === 'running' || action.status === 'awaiting-approval'
        ? {
            ...action,
            status: 'failed',
            result: { kind: 'failed', code: 'cancelled', summary, retryable: false },
          }
        : action,
    ),
  };
}

function applyEvent(state: SessionState, event: AgentVoiceEvent): SessionState {
  if (state.conversationId !== null && event.conversationId !== state.conversationId) {
    return dropped(state);
  }
  const bound =
    state.conversationId === null ? { ...state, conversationId: event.conversationId } : state;

  switch (event.type) {
    case 'conversation.started':
      return { ...bound, agentPresent: true };

    case 'user.transcript.partial':
    case 'user.transcript.final':
      return upsertTranscript(bound, {
        id: `user:${event.segmentId}`,
        role: 'user',
        text: event.text,
        final: event.type === 'user.transcript.final',
        ts: event.ts,
      });

    case 'agent.message.partial':
    case 'agent.message.final': {
      const turn = resolveAgentTurn(bound.agentTurns, event.messageId);
      const updated = { ...bound, agentTurns: turn.turns };
      const shown = updated.transcript.find((entry) => entry.id === turn.entryId);
      const final =
        turn.source === 'caption'
          ? event.type === 'agent.message.final' ||
            (turn.captionWasKnown && (shown?.final ?? false))
          : turn.hasCaption
            ? (shown?.final ?? false)
            : event.type === 'agent.message.final';
      return upsertTranscript(updated, {
        id: turn.entryId,
        role: 'agent',
        text: turn.useText ? event.text : (shown?.text ?? event.text),
        // Once captions exist, only their final packet can close the spoken
        // turn. A worker final may arrive while audio is still playing.
        final,
        ts: event.ts,
      });
    }

    case 'action.started': {
      if (bound.actions.some((action) => action.actionId === event.actionId)) return dropped(bound);
      const inFlight = bound.actions.some(
        (action) => action.status === 'running' || action.status === 'awaiting-approval',
      );
      if (inFlight) return dropped(bound);
      const record: ActionRecord = {
        actionId: event.actionId,
        title: event.title,
        adapter: event.adapter,
        startedAt: event.ts,
        status: 'running',
        progress: [],
        artifacts: [],
        cancelRequested: false,
      };
      return { ...bound, actions: bounded([...bound.actions, record], MAX_ACTIONS) };
    }

    case 'action.progress': {
      const next = updateAction(bound, event.actionId, (action) => ({
        ...action,
        progress: bounded(
          [
            ...action.progress,
            {
              message: event.message,
              ...(event.percent === undefined ? {} : { percent: event.percent }),
              ts: event.ts,
            },
          ],
          MAX_PROGRESS_ENTRIES,
        ),
      }));
      return next ?? dropped(bound);
    }

    case 'approval.requested': {
      const action = bound.actions.find((candidate) => candidate.actionId === event.actionId);
      if (!action || action.status !== 'running' || bound.pendingApproval) return dropped(bound);
      const withApproval = updateAction(bound, event.actionId, (current) => ({
        ...current,
        status: 'awaiting-approval',
        approval: { approvalId: event.approvalId },
      }));
      if (!withApproval) return dropped(bound);
      return {
        ...withApproval,
        pendingApproval: {
          approvalId: event.approvalId,
          actionId: event.actionId,
          title: action.title,
          prompt: event.prompt,
          requestedAt: event.ts,
          expiresAt: event.expiresAt,
        },
      };
    }

    case 'approval.resolved': {
      const pending = bound.pendingApproval;
      const matches =
        pending !== null &&
        pending.approvalId === event.approvalId &&
        pending.actionId === event.actionId;
      if (!matches) return dropped(bound);
      const next = updateAction(bound, event.actionId, (action) => ({
        ...action,
        status: event.decision === 'approved' ? 'running' : action.status,
        approval: { approvalId: event.approvalId, decision: event.decision },
      }));
      if (!next) return dropped(bound);
      return { ...next, pendingApproval: null };
    }

    case 'artifact.created': {
      const next = updateAction(bound, event.actionId, (action) => ({
        ...action,
        artifacts: mergeArtifacts(action.artifacts, [event.artifact]),
      }));
      return next ?? dropped(bound);
    }

    case 'action.verified': {
      const next = updateAction(bound, event.actionId, (action) => ({
        ...action,
        status: 'verified',
        artifacts: mergeArtifacts(action.artifacts, event.artifacts ?? []),
        result: {
          kind: 'verified',
          summary: event.summary,
          method: event.verification.method,
          ...(event.verification.detail === undefined ? {} : { detail: event.verification.detail }),
        },
      }));
      if (!next) return dropped(bound);
      const pending = next.pendingApproval;
      return pending?.actionId === event.actionId ? { ...next, pendingApproval: null } : next;
    }

    case 'action.failed': {
      const next = updateAction(bound, event.actionId, (action) => ({
        ...action,
        status: 'failed',
        result: {
          kind: 'failed',
          code: event.code,
          summary: event.summary,
          retryable: event.retryable,
        },
      }));
      if (!next) return dropped(bound);
      const pending = next.pendingApproval;
      return pending?.actionId === event.actionId ? { ...next, pendingApproval: null } : next;
    }

    case 'conversation.cancelled':
      return {
        ...failInFlight(bound, 'The conversation ended before this action completed.'),
        phase: 'ended',
        endReason: event.reason,
      };
  }
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'start':
      return {
        ...initialSessionState,
        phase: 'connecting',
        mode: action.mode,
        micEnabled: action.mode === 'voice',
      };

    case 'connected':
      return state.phase === 'connecting' ? { ...state, phase: 'connected' } : state;

    case 'agent_presence':
      return {
        ...state,
        agentPresent: action.present,
        activity: action.present ? state.activity : null,
      };

    case 'activity':
      return { ...state, activity: action.activity };

    case 'reconnecting':
      return isLive(state) ? { ...state, phase: 'reconnecting' } : state;

    case 'reconnected':
      return state.phase === 'reconnecting' ? { ...state, phase: 'connected' } : state;

    case 'disconnected':
      if (!isLive(state)) return state;
      return {
        ...failInFlight(state, 'The connection closed before this action completed.'),
        phase: 'ended',
        endReason: action.reason,
      };

    case 'failure':
      if (state.phase === 'ended' || state.phase === 'idle') return state;
      return {
        ...failInFlight(state, 'The session failed before this action completed.'),
        phase: 'error',
        error: action.error,
      };

    case 'mic':
      return {
        ...state,
        micEnabled: action.enabled,
        micError: action.enabled ? null : state.micError,
      };

    case 'mic_error':
      return {
        ...state,
        micError: action.message,
        micEnabled: action.message === null ? state.micEnabled : false,
      };

    case 'audio_blocked':
      return { ...state, audioBlocked: action.blocked };

    case 'user_text':
      return upsertTranscript(state, {
        id: action.id,
        role: 'user',
        text: action.text,
        final: true,
        ts: action.ts,
      });

    case 'event':
      return isLive(state) ? applyEvent(state, action.event) : dropped(state);

    case 'approval_submitting': {
      const pending = state.pendingApproval;
      if (
        !pending ||
        pending.approvalId !== action.approvalId ||
        pending.actionId !== action.actionId
      ) {
        return state;
      }
      return { ...state, pendingApproval: { ...pending, submitting: action.decision } };
    }

    case 'cancel_requested':
      return (
        updateAction(state, action.actionId, (record) => ({ ...record, cancelRequested: true })) ??
        state
      );

    case 'dropped':
      return dropped(state);

    case 'end':
      if (!isLive(state)) return state;
      return {
        ...failInFlight(state, 'You ended the session before this action completed.'),
        phase: 'ended',
        endReason: action.reason,
      };

    case 'reset':
      return initialSessionState;
  }
}
