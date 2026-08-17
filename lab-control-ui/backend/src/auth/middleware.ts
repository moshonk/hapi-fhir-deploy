import type { NextFunction, Request, Response } from 'express';
import { parseCookies } from './cookies.js';
import { SESSION_COOKIE_NAME, isValidSession } from './sessionStore.js';

export function sessionTokenFromRequest(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
}

/** Applied to every route except POST /api/auth/login (FR-013). */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = sessionTokenFromRequest(req);
  if (!isValidSession(token)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}
