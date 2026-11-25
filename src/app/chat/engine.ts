/**
 * The text-message conversation: sign-up, setup and the whole account, by
 * SMS (and RCS) alone.
 *
 * Pure: no database, no network, no clock, no randomness of its own. The
 * server passes in the household, the options of the last message to the
 * phone and what was typed, and gets back the replies, the options now
 * offered, and the things only it can do (effects). docs/TEXTING.md is the
 * reference.
 *
 *   greet(input)     a text from a number with no account: reply, ignore,
 *                    create an account, or add the phone to an account.
 *   begin(input, m)  right after greet's "create" ('setup') or "join"
 *                    ('joined'): the first text to the new phone.
 *   converse(input)  every text from a phone on an account.
 *   joinWord(text)   the invitation word in "JOIN <word>", for the server
 *                    to look up before calling greet.
 *
 * Every text comes from the registry (messages.ts) in the operator's
 * wording (site-texts.ts) and ends with its options. A reply is read, in
 * this order:
 *   1. (STOP, START, HELP and the other carrier words never reach this code.)
 *   2. A digit alone, or a text over 400 characters: not understood.
 *   3. The free text the last message asked for: a ZIP code, or a date
 *      ("Nov 22 night", "yesterday").
 *   4. The options of the last message, kept 24 hours.
 *   5. The general words (PERIOD, HEFSEK, STATUS, UNDO, MENU and the words
 *      for the settings), with a date or a time after them where they take one.
 *   6. Otherwise: "Not understood", with the main options.
 *
 * Rules the code keeps (and the tests check): nothing is guessed (a text
 * not understood changes nothing); every change is confirmed; GSM-7 only,
 * at most two segments per text and two texts per message; erasing an
 * entry, removing a phone, leaving, deleting the account, replacing or
 * removing the calendar link and pausing vesatot each need YES; nothing is
 * sent to a number that has not texted in.
 */
import { localAbs, absToCivil } from '../../engine/civil';
import { dayWords, type DateStyle, type DateWords } from '../../engine/dates';
import { restPieces, statusMessage, type RestText, type TextMessage } from '../../engine/present';
import { onahAt } from '../../engine/zmanim';
import { parseDayWords, parseOnahWords, resolveHefsekDay, resolveMikvahNight, resolveWhen, whenTokens, type ResolveContext, type ResolvedOnah, type WhenSpec } from '../commands';
import { compute, confirmationParts, entryEnglish, recordEntry, removeEntry, tooEarlyNight, UNDO_WINDOW_MS, whereOf, type Computed, type DraftEntry, type RejectReason } from '../household';
import { canText, lastFour, type HouseholdData } from '../model';
import { REMINDER_KINDS, type PhoneRecord } from '../settings';
import { applyOption, currentOption, NIGHTFALL_INDEX, sameValue, SMS_CUSTOMS, tzeitWords, VESATOT_INDEX } from './customs';
import { looksLikeDate, parseDated, recordDated, type DatedOutcome } from './dated';
import { foldToGsm } from './gsm';
import { MESSAGE_BY_KEY, shortWords } from './messages';
import { compose, generalActionsIn, generalWords, matchGeneral, matchOption, NO_TEXTS, optionsOf, renderBody, wordsOf, type Piece, type SiteTexts, type Vars } from './site-texts';
import type { BeginInput, ChatContext, ChatExpect, ChatState, ConfirmAction, ConverseInput, ConverseOutput, Effect, GreetInput, GreetOutput, OutMessage, Place, RecordKind } from './types';

/** The options of a message are kept this long. */
export const CHAT_TTL_MS = 24 * 3_600_000;
/** A YES-or-NO question about something that cannot be undone (deleting the account, leaving it, replacing a link) is open for 30 minutes only. */
export const CONFIRM_TTL_MS = 30 * 60_000;
/** Days a code for adding another phone stays valid. */
export const INVITE_DAYS = 7;
/** Texts longer than this are not read at all. */
const MAX_INPUT = 400;
const DEFAULT_ORIGIN = 'https://betaharah.com';
/** Stands for the sign-in link in the text of WEB LINK until the server has made it. GSM-7. */
export const LINK_MARK = '@@LINK@@';

// ---------- small helpers ----------

const ZIP_US = /^(\d{5})(?:-\d{4})?$/;
const ZIP_CA = /^([A-Z]\d[A-Z])(?: ?(\d[A-Z]\d))?$/;

/** The code to look up, from a typed ZIP or postal code; null if it is not in either form. */
export function postalOf(text: string): string | null {
  const w = text.normalize('NFKC').replace(/[.,!]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
  const us = ZIP_US.exec(w);
  if (us) return us[1] as string;
  const ca = ZIP_CA.exec(w);
  if (ca) return ca[2] ? `${ca[1]} ${ca[2]}` : (ca[1] as string);
  return null;
}

/** An 8-letter code for adding a phone, made from the injected random source (no digits, no I or O). */
export function inviteCode(random: () => string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let tries = 0; code.length < 8 && tries < 20; tries++) {
    for (const ch of random()) {
      if (code.length >= 8) break;
      code += alphabet[ch.charCodeAt(0) % alphabet.length];
    }
  }
  return code.padEnd(8, 'A');
}

/**
 * How the texts write dates: in English letters, as the household chooses,
 * as of now ("last night", "Thu", "Sun night, Nov 22").
 */
function dateWords(r: Reply): DateWords {
  const where = whereOf(r.input.data);
  const w: DateWords = { dates: r.input.data.app.dates, lang: 'en' };
  return where ? { ...w, today: localAbs(r.input.now, where.place.timeZone) } : w;
}

/** "flow last night", "flow Sun night, Nov 22", with the year when it is not this year. */
function entryWithYear(r: Reply, e: Parameters<typeof entryEnglish>[0], thisYear: number): string {
  const abs = 'onah' in e ? (e.onah.part === 'day' ? e.onah.abs : e.onah.abs - 1) : e.kind === 'mikvah' ? e.abs - 1 : e.abs;
  return entryEnglish(e, { ...dateWords(r), year: absToCivil(abs).y !== thisYear });
}

const ORDINAL_IDS = ['first', 'second', 'third', 'fourth', 'fifth'] as const;

/** Checks stored options; anything malformed counts as none. */
export function validChat(x: unknown): ChatState | null {
  if (typeof x !== 'object' || x === null) return null;
  const c = x as Partial<ChatState>;
  if (c.v !== 2 || typeof c.at !== 'number' || !Number.isFinite(c.at) || typeof c.key !== 'string' || !MESSAGE_BY_KEY.has(c.key)) return null;
  if (!Array.isArray(c.opts) || c.opts.length > 6 || !c.opts.every(o => Array.isArray(o) && o.length === 2 && typeof o[0] === 'string' && typeof o[1] === 'string' && o[1].length <= 20)) return null;
  if (c.expect !== undefined && !(['zip', 'date', 'days', 'time'] as const).includes(c.expect)) return null;
  const k = c.ctx as ChatContext | undefined;
  if (typeof k !== 'object' || k === null) return null;
  const strings = (a: unknown, max: number): boolean => Array.isArray(a) && a.length <= max && a.every(s => typeof s === 'string');
  if (k.setup !== undefined && typeof k.setup !== 'boolean') return null;
  if (k.kind !== undefined && !['flow', 'stain', 'broken', 'hefsek', 'mikvah'].includes(k.kind)) return null;
  if (k.day !== undefined && !Number.isInteger(k.day)) return null;
  if (k.ids !== undefined && !strings(k.ids, 5)) return null;
  if (k.numbers !== undefined && !strings(k.numbers, 4)) return null;
  if (k.index !== undefined && !(Number.isInteger(k.index) && k.index >= 0 && k.index < SMS_CUSTOMS.length)) return null;
  if (k.walk !== undefined && typeof k.walk !== 'boolean') return null;
  if (k.action !== undefined && !validAction(k.action)) return null;
  return c as ChatState;
}

