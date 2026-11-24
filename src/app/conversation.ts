/**
 * Received texts, by SMS or RCS: the one path every received text takes,
 * from the webhook, from the test account's "send a text" box, and from
 * the operator's simulator.
 *
 *   1. A number reserved for fiction (555-0100 to 555-0199) is never
 *      answered, except through the simulator.
 *   2. More than 30 texts an hour from one number are ignored.
 *   3. The carrier words (STOP, START, HELP and the others) are handled
 *      first, exactly as before (see service.ts).
 *   4. A phone on an account: the conversation engine (src/app/chat) reads
 *      the text, with the phone's own pending question, and its answers,
 *      changes and effects are carried out here.
 *   5. A number with no account: the engine's greet() decides, within the
 *      site's sign-up rules and the caps below. JOIN creates an account;
 *      JOIN and a code from ADD adds the phone to the household that made
 *      the code.
 *
 * Every text goes back to the number that sent the text being answered;
 * nothing is ever sent to a number that has not texted in.
 *
 * Which household is touched comes only from the verified sender (the
 * phone's fingerprint in the phones table), from a code that the household
 * itself made, or, for the test account's box, from the signed session.
 * Never from the words of a text. Nothing here logs a text, a number, a
 * code or a token.
 */
import { addPhone, createAccount, deleteAccount, prefixAllowed, removePhone } from './accounts';
import { begin, converse, greet, joinWord, LINK_MARK, serverText, type ChatState, type Effect, type OutMessage } from './chat';
import { randomToken } from './crypto';
import { DEMO_NUMBER, isFictionalNumber } from './demo';
import type { Deps, Env } from './env';
import { compute, type Computed } from './household';
import { addMessage, lastFour, MAX_PHONES, MAX_SEEN_TEXTS, smsReady, type HouseholdData, type Site } from './model';
import { allowText, refundText } from './queue';
import { allowInbound, helpReply, inboundKind, refreshHousehold, sendHouseholdText, startReply, type HouseholdSmsOutcome } from './service';
import { ValidationError } from './settings';
import type { InboundMessage } from './sms';
import {
  bump,
  changeHousehold,
  findJoinCode,
  findSignupInvite,
  getPhone,
  loadHousehold,
  phoneHash,
  putJoinCode,
  putLinkToken,
  spendJoinCode,
  useInvite,
  type Household,
} from './store';
import { lookupPostal, nearestPostal } from './zip';

const DAY = 86_400_000;

// ---------- caps for numbers without an account ----------

/**
 * Each reply to a number without an account costs the owner about a cent,
 * and a reply invites more texts. So:
 */
/** At most this many replies to one number without an account in 24 hours (counted by a keyed fingerprint of the number). */
export const STRANGER_REPLIES_PER_NUMBER = 1;
/** At most this many replies to numbers without an account in one (UTC) day, for the whole site. */
export const STRANGER_REPLIES_PER_DAY = 50;
/** At most this many accounts created by texting JOIN in one (UTC) day, for the whole site. */
export const TEXT_SIGNUPS_PER_DAY = 25;

/**
 * HELP and START from a number without an account are answered with the
 * wording filed for the toll-free verification (a carrier's check of the
 * number texts these). They have their own caps, so that the one reply a
 * day above does not swallow them: this many to one number in 24 hours,
 */
export const KEYWORD_REPLIES_PER_NUMBER = 4;
/** and this many in one (UTC) day for the whole site. */
export const KEYWORD_REPLIES_PER_DAY = 100;
export const keywordKey = (hash: string): string => `kwn:${hash.slice(0, 24)}`;
export const keywordDayKey = (now: number): string => `kw-day:${new Date(now).toISOString().slice(0, 10)}`;

/** The counter of replies to one number without an account (keyed by its fingerprint; nothing readable). */
export const strangerKey = (hash: string): string => `st:${hash.slice(0, 24)}`;
/** The counter of replies to numbers without an account on the (UTC) day of `now`. */
export const strangerDayKey = (now: number): string => `st-day:${new Date(now).toISOString().slice(0, 10)}`;
/** The counter of accounts created by text on the (UTC) day of `now`. */
export const textSignupsKey = (now: number): string => `signup-text:${new Date(now).toISOString().slice(0, 10)}`;

/** The site's address for links in texts, when the request does not give one. */
const DEFAULT_ORIGIN = 'https://betaharah.com';


// ---------- what is sent ----------

