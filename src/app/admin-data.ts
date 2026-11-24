/**
 * The data behind the operator's console: the main state (one database
 * round trip to read, at most one to write), the daily usage counts, the
 * list of accounts, the setup checklist, and the harmless "Check" calls to
 * Telnyx and Google.
 *
 * The console never shows any account's data. Everything here is a count,
 * a time, an internal id, or the site's own settings. Each account is one
 * encrypted document and nothing here decrypts one.
 */
import { ADMIN_COOKIE, readCookie } from './auth';
import { decrypt, verifySigned } from './crypto';
import { DEMO_NUMBER } from './demo';
import type { Deps, Env } from './env';
import { addUsageStatement, dayOf, dayStart, ensureAdminSchema, monthOf, OPS, putOpsStatement, type FailureKind } from './admin-notes';
import { DEFAULT_SITE_CONFIG, googleReady, rcsReady, SITE_SECRET_KEYS, smsReady, type Site, type SiteConfig, type SiteSecrets } from './model';
import { STRANGER_REPLIES_PER_DAY, STRANGER_REPLIES_PER_NUMBER, strangerDayKey, TEXT_SIGNUPS_PER_DAY, textSignupsKey } from './conversation';
import { codesTodayKey, textsThisMonthKey } from './service';
import { parseSiteConfig, phoneHash, type HouseholdSummary } from './store';

const DAY = 86_400_000;

// ---------- the operator's notes and the results of checks ----------

export interface Notes {
  /** When the operator ticked "I submitted the toll-free verification"; null if not ticked. */
  tollFreeSubmittedAt: number | null;
  /** When the operator ticked "Telnyx says the number is verified"; null if not ticked. */
  tollFreeVerifiedAt: number | null;
  /** The price of one text in cents, for the cost estimate. */
  centsPerText: number;
}

export const DEFAULT_NOTES: Notes = { tollFreeSubmittedAt: null, tollFreeVerifiedAt: null, centsPerText: 1 };

export interface CheckResult {
  at: number;
  ok: boolean;
  /** A plain sentence for the operator. */
  message: string;
  /** For RCS: the agent's status as Telnyx reports it (CREATED, VERIFYING, LIVE, ...). */
  agentStatus?: string | null;
}

export type Checks = Partial<Record<'telnyx' | 'rcs' | 'google', CheckResult>>;

interface Snapshot {
  at: number;
  /** The month of the texts counter, and its value then. */
  month: string;
  sms: number;
  /** Accounts other than the test account, and the newest creation time among them. */
  total: number;
  maxCreated: number;
}

