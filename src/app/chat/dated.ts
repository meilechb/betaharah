/**
 * Record commands with a date, for entering past dates by text:
 *
 *   1 11/22 day      flow by day on Nov 22
 *   1 11/22 night    flow in the night that begins on the evening of Nov 22
 *   1 nov 22 9pm     flow at 9 pm on Nov 22 (the onah is worked out from the time)
 *   3 11/28 d        count broken (3) and stain (5) take the same forms as 1
 *   2 11/26          hefsek on Nov 26
 *   4 12/3           immersion on the evening of Dec 3
 *
 * The date is month/day (11/22, 11/22/26, 11/22/2026) or a month name and a
 * day (nov 22, november 22, nov 22 2025). Without a year it is the most
 * recent such date that is not after today. 1, 3 and 5 need day, night or a
 * time after the date; 2 and 4 take nothing more. "Night" means the night
 * that begins on the evening of that date, as on the dashboard's form
 * (dashboard.ts, draftFromForm).
 *
 * The existing parser (commands.ts) returns "unknown" for all of these, so
 * the two never compete for the same text.
 */
import { absToCivil, civilToAbs, localAbs, localToInstant } from '../../engine/civil';
import { englishDate } from '../../engine/present';
import { onahAt } from '../../engine/zmanim';
import { parseClock, type ResolvedOnah } from '../commands';
import { confirmationText, entryEnglish, recordEntry, rejectionText, whereOf, type Computed, type DraftEntry } from '../household';
import type { HouseholdData } from '../model';

export type DatedKind = 'flow' | 'stain' | 'broken' | 'hefsek' | 'mikvah';

export interface DateSpec {
  m: number;
  d: number;
  /** null when no year was given */
  y: number | null;
}

export type DatedWhen = { type: 'part'; part: 'day' | 'night' } | { type: 'time'; minutes: number } | null;

export type DatedParse =
  /** Not a dated command at all. */
  | { kind: 'none' }
  /** A dated command that is not fully understood; `text` is the reply. Nothing is changed. */
  | { kind: 'error'; text: string }
  | { kind: 'ok'; code: DatedKind; date: DateSpec; when: DatedWhen };

const CODES: Record<string, DatedKind> = { '1': 'flow', '2': 'hefsek', '3': 'broken', '4': 'mikvah', '5': 'stain' };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const NOT_CHANGED = 'Nothing was changed.';
const FORMAT = 'Write the month and day, e.g. 1 11/22 night.';

