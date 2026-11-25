/**
 * The texts of calendar-app events written wholly in Hebrew.
 *
 * A calendar app lays a line out by its own rules, and a line that mixes
 * Hebrew and English words comes out scrambled. So for a household that
 * chose Hebrew terms, the events it sees in a calendar app have no English
 * words at all. Each line ends with a right-to-left mark, so that a number,
 * a bracket or a tick at its end stays at the end.
 */
import { absToCivil, dayOfWeek } from './civil';
import type { DateStyle } from './dates';
import { hebrewDate } from './terms';

export type CivilPart = 'night' | 'day';

const RLM = '\u200F';

/** A Hebrew line, kept right-to-left to its end. */
export function rtl(line: string): string {
  return line + RLM;
}

/** "יום" / "לילה", or "ביום" / "בלילה". */
export function hePart(part: CivilPart, by = false): string {
  return (by ? 'ב' : '') + (part === 'day' ? 'יום' : 'לילה');
}

/** A clock time with no English letters: "4:33" for "4:33 PM"; a time before noon says so. */
export function heClock(clock12: string): string {
  if (clock12.endsWith(' PM')) return clock12.slice(0, -3);
  if (clock12.endsWith(' AM')) return `${clock12.slice(0, -3)} לפני הצהריים`;
  return clock12;
}

/** A clock time for a line that names the part of the day: "6:50 בבוקר" for "6:50 AM", "4:36" for "4:36 PM". */
export function heTime(clock12: string): string {
  if (clock12.endsWith(' PM')) return clock12.slice(0, -3);
  if (!clock12.endsWith(' AM')) return clock12;
  const time = clock12.slice(0, -3);
  const hour = Number(time.split(':')[0]);
  return `${time} ${hour === 12 || hour < 4 ? 'בלילה' : 'בבוקר'}`;
}

const FULL_DAYS = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'] as const;

/**
 * An onah by the civil day it falls on, as people say it: "יום ראשון ביום",
 * "יום ראשון בלילה", "ליל שבת" (Friday night), "מוצאי שבת" (Saturday night).
 * `civilAbs` is the R.D. number of the civil day (for a night: of its evening).
 */
export function heOnahWhen(civilAbs: number, part: CivilPart): string {
  const dow = dayOfWeek(civilAbs);
  if (part === 'night') return dow === 6 ? 'מוצאי שבת' : dow === 5 ? 'ליל שבת' : `${FULL_DAYS[dow]} בלילה`;
  return `${FULL_DAYS[dow]} ביום`;
}

const DAYS = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'שבת'] as const;

const CIVIL_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'] as const;

/** A civil date in Hebrew words: "26 בנובמבר". */
function heCivil(abs: number): string {
  const c = absToCivil(abs);
  return `${c.d} ב${CIVIL_MONTHS[c.m - 1]}`;
}

/**
 * A daytime, with its date as the household chooses (src/engine/dates.ts),
 * wholly in Hebrew: "יום ה׳, ט״ז כסלו", "יום ה׳, 26 בנובמבר",
 * "יום ה׳, 26 בנובמבר (ט״ז כסלו)". `abs` is the R.D. number of the day.
 */
export function heDay(abs: number, dates: DateStyle = 'hebrew'): string {
  const hebrew = hebrewDate(abs, 'he', false);
  const date = dates === 'hebrew' ? hebrew : dates === 'civil' ? heCivil(abs) : `${heCivil(abs)} (${hebrew})`;
  return `${DAYS[dayOfWeek(abs)]}, ${date}`;
}

/**
 * An evening, named by the civil day it falls on and by the Hebrew date that
 * begins with it: "יום ד׳ בערב, אור לכ״ה חשוון". `eveningAbs` is the R.D.
 * number of the civil day of the evening.
 */
export function heEvening(eveningAbs: number, dates: DateStyle = 'hebrew'): string {
  const dow = dayOfWeek(eveningAbs);
  const when = dow === 6 ? 'מוצאי שבת' : dow === 5 ? 'ליל שבת' : `${DAYS[dow]} בערב`;
  const hebrew = `אור ל${hebrewDate(eveningAbs + 1, 'he', false)}`;
  const date = dates === 'hebrew' ? hebrew : dates === 'civil' ? heCivil(eveningAbs) : `${heCivil(eveningAbs)} (${hebrew})`;
  return `${when}, ${date}`;
}

export const HE = {
  separation: 'פרישה',
  separationAndBedikah: 'פרישה ובדיקה',
  onMikvahNight: 'חל בליל הטבילה',
  periodBegan: 'תחילת ראייה',
  niddahBegan: 'תחילת נדה',
  projectedSuffix: ' (משוער)',
  projectedNote: 'משוער: אם ההפסק טהרה ייעשה ביום הראשון האפשרי',
  hefsekEarly: 'לפני סוף ימי ההמתנה; שבעה נקיים מתחילים אחריהם',
  hefsekWhen: 'לפני השקיעה; עדיף אחרי מנחה קטנה',
  bedikahRequired: 'בדיקה ביום זה נדרשת',
  mikvahMoved: 'נדחה: אין טבילה בליל יום הכיפורים או תשעה באב',
  mikvahRestNight: 'ליל שבת או יום טוב: ההכנות מבעוד יום',
  mikvahAfterRest: 'מוצאי שבת או יום טוב',
  mikvahRestBefore: 'היום שלפניו שבת או יום טוב: ההכנות לפני כן',
  onOnatPerishah: 'חל בעונת פרישה',
} as const;
