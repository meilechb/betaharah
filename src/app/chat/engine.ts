/**
 * The text-message conversation: sign-up, setup and the whole account, by
 * SMS (and RCS) alone.
 *
 * Pure: no database, no network, no clock, no randomness of its own. The
 * server passes in the household, the pending question and what was typed,
 * and gets back the replies, the new pending question, and the things only
 * it can do (effects). docs/TEXTING.md is the reference for every text.
 *
 *   greet(input)     a text from a number with no account: reply, ignore,
 *                    create an account, or add the phone to an account.
 *   begin(input, m)  right after greet's "create" ('setup') or "join"
 *                    ('joined'): the first texts to the new phone.
 *   converse(input)  every text from a phone on an account.
 *   joinWord(text)   the invitation word in "JOIN <word>", for the server
 *                    to look up before calling greet.
 *
 * Rules the code keeps (and the tests check):
 *   1. Digits always mean the record commands (1 2 3 4 5 9 0 ? and their
 *      forms, with or without a date), at any moment, even with a question
 *      open. No question is ever answered by a digit: answers are letters,
 *      YES / NO, a ZIP code where one is asked for, or words.
 *   2. Nothing is guessed. A text not fully understood changes nothing, and
 *      the reply says so and what to send instead.
 *   3. Every change is confirmed by a reply that names it.
 *   4. GSM-7 only; at most 306 characters per text and 2 texts per message.
 *   5. A question closes 30 minutes after it was asked.
 *   6. STOP, START, HELP and the other carrier words never reach this code,
 *      and none is used as a command word.
 *   7. Erasing an entry, removing a phone, leaving, deleting the account,
 *      replacing or removing the calendar link and pausing vesatot each
 *      need YES.
 *   8. Nothing is ever sent to a number that has not texted in: ADD gives
 *      the person who asked a code, and the other phone texts JOIN and the
 *      code itself.
 */
import { localAbs, absToCivil } from '../../engine/civil';
import { statusText } from '../../engine/present';
import { HELP_TEXT, parseCommand } from '../commands';
import { compute, entryEnglish, removeEntry, runCommand, whereOf, type Computed } from '../household';
import { canText, lastFour, type HouseholdData } from '../model';
import { REMINDER_KINDS, type PhoneRecord } from '../settings';
import { applyOption, currentOption, LETTERS, NIGHTFALL_INDEX, sameValue, SMS_CUSTOMS, tzeitWords, VESATOT_INDEX } from './customs';
import { NO_PLACE_RECORD, parseDated, recordDated } from './dated';
import { foldToGsm, guard, MAX_TEXT_CHARS } from './gsm';
import * as T from './texts';
import type {
  BeginInput,
  ChatState,
  ConfirmAction,
  ConverseInput,
  ConverseOutput,
  Effect,
  GreetInput,
  GreetOutput,
  OutMessage,
  Place,
  Question,
  Suggestion,
} from './types';

/** A question closes this long after it was asked. */
export const CHAT_TTL_MS = 30 * 60_000;
/** Days a code for adding another phone stays valid. */
export const INVITE_DAYS = 7;
/** Texts longer than this are not read at all. */
const MAX_INPUT = 400;
const DEFAULT_ORIGIN = 'https://betaharah.com';

// ---------- small helpers ----------

