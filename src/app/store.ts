/**
 * Everything that reads or writes the database.
 *
 * Isolation between households: a household's document can be read only by
 * its id, and the id always comes from a verified session, a verified text
 * message, or a secret calendar link, never from anything a visitor types.
 * The document is encrypted with its id bound in, so a row copied over
 * another household's row will not decrypt.
 */
import { parseHalachicSettings } from '../engine/settings';
import { decrypt, encrypt, fingerprint, randomId } from './crypto';
import type { Env } from './env';
import {
  DEFAULT_SITE_CONFIG,
  SITE_SECRET_KEYS,
  type HouseholdData,
  type Site,
  type SiteConfig,
  type SiteSecrets,
} from './model';
import { nextWake } from './queue';
import { parseAppSettings, ValidationError } from './settings';

// ---------- the site's settings ----------

export function parseSiteConfig(input: unknown): SiteConfig {
  if (typeof input !== 'object' || input === null) throw new ValidationError('expected an object');
  const o = input as Record<string, unknown>;
  const int = (v: unknown, what: string, min: number, max: number): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new ValidationError(`${what}: a whole number from ${min} to ${max}`);
    return v;
  };
  const text = (v: unknown, what: string, max: number): string => {
    if (typeof v !== 'string' || v.length > max) throw new ValidationError(`${what}: text of at most ${max} characters`);
    return v.trim();
  };
  if (o.signup !== 'open' && o.signup !== 'invite' && o.signup !== 'closed') throw new ValidationError('signup: open, invite or closed');
  if (typeof o.smsEnabled !== 'boolean') throw new ValidationError('smsEnabled: true or false');
  if (!Array.isArray(o.allowedPrefixes) || o.allowedPrefixes.length === 0 || o.allowedPrefixes.length > 20) {
    throw new ValidationError('allowedPrefixes: between 1 and 20 prefixes');
  }
  const allowedPrefixes = o.allowedPrefixes.map(p => {
    if (typeof p !== 'string' || !/^\+[1-9]\d{0,5}$/.test(p)) throw new ValidationError('allowedPrefixes: each must look like +1 or +44');
    return p;
  });
  const contactEmail = text(o.contactEmail, 'contactEmail', 120);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new ValidationError('contactEmail: not an email address');
  return {
    signup: o.signup,
    smsEnabled: o.smsEnabled,
    allowedPrefixes: [...new Set(allowedPrefixes)],
    dailyCodeLimit: int(o.dailyCodeLimit, 'dailyCodeLimit', 0, 100_000),
    monthlyMessageLimit: int(o.monthlyMessageLimit, 'monthlyMessageLimit', 0, 1_000_000),
    householdMonthlyLimit: int(o.householdMonthlyLimit, 'householdMonthlyLimit', 0, 10_000),
    contactName: text(o.contactName, 'contactName', 80),
    contactEmail,
  };
}

async function putSite(db: D1Database, key: string, value: string, now: number): Promise<void> {
  await db
    .prepare('INSERT INTO site (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, value, now)
    .run();
}

export async function loadSite(env: Env): Promise<Site> {
  const { results } = await env.DB.prepare('SELECT key, value FROM site').all<{ key: string; value: string }>();
  const map = new Map(results.map(r => [r.key, r.value]));
  const config = map.has('config') ? parseSiteConfig(JSON.parse(map.get('config') as string)) : DEFAULT_SITE_CONFIG;
  const secrets = map.has('secrets') ? (JSON.parse(await decrypt(env.ENCRYPTION_KEY, map.get('secrets') as string, 'site')) as SiteSecrets) : {};
  return { config, secrets };
}

export async function saveSiteConfig(env: Env, input: unknown, now: number): Promise<SiteConfig> {
  const config = parseSiteConfig(input);
  await putSite(env.DB, 'config', JSON.stringify(config), now);
  return config;
}

/** Merges `patch` into the stored keys. A value of '' or null removes that key. */
export async function saveSiteSecrets(env: Env, current: SiteSecrets, patch: Partial<Record<keyof SiteSecrets, string | null>>, now: number): Promise<SiteSecrets> {
  const next: SiteSecrets = { ...current };
  for (const key of SITE_SECRET_KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === null || value === undefined || value.trim() === '') delete next[key];
    else next[key] = value.trim();
  }
  await putSite(env.DB, 'secrets', await encrypt(env.ENCRYPTION_KEY, JSON.stringify(next), 'site'), now);
  return next;
}