function parseJson<T>(text: string | undefined, fallback: T): T {
  if (text === undefined) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

// ---------- the operator's session ----------

/** When the operator's session ends, or null if the cookie is missing or not valid. */
export async function adminSessionUntil(env: Env, cookieHeader: string | null | undefined): Promise<number | null> {
  const token = readCookie(cookieHeader, ADMIN_COOKIE);
  if (!token) return null;
  const payload = await verifySigned(env.ENCRYPTION_KEY, 'admin', token);
  if (!payload) return null;
  const { x } = parseJson<{ x?: unknown }>(payload, {});
  return typeof x === 'number' ? x : null;
}

// ---------- the daily counts ----------

/**
 * Statements that read what a usage snapshot needs. Kept as a list so that
 * the main state can read them in the same round trip as everything else.
 */
function snapshotReads(db: D1Database, demoHash: string, now: number): D1PreparedStatement[] {
  return [
    db.prepare('SELECT value FROM site WHERE key = ?').bind(OPS.snapshot),
    db.prepare('SELECT value FROM site WHERE key = ?').bind(OPS.sent),
    db.prepare('SELECT value FROM counters WHERE key = ? AND expires_at > ?').bind(textsThisMonthKey(now), now),
    db.prepare('SELECT value FROM counters WHERE key = ? AND expires_at > ?').bind(codesTodayKey(now), now),
    db.prepare('SELECT value FROM counters WHERE key = ? AND expires_at > ?').bind(codesTodayKey(now - DAY), now),
    db
      .prepare(
        `SELECT COUNT(*) AS t, COALESCE(MAX(created_at), 0) AS m,
           COALESCE(SUM(CASE WHEN created_at > COALESCE((SELECT json_extract(value, '$.maxCreated') FROM site WHERE key = ?1), 9e15) THEN 1 ELSE 0 END), 0) AS n
         FROM households WHERE id NOT IN (SELECT household_id FROM phones WHERE hash = ?2)`,
      )
      .bind(OPS.snapshot, demoHash),
  ];
}

const first = <T>(r: D1Result<unknown> | undefined): T | undefined => r?.results[0] as T | undefined;

/**
 * Works out what changed since the last snapshot and returns the
 * statements that record it: texts sent (from the monthly counter), codes
 * sent (from the daily counter), accounts created and deleted (from the
 * number of accounts). Accounts made and deleted within one snapshot
 * interval are not seen; the test account is never counted.
 */
function snapshotWrites(
  db: D1Database,
  results: Array<D1Result<unknown>>,
  now: number,
): {
  writes: D1PreparedStatement[];
  prev: Snapshot | null;
  sms: number;
  codesToday: number;
  added: { texts: number; signups: number; deletions: number };
  /** The last text known to have gone out, after this snapshot. */
  sent: { at: number; confirmed: boolean } | null;
} {
  const prev = parseJson<Snapshot | null>(first<{ value: string }>(results[0])?.value, null);
  let sent = parseJson<{ at: number; confirmed: boolean } | null>(first<{ value: string }>(results[1])?.value, null);
  const sms = first<{ value: number }>(results[2])?.value ?? 0;
  const codesToday = first<{ value: number }>(results[3])?.value ?? 0;
  const codesYesterday = first<{ value: number }>(results[4])?.value ?? 0;
  const acc = first<{ t: number; m: number; n: number }>(results[5]) ?? { t: 0, m: 0, n: 0 };
  const today = dayOf(now);
  const month = monthOf(now);
  const writes: D1PreparedStatement[] = [];
  const codes = (day: string, value: number) =>
    db.prepare('INSERT INTO usage_daily (day, codes_sent) VALUES (?1, ?2) ON CONFLICT (day) DO UPDATE SET codes_sent = MAX(usage_daily.codes_sent, ?2)').bind(day, value);
  if (codesToday > 0) writes.push(codes(today, codesToday));
  if (codesYesterday > 0) writes.push(codes(dayOf(now - DAY), codesYesterday));

  const added = { texts: 0, signups: 0, deletions: 0 };
  if (prev) {
    // Texts: the monthly counter goes down again when a send fails, so a fall is subtracted too.
    added.texts = prev.month === month ? sms - prev.sms : sms;
    added.signups = acc.n;
    added.deletions = Math.max(0, prev.total + acc.n - acc.t);
    if (added.texts !== 0 || added.signups > 0 || added.deletions > 0) writes.push(addUsageStatement(db, today, { texts_sent: added.texts, signups: added.signups, deletions: added.deletions }));
  }
  const next: Snapshot = { at: now, month, sms, total: acc.t, maxCreated: Math.max(acc.m, prev?.maxCreated ?? 0) };
  writes.push(putOpsStatement(db, OPS.snapshot, next, now));
  // Texts went out since the last snapshot. Unless a success was recorded in that time, the time of this snapshot stands for it.
  if (prev && added.texts > 0 && !(sent && sent.at >= prev.at)) {
    sent = { at: now, confirmed: false };
    writes.push(putOpsStatement(db, OPS.sent, sent, now));
  }
  return { writes, prev, sms, codesToday, added, sent };
}

/** The first snapshot ever: the accounts that exist are counted on the days they were created. */
async function backfillSignups(db: D1Database, demoHash: string, now: number): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT CAST(created_at / 86400000 AS INTEGER) AS d, COUNT(*) AS n FROM households
       WHERE created_at >= ? AND id NOT IN (SELECT household_id FROM phones WHERE hash = ?) GROUP BY d`,
    )
    .bind(dayStart(now) - 90 * DAY, demoHash)
    .all<{ d: number; n: number }>();
  if (results.length > 0) await db.batch(results.map(r => addUsageStatement(db, dayOf(r.d * DAY), { signups: r.n })));
}

/** Brings the daily counts up to date. Two round trips (three the very first time). */
export async function takeSnapshot(env: Env, now: number): Promise<void> {
  await ensureAdminSchema(env.DB);
  const demoHash = await phoneHash(env, DEMO_NUMBER);
  const results = await env.DB.batch(snapshotReads(env.DB, demoHash, now));
  const { writes, prev } = snapshotWrites(env.DB, results, now);
  await env.DB.batch(writes);
  if (!prev) await backfillSignups(env.DB, demoHash, now);
}

/**
 * For the scheduled handler, after `tick` has finished: records that the
 * every-minute job ran, and brings the daily counts up to date. Errors are
 * logged by kind only and never stop the job.
 */
export async function recordTick(env: Env, now: number): Promise<void> {
  try {
    await ensureAdminSchema(env.DB);
    await putOpsStatement(env.DB, OPS.heartbeat, { at: now }, now).run();
    await takeSnapshot(env, now);
  } catch (e) {
    console.error('recordTick failed', e instanceof Error ? e.name : 'error');
  }
}

export interface DayCounts {
  day: string;
  textsSent: number;
  codesSent: number;
  textsReceived: number;
  signups: number;
  deletions: number;
}

interface UsageRow {
  day: string;
  texts_sent: number;
  codes_sent: number;
  texts_received: number;
  signups: number;
  deletions: number;
}

const toCounts = (day: string, r: UsageRow | undefined): DayCounts => ({
  day,
  textsSent: r?.texts_sent ?? 0,
  codesSent: r?.codes_sent ?? 0,
  textsReceived: r?.texts_received ?? 0,
  signups: r?.signups ?? 0,
  deletions: r?.deletions ?? 0,
});

/** The last `days` days, oldest first, with a row for every day (zeros where nothing was counted). */
export async function usageHistory(env: Env, now: number, days: number): Promise<DayCounts[]> {
  await takeSnapshot(env, now);
  const from = dayOf(now - (days - 1) * DAY);
  const { results } = await env.DB.prepare('SELECT day, texts_sent, codes_sent, texts_received, signups, deletions FROM usage_daily WHERE day >= ? ORDER BY day').bind(from).all<UsageRow>();
  const byDay = new Map(results.map(r => [r.day, r]));
  const out: DayCounts[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayOf(now - i * DAY);
    out.push(toCounts(day, byDay.get(day)));
  }
  return out;
}

// ---------- the main state ----------

export interface InviteSummary {
  id: string;
  kind: 'signup' | 'setup';
  note: string | null;
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  uses: number;
}

export type ChecklistStatus = 'done' | 'todo' | 'waiting' | 'optional';

export interface ChecklistItem {
  key: 'contact' | 'account' | 'telnyx_keys' | 'test_text' | 'verification' | 'webhook' | 'signup' | 'rcs' | 'google';
  title: string;
  status: ChecklistStatus;
  /** What is the case now, in a sentence. */
  detail: string;
  /** The precise next step, or null when there is nothing to do. */
  next: string | null;
  /** The section of the console where the step is done. */
  section: 'settings' | 'keys' | 'invites' | 'tools' | 'test';
  optional: boolean;
}

export interface ChecklistInput {
  config: SiteConfig;
  configSaved: boolean;
  secretsSet: Record<(typeof SITE_SECRET_KEYS)[number], boolean>;
  smsReady: boolean;
  rcsReady: boolean;
  googleReady: boolean;
  /** Accounts other than the test account. */
  regularAccounts: number;
  lastSentAt: number | null;
  lastReceivedAt: number | null;
  notes: Notes;
  checks: Checks;
}

/**
 * The setup steps in the order they are best done, each with its status
 * and the next thing to do. "waiting" means someone else (Telnyx, the
 * carriers) has to act; the site cannot see their decision, so the
 * operator's own note or a check stands in for it.
 */
export function buildChecklist(s: ChecklistInput): ChecklistItem[] {
  const telnyxKeys = s.secretsSet.telnyxApiKey && s.secretsSet.telnyxPublicKey && s.secretsSet.telnyxNumber;
  const items: ChecklistItem[] = [];
  items.push(
    s.config.contactName
      ? { key: 'contact', title: 'Contact details for the public pages', status: 'done', detail: `The Help, Privacy and Terms pages name ${s.config.contactName}${s.config.contactEmail ? ` and show ${s.config.contactEmail}` : ''}.`, next: null, section: 'settings', optional: false }
      : { key: 'contact', title: 'Contact details for the public pages', status: 'todo', detail: 'The Help, Privacy and Terms pages do not name anyone yet. The toll-free verification reviewers read these pages.', next: 'Under Site settings, enter your name (or a name for the site) and, if you want, a public email address. Then press Save settings.', section: 'settings', optional: false },
  );
  items.push(
    s.regularAccounts > 0
      ? { key: 'account', title: 'Your own account', status: 'done', detail: `There ${s.regularAccounts === 1 ? 'is 1 account' : `are ${s.regularAccounts} accounts`} besides the test account. The console cannot tell whose account is whose.`, next: null, section: 'invites', optional: false }
      : {
          key: 'account',
          title: 'Your own account',
          status: 'todo',
          detail: 'No account exists yet, other than the test account.',
          next: s.smsReady
            ? 'Open the sign-in page (/app/) on your phone, enter your number and the texted code.'
            : 'Under Invitations, make an invitation "For one phone number" with your own number. Open the link, enter the same number and choose a password.',
          section: 'invites',
          optional: false,
        },
  );
  items.push(
    telnyxKeys
      ? { key: 'telnyx_keys', title: 'Texting number: Telnyx keys saved', status: 'done', detail: 'The API key, the public key and the number are saved.', next: null, section: 'keys', optional: false }
      : {
          key: 'telnyx_keys',
          title: 'Texting number: Telnyx keys saved',
          status: 'todo',
          detail: `Missing: ${[!s.secretsSet.telnyxApiKey && 'the API key', !s.secretsSet.telnyxPublicKey && 'the public key', !s.secretsSet.telnyxNumber && 'the number'].filter(Boolean).join(', ')}.`,
          next: 'Buy a toll-free number with SMS in Telnyx and put it in a Messaging Profile. Then, under Keys and connections, paste the API key, the public key and the number, and press Save Telnyx keys.',
          section: 'keys',
          optional: false,
        },
  );
  items.push(
    s.lastSentAt !== null
      ? { key: 'test_text', title: 'Texting number: a text delivered', status: 'done', detail: 'Telnyx has accepted a text from the site.', next: null, section: 'tools', optional: false }
      : {
          key: 'test_text',
          title: 'Texting number: a text delivered',
          status: 'todo',
          detail: telnyxKeys ? 'No text has been sent yet.' : 'This needs the Telnyx keys first.',
          next: telnyxKeys ? (s.config.smsEnabled ? 'Under Tools, send a test text to your own mobile number.' : 'Under Site settings, switch on "Send text messages", then send a test text under Tools.') : null,
          section: 'tools',
          optional: false,
        },
  );
  items.push(
    s.notes.tollFreeVerifiedAt !== null
      ? { key: 'verification', title: 'Texting number: toll-free verification', status: 'done', detail: 'You noted that Telnyx says the number is verified.', next: null, section: 'keys', optional: false }
      : s.notes.tollFreeSubmittedAt !== null
        ? { key: 'verification', title: 'Texting number: toll-free verification', status: 'waiting', detail: 'You noted that you submitted the verification. Telnyx says it takes one to two weeks. Until then, US carriers may not deliver the texts.', next: 'When Telnyx shows the number as verified, tick "Telnyx says the number is verified" under Keys and connections.', section: 'keys', optional: false }
        : { key: 'verification', title: 'Texting number: toll-free verification', status: 'todo', detail: 'The site cannot see this. US carriers do not deliver texts from an unverified toll-free number.', next: 'In the Telnyx portal, submit the toll-free verification for the number (suggested answers are in docs/OPERATOR.md). Then tick "I submitted the toll-free verification" under Keys and connections.', section: 'keys', optional: false },
  );
  items.push(
    s.lastReceivedAt !== null
      ? { key: 'webhook', title: 'Webhook: texts reach the site', status: 'done', detail: 'A text sent to the number has reached the site.', next: null, section: 'keys', optional: false }
      : { key: 'webhook', title: 'Webhook: texts reach the site', status: 'todo', detail: 'No text sent to the number has reached the site yet.', next: 'In Telnyx, set the Messaging Profile\'s inbound webhook URL to the address under Keys and connections. Then text 9 to the number from your phone.', section: 'keys', optional: false },
  );
  items.push(
    s.configSaved
      ? { key: 'signup', title: 'Sign-up policy chosen', status: 'done', detail: s.config.signup === 'open' ? 'Anyone with a phone number may create an account.' : s.config.signup === 'invite' ? 'Only people with an invitation link may create an account.' : 'Nobody may create an account. Existing accounts keep working.', next: null, section: 'settings', optional: false }
      : { key: 'signup', title: 'Sign-up policy chosen', status: 'todo', detail: 'The site still uses the first setting: anyone with a phone number may create an account.', next: 'Under Site settings, choose who may create an account, check the limits, and press Save settings.', section: 'settings', optional: false },
  );
  const rcsKeys = s.secretsSet.rcsAgentId && s.secretsSet.telnyxMessagingProfileId;
  const agent = s.checks.rcs?.agentStatus ?? null;
  items.push(
    s.rcsReady && agent === 'LIVE'
      ? { key: 'rcs', title: 'RCS (optional)', status: 'done', detail: 'RCS is switched on and Telnyx says the agent is live. Texts go by RCS where the phone supports it, and by SMS otherwise.', next: null, section: 'keys', optional: true }
      : !rcsKeys
        ? { key: 'rcs', title: 'RCS (optional)', status: 'optional', detail: 'Not set up. Texts go by SMS, which is enough.', next: null, section: 'keys', optional: true }
        : !s.config.rcsEnabled
          ? { key: 'rcs', title: 'RCS (optional)', status: 'todo', detail: 'The agent id and the messaging profile id are saved, but RCS is switched off.', next: 'Under Keys and connections, check the agent. When Telnyx says it is live, switch on "Send by RCS".', section: 'keys', optional: true }
          : { key: 'rcs', title: 'RCS (optional)', status: 'waiting', detail: agent ? `Telnyx says the agent's status is ${agent}. RCS needs an agent approved by Telnyx and the carriers.` : 'RCS is switched on. Check the agent to see whether Telnyx and the carriers have approved it.', next: 'Under Keys and connections, press Check RCS agent from time to time.', section: 'keys', optional: true },
  );
  items.push(
    s.googleReady
      ? { key: 'google', title: 'Google: sign-in and Calendar (optional)', status: 'done', detail: 'People can sign in with Google and connect their Google Calendar.', next: null, section: 'keys', optional: true }
      : { key: 'google', title: 'Google: sign-in and Calendar (optional)', status: 'optional', detail: 'Not set up. People sign in with a phone number, and can still use the calendar subscription link.', next: null, section: 'keys', optional: true },
  );
  return items;
}