function validAction(a: unknown): boolean {
  if (typeof a !== 'object' || a === null) return false;
  const x = a as ConfirmAction;
  switch (x.type) {
    case 'erase':
      return typeof x.id === 'string';
    case 'remove_phone':
      return typeof x.number === 'string';
    case 'place':
      return typeof x.place === 'object' && x.place !== null && typeof x.place.name === 'string';
    case 'leave':
    case 'delete_account':
    case 'calendar_new':
    case 'calendar_off':
    case 'pause_vesatot':
      return true;
    default:
      return false;
  }
}

/** The rendered texts as messages to send. */
function toOut(texts: SiteTexts, pieces: Piece[]): OutMessage[] {
  return compose(texts, pieces).map(t =>
    t.options.length > 0 ? { text: t.text, body: t.body, suggestions: t.options.map(([, label]) => ({ label, send: label })) } : { text: t.text, body: t.body },
  );
}

/** One message of the registry as a text to send, with the options it leaves for the reply. */
export function messageOut(texts: SiteTexts, msg: TextMessage, now: number): { out: OutMessage; chat: ChatState | null } {
  const out = toOut(texts, [{ key: msg.key, vars: msg.vars }])[0] ?? { text: '', body: '' };
  const opts = optionsOf(texts, msg.key);
  const chat: ChatState | null = opts.length > 0 && !MESSAGE_BY_KEY.get(msg.key)?.filed ? { v: 2, at: now, key: msg.key, opts, ctx: msg.day === undefined ? {} : { day: msg.day } } : null;
  return { out, chat };
}

/**
 * The text of a Shabbat or Yom Tov in the operator's wording: one text, or
 * two when its lines with the options do not fit two segments (split
 * between lines, each ending with the options), with the options its last
 * line leaves for the reply.
 */
export function restOut(texts: SiteTexts, rest: RestText, now: number): { outs: OutMessage[]; chat: ChatState | null } {
  const pieces = restPieces(rest);
  const outs = toOut(texts, pieces);
  const last = pieces[pieces.length - 1];
  const opts = last ? optionsOf(texts, last.key) : [];
  return { outs, chat: last && opts.length > 0 ? { v: 2, at: now, key: last.key, opts, ctx: {} } : null };
}

// ---------- the reply being built ----------

class Reply {
  pieces: Piece[] = [];
  effects: Effect[] = [];
  changed = false;
  computed: Computed | undefined;
  ctx: ChatContext = {};
  expect: ChatExpect | undefined;
  readonly texts: SiteTexts;

  constructor(
    readonly input: ConverseInput,
    readonly me: PhoneRecord,
  ) {
    this.texts = input.texts ?? NO_TEXTS;
  }

  /** Adds a message. Its options become the ones offered; what they need is set with ask() after it. */
  say(key: string, vars: Vars = {}, offer?: readonly string[]): this {
    this.pieces.push(offer ? { key, vars, offer } : { key, vars });
    this.ctx = {};
    this.expect = undefined;
    return this;
  }

  ask(ctx: ChatContext, expect?: ChatExpect): this {
    this.ctx = ctx;
    this.expect = expect;
    return this;
  }

  /** A text that would be one or more fails: "Could not". */
  failed(key: string, vars: Vars = {}): OutMessage {
    return toOut(this.texts, [{ key, vars }])[0] as OutMessage;
  }

  done(): ConverseOutput {
    const now = this.input.now;
    const last = this.pieces[this.pieces.length - 1];
    let out = toOut(this.texts, this.pieces);
    let chat: ChatState | null = null;
    if (last) {
      const opts = optionsOf(this.texts, last.key, last.offer);
      if (opts.length > 0) chat = { v: 2, at: now, key: last.key, opts, ctx: this.ctx, ...(this.expect ? { expect: this.expect } : {}) };
    }
    // WEB LINK: its one text goes with the effect, which adds the link.
    const web = this.effects.find(e => e.type === 'web_link');
    if (web && web.type === 'web_link') {
      web.text = out.map(m => m.text).join(' ');
      out = [];
    }
    const result: ConverseOutput = { chat, out, effects: this.effects, changed: this.changed };
    if (this.computed) result.computed = this.computed;
    return result;
  }
}

// ---------- lists in the words of the options ----------

/** The labels of a message's ordinal options, in small letters: "first", "second", ... */
function ordinals(r: Reply, key: string): string[] {
  const labels = new Map(optionsOf(r.texts, key));
  return ORDINAL_IDS.map(id => (labels.get(id) ?? id).toLowerCase());
}

function kindLists(r: Reply): { on: string; off: string } {
  const labels = new Map(optionsOf(r.texts, 'reminders.kinds'));
  const name = (k: string): string => (labels.get(`kind_${k}`) ?? k).toLowerCase();
  const on = REMINDER_KINDS.filter(k => r.me.reminders.includes(k)).map(name);
  const off = REMINDER_KINDS.filter(k => !r.me.reminders.includes(k)).map(name);
  return { on: on.length ? on.join(', ') : 'none', off: off.length ? off.join(', ') : 'none' };
}

// ---------- status ----------

function statusOf(r: Reply, computed: Computed): { key: string; vars: Vars } {
  return statusMessage(computed.timeline, computed.place.timeZone, computed.dates);
}

function statusBody(r: Reply, computed: Computed | null): string {
  if (!computed) return '';
  const m = statusOf(r, computed);
  return renderBody(r.texts, m.key, m.vars);
}

function status(r: Reply): void {
  const computed = compute(r.input.data, r.input.now);
  if (!computed) {
    r.say('status.no_place');
    return;
  }
  r.computed = computed;
  const m = statusOf(r, computed);
  r.say(m.key, m.vars);
}

// ---------- recording ----------

const RECORD_KEY: Record<RecordKind, string> = { flow: 'record.flow', stain: 'record.stain', broken: 'record.broken', hefsek: 'record.hefsek', mikvah: 'record.immersion' };
const WHEN_KEY: Record<RecordKind, string> = {
  flow: 'record.when_flow',
  stain: 'record.when_stain',
  broken: 'record.when_broken',
  hefsek: 'record.when_hefsek',
  mikvah: 'record.when_immersion',
};
/** The general action whose words name what is recorded. */
const KIND_ACTION: Record<RecordKind, string | null> = { flow: 'period', stain: 'stain', broken: 'broken', hefsek: 'hefsek', mikvah: null };

function isNight(r: Reply): boolean {
  const where = whereOf(r.input.data);
  return where ? onahAt(r.input.now, where.place, where.zopts).onah.part === 'night' : false;
}

function refusal(r: Reply, reason: RejectReason, computed: Computed | null): void {
  switch (reason) {
    case 'duplicate':
      r.say('refuse.duplicate');
      return;
    case 'future':
      r.say('refuse.future');
      return;
    case 'hefsek_without_niddah':
    case 'mikvah_without_niddah':
      r.say('refuse.no_period');
      return;
    case 'hefsek_before_start':
      r.say('refuse.before_start');
      return;
    case 'broken_without_count':
      r.say('refuse.no_count');
      return;
    case 'mikvah_without_hefsek':
      r.say('refuse.no_hefsek');
      return;
    case 'mikvah_too_early': {
      const night = tooEarlyNight(computed);
      if (night) r.say('refuse.too_early', night);
      else r.say('refuse.too_early_plain');
      return;
    }
    case 'no_place':
      r.say('refuse.no_place');
      return;
    default:
      r.say('refuse.other');
  }
}

