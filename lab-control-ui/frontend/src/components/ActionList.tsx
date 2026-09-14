// T032: renders the provider's ActionDefs, disabled based on two distinct
// inputs, kept separate so neither is silently dropped:
//   (a) prerequisite/confirmation gating (FR-011/012) -- handled by the
//       backend at trigger time regardless, this is just an upfront hint.
//   (b) prior-Action-Run-outcome sequencing hints (spec.md Edge Case 3),
//       e.g. `seed` stays disabled until this lab's most recent `deploy`
//       run succeeded -- derived from run history the UI already owns via
//       ActionDef.sequenceAfter, never a re-implementation of CLI validation.

import { useState } from 'react';
import type { ActionDef, ActionGroupId, ActionRunSummary, PrereqCheck } from '../api/types.js';

// Display order and heading text for ActionDef.group -- 'other' is a
// catch-all for an action a provider hasn't assigned a group to yet, so
// grouping degrades gracefully instead of dropping it. Roughly follows an
// operator's actual workflow: bring infrastructure up, load data (pausing
// autoscaling first if it's a bulk load), benchmark it, then manage public
// exposure -- lifecycle's teardown (`down`) lives at the end of that same
// group rather than getting its own section.
const ACTION_GROUP_ORDER: Array<ActionGroupId | 'other'> = [
  'lifecycle',
  'data',
  'scaling',
  'benchmark',
  'exposure',
  'other',
];

const ACTION_GROUP_LABELS: Record<ActionGroupId | 'other', string> = {
  lifecycle: 'Infrastructure lifecycle',
  data: 'Data',
  scaling: 'Scaling',
  benchmark: 'Benchmarking',
  exposure: 'Public exposure',
  other: 'Other',
};

function groupActions(
  actions: ActionDef[],
): Array<{ id: ActionGroupId | 'other'; actions: ActionDef[] }> {
  const byGroup = new Map<ActionGroupId | 'other', ActionDef[]>();
  for (const action of actions) {
    const id = action.group ?? 'other';
    const bucket = byGroup.get(id);
    if (bucket) bucket.push(action);
    else byGroup.set(id, [action]);
  }
  return ACTION_GROUP_ORDER.filter((id) => byGroup.has(id)).map((id) => ({
    id,
    actions: byGroup.get(id)!,
  }));
}

export interface ActionTriggerOptions {
  inCluster?: boolean;
  parallelShards?: number;
  restoreFromBackup?: boolean;
  backupDir?: string;
}

export interface ActionListProps {
  actions: ActionDef[];
  runs: ActionRunSummary[];
  prereqChecks: PrereqCheck[];
  runningActionName: string | null;
  /** This lab's own name and provider id, used only to prefill (never to
   * authoritatively compute) the default database backup directory shown
   * below -- mirrors gcp.ts's kubeconfigPathFor path convention
   * (`ansible/artifacts/lab/{provider}/{lab_name}/...`). If the operator
   * leaves it untouched, scripts/lab lands on this exact same default
   * itself when --backup-dir is omitted, so the two never actually diverge
   * in practice. Optional so callers that never render `seed`/`backup-db`
   * (e.g. tests exercising only `benchmark`) don't need to supply them. */
  labName?: string;
  providerId?: string;
  onTrigger: (action: ActionDef, options?: ActionTriggerOptions) => void;
}

function defaultBackupDir(providerId: string, labName: string): string {
  return `ansible/artifacts/lab/${providerId}/${labName}/db-backup`;
}

function latestStatusFor(
  runs: ActionRunSummary[],
  actionName: string,
): ActionRunSummary['status'] | undefined {
  return runs.find((r) => r.action_name === actionName)?.status;
}

function anyRunEverSucceeded(runs: ActionRunSummary[], actionName: string): boolean {
  return runs.some((r) => r.action_name === actionName && r.status === 'succeeded');
}

