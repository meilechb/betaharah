/**
 * When something recorded by text happened, from the words written after
 * "period", "stain", "broken", "hefsek" or after a question "when?":
 *
 *   now, day, night, last night, tonight, yesterday day, yesterday night,
 *   or a clock time ("9pm", "9:30pm", "21:30", "yesterday 9pm")    a period, stain or broken count
 *   today, yesterday                                               a hefsek
 *   tonight, last night, yesterday                                 an immersion
 *
 * Nothing is guessed: words that are not understood give null, and the
 * question "when?" is asked with its options. Digits are never commands.
 */
import { absToCivil, localAbs, localToInstant } from '../engine/civil';
import type { Onah, OnahPart } from '../engine/onah';
import type { GeoPoint } from '../engine/sun';
import { dayTimes, onahAt, onahWindow, type ZmanimOptions } from '../engine/zmanim';

export type WhenSpec =
  | { type: 'now' }
  /** A clock time, in minutes after local midnight. */
  | { type: 'time'; minutes: number; yesterday: boolean }
  /** A whole onah. */
  | { type: 'onah'; part: OnahPart; yesterday: boolean };

/** "9pm", "9:30pm", "9:30 pm" (already joined), "21:30", "12am". Returns minutes after midnight, or null. */
export function parseClock(token: string): number | null {
  const twelve = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(token);
  if (twelve) {
    const h = Number(twelve[1]);
    const m = twelve[2] === undefined ? 0 : Number(twelve[2]);
    if (h < 1 || h > 12 || m > 59) return null;
    const hour = (h % 12) + (twelve[3] === 'pm' ? 12 : 0);
    return hour * 60 + m;
  }
  const twentyFour = /^(\d{1,2}):(\d{2})$/.exec(token);
  if (twentyFour) {
    const h = Number(twentyFour[1]);
    const m = Number(twentyFour[2]);
    if (h > 23 || m > 59) return null;
    return h * 60 + m;
  }
  return null;
}

/** Words that say nothing about when ("I got my period", "it began"). */
const FILLER = new Set(['i', 'my', 'it', 'the', 'a', 'got', 'has', 'have', 'had', 'just', 'was', 'is', 'began', 'begun', 'begin', 'did', 'done', 'please', 'by', 'at', 'on', 'today']);

/** The tokens as typed, lowercased, "9:30 pm" joined, without the filler words. */
export function whenTokens(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tokens) {
    const t = raw.toLowerCase().replace(/^[^a-z0-9:/]+|[^a-z0-9:/]+$/g, '');
    if (t === '') continue;
    const prev = out[out.length - 1];
    if ((t === 'am' || t === 'pm') && prev !== undefined && /\d$/.test(prev)) out[out.length - 1] = prev + t;
    else out.push(t);
  }
  return out.filter(t => !FILLER.has(t));
}

/** When a period, stain or broken count happened, from words without a date; null if not understood (or nothing said). */
export function parseOnahWords(tokens: readonly string[]): WhenSpec | null {
  const t = whenTokens(tokens);
  if (t.length === 0) return null;
  if (t.length === 1 && t[0] === 'now') return { type: 'now' };
  let yesterday = false;
  let part: OnahPart | null = null;
  let minutes: number | null = null;
  let last = false;
  for (const token of t) {
    if (token === 'yesterday' || token === 'y') {
      if (yesterday) return null;
      yesterday = true;
    } else if (token === 'last') {
      last = true;
    } else if (token === 'night' || token === 'n' || token === 'tonight') {
      if (part) return null;
      part = 'night';
    } else if (token === 'day' || token === 'd') {
      if (part) return null;
      part = 'day';
    } else {
      const clock = parseClock(token);
      if (clock === null || minutes !== null) return null;
      minutes = clock;
    }
  }
  // "last night" is the latest night; "last" with anything else says nothing.
  if (last && (part !== 'night' || yesterday)) return null;
  if (part && minutes !== null) return null; // one or the other
  if (minutes !== null) return { type: 'time', minutes, yesterday };
  if (part) return { type: 'onah', part, yesterday };
  return null; // "yesterday" alone does not say day or night
}

