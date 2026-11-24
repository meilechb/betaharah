/**
 * The operations that touch the database, the text-message provider and
 * Google: sending texts within the site's limits, sign-in codes, keeping
 * each household's reminders and calendar current, answering received
 * texts, and the periodic job.
 */
import { fingerprint, randomCode } from './crypto';
import type { Deps, Env } from './env';
import { GoogleCalendar, GoogleError, refreshAccessToken } from './google';
import { compute, runCommand, type Computed } from './household';
import { addMessage, lastFour, MAX_SEEN_TEXTS, smsReady, type HouseholdData, type Site, type SyncState } from './model';
import { allowText, rebuildQueue, refundText, settle, takeDue, type Settlement } from './queue';
import { sendTelnyx, type InboundMessage } from './sms';
import {
  bump,
  changeHousehold,
  clearWake,
  countAttempt,
  getCode,
  getPhone,
  householdsDue,
  householdsToWake,
  loadHousehold,
  loadSite,
  phoneHash,
  putCode,
  saveHealth,
  saveHousehold,
  setRefresh,
  spendCode,
  sweep,
  type Household,
} from './store';
import { applySync, planSync, toDesired, type SyncResult } from './sync';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

// ---------- the texts the site itself sends ----------

export const CODE_MINUTES = 10;

export function codeText(code: string): string {
  return `Betaharah code: ${code}. It expires in ${CODE_MINUTES} minutes. Do not share it.`;
}

/**
 * Sent when reminders are turned on, and when a phone texts START.
 * Wording filed for the toll-free verification.
 */
export const START_REPLY = "Betaharah: you're subscribed to reminder texts. Message frequency varies. Msg&data rates may apply. Reply ? for help, STOP to opt out.";
export const REMINDERS_ON_TEXT = START_REPLY;
/** Reply to HELP. Wording filed for the toll-free verification. */
export const HELP_REPLY = 'Betaharah: text ? for commands. Help: admin@betaharah.com. Reply STOP to opt out.';
export const TEST_TEXT = 'Betaharah: test message. Text 9 for status, ? for the list of commands.';

// ---------- sending a text ----------

export type SmsOutcome = { ok: true } | { ok: false; reason: 'not_set_up' | 'site_limit' | 'blocked' | 'failed'; detail: string };

const UPSERT_COUNTER = `INSERT INTO counters (key, value, expires_at) VALUES (?1, 1, ?2)
  ON CONFLICT (key) DO UPDATE SET
    value = CASE WHEN counters.expires_at <= ?3 THEN 1 ELSE counters.value + 1 END,
    expires_at = CASE WHEN counters.expires_at <= ?3 THEN ?2 ELSE counters.expires_at END
  RETURNING value`;

/**
 * Adds one to each counter in a single database call and returns the new
 * values. Each counter starts again from zero `ttlMs` after its first count.
 */
async function bumpMany(db: D1Database, counters: ReadonlyArray<readonly [key: string, ttlMs: number]>, now: number): Promise<number[]> {
  const results = await db.batch<{ value: number }>(counters.map(([key, ttlMs]) => db.prepare(UPSERT_COUNTER).bind(key, now + ttlMs, now)));
  return results.map(r => r.results[0]?.value ?? 0);
}

/** The counter of every text the site sent in the (UTC) month of `now`. */
export function textsThisMonthKey(now: number): string {
  return `sms:${new Date(now).toISOString().slice(0, 7)}`;
}

/** The counter of sign-in codes requested on the (UTC) day of `now`. */
export function codesTodayKey(now: number): string {
  return `codes:${new Date(now).toISOString().slice(0, 10)}`;
}

/**
 * Sends one text, counting it against the site's monthly limit. Nothing is
 * sent once the limit is reached, and only texts that were really sent are
 * counted. (A household's own monthly limit is kept in its encrypted data;
 * see queue.ts.)
 */
export async function sendSms(env: Env, deps: Deps, site: Site, args: { to: string; text: string; now: number }): Promise<SmsOutcome> {
  const { telnyxApiKey, telnyxNumber } = site.secrets;
  if (!smsReady(site) || !telnyxApiKey || !telnyxNumber) return { ok: false, reason: 'not_set_up', detail: 'Text messaging is not set up.' };
  const key = textsThisMonthKey(args.now);
  const count = await bump(env.DB, key, 40 * DAY, args.now);
  let refused: SmsOutcome;
  if (count > site.config.monthlyMessageLimit) {
    refused = { ok: false, reason: 'site_limit', detail: "This month's limit on text messages has been reached." };
  } else {
    const result = await sendTelnyx(deps, { apiKey: telnyxApiKey, from: telnyxNumber, to: args.to, text: args.text });
    if (result.ok) return { ok: true };
    refused = { ok: false, reason: result.blocked ? 'blocked' : 'failed', detail: result.error };
  }
  await env.DB.prepare('UPDATE counters SET value = MAX(value - 1, 0) WHERE key = ?').bind(key).run();
  return refused;
}