/** One text that was sent, or would have been (test account, simulator). */
export interface SentText {
  text: string;
  suggestions?: OutMessage['suggestions'];
}

const sentOf = (t: { text: string; suggestions?: OutMessage['suggestions'] }): SentText => (t.suggestions ? { text: t.text, suggestions: t.suggestions } : { text: t.text });

/** A text planned in answer: what to send, and what is recorded in the household's messages. */
interface Planned {
  text: string;
  /** By RCS: the body above the buttons. */
  rcsText?: string;
  suggestions?: OutMessage['suggestions'];
  /** Recorded in place of the text (a sign-in link is not kept). */
  record: string;
  /** A sign-in link: sent as a plain SMS. */
  link?: boolean;
  /** Counted against the household's monthly limit. */
  allowed: boolean;
}

interface Run {
  env: Env;
  deps: Deps;
  site: Site;
  now: number;
  origin: string;
  /** The simulator: nothing is sent, no site counter moves, and only test accounts are touched. */
  simulate: boolean;
}

/** Sends the texts in order to `to` (or only collects them, when simulated). Stops at a phone that opted out. */
async function deliver(run: Run, to: string, texts: Planned[], simulated: boolean): Promise<HouseholdSmsOutcome[]> {
  const outcomes: HouseholdSmsOutcome[] = [];
  for (const t of texts) {
    if (!t.allowed) {
      outcomes.push({ ok: false, reason: 'site_limit', detail: 'monthly limit' });
      continue;
    }
    const outcome = await sendHouseholdText(run.env, run.deps, run.site, simulated, { to, text: t.text, rcsText: t.rcsText, suggestions: t.suggestions, now: run.now, smsOnly: t.link === true });
    outcomes.push(outcome);
    if (!outcome.ok && outcome.reason === 'blocked') {
      for (let i = outcomes.length; i < texts.length; i++) outcomes.push({ ok: false, reason: 'blocked', detail: 'opted out' });
      break;
    }
  }
  return outcomes;
}

function setChat(data: HouseholdData, number: string, chat: ChatState | null): void {
  const all = { ...(data.chat ?? {}) };
  if (chat) all[number] = chat;
  else delete all[number];
  data.chat = Object.keys(all).length > 0 ? all : null;
}

/** Counts each planned text against the household's monthly limit and records it in its messages. */
function plan(data: HouseholdData, site: Site, to: string, texts: Array<Omit<Planned, 'allowed'>>, simulated: boolean, now: number): Planned[] {
  return texts.map(t => {
    const allowed = allowText(data, site.config.householdMonthlyLimit, now);
    addMessage(data, { direction: 'out', phone: lastFour(to), body: t.record, at: now, status: allowed ? (simulated ? 'simulated' : 'sent') : 'not sent' });
    return { ...t, allowed };
  });
}

const fromEngine = (m: OutMessage): Omit<Planned, 'allowed'> => (m.suggestions ? { text: m.text, rcsText: m.body, suggestions: m.suggestions, record: m.text } : { text: m.text, record: m.text });

/** How a received text is recorded in the household's messages. */
function inboundBody(message: Pick<InboundMessage, 'text'> & { location?: InboundMessage['location'] }): string {
  if (message.text !== '') return message.text;
  return message.location ? '(shared a location)' : '(no text)';
}

/**
 * After the texts were sent: records what really happened where it differs
 * from what was recorded beforehand (a text not sent, a text replaced by
 * the effect's "could not" text), and notes a phone the carrier says opted
 * out. Returns the household as saved, or null if nothing needed saving.
 */
