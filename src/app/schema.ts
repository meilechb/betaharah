/**
 * The database tables. The Worker creates them itself the first time it
 * runs, so there is no separate migration step to forget.
 */
const STATEMENTS = [
  // Settings and other single values, as JSON text.
  `CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  // The record of events. Entries are never changed; removing one sets deleted_at.
  // abs: R.D. day number of the Hebrew date (see src/engine/onah.ts).
  // part: 'night' or 'day' for flow, stain and broken; NULL for hefsek and mikvah.
  // source: 'dashboard' or 'sms:<number>'.
  `CREATE TABLE IF NOT EXISTS log (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('flow', 'stain', 'hefsek', 'broken', 'mikvah')),
    abs INTEGER NOT NULL,
    part TEXT CHECK (part IS NULL OR part IN ('night', 'day')),
    veset INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL,
    note TEXT,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS log_active ON log (deleted_at, abs)`,
  // Text messages received and sent. The id of a received message is the
  // provider's event id, so a repeated delivery is recognised.
  `CREATE TABLE IF NOT EXISTS sms (
    id TEXT PRIMARY KEY,
    direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    peer TEXT NOT NULL,
    body TEXT NOT NULL,
    at INTEGER NOT NULL,
    status TEXT NOT NULL,
    detail TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS sms_at ON sms (at)`,
  // One row per reminder per phone, written before sending, so that a
  // reminder is never sent twice.
  `CREATE TABLE IF NOT EXISTS reminders_sent (
    key TEXT NOT NULL,
    phone TEXT NOT NULL,
    sent_at INTEGER NOT NULL,
    PRIMARY KEY (key, phone)
  )`,
  // Failed sign-in attempts, for rate limiting.
  `CREATE TABLE IF NOT EXISTS auth_failures (
    at INTEGER NOT NULL
  )`,
];

const ready = new WeakSet<object>();

/** Creates the tables if they do not exist. Runs once per database binding. */
export async function ensureSchema(db: D1Database): Promise<void> {
  if (ready.has(db)) return;
  await db.batch(STATEMENTS.map(sql => db.prepare(sql)));
  ready.add(db);
}