// ---------- sign-in codes ----------

const CODE_RESEND_SECONDS = 60;
const CODES_PER_PHONE_PER_DAY = 5;
const CODES_PER_ADDRESS_PER_HOUR = 8;
const CODE_GUESSES = 5;

export type CodeRequest =
  | { ok: true; delivery: Promise<SmsOutcome> }
  | { ok: false; reason: 'wait' | 'too_many' | 'unavailable' | 'busy'; message: string };

const codeHash = (env: Env, hash: string, code: string): Promise<string> => fingerprint(env.ENCRYPTION_KEY, 'code', `${hash}:${code}`);

/**
 * Texts a six-digit code to a number. Limits: one a minute and five a day
 * per number, eight an hour per network address, and a daily total for the
 * whole site, so that nobody can run up the text-message bill.
 *
 * With `send: false` everything happens except the sending: the limits
 * apply and the answer is the same. That is used for a number that may not
 * sign up, so that the answer does not reveal whether a number has an
 * account.
 *
 * The text itself is sent by the returned `delivery`, which the caller may
 * leave running after it has answered.
 */
export async function requestCode(
  env: Env,
  deps: Deps,
  site: Site,
  args: { number: string; purpose: 'login' | 'add'; householdId: string | null; address: string; send: boolean; now: number },
): Promise<CodeRequest> {
  const { now } = args;
  if (!smsReady(site)) return { ok: false, reason: 'unavailable', message: 'Sign-in by text message is not available yet.' };
  const hash = await phoneHash(env, args.number);
  const existing = await getCode(env.DB, hash);
  let windowStart = now;
  let windowCount = 0;
  if (existing) {
    if (now - existing.sent_at < CODE_RESEND_SECONDS * 1000) {
      return { ok: false, reason: 'wait', message: 'A code was just sent. Wait a minute before asking for another.' };
    }
    if (now - existing.window_start < DAY) {
      windowStart = existing.window_start;
      windowCount = existing.window_count;
    }
  }
  if (windowCount >= CODES_PER_PHONE_PER_DAY) {
    return { ok: false, reason: 'too_many', message: 'Too many codes were sent to this number today. Try again tomorrow, or sign in with your password.' };
  }
  const addressKey = `code-ip:${(await fingerprint(env.ENCRYPTION_KEY, 'ip', args.address)).slice(0, 24)}`;
  const [fromAddress, today] = await bumpMany(
    env.DB,
    [
      [addressKey, HOUR],
      [codesTodayKey(now), 2 * DAY],
    ],
    now,
  );
  if ((fromAddress ?? 0) > CODES_PER_ADDRESS_PER_HOUR) return { ok: false, reason: 'too_many', message: 'Too many codes were requested. Try again in an hour.' };
  if ((today ?? 0) > site.config.dailyCodeLimit) {
    return { ok: false, reason: 'busy', message: 'Sign-in by text message is paused for today. Try again tomorrow, or sign in with your password.' };
  }

  const code = randomCode();
  await putCode(env.DB, {
    phone_hash: hash,
    purpose: args.purpose,
    household_id: args.householdId,
    // With nothing sent, no code can match.
    code_hash: args.send ? await codeHash(env, hash, code) : '',
    expires_at: args.send ? now + CODE_MINUTES * MINUTE : 0,
    attempts: 0,
    sent_at: now,
    window_start: windowStart,
    window_count: windowCount + 1,
  });
  const delivery: Promise<SmsOutcome> = args.send ? sendSms(env, deps, site, { to: args.number, text: codeText(code), now }) : Promise.resolve({ ok: true });
  return { ok: true, delivery };
}

export type CodeCheck = { ok: true; householdId: string | null } | { ok: false; message: string };

/** Checks a code that was entered. A correct code can be used once. */
export async function checkCode(env: Env, args: { number: string; code: unknown; purpose: 'login' | 'add'; now: number }): Promise<CodeCheck> {
  const wrong = { ok: false as const, message: 'That code is not right, or it has expired.' };
  if (typeof args.code !== 'string' || !/^\d{6}$/.test(args.code.trim())) return wrong;
  const hash = await phoneHash(env, args.number);
  const row = await getCode(env.DB, hash);
  if (!row || row.purpose !== args.purpose || row.code_hash === '' || row.expires_at <= args.now) return wrong;
  if (row.attempts >= CODE_GUESSES) return { ok: false, message: 'Too many wrong codes. Ask for a new one.' };
  if ((await codeHash(env, hash, args.code.trim())) !== row.code_hash) {
    await countAttempt(env.DB, hash);
    return wrong;
  }
  if (!(await spendCode(env.DB, hash, row.code_hash))) return wrong;
  return { ok: true, householdId: row.household_id };
}

