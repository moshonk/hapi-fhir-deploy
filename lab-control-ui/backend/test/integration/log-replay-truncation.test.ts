// Root-caused live: a run that logs at a very high rate for even a few
// minutes (a real one hit ~2,300 lines/sec during a connectivity outage,
// 544K lines total) turns the SSE stream's replay-on-connect burst into
// hundreds of thousands of individual `event: log` messages -- each one
// driving a separate React state update client-side, an O(n^2) rendering
// pattern that froze the browser tab for minutes on every page
// reload/reconnect. This asserts the fix: the replay burst is capped to
// logReplayMaxLines, live-appended lines after connecting are not, and
// the full log is still available in full elsewhere (routes/runs.ts's
// /log endpoint, and the log file itself).

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { buildTestApp, loginAndGetCookie } from './helpers.js';

const savedEnv = { ...process.env };

async function streamUntilStatus(app: import('express').Express, cookie: string, runId: string) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/runs/${runId}/stream`, {
      headers: { Cookie: cookie },
    });
    let received = '';
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      received += Buffer.from(chunk).toString('utf8');
      if (received.includes('event: status')) break;
    }
    return received;
  } finally {
    server.close();
  }
}

describe('SSE replay-on-connect truncation', () => {
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('caps the replay burst to logReplayMaxLines, keeping only the most recent lines', async () => {
    process.env.STUB_LAB_LINES = Array.from({ length: 10 }, (_, i) => `line-${i}`).join('\n');
    process.env.STUB_LAB_EXIT_CODE = '0';

    const { app } = buildTestApp({ logReplayMaxLines: 3 });
    const cookie = await loginAndGetCookie(app);

    const labRes = await request(app)
      .post('/api/labs')
      .set('Cookie', cookie)
      .send({ provider: 'gcp', fields: { project_id: 'my-project' } });
    const labId = labRes.body.id as string;

    const trigger = await request(app)
      .post(`/api/labs/${labId}/actions/deploy`)
      .set('Cookie', cookie)
      .send({});
    const runId = trigger.body.actionRunId as string;

    // Give the stub time to finish writing all 10 lines and exit before we
    // ever connect -- this exercises the replay-on-connect path, not live
    // tailing.
    await new Promise((r) => setTimeout(r, 300));

    const received = await streamUntilStatus(app, cookie, runId);

    // Only the last 3 lines survive the cap.
    expect(received).toContain('line-7');
    expect(received).toContain('line-8');
    expect(received).toContain('line-9');
    // The earlier 7 do not.
    for (let i = 0; i < 7; i++) {
      expect(received).not.toContain(`line-${i}`);
    }
    // A human-readable marker explains the gap and points at the full log.
    expect(received).toMatch(/7 earlier line\(s\) omitted/);

    // The replay is a small, fixed number of `event: log` frames -- not
    // one per original line (10) and nowhere near the hundreds of
    // thousands a real degenerate run produced.
    const logEventCount = (received.match(/event: log\n/g) ?? []).length;
    expect(logEventCount).toBeLessThanOrEqual(5);
  });

  it('does not truncate when the run has fewer lines than the cap', async () => {
    process.env.STUB_LAB_LINES = 'line-one\nline-two';
    process.env.STUB_LAB_EXIT_CODE = '0';

    const { app } = buildTestApp({ logReplayMaxLines: 2000 });
    const cookie = await loginAndGetCookie(app);

    const labRes = await request(app)
      .post('/api/labs')
      .set('Cookie', cookie)
      .send({ provider: 'gcp', fields: { project_id: 'my-project' } });
    const labId = labRes.body.id as string;

    const trigger = await request(app)
      .post(`/api/labs/${labId}/actions/deploy`)
      .set('Cookie', cookie)
      .send({});
    const runId = trigger.body.actionRunId as string;
    await new Promise((r) => setTimeout(r, 200));

    const received = await streamUntilStatus(app, cookie, runId);
    expect(received).toContain('line-one');
    expect(received).toContain('line-two');
    expect(received).not.toMatch(/earlier line\(s\) omitted/);
  });

  it("GET /api/runs/:runId/log stays full -- truncation only applies to the SSE replay burst", async () => {
    process.env.STUB_LAB_LINES = Array.from({ length: 10 }, (_, i) => `line-${i}`).join('\n');
    process.env.STUB_LAB_EXIT_CODE = '0';

    const { app } = buildTestApp({ logReplayMaxLines: 3 });
    const cookie = await loginAndGetCookie(app);

    const labRes = await request(app)
      .post('/api/labs')
      .set('Cookie', cookie)
      .send({ provider: 'gcp', fields: { project_id: 'my-project' } });
    const labId = labRes.body.id as string;

    const trigger = await request(app)
      .post(`/api/labs/${labId}/actions/deploy`)
      .set('Cookie', cookie)
      .send({});
    const runId = trigger.body.actionRunId as string;
    await new Promise((r) => setTimeout(r, 300));

    const res = await request(app).get(`/api/runs/${runId}/log`).set('Cookie', cookie);
    for (let i = 0; i < 10; i++) {
      expect(res.text).toContain(`line-${i}`);
    }
  });
});
