// POST /api/labs/:id/actions/:actionName (T026, T037). Enforces
// confirmation (FR-012) and live prerequisite gating (FR-011, A1: re-runs
// doctor at trigger time rather than trusting a frontend-cached value) before
// spawning via the runner, and the runner's own concurrency lock (FR-016).

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { getProvider } from '../providers/registry.js';
import {
  buildCommand,
  formatCommandPreview,
  resolveConfirmationMessage,
} from '../actions/commandBuilder.js';
import { currentlyRunning, spawnAction } from '../actions/runner.js';
import {
  createActionRun,
  getActionRun,
  getLabConfiguration,
  latestSucceededActionRun,
} from '../db/queries.js';
import { runDoctor } from './prerequisites.js';
import type { AppDeps } from '../app.js';

/**
 * `report` (and, in principle, any future action referencing a prior run's
 * artifacts by --run) needs to reuse that PRIOR run's cliRunLabel, not
 * generate a fresh one -- generating a fresh label would point `report` at
 * a run directory `seed`/`benchmark` never wrote to. Resolves, in order:
 * an explicit `targetRunId` from the request body (validated to belong to
 * this lab), or -- for `report` specifically -- the lab's most recent
 * succeeded `benchmark` run. Returns undefined for actions that legitimately
 * want a fresh label each trigger (seed/benchmark themselves), letting
 * buildCommand's default auto-generation apply.
 */
function resolveCliRunLabelForTrigger(
  deps: AppDeps,
  labId: string,
  actionName: string,
  targetRunId: string | undefined,
): { cliRunLabel?: string; error?: string } {
  if (targetRunId) {
    const targetRun = getActionRun(deps.db, targetRunId);
    if (!targetRun || targetRun.lab_configuration_id !== labId) {
      return { error: `targetRunId not found for this lab: ${targetRunId}` };
    }
    return { cliRunLabel: targetRun.cli_run_label };
  }
  if (actionName === 'report') {
    const lastBenchmark = latestSucceededActionRun(deps.db, labId, 'benchmark');
    if (!lastBenchmark) {
      return {
        error: 'no completed benchmark run to report on; run benchmark first, or pass targetRunId',
      };
    }
    return { cliRunLabel: lastBenchmark.cli_run_label };
  }
  return {};
}

export function createActionsRouter(deps: AppDeps): Router {
  const router = Router();

  router.post('/:id/actions/:actionName', async (req, res) => {
    const lab = getLabConfiguration(deps.db, req.params.id);
    if (!lab) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const provider = getProvider(lab.provider);
    if (!provider) {
      res.status(400).json({ error: `unknown provider: ${lab.provider}` });
      return;
    }
    const actionName = req.params.actionName;
    const actionDef = provider.actions.find((a) => a.name === actionName);
    if (!actionDef) {
      res.status(404).json({ error: `unknown action: ${actionName}` });
      return;
    }

    const body = req.body as {
      confirmed?: unknown;
      overridePrerequisites?: unknown;
      targetRunId?: unknown;
    };
    const confirmed = body.confirmed === true;
    const overridePrerequisites = body.overridePrerequisites === true;
    const targetRunId = typeof body.targetRunId === 'string' ? body.targetRunId : undefined;

    // FR-016: refuse a second concurrent trigger before anything else.
    const already = currentlyRunning(lab.id, actionName);
    if (already) {
      res.status(409).json({ error: 'action already running', actionRunId: already });
      return;
    }

    // FR-012: confirmation is enforced server-side, not just shown client-side.
    // The message is resolved against this lab's LIVE field values (e.g. the
    // actual configured expose_source_ranges), never the raw template.
    if (actionDef.requiresConfirmation && !confirmed) {
      res.status(409).json({
        error: 'confirmation required',
        confirmationMessage: resolveConfirmationMessage(actionDef, lab.fields),
      });
      return;
    }

    // FR-011 / A1: re-check prerequisites live at trigger time.
    if (actionDef.requiredPrerequisiteIds.length > 0 && !overridePrerequisites) {
      try {
        const checks = await runDoctor(deps.config, lab.provider);
        const failing = checks.filter(
          (c) => actionDef.requiredPrerequisiteIds.includes(c.id) && c.status === 'fail',
        );
        if (failing.length > 0) {
          res
            .status(412)
            .json({ error: 'prerequisite not satisfied', failing: failing.map((c) => c.id) });
          return;
        }
      } catch {
        // If doctor itself fails to run, fail open on this check rather than
        // blocking every action because the check mechanism is unavailable --
        // the action itself will still fail loudly if the real tool is missing.
      }
    }

    // Actions that reference a prior run's artifacts (report) must reuse
    // THAT run's cliRunLabel, not a freshly generated one -- see
    // resolveCliRunLabelForTrigger's doc comment.
    const { cliRunLabel: cliRunLabelOverride, error: runLabelError } = resolveCliRunLabelForTrigger(
      deps,
      lab.id,
      actionName,
      targetRunId,
    );
    if (runLabelError) {
      res.status(400).json({ error: runLabelError });
      return;
    }

    let cmd;
    try {
      cmd = buildCommand(provider, actionName, lab.fields, { cliRunLabel: cliRunLabelOverride });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    const runId = randomUUID();
    const logFilePath = join(deps.config.runsDir, `${runId}.log`);
    createActionRun(deps.db, {
      id: runId,
      labConfigurationId: lab.id,
      actionName,
      commandPreview: formatCommandPreview(cmd),
      logFilePath,
      cliRunLabel: cmd.cliRunLabel,
    });

    try {
      spawnAction(
        { db: deps.db, labCliPath: deps.config.labCliPath, repoRoot: deps.config.repoRoot },
        {
          runId,
          labConfigurationId: lab.id,
          actionName,
          argv: cmd.argv,
          env: cmd.env,
          logFilePath,
        },
      );
    } catch (err) {
      res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    res.status(202).json({ actionRunId: runId, streamUrl: `/api/runs/${runId}/stream` });
  });

  return router;
}