async function settleTexts(
  run: Run,
  householdId: string,
  to: string,
  planned: Planned[],
  final: Planned[],
  outcomes: HouseholdSmsOutcome[],
  /** The planned texts were replaced by an effect's "could not" text. */
  replaced = false,
): Promise<Household | null> {
  const failed = outcomes.some(o => !o.ok);
  if (!replaced && !failed) return null;
  const blocked = outcomes.some(o => !o.ok && o.reason === 'blocked');
  const noted = await changeHousehold(run.env, householdId, run.now, data => {
    const findOut = (body: string) => data.messages.find(m => m.direction === 'out' && m.at === run.now && m.body === body.slice(0, 320));
    if (replaced) {
      // The planned texts were not sent: take them back, and count the one that replaced them.
      for (const p of planned) {
        const m = findOut(p.record);
        if (m) data.messages.splice(data.messages.indexOf(m), 1);
        if (p.allowed) refundText(data, run.now);
      }
      for (let i = 0; i < final.length; i++) {
        const f = final[i] as Planned;
        const ok = outcomes[i]?.ok === true;
        if (ok) allowText(data, run.site.config.householdMonthlyLimit, run.now);
        addMessage(data, { direction: 'out', phone: lastFour(to), body: f.record, at: run.now, status: ok ? (data.demo ? 'simulated' : 'sent') : 'not sent' });
      }
    } else {
      for (let i = 0; i < final.length; i++) {
        const o = outcomes[i];
        const f = final[i] as Planned;
        if (!o || o.ok || !f.allowed) continue;
        refundText(data, run.now);
        const m = findOut(f.record);
        if (m) m.status = 'not sent';
      }
    }
    if (blocked) {
      const phone = data.phones.find(p => p.number === to);
      if (phone) phone.optedOut = true;
    }
  });
  return noted?.household ?? null;
}

// ---------- a phone on an account ----------

export interface Received {
  /** The household as saved; null when the account was deleted by this text. */
  household: Household | null;
  /** The first text that was sent (or simulated), or null if nothing was sent. */
  reply: string | null;
  /** Every text that was sent (or simulated), in order. */
  replies: SentText[];
  /** True when the household's reminders and calendar should now be refreshed. */
  refresh: boolean;
  /**
   * The household's current picture: always when `refresh` is true, and
   * otherwise when the reply needed it; else null (not worked out).
   */
  computed: Computed | null;
  /** The account was deleted by this text (DELETE ACCOUNT, YES). */
  deleted: boolean;
}

type ReceivedMessage = Pick<InboundMessage, 'eventId' | 'from' | 'text' | 'autoresponseType'> & { location?: InboundMessage['location'] };

/**
 * The handling of one received text from a phone on a household, shared by
 * the webhook, the test account's "send a text" box and the simulator:
 * STOP, START, HELP, the conversation, the effects, the replies, and the
 * record in the household's messages. For the test account nothing is sent;
 * the messages are recorded as simulated.
 *
 * A phone that has not proved its number (an account the operator made
 * for a number, before its first code) or that opted out gets no answer,
 * as before. A phone that may not record entries can still use every word
 * that does not record.
 *
 * At most one picture is worked out (compute) per text: the engine passes
 * on the one it made.
 *
 * Returns null when the phone is not on the household or the text was
 * already handled.
 */