/** The question "when?" for what is being recorded, with the options that fit the hour. */
function askWhen(r: Reply, kind: RecordKind, ctx: ChatContext): void {
  const night = isNight(r);
  const offer =
    kind === 'hefsek'
      ? undefined
      : kind === 'mikvah'
        ? night
          ? ['tonight', 'last_night', 'another_day']
          : ['last_night', 'another_day']
        : ['now', night ? 'today_day' : 'last_night', 'another_day'];
  r.say(WHEN_KEY[kind], {}, offer).ask({ ...(ctx.setup ? { setup: true } : {}), kind }, 'date');
}

/** What comes after a recording in setup, or a refusal in setup: the step again. */
function setupNext(r: Reply, kind: RecordKind, recorded: boolean): void {
  if (recorded && kind === 'hefsek') {
    finishSetup(r);
  } else if (recorded) {
    r.say('setup.recent_hefsek').ask({ setup: true, kind: 'hefsek' }, 'date');
  } else if (kind === 'hefsek') {
    r.say('setup.recent_hefsek').ask({ setup: true, kind: 'hefsek' }, 'date');
  } else {
    r.say('setup.recent').ask({ setup: true, kind: 'flow' }, 'date');
  }
}

function saveDraft(r: Reply, kind: RecordKind, draft: DraftEntry, resolved: ResolvedOnah | null, ctx: ChatContext): void {
  const result = recordEntry(r.input.data, draft, 'sms', null, r.input.now);
  if (!result.ok) {
    refusal(r, result.reason, result.computed);
    if (ctx.setup) setupNext(r, kind, false);
    return;
  }
  r.changed = true;
  r.computed = result.computed;
  r.say(RECORD_KEY[kind], confirmationParts(result, resolved));
  if (ctx.setup) setupNext(r, kind, true);
}

function saveDated(r: Reply, kind: RecordKind, o: DatedOutcome, ctx: ChatContext): void {
  if (o.ok) {
    // recordDated changed the data only for a phone that may record (readWhen checks before it is called).
    r.changed = true;
    r.computed = o.result.computed;
    // The date as it was read, in full with its year, so that a year taken as last year is never a surprise.
    const parts = confirmationParts(o.result, o.resolved, true);
    r.say(RECORD_KEY[kind], parts);
    if (ctx.setup) setupNext(r, kind, true);
    return;
  }
  if (o.reason === 'none_recent') {
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(o.month) + 1;
    const today = absToCivil(localAbs(r.input.now, whereOf(r.input.data)?.place.timeZone ?? 'UTC')).y;
    let example = today - 4;
    for (let y = today; y > today - 8; y--) {
      if (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) {
        example = y;
        break;
      }
    }
    r.say('date.not_recent', { date: `${o.month} ${o.day}`, example: `${m}/${o.day}/${example}` }).ask({ ...ctx, kind }, 'date');
    return;
  }
  if (o.reason === 'no_such_date') {
    r.say('date.no_such', { date: o.date }).ask({ ...ctx, kind }, 'date');
    return;
  }
  if (o.reason === 'adar') {
    r.say('date.adar').ask({ ...ctx, kind }, 'date');
    return;
  }
  refusal(r, o.reason, o.computed);
  if (o.readAs) r.say('date.read_as', { date: o.readAs });
  if (ctx.setup) setupNext(r, kind, false);
}

/**
 * Records what `kind` names, from the words after it: a date ("Nov 22
 * night"), when-words ("yesterday night", "9pm"), or nothing (then the
 * question "when?" with its options).
 */
function record(r: Reply, kind: RecordKind, tokens: readonly string[], ctx: ChatContext = {}): void {
  if (!r.me.canUpdate) {
    r.say('refuse.read_only');
    return;
  }
  if (!whereOf(r.input.data)) {
    r.say('refuse.no_place');
    return;
  }
  const outcome = readWhen(r, kind, tokens, ctx);
  if (outcome === 'unread') askWhen(r, kind, ctx);
}

/** Records from words, if they say when. 'unread' when they do not (nothing is changed). */
function readWhen(r: Reply, kind: RecordKind, tokens: readonly string[], ctx: ChatContext): 'done' | 'unread' {
  const t = whenTokens(tokens);
  if (looksLikeDate(t[0], t[1])) {
    const p = parseDated(kind, t);
    if (p.kind === 'error') {
      r.say(p.problem.key, 'vars' in p.problem ? p.problem.vars : {}).ask({ ...ctx, kind }, 'date');
      return 'done';
    }
    if (p.kind === 'ok') {
      if (!r.me.canUpdate) r.say('refuse.read_only');
      else saveDated(r, kind, recordDated(r.input.data, p, r.input.now), ctx);
      return 'done';
    }
  }
  if (kind === 'hefsek') {
    const d = parseDayWords(tokens);
    if (!d) return 'unread';
    recordNow(r, kind, { yesterday: d.yesterday }, ctx);
    return 'done';
  }
  if (kind === 'mikvah') {
    const words = t.join(' ');
    if (words === 'tonight') recordNow(r, kind, { tonight: true }, ctx);
    else if (words === 'last night' || words === 'yesterday' || words === 'night') recordNow(r, kind, { tonight: false }, ctx);
    else return 'unread';
    return 'done';
  }
  const when = parseOnahWords(t);
  if (!when) return 'unread';
  recordNow(r, kind, { when, last: t.includes('last') }, ctx);
  return 'done';
}

type How = { when: WhenSpec; last?: boolean } | { yesterday: boolean } | { tonight: boolean };

/** Records something that happened now or lately (no date given). */
function recordNow(r: Reply, kind: RecordKind, how: How, ctx: ChatContext): void {
  const { data, now } = r.input;
  if (!r.me.canUpdate) {
    r.say('refuse.read_only');
    return;
  }
  const where = whereOf(data);
  if (!where) {
    r.say('refuse.no_place');
    return;
  }
  const rc: ResolveContext = { now, place: where.place, zopts: where.zopts, boundaryMarginMs: data.app.boundaryMarginMinutes * 60_000 };
  const night = isNight(r);
  if (kind === 'hefsek' && 'yesterday' in how) {
    saveDraft(r, kind, { kind: 'hefsek', abs: resolveHefsekDay(how.yesterday, rc) }, null, ctx);
    return;
  }
  if (kind === 'mikvah' && 'tonight' in how) {
    if (how.tonight && !night) {
      r.say('refuse.future');
      return;
    }
    // At night, "last night" is the night before this one; by day, the night that ended this morning.
    saveDraft(r, kind, { kind: 'mikvah', abs: resolveMikvahNight(!how.tonight && night, rc) }, null, ctx);
    return;
  }
  if (!('when' in how) || kind === 'hefsek' || kind === 'mikvah') return;
  let when = how.when;
  // "last night" at night: the night before this one.
  if (how.last && night && when.type === 'onah' && when.part === 'night' && !when.yesterday) when = { ...when, yesterday: true };
  const resolved = resolveWhen(when, rc);
  if (!resolved.ok) {
    r.say('refuse.future');
    return;
  }
  const draft: DraftEntry = kind === 'flow' ? { kind: 'flow', onah: resolved.onah, veset: true } : { kind, onah: resolved.onah };
  saveDraft(r, kind, draft, resolved, ctx);
}

/** The answer to "when?" by an option. */
function whenChoice(r: Reply, id: string, ctx: ChatContext): void {
  const kind = ctx.kind;
  if (!kind) {
    notUnderstood(r);
    return;
  }
  const keep: ChatContext = ctx.setup ? { setup: true } : {};
  switch (id) {
    case 'another_day':
      r.say(kind === 'hefsek' || kind === 'mikvah' ? 'record.date_day' : 'record.date_onah').ask({ ...keep, kind }, 'date');
      return;
    case 'now':
      recordNow(r, kind, { when: { type: 'now' } }, keep);
      return;
    case 'last_night':
      if (kind === 'mikvah') recordNow(r, kind, { tonight: false }, keep);
      else recordNow(r, kind, { when: { type: 'onah', part: 'night', yesterday: false }, last: true }, keep);
      return;
    case 'today_day':
      recordNow(r, kind, { when: { type: 'onah', part: 'day', yesterday: false } }, keep);
      return;
    case 'today':
    case 'yesterday':
      if (kind === 'hefsek') recordNow(r, kind, { yesterday: id === 'yesterday' }, keep);
      else notUnderstood(r);
      return;
    case 'tonight':
      recordNow(r, 'mikvah', { tonight: true }, keep);
      return;
  }
}

