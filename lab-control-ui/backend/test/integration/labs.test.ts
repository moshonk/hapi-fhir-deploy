// T021 (US1): POST /api/labs defaults every omitted field; only project_id
// (the one field with no default) determines launchable.

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, loginAndGetCookie } from './helpers.js';

describe('POST /api/labs', () => {
  it('fills every omitted field with the provider default and reports launchable:true once project_id is set', async () => {
    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);

    const res = await request(app)
      .post('/api/labs')
      .set('Cookie', cookie)
      .send({ provider: 'gcp', fields: { project_id: 'my-project' } });

    expect(res.status).toBe(201);
    expect(res.body.launchable).toBe(true);
    expect(res.body.fields.project_id).toBe('my-project');
    // Spot-check a handful of documented defaults (data-model.md).
    expect(res.body.fields.region).toBe('us-central1');
    expect(res.body.fields.node_size).toBe('e2-standard-4');
    expect(res.body.fields.ttl_hours).toBe(4);
    expect(res.body.fields.households).toBe(33333);
  });

  it('reports launchable:false when project_id is omitted', async () => {
    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);

    const res = await request(app)
      .post('/api/labs')
      .set('Cookie', cookie)
      .send({ provider: 'gcp', fields: {} });

    expect(res.status).toBe(201);
    expect(res.body.launchable).toBe(false);
    expect(res.body.fields.project_id).toBeUndefined();
  });

  it('preserves already-edited field values across a PATCH (Story 1, Scenario 2)', async () => {
    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);

    const created = await request(app)
      .post('/api/labs')
      .set('Cookie', cookie)
      .send({ provider: 'gcp', fields: { project_id: 'my-project', node_size: 'c3-standard-8' } });

    const patched = await request(app)
      .patch(`/api/labs/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ fields: { ttl_hours: 8 } });

    expect(patched.status).toBe(200);
    expect(patched.body.fields.node_size).toBe('c3-standard-8'); // untouched by the ttl_hours patch
    expect(patched.body.fields.ttl_hours).toBe(8);
  });
});
