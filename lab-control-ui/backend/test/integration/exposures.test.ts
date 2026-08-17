// GET /api/labs/:id/exposures relays `scripts/lab exposures --format json`
// verbatim (routes/exposures.ts) -- used to show a link (and credentials,
// if applicable) once expose-fhir/expose-prometheus/expose-grafana has
// succeeded.

import { describe, expect, it, afterEach } from 'vitest';
import request from 'supertest';
import { buildTestApp, loginAndGetCookie } from './helpers.js';

const savedEnv = { ...process.env };

describe('GET /api/labs/:id/exposures', () => {
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('relays the stub CLI’s per-service exposed/url/credentials records verbatim', async () => {
    const records = [
      { id: 'fhir', label: 'HAPI FHIR', exposed: false },
      {
        id: 'prometheus',
        label: 'Prometheus',
        exposed: true,
        url: 'http://203.0.113.5:9090',
        port: '9090',
        firewallRule: 'allow-prometheus-9090-hapi-fhir-lab',
      },
      {
        id: 'grafana',
        label: 'Grafana',
        exposed: true,
        url: 'http://203.0.113.5:3000',
        port: '3000',
        firewallRule: 'allow-grafana-3000-hapi-fhir-lab',
        credentialsAvailable: true,
        username: 'admin',
        password: 'sekrit',
      },
    ];
    process.env.STUB_LAB_LINES = JSON.stringify(records);
    process.env.STUB_LAB_EXIT_CODE = '0';

    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);
    const labRes = await request(app)
      .post('/api/labs')
      .set('Cookie', cookie)
      .send({ provider: 'gcp', fields: { project_id: 'my-project' } });
    const labId = labRes.body.id as string;

    const res = await request(app).get(`/api/labs/${labId}/exposures`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.exposures).toEqual(records);
  });

  it('returns 502 with a readable message when the CLI fails', async () => {
    process.env.STUB_LAB_EXIT_CODE = '1';
    process.env.STUB_LAB_LINES = 'boom';

    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);
    const labRes = await request(app)
      .post('/api/labs')
      .set('Cookie', cookie)
      .send({ provider: 'gcp', fields: { project_id: 'my-project' } });
    const labId = labRes.body.id as string;

    const res = await request(app).get(`/api/labs/${labId}/exposures`).set('Cookie', cookie);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/exposures check failed/);
  });

  it('404s for an unknown lab id', async () => {
    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);
    const res = await request(app).get('/api/labs/does-not-exist/exposures').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('requires an authenticated session', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/labs/some-id/exposures');
    expect(res.status).toBe(401);
  });
});
