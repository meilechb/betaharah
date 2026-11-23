/**
 * Text-message commands.
 *
 *   1  a flow began            2  hefsek taharah done
 *   3  the count was broken    4  immersed
 *   5  a stain (niddah without a flow)
 *   9  status                  0  undo the last entry
 *
 * 1, 3 and 5 may be followed by when it happened: "yesterday", "day" or
 * "night", or a clock time ("9pm", "9:30pm", "21:30"). 2 and 4 may be
 * followed by "yesterday". Nothing is guessed: a message that is not
 * understood changes nothing.
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

export type ParsedCommand =
  | { kind: 'flow' | 'stain' | 'broken'; when: WhenSpec }
  | { kind: 'hefsek'; yesterday: boolean }
  | { kind: 'mikvah'; yesterday: boolean }
  | { kind: 'status' }
  | { kind: 'undo' }
  | { kind: 'help' }
  | { kind: 'unknown' };

const CODES: Record<string, 'flow' | 'hefsek' | 'broken' | 'mikvah' | 'stain' | 'status' | 'undo'> = {
  '1': 'flow',
  '2': 'hefsek',
  '3': 'broken',
  '4': 'mikvah',
  '5': 'stain',
  '9': 'status',
  '0': 'undo',
};

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

export function parseCommand(text: string): ParsedCommand {
  const cleaned = text
    .toLowerCase()
    .replace(/[.,!]+/g, ' ')
    // "9:30 pm" -> "9:30pm"
    .replace(/(\d)\s+(am|pm)\b/g, '$1$2')
    .trim();
  if (cleaned === '' ) return { kind: 'unknown' };
  if (cleaned === '?' || cleaned === 'help' || cleaned === 'info') return { kind: 'help' };
  const tokens = cleaned.split(/\s+/);
  const code = CODES[tokens[0] as string];
  if (!code) return { kind: 'unknown' };
  const rest = tokens.slice(1);

  if (code === 'status' || code === 'undo') {
    return rest.length === 0 ? { kind: code } : { kind: 'unknown' };
  }

  let yesterday = false;
  let part: OnahPart | null = null;
  let minutes: number | null = null;
  for (const token of rest) {
    if (token === 'yesterday' || token === 'y') {
      if (yesterday) return { kind: 'unknown' };
      yesterday = true;
    } else if (token === 'night' || token === 'n') {
      if (part) return { kind: 'unknown' };
      part = 'night';
    } else if (token === 'day' || token === 'd') {
      if (part) return { kind: 'unknown' };
      part = 'day';
    } else {
      const clock = parseClock(token);
      if (clock === null || minutes !== null) return { kind: 'unknown' };
      minutes = clock;
    }
  }

  if (code === 'hefsek' || code === 'mikvah') {
    if (part || minutes !== null) return { kind: 'unknown' };
    return { kind: code, yesterday };
  }
  if (part && minutes !== null) return { kind: 'unknown' }; // one or the other
  if (minutes !== null) return { kind: code, when: { type: 'time', minutes, yesterday } };
  if (part) return { kind: code, when: { type: 'onah', part, yesterday } };
  if (yesterday) return { kind: 'unknown' }; // "yesterday" alone does not say day or night
  return { kind: code, when: { type: 'now' } };
}

export const HELP_TEXT =
  '1 flow began, 2 hefsek done, 3 count broken, 4 mikvah, 5 stain, 9 status, 0 undo. After 1/3/5 you may add: day, night, yesterday day, or a time (9pm).';

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
