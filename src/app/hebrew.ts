/** Hebrew wording for the dashboard. */
import { gematriya } from '@hebcal/hdate';
import type { LogEntry, LogWarningCode } from '../engine/cycle';
import { formatHebrewDate, hebrewWeekday } from '../engine/hebrew';
import type { OnahPart } from '../engine/onah';
import type { PatternAlert } from '../engine/patterns';
import { clock24 } from '../engine/present';
import type { Timeline } from '../engine/timeline';
import type { VesatotNote } from '../engine/vesatot';

const partName = (p: OnahPart): string => (p === 'night' ? 'לילה' : 'יום');
const DAY_NAMES = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ז׳'] as const;

export function dateHebrew(abs: number): string {
  return `${hebrewWeekday(abs)}, ${formatHebrewDate(abs)}`;
}

export function entryHebrew(e: LogEntry): string {
  switch (e.kind) {
    case 'flow':
      return `ראייה: ${dateHebrew(e.onah.abs)}, עונת ה${partName(e.onah.part)}${e.veset ? '' : ' (אינה לחשבון הוסתות)'}`;
    case 'stain':
      return `כתם (תחילת איסור בלא ראייה): ${dateHebrew(e.onah.abs)}, עונת ה${partName(e.onah.part)}`;
    case 'broken':
      return `נפסלה הספירה: ${dateHebrew(e.onah.abs)}, עונת ה${partName(e.onah.part)}`;
    case 'hefsek':
      return `הפסק טהרה: ${dateHebrew(e.abs)}`;
    case 'mikvah':
      return `טבילה: ליל ${dateHebrew(e.abs)}`;
  }
}

export function statusHebrew(t: Timeline, timeZone: string): { headline: string; detail: string } {
  if (t.status.state === 'tehorah') return { headline: 'טהורה', detail: '' };
  const p = t.status.period;
  const phase = t.status.phase;
  const mikvah = `ליל טבילה: ליל ${dateHebrew(p.planMikvah.nightAbs)}, אחר ${clock24(p.planMikvah.tzeit, timeZone, 'ceil')}`;
  switch (phase.kind) {
    case 'before_hefsek':
      return {
        headline: 'נדה, קודם הפסק טהרה',
        detail: `תחילת האיסור: ${dateHebrew(p.start.abs)}. הפסק טהרה אפשרי מ${dateHebrew(p.earliestHefsekAbs)}. היום הקרוב: ${dateHebrew(p.planHefsekAbs)}, קודם ${clock24(p.hefsekSunset, timeZone, 'floor')}.`,
      };
    case 'before_first_day':
      return { headline: 'לאחר הפסק טהרה', detail: `היום הראשון לשבעה נקיים: ${dateHebrew(p.planCleanDays[0]!.abs)}. ${mikvah}.` };
    case 'counting':
      return { headline: `שבעה נקיים: יום ${DAY_NAMES[phase.day - 1]}`, detail: `${mikvah}.` };
    case 'postponed':
      return { headline: 'הספירה הושלמה; אין טובלים הלילה', detail: `${mikvah}.` };
    case 'mikvah_tonight':
      return { headline: 'ליל טבילה', detail: `הטבילה אחר צאת הכוכבים: ${clock24(p.planMikvah.tzeit, timeZone, 'ceil')}.` };
    case 'mikvah_not_recorded':
      return { headline: 'הספירה הושלמה; לא נרשמה טבילה', detail: `ליל הטבילה היה ליל ${dateHebrew(p.planMikvah.nightAbs)}.` };
  }
}

export function warningHebrew(code: LogWarningCode): string {
  switch (code) {
    case 'hefsek_without_niddah':
      return 'נרשם הפסק טהרה שלא בזמן איסור; לא נלקח בחשבון.';
    case 'hefsek_before_start':
      return 'נרשם הפסק טהרה קודם תחילת האיסור; לא נלקח בחשבון.';
    case 'hefsek_early':
      return 'הפסק הטהרה נעשה קודם שעברו ימי ההמתנה; שבעת הנקיים מתחילים רק לאחריהם. יש לשאול רב.';
    case 'broken_without_count':
      return 'נרשמה פסילת ספירה כשלא הייתה ספירה; לא נלקח בחשבון.';
    case 'mikvah_without_niddah':
      return 'נרשמה טבילה שלא בזמן איסור; לא נלקחה בחשבון.';
    case 'mikvah_without_hefsek':
      return 'נרשמה טבילה בלא הפסק טהרה; לא נלקחה בחשבון.';
    case 'mikvah_too_early':
      return 'נרשמה טבילה קודם שהושלמו שבעת הנקיים; לא נלקחה בחשבון.';
    case 'mikvah_on_fast_night':
      return 'נרשמה טבילה בליל יום הכיפורים או בליל תשעה באב.';
    case 'count_cancelled_by_flow':
      return 'ראייה לאחר הפסק הטהרה: הספירה בטלה ויש לעשות הפסק טהרה חדש.';
  }
}

export function patternHebrew(p: PatternAlert): string {
  const ask = 'יש לשאול רב.';
  switch (p.kind) {
    case 'kavua_chodesh':
      return `שלוש ראיות רצופות ב${gematriya(p.dayOfMonth)} בחודש, בעונת ה${partName(p.part)}. ייתכן שנקבע וסת החודש. ${ask}`;
    case 'kavua_haflagah':
      return `שלוש הפלגות שוות של ${p.days} ימים, בעונת ה${partName(p.part)}. ייתכן שנקבע וסת ההפלגה. ${ask}`;
    case 'dilug_haflagah':
      return `שלוש הפלגות המשתנות בדילוג שווה (${Math.abs(p.step)} ${Math.abs(p.step) === 1 ? 'יום' : 'ימים'}). ייתכן שנקבע וסת הדילוג. ${ask}`;
    case 'dilug_chodesh':
      return `שלוש ראיות שתאריכן בחודש משתנה בדילוג שווה (${Math.abs(p.step)} ${Math.abs(p.step) === 1 ? 'יום' : 'ימים'}). ייתכן שנקבע וסת הדילוג. ${ask}`;
  }
}

export function noteHebrew(n: VesatotNote): string {
  switch (n) {
    case 'paused':
      return 'חישוב הוסתות מושהה (ראה הגדרות).';
    case 'long_cycle_exempt':
      return 'אינה חוששת כעת לעונה בינונית ולוסת החודש: שלוש ראיות רצופות לאחר יום ל״א.';
    case 'haflagah_previous_hefsek_missing':
      return 'אי אפשר לחשב את וסת ההפלגה במניין עונות: לא נרשם הפסק טהרה בחודש הקודם.';
    case 'haflagah_awaits_hefsek':
      return 'וסת ההפלגה (במניין עונות) יחושב לאחר שיירשם הפסק הטהרה.';
  }
}