/** Everything the console's first screen needs, read in one round trip. */
export async function adminState(env: Env, now: number, origin: string, cookieHeader: string | null | undefined) {
  await ensureAdminSchema(env.DB);
  const db = env.DB;
  const demoHash = await phoneHash(env, DEMO_NUMBER);
  const month = monthOf(now);
  const reads = [
    db.prepare('SELECT key, value, updated_at FROM site'),
    db.prepare(
      'SELECT (SELECT COUNT(*) FROM households) AS households, (SELECT COUNT(*) FROM phones) AS phones, (SELECT COUNT(*) FROM households WHERE wake_at IS NOT NULL) AS waiting',
    ),
    db.prepare(
      'SELECT h.id, h.created_at, h.updated_at, (SELECT COUNT(*) FROM phones p WHERE p.household_id = h.id) AS phones FROM households h ORDER BY h.created_at DESC LIMIT 500',
    ),
    db.prepare('SELECT household_id FROM phones WHERE hash = ?').bind(demoHash),
    db
      .prepare('SELECT hash, kind, note, created_at, expires_at, max_uses, uses FROM invites WHERE expires_at > ? AND uses < max_uses ORDER BY created_at DESC LIMIT 100')
      .bind(now),
    db
      .prepare(
        `SELECT COALESCE(SUM(texts_sent), 0) AS texts_sent, COALESCE(SUM(codes_sent), 0) AS codes_sent, COALESCE(SUM(texts_received), 0) AS texts_received,
           COALESCE(SUM(signups), 0) AS signups, COALESCE(SUM(deletions), 0) AS deletions FROM usage_daily WHERE day >= ?`,
      )
      .bind(`${month}-01`),
    db.prepare('SELECT day, texts_sent, codes_sent, texts_received, signups, deletions FROM usage_daily WHERE day = ?').bind(dayOf(now)),
    ...snapshotReads(db, demoHash, now),
    db.prepare('SELECT value FROM counters WHERE key = ? AND expires_at > ?').bind(strangerDayKey(now), now),
    db.prepare('SELECT value FROM counters WHERE key = ? AND expires_at > ?').bind(textSignupsKey(now), now),
  ];
  const results = await db.batch(reads);
  const S = 7; // where the snapshot's reads begin
  const T = S + 6; // where the texting caps' reads begin
  const snap = snapshotWrites(db, results.slice(S, T), now);

  const siteRows = (results[0]?.results ?? []) as Array<{ key: string; value: string; updated_at: number }>;
  const rows = new Map(siteRows.map(r => [r.key, r]));
  const configRow = rows.get('config');
  const config = configRow ? parseSiteConfig(JSON.parse(configRow.value)) : DEFAULT_SITE_CONFIG;
  const secretsRow = rows.get('secrets');
  const secrets = secretsRow ? (JSON.parse(await decrypt(env.ENCRYPTION_KEY, secretsRow.value, 'site')) as SiteSecrets) : {};
  const site: Site = { config, secrets };
  const ops = <T>(key: string): T | null => parseJson<T | null>(rows.get(key)?.value, null);
  const notes: Notes = { ...DEFAULT_NOTES, ...(ops<Partial<Notes>>(OPS.notes) ?? {}) };
  const checks = ops<Checks>(OPS.checks) ?? {};

  const totals = (first<{ households: number; phones: number; waiting: number }>(results[1]) ?? { households: 0, phones: 0, waiting: 0 }) as {
    households: number;
    phones: number;
    waiting: number;
  };
  const demoRow = first<{ household_id: string }>(results[3]);
  const monthRow = first<UsageRow>(results[5]);
  const todayRow = first<UsageRow>(results[6]);
  const accounts = first<{ t: number }>(results[S + 5]) ?? { t: 0 };
  const { sms, codesToday, added } = snap;

  // The snapshot is written after the reading, in one more round trip.
  await db.batch(snap.writes);
  if (!snap.prev) await backfillSignups(db, demoHash, now);

  const secretsSet = Object.fromEntries(SITE_SECRET_KEYS.map(k => [k, Boolean(secrets[k])])) as Record<(typeof SITE_SECRET_KEYS)[number], boolean>;
  const failed = ops<{ at: number; kind: FailureKind; code: string | null }>(OPS.failed);
  const lastSentAt = snap.sent?.at ?? null;
  const lastReceivedAt = ops<{ at: number }>(OPS.received)?.at ?? null;
  const regularAccounts = accounts.t;

  return {
    config,
    secretsSet,
    textingNumber: secrets.telnyxNumber ?? null,
    smsReady: smsReady(site),
    googleReady: googleReady(site),
    rcsReady: rcsReady(site),
    totals,
    usage: { textsThisMonth: sms, codesToday },
    households: (results[2]?.results ?? []) as unknown as HouseholdSummary[],
    // The test account, found by its phone; nothing of its data is read here.
    demo: { exists: demoRow !== undefined, number: DEMO_NUMBER },
    invites: ((results[4]?.results ?? []) as Array<{ hash: string; kind: 'signup' | 'setup'; note: string | null; created_at: number; expires_at: number; max_uses: number; uses: number }>).map(
      (i): InviteSummary => ({ id: i.hash, kind: i.kind, note: i.note, createdAt: i.created_at, expiresAt: i.expires_at, maxUses: i.max_uses, uses: i.uses }),
    ),
    urls: {
      webhook: `${origin}/webhooks/telnyx`,
      redirect: `${origin}/api/google/callback`,
      // An RCS agent's inbound webhook may be set to this address; it is read by the same handler.
      rcsWebhook: `${origin}/webhooks/telnyx/rcs`,
      // The second redirect to register with Google: signing in with Google, apart from the calendar.
      signInRedirect: `${origin}/api/auth/google/callback`,
      home: `${origin}/`,
      privacy: `${origin}/privacy`,
      terms: `${origin}/terms`,
    },
    // ----- added for the console's new pages; counts and times only -----
    session: { until: await adminSessionUntil(env, cookieHeader) },
    now,
    counts: {
      today: {
        day: dayOf(now),
        // What happened since the last snapshot is not in today's row yet; the write above records it.
        textsSent: Math.max(0, (todayRow?.texts_sent ?? 0) + added.texts),
        codesSent: codesToday,
        textsReceived: todayRow?.texts_received ?? 0,
        signups: (todayRow?.signups ?? 0) + added.signups,
        deletions: (todayRow?.deletions ?? 0) + added.deletions,
      },
      month: {
        month,
        textsSent: sms,
        codesSent: Math.max(monthRow?.codes_sent ?? 0, codesToday),
        textsReceived: monthRow?.texts_received ?? 0,
        signups: (monthRow?.signups ?? 0) + added.signups,
        deletions: (monthRow?.deletions ?? 0) + added.deletions,
      },
      regularAccounts,
      // Daily counts are kept from the first time the console or the periodic job took a snapshot.
      since: snap.prev ? null : now,
    },
    ops: {
      heartbeatAt: ops<{ at: number }>(OPS.heartbeat)?.at ?? null,
      lastSentAt,
      lastSentConfirmed: snap.sent?.confirmed === true,
      lastFailure: failed,
      lastReceivedAt,
      configSavedAt: configRow?.updated_at ?? null,
    },
    notes,
    checks,
    /** The caps on texting with numbers that have no account (conversation.ts), and today's counts against them. */
    textCaps: {
      strangerRepliesPerNumber: STRANGER_REPLIES_PER_NUMBER,
      strangerRepliesPerDay: STRANGER_REPLIES_PER_DAY,
      textSignupsPerDay: TEXT_SIGNUPS_PER_DAY,
      strangerRepliesToday: first<{ value: number }>(results[T])?.value ?? 0,
      textSignupsToday: first<{ value: number }>(results[T + 1])?.value ?? 0,
    },
    checklist: buildChecklist({
      config,
      configSaved: configRow !== undefined,
      secretsSet,
      smsReady: smsReady(site),
      rcsReady: rcsReady(site),
      googleReady: googleReady(site),
      regularAccounts,
      lastSentAt,
      lastReceivedAt,
      notes,
      checks,
    }),
    links: {
      app: `${origin}/app/`,
      help: `${origin}/help`,
      optIn1: `${origin}/sms-opt-in-1.png`,
      optIn2: `${origin}/sms-opt-in-2.png`,
    },
  };
}

