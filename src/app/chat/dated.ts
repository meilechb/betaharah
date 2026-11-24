/**
 * Entries with a date, for past dates by text. What is recorded comes from
 * the word or the question ("period", "hefsek", the date asked after
 * ANOTHER DAY); this module reads the date and what follows it:
 *
 *   Nov 22 day      by day on Nov 22                (period, stain, count broken)
 *   11/22 night     the night that begins on the evening of Nov 22
 *   nov 22 9pm      at 9 pm on Nov 22 (the onah is worked out from the time)
 *   11/26           hefsek on Nov 26
 *   12/3            immersion on the evening of Dec 3
 *
 * The date is month/day (11/22, 11/22/26, 11/22/2026) or a month name and a
 * day (nov 22, november 22, nov 22 2025). Without a year it is the most
 * recent such date that is not after today. A period, a stain or a broken
 * count needs day, night or a time after the date; a hefsek or an
 * immersion takes nothing more. "Night" means the night that begins on the
 * evening of that date, as on the dashboard's form (dashboard.ts,
 * draftFromForm).
 */
import { absToCivil, civilToAbs, localAbs, localToInstant } from '../../engine/civil';
import { englishDate } from '../../engine/present';
import { onahAt } from '../../engine/zmanim';
import { parseClock, type ResolvedOnah } from '../commands';
import { recordEntry, whereOf, type Computed, type DraftEntry, type RecordResult, type RejectReason } from '../household';
import type { HouseholdData } from '../model';
import type { RecordKind } from './types';

export type DatedKind = RecordKind;

export interface DateSpec {
  m: number;
  d: number;
  /** null when no year was given */
  y: number | null;
}

export type DatedWhen = { type: 'part'; part: 'day' | 'night' } | { type: 'time'; minutes: number } | null;

/** Why a written date was not understood: the message key, and its values. */
export type DateProblem = { key: 'date.form' } | { key: 'date.no_such'; vars: { date: string } } | { key: 'date.year'; vars: { year: string } } | { key: 'date.needs_onah' } | { key: 'date.nothing_more' };

export type DatedParse =
  /** Not a date at all. */
  | { kind: 'none' }
  /** A date that is not fully understood. Nothing is changed. */
  | { kind: 'error'; problem: DateProblem }
  | { kind: 'ok'; code: DatedKind; date: DateSpec; when: DatedWhen };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Whether a token begins a date: 11/22, 11-22, or a month name. */
export function looksLikeDate(token: string | undefined): boolean {
  if (token === undefined) return false;
  const t = token.toLowerCase();
  return /^\d{1,4}[/-]\d/.test(t) || Object.hasOwn(MONTHS, t);
}

/**
 * Reads a date and what follows it, for `code`. `tokens` are the words as
 * typed (lowercased), the date first. Never throws.
 */
export function parseDated(code: DatedKind, tokens: readonly string[]): DatedParse {
  const t = tokens.map(x => x.toLowerCase());
  // "9:30 pm" -> "9:30pm"
  const joined: string[] = [];
  for (const x of t) {
    const prev = joined[joined.length - 1];
    if ((x === 'am' || x === 'pm') && prev !== undefined && /\d$/.test(prev)) joined[joined.length - 1] = prev + x;
    else joined.push(x);
  }
  const first = joined[0];
  if (first === undefined || !looksLikeDate(first)) return { kind: 'none' };

  let date: DateSpec;
  let rest: string[];
  const numeric = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(first);
  if (numeric) {
    const y = numeric[3] === undefined ? null : numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    date = { m: Number(numeric[1]), d: Number(numeric[2]), y };
    rest = joined.slice(1);
  } else if (Object.hasOwn(MONTHS, first)) {
    const day = joined[1];
    if (day === undefined || !/^\d{1,2}$/.test(day)) return { kind: 'error', problem: { key: 'date.form' } };
    date = { m: MONTHS[first] as number, d: Number(day), y: null };
    rest = joined.slice(2);
    if (rest[0] !== undefined && /^\d{4}$/.test(rest[0])) {
      date.y = Number(rest[0]);
      rest = rest.slice(1);
    }
  } else {
    return { kind: 'error', problem: { key: 'date.form' } };
  }

  if (date.m < 1 || date.m > 12 || date.d < 1 || date.d > (MAX_DAY[date.m - 1] as number)) {
    return { kind: 'error', problem: { key: 'date.no_such', vars: { date: `${date.m}/${date.d}` } } };
  }
  if (date.y !== null && (date.y < 2000 || date.y > 2100)) return { kind: 'error', problem: { key: 'date.year', vars: { year: String(date.y) } } };

  if (code === 'hefsek' || code === 'mikvah') {
    if (rest.length > 0) return { kind: 'error', problem: { key: 'date.nothing_more' } };
    return { kind: 'ok', code, date, when: null };
  }
  const words = rest.filter(w => w !== 'by' && w !== 'at');
  if (words.length !== 1) return { kind: 'error', problem: { key: 'date.needs_onah' } };
  const word = words[0] as string;
  if (word === 'day' || word === 'd') return { kind: 'ok', code, date, when: { type: 'part', part: 'day' } };
  if (word === 'night' || word === 'n') return { kind: 'ok', code, date, when: { type: 'part', part: 'night' } };
  const minutes = parseClock(word);
  if (minutes === null) return { kind: 'error', problem: { key: 'date.needs_onah' } };
  return { kind: 'ok', code, date, when: { type: 'time', minutes } };
}

