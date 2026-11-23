/** Everything that reads or writes the database. */
import type { LogEntry } from '../engine/cycle';
import type { OnahPart } from '../engine/onah';
import { DEFAULT_HALACHIC_SETTINGS, parseHalachicSettings, type HalachicSettings } from '../engine/settings';
import { decrypt, encrypt } from './crypto';
import type { Env } from './env';
import { DEFAULT_APP_SETTINGS, parseAppSettings, type AppSettings } from './settings';

// ---------- single values ----------

async function putKv(db: D1Database, key: string, value: unknown, now: number): Promise<void> {
  await db
    .prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, JSON.stringify(value), now)
    .run();
}

export interface HalachicState {
  settings: HalachicSettings;
  /** When the settings were last reviewed and saved in the dashboard; null if never. */
  confirmedAt: number | null;
}

function parseHalachicState(stored: unknown): HalachicState {
  if (!stored) return { settings: DEFAULT_HALACHIC_SETTINGS, confirmedAt: null };
  const s = stored as { settings: unknown; confirmedAt: number | null };
  return { settings: parseHalachicSettings(s.settings), confirmedAt: s.confirmedAt };
}

export async function saveHalachic(db: D1Database, input: unknown, now: number): Promise<HalachicState> {
  const state: HalachicState = { settings: parseHalachicSettings(input), confirmedAt: now };
  await putKv(db, 'halachic', state, now);
  return state;
}

export async function saveApp(db: D1Database, input: unknown, now: number): Promise<AppSettings> {
  const settings = parseAppSettings(input);
  await putKv(db, 'app', settings, now);
  return settings;
}

// ---------- secrets (encrypted) ----------

export interface Secrets {
  googleClientId?: string;
  googleClientSecret?: string;
  googleRefreshToken?: string;
  telnyxApiKey?: string;
  telnyxPublicKey?: string;
  /** The number messages are sent from and received on, E.164. */
  telnyxNumber?: string;
}

export const SECRET_KEYS = ['googleClientId', 'googleClientSecret', 'googleRefreshToken', 'telnyxApiKey', 'telnyxPublicKey', 'telnyxNumber'] as const;

/** Merges `patch` into the stored secrets. A value of '' or null removes that secret. */
export async function saveSecrets(
  env: Env,
  current: Secrets,
  patch: Partial<Record<keyof Secrets, string | null>>,
  now: number,
): Promise<Secrets> {
  const next: Secrets = { ...current };
  for (const key of SECRET_KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === null || value === undefined || value.trim() === '') delete next[key];
    else next[key] = value.trim();
  }
  await putKv(env.DB, 'secrets', { data: await encrypt(env.ENCRYPTION_KEY, JSON.stringify(next)) }, now);
  return next;
}

export interface GoogleState {
  calendarId: string;
  connectedAt: number;
}

export const saveGoogle = (db: D1Database, state: GoogleState, now: number): Promise<void> => putKv(db, 'google', state, now);
export async function clearGoogle(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM kv WHERE key = 'google'").run();
}

export interface SyncState {
  /** Something changed since the calendar was last brought fully up to date. */
  dirty: boolean;
  lastRunAt: number | null;
  lastOkAt: number | null;
  lastError: string | null;
}

const NEW_SYNC_STATE: SyncState = { dirty: true, lastRunAt: null, lastOkAt: null, lastError: null };

export const saveSync = (db: D1Database, state: SyncState, now: number): Promise<void> => putKv(db, 'sync', state, now);

/** Notes that the calendar needs bringing up to date. */
export async function markDirty(db: D1Database, current: SyncState, now: number): Promise<void> {
  if (!current.dirty) await saveSync(db, { ...current, dirty: true }, now);
}

/** Everything kept as single values, read with one query. */
export interface Stored {
  halachic: HalachicState;
  app: AppSettings;
  secrets: Secrets;
  google: GoogleState | null;
  sync: SyncState;
}

export async function loadStored(env: Env): Promise<Stored> {
  const { results } = await env.DB.prepare('SELECT key, value FROM kv').all<{ key: string; value: string }>();
  const map = new Map(results.map(r => [r.key, JSON.parse(r.value) as unknown]));
  const secretsRow = map.get('secrets') as { data: string } | undefined;
  return {
    halachic: parseHalachicState(map.get('halachic')),
    app: map.has('app') ? parseAppSettings(map.get('app')) : DEFAULT_APP_SETTINGS,
    secrets: secretsRow ? (JSON.parse(await decrypt(env.ENCRYPTION_KEY, secretsRow.data)) as Secrets) : {},
    google: (map.get('google') as GoogleState | undefined) ?? null,
    sync: (map.get('sync') as SyncState | undefined) ?? NEW_SYNC_STATE,
  };
}

// ---------- the log ----------

export interface StoredEntry {
  entry: LogEntry;
  source: string;
  note: string | null;
  createdAt: number;
}

