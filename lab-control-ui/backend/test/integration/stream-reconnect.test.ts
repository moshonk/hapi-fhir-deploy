// T031 (US2): reconnecting to /api/runs/:actionRunId/stream mid-run replays
// everything produced so far (FR-008), not just output produced after
// reconnecting; and new output arrives within a few seconds of being
// produced (SC-003).

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { buildTestApp, loginAndGetCookie } from './helpers.js';

const savedEnv = { ...process.env };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('GET /api/runs/:actionRunId/stream', () => {
  let server: Server | undefined;

  afterEach(() => {
    process.env = { ...savedEnv };
    server?.close();
    server = undefined;
  });

  it('replays output produced before connecting, then tails new output within a few seconds', async () => {
    process.env.STUB_LAB_LINES = 'line-one\nline-two\nline-three';
    process.env.STUB_LAB_DELAY_MS = '150';
    process.env.STUB_LAB_EXIT_CODE = '0';

    const { app } = buildTestApp();
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

    // Let the first line or two land before we ever connect to the stream --
    // this is the scenario FR-008 covers: "reconnecting", not just "watching
    // from the start".
    await sleep(200);

    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const started = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}/api/runs/${runId}/stream`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();

    let received = '';
    let firstChunkAt: number | undefined;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      firstChunkAt ??= Date.now();
      received += Buffer.from(chunk).toString('utf8');
      if (received.includes('event: status')) break;
    }

    // Replayed from the start -- line-one was already written before we connected.
    expect(received).toContain('line-one');
    expect(received).toContain('line-two');
    expect(received).toContain('line-three');
    expect(received).toContain('event: status\ndata: succeeded');

    // SC-003: new output visible within a few seconds of connecting/being produced.
    expect(firstChunkAt! - started).toBeLessThan(3000);
  });
});
