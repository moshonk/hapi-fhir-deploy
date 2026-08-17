// GET /api/labs/:id/exposures. Shells out to `scripts/lab exposures --format
// json` (via the same provider.buildCommand('exposures', ...) mapping every
// other action goes through) and relays its per-service exposed/url/
// credentials records verbatim -- like prerequisites.ts's runDoctor, this
// route performs no independent judgment or caching of its own. Used by the
// UI to show a link (and credentials, if applicable) once expose-fhir/
// expose-prometheus/expose-grafana has actually succeeded, and to refresh
// that state on load so it survives a page reload without re-triggering
// anything.

import { Router } from 'express';
import { execFile } from 'node:child_process';
import type { AppConfig } from '../config.js';
import type { ProviderAdapter } from '../providers/types.js';
import { getProvider } from '../providers/registry.js';
import { buildCommand } from '../actions/commandBuilder.js';
import { getLabConfiguration } from '../db/queries.js';
import type { AppDeps } from '../app.js';

export interface ExposureRecord {
  id: string;
  label: string;
  exposed: boolean;
  url?: string;
  port?: string;
  firewallRule?: string;
  /** Only present on the grafana record (docs/lab-cli.md's login-required note). */
  credentialsAvailable?: boolean;
  username?: string;
  password?: string;
  credentialsReason?: string;
}

export function runExposures(
  config: AppConfig,
  provider: ProviderAdapter,
  labFields: Record<string, unknown>,
): Promise<ExposureRecord[]> {
  const cmd = buildCommand(provider, 'exposures', labFields);
  return new Promise((resolve, reject) => {
    execFile(
      config.labCliPath,
      cmd.argv,
      { cwd: config.repoRoot, env: { ...process.env, ...cmd.env }, timeout: 15_000 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(stdout) as ExposureRecord[]);
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}

export function createExposuresRouter(deps: AppDeps): Router {
  const router = Router();

  router.get('/:id/exposures', async (req, res) => {
    const row = getLabConfiguration(deps.db, req.params.id);
    if (!row) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const provider = getProvider(row.provider);
    if (!provider) {
      res.status(400).json({ error: `unknown provider: ${row.provider}` });
      return;
    }
    try {
      const exposures = await runExposures(deps.config, provider, row.fields);
      res.json({ exposures });
    } catch (err) {
      res.status(502).json({
        error: `exposures check failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  return router;
}