export type AdminState = Awaited<ReturnType<typeof adminState>>;

// ---------- accounts ----------

export type AccountSort = 'newest' | 'oldest' | 'changed' | 'phones';

const ORDER: Record<AccountSort, string> = {
  newest: 'h.created_at DESC',
  oldest: 'h.created_at ASC',
  changed: 'h.updated_at DESC',
  phones: 'phones DESC, h.created_at DESC',
};

export interface AccountRow {
  id: string;
  createdAt: number;
  updatedAt: number;
  phones: number;
  /** Whether a reminder is waiting to be sent. When, and what, is not shown. */
  reminderWaiting: boolean;
  /** The operator's own test account. */
  test: boolean;
}

export const ACCOUNTS_SHOWN = 200;

/**
 * Accounts as counts and dates only, sorted, optionally narrowed to ids
 * containing `query`; and how many were created in each recent period
 * (the test account is left out of those totals).
 */
export async function listAccounts(env: Env, now: number, args: { sort: AccountSort; query: string }) {
  const db = env.DB;
  const demoHash = await phoneHash(env, DEMO_NUMBER);
  const q = args.query;
  const [list, counts] = await db.batch([
    db
      .prepare(
        `SELECT h.id, h.created_at, h.updated_at, (h.wake_at IS NOT NULL) AS waiting,
           (SELECT COUNT(*) FROM phones p WHERE p.household_id = h.id) AS phones,
           EXISTS (SELECT 1 FROM phones p WHERE p.household_id = h.id AND p.hash = ?1) AS test
         FROM households h WHERE (?2 = '' OR instr(lower(h.id), lower(?2)) > 0)
         ORDER BY ${ORDER[args.sort]} LIMIT ${ACCOUNTS_SHOWN}`,
      )
      .bind(demoHash, q),
    db
      .prepare(
        `SELECT COUNT(*) AS total,
           COALESCE(SUM(instr(lower(id), lower(?2)) > 0 OR ?2 = ''), 0) AS matched,
           COALESCE(SUM(created_at >= ?3), 0) AS today, COALESCE(SUM(created_at >= ?4), 0) AS week,
           COALESCE(SUM(created_at >= ?5), 0) AS month, COALESCE(SUM(created_at >= ?6), 0) AS year
         FROM households WHERE id NOT IN (SELECT household_id FROM phones WHERE hash = ?1)`,
      )
      .bind(demoHash, q, dayStart(now), now - 7 * DAY, now - 30 * DAY, now - 365 * DAY),
  ]);
  const rows = (list?.results ?? []) as Array<{ id: string; created_at: number; updated_at: number; waiting: number; phones: number; test: number }>;
  const c = first<{ total: number; matched: number; today: number; week: number; month: number; year: number }>(counts) ?? { total: 0, matched: 0, today: 0, week: 0, month: 0, year: 0 };
  const testShown = rows.some(r => r.test === 1);
  return {
    accounts: rows.map((r): AccountRow => ({ id: r.id, createdAt: r.created_at, updatedAt: r.updated_at, phones: r.phones, reminderWaiting: r.waiting === 1, test: r.test === 1 })),
    /** Accounts other than the test account. */
    total: c.total,
    /** Of those, how many match the search; the list itself may also hold the test account. */
    matched: c.matched,
    shown: rows.length,
    limit: ACCOUNTS_SHOWN,
    testShown,
    created: { today: c.today, week: c.week, month: c.month, year: c.year, all: c.total },
  };
}

