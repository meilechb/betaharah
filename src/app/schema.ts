/**
 * The database tables. The Worker creates them itself the first time it
 * runs, so there is no separate migration step to forget.
 *
 * What is readable in the database, and what is not:
 *   - A household's settings, entries, phone numbers, Google token,
 *     messages and waiting reminders are one encrypted document
 *     (households.data).
 *   - Phone numbers, invitation codes and calendar links appear only as
 *     keyed fingerprints.
 *   - Readable: ids, timestamps (among them the time of each household's
 *     next reminder, which the periodic job needs), counters, and the
 *     site's own settings.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS households (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    refresh_at INTEGER NOT NULL,
    wake_at INTEGER,
    link_hash TEXT UNIQUE
  )`,
  `CREATE INDEX IF NOT EXISTS households_refresh ON households (refresh_at)`,
  // wake_at: when the household's next reminder is due; null when none waits.
  `CREATE INDEX IF NOT EXISTS households_wake ON households (wake_at)`,
  // One row per phone that can sign in. hash is a fingerprint of the number.
  `CREATE TABLE IF NOT EXISTS phones (
    hash TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    password TEXT,
    session_epoch INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS phones_household ON phones (household_id)`,
  // A sign-in or add-a-phone code that was texted and is waiting to be entered.
  `CREATE TABLE IF NOT EXISTS codes (
    phone_hash TEXT PRIMARY KEY,
    purpose TEXT NOT NULL CHECK (purpose IN ('login', 'add')),
    household_id TEXT,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER NOT NULL,
    window_start INTEGER NOT NULL,
    window_count INTEGER NOT NULL
  )`,
  // Invitations made by the operator. 'signup' lets someone sign up with a
  // texted code while sign-up is by invitation. 'setup' is for one phone
  // number (phone_hash) and lets its owner create the account with a
  // password, without a texted code.
  `CREATE TABLE IF NOT EXISTS invites (
    hash TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('signup', 'setup')),
    phone_hash TEXT,
    note TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    max_uses INTEGER NOT NULL,
    uses INTEGER NOT NULL DEFAULT 0
  )`,
  // Rate limits and usage counts.
  `CREATE TABLE IF NOT EXISTS counters (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  // The site's own settings; its API keys are stored encrypted.
  `CREATE TABLE IF NOT EXISTS site (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
];

const ready = new WeakSet<object>();

/** Creates the tables if they do not exist. Runs once per database binding. */
export async function ensureSchema(db: D1Database): Promise<void> {
  if (ready.has(db)) return;
  await db.batch(STATEMENTS.map(sql => db.prepare(sql)));
  ready.add(db);
}

export const TABLES = ['households', 'phones', 'codes', 'invites', 'counters', 'site'] as const;