// ---------- counters (rate limits and usage) ----------

/** Adds one to a counter and returns its new value. The counter disappears after `ttlMs`. */
export async function bump(db: D1Database, key: string, ttlMs: number, now: number): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO counters (key, value, expires_at) VALUES (?1, 1, ?2)
       ON CONFLICT (key) DO UPDATE SET
         value = CASE WHEN counters.expires_at <= ?3 THEN 1 ELSE counters.value + 1 END,
         expires_at = CASE WHEN counters.expires_at <= ?3 THEN ?2 ELSE counters.expires_at END
       RETURNING value`,
    )
    .bind(key, now + ttlMs, now)
    .first<{ value: number }>();
  if (!row) throw new Error('counter update returned nothing');
  return row.value;
}

export async function readCounter(db: D1Database, key: string, now: number): Promise<number> {
  const row = await db.prepare('SELECT value FROM counters WHERE key = ? AND expires_at > ?').bind(key, now).first<{ value: number }>();
  return row?.value ?? 0;
}

export async function clearCounter(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM counters WHERE key = ?').bind(key).run();
}

/** Removes expired counters, codes and invitations. Cheap; run now and then. */
export async function sweep(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM counters WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM codes WHERE expires_at <= ?').bind(now - 86_400_000),
    db.prepare('DELETE FROM invites WHERE expires_at <= ?').bind(now - 30 * 86_400_000),
  ]);
}

// ---------- households ----------

export interface Household {
  id: string;
  version: number;
  data: HouseholdData;
}

const context = (id: string): string => `household:${id}`;

/** Checks a decrypted document, so that a damaged or outdated one is noticed at once. */
function parseHousehold(raw: unknown): HouseholdData {
  const d = raw as HouseholdData;
  return {
    halachic: parseHalachicSettings(d.halachic),
    halachicConfirmedAt: d.halachicConfirmedAt ?? null,
    app: parseAppSettings(d.app),
    phones: Array.isArray(d.phones) ? d.phones : [],
    entries: Array.isArray(d.entries) ? d.entries : [],
    removed: Array.isArray(d.removed) ? d.removed : [],
    google: d.google ?? null,
    sync: d.sync ?? { dirty: true, lastRunAt: null, lastOkAt: null, lastError: null },
    calendarLinkToken: d.calendarLinkToken ?? null,
    messages: Array.isArray(d.messages) ? d.messages : [],
    queue: Array.isArray(d.queue) ? d.queue : [],
    usage: d.usage && typeof d.usage.month === 'string' && typeof d.usage.texts === 'number' ? d.usage : { month: '', texts: 0 },
    seenTexts: Array.isArray(d.seenTexts) ? d.seenTexts : [],
    googleLogin: parseGoogleLogin(d.googleLogin),
  };
}

function parseGoogleLogin(input: unknown): HouseholdData['googleLogin'] {
  if (typeof input !== 'object' || input === null) return null;
  const o = input as { email?: unknown; name?: unknown };
  if (typeof o.email !== 'string' || !o.email.includes('@')) return null;
  return { email: o.email.slice(0, 120), name: typeof o.name === 'string' ? o.name.slice(0, 80) : '' };
}

async function linkHash(env: Env, data: HouseholdData): Promise<string | null> {
  return data.calendarLinkToken ? fingerprint(env.ENCRYPTION_KEY, 'link', data.calendarLinkToken) : null;
}

export async function createHousehold(env: Env, data: HouseholdData, now: number): Promise<Household> {
  const id = randomId();
  await env.DB.prepare('INSERT INTO households (id, version, data, created_at, updated_at, refresh_at, wake_at, link_hash) VALUES (?, 1, ?, ?, ?, ?, ?, ?)')
    .bind(id, await encrypt(env.ENCRYPTION_KEY, JSON.stringify(data), context(id)), now, now, now, nextWake(data), await linkHash(env, data))
    .run();
  return { id, version: 1, data };
}

export async function loadHousehold(env: Env, id: string): Promise<Household | null> {
  const row = await env.DB.prepare('SELECT version, data FROM households WHERE id = ?').bind(id).first<{ version: number; data: string }>();
  if (!row) return null;
  const data = parseHousehold(JSON.parse(await decrypt(env.ENCRYPTION_KEY, row.data, context(id))));
  return { id, version: row.version, data };
}

/**
 * Saves a household if nobody else saved it since it was loaded. Returns
 * false when someone did; the caller loads again and repeats its change.
 * The time of its next reminder is written alongside, from the data itself,
 * so the two can never disagree.
 */
export async function saveHousehold(env: Env, h: Household, now: number, refreshAt?: number): Promise<boolean> {
  const encrypted = await encrypt(env.ENCRYPTION_KEY, JSON.stringify(h.data), context(h.id));
  const hash = await linkHash(env, h.data);
  const wake = nextWake(h.data);
  const result =
    refreshAt === undefined
      ? await env.DB.prepare('UPDATE households SET version = version + 1, data = ?, updated_at = ?, link_hash = ?, wake_at = ? WHERE id = ? AND version = ?')
          .bind(encrypted, now, hash, wake, h.id, h.version)
          .run()
      : await env.DB.prepare('UPDATE households SET version = version + 1, data = ?, updated_at = ?, link_hash = ?, wake_at = ?, refresh_at = ? WHERE id = ? AND version = ?')
          .bind(encrypted, now, hash, wake, refreshAt, h.id, h.version)
          .run();
  if (result.meta.changes === 0) return false;
  h.version += 1;
  return true;
}

export class ConflictError extends Error {
  constructor() {
    super('The data changed at the same moment. Please try again.');
    this.name = 'ConflictError';
  }
}

/**
 * Loads a household, applies `change` to it, and saves. If another request
 * saved in between, loads again and repeats. `change` must not have effects
 * outside the data it is given, because it can run more than once.
 */
export async function changeHousehold<T>(
  env: Env,
  id: string,
  now: number,
  change: (data: HouseholdData) => T | Promise<T>,
  refreshAt?: number,
): Promise<{ household: Household; result: T } | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const household = await loadHousehold(env, id);
    if (!household) return null;
    const result = await change(household.data);
    if (await saveHousehold(env, household, now, refreshAt)) return { household, result };
  }
  throw new ConflictError();
}

export async function householdIdByLink(env: Env, token: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT id FROM households WHERE link_hash = ?')
    .bind(await fingerprint(env.ENCRYPTION_KEY, 'link', token))
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** Households whose calendar and reminders are due to be refreshed, most overdue first. */
export async function householdsDue(db: D1Database, now: number, limit: number): Promise<string[]> {
  const { results } = await db.prepare('SELECT id FROM households WHERE refresh_at <= ? ORDER BY refresh_at LIMIT ?').bind(now, limit).all<{ id: string }>();
  return results.map(r => r.id);
}

export async function setRefresh(db: D1Database, id: string, at: number): Promise<void> {
  await db.prepare('UPDATE households SET refresh_at = ? WHERE id = ?').bind(at, id).run();
}

/** Households with a reminder due, the longest-waiting first. */
export async function householdsToWake(db: D1Database, now: number, limit: number): Promise<string[]> {
  const { results } = await db.prepare('SELECT id FROM households WHERE wake_at <= ? ORDER BY wake_at LIMIT ?').bind(now, limit).all<{ id: string }>();
  return results.map(r => r.id);
}

/** Stops the periodic job from opening a household whose data cannot be read. */
export async function clearWake(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE households SET wake_at = NULL WHERE id = ?').bind(id).run();
}

/** Deletes a household and everything that belongs to it. */
export async function deleteHousehold(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM codes WHERE household_id = ?').bind(id),
    db.prepare('DELETE FROM phones WHERE household_id = ?').bind(id),
    db.prepare('DELETE FROM google_ids WHERE household_id = ?').bind(id),
    db.prepare('DELETE FROM households WHERE id = ?').bind(id),
  ]);
}

// ---------- phones (sign-in identities) ----------

export interface PhoneRow {
  hash: string;
  household_id: string;
  password: string | null;
  session_epoch: number;
  created_at: number;
}

export const phoneHash = (env: Env, number: string): Promise<string> => fingerprint(env.ENCRYPTION_KEY, 'phone', number);

export async function getPhone(db: D1Database, hash: string): Promise<PhoneRow | null> {
  return db.prepare('SELECT hash, household_id, password, session_epoch, created_at FROM phones WHERE hash = ?').bind(hash).first<PhoneRow>();
}

/** Registers a phone for a household. Returns false if the number already belongs to an account. */
export async function insertPhone(db: D1Database, hash: string, householdId: string, password: string | null, now: number): Promise<boolean> {
  const result = await db.prepare('INSERT OR IGNORE INTO phones (hash, household_id, password, created_at) VALUES (?, ?, ?, ?)').bind(hash, householdId, password, now).run();
  return result.meta.changes > 0;
}

export async function deletePhone(db: D1Database, hash: string, householdId: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM phones WHERE hash = ? AND household_id = ?').bind(hash, householdId),
    db.prepare('DELETE FROM codes WHERE phone_hash = ?').bind(hash),
  ]);
}

export async function setPassword(db: D1Database, hash: string, password: string | null): Promise<void> {
  await db.prepare('UPDATE phones SET password = ? WHERE hash = ?').bind(password, hash).run();
}

/** Ends every session of this phone. */
export async function endSessions(db: D1Database, hash: string): Promise<void> {
  await db.prepare('UPDATE phones SET session_epoch = session_epoch + 1 WHERE hash = ?').bind(hash).run();
}

// ---------- Google sign-in identities ----------

export interface GoogleRow {
  hash: string;
  household_id: string;
  session_epoch: number;
  created_at: number;
}

export const googleHash = (env: Env, sub: string): Promise<string> => fingerprint(env.ENCRYPTION_KEY, 'google-sub', sub);

export async function getGoogleId(db: D1Database, hash: string): Promise<GoogleRow | null> {
  return db.prepare('SELECT hash, household_id, session_epoch, created_at FROM google_ids WHERE hash = ?').bind(hash).first<GoogleRow>();
}

/** Registers a Google account for a household. Returns false if it already belongs to an account. */
export async function insertGoogleId(db: D1Database, hash: string, householdId: string, now: number): Promise<boolean> {
  const result = await db.prepare('INSERT OR IGNORE INTO google_ids (hash, household_id, created_at) VALUES (?, ?, ?)').bind(hash, householdId, now).run();
  return result.meta.changes > 0;
}

export async function endGoogleSessions(db: D1Database, hash: string): Promise<void> {
  await db.prepare('UPDATE google_ids SET session_epoch = session_epoch + 1 WHERE hash = ?').bind(hash).run();
}

export interface SiteHealth {
  lastTickAt: number | null;
  lastTickError: string | null;
}

export async function loadHealth(db: D1Database): Promise<SiteHealth> {
  const row = await db.prepare("SELECT value FROM site WHERE key = 'health'").first<{ value: string }>();
  if (!row) return { lastTickAt: null, lastTickError: null };
  try {
    const v = JSON.parse(row.value) as { lastTickAt?: unknown; lastTickError?: unknown };
    return {
      lastTickAt: typeof v.lastTickAt === 'number' ? v.lastTickAt : null,
      lastTickError: typeof v.lastTickError === 'string' ? v.lastTickError : null,
    };
  } catch {
    return { lastTickAt: null, lastTickError: null };
  }
}

export async function saveHealth(db: D1Database, health: SiteHealth, now: number): Promise<void> {
  await putSite(db, 'health', JSON.stringify(health), now);
}

// ---------- codes ----------

export interface CodeRow {
  phone_hash: string;
  purpose: 'login' | 'add';
  household_id: string | null;
  code_hash: string;
  expires_at: number;
  attempts: number;
  sent_at: number;
  window_start: number;
  window_count: number;
}

export async function getCode(db: D1Database, hash: string): Promise<CodeRow | null> {
  return db
    .prepare('SELECT phone_hash, purpose, household_id, code_hash, expires_at, attempts, sent_at, window_start, window_count FROM codes WHERE phone_hash = ?')
    .bind(hash)
    .first<CodeRow>();
}

export async function putCode(db: D1Database, row: CodeRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO codes (phone_hash, purpose, household_id, code_hash, expires_at, attempts, sent_at, window_start, window_count)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
       ON CONFLICT (phone_hash) DO UPDATE SET purpose = excluded.purpose, household_id = excluded.household_id, code_hash = excluded.code_hash,
         expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at, window_start = excluded.window_start, window_count = excluded.window_count`,
    )
    .bind(row.phone_hash, row.purpose, row.household_id, row.code_hash, row.expires_at, row.sent_at, row.window_start, row.window_count)
    .run();
}