export async function receiveText(
  env: Env,
  deps: Deps,
  site: Site,
  householdId: string,
  message: ReceivedMessage,
  now: number,
  options: { origin?: string; simulate?: boolean } = {},
): Promise<Received | null> {
  const run: Run = { env, deps, site, now, origin: (options.origin ?? DEFAULT_ORIGIN).replace(/\/+$/, ''), simulate: options.simulate === true };
  const kind = inboundKind(message);
  const from = message.from;
  const changed = await changeHousehold(env, householdId, now, data => {
    const none = { handled: false as const };
    const phone = data.phones.find(p => p.number === from);
    if (!phone) return none;
    // The simulator only ever touches a test account.
    if (run.simulate && !data.demo) return none;
    if (data.seenTexts.includes(message.eventId)) return none; // a repeated delivery
    data.seenTexts.push(message.eventId);
    if (data.seenTexts.length > MAX_SEEN_TEXTS) data.seenTexts.splice(0, data.seenTexts.length - MAX_SEEN_TEXTS);
    const simulated = data.demo;
    addMessage(data, { direction: 'in', phone: lastFour(from), body: inboundBody(message), at: now, status: simulated ? 'simulated' : 'received' });

    let texts: Array<Omit<Planned, 'allowed'>> = [];
    let effects: Effect[] = [];
    let refresh = false;
    let computed: Computed | undefined;
    if (kind === 'stop') {
      refresh = !phone.optedOut;
      phone.optedOut = true;
    } else if (kind === 'start') {
      refresh = phone.optedOut;
      phone.optedOut = false;
      // The wording filed for the toll-free verification, in addition to the carrier's own confirmation.
      const start = startReply(site.texts);
      texts = [{ text: start, record: start }];
    } else if (kind === 'help' || kind === 'help_answered') {
      // Sent also when Telnyx marks the keyword as already answered: the filed wording is this one.
      const help = helpReply(site.texts);
      texts = [{ text: help, record: help }];
    } else if (kind === 'command' && phone.verifiedAt !== null && !phone.optedOut) {
      const out = converse({
        data,
        chat: data.chat?.[from] ?? null,
        from,
        text: message.text,
        location: message.location ?? undefined,
        now,
        limits: { maxPhones: MAX_PHONES },
        lookupPostal,
        nearestPostal,
        random: randomToken,
        origin: run.origin,
        texts: site.texts,
      });
      setChat(data, from, out.chat);
      texts = out.out.map(fromEngine);
      effects = out.effects;
      refresh = out.changed;
      computed = out.computed;
      for (const e of effects) {
        // The link itself is made after saving; its text is planned here so that it is counted like any other.
        if (e.type === 'web_link') texts.push({ text: e.text, record: e.text.replace(LINK_MARK, '(link)'), link: true });
      }
    }
    const planned = plan(data, site, from, texts, simulated, now);
    return { handled: true as const, simulated, planned, effects, refresh, computed, google: data.google };
  });
  if (!changed || !changed.result.handled) return null;
  const { simulated, planned, effects, google } = changed.result;
  let { refresh } = changed.result;
  let computed: Computed | null | undefined = changed.result.computed;
  let household: Household = changed.household;
  const id = household.id;
  const demo = household.data.demo;

  // The effects, which only the server can carry out. If one cannot be, its "could not" text is sent instead.
  let failedText: OutMessage | null = null;
  let final = planned;
  let reload = false;
  let deleted = false;
  for (const e of effects) {
    if (failedText !== null) break;
    try {
      const done = await carryOut(run, id, demo, e, google);
      if (done.kind === 'failed') failedText = e.ifFailed;
      else if (done.kind === 'link') final = final.map(p => (p.link ? { ...p, text: p.text.replace(LINK_MARK, done.url) } : p));
      else if (done.kind === 'phones') reload = true;
      else if (done.kind === 'deleted') deleted = true;
    } catch (err) {
      console.error('text effect failed', e.type, err instanceof Error ? err.name : 'error');
      failedText = e.ifFailed;
    }
  }
  if (failedText !== null) final = [{ ...fromEngine(failedText), allowed: true }];

  const outcomes = await deliver(run, from, final, simulated);
  const replies: SentText[] = final.filter((_, i) => outcomes[i]?.ok).map(sentOf);

  if (deleted) return { household: null, reply: replies[0]?.text ?? null, replies, refresh: false, computed: null, deleted: true };
  const settled = await settleTexts(run, id, from, planned, final, outcomes, failedText !== null);
  if (settled) household = settled;
  if (reload) {
    household = (await loadHousehold(env, id)) ?? household;
    refresh = true;
    computed = undefined;
  }
  if (refresh && !computed) computed = compute(household.data, now);
  return { household, reply: replies[0]?.text ?? null, replies, refresh, computed: computed ?? null, deleted: false };
}

type EffectResult = { kind: 'done' } | { kind: 'failed' } | { kind: 'link'; url: string } | { kind: 'phones' } | { kind: 'deleted' };

async function carryOut(run: Run, householdId: string, demo: boolean, e: Effect, google: HouseholdData['google']): Promise<EffectResult> {
  const { env, deps, now } = run;
  switch (e.type) {
    case 'join_code':
      return (await putJoinCode(env, e.code, householdId, now, e.days)) ? { kind: 'done' } : { kind: 'failed' };
    case 'web_link': {
      // The phone that asked; the link signs in as that phone only, once, within 10 minutes.
      if (!run.simulate && !demo && !smsReady(run.site)) return { kind: 'failed' };
      const token = randomToken();
      await putLinkToken(env, token, householdId, await phoneHash(env, e.number), now);
      return { kind: 'link', url: `${run.origin}/app/?k=${token}` };
    }
    case 'remove_phone':
    case 'leave': {
      // The console finds the test account by its test phone, which stays on it (as on the website).
      if (demo && e.number === DEMO_NUMBER) return { kind: 'failed' };
      const removed = await removePhone(env, householdId, e.number, now);
      return removed.ok ? { kind: 'phones' } : { kind: 'failed' };
    }
    case 'delete_account':
      // Deleted before the reply is sent, so that the reply never says so when it did not happen.
      await deleteAccount(env, deps, { id: householdId, google });
      return { kind: 'deleted' };
  }
}

// ---------- a number with no account ----------

