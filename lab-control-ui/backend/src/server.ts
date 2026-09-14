// Entrypoint (T013). Resolves config (failing closed per spec.md Edge Case 5
// if LAB_UI_SHARED_SECRET is unset/empty), opens the DB, and starts listening.

import { openDatabase } from './db/schema.js';
import { resolveConfig, ConfigError } from './config.js';
import { createApp } from './app.js';
import { recoverExposuresOnBoot } from './actions/exposureRecovery.js';

function main(): void {
  let config;
  try {
    config = resolveConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[lab-control-ui] refusing to start: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const db = openDatabase(config.dbPath);
  const app = createApp({ db, config });

  app.listen(config.port, () => {
    console.log(`[lab-control-ui] listening on :${config.port} (repo root: ${config.repoRoot})`);
  });

  // Fire-and-forget: restores any expose-fhir/expose-prometheus/
  // expose-grafana tunnel that a prior container's cgroup teardown killed
  // while its GCP firewall rule stayed open (exposureRecovery.ts's doc
  // comment). Never blocks the health check above, never crashes the
  // process on failure.
  void recoverExposuresOnBoot(db, config).catch((err) => {
    console.warn(
      `[lab-control-ui] boot recovery: unexpected error, continuing without it: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  });
}

main();
