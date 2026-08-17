// Entrypoint (T013). Resolves config (failing closed per spec.md Edge Case 5
// if LAB_UI_SHARED_SECRET is unset/empty), opens the DB, and starts listening.

import { openDatabase } from './db/schema.js';
import { resolveConfig, ConfigError } from './config.js';
import { createApp } from './app.js';

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
}

main();