export function ActionList({
  actions,
  runs,
  prereqChecks,
  runningActionName,
  labName = '',
  providerId = '',
  onTrigger,
}: ActionListProps) {
  // Trigger-time-only, not persisted lab config (gcp.ts's 'benchmark' case
  // doc comment) -- one benchmark action exists per provider, so a single
  // pair of hooks here (rather than per-list-item) is sufficient.
  const [inCluster, setInCluster] = useState(false);
  const [parallelShards, setParallelShards] = useState(1);

  // Same pattern for seed's restore-from-backup choice and backup-db's
  // destination -- both ephemeral, both share one prefilled directory
  // default so a backup taken via "Backup database" is exactly where
  // "Seed synthetic data" looks for it without the operator retyping it.
  const [restoreFromBackup, setRestoreFromBackup] = useState(false);
  const [seedBackupDir, setSeedBackupDir] = useState(() => defaultBackupDir(providerId, labName));
  const [backupDbDir, setBackupDbDir] = useState(() => defaultBackupDir(providerId, labName));

  function renderAction(action: ActionDef) {
    const failingPrereq = prereqChecks.find(
      (c) => action.requiredPrerequisiteIds.includes(c.id) && c.status === 'fail',
    );
    const sequenceBlocked =
      action.sequenceAfter !== undefined &&
      (action.sequenceAfterAnySuccess
        ? !anyRunEverSucceeded(runs, action.sequenceAfter)
        : latestStatusFor(runs, action.sequenceAfter) !== 'succeeded');
    const alreadyRunningThis = runningActionName === action.name;
    const anotherActionRunning = runningActionName !== null && runningActionName !== action.name;

    const disabled =
      Boolean(failingPrereq) || sequenceBlocked || alreadyRunningThis || anotherActionRunning;
    let reason: string | null = null;
    if (alreadyRunningThis) reason = 'already running';
    else if (anotherActionRunning) reason = `waiting on ${runningActionName}`;
    else if (failingPrereq) reason = `blocked: ${failingPrereq.label} is not available`;
    else if (sequenceBlocked) reason = `run ${action.sequenceAfter} successfully first`;

    const isBenchmark = action.name === 'benchmark';
    const isSeed = action.name === 'seed';
    const isBackupDb = action.name === 'backup-db';

    // The description is a layman-facing "what does this button do"
    // tooltip; `reason` is an operator-facing "why is this greyed out"
    // one -- shown together (description first) rather than one
    // replacing the other, since disabled buttons should still explain
    // themselves on hover.
    const tooltip = [action.description, reason].filter(Boolean).join('\n\n') || undefined;

    return (
      <li key={action.name} className="action-item">
        {isSeed && (
          <div className="seed-options">
            <label>
              <input
                type="checkbox"
                checked={restoreFromBackup}
                onChange={(e) => setRestoreFromBackup(e.target.checked)}
              />
              Restore from backup instead of generating new data
            </label>
            {restoreFromBackup && (
              <label className="seed-backup-dir">
                Backup directory
                <input
                  type="text"
                  value={seedBackupDir}
                  onChange={(e) => setSeedBackupDir(e.target.value)}
                />
              </label>
            )}
            {restoreFromBackup && (
              <p className="help-text">
                Restores a prior <strong>Backup database</strong> directory-format dump straight
                into the database instead of regenerating and re-loading synthetic data -- much
                faster on repeat runs. The directory must have been produced by
                <strong> Backup database</strong> against this same lab.
              </p>
            )}
          </div>
        )}
        {isBackupDb && (
          <div className="backup-db-options">
            <label className="seed-backup-dir">
              Backup directory
              <input
                type="text"
                value={backupDbDir}
                onChange={(e) => setBackupDbDir(e.target.value)}
              />
            </label>
            <p className="help-text">
              Overwrites any existing backup already at this path. Point{' '}
              <strong>Seed synthetic data</strong>'s "Restore from backup" at the same directory on
              a later run to reuse it.
            </p>
          </div>
        )}
        {isBenchmark && (
          <div className="benchmark-options">
            <label>
              <input
                type="checkbox"
                checked={inCluster}
                onChange={(e) => setInCluster(e.target.checked)}
              />
              Run in-cluster
            </label>
            {inCluster && (
              <label className="benchmark-shards">
                Parallel shards
                <input
                  type="number"
                  min={1}
                  value={parallelShards}
                  onChange={(e) => setParallelShards(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
            )}
            {inCluster && (
              <p className="help-text">
                Runs as Kubernetes Job shard(s) inside the cluster, hitting the FHIR Service by its
                cluster-DNS name so traffic is load-balanced across every backing pod (unlike the
                default local `kubectl port-forward` run, which pins all traffic to one pod). Each
                shard runs the T2-scale script (~100 VUs); more than 1 shard requires a
                ReadWriteMany PVC (e.g. GCP Filestore) backing `echis-shard-output` -- plain GCE PD
                storage only supports 1. Run <strong>Provision RWX shard storage</strong> below
                first if it doesn't exist yet.
              </p>
            )}
          </div>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (isBenchmark) {
              onTrigger(action, { inCluster, parallelShards });
            } else if (isSeed) {
              onTrigger(
                action,
                restoreFromBackup ? { restoreFromBackup, backupDir: seedBackupDir } : undefined,
              );
            } else if (isBackupDb) {
              onTrigger(action, { backupDir: backupDbDir });
            } else {
              onTrigger(action, undefined);
            }
          }}
          title={tooltip}
        >
          {action.label}
        </button>
        {reason && <span className="action-reason">{reason}</span>}
      </li>
    );
  }

  return (
    <>
      {groupActions(actions).map(({ id, actions: groupedActions }) => (
        <div className="action-group" key={id}>
          <h3 className="action-group-label">{ACTION_GROUP_LABELS[id]}</h3>
          <ul className="action-list">{groupedActions.map(renderAction)}</ul>
        </div>
      ))}
    </>
  );
}
