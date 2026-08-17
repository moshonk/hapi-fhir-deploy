// GET /api/runs/:runId/artifacts (result artifacts, distinct from /log and
// /stream's process output): seed's dataset-metadata.json, benchmark's
// k6-fhir-summary.json/k6-summary.json/benchmark-metadata.json, and
// report's published report.md/environment.json/summary.csv -- surfaced so
// benchmark results (not just logs) are reachable from the UI, not only by
// SSHing into the box and reading files directly.

import { mkdirSync, writeFileSync } from 'node:fs';
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

describe('GET /api/runs/:runId/artifacts', () => {
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('returns empty files for an action with no run directory (e.g. up)', async () => {
    // commandBuilder generates a cliRunLabel for every action regardless
    // of whether it's actually used as `--run` -- "up" gets one too, but
    // never writes into ansible/artifacts/lab/runs/, so this must not be
    // confused with genuinely having result artifacts.
    process.env.STUB_LAB_EXIT_CODE = '0';
    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);
    const labRes = await request(app)
      .post('/api/labs')
      .set('Cookie', cookie)
      .send({ provider: 'gcp', fields: { project_id: 'my-project' } });
    const labId = labRes.body.id as string;

    const trigger = await request(app)
      .post(`/api/labs/${labId}/actions/up`)
      .set('Cookie', cookie)
      .send({ confirmed: true });
    const run = await waitForTerminalStatus(app, cookie, trigger.body.actionRunId);
    expect(run.cli_run_label).toBeTruthy();

    const res = await request(app)
      .get(`/api/runs/${trigger.body.actionRunId}/artifacts`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.files).toEqual([]);
  });

  it('returns 404 for an unknown runId', async () => {
    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);
    const res = await request(app)
      .get('/api/runs/not-a-real-run/artifacts')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it("returns a benchmark run's k6-fhir-summary.json once written to its run directory", async () => {
    process.env.STUB_LAB_EXIT_CODE = '0';
    const { app, cliRunsDir } = buildTestApp();
    const cookie = await loginAndGetCookie(app);
    const labRes = await request(app)
      .post('/api/labs')
      .set('Cookie', cookie)
      .send({ provider: 'gcp', fields: { project_id: 'my-project' } });
    const labId = labRes.body.id as string;

    const trigger = await request(app)
      .post(`/api/labs/${labId}/actions/benchmark`)
      .set('Cookie', cookie)
      .send({});
    const run = await waitForTerminalStatus(app, cookie, trigger.body.actionRunId);
    const cliRunLabel = run.cli_run_label as string;
    expect(cliRunLabel).toBeTruthy();

    const runDir = join(cliRunsDir, cliRunLabel);
    mkdirSync(runDir, { recursive: true });
    const summary = { concurrency_target: 100, latency_ms: { p95: 1234 } };
    writeFileSync(join(runDir, 'k6-fhir-summary.json'), JSON.stringify(summary));
    // Deliberately NOT written: k6-raw.jsonl -- must never be served even
    // if present (multi-gigabyte NDJSON in real runs).
    writeFileSync(join(runDir, 'k6-raw.jsonl'), '{"huge":"dump"}\n');

    const res = await request(app)
      .get(`/api/runs/${trigger.body.actionRunId}/artifacts`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.cliRunLabel).toBe(cliRunLabel);
    const names = res.body.files.map((f: { name: string }) => f.name);
    expect(names).toContain('k6-fhir-summary.json');
    expect(names).not.toContain('k6-raw.jsonl');
    const found = res.body.files.find((f: { name: string }) => f.name === 'k6-fhir-summary.json');
    expect(found.kind).toBe('json');
    expect(found.content).toEqual(summary);
  });

  it('returns empty files (not an error) when no result files exist yet', async () => {
    process.env.STUB_LAB_EXIT_CODE = '0';
    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);
    const labRes = await request(app)
      .post('/api/labs')
      .set('Cookie', cookie)
      .send({ provider: 'gcp', fields: { project_id: 'my-project' } });
    const labId = labRes.body.id as string;

    const trigger = await request(app)
      .post(`/api/labs/${labId}/actions/benchmark`)
      .set('Cookie', cookie)
      .send({});
    await waitForTerminalStatus(app, cookie, trigger.body.actionRunId);

    const res = await request(app)
      .get(`/api/runs/${trigger.body.actionRunId}/artifacts`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.files).toEqual([]);
  });

  it("resolves a report run's published report.md/environment.json/summary.csv from its log output", async () => {
    process.env.STUB_LAB_EXIT_CODE = '0';
    const { app, resultsDir } = buildTestApp();
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

    // scripts/publish_results.rb's ONLY stdout line on success is the
    // result directory it just wrote -- the stub reproduces that exactly.
    const resultDir = join(resultsDir, 'testresult');
    mkdirSync(resultDir, { recursive: true });
    writeFileSync(join(resultDir, 'report.md'), '# Report\n\nAll good.\n');
    writeFileSync(join(resultDir, 'environment.json'), JSON.stringify({ cloud: 'gcp' }));
    writeFileSync(join(resultDir, 'summary.csv'), 'metric,value\nlatency_p95,1234\n');
    process.env.STUB_LAB_LINES = resultDir;

    const reportTrigger = await request(app)
      .post(`/api/labs/${labId}/actions/report`)
      .set('Cookie', cookie)
      .send({});
    expect(reportTrigger.status).toBe(202);
    await waitForTerminalStatus(app, cookie, reportTrigger.body.actionRunId);

    const res = await request(app)
      .get(`/api/runs/${reportTrigger.body.actionRunId}/artifacts`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(
      res.body.files.map((f: { name: string; kind: string; content: unknown }) => [f.name, f]),
    );
    expect(byName['report.md'].kind).toBe('text');
    expect(byName['report.md'].content).toContain('All good.');
    expect(byName['environment.json'].kind).toBe('json');
    expect(byName['environment.json'].content).toEqual({ cloud: 'gcp' });
    expect(byName['summary.csv'].kind).toBe('text');
    expect(byName['summary.csv'].content).toContain('latency_p95,1234');
  });

  it('ignores a report log whose last line points outside resultsDir', async () => {
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

    // A custom LAB_REPORT_CMD (or a compromised/odd stub) printing
    // something that is NOT actually inside resultsDir must never be
    // treated as a readable directory -- e.g. this must not let a report
    // run's log content read arbitrary files elsewhere on disk.
    process.env.STUB_LAB_LINES = '/etc/passwd';

    const reportTrigger = await request(app)
      .post(`/api/labs/${labId}/actions/report`)
      .set('Cookie', cookie)
      .send({});
    await waitForTerminalStatus(app, cookie, reportTrigger.body.actionRunId);

    const res = await request(app)
      .get(`/api/runs/${reportTrigger.body.actionRunId}/artifacts`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    const names = res.body.files.map((f: { name: string }) => f.name);
    expect(names).not.toContain('report.md');
  });
});
