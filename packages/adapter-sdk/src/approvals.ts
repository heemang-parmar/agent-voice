import type { ApprovalDecision } from '@agent-voice/protocol';

export interface PendingApproval {
  actionId: string;
  approvalId: string;
  expiresAt: number;
}

export interface ApprovalResponse {
  actionId: string;
  approvalId: string;
  decision: 'approved' | 'rejected';
}

interface Entry extends PendingApproval {
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Matches approval answers to pending requests. An answer only counts when it
 * names the exact action *and* approval that is pending, and each request can
 * be answered once; everything else is ignored. There is deliberately no way
 * to pre-approve or approve "all".
 */
export class ApprovalBroker {
  private readonly pending = new Map<string, Entry>();

  /** Registers a request and resolves with the decision, or `expired` at `expiresAt`. */
  request(pending: PendingApproval, signal?: AbortSignal): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      const settle = (decision: ApprovalDecision) => {
        const entry = this.pending.get(pending.approvalId);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(pending.approvalId);
        signal?.removeEventListener('abort', onAbort);
        resolve(decision);
      };
      const onAbort = () => {
        settle('expired');
      };
      const delay = Math.max(0, pending.expiresAt - Date.now());
      const timer = setTimeout(() => {
        settle('expired');
      }, delay);
      this.pending.set(pending.approvalId, { ...pending, resolve: settle, timer });
      if (signal?.aborted) {
        settle('expired');
      } else {
        signal?.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  /** Applies a user decision. Returns `false` when nothing matching is pending. */
  resolve(response: ApprovalResponse): boolean {
    const entry = this.pending.get(response.approvalId);
    if (entry?.actionId !== response.actionId) return false;
    if (Date.now() >= entry.expiresAt) {
      entry.resolve('expired');
      return false;
    }
    entry.resolve(response.decision);
    return true;
  }

  /** Expires every pending approval for an action (used on cancellation). */
  expireAction(actionId: string): void {
    for (const entry of [...this.pending.values()]) {
      if (entry.actionId === actionId) entry.resolve('expired');
    }
  }

  pendingFor(actionId: string): PendingApproval[] {
    return [...this.pending.values()]
      .filter((entry) => entry.actionId === actionId)
      .map(({ actionId: id, approvalId, expiresAt }) => ({ actionId: id, approvalId, expiresAt }));
  }
}
