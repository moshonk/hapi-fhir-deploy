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

  it('benchmark + inCluster threads --in-cluster/--parallel-shards and the cluster-DNS FHIR_BASE_URL into the command preview, suppressing --echis-tier', async () => {
    process.env.STUB_LAB_LINES = 'ok';
    process.env.STUB_LAB_EXIT_CODE = '0';

    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);
    const labRes = await request(app)
      .post('/api/labs')
      .set('Cookie', cookie)
      .send({ provider: 'gcp', fields: { project_id: 'my-project', echis_tier: 'T3' } });
    const labId = labRes.body.id as string;

    const trigger = await request(app)
      .post(`/api/labs/${labId}/actions/benchmark`)
      .set('Cookie', cookie)
      .send({ inCluster: true, parallelShards: 5 });
    expect(trigger.status).toBe(202);
    const runId = trigger.body.actionRunId as string;

    const detail = await request(app).get(`/api/runs/${runId}`).set('Cookie', cookie);
    expect(detail.body.command_preview).toContain('--in-cluster');
    expect(detail.body.command_preview).toContain('--parallel-shards 5');
    expect(detail.body.command_preview).toContain(
      'FHIR_BASE_URL=http://hapi-fhir-hapi-fhir-jpaserver.fhir.svc.cluster.local:8080/fhir',
    );
    // echis_tier is T3 on this lab -- a non-inCluster trigger would include
    // --echis-tier T3 (see the next test's sibling case in
    // commandBuilder.test.ts); confirms inCluster suppresses it, since
    // cmd_benchmark_in_cluster always targets echis_load_100.js and dies if
    // K6_SCRIPT/tier machinery tries to point it elsewhere.
    expect(detail.body.command_preview).not.toContain('--echis-tier');
  });

  it('benchmark without inCluster defaults to the local kubectl-port-forward FHIR_BASE_URL, no --in-cluster', async () => {
    process.env.STUB_LAB_LINES = 'ok';
    process.env.STUB_LAB_EXIT_CODE = '0';

    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);
    const labId = await createLaunchableLab(app, cookie);

    const trigger = await request(app)
      .post(`/api/labs/${labId}/actions/benchmark`)
      .set('Cookie', cookie)
      .send({});
    const runId = trigger.body.actionRunId as string;

    const detail = await request(app).get(`/api/runs/${runId}`).set('Cookie', cookie);
    expect(detail.body.command_preview).not.toContain('--in-cluster');
    expect(detail.body.command_preview).toContain('FHIR_BASE_URL=http://localhost:8080/fhir');
  });

  it('rejects a non-positive-integer parallelShards with 400 before creating a run', async () => {
    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);
    const labId = await createLaunchableLab(app, cookie);

    const trigger = await request(app)
      .post(`/api/labs/${labId}/actions/benchmark`)
      .set('Cookie', cookie)
      .send({ inCluster: true, parallelShards: 0 });
    expect(trigger.status).toBe(400);
    expect(trigger.body.error).toMatch(/parallelShards must be a positive integer/);
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
