/** Sign-in for the dashboard: one password, a signed session cookie. */
import { constantTimeEqual, sign, verifySigned } from './crypto';
import type { Env } from './env';
import { authFailuresSince, recordAuthFailure } from './store';

export const SESSION_COOKIE = 'mk_session';
const SESSION_DAYS = 30;
const FAILURE_WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 8;
const MIN_PASSWORD_LENGTH = 10;

export function isConfigured(env: Env): boolean {
  return typeof env.DASHBOARD_PASSWORD === 'string' && env.DASHBOARD_PASSWORD.length >= MIN_PASSWORD_LENGTH && typeof env.ENCRYPTION_KEY === 'string' && env.ENCRYPTION_KEY.length >= 32;
}

export type LoginResult = { ok: true; cookie: string } | { ok: false; status: 401 | 429 | 503; message: string };

export async function login(env: Env, password: unknown, now: number, secure: boolean): Promise<LoginResult> {
  if (!isConfigured(env)) {
    return { ok: false, status: 503, message: 'The server is not set up yet: DASHBOARD_PASSWORD (10+ characters) and ENCRYPTION_KEY (32+ characters) must be set.' };
  }
  if ((await authFailuresSince(env.DB, now - FAILURE_WINDOW_MS)) >= MAX_FAILURES) {
    return { ok: false, status: 429, message: 'Too many wrong passwords. Try again in 15 minutes.' };
  }
  if (typeof password !== 'string' || !(await constantTimeEqual(password, env.DASHBOARD_PASSWORD))) {
    await recordAuthFailure(env.DB, now);
    return { ok: false, status: 401, message: 'Wrong password.' };
  }
  const exp = now + SESSION_DAYS * 86_400_000;
  const token = await sign(env.ENCRYPTION_KEY, 'session', JSON.stringify({ exp }));
  return { ok: true, cookie: sessionCookie(token, SESSION_DAYS * 86_400, secure) };
}

export function sessionCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export async function hasSession(env: Env, cookieHeader: string | null | undefined, now: number): Promise<boolean> {
  if (!isConfigured(env)) return false;
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return false;
  const payload = await verifySigned(env.ENCRYPTION_KEY, 'session', token);
  if (!payload) return false;
  try {
    const { exp } = JSON.parse(payload) as { exp?: unknown };
    return typeof exp === 'number' && exp > now;
  } catch {
    return false;
  }
}

/** A short-lived signed value carried through the Google sign-in redirect. */
export async function makeOAuthState(env: Env, now: number): Promise<string> {
  return sign(env.ENCRYPTION_KEY, 'oauth', JSON.stringify({ exp: now + 10 * 60_000 }));
}

export async function checkOAuthState(env: Env, state: string | undefined, now: number): Promise<boolean> {
  if (!state) return false;
  const payload = await verifySigned(env.ENCRYPTION_KEY, 'oauth', state);
  if (!payload) return false;
  try {
    const { exp } = JSON.parse(payload) as { exp?: unknown };
    return typeof exp === 'number' && exp > now;
  } catch {
    return false;
  }
}