/** Upper case, punctuation .,! removed, spaces collapsed: how command words and answers are read. */
export function normalize(text: string): string {
  return text.normalize('NFKC').replace(/[.,!]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
}

function lettersList(n: number): string {
  const l = LETTERS.slice(0, n).split('');
  return l.length <= 1 ? (l[0] ?? '') : `${l.slice(0, -1).join(', ')} or ${l[l.length - 1]}`;
}

function capitalFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "flow Sun Nov 22 night", with ", 2025" when not this year. */
function entryWithYear(e: Parameters<typeof entryEnglish>[0], thisYear: number): string {
  const abs = 'onah' in e ? (e.onah.part === 'day' ? e.onah.abs : e.onah.abs - 1) : e.kind === 'mikvah' ? e.abs - 1 : e.abs;
  const y = absToCivil(abs).y;
  return y === thisYear ? entryEnglish(e) : `${entryEnglish(e)}, ${y}`;
}

const ZIP_US = /^(\d{5})(?:-\d{4})?$/;
const ZIP_CA = /^([A-Z]\d[A-Z])(?: ?(\d[A-Z]\d))?$/;

/** The code to look up, from a typed ZIP or postal code; null if it is not in either form. */
export function postalOf(w: string): string | null {
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

/** Checks a stored pending question; anything malformed counts as none. */
export function validChat(x: unknown): ChatState | null {
  if (typeof x !== 'object' || x === null) return null;
  const c = x as Partial<ChatState>;
  if (c.v !== 1 || typeof c.at !== 'number' || !Number.isFinite(c.at) || typeof c.setup !== 'boolean') return null;
  const q = c.q as Question | undefined;
  if (typeof q !== 'object' || q === null) return null;
  const strings = (a: unknown): boolean => Array.isArray(a) && a.length <= 12 && a.every(s => typeof s === 'string');
  switch (q.kind) {
    case 'zip':
    case 'customs_intro':
    case 'customs_list':
    case 'kinds':
      return c as ChatState;
    case 'custom':
      return Number.isInteger(q.index) && q.index >= 0 && q.index < SMS_CUSTOMS.length && typeof q.walk === 'boolean' ? (c as ChatState) : null;
    case 'recent':
      return typeof q.recorded === 'boolean' ? (c as ChatState) : null;
    case 'history':
      return strings(q.ids) ? (c as ChatState) : null;
    case 'phones':
      return strings(q.numbers) ? (c as ChatState) : null;
    case 'confirm': {
      const a = q.action as ConfirmAction | undefined;
      if (typeof a !== 'object' || a === null) return null;
      switch (a.type) {
        case 'erase':
          return typeof a.id === 'string' ? (c as ChatState) : null;
        case 'remove_phone':
          return typeof a.number === 'string' ? (c as ChatState) : null;
        case 'place':
          return typeof a.place === 'object' && a.place !== null && typeof a.place.name === 'string' ? (c as ChatState) : null;
        case 'leave':
        case 'delete_account':
        case 'calendar_new':
        case 'calendar_off':
        case 'pause_vesatot':
          return c as ChatState;
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

// ---------- the reply being built ----------

class Reply {
  pieces: OutMessage[] = [];
  effects: Effect[] = [];
  changed = false;
  computed: Computed | undefined;
  chat: ChatState | null = null;

  constructor(readonly input: ConverseInput, readonly me: PhoneRecord) {}

  say(text: string, suggestions?: Suggestion[]): this {
    this.pieces.push(T.msg(text, suggestions));
    return this;
  }

  ask(q: Question, setup: boolean): this {
    this.chat = { v: 1, at: this.input.now, setup, q };
    return this;
  }

  done(): ConverseOutput {
    const out: ConverseOutput = { chat: this.chat, out: pack(this.pieces), effects: this.effects, changed: this.changed };
    if (this.computed) out.computed = this.computed;
    return out;
  }
}

/** Joins texts into as few messages as fit (never more than two). Suggestions stay on the last. */
export function pack(pieces: OutMessage[]): OutMessage[] {
  const out: OutMessage[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last && last.text.length + 1 + p.text.length <= MAX_TEXT_CHARS) {
      last.text = `${last.text} ${p.text}`;
      if (p.suggestions) last.suggestions = p.suggestions;
      else delete last.suggestions;
    } else {
      out.push({ ...p });
    }
  }
  while (out.length > 2) {
    const tail = out.pop() as OutMessage;
    const prev = out[out.length - 1] as OutMessage;
    prev.text = `${prev.text} ${tail.text}`;
    if (tail.suggestions) prev.suggestions = tail.suggestions;
  }
  return out.map(m => {
    const text = guard(m.text);
    const suggestions = m.suggestions?.slice(0, 4);
    return suggestions && suggestions.length > 0 ? { text, suggestions } : { text };
  });
}

// ---------- the questions ----------

function customText(index: number, data: HouseholdData): string {
  const c = SMS_CUSTOMS[index]!;
  const cur = currentOption(c, data.halachic);
  const opts = c.options.map((o, j) => `${LETTERS[j]}: ${o.text}.`).join(' ');
  const now = cur >= 0 ? `Now: ${LETTERS[cur]}.` : `Now: ${tzeitWords(data.halachic.tzeit)} (set on the website).`;
  return `Custom ${index + 1} of 12: ${c.question} ${opts}${c.note ? ` ${c.note}` : ''} ${now} Reply ${lettersList(c.options.length)}, or KEEP.`;
}

function customSuggestions(index: number): Suggestion[] {
  const c = SMS_CUSTOMS[index]!;
  const s: Suggestion[] = c.options.map((o, j) => ({ label: `${LETTERS[j]}: ${o.short}`, send: LETTERS[j] as string }));
  if (s.length < 4) s.push({ label: 'Keep', send: 'KEEP' });
  return s;
}

function kindsText(me: PhoneRecord): string {
  const list = REMINDER_KINDS.map((k, i) => `${LETTERS[i]} ${T.KIND_NAMES[i]} (${me.reminders.includes(k) ? 'on' : 'off'})`).join(', ');
  return `Reminder kinds for this phone: ${list}. Reply the letters of the kinds you want, e.g. A D F, or ALL or NONE. The others turn off.`;
}

/** What to send to answer a question, in a few words. */
function hint(q: Question): string {
  switch (q.kind) {
    case 'zip':
      return 'reply with your ZIP code';
    case 'customs_intro':
      return 'reply A, B or C';
    case 'custom':
      return `reply ${lettersList(SMS_CUSTOMS[q.index]!.options.length)}, or KEEP`;
    case 'customs_list':
      return 'reply a letter from A to L';
    case 'recent':
      return q.recorded ? 'send 2 with a date, or DONE' : 'send 1 with a date, or SKIP';
    case 'history':
      return 'reply ERASE and a letter';
    case 'phones':
      return 'reply REMOVE and a letter';
    case 'kinds':
      return 'reply the letters you want, or ALL or NONE';
    case 'confirm':
      return 'reply YES or NO';
  }
}

function suggestionsFor(q: Question): Suggestion[] | undefined {
  switch (q.kind) {
    case 'customs_intro':
      return T.CUSTOMS_INTRO_SUGGEST;
    case 'custom':
      return customSuggestions(q.index);
    case 'recent':
      return q.recorded ? [{ label: 'Done', send: 'DONE' }] : [{ label: 'Skip', send: 'SKIP' }];
    case 'kinds':
      return [
        { label: 'All', send: 'ALL' },
        { label: 'None', send: 'NONE' },
      ];
    case 'confirm':
      return T.YES_NO;
    default:
      return undefined;
  }
}

/** The word that asks a closed question again. */
function againFor(chat: ChatState): string {
  if (chat.setup) return 'Send SETUP to start the setup again.';
  switch (chat.q.kind) {
    case 'zip':
      return 'Send LOCATION and your ZIP code to set it.';
    case 'custom':
    case 'customs_list':
      return chat.q.kind === 'custom' && chat.q.index === NIGHTFALL_INDEX && !chat.q.walk ? 'Send NIGHTFALL to see it again.' : 'Send CUSTOMS to start again.';
    case 'history':
      return 'Send HISTORY for the list again.';
    case 'phones':
      return 'Send PHONES for the list again.';
    case 'kinds':
      return 'Send KINDS to choose again.';
    default:
      return 'Send the word again if you still want it.';
  }
}

/** Whether a text would have answered this question (used only to explain that it closed). */
function looksLikeAnswer(q: Question, w: string): boolean {
  if (/^[A-L]$/.test(w) || ['YES', 'NO', 'KEEP', 'SKIP', 'DONE', 'ALL', 'NONE'].includes(w)) return true;
  if (q.kind === 'zip' && postalOf(w) !== null) return true;
  if (q.kind === 'history' && /^ERASE [A-Z]$/.test(w)) return true;
  if (q.kind === 'phones' && /^REMOVE [A-Z]$/.test(w)) return true;
  if (q.kind === 'kinds' && /^[A-F]( ?[A-F])*$/.test(w)) return true;
  return false;
}

// ---------- the steps of setup ----------

function askCustomsIntro(r: Reply): void {
  r.say(T.CUSTOMS_INTRO, T.CUSTOMS_INTRO_SUGGEST).ask({ kind: 'customs_intro' }, true);
}

function askRecent(r: Reply): void {
  r.say(T.RECENT_ASK, [{ label: 'Skip', send: 'SKIP' }]).ask({ kind: 'recent', recorded: false }, true);
}

function finishSetup(r: Reply): void {
  r.say(T.SETUP_DONE, T.MENU_SUGGEST);
  r.chat = null;
}

function askCustom(r: Reply, index: number, walk: boolean, setup: boolean): void {
  r.say(customText(index, r.input.data), customSuggestions(index)).ask({ kind: 'custom', index, walk }, setup);
}

function setPlace(r: Reply, place: Place, setup: boolean): void {
  r.input.data.app.place = { name: place.name, latitude: place.latitude, longitude: place.longitude, timeZone: place.timeZone, elevation: place.elevation };
  r.input.data.sync.dirty = true;
  r.changed = true;
  r.say(T.placeSet(foldToGsm(place.name)));
  if (setup) askCustomsIntro(r);
  else r.chat = null;
}

function startSetup(r: Reply): void {
  const place = r.input.data.app.place;
  r.say(place ? T.setupStartWithPlace(foldToGsm(place.name)) : T.SETUP_START, place ? [{ label: 'Keep', send: 'KEEP' }] : undefined).ask({ kind: 'zip' }, true);
}

// ---------- answers to the pending question ----------

/** Handles `w` as the answer to the pending question. Returns false if it is not an answer to it. */
function answer(r: Reply, chat: ChatState, w: string): boolean {
  const { data, now } = r.input;
  const q = chat.q;
  switch (q.kind) {
    case 'zip': {
      if (w === 'KEEP' && chat.setup && data.app.place) {
        askCustomsIntro(r);
        return true;
      }
      const postal = postalOf(w);
      if (postal === null) return false;
      const place = r.input.lookupPostal(postal);
      if (!place) {
        r.say(T.unknownZip(postal)).ask(q, chat.setup);
        return true;
      }
      setPlace(r, place, chat.setup);
      return true;
    }
    case 'customs_intro': {
      if (w === 'A') {
        r.say(T.CUSTOMS_KEPT);
        if (chat.setup) askRecent(r);
        return true;
      }
      if (w === 'B') {
        askCustom(r, 0, true, chat.setup);
        return true;
      }
      if (w === 'C') {
        r.say(T.CUSTOMS_LATER);
        if (chat.setup) askRecent(r);
        return true;
      }
      return false;
    }
    case 'custom': {
      const c = SMS_CUSTOMS[q.index]!;
      const cur = currentOption(c, data.halachic);
      let chosen: number;
      if (w === 'KEEP') chosen = -1;
      else if (/^[A-L]$/.test(w) && LETTERS.indexOf(w) < c.options.length) chosen = LETTERS.indexOf(w);
      else return false;
      const option = chosen >= 0 ? c.options[chosen]! : null;
      const same = option === null || (cur >= 0 && sameValue(c.options[cur]!.value, option.value));
      if (option && !same) {
        applyOption(data.halachic, c, option);
        data.sync.dirty = true;
        r.changed = true;
      }
      if (!q.walk) {
        if (option === null) r.say(T.KEPT_ONE);
        else if (same) r.say(`That is already the setting for ${c.name}; nothing was changed.`);
        else r.say(`Changed: ${c.name}: ${option.text}. The calendar follows what you selected.`);
        r.chat = null;
        return true;
      }
      const keptWords = cur >= 0 ? c.options[cur]!.short : 'as set on the website';
      r.say(option && !same ? `Saved: ${c.name}: ${option.short}.` : `Kept: ${c.name}: ${option ? option.short : keptWords}.`);
      if (q.index + 1 < SMS_CUSTOMS.length) {
        askCustom(r, q.index + 1, true, chat.setup);
      } else {
        data.halachicConfirmedAt = now;
        r.changed = true;
        r.say(T.CUSTOMS_ALL_DONE);
        if (chat.setup) askRecent(r);
        else r.chat = null;
      }
      return true;
    }
    case 'customs_list': {
      if (!/^[A-L]$/.test(w)) return false;
      askCustom(r, LETTERS.indexOf(w), false, false);
      return true;
    }
    case 'recent': {
      if (w === 'SKIP' || w === 'DONE') {
        finishSetup(r);
        return true;
      }
      return false;
    }
    case 'kinds': {
      let chosen: Set<number>;
      if (w === 'ALL') chosen = new Set(REMINDER_KINDS.map((_, i) => i));
      else if (w === 'NONE') chosen = new Set();
      else if (/^[A-F]( ?[A-F])*$/.test(w)) chosen = new Set(w.replace(/ /g, '').split('').map(l => LETTERS.indexOf(l)));
      else return false;
      const kinds = REMINDER_KINDS.filter((_, i) => chosen.has(i));
      const before = REMINDER_KINDS.filter(k => r.me.reminders.includes(k));
      if (kinds.join() === before.join()) {
        r.say('That is already the choice for this phone; nothing was changed.');
      } else {
        r.me.reminders = kinds;
        r.changed = true;
        const names = REMINDER_KINDS.map((k, i) => (chosen.has(i) ? T.KIND_NAMES[i] : null)).filter(Boolean);
        const tail = canText(r.me) ? '' : ' They are sent once you text REMINDERS ON.';
        r.say(kinds.length === 0 ? 'Changed: this phone gets no reminders of any kind. KINDS chooses again.' : `Changed: this phone gets reminders for: ${names.join(', ')}.${tail}`);
      }
      r.chat = null;
      return true;
    }
    case 'confirm': {
      if (w === 'NO') {
        r.say(T.NO_CHANGE);
        r.chat = null;
        return true;
      }
      if (w !== 'YES') return false;
      r.chat = null;
      confirm(r, q.action);
      return true;
    }
    case 'history':
    case 'phones':
      return false; // ERASE and REMOVE are read as command words, which look at the list
  }
}

function confirm(r: Reply, action: ConfirmAction): void {
  const { data, now, from } = r.input;
  switch (action.type) {
    case 'erase': {
      if (!r.me.canUpdate) {
        r.say(T.READ_ONLY);
        return;
      }
      const stored = data.entries.find(e => e.entry.id === action.id);
      if (!stored) {
        r.say(T.ENTRY_GONE);
        return;
      }
      const where = whereOf(data);
      const thisYear = where ? absToCivil(localAbs(now, where.place.timeZone)).y : absToCivil(localAbs(now, 'UTC')).y;
      removeEntry(data, action.id, now);
      r.changed = true;
      const after = compute(data, now);
      if (after) r.computed = after;
      r.say(`Erased: ${entryWithYear(stored.entry, thisYear)}.${after ? ` ${statusText(after.timeline, after.place.timeZone)}` : ''}`);
      return;
    }
    case 'remove_phone': {
      if (!data.phones.some(p => p.number === action.number)) {
        r.say(`The phone ending ${lastFour(action.number)} is no longer on the account. Nothing was changed.`);
        return;
      }
      r.effects.push({ type: 'remove_phone', number: action.number, ifFailed: T.removeFailed(lastFour(action.number)) });
      r.say(T.removed(lastFour(action.number)));
      return;
    }
    case 'leave': {
      if (data.phones.length <= 1) {
        r.say(T.LAST_PHONE);
        return;
      }
      r.effects.push({ type: 'leave', number: from, ifFailed: T.LEAVE_FAILED });
      r.say(T.LEFT);
      return;
    }
    case 'delete_account': {
      r.effects.push({ type: 'delete_account', ifFailed: T.DELETE_FAILED });
      r.say(T.DELETED);
      return;
    }
    case 'calendar_new': {
      if (!data.calendarLinkToken) {
        r.say(T.CALENDAR_NO_LINK);
        return;
      }
      data.calendarLinkToken = r.input.random();
      r.changed = true;
      r.say(T.calendarReplaced(calendarUrl(r)));
      return;
    }
    case 'calendar_off': {
      if (!data.calendarLinkToken) {
        r.say(T.CALENDAR_NO_LINK);
        return;
      }
      data.calendarLinkToken = null;
      r.changed = true;
      r.say(T.CALENDAR_OFF);
      return;
    }
    case 'pause_vesatot': {
      if (data.halachic.vesatot === 'paused') {
        r.say(T.VESATOT_ALREADY_PAUSED);
        return;
      }
      data.halachic.vesatot = 'paused';
      data.sync.dirty = true;
      r.changed = true;
      r.say(T.PAUSED);
      return;
    }
    case 'place': {
      setPlace(r, action.place, false);
      return;
    }
  }
}

function calendarUrl(r: Reply): string {
  return `${(r.input.origin ?? DEFAULT_ORIGIN).replace(/\/+$/, '')}/cal/${r.input.data.calendarLinkToken}.ics`;
}

// ---------- the record commands (digits) ----------

const RECORD_KINDS = new Set(['flow', 'stain', 'broken', 'hefsek', 'mikvah', 'undo']);

/** The digit commands, with or without a date. Always handled; never an answer to a question. */
function digits(r: Reply, raw: string): { recorded: boolean } {
  const { data, now } = r.input;
  const command = parseCommand(raw);
  if (command.kind === 'help') {
    r.say(`${HELP_TEXT} A date also works: 1 11/22 night, 2 11/26, 4 12/3. MENU lists the words.`);
    return { recorded: false };
  }
  if (command.kind !== 'unknown') {
    if (RECORD_KINDS.has(command.kind) && !r.me.canUpdate) {
      r.say(T.READ_ONLY);
      return { recorded: false };
    }
    if (!whereOf(data)) {
      r.say(command.kind === 'status' ? T.NO_PLACE_STATUS : NO_PLACE_RECORD);
      return { recorded: false };
    }
    const result = runCommand(data, raw, now);
    r.say(result.text);
    if (result.computed) r.computed = result.computed;
    if (result.changed) r.changed = true;
    return { recorded: result.changed && command.kind !== 'undo' };
  }
  const dated = parseDated(raw);
  if (dated.kind === 'error') {
    r.say(dated.text);
    return { recorded: false };
  }
  if (dated.kind === 'ok') {
    if (!r.me.canUpdate) {
      r.say(T.READ_ONLY);
      return { recorded: false };
    }
    const result = recordDated(data, dated, now);
    r.say(result.text);
    if (result.computed) r.computed = result.computed;
    if (result.changed) r.changed = true;
    return { recorded: result.changed };
  }
  if (ZIP_US.test(normalize(raw))) {
    r.say(T.ZIP_HINT);
    return { recorded: false };
  }
  r.say(`Not understood; nothing was changed. ${HELP_TEXT}`);
  return { recorded: false };
}

// ---------- command words ----------

function usage(r: Reply, text: string): void {
  r.say(`Not understood; nothing was changed. ${text}`);
}

function menu(r: Reply): void {
  r.say(T.MENU, T.MENU_SUGGEST);
}

function history(r: Reply): void {
  const { data, now } = r.input;
  if (data.entries.length === 0) {
    r.say(T.HISTORY_EMPTY);
    return;
  }
  const where = whereOf(data);
  const thisYear = absToCivil(localAbs(now, where ? where.place.timeZone : 'UTC')).y;
  const sorted = [...data.entries]
    .sort((a, b) => {
      const pa = 'onah' in a.entry ? a.entry.onah.abs : a.entry.abs;
      const pb = 'onah' in b.entry ? b.entry.onah.abs : b.entry.abs;
      return pb - pa || b.createdAt - a.createdAt;
    })
    .slice(0, 5);
  const list = sorted.map((e, i) => `${LETTERS[i]} ${entryWithYear(e.entry, thisYear)}`).join('. ');
  r.say(`Latest entries: ${list}. To erase one, reply ERASE and its letter, e.g. ERASE A.`).ask({ kind: 'history', ids: sorted.map(e => e.entry.id) }, false);
}

function erase(r: Reply, chat: ChatState | null, letter: string): void {
  if (!chat || chat.q.kind !== 'history') {
    r.say(T.ERASE_NEEDS_LIST);
    return;
  }
  const id = chat.q.ids[LETTERS.indexOf(letter)];
  if (LETTERS.indexOf(letter) < 0 || id === undefined) {
    r.say(`There is no entry ${letter} in the list. Nothing was changed. ${capitalFirst(hint(chat.q))}.`).ask(chat.q, false);
    return;
  }
  const stored = r.input.data.entries.find(e => e.entry.id === id);
  if (!stored) {
    r.say(T.ENTRY_GONE);
    return;
  }
  if (!r.me.canUpdate) {
    r.say(T.READ_ONLY);
    return;
  }
  const where = whereOf(r.input.data);
  const thisYear = absToCivil(localAbs(r.input.now, where ? where.place.timeZone : 'UTC')).y;
  r.say(`Erase ${entryWithYear(stored.entry, thisYear)}? Reply YES to erase it, NO to keep it.`, T.YES_NO).ask({ kind: 'confirm', action: { type: 'erase', id } }, false);
}

function location(r: Reply, arg: string): void {
  if (arg === '') {
    const place = r.input.data.app.place;
    r.say(place ? `Your location is ${foldToGsm(place.name)}. To change it, reply with the new ZIP code.` : T.ASK_ZIP).ask({ kind: 'zip' }, false);
    return;
  }
  const postal = postalOf(arg);
  if (postal === null) {
    usage(r, 'Write LOCATION and the ZIP code, e.g. LOCATION 08701, or a Canadian postal code.');
    return;
  }
  const place = r.input.lookupPostal(postal);
  if (!place) {
    r.say(T.unknownZip(postal)).ask({ kind: 'zip' }, false);
    return;
  }
  setPlace(r, place, false);
}

function customs(r: Reply, arg: string): void {
  if (arg === '') {
    r.say(T.CUSTOMS_LIST).ask({ kind: 'customs_list' }, false);
  } else if (arg === 'ALL') {
    askCustom(r, 0, true, false);
  } else {
    usage(r, 'Send CUSTOMS for the list, or CUSTOMS ALL to go through all 12.');
  }
}

function vesatot(r: Reply, verb: 'PAUSE' | 'RESUME'): void {
  const data = r.input.data;
  if (verb === 'PAUSE') {
    if (data.halachic.vesatot === 'paused') r.say(T.VESATOT_ALREADY_PAUSED);
    else r.say(T.PAUSE_ASK, T.YES_NO).ask({ kind: 'confirm', action: { type: 'pause_vesatot' } }, false);
    return;
  }
  if (data.halachic.vesatot === 'active') {
    r.say(T.VESATOT_ALREADY_ON);
    return;
  }
  const c = SMS_CUSTOMS[VESATOT_INDEX]!;
  applyOption(data.halachic, c, c.options[0]!);
  data.sync.dirty = true;
  r.changed = true;
  r.say(T.RESUMED);
}

function reminders(r: Reply, arg: string): void {
  const me = r.me;
  const on = canText(me);
  if (arg === '') {
    const style = r.input.data.app.reminders.style;
    r.say(
      `Reminders for this phone are ${on ? 'on' : 'off'}. ${on ? 'REMINDERS OFF turns them off' : 'REMINDERS ON turns them on'}. KINDS chooses which kinds (now ${me.reminders.length} of 6). WORDING PLAIN or WORDING DISCREET (now ${style}). Times are set on the website.`,
      [on ? { label: 'Reminders off', send: 'REMINDERS OFF' } : { label: 'Reminders on', send: 'REMINDERS ON' }, { label: 'Kinds', send: 'KINDS' }, { label: style === 'plain' ? 'Wording discreet' : 'Wording plain', send: style === 'plain' ? 'WORDING DISCREET' : 'WORDING PLAIN' }],
    );
    return;
  }
  if (arg === 'ON') {
    if (me.optedOut) {
      r.say(T.OPTED_OUT);
      return;
    }
    if (me.consentAt !== null && me.verifiedAt !== null) {
      r.say(T.REMINDERS_ALREADY_ON);
      return;
    }
    // Texting from the phone proves the number; turning reminders on by text is the consent.
    if (me.verifiedAt === null) me.verifiedAt = r.input.now;
    me.consentAt = r.input.now;
    r.changed = true;
    r.say(T.remindersOn(lastFour(me.number)));
    return;
  }
  if (arg === 'OFF') {
    if (me.consentAt === null) {
      r.say(T.REMINDERS_ALREADY_OFF);
      return;
    }
    me.consentAt = null;
    r.changed = true;
    r.say(T.REMINDERS_OFF);
    return;
  }
  if (arg === 'TIMES' || arg === 'TIME') {
    r.say(T.WEBSITE_TIMES);
    return;
  }
  if (arg === 'KINDS') {
    kinds(r);
    return;
  }
  usage(r, 'Send REMINDERS ON, REMINDERS OFF, KINDS, or WORDING.');
}

function kinds(r: Reply): void {
  r.say(kindsText(r.me), [
    { label: 'All', send: 'ALL' },
    { label: 'None', send: 'NONE' },
  ]).ask({ kind: 'kinds' }, false);
}

function wording(r: Reply, arg: string): void {
  const rem = r.input.data.app.reminders;
  if (arg === '') {
    r.say(`Reminder wording is ${rem.style}, for every phone on the account. WORDING PLAIN uses the full words; WORDING DISCREET uses short letters, such as H for hefsek.`, [
      { label: 'Wording plain', send: 'WORDING PLAIN' },
      { label: 'Wording discreet', send: 'WORDING DISCREET' },
    ]);
    return;
  }
  if (arg !== 'PLAIN' && arg !== 'DISCREET') {
    usage(r, 'Send WORDING PLAIN or WORDING DISCREET.');
    return;
  }
  const style = arg === 'PLAIN' ? 'plain' : 'discreet';
  if (rem.style === style) {
    r.say(T.wordingSame(style));
    return;
  }
  // A copy, so that a shared default object is never changed.
  r.input.data.app.reminders = { ...rem, style };
  r.changed = true;
  r.say(T.wordingChanged(style));
}

function phones(r: Reply): void {
  const { data, from } = r.input;
  const list = data.phones
    .map((p, i) => `${LETTERS[i]} ending ${lastFour(p.number)} (${p.number === from ? 'this phone, ' : ''}reminders ${canText(p) ? 'on' : 'off'})`)
    .join(', ');
  r.say(`Phones: ${list}. ADD gives a code to add a phone. REMOVE and a letter removes one. LEAVE takes this phone off.`).ask(
    { kind: 'phones', numbers: data.phones.map(p => p.number) },
    false,
  );
}

/**
 * ADD, or ADD and the other phone's number: a code for the other phone to
 * text back as "JOIN <code>". Nothing is sent to that phone (it has not
 * texted in), so nothing needs YES. The number, when given, is only checked
 * against the phones already on the account.
 */
function addPhone(r: Reply, arg: string): void {
  const { data } = r.input;
  if (arg !== '') {
    let n = arg.replace(/[\s().-]/g, '');
    if (/^\d{10}$/.test(n)) n = `+1${n}`;
    else if (/^1\d{10}$/.test(n)) n = `+${n}`;
    if (!/^\+[1-9]\d{7,14}$/.test(n)) {
      r.say(T.ADD_FORMAT);
      return;
    }
    if (data.phones.some(p => p.number === n)) {
      r.say(`The number ending ${lastFour(n)} is already on this account. Nothing was changed.`);
      return;
    }
  }
  if (data.phones.length >= r.input.limits.maxPhones) {
    r.say(`This account already has ${data.phones.length} phones, the most allowed. Send PHONES to remove one first. Nothing was changed.`);
    return;
  }
  const code = inviteCode(r.input.random);
  r.effects.push({ type: 'join_code', code, days: INVITE_DAYS, ifFailed: T.ADD_FAILED });
  r.say(T.addCode(code, INVITE_DAYS));
}

function removePhone(r: Reply, chat: ChatState | null, letter: string): void {
  if (!chat || chat.q.kind !== 'phones') {
    r.say(T.REMOVE_NEEDS_LIST);
    return;
  }
  const number = chat.q.numbers[LETTERS.indexOf(letter)];
  if (LETTERS.indexOf(letter) < 0 || number === undefined) {
    r.say(`There is no phone ${letter} in the list. Nothing was changed. ${capitalFirst(hint(chat.q))}.`).ask(chat.q, false);
    return;
  }
  if (number === r.input.from) {
    r.say(T.REMOVE_SELF);
    return;
  }
  if (!r.input.data.phones.some(p => p.number === number)) {
    r.say(`The phone ending ${lastFour(number)} is no longer on the account. Nothing was changed.`);
    return;
  }
  r.say(T.removeAsk(lastFour(number)), T.YES_NO).ask({ kind: 'confirm', action: { type: 'remove_phone', number } }, false);
}

function leave(r: Reply): void {
  if (r.input.data.phones.length <= 1) {
    r.say(T.LAST_PHONE);
    return;
  }
  r.say(T.LEAVE_ASK, T.YES_NO).ask({ kind: 'confirm', action: { type: 'leave' } }, false);
}

function calendar(r: Reply, arg: string): void {
  const data = r.input.data;
  if (arg === '') {
    r.say(data.calendarLinkToken ? T.CALENDAR_HAS : T.CALENDAR_NONE, data.calendarLinkToken ? undefined : [{ label: 'Calendar link', send: 'CALENDAR LINK' }]);
    return;
  }
  if (arg === 'LINK') {
    if (data.calendarLinkToken) {
      r.say(T.calendarShow(calendarUrl(r)));
      return;
    }
    data.calendarLinkToken = r.input.random();
    r.changed = true;
    r.say(T.calendarCreated(calendarUrl(r)));
    return;
  }
  if (arg === 'NEW' || arg === 'OFF') {
    if (!data.calendarLinkToken) {
      r.say(T.CALENDAR_NO_LINK);
      return;
    }
    r.say(arg === 'NEW' ? T.CALENDAR_NEW_ASK : T.CALENDAR_OFF_ASK, T.YES_NO).ask({ kind: 'confirm', action: { type: arg === 'NEW' ? 'calendar_new' : 'calendar_off' } }, false);
    return;
  }
  if (arg === 'GOOGLE') {
    r.say(T.WEBSITE_GOOGLE);
    return;
  }
  usage(r, 'Send CALENDAR LINK, CALENDAR NEW or CALENDAR OFF.');
}

function terms(r: Reply, arg: string): void {
  const app = r.input.data.app;
  if (arg === '') {
    r.say(T.termsNow(app.terms), [
      { label: 'Terms Hebrew', send: 'TERMS HEBREW' },
      { label: 'Terms English', send: 'TERMS ENGLISH' },
    ]);
    return;
  }
  const lang = arg === 'HEBREW' ? 'he' : arg === 'ENGLISH' ? 'en' : null;
  if (!lang) {
    usage(r, 'Send TERMS HEBREW or TERMS ENGLISH.');
    return;
  }
  if (app.terms === lang) {
    r.say(`The terms are already in ${lang === 'he' ? 'Hebrew' : 'English letters'}. Nothing was changed.`);
    return;
  }
  app.terms = lang;
  r.input.data.sync.dirty = true;
  r.changed = true;
  r.say(lang === 'he' ? T.TERMS_HE : T.TERMS_EN);
}

/**
 * The command words. Returns false if `w` is not one. A command word
 * closes any open question (and setup), except where it reads the list
 * the question showed (ERASE, REMOVE).
 */
function word(r: Reply, chat: ChatState | null, w: string): boolean {
  const [head = '', ...tail] = w.split(' ');
  const arg = tail.join(' ');
  const none = (fn: () => void): true => {
    if (arg !== '') usage(r, `${head} is sent on its own.`);
    else fn();
    return true;
  };
  switch (head) {
    case 'MENU':
      return none(() => menu(r));
    case 'HISTORY':
      return none(() => history(r));
    case 'ERASE':
      if (!/^[A-Z]$/.test(arg)) {
        usage(r, 'Write ERASE and the letter of the entry from HISTORY, e.g. ERASE A.');
        return true;
      }
      erase(r, chat, arg);
      return true;
    case 'LOCATION':
    case 'ZIP':
      location(r, arg);
      return true;
    case 'CUSTOMS':
    case 'CUSTOM':
      customs(r, arg);
      return true;
    case 'NIGHTFALL':
      return none(() => askCustom(r, NIGHTFALL_INDEX, false, false));
    case 'PAUSE':
    case 'RESUME':
      if (arg !== 'VESATOT') {
        usage(r, `Write ${head} VESATOT.`);
        return true;
      }
      vesatot(r, head);
      return true;
    case 'REMINDERS':
    case 'REMINDER':
      reminders(r, arg);
      return true;
    case 'KINDS':
      return none(() => kinds(r));
    case 'WORDING':
      wording(r, arg);
      return true;
    case 'TIMES':
      return none(() => r.say(T.WEBSITE_TIMES));
    case 'PHONES':
    case 'PHONE':
      return none(() => phones(r));
    case 'ADD':
      addPhone(r, arg);
      return true;
    case 'REMOVE':
      if (!/^[A-Z]$/.test(arg)) {
        usage(r, 'Write REMOVE and the letter of the phone from PHONES, e.g. REMOVE B.');
        return true;
      }
      removePhone(r, chat, arg);
      return true;
    case 'LEAVE':
      return none(() => leave(r));
    case 'CALENDAR':
      calendar(r, arg);
      return true;
    case 'TERMS':
      terms(r, arg);
      return true;
    case 'WEB':
      return none(() => {
        r.effects.push({ type: 'web_link', number: r.input.from, text: T.WEB_LINK_TEXT, ifFailed: T.WEB_FAILED });
      });
    case 'SETUP':
      return none(() => startSetup(r));
    case 'DELETE':
      if (arg !== 'ACCOUNT') {
        usage(r, 'To delete the account, write DELETE ACCOUNT. To erase one entry, send HISTORY.');
        return true;
      }
      r.say(T.DELETE_ASK, T.YES_NO).ask({ kind: 'confirm', action: { type: 'delete_account' } }, false);
      return true;
    case 'PASSWORD':
      return none(() => r.say(T.WEBSITE_PASSWORD));
    case 'DOWNLOAD':
    case 'EXPORT':
      return none(() => r.say(T.WEBSITE_DATA));
    case 'GOOGLE':
      return none(() => r.say(T.WEBSITE_GOOGLE));
    case 'JOIN':
      r.say(arg === '' ? T.ALREADY_JOINED : T.ALREADY_ON_ACCOUNT);
      return true;
    case 'YES':
    case 'NO':
    case 'KEEP':
    case 'SKIP':
    case 'DONE':
    case 'ALL':
    case 'NONE':
      // With a question open these are answers it did not accept; that is reported below.
      if (arg !== '' || chat) return false;
      r.say(T.NOTHING_PENDING);
      return true;
    default:
      return false;
  }
}

// ---------- the entry points ----------

/** Handles one text from a phone on an account. Never throws for any text or state. */
export function converse(input: ConverseInput): ConverseOutput {
  const me = input.data.phones.find(p => p.number === input.from);
  if (!me) return { chat: validChat(input.chat), out: [], effects: [], changed: false };
  const r = new Reply(input, me);
  let chat = validChat(input.chat);
  let closed: ChatState | null = null;
  if (chat && (input.now - chat.at > CHAT_TTL_MS || chat.at - input.now > CHAT_TTL_MS)) {
    closed = chat;
    chat = null;
  }
  // By default the question stays open; handlers that answer or replace it set r.chat.
  r.chat = chat;

  // RCS: a shared location.
  if (input.location) {
    const { latitude, longitude } = input.location;
    const place =
      Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? input.nearestPostal(latitude, longitude) : null;
    if (!place) r.say(T.NO_PLACE_NEAR);
    else if (chat && chat.q.kind === 'zip') setPlace(r, place, chat.setup);
    else {
      const current = input.data.app.place;
      r.say(`Set your location to ${foldToGsm(place.name)}? Reply YES to set it, NO to keep ${current ? foldToGsm(current.name) : 'it unset'}.`, T.YES_NO).ask(
        { kind: 'confirm', action: { type: 'place', place } },
        false,
      );
    }
    return r.done();
  }

  const raw = typeof input.text === 'string' ? input.text : '';
  if (raw.length > MAX_INPUT) {
    r.say(chat ? `Not understood; nothing was changed. ${capitalFirst(hint(chat.q))}.` : T.UNKNOWN, chat ? suggestionsFor(chat.q) : undefined);
    return r.done();
  }
  const w = normalize(raw);

  // A ZIP code answers a question that asks for one (it is never a record command).
  if (chat && chat.q.kind === 'zip' && postalOf(w) !== null) {
    answer(r, chat, w);
    return r.done();
  }

  // A ZIP code for a ZIP question that has closed.
  if (closed && closed.q.kind === 'zip' && postalOf(w) !== null) {
    r.say(T.expired(againFor(closed)));
    return r.done();
  }

  // Digits, and the two words that mean 9 and 0: record commands, at any moment.
  if (/^[0-9?]/.test(w) || w === 'STATUS' || w === 'UNDO') {
    const { recorded } = digits(r, w === 'STATUS' ? '9' : w === 'UNDO' ? '0' : raw);
    if (chat && chat.q.kind === 'confirm') {
      r.chat = null; // a yes-or-no question is closed by anything else
    } else if (chat && chat.q.kind === 'recent' && recorded && !chat.q.recorded) {
      r.say(T.RECENT_NEXT, [{ label: 'Done', send: 'DONE' }]).ask({ kind: 'recent', recorded: true }, chat.setup);
    } else if (chat) {
      r.say(`The question before is still open: ${hint(chat.q)}.`, suggestionsFor(chat.q)).ask(chat.q, chat.setup);
    }
    return r.done();
  }

  if (chat) {
    // An answer closes the question unless the handler asks again.
    r.chat = null;
    if (answer(r, chat, w)) return r.done();
    r.chat = chat;
  }

  if (closed && looksLikeAnswer(closed.q, w)) {
    r.say(T.expired(againFor(closed)));
    return r.done();
  }

  // A command word replaces any open question.
  const before = r.chat;
  r.chat = null;
  if (word(r, chat, w)) return r.done();
  r.chat = before;

  if (chat) {
    if (chat.q.kind === 'zip') r.say(T.NOT_A_ZIP);
    else r.say(`Not understood; nothing was changed. ${capitalFirst(hint(chat.q))}.`, suggestionsFor(chat.q));
    r.chat = { ...chat, at: input.now };
  } else {
    r.say(T.UNKNOWN);
  }
  return r.done();
}

/**
 * The first texts to a phone that was just added: 'setup' after greet()
 * said "create" (the setup conversation starts with the location), or
 * 'joined' after it said "join".
 */
export function begin(input: BeginInput, mode: 'setup' | 'joined'): ConverseOutput {
  const me = input.data.phones.find(p => p.number === input.from);
  if (!me) return { chat: null, out: [], effects: [], changed: false };
  const r = new Reply(
    { data: input.data, chat: null, from: input.from, text: '', now: input.now, limits: { maxPhones: 0 }, lookupPostal: () => null, nearestPostal: () => null, random: () => '' },
    me,
  );
  if (mode === 'setup') {
    startSetup(r);
  } else {
    const others = input.data.phones.filter(p => p.number !== input.from).map(p => lastFour(p.number));
    const with_ = others.length === 0 ? '' : ` with the phone${others.length > 1 ? 's' : ''} ending ${others.length > 1 ? `${others.slice(0, -1).join(', ')} and ${others[others.length - 1]}` : others[0]}`;
    r.say(T.joinedText(with_), T.MENU_SUGGEST);
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
 * text naming the service, JOIN, and the compliance wording.
 * By invitation: JOIN <word> with a valid sign-up invitation creates it;
 * anything else gets one text saying so; a bad word gets one text.
 * Closed: nothing is sent (see docs/TEXTING.md for why).
 * In every mode, JOIN <code> with a valid invitation from an account
 * ('phone') adds this phone to that account.
 */
export function greet(input: GreetInput): GreetOutput {
  const text = typeof input.text === 'string' && input.text.length <= 100 ? input.text : '';
  const w = normalize(text);
  const word_ = joinWord(text);
  if (word_ !== null) {
    if (input.inviteValid === true && input.inviteKind === 'phone') return { action: 'join', out: [], invite: word_ };
    if (input.signup === 'closed') return { action: 'ignore', out: [], invite: word_ };
    if (input.inviteValid === true) return { action: 'create', out: [], invite: word_ };
    return { action: 'reply', out: pack([T.msg(T.BAD_INVITATION)]), invite: word_ };
  }
  if (w === 'JOIN') {
    if (input.signup === 'open') return { action: 'create', out: [] };
    if (input.signup === 'invite') return { action: 'reply', out: pack([T.msg(T.WELCOME_INVITE)]) };
    return { action: 'ignore', out: [] };
  }
  if (input.signup === 'open') return { action: 'reply', out: pack([T.msg(T.WELCOME_OPEN, [{ label: 'Join', send: 'JOIN' }])]) };
  if (input.signup === 'invite') return { action: 'reply', out: pack([T.msg(T.WELCOME_INVITE)]) };
  return { action: 'ignore', out: [] };
}