export type StrangerOutcome = 'ignored' | 'replied' | 'created' | 'joined';

/**
 * A text from a number that has no account.
 *
 * In every sign-up mode, JOIN and a code made by ADD adds this phone to the
 * household that made the code (single use; a household that is full gets
 * a reply saying so). Otherwise, only while the operator allows sign-up by
 * text (`textSignup`) and sign-up is not closed: greet() decides between
 * one reply, nothing, and a new account (JOIN; while sign-up is by
 * invitation, JOIN and a valid invitation word). The number must begin
 * with an allowed prefix.
 *
 * Caps (each reply costs money): one reply per number in 24 hours, a daily
 * total of replies for the site, and a daily total of accounts created by
 * text. Past a cap nothing is sent. STOP gets nothing from here (the
 * carrier confirms it). HELP and START get the wording filed for the
 * toll-free verification, within their own caps (keywordReply).
 */
async function stranger(run: Run, message: ReceivedMessage, hash: string): Promise<{ outcome: StrangerOutcome; replies: SentText[]; householdId: string | null }> {
  const { env, site, now } = run;
  const nothing = { outcome: 'ignored' as const, replies: [], householdId: null };
  const kind = inboundKind(message);
  if (kind === 'stop') return nothing; // the carrier confirms it; there is no account to note it on
  if (!prefixAllowed(message.from, site.config)) return nothing;
  if (!run.simulate && !smsReady(site)) return nothing;
  // HELP and START get the wording filed for the toll-free verification, whatever the sign-up settings are.
  if (kind === 'help' || kind === 'help_answered' || kind === 'start') return keywordReply(run, message, hash, kind === 'start' ? startReply(site.texts) : helpReply(site.texts));

  const typed = joinWord(message.text);
  // A code from ADD: only for the household that made it, and the simulator's only for a test account (and the reverse).
  let join: { hash: string; householdId: string } | null = typed !== null ? await findJoinCode(env, typed, now) : null;
  if (join) {
    const owner = await loadHousehold(env, join.householdId);
    if (!owner || owner.data.demo !== run.simulate) join = null;
  }
  if (join) {
    const g = greet({ text: message.text, signup: site.config.signup, inviteValid: true, inviteKind: 'phone', texts: site.texts });
    if (g.action === 'join') return joinByCode(run, message, hash, join);
  }

  if (!site.config.textSignup || site.config.signup === 'closed') return nothing;
  const invite = typed !== null ? await findSignupInvite(env, typed, now) : null;
  const g = greet({ text: message.text, signup: site.config.signup, inviteValid: typed === null ? null : invite !== null, inviteKind: invite ? 'signup' : undefined, texts: site.texts });
  if (g.action === 'ignore' || g.action === 'join') return nothing;
  if (g.action === 'reply') return strangerReply(run, message.from, hash, g.out);
  // create
  if (!run.simulate && (await bump(env.DB, textSignupsKey(now), 2 * DAY, now)) > TEXT_SIGNUPS_PER_DAY) return nothing;
  if (invite && !(await useInvite(env.DB, invite.hash, now))) {
    const again = greet({ text: message.text, signup: site.config.signup, inviteValid: false, texts: site.texts });
    return again.action === 'reply' ? strangerReply(run, message.from, hash, again.out) : nothing;
  }
  return createByText(run, message);
}

/**
 * HELP or START from a number without an account: the filed reply, once per
 * delivered text, within the keyword caps. Nothing about the number is kept
 * but the counters, which are keyed by its fingerprint.
 */
async function keywordReply(run: Run, message: ReceivedMessage, hash: string, text: string): Promise<{ outcome: StrangerOutcome; replies: SentText[]; householdId: null }> {
  const { env, now } = run;
  const nothing = { outcome: 'ignored' as const, replies: [], householdId: null };
  if (!run.simulate) {
    // A text delivered twice is answered once.
    const claimed = await env.DB.prepare('INSERT OR IGNORE INTO counters (key, value, expires_at) VALUES (?, 1, ?)').bind(`kw:${message.eventId.slice(0, 120)}`, now + DAY).run();
    if (claimed.meta.changes === 0) return nothing;
    if ((await bump(env.DB, keywordKey(hash), DAY, now)) > KEYWORD_REPLIES_PER_NUMBER) return nothing;
    if ((await bump(env.DB, keywordDayKey(now), 2 * DAY, now)) > KEYWORD_REPLIES_PER_DAY) return nothing;
  }
  const texts: Planned[] = [{ text, record: text, allowed: true }];
  const outcomes = await deliver(run, message.from, texts, run.simulate);
  return outcomes[0]?.ok ? { outcome: 'replied', replies: [{ text }], householdId: null } : nothing;
}

