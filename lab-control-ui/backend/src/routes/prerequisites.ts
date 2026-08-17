// GET /api/prerequisites (T036). Shells out to `scripts/lab doctor --cloud
// <provider> --format json` and relays its pass|warn|fail records verbatim
// -- this route performs no independent judgment of its own (research.md
// §5 / contracts/api.md).

import { Router } from 'express';
import { execFile } from 'node:child_process';
import type { AppConfig } from '../config.js';
import { listProviders } from '../providers/registry.js';

export interface PrereqCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export function runDoctor(config: AppConfig, provider: string): Promise<PrereqCheck[]> {
  return new Promise((resolve, reject) => {
    execFile(
      config.labCliPath,
      ['doctor', '--cloud', provider, '--format', 'json'],
      { cwd: config.repoRoot, timeout: 30_000 },
      (error, stdout) => {
        // doctor always exits 0 by design; a non-zero exit here means the
        // CLI itself is broken/missing, not a normal fail-status result.
        if (error) {
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(stdout) as PrereqCheck[]);
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}

export function createPrerequisitesRouter(config: AppConfig): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const defaultProvider = listProviders()[0]?.id ?? '';
    const provider = typeof req.query.provider === 'string' ? req.query.provider : defaultProvider;
    try {
      const checks = await runDoctor(config, provider);
      res.json({ checks });
    } catch (err) {
      res.status(502).json({
        error: `doctor check failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  return router;
}