/** DONE on the hefsek reminder: the hefsek on the day the reminder was about. */
function hefsekDone(r: Reply, ctx: ChatContext): void {
  if (ctx.day === undefined) {
    notUnderstood(r);
    return;
  }
  if (!r.me.canUpdate) {
    r.say('refuse.read_only');
    return;
  }
  if (!whereOf(r.input.data)) {
    r.say('refuse.no_place');
    return;
  }
  saveDraft(r, 'hefsek', { kind: 'hefsek', abs: ctx.day }, null, {});
}

function undo(r: Reply): void {
  const { data, now } = r.input;
  if (!r.me.canUpdate) {
    r.say('refuse.read_only');
    return;
  }
  if (!whereOf(data)) {
    r.say('refuse.no_place');
    return;
  }
  const last = [...data.entries].sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!last || now - last.createdAt > UNDO_WINDOW_MS) {
    r.say('undo.nothing');
    return;
  }
  removeEntry(data, last.entry.id, now);
  r.changed = true;
  const after = compute(data, now);
  if (after) r.computed = after;
  r.say('undo.done', { entry: entryEnglish(last.entry, dateWords(r)), status: statusBody(r, after) });
}

// ---------- history ----------

function thisYear(r: Reply): number {
  const where = whereOf(r.input.data);
  return absToCivil(localAbs(r.input.now, where ? where.place.timeZone : 'UTC')).y;
}

function history(r: Reply): void {
  const { data } = r.input;
  if (data.entries.length === 0) {
    r.say('history.empty');
    return;
  }
  const year = thisYear(r);
  const sorted = [...data.entries]
    .sort((a, b) => {
      const pa = 'onah' in a.entry ? a.entry.onah.abs : a.entry.abs;
      const pb = 'onah' in b.entry ? b.entry.onah.abs : b.entry.abs;
      return pb - pa || b.createdAt - a.createdAt;
    })
    .slice(0, 5);
  const names = ordinals(r, 'history.list');
  const list = sorted.map((e, i) => `${names[i]}: ${entryWithYear(r, e.entry, year)}`).join('; ');
  r.say('history.list', { list }, [...ORDINAL_IDS.slice(0, sorted.length), 'menu']).ask({ ids: sorted.map(e => e.entry.id) });
}

function eraseAsk(r: Reply, id: string): void {
  const stored = r.input.data.entries.find(e => e.entry.id === id);
  if (!stored) {
    r.say('history.gone');
    return;
  }
  if (!r.me.canUpdate) {
    r.say('refuse.read_only');
    return;
  }
  r.say('history.erase_ask', { entry: entryWithYear(r, stored.entry, thisYear(r)) }).ask({ action: { type: 'erase', id } });
}

// ---------- setup ----------

function startSetup(r: Reply, first: boolean): void {
  const place = r.input.data.app.place;
  if (place) r.say('setup.start_place', { place: foldToGsm(place.name) });
  else r.say(first ? 'setup.start' : 'setup.again');
  r.ask({ setup: true }, 'zip');
}

function setupCustoms(r: Reply): void {
  r.say('setup.customs').ask({ setup: true });
}

function setupRecent(r: Reply): void {
  r.say('setup.recent').ask({ setup: true, kind: 'flow' }, 'date');
}

function finishSetup(r: Reply): void {
  r.say('setup.done');
}

// ---------- location ----------

function setPlace(r: Reply, place: Place, setup: boolean): void {
  r.input.data.app.place = { name: place.name, latitude: place.latitude, longitude: place.longitude, timeZone: place.timeZone, elevation: place.elevation };
  r.input.data.sync.dirty = true;
  r.changed = true;
  r.say('location.set', { place: foldToGsm(place.name) });
  if (setup) setupCustoms(r);
}

function zipAnswer(r: Reply, setup: boolean, postal: string): void {
  const place = r.input.lookupPostal(postal);
  if (!place) {
    r.say('location.unknown', { code: postal }, setup ? ['skip_place', 'web', 'menu'] : ['web', 'menu']).ask(setup ? { setup: true } : {}, 'zip');
    return;
  }
  setPlace(r, place, setup);
}

function location(r: Reply, rest: readonly string[]): void {
  if (rest.length === 0) {
    const place = r.input.data.app.place;
    if (place) r.say('location.show', { place: foldToGsm(place.name) });
    else r.say('location.ask');
    r.ask({}, 'zip');
    return;
  }
  const postal = postalOf(rest.join(' '));
  if (postal === null) {
    r.say('location.not_postal').ask({}, 'zip');
    return;
  }
  zipAnswer(r, false, postal);
}

// ---------- customs ----------

function askCustom(r: Reply, index: number, walk: boolean, setup: boolean): void {
  const c = SMS_CUSTOMS[index]!;
  const cur = currentOption(c, r.input.data.halachic);
  const now = cur >= 0 ? shortWords(c.options[cur]!.short) : `${tzeitWords(r.input.data.halachic.tzeit)} (set on the website)`;
  const step = walk ? `Custom ${index + 1} of 12: ` : '';
  r.say(`custom.${c.key}`, { step, now }).ask({ index, walk, ...(setup ? { setup: true } : {}) });
}

function customAnswer(r: Reply, ctx: ChatContext, id: string): void {
  const index = ctx.index;
  if (index === undefined) {
    notUnderstood(r);
    return;
  }
  const { data, now } = r.input;
  const c = SMS_CUSTOMS[index]!;
  const cur = currentOption(c, data.halachic);
  const chosen = id === 'keep' ? -1 : Number(id.slice(1));
  const option = chosen >= 0 ? c.options[chosen] : null;
  if (chosen >= 0 && !option) {
    notUnderstood(r);
    return;
  }
  const same = !option || (cur >= 0 && sameValue(c.options[cur]!.value, option.value));
  if (!ctx.walk) {
    if (!option) r.say('confirm.no');
    else if (same) r.say('custom.same');
    else if (index === VESATOT_INDEX && option.value === 'paused') r.say('vesatot.pause_ask').ask({ action: { type: 'pause_vesatot' } });
    else {
      applyOption(data.halachic, c, option);
      data.sync.dirty = true;
      r.changed = true;
      r.say('custom.changed', { name: c.name, choice: shortWords(option.short) });
    }
    return;
  }
  if (option && !same) {
    applyOption(data.halachic, c, option);
    data.sync.dirty = true;
    r.changed = true;
    r.say('custom.saved', { name: c.name, choice: shortWords(option.short) });
  } else {
    r.say('custom.kept', { name: c.name, choice: cur >= 0 ? shortWords(c.options[cur]!.short) : 'as set on the website' });
  }
  if (index + 1 < SMS_CUSTOMS.length) {
    askCustom(r, index + 1, true, ctx.setup === true);
    return;
  }
  data.halachicConfirmedAt = now;
  r.changed = true;
  r.say('customs.done');
  if (ctx.setup) setupRecent(r);
}

function customsList(r: Reply, rest: readonly string[]): void {
  if (rest.some(w => w.toLowerCase() === 'all')) askCustom(r, 0, true, false);
  else r.say('customs.page1');
}

