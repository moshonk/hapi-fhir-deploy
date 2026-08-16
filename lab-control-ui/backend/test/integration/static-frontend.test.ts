// Regression test: createApp() must not throw when a built frontend/dist
// exists (Express 5's path-to-regexp rejects a bare '*' wildcard route --
// this was caught by a manual quickstart smoke test, not by any earlier
// automated test, because buildTestApp()'s repoRoot never had a real
// frontend/dist under it. See app.ts's SPA-fallback comment.)

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { initSchema } from '../../src/db/schema.js';
import { createApp } from '../../src/app.js';
import { loginAndGetCookie, TEST_SECRET } from './helpers.js';

describe('static frontend fallback', () => {
  it('createApp does not throw, and serves index.html for a non-API GET, when frontend/dist exists', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'lab-ui-repo-'));
    const dist = join(repoRoot, 'lab-control-ui', 'frontend', 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>ok</title>');

    const db = new DatabaseSync(':memory:');
    initSchema(db);

    expect(() =>
      createApp({
        db,
        config: {
          sharedSecret: TEST_SECRET,
          port: 0,
          repoRoot,
          labCliPath: '/bin/true',
          dbPath: ':memory:',
          runsDir: join(repoRoot, 'runs'),
          secureCookies: false,
        },
      }),
    ).not.toThrow();

    const app = createApp({
      db,
      config: {
        sharedSecret: TEST_SECRET,
        port: 0,
        repoRoot,
        labCliPath: '/bin/true',
        dbPath: ':memory:',
        runsDir: join(repoRoot, 'runs'),
        secureCookies: false,
      },
    });

    // Unauthenticated API routes still 401 (the SPA fallback must not
    // shadow /api/*).
    const apiRes = await request(app).get('/api/labs');
    expect(apiRes.status).toBe(401);

    // A non-API GET (e.g. the client-side router's own route) falls back
    // to index.html.
    await loginAndGetCookie(app); // sanity: auth still works with this repoRoot
    const pageRes = await request(app).get('/some/client/route');
    expect(pageRes.status).toBe(200);
    expect(pageRes.text).toContain('<title>ok</title>');
  });
});
