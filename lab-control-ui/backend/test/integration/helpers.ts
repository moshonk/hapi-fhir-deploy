import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Express } from 'express';
import request from 'supertest';
import { initSchema } from '../../src/db/schema.js';
import { createApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import { _resetSessionsForTests } from '../../src/auth/sessionStore.js';
import { _resetRunnerStateForTests } from '../../src/actions/runner.js';

export const TEST_SECRET = 'integration-test-secret';

export interface TestContext {
  app: Express;
  db: DatabaseSync;
  config: AppConfig;
  runsDir: string;
  cliRunsDir: string;
  resultsDir: string;
}

export function buildTestApp(overrides: Partial<AppConfig> = {}): TestContext {
  _resetSessionsForTests();
  _resetRunnerStateForTests();

  const runsDir = mkdtempSync(join(tmpdir(), 'lab-ui-runs-'));
  const cliRunsDir = mkdtempSync(join(tmpdir(), 'lab-ui-cli-runs-'));
  const resultsDir = mkdtempSync(join(tmpdir(), 'lab-ui-results-'));
  const db = new DatabaseSync(':memory:');
  initSchema(db);

  const config: AppConfig = {
    sharedSecret: TEST_SECRET,
    port: 0,
    repoRoot: process.cwd(),
    labCliPath: join(process.cwd(), 'test', 'fixtures', 'stub-lab.sh'),
    dbPath: ':memory:',
    runsDir,
    cliRunsDir,
    resultsDir,
    secureCookies: false,
    // Deliberately non-existent in the test context (same as before this
    // field existed, when it was computed inline from repoRoot) -- the
    // static-frontend.test.ts below is the one test that actually exercises
    // a real, existing frontendDistPath.
    frontendDistPath: join(process.cwd(), 'lab-control-ui', 'frontend', 'dist'),
    ...overrides,
  };

  const app = createApp({ db, config });
  return { app, db, config, runsDir, cliRunsDir, resultsDir };
}

/** Logs in and returns the Set-Cookie header value to reuse on subsequent requests. */
export async function loginAndGetCookie(
  app: Express,
  secret: string = TEST_SECRET,
): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ secret });
  const cookie = res.headers['set-cookie'];
  if (!cookie) throw new Error('login did not set a cookie');
  return Array.isArray(cookie) ? cookie[0] : cookie;
}