/** Counts a wrong guess. Returns the number of guesses made so far. */
export async function countAttempt(db: D1Database, hash: string): Promise<number> {
  const row = await db.prepare('UPDATE codes SET attempts = attempts + 1 WHERE phone_hash = ? RETURNING attempts').bind(hash).first<{ attempts: number }>();
  return row?.attempts ?? 0;
}

/**
 * Uses up a code so that it cannot be entered again. Returns false if it
 * was already used (two requests at the same moment). The send-rate
 * history is kept.
 */
export async function spendCode(db: D1Database, hash: string, codeHash: string): Promise<boolean> {
  const result = await db.prepare("UPDATE codes SET code_hash = '', expires_at = 0 WHERE phone_hash = ? AND code_hash = ?").bind(hash, codeHash).run();
  return result.meta.changes > 0;
}

// ---------- invitations ----------

export interface InviteRow {
  hash: string;
  kind: 'signup' | 'setup';
  /** For a 'setup' invitation: the fingerprint of the one number it is for. */
  phone_hash: string | null;
  note: string | null;
  created_at: number;
  expires_at: number;
  max_uses: number;
  uses: number;
}

export const inviteHash = (env: Env, code: string): Promise<string> => fingerprint(env.ENCRYPTION_KEY, 'invite', code);

