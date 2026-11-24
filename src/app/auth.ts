/**
 * Sessions.
 *
 * People sign in with a phone number: a code texted to it, or a password
 * they chose. A session is a signed cookie naming the phone and its
 * household; it stops working when the phone signs out everywhere.
 *
 * The operator's console has its own sign-in with the DASHBOARD_PASSWORD
 * secret. It never shows any household's data.
 */
import { constantTimeEqual, fingerprint, sign, verifySigned } from './crypto';
import type { Env } from './env';
import { bump, getGoogleId, getPhone, readCounter, type GoogleRow, type PhoneRow } from './store';

export const SESSION_COOKIE = 'bt_session';
export const ADMIN_COOKIE = 'bt_admin';
const SESSION_DAYS = 60;
const ADMIN_HOURS = 12;
const MIN_OPERATOR_PASSWORD = 10;

export function isConfigured(env: Env): boolean {
  return (
    typeof env.DASHBOARD_PASSWORD === 'string' &&
    env.DASHBOARD_PASSWORD.length >= MIN_OPERATOR_PASSWORD &&
    typeof env.ENCRYPTION_KEY === 'string' &&
    env.ENCRYPTION_KEY.length >= 32
  );
}

export function cookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

// ---------- people ----------

export type SignInMethod = 'code' | 'password' | 'google';

export interface Session {
  /** Fingerprint of the phone number, or of the Google subject id. */
  phoneHash: string;
  householdId: string;
  /** How this session was started, and when. */
  method: SignInMethod;
  startedAt: number;
  kind: 'phone' | 'google';
  /** The phone's row as it is now. Null when the session is a Google sign-in. */
  phone: PhoneRow | null;
  google: GoogleRow | null;
}

/** A session cookie for a phone that has just proved who it is. */
export async function sessionCookie(env: Env, phone: PhoneRow, method: SignInMethod, now: number, secure: boolean): Promise<string> {
  const payload = JSON.stringify({ k: 'phone', p: phone.hash, h: phone.household_id, e: phone.session_epoch, m: method, t: now, x: now + SESSION_DAYS * 86_400_000 });
  return cookie(SESSION_COOKIE, await sign(env.ENCRYPTION_KEY, 'session', payload), SESSION_DAYS * 86_400, secure);
}

/** A session cookie for a Google account that has just proved who it is. */
export async function googleSessionCookie(env: Env, row: GoogleRow, now: number, secure: boolean): Promise<string> {
  const payload = JSON.stringify({ k: 'google', p: row.hash, h: row.household_id, e: row.session_epoch, m: 'google', t: now, x: now + SESSION_DAYS * 86_400_000 });
  return cookie(SESSION_COOKIE, await sign(env.ENCRYPTION_KEY, 'session', payload), SESSION_DAYS * 86_400, secure);
}

/** A cookie that removes the session from the browser. */
export function clearedCookie(name: string, secure: boolean): string {
  return cookie(name, '', 0, secure);
}

/**
 * The session a request carries, or null. Besides the signature and the
 * date, the phone must still exist, still belong to the same household,
 * and not have signed out everywhere since.
 */
export async function readSession(env: Env, cookieHeader: string | null | undefined, now: number): Promise<Session | null> {
  if (!isConfigured(env)) return null;
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  const payload = await verifySigned(env.ENCRYPTION_KEY, 'session', token);
  if (!payload) return null;
  let parsed: { k?: unknown; p?: unknown; h?: unknown; e?: unknown; m?: unknown; t?: unknown; x?: unknown };
  try {
    parsed = JSON.parse(payload) as typeof parsed;
  } catch {
    return null;
  }
  if (typeof parsed.p !== 'string' || typeof parsed.h !== 'string' || typeof parsed.e !== 'number' || typeof parsed.x !== 'number') return null;
  if (typeof parsed.t !== 'number' || parsed.x <= now) return null;
  // Cookies issued before Google sign-in have no k; they are phone sessions.
  if (parsed.k === 'google') {
    if (parsed.m !== 'google') return null;
    const google = await getGoogleId(env.DB, parsed.p);
    if (!google || google.household_id !== parsed.h || google.session_epoch !== parsed.e) return null;
    return { phoneHash: google.hash, householdId: google.household_id, method: 'google', startedAt: parsed.t, kind: 'google', phone: null, google };
  }
  if (parsed.m !== 'code' && parsed.m !== 'password') return null;
  const phone = await getPhone(env.DB, parsed.p);
  if (!phone || phone.household_id !== parsed.h || phone.session_epoch !== parsed.e) return null;
  return { phoneHash: phone.hash, householdId: phone.household_id, method: parsed.m, startedAt: parsed.t, kind: 'phone', phone, google: null };
}

// ---------- the operator ----------

