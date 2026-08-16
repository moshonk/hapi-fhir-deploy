// T032: renders the provider's ActionDefs, disabled based on two distinct
// inputs, kept separate so neither is silently dropped:
//   (a) prerequisite/confirmation gating (FR-011/012) -- handled by the
//       backend at trigger time regardless, this is just an upfront hint.
//   (b) prior-Action-Run-outcome sequencing hints (spec.md Edge Case 3),
//       e.g. `seed` stays disabled until this lab's most recent `deploy`
//       run succeeded -- derived from run history the UI already owns via
//       ActionDef.sequenceAfter, never a re-implementation of CLI validation.

import type { ActionDef, ActionRunSummary, PrereqCheck } from '../api/types.js';

export interface ActionListProps {
  actions: ActionDef[];
  runs: ActionRunSummary[];
  prereqChecks: PrereqCheck[];
  runningActionName: string | null;
  onTrigger: (action: ActionDef) => void;
}

function latestStatusFor(
  runs: ActionRunSummary[],
  actionName: string,
): ActionRunSummary['status'] | undefined {
  return runs.find((r) => r.action_name === actionName)?.status;
}

export function ActionList({
  actions,
  runs,
  prereqChecks,
  runningActionName,
  onTrigger,
}: ActionListProps) {
  return (
    <ul className="action-list">
      {actions.map((action) => {
        const failingPrereq = prereqChecks.find(
          (c) => action.requiredPrerequisiteIds.includes(c.id) && c.status === 'fail',
        );
        const sequenceBlocked =
          action.sequenceAfter !== undefined &&
          latestStatusFor(runs, action.sequenceAfter) !== 'succeeded';
        const alreadyRunningThis = runningActionName === action.name;
        const anotherActionRunning =
          runningActionName !== null && runningActionName !== action.name;

        const disabled =
          Boolean(failingPrereq) || sequenceBlocked || alreadyRunningThis || anotherActionRunning;
        let reason: string | null = null;
        if (alreadyRunningThis) reason = 'already running';
        else if (anotherActionRunning) reason = `waiting on ${runningActionName}`;
        else if (failingPrereq) reason = `blocked: ${failingPrereq.label} is not available`;
        else if (sequenceBlocked) reason = `run ${action.sequenceAfter} successfully first`;

        return (
          <li key={action.name} className="action-item">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onTrigger(action)}
              title={reason ?? undefined}
            >
              {action.label}
            </button>
            {reason && <span className="action-reason">{reason}</span>}
          </li>
        );
      })}
    </ul>
  );
}