function vesatot(r: Reply, rest: readonly string[]): void {
  const data = r.input.data;
  const words = new Set(rest.map(w => w.toLowerCase()));
  if (words.has('pause')) {
    if (data.halachic.vesatot === 'paused') r.say('vesatot.already_paused');
    else r.say('vesatot.pause_ask').ask({ action: { type: 'pause_vesatot' } });
    return;
  }
  if (words.has('resume')) {
    if (data.halachic.vesatot === 'active') {
      r.say('vesatot.already_on');
      return;
    }
    const c = SMS_CUSTOMS[VESATOT_INDEX]!;
    applyOption(data.halachic, c, c.options[0]!);
    data.sync.dirty = true;
    r.changed = true;
    r.say('vesatot.resumed');
    return;
  }
  askCustom(r, VESATOT_INDEX, false, false);
}

// ---------- reminders ----------

function reminders(r: Reply, rest: readonly string[]): void {
  const words = new Set(rest.map(w => w.toLowerCase()));
  if (words.has('on')) return remindersOn(r);
  if (words.has('off')) return remindersOff(r);
  if (words.has('kinds')) return kinds(r);
  if (words.has('times') || words.has('time')) {
    r.say('website.only');
    return;
  }
  if (words.has('wording')) return wording(r, []);
  if (['bedikot', 'bedikos', 'bedikah', 'bedikahs', 'bedikas'].some(w => words.has(w))) return bedikot(r);
  if (['shabbat', 'shabbos', 'yom', 'tov'].some(w => words.has(w))) return restEve(r);
  const on = canText(r.me);
  r.say('reminders.show', { state: on ? 'on' : 'off', kinds: String(r.me.reminders.length), style: r.input.data.app.reminders.style }, [
    on ? 'off' : 'on',
    'kinds',
    'wording',
    'bedikot',
    'rest_eve',
  ]);
}

function remindersOn(r: Reply): void {
  const me = r.me;
  if (me.optedOut) {
    r.say('reminders.opted_out');
    return;
  }
  if (me.consentAt !== null && me.verifiedAt !== null) {
    r.say('reminders.already_on');
    return;
  }
  // Texting from the phone proves the number; turning reminders on by text is the consent.
  if (me.verifiedAt === null) me.verifiedAt = r.input.now;
  me.consentAt = r.input.now;
  r.changed = true;
  r.say('reminders.on', { last4: lastFour(me.number) });
}

function remindersOff(r: Reply): void {
  if (r.me.consentAt === null) {
    r.say('reminders.already_off');
    return;
  }
  r.me.consentAt = null;
  r.changed = true;
  r.say('reminders.off');
}

function kinds(r: Reply): void {
  r.say('reminders.kinds', kindLists(r));
}

function kindToggle(r: Reply, id: string): void {
  const kind = id.slice('kind_'.length);
  if (!(REMINDER_KINDS as string[]).includes(kind)) {
    notUnderstood(r);
    return;
  }
  const has = (r.me.reminders as string[]).includes(kind);
  r.me.reminders = REMINDER_KINDS.filter(k => (k === kind ? !has : r.me.reminders.includes(k)));
  r.changed = true;
  r.say('reminders.kinds_changed', kindLists(r));
}

function wording(r: Reply, rest: readonly string[]): void {
  const words = new Set(rest.map(w => w.toLowerCase()));
  if (words.has('plain')) return setWording(r, 'plain');
  if (words.has('discreet')) return setWording(r, 'discreet');
  r.say('reminders.wording', { style: r.input.data.app.reminders.style });
}

function setWording(r: Reply, style: 'plain' | 'discreet'): void {
  const rem = r.input.data.app.reminders;
  if (rem.style === style) {
    r.say('reminders.wording_same', { style });
    return;
  }
  // A copy, so that a shared default object is never changed.
  r.input.data.app.reminders = { ...rem, style };
  r.changed = true;
  r.say('reminders.wording_changed', { style });
}

/** "all 7", "1 and 7", "1, 2 and 7", "7 only", "none": the clean days that get bedikah reminders. */
export function cleanDaysWords(days: readonly number[]): string {
  if (days.length === 7) return 'all 7';
  if (days.length === 0) return 'none';
  if (days.length === 1) return `${days[0]} only`;
  return `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`;
}

/** The bedikah settings as the texts say them, with the options that change them (each switch offers its other state). */
function bedikotSay(r: Reply, key: string): void {
  const b = r.input.data.app.reminders.bedikot;
  const vars = { state: b.on ? 'on' : 'off', days: cleanDaysWords(b.days), morning: b.morning ? 'on' : 'off', sunset: b.beforeSunset ? 'on' : 'off' };
  r.say(key, vars, ['days', b.morning ? 'morning_off' : 'morning_on', b.beforeSunset ? 'sunset_off' : 'sunset_on', 'menu']);
}

function bedikot(r: Reply): void {
  bedikotSay(r, 'reminders.bedikot');
}

type BedikotChange = Partial<Pick<HouseholdData['app']['reminders']['bedikot'], 'days' | 'morning' | 'beforeSunset'>>;

/** Changes the bedikah reminders of the account (a copy, so that a shared default object is never changed). */
function setBedikot(r: Reply, change: BedikotChange): void {
  const rem = r.input.data.app.reminders;
  const next = { ...rem.bedikot, ...change };
  if (next.days.join() === rem.bedikot.days.join() && next.morning === rem.bedikot.morning && next.beforeSunset === rem.bedikot.beforeSunset) {
    bedikotSay(r, 'reminders.bedikot_same');
    return;
  }
  r.input.data.app.reminders = { ...rem, bedikot: next };
  r.changed = true;
  bedikotSay(r, 'reminders.bedikot_changed');
}

/** DAYS: all seven, 1 and 7, or the numbers written in reply (asked again when they are not clean days). */
function askDays(r: Reply, key: 'reminders.days_ask' | 'reminders.days_bad'): void {
  r.say(key, { days: cleanDaysWords(r.input.data.app.reminders.bedikot.days) }).ask({}, 'days');
}

/**
 * The clean days written after CHOOSE DAYS: numbers from 1 to 7, apart or
 * together, with commas, "and" or a range ("1 2 7", "1,7", "127", "1-3").
 * Null for anything else.
 */
export function parseCleanDays(raw: string): number[] | null {
  let s = raw.toLowerCase().replace(/(\d)\s*-\s*(\d)/g, (_, a: string, b: string) => {
    const from = Number(a);
    const to = Number(b);
    return from <= to ? Array.from({ length: to - from + 1 }, (_, i) => String(from + i)).join(' ') : `${a}-${b}`;
  });
  s = s.replace(/\b(and|days?|clean)\b|[&,.;+\s]/g, '');
  if (!/^[1-7]+$/.test(s)) return null;
  const set = new Set([...s].map(Number));
  return [1, 2, 3, 4, 5, 6, 7].filter(d => set.has(d));
}

/** A clock time as written: "8:30 AM", "9am", "8.30", "13:00"; without AM or PM, as on a 24-hour clock. Null for anything else. */
export function parseClockTime(raw: string): { hour: number; minute: number } | null {
  const m = /^\s*(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(?:([ap])\.?\s*m\.?)?\s*$/i.exec(raw);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  if (minute > 59) return null;
  const half = m[3]?.toLowerCase();
  if (half) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (half === 'p' ? 12 : 0);
  } else if (hour > 23) return null;
  return { hour, minute };
}

/** "9:00 AM": a time of day as the texts write it. */
function clockWords(hour: number, minute: number): string {
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** The one text before Shabbat and Yom Tov: its time, which a time written in reply changes. */
function restEve(r: Reply): void {
  const t = r.input.data.app.reminders.restEve;
  r.say('reminders.rest_eve', { time: clockWords(t.hour, t.minute) }).ask({}, 'time');
}

function setRestEve(r: Reply, t: { hour: number; minute: number }): void {
  const rem = r.input.data.app.reminders;
  if (rem.restEve.hour !== t.hour || rem.restEve.minute !== t.minute) {
    r.input.data.app.reminders = { ...rem, restEve: { hour: t.hour, minute: t.minute } };
    r.changed = true;
  }
  r.say('reminders.rest_eve_changed', { time: clockWords(t.hour, t.minute) });
}

// ---------- phones ----------

function phoneList(r: Reply, numbers: readonly string[], only?: (n: string) => boolean): string {
  const names = ordinals(r, 'phones.list');
  return numbers
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => !only || only(n))
    .map(({ n, i }) => {
      const p = r.input.data.phones.find(x => x.number === n);
      const mine = n === r.input.from ? 'this phone, ' : '';
      return `${names[i]} ending ${lastFour(n)} (${mine}reminders ${p && canText(p) ? 'on' : 'off'})`;
    })
    .join('; ');
}

