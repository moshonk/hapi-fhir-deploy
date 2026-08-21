// T032: renders the provider's ActionDefs, disabled based on two distinct
// inputs, kept separate so neither is silently dropped:
//   (a) prerequisite/confirmation gating (FR-011/012) -- handled by the
//       backend at trigger time regardless, this is just an upfront hint.
//   (b) prior-Action-Run-outcome sequencing hints (spec.md Edge Case 3),
//       e.g. `seed` stays disabled until this lab's most recent `deploy`
//       run succeeded -- derived from run history the UI already owns via
//       ActionDef.sequenceAfter, never a re-implementation of CLI validation.

import { useState } from 'react';
import type { ActionDef, ActionRunSummary, PrereqCheck } from '../api/types.js';

export interface BenchmarkTriggerOptions {
  inCluster?: boolean;
  parallelShards?: number;
}

export interface ActionListProps {
  actions: ActionDef[];
  runs: ActionRunSummary[];
  prereqChecks: PrereqCheck[];
  runningActionName: string | null;
  onTrigger: (action: ActionDef, benchmarkOptions?: BenchmarkTriggerOptions) => void;
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
  // Trigger-time-only, not persisted lab config (gcp.ts's 'benchmark' case
  // doc comment) -- one benchmark action exists per provider, so a single
  // pair of hooks here (rather than per-list-item) is sufficient.
  const [inCluster, setInCluster] = useState(false);
  const [parallelShards, setParallelShards] = useState(1);

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

        const isBenchmark = action.name === 'benchmark';

        return (
          <li key={action.name} className="action-item">
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
                    Runs as Kubernetes Job shard(s) inside the cluster, hitting the FHIR Service by
                    its cluster-DNS name so traffic is load-balanced across every backing pod
                    (unlike the default local `kubectl port-forward` run, which pins all traffic to
                    one pod). Each shard runs the T2-scale script (~100 VUs); more than 1 shard
                    requires a ReadWriteMany PVC (e.g. GCP Filestore) backing `echis-shard-output`
                    -- plain GCE PD storage only supports 1. Run{' '}
                    <strong>Provision RWX shard storage</strong> below first if it doesn't exist
                    yet.
                  </p>
                )}
              </div>
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                onTrigger(action, isBenchmark ? { inCluster, parallelShards } : undefined)
              }
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
