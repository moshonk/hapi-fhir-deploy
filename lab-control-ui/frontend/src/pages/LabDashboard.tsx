// T035: wires action buttons to the trigger endpoint. A refused trigger
// (wrong-prerequisite 412, or the CLI's own runtime refusal captured once
// the run finishes, e.g. the T2-before-T3 eCHIS tier guard) is shown using
// the server's own error text verbatim -- this component never rewords it
// into a separately-derived message (FR-006).

import { useState } from 'react';
import { ActionList } from '../components/ActionList.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { LogViewer } from '../components/LogViewer.js';
import { PrerequisitePanel } from '../components/PrerequisitePanel.js';
import { usePrerequisites } from '../hooks/usePrerequisites.js';
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

export function LabDashboard({ provider, lab, runs, onRunTriggered }: LabDashboardProps) {
  const { checks, error: prereqError } = usePrerequisites(provider.id);
  const [pendingConfirm, setPendingConfirm] = useState<ActionDef | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runningActionName, setRunningActionName] = useState<string | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  async function fire(action: ActionDef, confirmed: boolean) {
    setTriggerError(null);
    try {
      const result = await triggerAction(lab.id, action.name, { confirmed });
      setActiveRunId(result.actionRunId);
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
          setPendingConfirm(action);
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
    if (action.requiresConfirmation) {
      setPendingConfirm(action);
      return;
    }
    void fire(action, false);
  }

  function handleConfirm() {
    const action = pendingConfirm;
    setPendingConfirm(null);
    if (action) void fire(action, true);
  }

  function handleRunStatus() {
    setRunningActionName(null);
    onRunTriggered();
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

      {pendingConfirm && pendingConfirm.confirmationMessage && (
        <ConfirmDialog
          actionLabel={pendingConfirm.label}
          message={pendingConfirm.confirmationMessage}
          onConfirm={handleConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}

      {activeRunId && (
        <div className="active-run">
          <h2>Live output</h2>
          <LogViewer key={activeRunId} runId={activeRunId} onStatus={handleRunStatus} />
        </div>
      )}
    </section>
  );
}
