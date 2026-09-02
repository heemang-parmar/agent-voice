import type { ApprovalDecision, Artifact, FailureCode, Verification } from '@agent-voice/protocol';

/** What the voice layer hands to an adapter. Text is already bounded. */
export interface AdapterRequest {
  conversationId: string;
  actionId: string;
  /** The user's request, as understood by the voice model. */
  text: string;
  /** Stable, configurable key that lets the agent keep memory across turns. */
  sessionKey: string;
  locale?: string;
}

export interface ApprovalRequest {
  prompt: string;
  /** How long the user has to answer. Always capped by the action deadline. */
  expiresInMs?: number;
}

/**
 * Everything an adapter can do while it runs. Progress and artifacts are
 * fire-and-forget; approvals block until the user answers or the request
 * expires. All of it is ignored once the action has reached a terminal state.
 */
export interface ActionContext {
  readonly signal: AbortSignal;
  /** Epoch milliseconds after which the action is failed with `timeout`. */
  readonly deadline: number;
  progress(message: string, percent?: number): void;
  artifact(artifact: Artifact): void;
  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>;
}

export type AdapterStatus = 'verified' | 'failed' | 'unavailable' | 'cancelled';

export interface AdapterResult {
  status: AdapterStatus;
  /** Short, speakable, user-facing summary. Never raw error text. */
  summary: string;
  /** Must be `verified` for a `verified` status; the runner enforces it. */
  verification: Verification;
  artifacts: Artifact[];
  /** Optional finer-grained failure reason; defaults are derived from `status`. */
  code?: FailureCode;
  retryable?: boolean;
}

export interface AgentAdapter {
  readonly name: string;
  run(request: AdapterRequest, context: ActionContext): Promise<AdapterResult>;
}