export async function createInvite(db: D1Database, row: Omit<InviteRow, 'uses'>): Promise<void> {
  await db
    .prepare('INSERT INTO invites (hash, kind, phone_hash, note, created_at, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(row.hash, row.kind, row.phone_hash, row.note, row.created_at, row.expires_at, row.max_uses)
    .run();
}

export async function getInvite(db: D1Database, hash: string, now: number): Promise<InviteRow | null> {
  const row = await db
    .prepare('SELECT hash, kind, phone_hash, note, created_at, expires_at, max_uses, uses FROM invites WHERE hash = ?')
    .bind(hash)
    .first<InviteRow>();
  if (!row || row.expires_at <= now || row.uses >= row.max_uses) return null;
  return row;
}

/** Uses an invitation once. Returns false if it was used up or expired in the meantime. */
export async function useInvite(db: D1Database, hash: string, now: number): Promise<boolean> {
  const result = await db.prepare('UPDATE invites SET uses = uses + 1 WHERE hash = ? AND uses < max_uses AND expires_at > ?').bind(hash, now).run();
  return result.meta.changes > 0;
}

export async function listInvites(db: D1Database, now: number): Promise<InviteRow[]> {
  const { results } = await db
    .prepare('SELECT hash, kind, phone_hash, note, created_at, expires_at, max_uses, uses FROM invites WHERE expires_at > ? AND uses < max_uses ORDER BY created_at DESC LIMIT 100')
    .bind(now)
    .all<InviteRow>();
  return results;
}

export async function deleteInvite(db: D1Database, hash: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM invites WHERE hash = ?').bind(hash).run();
  return result.meta.changes > 0;
}

// ---------- totals for the operator ----------

export interface SiteTotals {
  households: number;
  phones: number;
  /** Households that have a reminder waiting to be sent. */
  waiting: number;
}

export async function siteTotals(db: D1Database): Promise<SiteTotals> {
  const row = await db
    .prepare(
      'SELECT (SELECT COUNT(*) FROM households) AS households, (SELECT COUNT(*) FROM phones) AS phones, (SELECT COUNT(*) FROM households WHERE wake_at IS NOT NULL) AS waiting',
    )
    .first<SiteTotals>();
  return row ?? { households: 0, phones: 0, waiting: 0 };
}

export interface HouseholdSummary {
  id: string;
  created_at: number;
  updated_at: number;
  phones: number;
}

/** A list of households with nothing personal in it: ids, dates and a count of phones. */
export async function listHouseholds(db: D1Database): Promise<HouseholdSummary[]> {
  const { results } = await db
    .prepare(
      'SELECT h.id, h.created_at, h.updated_at, (SELECT COUNT(*) FROM phones p WHERE p.household_id = h.id) AS phones FROM households h ORDER BY h.created_at DESC LIMIT 500',
    )
    .all<HouseholdSummary>();
  return results;
}
