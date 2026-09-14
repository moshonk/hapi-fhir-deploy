// Boot-time exposure recovery. Rebuilding/recreating this container (e.g.
// `docker compose up -d --force-recreate app` after a code change) tears
// down the whole cgroup -- killing every `kubectl port-forward` this process
// spawned, including the auto-reconnect-watchdog-backed tunnels behind
// expose-fhir/expose-prometheus/expose-grafana, even though the GCP
// firewall rule each one opened survives (it's a cloud resource, not a
// local process). Confirmed live three separate times in one session: every
// redeploy needed the exact same manual "re-run expose-* by hand" recovery
// dance. This module automates that dance on server startup.
//
// Deliberately reuses the SAME code path a manual UI click goes through
// (buildCommand + spawnAction, via routes/actions.ts's own logic) rather
// than reimplementing anything -- a recovered exposure is an ordinary
// action_runs row, visible in run history/logs exactly like a manual
// trigger, not a hidden side channel.
//
// Deliberately bypasses routes/actions.ts's requiresConfirmation gate
// (ActionDef.requiresConfirmation is true for all three expose-* actions,
// since they open a public 0.0.0.0/0 firewall rule): that gate exists to
// make an operator consciously accept opening a NEW public surface. Here,
// the firewall rule is already open -- confirmed by scripts/lab exposures
// itself, the same read-only check the UI's ExposurePanel uses -- so
// nothing new is being exposed; only the dead local tunnel to something the
// operator already explicitly approved is being restored. Skipping the
// confirmation prompt in that specific case is intentional, not an
// oversight.

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../config.js';
import { getProvider } from '../providers/registry.js';
import { buildCommand, formatCommandPreview } from './commandBuilder.js';
import { listLabConfigurations, createActionRun } from '../db/queries.js';
import { spawnAction } from './runner.js';
import { runExposures, type ExposureRecord } from '../routes/exposures.js';

/** `scripts/lab exposures`' record `id` -> the ActionDef.name that
 * (re-)establishes it. Keys match cmd_exposures' `ids=(fhir prometheus
 * grafana)` in scripts/lab exactly. */
const RECOVERABLE_EXPOSURE_ACTIONS: Record<string, string> = {
  fhir: 'expose-fhir',
  prometheus: 'expose-prometheus',
  grafana: 'expose-grafana',
};

/** An exposure needs recovery iff its firewall rule is still open
 * (`firewallRule` present -- proof an operator previously approved and ran
 * expose-*) but `scripts/lab exposures` reports it not currently reachable
 * (`exposed: false` -- cmd_exposures' own liveness check on the tracked
 * port-forward pid, per its doc comment: dead pid means stale). Exported
 * standalone so it's unit-testable without a real CLI/child process. */
export function needsRecovery(exposure: ExposureRecord): boolean {
  return !exposure.exposed && Boolean(exposure.firewallRule);
}

/** Runs once at server startup (server.ts), fire-and-forget: never throws,
 * never blocks the HTTP server from becoming ready, and a single lab's or
 * exposure's failure (kubectl not yet reachable, gcloud not yet
 * authenticated, ...) never stops the rest from being attempted. Logs to
 * stdout/stderr only (docker logs), same as everything else server.ts
 * prints at startup -- there's no run to attach an SSE viewer to before one
 * actually gets created below. */
export async function recoverExposuresOnBoot(db: DatabaseSync, config: AppConfig): Promise<void> {
  const labs = listLabConfigurations(db);
  for (const lab of labs) {
    const provider = getProvider(lab.provider);
    if (!provider) continue;

    let exposures: ExposureRecord[];
    try {
      exposures = await runExposures(config, provider, lab.fields);
    } catch (err) {
      console.warn(
        `[lab-control-ui] boot recovery: could not check exposures for lab '${lab.name}' ` +
          `(${err instanceof Error ? err.message : String(err)}); skipping`,
      );
      continue;
    }

    for (const exposure of exposures) {
      if (!needsRecovery(exposure)) continue;
      const actionName = RECOVERABLE_EXPOSURE_ACTIONS[exposure.id];
      const actionDef = actionName ? provider.actions.find((a) => a.name === actionName) : undefined;
      if (!actionDef) continue;

      console.log(
        `[lab-control-ui] boot recovery: '${exposure.label}' for lab '${lab.name}' has an open ` +
          `firewall rule (${exposure.firewallRule}) but no live tunnel -- re-running ${actionName}`,
      );
      try {
        const cmd = buildCommand(provider, actionName, lab.fields);
        const runId = randomUUID();
        const logFilePath = join(config.runsDir, `${runId}.log`);
        createActionRun(db, {
          id: runId,
          labConfigurationId: lab.id,
          actionName,
          commandPreview: formatCommandPreview(cmd),
          logFilePath,
          cliRunLabel: cmd.cliRunLabel,
        });
        spawnAction(
          { db, labCliPath: config.labCliPath, repoRoot: config.repoRoot },
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
        console.warn(
          `[lab-control-ui] boot recovery: failed to re-run ${actionName} for lab '${lab.name}': ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
