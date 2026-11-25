/**
 * Dates in words, in one place. Every date written out for a person (the
 * status, Coming up, the Log, confirmations, calendar events, every text
 * message) is made here.
 *
 * A time is named first in everyday words: a weekday for a daytime
 * ("Tuesday", "Tue"; a Saturday is "Shabbat") and the weekday of the evening
 * for a night ("Monday night"). With today's date known, the nearest days
 * are "today", "tonight", "tomorrow", "tomorrow night", "yesterday" and
 * "last night", and anything else in the coming six days is its weekday
 * alone. Farther away, in the past, or with no "today" at all, the weekday
 * is followed by the date, as the household chooses:
 *
 *   hebrew  "Tue, 16 Kislev"           "Mon night, eve of 16 Kislev"
 *   civil   "Tue, Nov 26"              "Mon night, Nov 25"
 *   both    "Tue, Nov 26 (16 Kislev)"  "Mon night, Nov 25 (eve of 16 Kislev)"
 *
 * A night belongs to the Hebrew date that begins at its sunset: its civil
 * date is that of the evening, and its Hebrew date is the next one, said as
 * its eve. Only the wording is made here; what a date means is decided by
 * the calculation.
 */
import { absToCivil, dayOfWeek } from './civil';
import { hebrewDate, type TermLanguage } from './terms';

export type DateStyle = 'hebrew' | 'civil' | 'both';
export const DATE_STYLES: readonly DateStyle[] = ['hebrew', 'civil', 'both'];

export interface DateWords {
  /** Which date follows the weekday. */
  dates: DateStyle;
  /** The Hebrew date in English letters or in Hebrew script (texts always 'en'). */
  lang: TermLanguage;
  /** "Monday" rather than "Mon". */
  long?: boolean;
  /** The year with the date ("Nov 26, 2026", "16 Kislev 5787"). */
  year?: boolean;
  /**
   * Today's civil date (R.D.) where the words are read. Without it every
   * date is written in full.
   */
  today?: number;
  /**
   * With `today`: false where the words may be read on another day than
   * `today` (a reminder that may go out after midnight). Then the coming
   * days are named by weekday alone, never "today" or "tomorrow".
   */
  relative?: boolean;
}

const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** The days ahead (after tomorrow) that are named by weekday alone. */
export const WEEKDAY_ALONE_DAYS = 6;

function weekdayName(abs: number, w: DateWords): string {
  return ((w.long ? LONG_DAYS : SHORT_DAYS)[dayOfWeek(abs)]) as string;
}

/** "Nov 26", or "Nov 26, 2026". */
function civilText(abs: number, year: boolean): string {
  const c = absToCivil(abs);
  return `${MONTHS[c.m - 1]} ${c.d}${year ? `, ${c.y}` : ''}`;
}

/** The date part of a daytime: "16 Kislev", "Nov 26", "Nov 26 (16 Kislev)". */
export function dayDate(abs: number, w: DateWords): string {
  const hebrew = hebrewDate(abs, w.lang, w.year === true);
  const civil = civilText(abs, w.year === true);
  return w.dates === 'hebrew' ? hebrew : w.dates === 'civil' ? civil : `${civil} (${hebrew})`;
}

/** The date part of a night (`nightAbs`: its Hebrew date): "eve of 16 Kislev", "Nov 25", "Nov 25 (eve of 16 Kislev)". */
export function nightDate(nightAbs: number, w: DateWords): string {
  const hebrew = `eve of ${hebrewDate(nightAbs, w.lang, w.year === true)}`;
  const civil = civilText(nightAbs - 1, w.year === true);
  return w.dates === 'hebrew' ? hebrew : w.dates === 'civil' ? civil : `${civil} (${hebrew})`;
}

/** How far a civil date is from today, or null when it is written in full. */
function near(abs: number, w: DateWords): number | null {
  if (w.today === undefined) return null;
  const diff = abs - w.today;
  if (w.relative === false) return diff >= 0 && diff <= WEEKDAY_ALONE_DAYS ? diff : null;
  return diff >= -1 && diff <= WEEKDAY_ALONE_DAYS ? diff : null;
}

/**
 * The daytime of a civil date (which is also the daytime of the Hebrew date
 * of the same R.D. number): "today", "Tuesday", "Tue, 16 Kislev".
 */
export function dayWords(abs: number, w: DateWords): string {
  const shabbat = dayOfWeek(abs) === 6;
  const name = shabbat ? 'Shabbat' : weekdayName(abs, w);
  const diff = near(abs, w);
  if (diff !== null) {
    if (w.relative !== false && diff === 0) return 'today';
    if (w.relative !== false && diff === 1) return 'tomorrow';
    if (w.relative !== false && diff === -1) return 'yesterday';
    return name;
  }
  return `${name}, ${dayDate(abs, w)}`;
}

/**
 * A night, by the Hebrew date it belongs to (`nightAbs`), named by the
 * evening it begins: "tonight", "Monday night", "Mon night, eve of 16 Kislev".
 */
export function nightWords(nightAbs: number, w: DateWords): string {
  const evening = nightAbs - 1;
  const name = `${weekdayName(evening, w)} night`;
  const diff = near(evening, w);
  if (diff !== null) {
    if (w.relative !== false && diff === 0) return 'tonight';
    if (w.relative !== false && diff === 1) return 'tomorrow night';
    if (w.relative !== false && diff === -1) return 'last night';
    return name;
  }
  return `${name}, ${nightDate(nightAbs, w)}`;
}

/** An onah: its night or its daytime. `byDay` is added after a daytime, where day or night is the point (" by day"). */
export function onahWords(onah: { abs: number; part: 'night' | 'day' }, w: DateWords, byDay = ''): string {
  return onah.part === 'night' ? nightWords(onah.abs, w) : `${dayWords(onah.abs, w)}${byDay}`;
}

/**
 * The day of a moment with a clock time: its night when it is after sunset
 * (then its Hebrew date is the civil date's next day), else its civil day.
 * `hebrewAbs` is the Hebrew date of the moment, `civilAbs` its civil date.
 */
export function momentWords(civilAbs: number, hebrewAbs: number, w: DateWords): string {
  return hebrewAbs === civilAbs + 1 ? nightWords(hebrewAbs, w) : dayWords(civilAbs, w);
}