// ---------- the operator's notes ----------

export async function loadOps<T>(db: D1Database, key: string, fallback: T): Promise<T> {
  const row = await db.prepare('SELECT value FROM site WHERE key = ?').bind(key).first<{ value: string }>();
  return parseJson<T>(row?.value, fallback);
}

export async function saveNotes(db: D1Database, patch: Partial<Notes>, now: number): Promise<Notes> {
  const notes = { ...DEFAULT_NOTES, ...(await loadOps<Partial<Notes>>(db, OPS.notes, {})), ...patch };
  await putOpsStatement(db, OPS.notes, notes, now).run();
  return notes;
}

export async function saveCheck(db: D1Database, which: keyof Checks, result: CheckResult, now: number): Promise<void> {
  const checks = { ...(await loadOps<Checks>(db, OPS.checks, {})), [which]: result };
  await putOpsStatement(db, OPS.checks, checks, now).run();
}

// ---------- the "Check" buttons: read-only calls that change nothing ----------

const TELNYX = 'https://api.telnyx.com/v2';

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Checks the Telnyx keys with a read-only call: the list of the account's
 * phone numbers, narrowed to the saved number (Telnyx documents
 * GET /v2/phone_numbers as the way to verify a key). It shows whether the
 * key is accepted, whether the number is on that account, and whether the
 * number is in a messaging profile.
 */