// ---------- the calendar ----------

/** Calendar operations per run, to stay within the platform's limit on outgoing requests. */
const MAX_SYNC_OPS = 35;

export type SyncOutcome =
  | { status: 'not_connected' }
  | { status: 'no_place' }
  | { status: 'ok'; result: SyncResult }
  | { status: 'error'; message: string };

/** Brings the household's Google calendar up to date. Returns the outcome and the sync state to store. */
export async function syncCalendar(deps: Deps, site: Site, data: HouseholdData, computed: Computed | null, now: number): Promise<{ outcome: SyncOutcome; sync: SyncState }> {
  const { googleClientId, googleClientSecret } = site.secrets;
  if (!data.google || !googleClientId || !googleClientSecret) return { outcome: { status: 'not_connected' }, sync: data.sync };
  if (!computed) return { outcome: { status: 'no_place' }, sync: data.sync };
  try {
    const token = await refreshAccessToken(deps, { clientId: googleClientId, clientSecret: googleClientSecret, refreshToken: data.google.refreshToken });
    const calendar = new GoogleCalendar(deps, token);
    const windowStart = now - data.app.calendar.historyDays * DAY;
    const tz = computed.place.timeZone;
    const desired = computed.events.map(e => toDesired(e, tz));
    const existing = await calendar.listManagedEvents(data.google.calendarId, windowStart);
    const result = await applySync(calendar, data.google.calendarId, planSync(desired, existing, windowStart), MAX_SYNC_OPS);
    return { outcome: { status: 'ok', result }, sync: { dirty: result.remaining > 0, lastRunAt: now, lastOkAt: now, lastError: null } };
  } catch (e) {
    let message = e instanceof Error ? e.message : 'unknown error';
    if (e instanceof GoogleError && e.code === 'invalid_grant') message = 'Google no longer accepts the saved sign-in. Connect Google Calendar again.';
    return { outcome: { status: 'error', message }, sync: { dirty: true, lastRunAt: now, lastOkAt: data.sync.lastOkAt, lastError: message } };
  }
}

/** The calendar and reminders are refreshed at least this often, so that plans that depend on today's date stay current. */
const REFRESH_MS = 6 * HOUR;

/**
 * After a household's data changed (or when its refresh is due): rebuild
 * its waiting reminders and bring its calendar up to date. `household` must
 * be the household as it was last saved.
 */
export async function refreshHousehold(env: Env, deps: Deps, site: Site, household: Household, computed: Computed | null, now: number): Promise<SyncOutcome> {
  rebuildQueue(household.data, computed ? computed.reminders : null, now);
  const { outcome, sync } = await syncCalendar(deps, site, household.data, computed, now);
  if (outcome.status === 'ok' || outcome.status === 'error') household.data.sync = sync;
  const again = outcome.status === 'ok' && outcome.result.remaining > 0;
  // If the household was changed while its calendar was being updated, the
  // save is refused; the change still has to reach the calendar and the
  // reminders, so the household is refreshed again at the next run.
  if (!(await saveHousehold(env, household, now, again ? now : now + REFRESH_MS))) await setRefresh(env.DB, household.id, now);
  return outcome;
}

/** Loads the household as it is now and refreshes it. */
export async function refreshById(env: Env, deps: Deps, site: Site, householdId: string, now: number): Promise<SyncOutcome | null> {
  const household = await loadHousehold(env, householdId);
  if (!household) return null;
  return refreshHousehold(env, deps, site, household, compute(household.data, now), now);
}

// ---------- received texts ----------

/** More messages than this from one number in an hour are ignored. */
const MAX_INBOUND_PER_HOUR = 30;

/**
 * The opt-out and opt-in words Telnyx itself acts on (its "Advanced
 * Opt-In/Out" documentation). Telnyx and the carrier block or unblock the
 * number and send their own confirmation; this app only notes the change.
 */
const STOP_WORDS = new Set(['STOP', 'STOPALL', 'STOP ALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPT OUT', 'OPTOUT', 'OPT-OUT']);
const START_WORDS = new Set(['START', 'UNSTOP']);
const HELP_WORDS = new Set(['HELP', 'INFO']);

