// T029 (US2): triggering an action against the stub scripts/lab transitions
// pending -> running -> succeeded/failed and the captured log matches the
// stub's output verbatim -- including a refusal-style nonzero exit (FR-006,
// simulating the T2-before-T3 guard) surfacing as-is, not reworded.

import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, loginAndGetCookie } from './helpers.js';

async function createLaunchableLab(app: import('express').Express, cookie: string) {
  const res = await request(app)
    .post('/api/labs')
    .set('Cookie', cookie)
    .send({ provider: 'gcp', fields: { project_id: 'my-project' } });
  return res.body.id as string;
}

async function waitForTerminalStatus(
  app: import('express').Express,
  cookie: string,
  runId: string,
  timeoutMs = 3000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(app).get(`/api/runs/${runId}`).set('Cookie', cookie);
    if (res.body.status === 'succeeded' || res.body.status === 'failed') return res.body;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`run ${runId} did not reach a terminal status within ${timeoutMs}ms`);
}

const savedEnv = { ...process.env };

describe('POST /api/labs/:id/actions/:actionName', () => {
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('transitions pending -> running -> succeeded and captures stdout verbatim', async () => {
    process.env.STUB_LAB_LINES = 'Deploying HAPI FHIR\nRollout complete';
    process.env.STUB_LAB_EXIT_CODE = '0';

    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);
    const labId = await createLaunchableLab(app, cookie);

    const trigger = await request(app)
      .post(`/api/labs/${labId}/actions/deploy`)
      .set('Cookie', cookie)
      .send({});
    expect(trigger.status).toBe(202);
    const runId = trigger.body.actionRunId as string;

    const finalRun = await waitForTerminalStatus(app, cookie, runId);
    expect(finalRun.status).toBe('succeeded');
    expect(finalRun.exit_code).toBe(0);

    const log = await request(app).get(`/api/runs/${runId}/log`).set('Cookie', cookie);
    expect(log.text).toContain('Deploying HAPI FHIR');
    expect(log.text).toContain('Rollout complete');
  });

  it('surfaces a refusal-style nonzero exit (e.g. the T2-before-T3 guard) verbatim as a failed run', async () => {
    process.env.STUB_LAB_LINES = 'scripts/lab: T3 requires a prior successful T2 run';
    process.env.STUB_LAB_EXIT_CODE = '1';

    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);
    const labId = await createLaunchableLab(app, cookie);

    const trigger = await request(app)
      .post(`/api/labs/${labId}/actions/deploy`)
      .set('Cookie', cookie)
      .send({});
    const runId = trigger.body.actionRunId as string;

    const finalRun = await waitForTerminalStatus(app, cookie, runId);
    expect(finalRun.status).toBe('failed');
    expect(finalRun.exit_code).toBe(1);

    const log = await request(app).get(`/api/runs/${runId}/log`).set('Cookie', cookie);
    expect(log.text).toContain('scripts/lab: T3 requires a prior successful T2 run');
  });

  it('refuses a second concurrent trigger of the same (lab, action) naming the in-progress run (FR-016)', async () => {
    process.env.STUB_LAB_LINES = 'working...';
    process.env.STUB_LAB_DELAY_MS = '300';
    process.env.STUB_LAB_EXIT_CODE = '0';

    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);
    const labId = await createLaunchableLab(app, cookie);

    const first = await request(app)
      .post(`/api/labs/${labId}/actions/deploy`)
      .set('Cookie', cookie)
      .send({});
    expect(first.status).toBe(202);

    const second = await request(app)
      .post(`/api/labs/${labId}/actions/deploy`)
      .set('Cookie', cookie)
      .send({});
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already running/);
    expect(second.body.actionRunId).toBe(first.body.actionRunId);

    await waitForTerminalStatus(app, cookie, first.body.actionRunId);
  });
});
