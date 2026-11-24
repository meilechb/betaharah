/**
 * Thousands of random and adversarial texts against random states. Each
 * must never throw, never produce a text that is not GSM-7 or is longer
 * than two segments, never produce more than two texts, and never change
 * the entries unless the text is a valid record, undo or erase command.
 */
import { describe, expect, it } from 'vitest';
import { converse, normalize, parseDated, validChat, type ChatState, type Question } from '../src/app/chat';
import { isGsmBasic, MAX_TEXT_CHARS, repairs } from '../src/app/chat/gsm';
import { parseCommand } from '../src/app/commands';
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

const WORDS = [
  'MENU', 'STATUS', 'HISTORY', 'UNDO', 'ERASE', 'LOCATION', 'ZIP', 'CUSTOMS', 'CUSTOM', 'ALL', 'NIGHTFALL', 'PAUSE', 'RESUME', 'VESATOT',
  'REMINDERS', 'REMINDER', 'ON', 'OFF', 'KINDS', 'WORDING', 'PLAIN', 'DISCREET', 'TIMES', 'PHONES', 'ADD', 'REMOVE', 'LEAVE', 'CALENDAR',
  'LINK', 'NEW', 'TERMS', 'HEBREW', 'ENGLISH', 'WEB', 'SETUP', 'DELETE', 'ACCOUNT', 'PASSWORD', 'DOWNLOAD', 'GOOGLE', 'JOIN', 'YES', 'NO',
  'KEEP', 'SKIP', 'DONE', 'NONE', 'A', 'B', 'C', 'D', 'E', 'F', 'L', 'Z', 'day', 'night', 'yesterday', 'y', 'n', 'd', '9pm', '6:40am',
  '21:30', 'nov', 'november', 'sept', '22', '2025', '2/29', '11/22', '12/3', '13/40', '08701', 'H3W', '1A1', '7325551234', '+17325551234',
  'constructor', '__proto__', 'toString', 'hasOwnProperty', 'null', 'undefined', 'NaN', '{}', '[]', "'; DROP TABLE x;--", 'STOP', 'HELP',
];
const ODD = ['', ' ', '\n', '\t', '​', '\u{1F600}', 'שלום', 'éèê', '—', ' ', '１', '١', '?', '!', '.', ',', '/', ':', '-', '0', '00', '1', '11', '111'];

function pick<T>(r: () => number, list: readonly T[]): T {
  return list[Math.floor(r() * list.length)] as T;
}

function randomText(r: () => number): string {
  const kind = Math.floor(r() * 12);
  switch (kind) {
    case 0: // a digit with junk
      return `${pick(r, '0123456789?'.split(''))}${pick(r, ['', ' ', '  '])}${pick(r, [...WORDS, ...ODD])}${r() < 0.5 ? ` ${pick(r, WORDS)}` : ''}`;
    case 1: // a dated form, valid or not
      return `${pick(r, '0123456789'.split(''))} ${Math.floor(r() * 15)}/${Math.floor(r() * 35)}${r() < 0.3 ? `/${pick(r, ['24', '2025', '2026', '2030', '1999', '333'])}` : ''}${r() < 0.7 ? ` ${pick(r, ['day', 'night', 'd', 'n', '9pm', '11:59pm', '25:00', 'yesterday', ''])}` : ''}`;
    case 2: // a single letter
      return pick(r, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split(''));
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
    case 8: // a valid digit command
      return pick(r, ['1', '2', '3', '4', '5', '9', '0', '1 night', '1 day', '5 yesterday day', '3 9pm', '2 yesterday', '4 y', '?', '1 11/22 night', '2 11/26', '4 12/3', '5 nov 20 day']);
    case 9: // a command word with wrong arguments
      return `${pick(r, WORDS)} ${pick(r, [...WORDS, ...ODD])} ${pick(r, ODD)}`;
    case 10: // case and spacing variants of answers
      return pick(r, ['yes', 'Yes.', ' YES ', 'no!', 'a', ' b ', 'Keep', 'skip', 'done.', 'all', 'none', 'a d f', 'ADF', 'erase a', 'remove b', 'ERASE Z']);
    default: // ZIP-like
      return pick(r, ['08701', '11219', '99999', '0870', '08701-1234', 'h3w', 'H3W 1A1', 'ZIP 60645', 'LOCATION 90036', 'LOCATION', '123456']);
  }
}