type InboundKind = 'stop' | 'start' | 'help_answered' | 'help' | 'command';

export function inboundKind(message: Pick<InboundMessage, 'text' | 'autoresponseType'>): InboundKind {
  const word = message.text.trim().toUpperCase().replace(/\s+/g, ' ');
  if (message.autoresponseType === 'STOP' || STOP_WORDS.has(word)) return 'stop';
  if (message.autoresponseType === 'START' || START_WORDS.has(word)) return 'start';
  // Telnyx reports a help keyword it has already answered itself.
  if (message.autoresponseType === 'HELP') return 'help_answered';
  if (HELP_WORDS.has(word)) return 'help';
  return 'command';
}

/**
 * HELP and START are answered even from a number with no account, so a
 * carrier check of the toll-free number gets the filed wording. The number
 * itself is not stored. STOP is only recorded for a phone on an account;
 * the carrier sends the STOP confirmation.
 */
async function answerKeyword(
  env: Env,
  deps: Deps,
  site: Site,
  message: InboundMessage,
  row: { household_id: string } | null,
  kind: 'help' | 'help_answered' | 'start',
  now: number,
): Promise<{ household: Household; computed: Computed | null } | null> {
  const replyText = kind === 'start' ? START_REPLY : HELP_REPLY;
  let send = true;
  let refresh = false;
  if (row) {
    const changed = await changeHousehold(env, row.household_id, now, data => {
      const phone = data.phones.find(p => p.number === message.from);
      if (!phone) return { send: false, refresh: false };
      if (data.seenTexts.includes(message.eventId)) return { send: false, refresh: false };
      data.seenTexts.push(message.eventId);
      if (data.seenTexts.length > MAX_SEEN_TEXTS) data.seenTexts.splice(0, data.seenTexts.length - MAX_SEEN_TEXTS);
      addMessage(data, { direction: 'in', phone: lastFour(message.from), body: message.text, at: now, status: 'received' });
      const turnedBackOn = kind === 'start' && phone.optedOut;
      if (kind === 'start') phone.optedOut = false;
      const allowed = allowText(data, site.config.householdMonthlyLimit, now);
      addMessage(data, { direction: 'out', phone: lastFour(message.from), body: replyText, at: now, status: allowed ? 'sent' : 'not sent' });
      return { send: allowed, refresh: turnedBackOn };
    });
    if (!changed) return null;
    send = changed.result.send;
    refresh = changed.result.refresh;
  } else {
    const claimed = await env.DB.prepare('INSERT OR IGNORE INTO counters (key, value, expires_at) VALUES (?, 1, ?)').bind(`kw:${message.eventId.slice(0, 120)}`, now + DAY).run();
    if (claimed.meta.changes === 0) return null;
  }
  if (send) {
    const sent = await sendSms(env, deps, site, { to: message.from, text: replyText, now });
    if (!sent.ok && row) {
      await changeHousehold(env, row.household_id, now, data => {
        refundText(data, now);
        const m = data.messages.find(x => x.direction === 'out' && x.at === now && x.body === replyText.slice(0, 320));
        if (m) m.status = 'not sent';
        if (sent.reason === 'blocked') {
          const phone = data.phones.find(p => p.number === message.from);
          if (phone) phone.optedOut = true;
        }
      });
      refresh = false;
    }
  }
  if (!refresh || !row) return null;
  const household = await loadHousehold(env, row.household_id);
  if (!household) return null;
  return { household, computed: compute(household.data, now) };
}