/** One reply to a number without an account, within the caps. */
async function strangerReply(run: Run, to: string, hash: string, out: OutMessage[]): Promise<{ outcome: StrangerOutcome; replies: SentText[]; householdId: null }> {
  const { env, now } = run;
  if (!run.simulate) {
    if ((await bump(env.DB, strangerKey(hash), DAY, now)) > STRANGER_REPLIES_PER_NUMBER) return { outcome: 'ignored', replies: [], householdId: null };
    if ((await bump(env.DB, strangerDayKey(now), 2 * DAY, now)) > STRANGER_REPLIES_PER_DAY) return { outcome: 'ignored', replies: [], householdId: null };
  }
  const texts: Planned[] = out.map(m => ({ ...fromEngine(m), allowed: true }));
  const outcomes = await deliver(run, to, texts, run.simulate);
  const replies = texts.filter((_, i) => outcomes[i]?.ok).map(sentOf);
  return { outcome: replies.length > 0 ? 'replied' : 'ignored', replies, householdId: null };
}

/** JOIN: a new account with this phone, verified (texting in proves the number), reminders off; then setup begins. */
async function createByText(run: Run, message: ReceivedMessage): Promise<{ outcome: StrangerOutcome; replies: SentText[]; householdId: string | null }> {
  const { env, site, now } = run;
  let planned: Planned[] = [];
  const made = await createAccount(env, {
    number: message.from,
    verified: true,
    password: null,
    now,
    init: data => {
      data.demo = run.simulate;
      data.seenTexts = [message.eventId];
      addMessage(data, { direction: 'in', phone: lastFour(message.from), body: inboundBody(message), at: now, status: run.simulate ? 'simulated' : 'received' });
      const first = begin({ data, from: message.from, now, texts: site.texts }, 'setup');
      setChat(data, message.from, first.chat);
      planned = plan(data, site, message.from, first.out.map(fromEngine), run.simulate, now);
    },
  });
  // Another request registered the number in the same moment; it answers.
  if (!made.ok) return { outcome: 'ignored', replies: [], householdId: null };
  const outcomes = await deliver(run, message.from, planned, run.simulate);
  await settleTexts(run, made.phone.household_id, message.from, planned, planned, outcomes);
  const replies = planned.filter((_, i) => outcomes[i]?.ok).map(sentOf);
  return { outcome: 'created', replies, householdId: made.phone.household_id };
}

/** JOIN and a code from ADD: this phone joins the household that made the code. */
async function joinByCode(
  run: Run,
  message: ReceivedMessage,
  hash: string,
  join: { hash: string; householdId: string },
): Promise<{ outcome: StrangerOutcome; replies: SentText[]; householdId: string | null }> {
  const { env, site, now } = run;
  // Used up first, so that it can be used once only, whatever happens next.
  if (!(await spendJoinCode(env, join.hash, join.householdId, now))) return { outcome: 'ignored', replies: [], householdId: null };
  const added = await addPhone(env, join.householdId, message.from, now);
  if (!added.ok) {
    return added.reason === 'full' ? strangerReply(run, message.from, hash, [serverText(site.texts, 'signup.join_full')]) : { outcome: 'ignored', replies: [], householdId: null };
  }
  const changed = await changeHousehold(env, join.householdId, now, data => {
    data.seenTexts.push(message.eventId);
    if (data.seenTexts.length > MAX_SEEN_TEXTS) data.seenTexts.splice(0, data.seenTexts.length - MAX_SEEN_TEXTS);
    addMessage(data, { direction: 'in', phone: lastFour(message.from), body: inboundBody(message), at: now, status: data.demo ? 'simulated' : 'received' });
    const first = begin({ data, from: message.from, now, texts: site.texts }, 'joined');
    setChat(data, message.from, first.chat);
    return { demo: data.demo, planned: plan(data, site, message.from, first.out.map(fromEngine), data.demo, now) };
  });
  if (!changed) return { outcome: 'ignored', replies: [], householdId: null };
  const { planned, demo } = changed.result;
  const outcomes = await deliver(run, message.from, planned, demo);
  await settleTexts(run, join.householdId, message.from, planned, planned, outcomes);
  const replies = planned.filter((_, i) => outcomes[i]?.ok).map(sentOf);
  return { outcome: 'joined', replies, householdId: join.householdId };
}

