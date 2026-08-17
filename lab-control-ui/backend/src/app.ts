// Express app factory (T013). Separate from server.ts so integration tests
// (supertest) can exercise the app without binding a real port.

import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from './config.js';
import { createAuthRouter } from './auth/routes.js';
import { requireAuth } from './auth/middleware.js';
import { createProvidersRouter } from './routes/providers.js';
import { createLabsRouter } from './routes/labs.js';
import { createActionsRouter } from './routes/actions.js';
import { createRunsRouter } from './routes/runs.js';
import { createPrerequisitesRouter } from './routes/prerequisites.js';
import { createExposuresRouter } from './routes/exposures.js';
import { createHealthRouter } from './routes/health.js';

export interface AppDeps {
  db: DatabaseSync;
  config: AppConfig;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  // Liveness is intentionally unauthenticated -- a load balancer/orchestrator
  // health check shouldn't need a session (T048).
  app.use('/healthz', createHealthRouter());

  // FR-013: everything except login requires a valid session.
  app.use(
    '/api/auth',
    createAuthRouter({
      sharedSecret: deps.config.sharedSecret,
      secureCookies: deps.config.secureCookies,
    }),
  );
  app.use('/api', requireAuth);
  app.use('/api/providers', createProvidersRouter());
  app.use('/api/labs', createLabsRouter(deps.db));
  app.use('/api/labs', createActionsRouter(deps));
  app.use('/api/labs', createExposuresRouter(deps));
  app.use(
    '/api/runs',
    createRunsRouter({
      db: deps.db,
      cliRunsDir: deps.config.cliRunsDir,
      resultsDir: deps.config.resultsDir,
    }),
  );
  app.use('/api/prerequisites', createPrerequisitesRouter(deps.config));

  // Static frontend build (served by this same process/port -- research.md §1).
  const frontendDist = deps.config.frontendDistPath;
  if (existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    // A path-less middleware (rather than app.get('*', ...)) is
    // deliberate: Express 5's bundled path-to-regexp rejects a bare '*'
    // wildcard route pattern (it now requires a named wildcard like
    // '/*splat'), and this SPA fallback has no need for a pattern at all
    // -- it should catch anything express.static above didn't serve.
    app.use((req, res, next) => {
      if (req.method !== 'GET') {
        next();
        return;
      }
      res.sendFile(join(frontendDist, 'index.html'));
    });
  }

  return app;
}