const ADMIN_FAILURE_WINDOW_MS = 15 * 60_000;
/** Wrong passwords from one network address in the window. */
const ADMIN_MAX_FAILURES = 8;
/** Wrong passwords from all addresses together in the window: a backstop against guessing from many addresses. */
export const ADMIN_MAX_FAILURES_ALL = 300;
const ADMIN_FAIL_ALL_KEY = 'admin-fail-all';

export type AdminLogin = { ok: true; cookie: string } | { ok: false; status: 401 | 429 | 503; message: string };

/**
 * The operator's sign-in. Wrong passwords are counted per network address
 * (by a keyed fingerprint of it), so that a visitor who guesses locks out
 * only their own address and not the operator; a much higher count over all
 * addresses together stops guessing from many addresses.
 */
export async function adminLogin(env: Env, password: unknown, address: string, now: number, secure: boolean): Promise<AdminLogin> {
  if (!isConfigured(env)) {
    return { ok: false, status: 503, message: 'The server is not set up yet: DASHBOARD_PASSWORD (10+ characters) and ENCRYPTION_KEY (32+ characters) must be set.' };
  }
  const addressKey = `admin-fail:${(await fingerprint(env.ENCRYPTION_KEY, 'ip', address)).slice(0, 24)}`;
  if ((await readCounter(env.DB, addressKey, now)) >= ADMIN_MAX_FAILURES || (await readCounter(env.DB, ADMIN_FAIL_ALL_KEY, now)) >= ADMIN_MAX_FAILURES_ALL) {
    return { ok: false, status: 429, message: 'Too many wrong passwords. Try again in 15 minutes.' };
  }
  if (typeof password !== 'string' || !(await constantTimeEqual(password, env.DASHBOARD_PASSWORD))) {
    await bump(env.DB, addressKey, ADMIN_FAILURE_WINDOW_MS, now);
    await bump(env.DB, ADMIN_FAIL_ALL_KEY, ADMIN_FAILURE_WINDOW_MS, now);
    return { ok: false, status: 401, message: 'Wrong password.' };
  }
  const token = await sign(env.ENCRYPTION_KEY, 'admin', JSON.stringify({ x: now + ADMIN_HOURS * 3_600_000 }));
  return { ok: true, cookie: cookie(ADMIN_COOKIE, token, ADMIN_HOURS * 3600, secure) };
}

export async function hasAdminSession(env: Env, cookieHeader: string | null | undefined, now: number): Promise<boolean> {
  if (!isConfigured(env)) return false;
  const token = readCookie(cookieHeader, ADMIN_COOKIE);
  if (!token) return false;
  const payload = await verifySigned(env.ENCRYPTION_KEY, 'admin', token);
  if (!payload) return false;
  try {
    const { x } = JSON.parse(payload) as { x?: unknown };
    return typeof x === 'number' && x > now;
  } catch {
    return false;
  }
}

// ---------- the Google sign-in round trip ----------

/** A short-lived signed value carried through Google sign-in. `householdId` is set when an existing account is connecting Google. */
export async function makeLoginState(env: Env, args: { householdId: string | null; invite: string | null; now: number }): Promise<string> {
  return sign(env.ENCRYPTION_KEY, 'oauth-login', JSON.stringify({ h: args.householdId, i: args.invite, x: args.now + 10 * 60_000 }));
}

export async function readLoginState(env: Env, state: string | undefined, now: number): Promise<{ householdId: string | null; invite: string | null } | null> {
  if (!state) return null;
  const payload = await verifySigned(env.ENCRYPTION_KEY, 'oauth-login', state);
  if (!payload) return null;
  try {
    const { h, i, x } = JSON.parse(payload) as { h?: unknown; i?: unknown; x?: unknown };
    if (typeof x !== 'number' || x <= now) return null;
    return { householdId: typeof h === 'string' ? h : null, invite: typeof i === 'string' ? i : null };
  } catch {
    return null;
  }
}

/** A short-lived signed value carried through Google Calendar connect, tied to the household that started it. */
export async function makeOAuthState(env: Env, householdId: string, now: number): Promise<string> {
  return sign(env.ENCRYPTION_KEY, 'oauth', JSON.stringify({ h: householdId, x: now + 10 * 60_000 }));
}

/** The household that started the round trip, or null if the value is forged or old. */
export async function readOAuthState(env: Env, state: string | undefined, now: number): Promise<string | null> {
  if (!state) return null;
  const payload = await verifySigned(env.ENCRYPTION_KEY, 'oauth', state);
  if (!payload) return null;
  try {
    const { h, x } = JSON.parse(payload) as { h?: unknown; x?: unknown };
    return typeof h === 'string' && typeof x === 'number' && x > now ? h : null;
  } catch {
    return null;
  }
}
