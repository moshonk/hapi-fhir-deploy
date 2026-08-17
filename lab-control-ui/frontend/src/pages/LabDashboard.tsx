// T035: wires action buttons to the trigger endpoint. A refused trigger
// (wrong-prerequisite 412, or the CLI's own runtime refusal captured once
// the run finishes, e.g. the T2-before-T3 eCHIS tier guard) is shown using
// the server's own error text verbatim -- this component never rewords it
// into a separately-derived message (FR-006).

import { useState } from 'react';
import { ActionList } from '../components/ActionList.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { ExposurePanel } from '../components/ExposurePanel.js';
import { LogViewer } from '../components/LogViewer.js';
import { PrerequisitePanel } from '../components/PrerequisitePanel.js';
import { DURATION_TRACKED_ACTIONS, RunDuration } from '../components/RunDuration.js';
import { usePrerequisites } from '../hooks/usePrerequisites.js';
import { useExposures } from '../hooks/useExposures.js';
import { ApiError, triggerAction } from '../api/client.js';
import type {
  ActionDef,
  ActionRunSummary,
  LabConfiguration,
  ProviderPublicShape,
} from '../api/types.js';

export interface LabDashboardProps {
  provider: ProviderPublicShape;
  lab: LabConfiguration;
  runs: ActionRunSummary[];
  onRunTriggered: () => void;
}

interface PendingConfirm {
  action: ActionDef;
  /** Resolved against this lab's live field values by the server (FR-012)
   * -- e.g. names the actual configured expose_source_ranges, not a
   * generic warning. Never the raw {field_key}-templated ActionDef string. */
  message: string;
}

interface ActiveRun {
  id: string;
  action: ActionDef;
  /** Client-clock timestamps -- close enough to the server's own
   * action_runs.started_at/ended_at (spawnAction/markActionRunFinished run
   * essentially synchronously with the 202 response and the SSE `status`
   * event) without a second round-trip just to read them back. RunHistory
   * shows the authoritative server timestamps once this run lands there. */
  startedAt: string;
  endedAt: string | null;
}

export function LabDashboard({ provider, lab, runs, onRunTriggered }: LabDashboardProps) {
  const { checks, error: prereqError } = usePrerequisites(provider.id);
  const { exposures, error: exposuresError, refresh: refreshExposures } = useExposures(lab.id);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [runningActionName, setRunningActionName] = useState<string | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  async function fire(action: ActionDef, confirmed: boolean) {
    setTriggerError(null);
    try {
      const result = await triggerAction(lab.id, action.name, { confirmed });
      setActiveRun({ id: result.actionRunId, action, startedAt: new Date().toISOString(), endedAt: null });
      setRunningActionName(action.name);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.body &&
        typeof err.body === 'object'
      ) {
        const body = err.body as { confirmationMessage?: string };
        if (body.confirmationMessage) {
          // Show the dialog with the SERVER-RESOLVED message (live field
          // values already interpolated) rather than a static template.
          setPendingConfirm({ action, message: body.confirmationMessage });
          return;
        }
      }
      // Surfaces the server's own error text verbatim (FR-006) -- includes
      // 412 prerequisite-blocked and 409 already-running responses too.
      setTriggerError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleTrigger(action: ActionDef) {
    if (!lab.launchable) {
      setTriggerError('Fill in every required field before triggering actions.');
      return;
    }
    // Always attempt unconfirmed first -- for actions requiring confirmation
    // this deliberately gets refused with a 409 carrying the server-resolved
    // confirmationMessage, which fire()'s catch block turns into the dialog
    // above. There's no local shortcut using the (unresolved) static
    // ActionDef.confirmationMessage from GET /api/providers.
    void fire(action, false);
  }

  function handleConfirm() {
    const pending = pendingConfirm;
    setPendingConfirm(null);
    if (pending) void fire(pending.action, true);
  }

  function handleRunStatus() {
    setRunningActionName(null);
    // Locks the duration display: from this point on RunDuration is given
    // a non-null endedAt and stops ticking, however long this panel stays
    // mounted afterward.
    setActiveRun((prev) => (prev ? { ...prev, endedAt: new Date().toISOString() } : prev));
    onRunTriggered();
    // Whatever just finished might have been an expose-*/unexpose-*
    // action -- re-check rather than waiting out useExposures' own poll
    // interval, so the link/credentials panel updates right away.
    refreshExposures();
  }

  return (
    <section aria-label="Lab dashboard">
      <h2>Prerequisites</h2>
      <PrerequisitePanel checks={checks} error={prereqError} />

      <h2>Actions</h2>
      {triggerError && (
        <p className="error" role="alert">
          {triggerError}
        </p>
      )}
      <ActionList
        actions={provider.actions}
        runs={runs}
        prereqChecks={checks ?? []}
        runningActionName={runningActionName}
        onTrigger={handleTrigger}
      />

      <ExposurePanel exposures={exposures} error={exposuresError} />

      {pendingConfirm && (
        <ConfirmDialog
          actionLabel={pendingConfirm.action.label}
          message={pendingConfirm.message}
          onConfirm={handleConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}

      {activeRun && (
        <div className="active-run">
          <h2>
            Live output
            {DURATION_TRACKED_ACTIONS.has(activeRun.action.name) && (
              <RunDuration startedAt={activeRun.startedAt} endedAt={activeRun.endedAt} />
            )}
          </h2>
          <LogViewer key={activeRun.id} runId={activeRun.id} onStatus={handleRunStatus} />
        </div>
      )}
    </section>
  );
}