export async function checkTelnyx(deps: Deps, secrets: SiteSecrets, now: number): Promise<CheckResult> {
  const { telnyxApiKey, telnyxNumber, telnyxMessagingProfileId } = secrets;
  if (!telnyxApiKey || !telnyxNumber) return { at: now, ok: false, message: 'Save the API key and the number first.' };
  let res: Response;
  try {
    const url = `${TELNYX}/phone_numbers?${new URLSearchParams({ 'filter[phone_number]': telnyxNumber, 'page[size]': '20' }).toString()}`;
    res = await deps.fetch(url, { method: 'GET', headers: { authorization: `Bearer ${telnyxApiKey}`, accept: 'application/json' } });
  } catch {
    return { at: now, ok: false, message: 'Telnyx could not be reached. Try again in a minute.' };
  }
  if (res.status === 401 || res.status === 403) return { at: now, ok: false, message: 'Telnyx refused the API key. Copy the key again from the Telnyx portal (Keys & Credentials, API Keys), paste it here and save it.' };
  if (!res.ok) return { at: now, ok: false, message: `Telnyx answered with an error (status ${res.status}). Try again later.` };
  const body = (await readJson(res)) as { data?: Array<{ phone_number?: unknown; status?: unknown; messaging_profile_id?: unknown }> } | null;
  const entry = (body?.data ?? []).find(d => d.phone_number === telnyxNumber);
  if (!entry) return { at: now, ok: false, message: 'Telnyx accepted the API key, but the number you saved is not on that Telnyx account. Check the number.' };
  const profile = typeof entry.messaging_profile_id === 'string' && entry.messaging_profile_id ? entry.messaging_profile_id : null;
  if (!profile) return { at: now, ok: false, message: 'Telnyx accepted the API key and has the number, but the number is not in a Messaging Profile. In Telnyx, assign the number to your Messaging Profile.' };
  if (telnyxMessagingProfileId && profile !== telnyxMessagingProfileId) {
    return { at: now, ok: false, message: 'Telnyx accepted the API key and has the number, but the number is in a different Messaging Profile from the profile id saved here. Save the id of the profile the number is in.' };
  }
  const status = typeof entry.status === 'string' ? ` Telnyx lists the number as ${entry.status}.` : '';
  return { at: now, ok: true, message: `Telnyx accepted the API key. The number is on the account and in a Messaging Profile.${status}` };
}

