// Env config resolution (T013). Kept separate from server.ts so tests can
// import resolveConfig() without booting an HTTP server.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export interface AppConfig {
  sharedSecret: string;
  port: number;
  repoRoot: string;
  labCliPath: string;
  dbPath: string;
  runsDir: string;
  secureCookies: boolean;
}

export class ConfigError extends Error {}

function detectRepoRoot(): string {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    return out.trim();
  } catch {
    // Fall back to two levels up from this backend package (lab-control-ui/backend -> repo root).
    return resolve(import.meta.dirname, '..', '..', '..');
  }
}

/** Resolves and validates configuration from process.env. Throws
 * ConfigError (never falls back to an insecure default) when
 * LAB_UI_SHARED_SECRET is unset or empty -- spec.md Edge Case 5: never fail
 * open. Callers (server.ts) MUST let this throw abort startup. */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const sharedSecret = env.LAB_UI_SHARED_SECRET ?? '';
  if (sharedSecret.trim() === '') {
    throw new ConfigError(
      'LAB_UI_SHARED_SECRET is unset or empty. Refusing to start rather than serve an ' +
        'unauthenticated or trivially-bypassable app -- set it to a real secret before starting.',
    );
  }

  const repoRoot = env.LAB_REPO_ROOT ?? detectRepoRoot();
  const port = Number.parseInt(env.LAB_UI_PORT ?? '3000', 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new ConfigError(`LAB_UI_PORT must be a positive integer, got: ${env.LAB_UI_PORT}`);
  }

  return {
    sharedSecret,
    port,
    repoRoot,
    labCliPath: env.LAB_CLI_PATH ?? resolve(repoRoot, 'scripts', 'lab'),
    dbPath:
      env.LAB_UI_DB_PATH ??
      resolve(repoRoot, 'ansible', 'artifacts', 'lab', 'ui', 'lab-control-ui.db'),
    runsDir: env.LAB_UI_RUNS_DIR ?? resolve(repoRoot, 'ansible', 'artifacts', 'lab', 'ui', 'runs'),
    secureCookies: env.LAB_UI_COOKIE_SECURE === 'true',
  };
}
