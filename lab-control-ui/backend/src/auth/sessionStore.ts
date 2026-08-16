// In-memory operator session store (T012, research.md §6). Deliberately not
// persisted -- single operator, same host, a backend restart requiring
// re-login is an accepted trade-off (spec.md Assumptions).

import { randomUUID, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'lab_ui_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

interface Session {
  createdAt: number;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

export function createSession(now: number = Date.now()): string {
  const token = randomUUID();
  sessions.set(token, { createdAt: now, expiresAt: now + SESSION_TTL_MS });
  return token;
}

export function isValidSession(token: string | undefined, now: number = Date.now()): boolean {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (session.expiresAt < now) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function destroySession(token: string | undefined): void {
  if (token) sessions.delete(token);
}

/** Constant-time secret comparison (FR-015 -- never reveal how close a
 * guess was). Always compares SECRET_MIN_LENGTH-padded buffers so an
 * incorrect-length guess doesn't short-circuit before the timingSafeEqual
 * call itself. */
export function secretsMatch(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate.padEnd(expected.length, '\0'));
  const b = Buffer.from(expected.padEnd(expected.length, '\0'));
  const lengthMatches = candidate.length === expected.length;
  const bytesMatch = a.length === b.length && timingSafeEqual(a, b);
  return lengthMatches && bytesMatch;
}

/** Test-only escape hatch to reset state between test cases. */
export function _resetSessionsForTests(): void {
  sessions.clear();
}
