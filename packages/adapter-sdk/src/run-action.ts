import { randomBytes } from 'node:crypto';

import {
  LIMITS,
  parseEvent,
  type AgentVoiceEvent,
  type Artifact,
  type FailureCode,
} from '@agent-voice/protocol';

import type { ApprovalBroker } from './approvals.js';
import type { ActionContext, AdapterRequest, AdapterResult, AgentAdapter } from './types.js';

export interface RunActionOptions {
  adapter: AgentAdapter;
  request: Omit<AdapterRequest, 'actionId'> & { actionId?: string };
  /** Short label for the action timeline. */
  title: string;
  timeoutMs: number;
  /** Receives every validated event, in order. Must not throw. */
  emit: (event: AgentVoiceEvent) => void;
  approvals: ApprovalBroker;
  /** External cancellation (user pressed cancel, conversation ended). */
  signal?: AbortSignal;
  /** Default approval window when the adapter does not specify one. */
  approvalTimeoutMs?: number;
  newId?: () => string;
  now?: () => number;
}

export interface ActionOutcome {
  actionId: string;
  result: AdapterResult;
}

/** Speakable, generic summaries. Never derived from exception text. */
export const GENERIC_SUMMARIES: Record<FailureCode, string> = {
  failed: 'The agent could not complete that, so nothing was changed.',
  unavailable: 'The agent is not reachable right now, so nothing was changed.',
  timeout: 'The agent took too long to respond, so I stopped waiting.',
  cancelled: 'Cancelled. Nothing further was changed.',
  rejected: 'You declined, so nothing was changed.',
  expired: 'The approval expired, so nothing was changed.',
  invalid: 'I could not pass that request to the agent.',
};

export function defaultNewId(): string {
  return randomBytes(9).toString('base64url');
}

class ActionAbort extends Error {
  constructor(readonly code: 'timeout' | 'cancelled') {
    super(code);
    this.name = 'ActionAbort';
  }
}

function clampText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function speakable(summary: string, fallback: string): string {
  const trimmed = summary.trim();
  return clampText(trimmed.length > 0 ? trimmed : fallback, LIMITS.maxTextChars);
}

function failureCodeFor(result: AdapterResult): FailureCode {
  if (result.code) return result.code;
  switch (result.status) {
    case 'unavailable':
      return 'unavailable';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'failed';
  }
}

/**
 * Runs one delegated action end to end and turns everything the adapter does
 * into protocol events. Guarantees: exactly one `action.started`, exactly one
 * terminal event (`action.verified` or `action.failed`), nothing after the
 * terminal event, a hard deadline, and no adapter exception text on the wire.
 */
