// T045 (US4): incorrect secret -> generic 401; correct secret -> usable
// session; and the startup fail-closed guard (T013 / spec.md Edge Case 5)
// when LAB_UI_SHARED_SECRET is unset/empty.

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, TEST_SECRET } from './helpers.js';
import { resolveConfig, ConfigError } from '../../src/config.js';

describe('POST /api/auth/login', () => {
  it('rejects an incorrect secret with a generic error', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/api/auth/login').send({ secret: 'definitely-wrong' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ ok: false, error: 'invalid credentials' });
  });

  it('accepts the correct secret and the resulting session authorizes subsequent requests', async () => {
    const { app } = buildTestApp();
    const login = await request(app).post('/api/auth/login').send({ secret: TEST_SECRET });
    expect(login.status).toBe(200);
    const cookie = login.headers['set-cookie']![0];

    const authed = await request(app).get('/api/providers').set('Cookie', cookie);
    expect(authed.status).toBe(200);
  });
});

describe('startup config guard (spec.md Edge Case 5 -- never fail open)', () => {
  it('throws ConfigError when LAB_UI_SHARED_SECRET is unset', () => {
    expect(() => resolveConfig({})).toThrow(ConfigError);
  });

  it('throws ConfigError when LAB_UI_SHARED_SECRET is empty', () => {
    expect(() => resolveConfig({ LAB_UI_SHARED_SECRET: '' })).toThrow(ConfigError);
  });

  it('does not throw when LAB_UI_SHARED_SECRET is set', () => {
    expect(() => resolveConfig({ LAB_UI_SHARED_SECRET: 'x', LAB_REPO_ROOT: '/tmp' })).not.toThrow();
  });
});
