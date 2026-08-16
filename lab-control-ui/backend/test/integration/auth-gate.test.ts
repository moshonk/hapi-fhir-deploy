// T044 (US4): every non-auth API route is refused without a valid session.

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers.js';

describe('unauthenticated access', () => {
  it.each(['/api/labs', '/api/runs/some-run-id', '/api/prerequisites', '/api/providers'])(
    'returns 401 for %s without a session',
    async (path) => {
      const { app } = buildTestApp();
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    },
  );
});