function validAbs(y: number, m: number, d: number): number | null {
  try {
    return civilToAbs({ y, m, d });
  } catch {
    return null;
  }
}

export type DateResolution = { ok: true; abs: number } | { ok: false; reason: 'future' | 'no_such_date' | 'none_recent' };

/**
 * The civil date meant. Without a year: this year's, or if that is after
 * today (or does not exist), last year's.
 */
export function resolveDate(date: DateSpec, today: number): DateResolution {
  if (date.y !== null) {
    const abs = validAbs(date.y, date.m, date.d);
    if (abs === null) return { ok: false, reason: 'no_such_date' };
    return abs > today ? { ok: false, reason: 'future' } : { ok: true, abs };
  }
  const year = absToCivil(today).y;
  for (const y of [year, year - 1]) {
    const abs = validAbs(y, date.m, date.d);
    if (abs !== null && abs <= today) return { ok: true, abs };
  }
  return { ok: false, reason: 'none_recent' };
}

/** How far into the future a stated time may be (clock differences), as for entries without a date. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/** Turns a parsed date into an entry, as the dashboard's form does. */
export function draftFromDated(
  p: Extract<DatedParse, { kind: 'ok' }>,
  abs: number,
  data: HouseholdData,
  now: number,
): { ok: true; draft: DraftEntry; resolved: ResolvedOnah | null } | { ok: false; reason: 'future' | 'no_place' } {
  const where = whereOf(data);
  if (!where) return { ok: false, reason: 'no_place' };
  if (p.code === 'hefsek') return { ok: true, draft: { kind: 'hefsek', abs }, resolved: null };
  if (p.code === 'mikvah') return { ok: true, draft: { kind: 'mikvah', abs: abs + 1 }, resolved: null };
  let onah: { abs: number; part: 'day' | 'night' };
  let resolved: ResolvedOnah | null = null;
  const when = p.when;
  if (when === null) throw new Error('a flow, stain or broken count needs day, night or a time');
  if (when.type === 'part') {
    onah = when.part === 'day' ? { abs, part: 'day' } : { abs: abs + 1, part: 'night' };
  } else {
    const c = absToCivil(abs);
    const ms = localToInstant({ ...c, hh: Math.floor(when.minutes / 60), mi: when.minutes % 60, ss: 0 }, where.place.timeZone);
    if (ms > now + FUTURE_TOLERANCE_MS) return { ok: false, reason: 'future' };
    const r = onahAt(ms, where.place, where.zopts);
    onah = r.onah;
    let nearBoundary: { boundary: number; msAway: number } | null = null;
    if (r.msFromBoundary < data.app.boundaryMarginMinutes * 60_000) {
      const boundary = ms - r.window.start <= r.window.end - ms ? r.window.start : r.window.end;
      nearBoundary = { boundary, msAway: r.msFromBoundary };
    }
    resolved = { ok: true, onah, window: r.window, nearBoundary };
  }
  const draft: DraftEntry = p.code === 'flow' ? { kind: 'flow', onah, veset: true } : { kind: p.code, onah };
  return { ok: true, draft, resolved };
}

export type DatedOutcome =
  | { ok: true; result: Extract<RecordResult, { ok: true }>; resolved: ResolvedOnah | null; year: number }
  /** Not recorded. `readAs`: the date as it was read, when it was read at all. */
  | { ok: false; reason: RejectReason; computed: Computed | null; readAs?: string }
  | { ok: false; reason: 'none_recent'; month: string; day: number; computed: null }
  | { ok: false; reason: 'no_such_date'; date: string; computed: null };

/** Records a parsed date through recordEntry. */
export function recordDated(data: HouseholdData, p: Extract<DatedParse, { kind: 'ok' }>, now: number): DatedOutcome {
  const where = whereOf(data);
  if (!where) return { ok: false, reason: 'no_place', computed: null };
  const today = localAbs(now, where.place.timeZone);
  const date = resolveDate(p.date, today);
  if (!date.ok) {
    if (date.reason === 'future') return { ok: false, reason: 'future', computed: null };
    if (date.reason === 'none_recent') return { ok: false, reason: 'none_recent', month: MONTH_NAMES[p.date.m - 1] as string, day: p.date.d, computed: null };
    return { ok: false, reason: 'no_such_date', date: `${p.date.m}/${p.date.d}/${p.date.y}`, computed: null };
  }
  const made = draftFromDated(p, date.abs, data, now);
  if (!made.ok) return { ok: false, reason: made.reason, computed: null };
  const result = recordEntry(data, made.draft, 'sms', null, now);
  // The date as it was read, so that a year taken as last year is never a surprise.
  if (!result.ok) return { ok: false, reason: result.reason, computed: result.computed, readAs: `${englishDate(date.abs)}, ${absToCivil(date.abs).y}` };
  const d = made.draft;
  const shown = 'onah' in d ? (d.onah.part === 'day' ? d.onah.abs : d.onah.abs - 1) : d.kind === 'mikvah' ? d.abs - 1 : d.abs;
  return { ok: true, result, resolved: made.resolved, year: absToCivil(shown).y };
}