function phones(r: Reply): void {
  const numbers = r.input.data.phones.map(p => p.number);
  const offer = ['menu'];
  if (numbers.length < r.input.limits.maxPhones) offer.unshift('add');
  if (numbers.length > 1) offer.splice(offer.length - 1, 0, 'remove', 'leave');
  r.say('phones.list', { list: phoneList(r, numbers) }, offer).ask({ numbers });
}

function removeWhich(r: Reply, ctx: ChatContext): void {
  const numbers = ctx.numbers ?? r.input.data.phones.map(p => p.number);
  const others = numbers.map((n, i) => ({ n, i })).filter(({ n }) => n !== r.input.from && r.input.data.phones.some(p => p.number === n));
  if (others.length === 0) {
    phones(r);
    return;
  }
  const names = ordinals(r, 'phones.remove_which');
  const list = others.map(({ n, i }) => `${names[i]} ending ${lastFour(n)}`).join('; ');
  r.say('phones.remove_which', { list }, [...others.map(({ i }) => ORDINAL_IDS[i] as string), 'menu']).ask({ numbers: [...numbers] });
}

function ordinal(r: Reply, ctx: ChatContext, id: string): void {
  const i = (ORDINAL_IDS as readonly string[]).indexOf(id);
  if (ctx.ids) {
    const entry = ctx.ids[i];
    if (entry === undefined) notUnderstood(r);
    else eraseAsk(r, entry);
    return;
  }
  if (ctx.numbers) {
    const number = ctx.numbers[i];
    if (number === undefined) notUnderstood(r);
    else if (number === r.input.from) leave(r);
    else if (!r.input.data.phones.some(p => p.number === number)) r.say('phones.gone', { last4: lastFour(number) });
    else r.say('phones.remove_ask', { last4: lastFour(number) }).ask({ action: { type: 'remove_phone', number } });
    return;
  }
  notUnderstood(r);
}

/**
 * ADD, or ADD and the other phone's number: a code for the other phone to
 * text back as "JOIN <code>". Nothing is sent to that phone (it has not
 * texted in). The number, when given, is only checked against the phones
 * already on the account.
 */
function addPhone(r: Reply, rest: readonly string[]): void {
  const { data } = r.input;
  if (rest.length > 0) {
    let n = rest.join('').replace(/[\s().-]/g, '');
    if (/^\d{10}$/.test(n)) n = `+1${n}`;
    else if (/^1\d{10}$/.test(n)) n = `+${n}`;
    if (!/^\+[1-9]\d{7,14}$/.test(n)) {
      r.say('phones.add_format');
      return;
    }
    if (data.phones.some(p => p.number === n)) {
      r.say('phones.add_already', { last4: lastFour(n) });
      return;
    }
  }
  if (data.phones.length >= r.input.limits.maxPhones) {
    r.say('phones.add_full', { count: String(data.phones.length) });
    return;
  }
  const code = inviteCode(r.input.random);
  r.effects.push({ type: 'join_code', code, days: INVITE_DAYS, ifFailed: r.failed('phones.add_failed') });
  r.say('phones.add_code', { code, days: String(INVITE_DAYS) });
}

function leave(r: Reply): void {
  if (r.input.data.phones.length <= 1) {
    r.say('phones.last');
    return;
  }
  r.say('phones.leave_ask').ask({ action: { type: 'leave' } });
}

// ---------- calendar, terms ----------

function calendarUrl(r: Reply): string {
  return `${(r.input.origin ?? DEFAULT_ORIGIN).replace(/\/+$/, '')}/cal/${r.input.data.calendarLinkToken}.ics`;
}

function calendar(r: Reply, rest: readonly string[]): void {
  const words = new Set(rest.map(w => w.toLowerCase()));
  if (words.has('link') || words.has('show') || words.has('create')) return calendarLink(r);
  if (words.has('new')) return calendarAsk(r, 'new');
  if (words.has('off') || words.has('remove')) return calendarAsk(r, 'off');
  if (words.has('google')) {
    r.say('website.only');
    return;
  }
  r.say(r.input.data.calendarLinkToken ? 'calendar.has' : 'calendar.none');
}

function calendarLink(r: Reply): void {
  const data = r.input.data;
  if (!data.calendarLinkToken) {
    data.calendarLinkToken = r.input.random();
    r.changed = true;
  }
  r.say('calendar.link', { url: calendarUrl(r) });
}

function calendarAsk(r: Reply, which: 'new' | 'off'): void {
  if (!r.input.data.calendarLinkToken) {
    r.say('calendar.no_link');
    return;
  }
  r.say(which === 'new' ? 'calendar.new_ask' : 'calendar.off_ask').ask({ action: { type: which === 'new' ? 'calendar_new' : 'calendar_off' } });
}

function terms(r: Reply, rest: readonly string[]): void {
  const words = new Set(rest.map(w => w.toLowerCase()));
  if (words.has('hebrew')) return setTerms(r, 'he');
  if (words.has('english')) return setTerms(r, 'en');
  r.say('terms.show', { lang: r.input.data.app.terms === 'he' ? 'Hebrew' : 'English letters' });
}

function setTerms(r: Reply, lang: 'en' | 'he'): void {
  const app = r.input.data.app;
  const name = lang === 'he' ? 'Hebrew' : 'English letters';
  if (app.terms === lang) {
    r.say('terms.same', { lang: name });
    return;
  }
  app.terms = lang;
  r.input.data.sync.dirty = true;
  r.changed = true;
  r.say('terms.changed', { lang: name });
}

const DATE_NAMES: Record<DateStyle, string> = { hebrew: 'Hebrew', civil: 'civil', both: 'Hebrew and civil' };

function dates(r: Reply, rest: readonly string[]): void {
  const words = new Set(rest.map(w => w.toLowerCase()));
  if (words.has('hebrew')) return setDates(r, 'hebrew');
  if (words.has('civil')) return setDates(r, 'civil');
  if (words.has('both')) return setDates(r, 'both');
  r.say('dates.show', { dates: DATE_NAMES[r.input.data.app.dates] });
}

function setDates(r: Reply, style: DateStyle): void {
  const app = r.input.data.app;
  if (app.dates === style) {
    r.say('dates.same', { dates: DATE_NAMES[style] });
    return;
  }
  app.dates = style;
  r.input.data.sync.dirty = true;
  r.changed = true;
  // Today's date, written in full the new way.
  const today = dateWords(r).today ?? localAbs(r.input.now, 'UTC');
  r.say('dates.changed', { dates: DATE_NAMES[style], example: dayWords(today, { dates: style, lang: 'en' }) });
}

// ---------- YES and NO ----------

