import type { PendingApproval } from '@/lib/client/session-state';

export interface ApprovalCardProps {
  approval: PendingApproval | null;
  onRespond: (approvalId: string, actionId: string, decision: 'approved' | 'rejected') => void;
}

/**
 * Always bound to the exact `approvalId` + `actionId` pair that was
 * requested. There is no "approve everything" affordance here.
 */
export function ApprovalCard({ approval, onRespond }: ApprovalCardProps) {
  if (!approval) return null;
  const submitting = approval.submitting;

  return (
    <div
      className="approval-card"
      role="alert"
      data-action-id={approval.actionId}
      data-approval-id={approval.approvalId}
    >
      <p className="approval-card__eyebrow">Approval needed</p>
      <h3 className="approval-card__title">{approval.title}</h3>
      <p className="approval-card__prompt">{approval.prompt}</p>
      <div className="approval-card__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={submitting !== undefined}
          aria-busy={submitting === 'approved'}
          onClick={() => onRespond(approval.approvalId, approval.actionId, 'approved')}
        >
          Approve
        </button>
        <button
          type="button"
          className="button button--danger"
          disabled={submitting !== undefined}
          aria-busy={submitting === 'rejected'}
          onClick={() => onRespond(approval.approvalId, approval.actionId, 'rejected')}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