/** Reads the RCS agent's status from Telnyx (GET /v2/rcs/agents/{id}). Changes nothing. */
export async function checkRcs(deps: Deps, secrets: SiteSecrets, now: number): Promise<CheckResult> {
  const { telnyxApiKey, rcsAgentId } = secrets;
  if (!telnyxApiKey || !rcsAgentId) return { at: now, ok: false, message: 'Save the Telnyx API key and the RCS agent id first.', agentStatus: null };
  let res: Response;
  try {
    res = await deps.fetch(`${TELNYX}/rcs/agents/${encodeURIComponent(rcsAgentId)}`, { method: 'GET', headers: { authorization: `Bearer ${telnyxApiKey}`, accept: 'application/json' } });
  } catch {
    return { at: now, ok: false, message: 'Telnyx could not be reached. Try again in a minute.', agentStatus: null };
  }
  if (res.status === 401 || res.status === 403) return { at: now, ok: false, message: 'Telnyx refused the API key.', agentStatus: null };
  if (res.status === 404) return { at: now, ok: false, message: 'Telnyx has no RCS agent with the id saved here. Check the id.', agentStatus: null };
  if (!res.ok) return { at: now, ok: false, message: `Telnyx answered with an error (status ${res.status}). Try again later.`, agentStatus: null };
  const body = (await readJson(res)) as { data?: { status?: unknown } } | null;
  const status = typeof body?.data?.status === 'string' ? body.data.status.toUpperCase().replace(/[^A-Z_]/g, '').slice(0, 20) : null;
  if (!status) return { at: now, ok: false, message: 'Telnyx found the agent but did not say its status.', agentStatus: null };
  if (status === 'LIVE') return { at: now, ok: true, message: 'Telnyx says the agent is live: it can send to any phone that supports RCS.', agentStatus: status };
  const meaning: Record<string, string> = {
    CREATED: 'It is a draft that has not been submitted.',
    SUBMITTED: 'Telnyx has started submitting it.',
    VERIFYING: 'It is being verified.',
    VERIFIED: 'It was verified; the carrier launch comes next.',
    LAUNCHING: 'The carrier launch is in progress.',
    LAUNCHED: 'The launch is finishing.',
    REJECTED: 'It was rejected. See the reason in the Telnyx portal.',
    FAILED: 'Its processing stopped after a failure. See the Telnyx portal.',
  };
  return { at: now, ok: false, message: `Telnyx says the agent's status is ${status}. ${meaning[status] ?? ''} RCS is used only once the agent is live.`.trim(), agentStatus: status };
}

