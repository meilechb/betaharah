/**
 * Thousands of random and adversarial texts against random states (random
 * options of any message of the registry, with any context). Each must
 * never throw, never produce a text that is not GSM-7 or is longer than two
 * segments, never produce more than two texts or more than six options, and
 * never change the entries unless the text names something to record, UNDO,
 * or answers a question that records or erases.
 */
import { describe, expect, it } from 'vitest';
import { converse, MESSAGES, validChat, type ChatContext, type ChatState } from '../src/app/chat';
import { isGsmBasic, MAX_TEXT_CHARS, repairs } from '../src/app/chat/gsm';
import { NO_TEXTS, optionsOf, wordsOf } from '../src/app/chat/site-texts';
import { household, lookupPostal, ME, nearestPostal, NOW, Phone, SPOUSE } from './chat-fixtures';

/** A small seeded generator, so that a failure can be repeated. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LABELS = [...new Set(MESSAGES.flatMap(m => m.options.map(o => o.label)))];
const WORDS = [
  ...LABELS,
  'period', 'flow', 'started', 'bleeding', 'hefsek', 'status', 'where', 'undo', 'menu', 'options', 'more', 'stain', 'broken', 'history', 'location',
  'zip', 'customs', 'all', 'nightfall', 'pause', 'resume', 'vesatot', 'reminders', 'on', 'off', 'kinds', 'wording', 'plain', 'discreet', 'times',
  'phones', 'add', 'remove', 'leave', 'calendar', 'link', 'new', 'terms', 'hebrew', 'english', 'web', 'setup', 'delete', 'account', 'password',
  'download', 'google', 'join', 'yes', 'no', 'keep', 'skip', 'done', 'now', 'today', 'tonight', 'last', 'night', 'day', 'yesterday', 'y', 'n',
  'd', '9pm', '6:40am', '21:30', 'nov', 'november', 'sept', '22', '2025', '2/29', '11/22', '12/3', '13/40', '08701', 'H3W', '1A1', '7325551234',
  '+17325551234', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'null', 'undefined', 'NaN', '{}', '[]', "'; DROP TABLE x;--", 'STOP', 'HELP',
];
const ODD = ['', ' ', '\n', '\t', '​', '\u{1F600}', 'שלום', 'éèê', '—', ' ', '１', '١', '?', '!', '.', ',', '/', ':', '-', '0', '00', '1', '11', '111'];

function pick<T>(r: () => number, list: readonly T[]): T {
  return list[Math.floor(r() * list.length)] as T;
}

function randomText(r: () => number): string {
  switch (Math.floor(r() * 10)) {
    case 0: // a digit with junk
      return `${pick(r, '0123456789?'.split(''))}${pick(r, ['', ' ', '  '])}${pick(r, [...WORDS, ...ODD])}`;
    case 1: // a word and a date, valid or not
      return `${pick(r, ['period', 'hefsek', 'stain', 'broken', 'flow', ''])} ${Math.floor(r() * 15)}/${Math.floor(r() * 35)}${r() < 0.3 ? `/${pick(r, ['24', '2025', '2026', '2030', '1999', '333'])}` : ''}${r() < 0.7 ? ` ${pick(r, ['day', 'night', 'd', 'n', '9pm', '11:59pm', '25:00', 'yesterday', ''])}` : ''}`;
    case 2: // a single letter or digit
      return pick(r, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split(''));
    case 3: // one to four words
      return Array.from({ length: 1 + Math.floor(r() * 4) }, () => pick(r, WORDS)).join(pick(r, [' ', '  ', ', ', '. ']));
    case 4: // very long
      return pick(r, WORDS).repeat(50 + Math.floor(r() * 400));
    case 5: // odd characters
      return Array.from({ length: Math.floor(r() * 6) }, () => pick(r, ODD)).join('');
    case 6: // random printable characters
      return Array.from({ length: Math.floor(r() * 30) }, () => String.fromCharCode(32 + Math.floor(r() * 95))).join('');
    case 7: // random code points, including surrogates and control characters
      return Array.from({ length: Math.floor(r() * 10) }, () => String.fromCharCode(Math.floor(r() * 0xffff))).join('');
    case 8: // an option label, as typed or tapped
      return pick(r, [pick(r, LABELS), pick(r, LABELS).toLowerCase(), ` ${pick(r, LABELS)}. `]);
    default: // ZIP-like
      return pick(r, ['08701', '11219', '99999', '0870', '08701-1234', 'h3w', 'H3W 1A1', 'zip 60645', 'location 90036', 'location', '123456']);
  }
}

function randomContext(r: () => number, ids: string[]): ChatContext {
  const ctx: ChatContext = {};
  if (r() < 0.2) ctx.setup = true;
  if (r() < 0.3) ctx.kind = pick(r, ['flow', 'stain', 'broken', 'hefsek', 'mikvah'] as const);
  if (r() < 0.2) ctx.day = 740_000 + Math.floor(r() * 700);
  if (r() < 0.2) ctx.ids = r() < 0.8 ? ids.slice(0, 5) : ['gone', 'nope'];
  if (r() < 0.2) ctx.numbers = r() < 0.8 ? [ME, SPOUSE] : ['+10000000000'];
  if (r() < 0.2) {
    ctx.index = Math.floor(r() * 12);
    ctx.walk = r() < 0.5;
  }
  if (r() < 0.3) {
    ctx.action = pick(r, [
      { type: 'erase', id: r() < 0.8 && ids[0] ? (pick(r, ids) as string) : 'gone' },
      { type: 'remove_phone', number: SPOUSE },
      { type: 'leave' },
      { type: 'delete_account' },
      { type: 'calendar_new' },
      { type: 'calendar_off' },
      { type: 'pause_vesatot' },
      { type: 'place', place: { name: 'Brooklyn, NY 11219', latitude: 40.63, longitude: -73.99, timeZone: 'America/New_York', elevation: 0, postal: '11219' } },
    ] as const);
  }
  return ctx;
}

function randomChat(r: () => number, ids: string[], now: number): ChatState | null {
  if (r() < 0.25) return null;
  if (r() < 0.05) return { v: 1, at: now, setup: false, q: { kind: 'zip' } } as unknown as ChatState;
  const def = pick(r, MESSAGES.filter(m => m.options.length > 0));
  const chat: ChatState = { v: 2, at: now - Math.floor(r() * 30 * 3_600_000), key: def.key, opts: optionsOf(NO_TEXTS, def.key), ctx: randomContext(r, ids) };
  if (r() < 0.3) chat.expect = pick(r, ['zip', 'date'] as const);
  return chat;
}

const RECORD_WORDS = new Set(['PERIOD', 'FLOW', 'STARTED', 'BLEEDING', 'HEFSEK', 'STAIN', 'BROKEN', 'UNDO']);
const RECORD_OPTIONS = new Set(['now', 'last_night', 'today_day', 'today', 'yesterday', 'tonight', 'done', 'period', 'hefsek', 'stain', 'broken', 'undo', 'yes']);

/** True if this text, in this state, may change the entries. */
function mayChangeEntries(text: string, chat: ChatState | null): boolean {
  if (wordsOf(text).some(w => RECORD_WORDS.has(w))) return true;
  const live = validChat(chat);
  if (!live) return false;
  if (live.expect === 'date') return true;
  return live.opts.some(([id]) => RECORD_OPTIONS.has(id));
}

