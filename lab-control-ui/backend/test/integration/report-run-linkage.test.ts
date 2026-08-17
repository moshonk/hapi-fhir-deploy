// Bug fix regression (found via specs/009-lab-control-ui/quickstart.md
// Scenario 4 real-GCP validation): `report` must reuse the SAME cliRunLabel
// a prior `benchmark` run used, not generate a fresh one that points at a
// run directory that was never written. Defaults to the lab's most recent
// succeeded `benchmark` run; an explicit `targetRunId` can override that.

import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, loginAndGetCookie } from './helpers.js';

const savedEnv = { ...process.env };

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
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`run ${runId} did not reach a terminal status within ${timeoutMs}ms`);
}

function readRecordedInvocations(recordFile: string): string[] {
  if (!existsSync(recordFile)) return [];
  return readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean);
}

describe('report run-label linkage', () => {
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('defaults to the most recent succeeded benchmark run when no targetRunId is given', async () => {
    const recordFile = join(mkdtempSync(join(tmpdir(), 'stub-record-')), 'invocations.txt');
    process.env.STUB_LAB_RECORD_FILE = recordFile;
    process.env.STUB_LAB_EXIT_CODE = '0';

    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);
    const labRes = await request(app)
      .post('/api/labs')
      .set('Cookie', cookie)
      .send({ provider: 'gcp', fields: { project_id: 'my-project' } });
    const labId = labRes.body.id as string;

    const benchmarkTrigger = await request(app)
      .post(`/api/labs/${labId}/actions/benchmark`)
      .set('Cookie', cookie)
      .send({});
    await waitForTerminalStatus(app, cookie, benchmarkTrigger.body.actionRunId);

    const reportTrigger = await request(app)
      .post(`/api/labs/${labId}/actions/report`)
      .set('Cookie', cookie)
      .send({});
    expect(reportTrigger.status).toBe(202);
    await waitForTerminalStatus(app, cookie, reportTrigger.body.actionRunId);

    const invocations = readRecordedInvocations(recordFile);
    const benchmarkArgv = invocations.find((l) => l.includes('benchmark --profile'))!;
    const reportArgv = invocations.find((l) => l.includes('report --run'))!;
    expect(benchmarkArgv).toBeTruthy();
    expect(reportArgv).toBeTruthy();

    const runLabelMatch = benchmarkArgv.match(/--run (\S+)/);
    expect(runLabelMatch).toBeTruthy();
    const cliRunLabel = runLabelMatch![1];

    // The critical assertion: report's --run is the SAME label benchmark
    // used, not a freshly generated one.
    expect(reportArgv).toContain(`--run ${cliRunLabel}`);
  });

  it('returns 400 when no succeeded benchmark run exists to default to', async () => {
    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);
    const labRes = await request(app)
      .post('/api/labs')
      .set('Cookie', cookie)
      .send({ provider: 'gcp', fields: { project_id: 'my-project' } });
    const labId = labRes.body.id as string;

    const res = await request(app)
      .post(`/api/labs/${labId}/actions/report`)
      .set('Cookie', cookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no completed benchmark run/);
  });

  it('honors an explicit targetRunId over the default', async () => {
    process.env.STUB_LAB_EXIT_CODE = '0';

    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);
    const labRes = await request(app)
      .post('/api/labs')
      .set('Cookie', cookie)
      .send({ provider: 'gcp', fields: { project_id: 'my-project' } });
    const labId = labRes.body.id as string;

    // Two benchmark runs -- the second becomes the "default", but we
    // explicitly target the first. cliRunLabel has second-resolution, so
    // force the two triggers into different seconds -- otherwise this test
    // could pass by coincidence (both auto-generated labels identical)
    // rather than actually proving targetRunId picks the right one.
    const first = await request(app)
      .post(`/api/labs/${labId}/actions/benchmark`)
      .set('Cookie', cookie)
      .send({});
    await waitForTerminalStatus(app, cookie, first.body.actionRunId);
    await new Promise((r) => setTimeout(r, 1100));
    const second = await request(app)
      .post(`/api/labs/${labId}/actions/benchmark`)
      .set('Cookie', cookie)
      .send({});
    await waitForTerminalStatus(app, cookie, second.body.actionRunId);

    const firstRun = await request(app)
      .get(`/api/runs/${first.body.actionRunId}`)
      .set('Cookie', cookie);
    const secondRun = await request(app)
      .get(`/api/runs/${second.body.actionRunId}`)
      .set('Cookie', cookie);
    const firstCliRunLabel = firstRun.body.cli_run_label as string;
    expect(firstCliRunLabel).not.toBe(secondRun.body.cli_run_label);

    const recordFile = join(mkdtempSync(join(tmpdir(), 'stub-record-')), 'invocations.txt');
    process.env.STUB_LAB_RECORD_FILE = recordFile;
    const reportTrigger = await request(app)
      .post(`/api/labs/${labId}/actions/report`)
      .set('Cookie', cookie)
      .send({ targetRunId: first.body.actionRunId });
    expect(reportTrigger.status).toBe(202);
    await waitForTerminalStatus(app, cookie, reportTrigger.body.actionRunId);

    const invocations = readRecordedInvocations(recordFile);
    const reportArgv = invocations.find((l) => l.includes('report --run'))!;
    expect(reportArgv).toContain(`--run ${firstCliRunLabel}`);
  });

  it('returns 400 for a targetRunId that does not belong to this lab', async () => {
    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);
    const labRes = await request(app)
      .post('/api/labs')
      .set('Cookie', cookie)
      .send({ provider: 'gcp', fields: { project_id: 'my-project' } });
    const labId = labRes.body.id as string;

    const res = await request(app)
      .post(`/api/labs/${labId}/actions/report`)
      .set('Cookie', cookie)
      .send({ targetRunId: 'not-a-real-run-id' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/targetRunId not found/);
  });
});
