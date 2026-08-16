// T038 (US3): triggering an action whose required prerequisite is failing
// returns 412 naming the blocker; overridePrerequisites:true proceeds anyway.

import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, loginAndGetCookie } from './helpers.js';

const savedEnv = { ...process.env };

describe('prerequisite gating on action trigger', () => {
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('returns 412 naming the failing prerequisite, and 202 when overridden', async () => {
    // `deploy` requires helm/kubectl/ansible-playbook/ansible-collections.
    process.env.STUB_LAB_LINES = JSON.stringify([
      { id: 'helm', label: 'Helm', status: 'fail', detail: 'not found' },
      { id: 'kubectl', label: 'kubectl', status: 'pass', detail: 'present' },
    ]);
    process.env.STUB_LAB_EXIT_CODE = '0';

    const { app } = buildTestApp();
    const cookie = await loginAndGetCookie(app);
    const labRes = await request(app)
      .post('/api/labs')
      .set('Cookie', cookie)
      .send({ provider: 'gcp', fields: { project_id: 'my-project' } });
    const labId = labRes.body.id as string;

    const blocked = await request(app)
      .post(`/api/labs/${labId}/actions/deploy`)
      .set('Cookie', cookie)
      .send({});
    expect(blocked.status).toBe(412);
    expect(blocked.body.error).toMatch(/prerequisite not satisfied/);
    expect(blocked.body.failing).toContain('helm');

    const overridden = await request(app)
      .post(`/api/labs/${labId}/actions/deploy`)
      .set('Cookie', cookie)
      .send({ overridePrerequisites: true });
    expect(overridden.status).toBe(202);
  });
});