function confirmAnswer(r: Reply, ctx: ChatContext, id: 'yes' | 'no'): void {
  const action = ctx.action;
  if (!action) {
    notUnderstood(r);
    return;
  }
  if (id === 'no') {
    r.say('confirm.no');
    return;
  }
  const { data, from } = r.input;
  switch (action.type) {
    case 'erase': {
      if (!r.me.canUpdate) {
        r.say('refuse.read_only');
        return;
      }
      const stored = data.entries.find(e => e.entry.id === action.id);
      if (!stored) {
        r.say('history.gone');
        return;
      }
      const year = thisYear(r);
      removeEntry(data, action.id, r.input.now);
      r.changed = true;
      const after = compute(data, r.input.now);
      if (after) r.computed = after;
      r.say('history.erased', { entry: entryWithYear(r, stored.entry, year), status: statusBody(r, after) });
      return;
    }
    case 'remove_phone': {
      if (!data.phones.some(p => p.number === action.number)) {
        r.say('phones.gone', { last4: lastFour(action.number) });
        return;
      }
      r.effects.push({ type: 'remove_phone', number: action.number, ifFailed: r.failed('phones.remove_failed', { last4: lastFour(action.number) }) });
      r.say('phones.removed', { last4: lastFour(action.number) });
      return;
    }
    case 'leave': {
      if (data.phones.length <= 1) {
        r.say('phones.last');
        return;
      }
      r.effects.push({ type: 'leave', number: from, ifFailed: r.failed('phones.leave_failed') });
      r.say('phones.left');
      return;
    }
    case 'delete_account':
      r.effects.push({ type: 'delete_account', ifFailed: r.failed('delete.failed') });
      r.say('delete.done');
      return;
    case 'calendar_new':
      if (!data.calendarLinkToken) {
        r.say('calendar.no_link');
        return;
      }
      data.calendarLinkToken = r.input.random();
      r.changed = true;
      r.say('calendar.replaced', { url: calendarUrl(r) });
      return;
    case 'calendar_off':
      if (!data.calendarLinkToken) {
        r.say('calendar.no_link');
        return;
      }
      data.calendarLinkToken = null;
      r.changed = true;
      r.say('calendar.removed');
      return;
    case 'pause_vesatot':
      if (data.halachic.vesatot === 'paused') {
        r.say('vesatot.already_paused');
        return;
      }
      data.halachic.vesatot = 'paused';
      data.sync.dirty = true;
      r.changed = true;
      r.say('vesatot.paused');
      return;
    case 'place':
      setPlace(r, action.place, false);
      return;
  }
}

// ---------- dispatch ----------

function notUnderstood(r: Reply): void {
  r.say('not_understood');
}

/** A general action (also the main options and the menus), with the words written after it. */
function act(r: Reply, action: string, rest: readonly string[]): void {
  switch (action) {
    case 'period':
      return record(r, 'flow', rest);
    case 'stain':
      return record(r, 'stain', rest);
    case 'broken':
      return record(r, 'broken', rest);
    case 'hefsek':
      return record(r, 'hefsek', rest);
    case 'immersion':
      return record(r, 'mikvah', rest);
    case 'status':
      return status(r);
    case 'undo':
      return undo(r);
    case 'menu':
      r.say('menu.main');
      return;
    case 'more':
      r.say('menu.more');
      return;
    case 'entries':
      r.say('menu.entries');
      return;
    case 'settings':
      r.say('menu.settings');
      return;
    case 'account':
      r.say('menu.account');
      return;
    case 'history':
      return history(r);
    case 'location':
      return location(r, rest);
    case 'customs':
      return customsList(r, rest);
    case 'nightfall':
      return askCustom(r, NIGHTFALL_INDEX, false, false);
    case 'vesatot':
      return vesatot(r, rest);
    case 'reminders':
      return reminders(r, rest);
    case 'kinds':
      return kinds(r);
    case 'wording':
      return wording(r, rest);
    case 'phones':
      return phones(r);
    case 'add':
      return addPhone(r, rest);
    case 'leave':
      return leave(r);
    case 'calendar':
      return calendar(r, rest);
    case 'terms':
      return terms(r, rest);
    case 'dates':
      return dates(r, rest);
    case 'web':
      r.effects.push({ type: 'web_link', number: r.input.from, text: '', ifFailed: r.failed('web.failed') });
      r.say('web.link', { link: LINK_MARK });
      return;
    case 'setup':
      return startSetup(r, false);
    case 'delete':
      r.say('delete.ask').ask({ action: { type: 'delete_account' } });
      return;
    case 'join':
      r.say(rest.length === 0 ? 'join.already' : 'join.other_account');
      return;
    case 'website':
      r.say('website.only');
      return;
    default:
      notUnderstood(r);
  }
}

const CUSTOM_KEYS = new Set<string>(SMS_CUSTOMS.map(c => c.key));
const WHEN_IDS = new Set(['now', 'last_night', 'today_day', 'another_day', 'today', 'yesterday', 'tonight']);

/** An option of the last message was chosen. */
function choose(r: Reply, chat: ChatState, id: string, rest: readonly string[]): void {
  const ctx = chat.ctx;
  if (id === 'yes' || id === 'no') return confirmAnswer(r, ctx, id);
  if (id === 'keep' || /^v\d$/.test(id)) return customAnswer(r, ctx, id);
  if ((ORDINAL_IDS as readonly string[]).includes(id)) return ordinal(r, ctx, id);
  if (WHEN_IDS.has(id)) return whenChoice(r, id, ctx);
  if (id.startsWith('kind_')) return kindToggle(r, id);
  if (CUSTOM_KEYS.has(id) && chat.key.startsWith('customs.page')) return askCustom(r, SMS_CUSTOMS.findIndex(c => c.key === id), false, false);
  switch (id) {
    case 'next':
      r.say(chat.key === 'customs.page1' ? 'customs.page2' : 'customs.page3');
      return;
    case 'all':
      return askCustom(r, 0, true, false);
    case 'remove':
      return removeWhich(r, ctx);
    case 'done':
      return hefsekDone(r, ctx);
    case 'skip_place':
    case 'keep_place':
      return setupCustoms(r);
    case 'keep_customs':
    case 'customs_later':
      return setupRecent(r);
    case 'answer_customs':
      return askCustom(r, 0, true, true);
    case 'skip_recent':
    case 'not_yet':
      return finishSetup(r);
    case 'on':
      return remindersOn(r);
    case 'off':
      return remindersOff(r);
    case 'plain':
    case 'discreet':
      return setWording(r, id);
    case 'bedikot':
      return bedikot(r);
    case 'days_all':
      return setBedikot(r, { days: [1, 2, 3, 4, 5, 6, 7] });
    case 'days_1_7':
      return setBedikot(r, { days: [1, 7] });
    case 'days':
      return askDays(r, 'reminders.days_ask');
    case 'morning_on':
    case 'morning_off':
      return setBedikot(r, { morning: id === 'morning_on' });
    case 'sunset_on':
    case 'sunset_off':
      return setBedikot(r, { beforeSunset: id === 'sunset_on' });
    case 'rest_eve':
      return restEve(r);
    case 'hebrew':
      return setTerms(r, 'he');
    case 'english':
      return setTerms(r, 'en');
    case 'dates_hebrew':
      return setDates(r, 'hebrew');
    case 'dates_civil':
      return setDates(r, 'civil');
    case 'dates_both':
      return setDates(r, 'both');
    case 'create_link':
    case 'show_link':
      return calendarLink(r);
    case 'new_link':
      return calendarAsk(r, 'new');
    case 'remove_link':
      return calendarAsk(r, 'off');
  }
  act(r, id, rest);
}

/** General actions that belong with the options of a message: a reply naming one of them is still about the options. */
const KEY_FAMILY: Record<string, string[]> = {
  custom: ['customs', 'nightfall', 'vesatot'],
  customs: ['customs', 'nightfall', 'vesatot'],
  vesatot: ['vesatot'],
  reminders: ['reminders', 'kinds', 'wording'],
  reminder: ['hefsek', 'status'],
  calendar: ['calendar'],
  phones: ['phones', 'add', 'leave'],
  history: ['history'],
  terms: ['terms'],
  dates: ['dates'],
  delete: ['delete'],
  location: ['location'],
  setup: ['location', 'customs'],
};