export async function runAction(options: RunActionOptions): Promise<ActionOutcome> {
  const newId = options.newId ?? defaultNewId;
  const now = options.now ?? Date.now;
  const actionId = options.request.actionId ?? `act_${newId()}`;
  const conversationId = options.request.conversationId;
  const startedAt = now();
  const deadline = startedAt + options.timeoutMs;
  const approvalWindow = options.approvalTimeoutMs ?? Math.min(120_000, options.timeoutMs);

  let terminal = false;
  let artifactCount = 0;
  const emit = (event: AgentVoiceEvent) => {
    if (terminal) return;
    const checked = parseEvent(event);
    if (checked.ok) options.emit(checked.value);
  };
  const envelope = () => ({
    v: 1 as const,
    id: `evt_${newId()}`,
    ts: new Date(now()).toISOString(),
    conversationId,
  });

  const controller = new AbortController();
  const abort = (code: 'timeout' | 'cancelled') => {
    if (!controller.signal.aborted) controller.abort(new ActionAbort(code));
  };
  const onExternalAbort = () => {
    abort('cancelled');
  };
  const timer = setTimeout(() => {
    abort('timeout');
  }, options.timeoutMs);
  if (options.signal?.aborted) abort('cancelled');
  else options.signal?.addEventListener('abort', onExternalAbort, { once: true });

  const finish = (result: AdapterResult): ActionOutcome => {
    const summaryFallback = GENERIC_SUMMARIES[failureCodeFor(result)];
    if (result.status === 'verified' && result.verification.state === 'verified') {
      const artifacts = result.artifacts.slice(0, LIMITS.maxArtifacts);
      emit({
        ...envelope(),
        type: 'action.verified',
        actionId,
        summary: speakable(result.summary, 'Done.'),
        verification: {
          state: 'verified',
          method: clampText(result.verification.method, LIMITS.maxLabelChars),
          ...(result.verification.detail !== undefined
            ? { detail: clampText(result.verification.detail, 1000) }
            : {}),
        },
        ...(artifacts.length > 0 ? { artifacts } : {}),
      });
      terminal = true;
      return { actionId, result: { ...result, artifacts } };
    }
    // A "verified" status without verified evidence is a failure to verify.
    const normalized: AdapterResult =
      result.status === 'verified'
        ? {
            ...result,
            status: 'failed',
            code: 'failed',
            summary: 'The agent responded, but the result could not be verified.',
            verification: { ...result.verification, state: 'unverified' },
          }
        : result;
    const code = failureCodeFor(normalized);
    emit({
      ...envelope(),
      type: 'action.failed',
      actionId,
      code,
      summary: speakable(normalized.summary, summaryFallback),
      retryable: normalized.retryable ?? (code === 'unavailable' || code === 'timeout'),
    });
    terminal = true;
    return { actionId, result: normalized };
  };

  const failWith = (code: FailureCode): ActionOutcome =>
    finish({
      status:
        code === 'cancelled' ? 'cancelled' : code === 'unavailable' ? 'unavailable' : 'failed',
      code,
      summary: GENERIC_SUMMARIES[code],
      verification: { state: 'unverified', method: options.adapter.name },
      artifacts: [],
    });

  emit({
    ...envelope(),
    type: 'action.started',
    actionId,
    title: clampText(options.title.trim() || 'Delegated action', LIMITS.maxLabelChars),
    adapter: clampText(options.adapter.name, LIMITS.maxLabelChars),
  });

  const cleanup = () => {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
    options.approvals.expireAction(actionId);
  };

  const text = options.request.text;
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > LIMITS.maxTextChars) {
    const outcome = failWith('invalid');
    cleanup();
    return outcome;
  }
  if (controller.signal.aborted) {
    const outcome = failWith('cancelled');
    cleanup();
    return outcome;
  }

  const context: ActionContext = {
    signal: controller.signal,
    deadline,
    progress(message, percent) {
      if (terminal) return;
      const trimmed = message.trim();
      if (trimmed.length === 0) return;
      emit({
        ...envelope(),
        type: 'action.progress',
        actionId,
        message: clampText(trimmed, LIMITS.maxMessageChars),
        ...(percent !== undefined && Number.isFinite(percent)
          ? { percent: Math.min(100, Math.max(0, percent)) }
          : {}),
      });
    },
    artifact(artifact: Artifact) {
      if (terminal || artifactCount >= LIMITS.maxArtifacts) return;
      artifactCount += 1;
      emit({ ...envelope(), type: 'artifact.created', actionId, artifact });
    },
    async requestApproval(request) {
      if (terminal || controller.signal.aborted) return 'expired';
      const approvalId = `apr_${newId()}`;
      const window = request.expiresInMs ?? approvalWindow;
      const expiresAt = Math.min(now() + Math.max(0, window), deadline);
      emit({
        ...envelope(),
        type: 'approval.requested',
        actionId,
        approvalId,
        prompt: clampText(request.prompt.trim() || 'Approve this action?', LIMITS.maxMessageChars),
        expiresAt: new Date(expiresAt).toISOString(),
      });
      const decision = await options.approvals.request(
        { actionId, approvalId, expiresAt },
        controller.signal,
      );
      emit({
        ...envelope(),
        type: 'approval.resolved',
        actionId,
        approvalId,
        decision,
        resolvedBy: decision === 'expired' ? 'system' : 'user',
      });
      return decision;
    },
  };

  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      'abort',
      () => {
        reject(controller.signal.reason as Error);
      },
      { once: true },
    );
  });

  try {
    const result = await Promise.race([
      Promise.resolve().then(() => options.adapter.run({ ...options.request, actionId }, context)),
      aborted,
    ]);
    return finish(result);
  } catch (error) {
    if (error instanceof ActionAbort) return failWith(error.code);
    return failWith('failed');
  } finally {
    cleanup();
  }
}