/**
 * Checks the Google client id and secret without signing anyone in: it
 * asks Google's token endpoint to exchange a code that does not exist.
 * Google answers "invalid_client" when the id or secret is wrong, and
 * "invalid_grant" when they are right (only the made-up code is refused).
 */
export async function checkGoogle(deps: Deps, secrets: SiteSecrets, redirectUri: string, now: number): Promise<CheckResult> {
  const { googleClientId, googleClientSecret } = secrets;
  if (!googleClientId || !googleClientSecret) return { at: now, ok: false, message: 'Save the client ID and the client secret first.' };
  let res: Response;
  try {
    res = await deps.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: 'betaharah-console-check', client_id: googleClientId, client_secret: googleClientSecret, redirect_uri: redirectUri }).toString(),
    });
  } catch {
    return { at: now, ok: false, message: 'Google could not be reached. Try again in a minute.' };
  }
  const body = (await readJson(res)) as { error?: unknown } | null;
  const error = typeof body?.error === 'string' ? body.error : '';
  if (error === 'invalid_client' || error === 'unauthorized_client') return { at: now, ok: false, message: 'Google did not accept the client ID and secret. Copy both again from the Google Cloud Console and save them.' };
  if (error === 'invalid_grant') return { at: now, ok: true, message: 'Google accepted the client ID and secret.' };
  if (error === 'redirect_uri_mismatch') return { at: now, ok: false, message: 'Google accepted the client but not the redirect address. Add the redirect address shown here to the OAuth client.' };
  return { at: now, ok: false, message: `Google gave an answer the console does not recognise${error ? ` (${error.replace(/[^a-z_]/g, '').slice(0, 40)})` : ''}. Try again later.` };
}
