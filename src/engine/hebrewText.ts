/**
 * The texts of calendar-app events written wholly in Hebrew.
 *
 * A calendar app lays a line out by its own rules, and a line that mixes
 * Hebrew and English words comes out scrambled. So for a household that
 * chose Hebrew terms, the events it sees in a calendar app have no English
 * words at all. Each line ends with a right-to-left mark, so that a number,
 * a bracket or a tick at its end stays at the end.
 */
import { dayOfWeek } from './civil';
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

const DAYS = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'שבת'] as const;

/** A daytime: "יום ה׳, ט״ז כסלו". `abs` is the R.D. number of the day. */
export function heDay(abs: number): string {
  return `${DAYS[dayOfWeek(abs)]}, ${hebrewDate(abs, 'he', false)}`;
}

/**
 * An evening, named by the civil day it falls on and by the Hebrew date that
 * begins with it: "יום ד׳ בערב, אור לכ״ה חשוון". `eveningAbs` is the R.D.
 * number of the civil day of the evening.
 */
export function heEvening(eveningAbs: number): string {
  const dow = dayOfWeek(eveningAbs);
  const when = dow === 6 ? 'מוצאי שבת' : dow === 5 ? 'ליל שבת' : `${DAYS[dow]} בערב`;
  return `${when}, אור ל${hebrewDate(eveningAbs + 1, 'he', false)}`;
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
