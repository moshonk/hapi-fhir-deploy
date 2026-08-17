// T039 (US3): triggering up/down/expose-fhir/expose-prometheus/expose-grafana
// without confirmed:true returns 409 with a confirmationMessage naming the
// concrete consequence; nothing is spawned.

import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, loginAndGetCookie } from './helpers.js';

const savedEnv = { ...process.env };

describe('confirmation gating on costly/destructive actions', () => {
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  for (const action of ['up', 'down', 'expose-fhir', 'expose-prometheus', 'expose-grafana']) {
    it(`blocks ${action} without confirmed:true and spawns nothing`, async () => {
      const recordFile = join('/tmp', `stub-record-${action}-${Date.now()}.txt`);
      process.env.STUB_LAB_RECORD_FILE = recordFile;
      process.env.STUB_LAB_EXIT_CODE = '0';
      // overridePrerequisites so a missing-tool 412 doesn't mask the 409 this test targets.
      const { app } = buildTestApp();
      const cookie = await loginAndGetCookie(app);
      const labRes = await request(app)
        .post('/api/labs')
        .set('Cookie', cookie)
        .send({ provider: 'gcp', fields: { project_id: 'my-project' } });
      const labId = labRes.body.id as string;

      const res = await request(app)
        .post(`/api/labs/${labId}/actions/${action}`)
        .set('Cookie', cookie)
        .send({ overridePrerequisites: true });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('confirmation required');
      expect(typeof res.body.confirmationMessage).toBe('string');
      expect(res.body.confirmationMessage.length).toBeGreaterThan(0);

      // FR-012: the message is resolved against this lab's live field
      // values, never a raw {field_key} template left unresolved.
      expect(res.body.confirmationMessage).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
      if (action === 'up' || action === 'down') {
        expect(res.body.confirmationMessage).toContain('hapi-fhir-lab'); // the default lab_name
      }
      if (
        action === 'expose-fhir' ||
        action === 'expose-prometheus' ||
        action === 'expose-grafana'
      ) {
        expect(res.body.confirmationMessage).toContain('0.0.0.0/0'); // the default expose_source_ranges
      }

      // Nothing spawned: the stub never wrote its record file.
      expect(existsSync(recordFile)).toBe(false);
      if (existsSync(recordFile)) unlinkSync(recordFile);
    });
  }
});
