/**
 * What the operator's console records about the site's own running, for
 * its status and usage pages. Counts and times only: never a phone number,
 * a message, or anything else about an account.
 *
 * This file imports nothing from the rest of the app, so that any part of
 * it (the periodic job, the text-message webhook, the sending of texts) can
 * call these functions without an import cycle.
 *
 *   - `usage_daily`: one row per day (UTC): texts sent, sign-in codes sent,
 *     texts received, accounts created, accounts deleted.
 *   - `site` rows whose key begins with "ops:": the times of the last run of
 *     the periodic job, the last text sent, the last failure and its kind,
 *     the last text received, and the operator's own notes.
 */

const DAY = 86_400_000;

const ADMIN_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS usage_daily (
    day TEXT PRIMARY KEY,
    texts_sent INTEGER NOT NULL DEFAULT 0,
    codes_sent INTEGER NOT NULL DEFAULT 0,
    texts_received INTEGER NOT NULL DEFAULT 0,
    signups INTEGER NOT NULL DEFAULT 0,
    deletions INTEGER NOT NULL DEFAULT 0
  )`,
];

/** The tables this file adds (the site table is created by schema.ts). */
export const ADMIN_TABLES = ['usage_daily'] as const;

const ready = new WeakSet<object>();

/** Creates the console's own table if it does not exist. Runs once per database binding. */
export async function ensureAdminSchema(db: D1Database): Promise<void> {
  if (ready.has(db)) return;
  await db.batch(ADMIN_STATEMENTS.map(sql => db.prepare(sql)));
  ready.add(db);
}

/** The (UTC) day of a time, as the site's counters use it: "2026-11-24". */
export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** The (UTC) month of a time: "2026-11". */
export const monthOf = (ms: number): string => new Date(ms).toISOString().slice(0, 7);
/** The start of the (UTC) day of a time. */
export const dayStart = (ms: number): number => Math.floor(ms / DAY) * DAY;

export const OPS = {
  /** The last time the every-minute job finished. */
  heartbeat: 'ops:heartbeat',
  /** The last time a text was seen to go out (from the monthly counter, or a recorded success). */
  sent: 'ops:sent',
  /** The last recorded failure to send: its time and kind. */
  failed: 'ops:failed',
  /** The last time a text arrived at the webhook. */
  received: 'ops:received',
  /** Counter values seen at the last usage snapshot (see admin-data.ts). */
  snapshot: 'ops:snapshot',
  /** The operator's notes to self and the price per text. */
  notes: 'ops:notes',
  /** The result of the last "Check" of each connection. */
  checks: 'ops:checks',
} as const;

const UPSERT_SITE = 'INSERT INTO site (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at';

export function putOpsStatement(db: D1Database, key: string, value: unknown, now: number): D1PreparedStatement {
  return db.prepare(UPSERT_SITE).bind(key, JSON.stringify(value), now);
}

/** Adds to one day's counts. Only the named columns can be given. */
export function addUsageStatement(
  db: D1Database,
  day: string,
  add: Partial<Record<'texts_sent' | 'codes_sent' | 'texts_received' | 'signups' | 'deletions', number>>,
): D1PreparedStatement {
  const v = { texts_sent: 0, codes_sent: 0, texts_received: 0, signups: 0, deletions: 0, ...add };
  return db
    .prepare(
      `INSERT INTO usage_daily (day, texts_sent, codes_sent, texts_received, signups, deletions) VALUES (?1, MAX(?2, 0), MAX(?3, 0), MAX(?4, 0), MAX(?5, 0), MAX(?6, 0))
       ON CONFLICT (day) DO UPDATE SET
         texts_sent = MAX(usage_daily.texts_sent + ?2, 0),
         codes_sent = MAX(usage_daily.codes_sent + ?3, 0),
         texts_received = MAX(usage_daily.texts_received + ?4, 0),
         signups = MAX(usage_daily.signups + ?5, 0),
         deletions = MAX(usage_daily.deletions + ?6, 0)`,
    )
    .bind(day, v.texts_sent, v.codes_sent, v.texts_received, v.signups, v.deletions);
}

/**
 * Notes that a text arrived at the webhook: one more in today's count, and
 * the time. Nothing about the text or its sender is recorded.
 */
export async function noteTextReceived(db: D1Database, now: number): Promise<void> {
  await ensureAdminSchema(db);
  await db.batch([addUsageStatement(db, dayOf(now), { texts_received: 1 }), putOpsStatement(db, OPS.received, { at: now }, now)]);
}

/** The kinds of failure the console tells apart. */
export type FailureKind = 'not_set_up' | 'site_limit' | 'blocked' | 'auth' | 'refused' | 'network';

/** The shape of the result of sending a text (service.ts `SmsOutcome`), without importing it. */
export type SendOutcome = { ok: true } | { ok: false; reason: string; detail: string };

/**
 * The kind of a failure, and Telnyx's error code if there was one. The
 * detail text itself is never kept, because Telnyx can quote the number in
 * it.
 */
export function failureOf(outcome: Extract<SendOutcome, { ok: false }>): { kind: FailureKind; code: string | null } {
  const code = /^Telnyx \d+: (\d{4,6})\b/.exec(outcome.detail)?.[1] ?? null;
  if (outcome.reason === 'not_set_up' || outcome.reason === 'site_limit' || outcome.reason === 'blocked') return { kind: outcome.reason, code };
  const status = Number(/^Telnyx (\d{3})/.exec(outcome.detail)?.[1] ?? 0);
  if (status === 401 || status === 403) return { kind: 'auth', code };
  if (status > 0) return { kind: 'refused', code };
  return { kind: 'network', code: null };
}

/**
 * Notes the result of sending a text: the time of the last success, or the
 * time and kind of the last failure. Meant to be called wherever a text is
 * sent (see the report for the one line in service.ts).
 */
export async function noteSmsOutcome(db: D1Database, outcome: SendOutcome, now: number): Promise<void> {
  if (outcome.ok) await putOpsStatement(db, OPS.sent, { at: now, confirmed: true }, now).run();
  else await putOpsStatement(db, OPS.failed, { at: now, ...failureOf(outcome) }, now).run();
}
