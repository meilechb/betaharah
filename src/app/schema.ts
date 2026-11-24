/**
 * The database tables. The Worker creates them itself the first time it
 * runs, so there is no separate migration step to forget.
 *
 * What is readable in the database, and what is not:
 *   - A household's settings, entries, phone numbers, Google token,
 *     messages and waiting reminders are one encrypted document
 *     (households.data).
 *   - Phone numbers, invitation codes and words, the codes for adding a
 *     phone by text, the one-time sign-in links texted by WEB, and calendar
 *     links appear only as keyed fingerprints. A household's pending
 *     conversation by text is inside its encrypted document. Counters of
 *     texts from numbers without an account are keyed by a fingerprint of
 *     the number.
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
  // One row per Google account that can sign in. hash is a fingerprint of Google's subject id.
  `CREATE TABLE IF NOT EXISTS google_ids (
    hash TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    session_epoch INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS google_ids_household ON google_ids (household_id)`,
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
  // texted code while sign-up is by invitation (or by texting JOIN and an
  // invitation word: see store.createInvitationWord). 'setup' is for one phone
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
  // A code for adding a phone to a household by text: the household's phone
  // texted ADD, and the new phone texts JOIN and the code. hash is a keyed
  // fingerprint of the code; it can be used once, until expires_at.
  `CREATE TABLE IF NOT EXISTS join_codes (
    hash TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS join_codes_household ON join_codes (household_id)`,
  // A one-time sign-in link texted in answer to WEB. hash is a keyed
  // fingerprint of its secret; phone_hash the phone that asked for it.
  `CREATE TABLE IF NOT EXISTS link_tokens (
    hash TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    phone_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS link_tokens_household ON link_tokens (household_id)`,
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

export const TABLES = ['households', 'phones', 'google_ids', 'codes', 'invites', 'join_codes', 'link_tokens', 'counters', 'site'] as const;
