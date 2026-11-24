/**
 * The operations that touch the database, the text-message provider and
 * Google: sending texts within the site's limits, sign-in codes, keeping
 * each household's reminders and calendar current, answering received
 * texts, and the periodic job.
 */
import { hiddenKey } from '../engine/calendar';
import { filedText, messageOut, NO_TEXTS, serverText, type ChatState, type OutMessage, type SiteTexts } from './chat';
import { fingerprint, randomCode } from './crypto';
import { DEMO_NUMBER } from './demo';
import { noteSmsOutcome } from './admin-notes';
import type { Deps, Env } from './env';
import { GoogleCalendar, GoogleError, refreshAccessToken } from './google';
import { compute, publishedEvents, type Computed } from './household';
import { addMessage, lastFour, rcsReady, smsReady, type HouseholdData, type Site, type SyncState } from './model';
import { postponeDue, rebuildQueue, settle, takeDue, type Settlement } from './queue';
import { sendTelnyx, sendTelnyxRcs, type InboundMessage, type RcsSuggestion } from './sms';
import {
  bump,
  changeHousehold,
  clearWake,
  countAttempt,
  getCode,
  getPhone,
  householdsDue,
  householdsToWake,
  isDueToWake,
  loadHousehold,
  loadSite,
  phoneHash,
  putCode,
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

/** The sign-in code text (filed with the carrier; the operator may change it on the Texts page). */
export function codeText(code: string, texts?: SiteTexts): string {
  return filedText(texts ?? NO_TEXTS, 'carrier.code', { code, minutes: String(CODE_MINUTES) });
}

/**
 * Sent when reminders are turned on on the website, and when a phone texts
 * START. Wording filed for the toll-free verification.
 */
export function startReply(texts?: SiteTexts): string {
  return filedText(texts ?? NO_TEXTS, 'carrier.start');
}
/** Reply to HELP. Wording filed for the toll-free verification. */
export function helpReply(texts?: SiteTexts): string {
  return filedText(texts ?? NO_TEXTS, 'carrier.help');
}
/** The filed wording, as shipped. */
export const START_REPLY = startReply();
export const HELP_REPLY = helpReply();

/** The test text, with its options. */
export function testText(texts?: SiteTexts): OutMessage {
  return serverText(texts, 'other.test');
}
/** The same texts in their shipped wording. */
export const REMINDERS_ON_TEXT = START_REPLY;
export const TEST_TEXT = testText().text;

// ---------- sending a text ----------

/** How a text went out: by RCS, or by SMS (also an RCS send that Telnyx delivered as its SMS fallback); null when Telnyx did not say. */
export type Channel = 'rcs' | 'sms' | null;

export type SmsOutcome = { ok: true; channel: Channel } | { ok: false; reason: 'not_set_up' | 'site_limit' | 'blocked' | 'failed'; detail: string };

const UPSERT_COUNTER = `INSERT INTO counters (key, value, expires_at) VALUES (?1, 1, ?2)
  ON CONFLICT (key) DO UPDATE SET
    value = CASE WHEN counters.expires_at <= ?3 THEN 1 ELSE counters.value + 1 END,
    expires_at = CASE WHEN counters.expires_at <= ?3 THEN ?2 ELSE counters.expires_at END
  RETURNING value`;

/** The counter of every text the site sent in the (UTC) month of `now`. */
export function textsThisMonthKey(now: number): string {
  return `sms:${new Date(now).toISOString().slice(0, 7)}`;
}

/** The counter of sign-in codes requested on the (UTC) day of `now`. */
export function codesTodayKey(now: number): string {
  return `codes:${new Date(now).toISOString().slice(0, 10)}`;
}

/** One text to send: the words, and for RCS the tap-to-reply buttons (an SMS phone gets the words alone, which are complete). */
export interface TextToSend {
  to: string;
  text: string;
  now: number;
  suggestions?: RcsSuggestion[];
  /** By RCS: the text above the buttons (the body without the options line). `text` stays the SMS fallback. */
  rcsText?: string;
  /** Send as a plain SMS even when RCS is on (sign-in codes and sign-in links: the plainest way). */
  smsOnly?: boolean;
}

/** A text of the conversation as the send function takes it. */
export function toSend(m: OutMessage): Pick<TextToSend, 'text' | 'rcsText' | 'suggestions'> {
  return m.suggestions ? { text: m.text, rcsText: m.body, suggestions: m.suggestions } : { text: m.text };
}

/**
 * The one way the site sends a text, whatever it is (a reply, a sign-in
 * code, a reminder, a confirmation). It counts against the site's monthly
 * limit: nothing is sent once the limit is reached, and only texts that
 * were really sent are counted. (A household's own monthly limit is kept in
 * its encrypted data; see queue.ts.)
 *
 * When RCS is ready (model.rcsReady) the text goes through the RCS agent,
 * with its suggestions as suggested replies and always with an SMS fallback
 * of the same text from the site's number, so that a phone without RCS
 * receives an ordinary text. Otherwise, and for `smsOnly`, it is an SMS.
 * One text counts once either way.
 */
export async function sendText(env: Env, deps: Deps, site: Site, args: TextToSend): Promise<SmsOutcome> {
  const { telnyxApiKey, telnyxNumber, rcsAgentId, telnyxMessagingProfileId } = site.secrets;
  if (!smsReady(site) || !telnyxApiKey || !telnyxNumber) return { ok: false, reason: 'not_set_up', detail: 'Text messaging is not set up.' };
  const key = textsThisMonthKey(args.now);
  const count = await bump(env.DB, key, 40 * DAY, args.now);
  let refused: SmsOutcome;
  if (count > site.config.monthlyMessageLimit) {
    refused = { ok: false, reason: 'site_limit', detail: "This month's limit on text messages has been reached." };
  } else {
    const result =
      !args.smsOnly && rcsReady(site) && rcsAgentId && telnyxMessagingProfileId
        ? await sendTelnyxRcs(deps, {
            apiKey: telnyxApiKey,
            agentId: rcsAgentId,
            messagingProfileId: telnyxMessagingProfileId,
            from: telnyxNumber,
            to: args.to,
            text: args.text,
            rcsText: args.rcsText,
            suggestions: args.suggestions,
          })
        : await sendTelnyx(deps, { apiKey: telnyxApiKey, from: telnyxNumber, to: args.to, text: args.text });
    if (result.ok) {
      await noteSmsOutcome(env.DB, { ok: true }, args.now); // for the operator's console: when a text last went out
      return { ok: true, channel: result.channel };
    }
    refused = { ok: false, reason: result.blocked ? 'blocked' : 'failed', detail: result.error };
  }
  await env.DB.prepare('UPDATE counters SET value = MAX(value - 1, 0) WHERE key = ?').bind(key).run();
  await noteSmsOutcome(env.DB, refused, args.now);
  return refused;
}

/** The same function under its earlier name. */
export const sendSms = sendText;

/** What became of a text for a household: sent, simulated (the test account), or not sent. */
export type HouseholdSmsOutcome = { ok: true; simulated: boolean; channel: Channel } | Extract<SmsOutcome, { ok: false }>;

/**
 * Sends one text to a phone of a household. For the test account nothing
 * is sent and no counter of the site is touched; the text counts as
 * delivered and is recorded as simulated.
 */
export async function sendHouseholdText(env: Env, deps: Deps, site: Site, demo: boolean, args: TextToSend): Promise<HouseholdSmsOutcome> {
  if (demo) return { ok: true, simulated: true, channel: null };
  const outcome = await sendText(env, deps, site, args);
  return outcome.ok ? { ok: true, simulated: false, channel: outcome.channel } : outcome;
}

/** The status a sent text is recorded with in the household's messages. */
export function messageStatus(outcome: HouseholdSmsOutcome): 'sent' | 'simulated' | 'not sent' {
  return outcome.ok ? (outcome.simulated ? 'simulated' : 'sent') : 'not sent';
}

// ---------- sign-in codes ----------

export const CODE_RESEND_SECONDS = 60;
const CODES_PER_PHONE_PER_DAY = 5;
const CODES_PER_ADDRESS_PER_HOUR = 8;
const CODE_GUESSES = 5;

export type CodeRequest =
  | { ok: true; delivery: Promise<SmsOutcome>; /** Only for a simulated code (the test account). */ code?: string }
  | { ok: false; reason: 'wait' | 'too_many' | 'unavailable' | 'busy'; message: string };

const codeHash = (env: Env, hash: string, code: string): Promise<string> => fingerprint(env.ENCRYPTION_KEY, 'code', `${hash}:${code}`);

/**
 * Texts a six-digit code to a number. Limits: one a minute and five a day
 * per number, eight an hour per network address, and a daily total for the
 * whole site, so that nobody can run up the text-message bill.
 *
 * With `send: false` everything happens except the sending: the limits per
 * number and per address apply and the answer is the same. That is used for
 * a number that may not sign up, so that the answer does not reveal whether
 * a number has an account. Such a request does not count toward the site's
 * daily total (only codes that are sent do, so that strangers cannot pause
 * sign-in for everyone), but once the total is reached it gets the same
 * "paused" answer as everyone else.
 *
 * The text itself is sent by the returned `delivery`, which the caller may
 * leave running after it has answered.
 *
 * With `simulate: true` (a phone added to the test account) nothing is
 * sent and the site's counters are not touched; the code is returned so
 * that the page can show it. The limits per number still apply.
 */
export async function requestCode(
  env: Env,
  deps: Deps,
  site: Site,
  args: { number: string; purpose: 'login' | 'add'; householdId: string | null; address: string; send: boolean; now: number; simulate?: boolean },
): Promise<CodeRequest> {
  const { now } = args;
  const simulate = args.simulate === true;
  if (!simulate && !smsReady(site)) return { ok: false, reason: 'unavailable', message: 'Sign-in by text message is not available yet.' };
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
  if (!simulate) {
    const addressKey = `code-ip:${(await fingerprint(env.ENCRYPTION_KEY, 'ip', args.address)).slice(0, 24)}`;
    const todayKey = codesTodayKey(now);
    // One database call: count the request against the address, and either
    // count it in the day's total (a code that is sent) or only read that
    // total (nothing is sent). Either way the value is the total including
    // this request if it were counted, so both are judged alike.
    const [fromAddress, todayRow] = await env.DB.batch<{ value: number }>([
      env.DB.prepare(UPSERT_COUNTER).bind(addressKey, now + HOUR, now),
      args.send
        ? env.DB.prepare(UPSERT_COUNTER).bind(todayKey, now + 2 * DAY, now)
        : env.DB.prepare('SELECT value + 1 AS value FROM counters WHERE key = ? AND expires_at > ?').bind(todayKey, now),
    ]);
    const today = todayRow?.results[0]?.value ?? 1;
    if ((fromAddress?.results[0]?.value ?? 0) > CODES_PER_ADDRESS_PER_HOUR) return { ok: false, reason: 'too_many', message: 'Too many codes were requested. Try again in an hour.' };
    if (today > site.config.dailyCodeLimit) {
      return { ok: false, reason: 'busy', message: 'Sign-in by text message is paused for today. Try again tomorrow, or sign in with your password.' };
    }
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
  if (simulate) return { ok: true, delivery: Promise.resolve({ ok: true, channel: null }), code: args.send ? code : undefined };
  // Codes always go as a plain SMS, the plainest way.
  const delivery: Promise<SmsOutcome> = args.send ? sendText(env, deps, site, { to: args.number, text: codeText(code, site.texts), now, smsOnly: true }) : Promise.resolve({ ok: true, channel: null });
  return { ok: true, delivery };
}

export type CodeCheck = { ok: true; householdId: string | null } | { ok: false; message: string };

/**
 * Checks a code that was entered. A correct code can be used once.
 *
 * A code for adding a phone belongs to the household that asked for it:
 * `householdId` is the household of the session entering it. From any other
 * household even the correct code is refused, and it is not used up, so
 * that the household that asked for it can still enter it. A wrong code
 * counts as a guess whoever enters it.
 */
export async function checkCode(
  env: Env,
  args: { number: string; code: unknown; purpose: 'login' | 'add'; householdId?: string | null; now: number },
): Promise<CodeCheck> {
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
  if (args.purpose === 'add' && row.household_id !== (args.householdId ?? null)) return wrong;
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
    const show = data.app.calendar.show;
    const desired = publishedEvents(data, computed).map(e => toDesired(e, tz));
    const existing = await calendar.listManagedEvents(data.google.calendarId, windowStart);
    const ops = planSync(desired, existing, windowStart, key => hiddenKey(key, show));
    const result = await applySync(calendar, data.google.calendarId, ops, MAX_SYNC_OPS);
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

/** More messages than this from one number in an hour are ignored (by SMS and RCS together, with or without an account). */
export const MAX_INBOUND_PER_HOUR = 30;

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

/** Counts one received text from a phone; false once it sent too many this hour. */
export async function allowInbound(env: Env, phoneHashValue: string, now: number): Promise<boolean> {
  return (await bump(env.DB, `in:${phoneHashValue.slice(0, 24)}`, HOUR, now)) <= MAX_INBOUND_PER_HOUR;
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
 *
 * While texting is not ready, an ordinary household's due reminders are
 * put off a few minutes at a time until their time is over, and then
 * dropped (see postponeDue); the test account's are simulated as always.
 */
export async function sendDueReminders(env: Env, deps: Deps, site: Site, now: number): Promise<number> {
  const ready = smsReady(site);
  let ids = await householdsToWake(env.DB, now, HOUSEHOLDS_PER_RUN);
  if (!ready) {
    // While texting is not set up, the test account's reminders, which are
    // simulated, are still sent; it goes first so that other accounts' due
    // reminders cannot hold it up. Those are only put off (see postponeDue).
    const row = await getPhone(env.DB, await phoneHash(env, DEMO_NUMBER));
    if (row && !ids.includes(row.household_id) && (await isDueToWake(env.DB, row.household_id, now))) ids = [row.household_id, ...ids];
  }
  let sent = 0;
  let budget = REMINDERS_PER_RUN;
  for (const id of ids) {
    if (budget <= 0) break;
    try {
      const taken = await changeHousehold(env, id, now, data => {
        if (!ready && !data.demo) {
          postponeDue(data, now);
          return { demo: false, due: [] };
        }
        return { demo: data.demo, due: takeDue(data, now, budget, site.config.householdMonthlyLimit) };
      });
      if (!taken || taken.result.due.length === 0) continue;
      const { demo, due } = taken.result;
      budget -= due.length;
      const results: Array<{ key: string; to: string; text: string; chat: ChatState | null; result: Settlement }> = [];
      for (const q of due) {
        // In the operator's wording, with its options (DONE on the hefsek reminder, STATUS on the others).
        const made = q.msg ? messageOut(site.texts ?? NO_TEXTS, q.msg, now) : { out: { text: q.text, body: q.text }, chat: null };
        const outcome = await sendHouseholdText(env, deps, site, demo, { to: q.to, ...toSend(made.out), now });
        if (outcome.ok) sent++;
        results.push({
          key: q.key,
          to: q.to,
          text: made.out.text,
          chat: made.chat,
          result: outcome.ok ? 'sent' : outcome.reason === 'failed' ? 'failed' : outcome.reason === 'blocked' ? 'blocked' : 'refused',
        });
      }
      const blocked = results.some(r => r.result === 'blocked');
      await changeHousehold(
        env,
        id,
        now,
        data => {
          for (const r of results) {
            settle(data, r, r.result, now);
            // A reminder that went out is the last message to that phone: its options are the ones a reply answers.
            if (r.result === 'sent' && r.chat) data.chat = { ...(data.chat ?? {}), [r.to]: r.chat };
            // The test account's reminders appear in its messages, as they would arrive on a phone.
            if (demo) addMessage(data, { direction: 'out', phone: lastFour(r.to), body: r.text, at: now, status: 'simulated' });
          }
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
}