function belongs(chat: ChatState, id: string): Set<string> {
  const own = new Set<string>([id]);
  const family: Record<string, string[]> = { more: ['menu'], entries: ['menu'], settings: ['menu'], account: ['menu'], remove: ['phones'] };
  for (const a of family[id] ?? []) own.add(a);
  for (const a of KEY_FAMILY[chat.key.split('.')[0] as string] ?? []) own.add(a);
  const kindAction = chat.ctx.kind ? KIND_ACTION[chat.ctx.kind] : null;
  if (kindAction) own.add(kindAction);
  return own;
}

/** Handles one text from a phone on an account. Never throws for any text or state. */
export function converse(input: ConverseInput): ConverseOutput {
  const me = input.data.phones.find(p => p.number === input.from);
  if (!me) return { chat: validChat(input.chat), out: [], effects: [], changed: false };
  const r = new Reply(input, me);
  let chat = validChat(input.chat);
  if (chat && (input.now - chat.at > CHAT_TTL_MS || chat.at - input.now > CHAT_TTL_MS)) chat = null;
  if (chat && chat.ctx.action && input.now - chat.at > CONFIRM_TTL_MS) chat = null;

  // RCS: a shared location.
  if (input.location) {
    const { latitude, longitude } = input.location;
    const place =
      Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? input.nearestPostal(latitude, longitude) : null;
    if (!place) r.say('location.none_near');
    else if (chat?.expect === 'zip') setPlace(r, place, chat.ctx.setup === true);
    else {
      const current = input.data.app.place;
      r.say('location.confirm', { place: foldToGsm(place.name), current: current ? foldToGsm(current.name) : 'none' }).ask({ action: { type: 'place', place } });
    }
    return r.done();
  }

  const raw = typeof input.text === 'string' ? input.text : '';
  if (raw.length > MAX_INPUT) {
    notUnderstood(r);
    return r.done();
  }
  if (raw.trim() === '?') {
    r.say('menu.main');
    return r.done();
  }
  const words = wordsOf(raw);
  // A digit alone is never a command (it may be the data asked for: a clean day, an hour).
  const numbersAsked = chat?.expect === 'days' || chat?.expect === 'time';
  if (words.length === 0 || (words.length === 1 && /^\d$/.test(words[0] as string) && !numbersAsked)) {
    notUnderstood(r);
    return r.done();
  }
  const lists = generalWords(r.texts);

  // The clean days, or the time, the last message asked for; numbers that are neither are asked for again.
  if (chat?.expect === 'days') {
    const days = parseCleanDays(raw);
    if (days) {
      setBedikot(r, { days });
      return r.done();
    }
    if (/\d/.test(raw)) {
      askDays(r, 'reminders.days_bad');
      return r.done();
    }
  }
  if (chat?.expect === 'time') {
    const t = parseClockTime(raw);
    if (t) {
      setRestEve(r, t);
      return r.done();
    }
    if (/\d/.test(raw)) {
      r.say('reminders.rest_eve_bad').ask({}, 'time');
      return r.done();
    }
  }

  // The free text the last message asked for.
  if (chat?.expect === 'zip') {
    const postal = postalOf(raw);
    if (postal !== null) {
      zipAnswer(r, chat.ctx.setup === true, postal);
      return r.done();
    }
  }
  if (chat?.expect === 'date' && chat.ctx.kind) {
    const kind = chat.ctx.kind;
    const own = KIND_ACTION[kind];
    const ownWords = new Set((own ? (lists[own] ?? []) : []).map(w => w.toLowerCase()));
    const tokens = raw.split(/\s+/).filter(t => !ownWords.has(t.toLowerCase().replace(/[^a-z]/g, '')));
    const others = generalActionsIn(raw, lists).filter(a => a !== own);
    if (others.length === 0 && tokens.length > 0 && readWhen(r, kind, tokens, chat.ctx) === 'done') return r.done();
  }

  // The options of the last message.
  if (chat) {
    const m = matchOption(raw, chat.opts, id => lists[id] ?? []);
    if (m === 'ambiguous') {
      notUnderstood(r);
      return r.done();
    }
    if (m) {
      const own = belongs(chat, m.id);
      const elsewhere = generalActionsIn(raw, lists).filter(a => !own.has(a));
      if (elsewhere.length === 0) {
        choose(r, chat, m.id, m.rest);
        return r.done();
      }
    }
  }

  // The general words.
  const g = matchGeneral(raw, lists);
  if (g && g !== 'ambiguous') {
    // "more" (one of the words for the main options) goes straight to the page MORE shows.
    act(r, g.id === 'menu' && words.includes('MORE') ? 'more' : g.id, g.rest);
    return r.done();
  }
  notUnderstood(r);
  return r.done();
}

/**
 * The first text to a phone that was just added: 'setup' after greet()
 * said "create" (the setup conversation starts with the location), or
 * 'joined' after it said "join".
 */
export function begin(input: BeginInput, mode: 'setup' | 'joined'): ConverseOutput {
  const me = input.data.phones.find(p => p.number === input.from);
  if (!me) return { chat: null, out: [], effects: [], changed: false };
  const r = new Reply(
    { data: input.data, chat: null, from: input.from, text: '', now: input.now, limits: { maxPhones: 0 }, lookupPostal: () => null, nearestPostal: () => null, random: () => '', texts: input.texts },
    me,
  );
  if (mode === 'setup') {
    startSetup(r, true);
  } else {
    const others = input.data.phones.filter(p => p.number !== input.from).map(p => lastFour(p.number));
    const with_ = others.length === 0 ? '' : ` with the phone${others.length > 1 ? 's' : ''} ending ${others.length > 1 ? `${others.slice(0, -1).join(', ')} and ${others[others.length - 1]}` : others[0]}`;
    r.say('setup.joined', { others: with_ });
  }
  return r.done();
}

/** The invitation word in "JOIN <word>", as typed; null for anything else (including JOIN alone). */
export function joinWord(text: string): string | null {
  if (typeof text !== 'string' || text.length > 100) return null;
  const m = /^\s*join\s+([A-Za-z0-9_-]{1,64})\s*[.!]?\s*$/i.exec(text);
  return m ? (m[1] as string) : null;
}

/**
 * A text from a number with no account.
 *
 * Sign-up open: JOIN creates the account; anything else gets one welcome
 * text naming the service and the compliance wording, with the option JOIN.
 * By invitation: JOIN <word> with a valid sign-up invitation creates it;
 * anything else gets one text saying so; a bad word gets one text.
 * Closed: nothing is sent (see docs/TEXTING.md for why).
 * In every mode, JOIN <code> with a valid invitation from an account
 * ('phone') adds this phone to that account.
 */
export function greet(input: GreetInput): GreetOutput {
  const texts = input.texts ?? NO_TEXTS;
  const reply = (key: string): GreetOutput => ({ action: 'reply', out: toOut(texts, [{ key }]) });
  const text = typeof input.text === 'string' && input.text.length <= 100 ? input.text : '';
  const word_ = joinWord(text);
  if (word_ !== null) {
    if (input.inviteValid === true && input.inviteKind === 'phone') return { action: 'join', out: [], invite: word_ };
    if (input.signup === 'closed') return { action: 'ignore', out: [], invite: word_ };
    if (input.inviteValid === true) return { action: 'create', out: [], invite: word_ };
    return { ...reply('signup.bad_word'), invite: word_ };
  }
  if (wordsOf(text).join(' ') === 'JOIN') {
    if (input.signup === 'open') return { action: 'create', out: [] };
    if (input.signup === 'invite') return reply('signup.invite');
    return { action: 'ignore', out: [] };
  }
  if (input.signup === 'open') return reply('signup.welcome');
  if (input.signup === 'invite') return reply('signup.invite');
  return { action: 'ignore', out: [] };
}

/** A text of the registry that the server sends on its own (a refusal, a test text), with its options. */
export function serverText(texts: SiteTexts | undefined, key: string, vars: Vars = {}): OutMessage {
  return toOut(texts ?? NO_TEXTS, [{ key, vars }])[0] as OutMessage;
}