// ---------- the ways in ----------

/** Whether a received message was sent to this site: its number (SMS), or its RCS agent. */
export function addressedToSite(site: Site, message: Pick<InboundMessage, 'channel' | 'to' | 'agentId'>): boolean {
  // Every webhook is signed by Telnyx for this account. Once the agent's id is saved, only that agent's messages are taken;
  // until then an RCS message is taken as it comes (and answered by SMS, since RCS sending needs the id).
  if (message.channel === 'rcs') return !site.secrets.rcsAgentId || message.agentId === site.secrets.rcsAgentId;
  return Boolean(site.secrets.telnyxNumber) && message.to === site.secrets.telnyxNumber;
}

/**
 * Handles one text received by the webhook (SMS or RCS alike). When the
 * household's reminders and calendar should now be refreshed, returns the
 * household as saved and its picture; otherwise null.
 */
export async function handleInbound(
  env: Env,
  deps: Deps,
  site: Site,
  message: InboundMessage,
  origin?: string,
): Promise<{ household: Household; computed: Computed | null } | null> {
  const now = deps.now();
  // Never answered by the real path: these numbers are never real phones.
  if (isFictionalNumber(message.from)) return null;
  const hash = await phoneHash(env, message.from);
  if (!(await allowInbound(env, hash, now))) return null;
  const row = await getPhone(env.DB, hash);
  if (!row) {
    await stranger({ env, deps, site, now, origin: (origin ?? DEFAULT_ORIGIN).replace(/\/+$/, ''), simulate: false }, message, hash);
    return null;
  }
  const handled = await receiveText(env, deps, site, row.household_id, message, now, { origin });
  if (!handled || !handled.refresh || !handled.household) return null;
  return { household: handled.household, computed: handled.computed };
}

export interface Simulated {
  /** What became of the text: nothing, one reply, a new (test) account, a phone added, or a text in a conversation. */
  outcome: StrangerOutcome | 'conversed';
  /** Every text that would have been sent to the number, in order. Nothing was sent. */
  replies: SentText[];
  /** The test account the number is on afterwards, if any. */
  householdId: string | null;
}

/**
 * The operator's simulator: runs a text from a number reserved for fiction
 * (555-0100 to 555-0199) through the whole real path: the sign-up rules,
 * sign-up, the conversation and its effects. Every text is simulated and
 * returned instead of sent; the accounts it creates are test accounts
 * (`demo: true`), which are never texted and cost nothing; no site counter
 * moves (so the daily caps for numbers without an account are not used up
 * by it, and are not applied to it); it never touches an account that is
 * not a test account. Throws a ValidationError for a real number.
 *
 * For the operator's console (not connected to a route here).
 */
export async function simulateText(
  env: Env,
  deps: Deps,
  site: Site,
  args: { from: string; text: string; location?: InboundMessage['location']; origin?: string },
): Promise<Simulated> {
  if (typeof args.from !== 'string' || !isFictionalNumber(args.from)) throw new ValidationError('The simulator takes only numbers reserved for fiction, from 555-0100 to 555-0199 in any area code.');
  if (typeof args.text !== 'string' || args.text.length > 320) throw new ValidationError('Type a text of at most 320 characters.');
  const now = deps.now();
  const origin = (args.origin ?? DEFAULT_ORIGIN).replace(/\/+$/, '');
  const message: ReceivedMessage = { eventId: `sim:${randomToken()}`, from: args.from, text: args.text, autoresponseType: null, location: args.location ?? null };
  const hash = await phoneHash(env, args.from);
  const row = await getPhone(env.DB, hash);
  if (!row) {
    const result = await stranger({ env, deps, site, now, origin, simulate: true }, message, hash);
    return { outcome: result.outcome, replies: result.replies, householdId: result.householdId };
  }
  const received = await receiveText(env, deps, site, row.household_id, message, now, { origin, simulate: true });
  if (!received) throw new ValidationError('That number is on an account that is not a test account.');
  // As after a real text: its reminders (simulated) and calendar follow the change.
  if (received.refresh && received.household) await refreshHousehold(env, deps, site, received.household, received.computed, now);
  return { outcome: 'conversed', replies: received.replies, householdId: received.deleted ? null : row.household_id };
}