/** The day of a hefsek from words: "today" or "yesterday"; null otherwise. */
export function parseDayWords(tokens: readonly string[]): { yesterday: boolean } | null {
  const t = tokens.map(x => x.toLowerCase().replace(/[^a-z]/g, '')).filter(x => x !== '' && x !== 'it' && x !== 'was' && x !== 'done' && x !== 'did' && x !== 'i' && x !== 'please');
  if (t.length === 1 && t[0] === 'today') return { yesterday: false };
  if (t.length === 1 && t[0] === 'yesterday') return { yesterday: true };
  return null;
}

export interface ResolveContext {
  now: number;
  place: GeoPoint;
  zopts: ZmanimOptions;
  /** Within this many ms of sunrise or sunset, a time is reported as close to the line. */
  boundaryMarginMs: number;
}

export type ResolvedOnah =
  | { ok: true; onah: Onah; window: { start: number; end: number }; nearBoundary: { boundary: number; msAway: number } | null }
  | { ok: false; reason: 'future' };

/** How far into the future a stated time may be (clock differences). */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

function atInstant(ms: number, ctx: ResolveContext): ResolvedOnah {
  if (ms > ctx.now + FUTURE_TOLERANCE_MS) return { ok: false, reason: 'future' };
  const r = onahAt(ms, ctx.place, ctx.zopts);
  let nearBoundary: { boundary: number; msAway: number } | null = null;
  if (r.msFromBoundary < ctx.boundaryMarginMs) {
    const boundary = ms - r.window.start <= r.window.end - ms ? r.window.start : r.window.end;
    nearBoundary = { boundary, msAway: r.msFromBoundary };
  }
  return { ok: true, onah: r.onah, window: r.window, nearBoundary };
}

/** The onah a flow, stain or broken count is recorded in. */
export function resolveWhen(when: WhenSpec, ctx: ResolveContext): ResolvedOnah {
  const tz = ctx.place.timeZone;
  const today = localAbs(ctx.now, tz);
  if (when.type === 'now') return atInstant(ctx.now, ctx);

  if (when.type === 'time') {
    const at = (abs: number): number => {
      const c = absToCivil(abs);
      return localToInstant({ ...c, hh: Math.floor(when.minutes / 60), mi: when.minutes % 60, ss: 0 }, tz);
    };
    if (when.yesterday) return atInstant(at(today - 1), ctx);
    // A time later than now can only mean yesterday.
    const todayAt = at(today);
    return atInstant(todayAt > ctx.now + FUTURE_TOLERANCE_MS ? at(today - 1) : todayAt, ctx);
  }

  const current = onahAt(ctx.now, ctx.place, ctx.zopts).onah;
  let onah: Onah;
  if (when.yesterday) {
    // "yesterday day": the daytime of the civil date before today.
    // "yesterday night": the night that began on the evening of that date.
    onah = when.part === 'day' ? { abs: today - 1, part: 'day' } : { abs: today, part: 'night' };
  } else if (when.part === 'day') {
    // The current day onah, or the most recent one.
    onah = current.part === 'day' ? current : { abs: current.abs - 1, part: 'day' };
  } else {
    // The current night onah, or the one that ended this morning.
    onah = { abs: current.abs, part: 'night' };
  }
  const window = onahWindow(onah, ctx.place, ctx.zopts);
  if (window.start > ctx.now + FUTURE_TOLERANCE_MS) return { ok: false, reason: 'future' };
  return { ok: true, onah, window, nearBoundary: null };
}

/**
 * The day of a hefsek recorded now: today, or yesterday when the message
 * arrives after midnight and before sunrise.
 */
export function resolveHefsekDay(yesterday: boolean, ctx: ResolveContext): number {
  const today = localAbs(ctx.now, ctx.place.timeZone);
  const base = ctx.now < dayTimes(today, ctx.place, ctx.zopts).sunrise ? today - 1 : today;
  return yesterday ? base - 1 : base;
}

/**
 * The night of an immersion recorded now, as the Hebrew date the night
 * belongs to: tonight if it is night, otherwise last night.
 */
export function resolveMikvahNight(yesterday: boolean, ctx: ResolveContext): number {
  const current = onahAt(ctx.now, ctx.place, ctx.zopts).onah;
  return yesterday ? current.abs - 1 : current.abs;
}