describe('random and adversarial texts against random states', () => {
  it('never throw, never break the limits, never change entries unless asked to', () => {
    const r = rng(20261124);
    const RUNS = 6000;
    let changedEntries = 0;
    for (let run = 0; run < RUNS; run++) {
      const data = household({ place: r() < 0.85, spouse: r() < 0.5 });
      data.phones[0]!.canUpdate = r() < 0.9;
      if (r() < 0.3) data.phones[0]!.consentAt = 1;
      if (r() < 0.3) data.calendarLinkToken = 'existing';
      if (r() < 0.1) data.halachic.tzeit = { kind: 'minutes', value: 60 };
      if (data.app.place && r() < 0.7) {
        const seed = new Phone(data);
        seed.send(pick(r, ['period 11/1 day', 'period 10/20 night', 'stain 11/15 day']));
        if (r() < 0.6) seed.send('hefsek 11/6');
      }
      const ids = data.entries.map(e => e.entry.id);
      const now = NOW + Math.floor(r() * 3 * 86_400_000) - 86_400_000;
      const chat = randomChat(r, ids, now);
      const text = randomText(r);
      const location = r() < 0.03 ? { latitude: r() * 200 - 100, longitude: r() * 400 - 200 } : undefined;
      const entriesBefore = JSON.stringify(data.entries);

      const label = JSON.stringify({ run, text: text.slice(0, 80), chat });
      let out;
      try {
        out = converse({ data, chat, from: ME, text, location, now, limits: { maxPhones: 4 }, lookupPostal, nearestPostal, random: () => `r${run}abcdefgh` });
      } catch (e) {
        throw new Error(`threw on ${label}: ${String(e)}`);
      }
      expect(out.out.length, label).toBeLessThanOrEqual(2);
      for (const m of out.out) {
        expect(isGsmBasic(m.text), `${label} -> ${m.text}`).toBe(true);
        expect(m.text.length, `${label} -> ${m.text}`).toBeLessThanOrEqual(MAX_TEXT_CHARS);
        expect(m.body.length, label).toBeGreaterThan(0);
        expect(m.text, label).not.toMatch(/undefined|NaN|\[object|null/);
        // every text ends with its options
        expect(m.suggestions?.length ?? 0, label).toBeGreaterThan(0);
        expect(m.suggestions!.length).toBeLessThanOrEqual(6);
        expect(m.text.endsWith(`\nReply: ${m.suggestions!.map(s => s.label).join(', ')}`), m.text).toBe(true);
        for (const s of m.suggestions!) {
          expect(s.label.length).toBeLessThanOrEqual(20);
          expect(s.send).toBe(s.label);
        }
      }
      if (out.chat !== null) expect(validChat(out.chat), label).not.toBeNull();
      if (out.out.length === 0) expect(out.effects.map(e => e.type), label).toEqual(['web_link']);
      if (JSON.stringify(data.entries) !== entriesBefore) {
        changedEntries++;
        expect(mayChangeEntries(location ? '' : text, chat), `entries changed by ${label}`).toBe(true);
        expect(out.changed, label).toBe(true);
      }
      // Removing a phone, leaving and deleting happen only on YES to the question that asked.
      for (const e of out.effects) {
        if (e.type === 'remove_phone' || e.type === 'leave' || e.type === 'delete_account') {
          expect(validChat(chat)?.ctx.action?.type, label).toBe(e.type === 'delete_account' ? 'delete_account' : e.type === 'leave' ? 'leave' : 'remove_phone');
          expect(wordsOf(text), label).toContain('YES');
        }
      }
    }
    // The generator does reach the recording paths.
    expect(changedEntries).toBeGreaterThan(50);
    expect(repairs).toEqual({ folded: 0, shortened: 0 });
  });

  it('a digit alone is never a command and never answers anything, in any state', () => {
    const r = rng(7);
    for (let run = 0; run < 600; run++) {
      const data = household({ spouse: true });
      data.calendarLinkToken = 'existing';
      new Phone(data).send('period 11/1 day');
      const chat = randomChat(r, data.entries.map(e => e.entry.id), NOW);
      const before = JSON.stringify(data);
      const d = pick(r, ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ' 2 ', '9.']);
      const out = converse({ data, chat, from: ME, text: d, now: NOW, limits: { maxPhones: 4 }, lookupPostal, nearestPostal, random: () => 'tok' });
      const label = JSON.stringify({ chat, d });
      expect(JSON.stringify(data), label).toBe(before);
      expect(out.effects, label).toEqual([]);
      expect(out.out.map(m => m.body), label).toEqual(['Not understood; nothing was changed.']);
    }
  });
});
