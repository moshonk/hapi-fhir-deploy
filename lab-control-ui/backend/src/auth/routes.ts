import { Router } from 'express';
import { serializeCookie } from './cookies.js';
import {
  SESSION_COOKIE_NAME,
  createSession,
  destroySession,
  secretsMatch,
} from './sessionStore.js';
import { sessionTokenFromRequest } from './middleware.js';

export interface AuthRoutesOptions {
  sharedSecret: string;
  /** Set true when served over HTTPS (e.g. behind a reverse proxy that
   * terminates TLS) so the session cookie gets the Secure flag. Defaults to
   * false so local plain-HTTP development isn't broken by a cookie the
   * browser silently refuses to send back. */
  secureCookies?: boolean;
}

export function createAuthRouter(options: AuthRoutesOptions): Router {
  const router = Router();

  router.post('/login', (req, res) => {
    const body = req.body as { secret?: unknown };
    const candidate = typeof body?.secret === 'string' ? body.secret : '';

    if (!secretsMatch(candidate, options.sharedSecret)) {
      // FR-015: generic failure, no signal about how close the guess was.
      res.status(401).json({ ok: false, error: 'invalid credentials' });
      return;
    }

    const token = createSession();
    res.setHeader(
      'Set-Cookie',
      serializeCookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: options.secureCookies ?? false,
        path: '/',
      }),
    );
    res.status(200).json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    destroySession(sessionTokenFromRequest(req));
    res.setHeader(
      'Set-Cookie',
      serializeCookie(SESSION_COOKIE_NAME, '', {
        httpOnly: true,
        sameSite: 'strict',
        secure: options.secureCookies ?? false,
        path: '/',
        maxAge: 0,
      }),
    );
    res.status(200).json({ ok: true });
  });

  return router;
}