interface LogRow {
  id: string;
  kind: LogEntry['kind'];
  abs: number;
  part: OnahPart | null;
  veset: number;
  source: string;
  note: string | null;
  created_at: number;
}

function rowToEntry(r: LogRow): LogEntry {
  switch (r.kind) {
    case 'flow':
      if (!r.part) throw new Error(`log row ${r.id}: flow without an onah`);
      return { id: r.id, kind: 'flow', onah: { abs: r.abs, part: r.part }, veset: r.veset === 1 };
    case 'stain':
    case 'broken':
      if (!r.part) throw new Error(`log row ${r.id}: ${r.kind} without an onah`);
      return { id: r.id, kind: r.kind, onah: { abs: r.abs, part: r.part } };
    case 'hefsek':
    case 'mikvah':
      return { id: r.id, kind: r.kind, abs: r.abs };
  }
}

/** Entries that have not been removed, oldest first by time of recording. */
export async function listEntries(db: D1Database): Promise<StoredEntry[]> {
  const { results } = await db
    .prepare('SELECT id, kind, abs, part, veset, source, note, created_at FROM log WHERE deleted_at IS NULL ORDER BY created_at, id')
    .all<LogRow>();
  return results.map(r => ({ entry: rowToEntry(r), source: r.source, note: r.note, createdAt: r.created_at }));
}

export async function addEntry(db: D1Database, entry: LogEntry, source: string, note: string | null, now: number): Promise<void> {
  const abs = 'onah' in entry ? entry.onah.abs : entry.abs;
  const part = 'onah' in entry ? entry.onah.part : null;
  const veset = entry.kind === 'flow' ? (entry.veset ? 1 : 0) : 0;
  if (!Number.isInteger(abs)) throw new RangeError('entry date must be a whole day number');
  await db
    .prepare('INSERT INTO log (id, kind, abs, part, veset, source, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(entry.id, entry.kind, abs, part, veset, source, note, now)
    .run();
}

/** Marks an entry removed. Returns false if there was no such entry. */
export async function removeEntry(db: D1Database, id: string, now: number): Promise<boolean> {
  const result = await db.prepare('UPDATE log SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').bind(now, id).run();
  return result.meta.changes > 0;
}

// ---------- text messages ----------

/** Records a received message. Returns false if this message id was already recorded. */
export async function recordInbound(db: D1Database, id: string, from: string, body: string, now: number): Promise<boolean> {
  const result = await db
    .prepare("INSERT OR IGNORE INTO sms (id, direction, peer, body, at, status) VALUES (?, 'in', ?, ?, ?, 'received')")
    .bind(id, from, body.slice(0, 500), now)
    .run();
  return result.meta.changes > 0;
}

export async function setSmsStatus(db: D1Database, id: string, status: string, detail: string | null): Promise<void> {
  await db.prepare('UPDATE sms SET status = ?, detail = ? WHERE id = ?').bind(status, detail?.slice(0, 500) ?? null, id).run();
}

export async function recordOutbound(db: D1Database, id: string, to: string, body: string, now: number, status: string, detail: string | null): Promise<void> {
  await db
    .prepare("INSERT INTO sms (id, direction, peer, body, at, status, detail) VALUES (?, 'out', ?, ?, ?, ?, ?)")
    .bind(id, to, body.slice(0, 500), now, status, detail?.slice(0, 500) ?? null)
    .run();
}

export interface SmsRow {
  id: string;
  direction: 'in' | 'out';
  peer: string;
  body: string;
  at: number;
  status: string;
  detail: string | null;
}

export async function recentSms(db: D1Database, limit: number): Promise<SmsRow[]> {
  const { results } = await db.prepare('SELECT id, direction, peer, body, at, status, detail FROM sms ORDER BY at DESC, rowid DESC LIMIT ?').bind(limit).all<SmsRow>();
  return results;
}

/** Number of messages received from a number since a time; used to limit abuse. */
export async function inboundCountSince(db: D1Database, from: string, since: number): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM sms WHERE direction = 'in' AND peer = ? AND at >= ?").bind(from, since).first<{ n: number }>();
  return row?.n ?? 0;
}

// ---------- reminders ----------

/** Claims a reminder for a phone. Returns true only the first time. */
export async function claimReminder(db: D1Database, key: string, phone: string, now: number): Promise<boolean> {
  const result = await db.prepare('INSERT OR IGNORE INTO reminders_sent (key, phone, sent_at) VALUES (?, ?, ?)').bind(key, phone, now).run();
  return result.meta.changes > 0;
}

// ---------- sign-in rate limit ----------

export async function recordAuthFailure(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db.prepare('INSERT INTO auth_failures (at) VALUES (?)').bind(now),
    db.prepare('DELETE FROM auth_failures WHERE at < ?').bind(now - 24 * 3_600_000),
  ]);
}

export async function authFailuresSince(db: D1Database, since: number): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM auth_failures WHERE at >= ?').bind(since).first<{ n: number }>();
  return row?.n ?? 0;
}
