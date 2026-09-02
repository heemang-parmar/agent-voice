import type { ActionRecord } from '@/lib/client/session-state';

export interface ActionTimelineProps {
  actions: ActionRecord[];
  onCancel: (actionId: string) => void;
}

const STATUS_LABEL: Record<ActionRecord['status'], string> = {
  running: 'Working',
  'awaiting-approval': 'Awaiting approval',
  verified: 'Verified',
  failed: 'Failed',
};

function canCancel(action: ActionRecord): boolean {
  return (
    (action.status === 'running' || action.status === 'awaiting-approval') &&
    !action.cancelRequested
  );
}

export function ActionTimeline({ actions, onCancel }: ActionTimelineProps) {
  if (actions.length === 0) {
    return (
      <div className="action-timeline action-timeline--empty">
        <p>No actions yet.</p>
      </div>
    );
  }

  return (
    <ol className="action-timeline" aria-label="Action timeline">
      {actions.map((action) => (
        <li key={action.actionId} className="action-timeline__item" data-status={action.status}>
          <div className="action-timeline__header">
            <span className="action-timeline__title">{action.title}</span>
            <span className={`action-timeline__status action-timeline__status--${action.status}`}>
              {STATUS_LABEL[action.status]}
            </span>
          </div>
          {action.progress.length > 0 ? (
            <ul className="action-timeline__progress">
              {action.progress.map((step, index) => (
                <li key={index}>{step.message}</li>
              ))}
            </ul>
          ) : null}
          {action.result?.kind === 'verified' ? (
            <p className="action-timeline__result action-timeline__result--verified">
              {action.result.summary}
            </p>
          ) : null}
          {action.result?.kind === 'failed' ? (
            <p className="action-timeline__result action-timeline__result--failed">
              {action.result.summary}
            </p>
          ) : null}
          {canCancel(action) ? (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => onCancel(action.actionId)}
            >
              Cancel
            </button>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