/** Reads a dated record command. Never throws. */
export function parseDated(text: string): DatedParse {
  const cleaned = text
    .toLowerCase()
    .replace(/[.,!]+/g, ' ')
    .replace(/(\d)\s+(am|pm)\b/g, '$1$2')
    .trim();
  if (cleaned.length > 60) return { kind: 'none' };
  const tokens = cleaned.split(/\s+/);
  const code = Object.hasOwn(CODES, tokens[0] ?? '') ? CODES[tokens[0] as string] : undefined;
  const first = tokens[1];
  if (!code || first === undefined) return { kind: 'none' };

  let date: DateSpec;
  let rest: string[];
  const numeric = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(first);
  if (numeric) {
    const y = numeric[3] === undefined ? null : numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    date = { m: Number(numeric[1]), d: Number(numeric[2]), y };
    rest = tokens.slice(2);
  } else if (Object.hasOwn(MONTHS, first)) {
    const day = tokens[2];
    if (day === undefined || !/^\d{1,2}$/.test(day)) return { kind: 'error', text: `Not understood: the day of the month is missing. ${FORMAT} ${NOT_CHANGED}` };
    date = { m: MONTHS[first] as number, d: Number(day), y: null };
    rest = tokens.slice(3);
    if (rest[0] !== undefined && /^\d{4}$/.test(rest[0])) {
      date.y = Number(rest[0]);
      rest = rest.slice(1);
    }
  } else if (/^\d{1,4}[/-]\d/.test(first)) {
    return { kind: 'error', text: `Not understood: ${FORMAT} ${NOT_CHANGED}` };
  } else {
    return { kind: 'none' };
  }

  if (date.m < 1 || date.m > 12 || date.d < 1 || date.d > (MAX_DAY[date.m - 1] as number)) {
    return { kind: 'error', text: `Not understood: there is no such date as ${date.m}/${date.d}. ${FORMAT} ${NOT_CHANGED}` };
  }
  if (date.y !== null && (date.y < 2000 || date.y > 2100)) {
    return { kind: 'error', text: `Not understood: the year ${date.y} is not possible here. ${NOT_CHANGED}` };
  }

  if (code === 'hefsek' || code === 'mikvah') {
    if (rest.length > 0) {
      const example = code === 'hefsek' ? '2 11/26' : '4 12/3 (the evening she immersed)';
      return { kind: 'error', text: `Not understood: after a date, ${code === 'hefsek' ? '2' : '4'} takes nothing more, e.g. ${example}. ${NOT_CHANGED}` };
    }
    return { kind: 'ok', code, date, when: null };
  }
  const needs = `Not understood: after the date add day, night (the night that begins that evening) or a time, e.g. ${tokens[0]} 11/22 night. ${NOT_CHANGED}`;
  if (rest.length !== 1) return { kind: 'error', text: needs };
  const word = rest[0] as string;
  if (word === 'day' || word === 'd') return { kind: 'ok', code, date, when: { type: 'part', part: 'day' } };
  if (word === 'night' || word === 'n') return { kind: 'ok', code, date, when: { type: 'part', part: 'night' } };
  const minutes = parseClock(word);
  if (minutes === null) return { kind: 'error', text: needs };
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

/** How far into the future a stated time may be (clock differences), as for undated commands. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

export interface DatedResult {
  text: string;
  changed: boolean;
  computed?: Computed;
}

/** The civil date and year shown for an entry. */
function shownAbs(e: DraftEntry): number {
  if ('onah' in e) return e.onah.part === 'day' ? e.onah.abs : e.onah.abs - 1;
  return e.kind === 'mikvah' ? e.abs - 1 : e.abs;
}

/** Turns a parsed dated command into an entry, as the dashboard's form does. */
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

/** Records a parsed dated command through recordEntry, with the existing wording plus the year. */
export function recordDated(data: HouseholdData, p: Extract<DatedParse, { kind: 'ok' }>, now: number): DatedResult {
  const where = whereOf(data);
  if (!where) return { text: NO_PLACE_RECORD, changed: false };
  const today = localAbs(now, where.place.timeZone);
  const date = resolveDate(p.date, today);
  if (!date.ok) {
    if (date.reason === 'future') return { text: rejectionText('future', null), changed: false };
    if (date.reason === 'none_recent') {
      return { text: `Not understood: there was no ${MONTH_NAMES[p.date.m - 1]} ${p.date.d} in the past year. Add the year, e.g. ${p.date.m}/${p.date.d}/2024. ${NOT_CHANGED}`, changed: false };
    }
    return { text: `Not understood: there is no such date. ${NOT_CHANGED}`, changed: false };
  }
  const made = draftFromDated(p, date.abs, data, now);
  if (!made.ok) return { text: made.reason === 'future' ? rejectionText('future', null) : NO_PLACE_RECORD, changed: false };
  const result = recordEntry(data, made.draft, 'sms', null, now);
  if (!result.ok) {
    // The date as it was read, so that a year taken as last year is never a surprise.
    const c = absToCivil(date.abs);
    return { text: `${rejectionText(result.reason, result.computed)} (Read as ${englishDate(date.abs)}, ${c.y}.)`, changed: false };
  }
  const shown = entryEnglish(result.entry);
  const year = absToCivil(shownAbs(made.draft)).y;
  const text = confirmationText(result, made.resolved).replace(`Recorded: ${shown}.`, `Recorded: ${shown}, ${year}.`);
  return { text, changed: true, computed: result.computed };
}

/** Replaces the existing "choose your location on the website" for a phone that can set it by text. */
export const NO_PLACE_RECORD = 'Not recorded: no location is set yet. Send LOCATION and your ZIP code, e.g. LOCATION 08701.';
