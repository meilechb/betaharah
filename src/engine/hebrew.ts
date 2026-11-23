/**
 * Hebrew-calendar arithmetic used by the rules engine.
 *
 * A Hebrew date is identified by the R.D. day number of the civil date its
 * daytime falls on (the Hebrew date itself begins at the sunset before).
 */
import { HDate, abs2hebrew, daysInMonth, hebrew2abs, monthsInYear, months } from '@hebcal/hdate';
import { dayOfWeek } from './civil';

export interface HebrewDate {
  /** Hebrew year */
  yy: number;
  /** Month, Nisan = 1 ... Tishrei = 7; Adar I = 12, Adar II = 13 */
  mm: number;
  /** Day of month 1-30 */
  dd: number;
}

export function hebrewOfAbs(abs: number): HebrewDate {
  const { yy, mm, dd } = abs2hebrew(abs);
  return { yy, mm, dd };
}

export function absOfHebrew(h: HebrewDate): number {
  if (h.dd < 1 || h.dd > daysInMonth(h.mm, h.yy)) {
    throw new RangeError(`no such Hebrew date ${JSON.stringify(h)}`);
  }
  if (h.mm < 1 || h.mm > monthsInYear(h.yy)) {
    throw new RangeError(`no such Hebrew month ${JSON.stringify(h)}`);
  }
  return hebrew2abs(h.yy, h.mm, h.dd);
}

/** Year and month that follow the given Hebrew month. */
export function nextHebrewMonth(yy: number, mm: number): { yy: number; mm: number } {
  // Day after the last day of this month is the 1st of the next one.
  const firstOfNext = hebrew2abs(yy, mm, daysInMonth(mm, yy)) + 1;
  const n = abs2hebrew(firstOfNext);
  if (n.dd !== 1) throw new Error('calendar arithmetic error: expected the 1st of a month');
  return { yy: n.yy, mm: n.mm };
}

export function daysInHebrewMonth(yy: number, mm: number): number {
  return daysInMonth(mm, yy);
}

/** e.g. "י״ג כסלו תשפ״ז" */
export function formatHebrewDate(abs: number, withYear = true): string {
  return new HDate(abs).renderGematriya(true, !withYear);
}

const HEBREW_WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'] as const;

/** e.g. "יום שלישי" / "שבת" */
export function hebrewWeekday(abs: number): string {
  const name = HEBREW_WEEKDAYS[dayOfWeek(abs)];
  if (name === undefined) throw new Error('weekday out of range');
  return name === 'שבת' ? 'שבת' : `יום ${name}`;
}

export { months as HEBREW_MONTHS };