export async function handleInbound(env: Env, deps: Deps, site: Site, message: InboundMessage): Promise<{ household: Household; computed: Computed | null } | null> {
  const now = deps.now();
  const kind = inboundKind(message);
  const hash = await phoneHash(env, message.from);
  if ((await bump(env.DB, `in:${hash.slice(0, 24)}`, HOUR, now)) > MAX_INBOUND_PER_HOUR) return null;
  const row = await getPhone(env.DB, hash);
  if (kind === 'help' || kind === 'help_answered' || kind === 'start') return answerKeyword(env, deps, site, message, row, kind, now);
  if (!row) return null;

  const changed = await changeHousehold(env, row.household_id, now, data => {
    const none = { reply: null as string | null, refresh: false, computed: undefined as Computed | null | undefined };
    const phone = data.phones.find(p => p.number === message.from);
    if (!phone) return none;
    if (data.seenTexts.includes(message.eventId)) return none; // a repeated delivery
    data.seenTexts.push(message.eventId);
    if (data.seenTexts.length > MAX_SEEN_TEXTS) data.seenTexts.splice(0, data.seenTexts.length - MAX_SEEN_TEXTS);
    addMessage(data, { direction: 'in', phone: lastFour(message.from), body: message.text, at: now, status: 'received' });

    let text: string | null = null;
    let refresh = false;
    let computed: Computed | null | undefined;
    if (kind === 'stop') {
      refresh = !phone.optedOut;
      phone.optedOut = true;
    } else if (kind === 'command' && phone.verifiedAt !== null && phone.canUpdate && !phone.optedOut) {
      const result = runCommand(data, message.text, now);
      text = result.text;
      refresh = result.changed;
      computed = result.computed;
    }
    let reply: string | null = null;
    if (text !== null) {
      // The reply counts against the household's monthly limit; past it, nothing is sent.
      const allowed = allowText(data, site.config.householdMonthlyLimit, now);
      addMessage(data, { direction: 'out', phone: lastFour(message.from), body: text, at: now, status: allowed ? 'sent' : 'not sent' });
      if (allowed) reply = text;
    }
    return { reply, refresh, computed };
  });
  if (!changed) return null;
  const { reply, refresh, computed } = changed.result;
  let household = changed.household;

  if (reply !== null) {
    const sent = await sendSms(env, deps, site, { to: message.from, text: reply, now });
    if (!sent.ok) {
      const noted = await changeHousehold(env, row.household_id, now, data => {
        refundText(data, now);
        const m = data.messages.find(x => x.direction === 'out' && x.at === now && x.body === reply.slice(0, 320));
        if (m) m.status = 'not sent';
        if (sent.reason === 'blocked') {
          const phone = data.phones.find(p => p.number === message.from);
          if (phone) phone.optedOut = true;
        }
      });
      if (noted) household = noted.household;
    }
  }
  if (!refresh) return null;
  return { household, computed: computed === undefined ? compute(household.data, now) : computed };
}

// ---------- the periodic job ----------

/** Reminders sent in one run, and households opened to send them, to stay within the platform's per-run limits. */
const REMINDERS_PER_RUN = 8;
const HOUSEHOLDS_PER_RUN = 5;

/**
 * Sends the reminders that are due. For each household with something due:
 * its due reminders are first marked as being sent and saved, so that two
 * runs at once cannot both send them; then they are sent; then the result
 * is recorded.
 */
export async function sendDueReminders(env: Env, deps: Deps, site: Site, now: number): Promise<number> {
  if (!smsReady(site)) return 0;
  let sent = 0;
  let budget = REMINDERS_PER_RUN;
  for (const id of await householdsToWake(env.DB, now, HOUSEHOLDS_PER_RUN)) {
    if (budget <= 0) break;
    try {
      const taken = await changeHousehold(env, id, now, data => takeDue(data, now, budget, site.config.householdMonthlyLimit));
      if (!taken || taken.result.length === 0) continue;
      budget -= taken.result.length;
      const results: Array<{ key: string; to: string; result: Settlement }> = [];
      for (const q of taken.result) {
        const outcome = await sendSms(env, deps, site, { to: q.to, text: q.text, now });
        if (outcome.ok) sent++;
        results.push({ key: q.key, to: q.to, result: outcome.ok ? 'sent' : outcome.reason === 'failed' ? 'failed' : outcome.reason === 'blocked' ? 'blocked' : 'refused' });
      }
      const blocked = results.some(r => r.result === 'blocked');
      await changeHousehold(
        env,
        id,
        now,
        data => {
          for (const r of results) settle(data, r, r.result, now);
        },
        // A phone that opted out: refresh soon, so that nothing more waits for it.
        blocked ? now : undefined,
      );
    } catch (e) {
      // One household whose data cannot be read must not hold up the others.
      await clearWake(env.DB, id);
      console.error('reminders failed', e instanceof Error ? e.name : 'error');
    }
  }
  return sent;
}

/**
 * Runs every minute: sends the reminders that are due, then refreshes the
 * one household whose refresh is most overdue.
 */
export async function tick(env: Env, deps: Deps): Promise<void> {
  const now = deps.now();
  const site = await loadSite(env);
  await sendDueReminders(env, deps, site, now);
  for (const id of await householdsDue(env.DB, now, 1)) {
    try {
      await refreshById(env, deps, site, id, now);
    } catch (e) {
      // One household that cannot be refreshed must not hold up the others.
      await setRefresh(env.DB, id, now + REFRESH_MS);
      console.error('refresh failed', e instanceof Error ? e.name : 'error');
    }
  }
  if (Math.floor(now / MINUTE) % 180 === 0) await sweep(env.DB, now);
  await saveHealth(env.DB, { lastTickAt: now, lastTickError: null }, now);
}