function randomQuestion(r: () => number, ids: string[]): Question {
  switch (Math.floor(r() * 9)) {
    case 0:
      return { kind: 'zip' };
    case 1:
      return { kind: 'customs_intro' };
    case 2:
      return { kind: 'custom', index: Math.floor(r() * 12), walk: r() < 0.5 };
    case 3:
      return { kind: 'customs_list' };
    case 4:
      return { kind: 'recent', recorded: r() < 0.5 };
    case 5:
      return { kind: 'history', ids: r() < 0.8 ? ids.slice(0, 5) : ['gone', 'nope'] };
    case 6:
      return { kind: 'phones', numbers: r() < 0.8 ? [ME, SPOUSE] : ['+10000000000'] };
    case 7:
      return { kind: 'kinds' };
    default: {
      const actions = [
        { type: 'erase', id: r() < 0.8 && ids[0] ? (pick(r, ids) as string) : 'gone' },
        { type: 'remove_phone', number: SPOUSE },
        { type: 'leave' },
        { type: 'delete_account' },
        { type: 'calendar_new' },
        { type: 'calendar_off' },
        { type: 'pause_vesatot' },
        { type: 'place', place: { name: 'Brooklyn, NY 11219', latitude: 40.63, longitude: -73.99, timeZone: 'America/New_York', elevation: 0, postal: '11219' } },
      ] as const;
      return { kind: 'confirm', action: pick(r, actions) };
    }
  }
}

const RECORDING = new Set(['flow', 'stain', 'broken', 'hefsek', 'mikvah', 'undo']);

/** True if this text, in this state, may change the entries. */
function mayChangeEntries(text: string, chat: ChatState | null, now: number): boolean {
  if (RECORDING.has(parseCommand(text).kind)) return true;
  if (parseDated(text).kind === 'ok') return true;
  const w = normalize(text);
  if (w === 'UNDO') return true;
  const live = validChat(chat);
  return w === 'YES' && live !== null && now - live.at <= 30 * 60_000 && live.q.kind === 'confirm' && live.q.action.type === 'erase';
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
        seed.send(pick(r, ['1 11/1 day', '1 10/20 night', '5 11/15 day']));
        if (r() < 0.6) seed.send('2 11/6');
      }
      const ids = data.entries.map(e => e.entry.id);
      const now = NOW + Math.floor(r() * 3 * 86_400_000) - 86_400_000;
      let chat: ChatState | null = null;
      if (r() < 0.6) chat = { v: 1, at: now - Math.floor(r() * 45 * 60_000), setup: r() < 0.3, q: randomQuestion(r, ids) };
      else if (r() < 0.05) chat = { v: 1, at: now, setup: false, q: { kind: 'nonsense' } } as unknown as ChatState;
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
        expect(m.text.length, label).toBeGreaterThan(0);
        expect(m.text, label).not.toMatch(/undefined|NaN|\[object|null/);
        for (const s of m.suggestions ?? []) expect(s.label.length).toBeLessThanOrEqual(20);
        expect((m.suggestions ?? []).length).toBeLessThanOrEqual(4);
      }
      if (out.chat !== null) expect(validChat(out.chat), label).not.toBeNull();
      if (out.out.length === 0) expect(out.effects.map(e => e.type), label).toEqual(['web_link']);
      const entriesAfter = JSON.stringify(data.entries);
      if (entriesAfter !== entriesBefore) {
        changedEntries++;
        expect(mayChangeEntries(location ? '' : text, chat, now), `entries changed by ${label}`).toBe(true);
        expect(out.changed, label).toBe(true);
      }
      // Only YES (to a question that asked for it), WEB or ADD lead to effects.
      for (const e of out.effects) {
        if (e.type === 'web_link') expect(normalize(text), label).toBe('WEB');
        else if (e.type === 'join_code') expect(normalize(text), label).toMatch(/^ADD\b/);
        else expect(normalize(text), label).toBe('YES');
      }
    }
    // The generator does reach the recording paths.
    expect(changedEntries).toBeGreaterThan(100);
    expect(repairs).toEqual({ folded: 0, shortened: 0 });
  });

  it('a bare digit never answers a question, in any state', () => {
    const r = rng(7);
    for (let run = 0; run < 600; run++) {
      const data = household({ spouse: true });
      data.calendarLinkToken = 'existing';
      new Phone(data).send('1 11/1 day');
      const q = randomQuestion(r, data.entries.map(e => e.entry.id));
      const chat: ChatState = { v: 1, at: NOW, setup: r() < 0.5, q };
      const settings = JSON.stringify({ h: data.halachic, app: data.app, phones: data.phones, cal: data.calendarLinkToken, c: data.halachicConfirmedAt });
      const d = pick(r, ['1', '2', '3', '4', '5', '9', '0', '?']);
      const out = converse({ data, chat, from: ME, text: d, now: NOW, limits: { maxPhones: 4 }, lookupPostal, nearestPostal, random: () => 'tok' });
      const label = JSON.stringify({ q, d });
      expect(JSON.stringify({ h: data.halachic, app: data.app, phones: data.phones, cal: data.calendarLinkToken, c: data.halachicConfirmedAt }), label).toBe(settings);
      expect(out.effects, label).toEqual([]);
      if (q.kind === 'confirm') expect(out.chat, label).toBeNull();
      else expect(out.chat?.q.kind, label).toBe(q.kind);
    }
  });
});
