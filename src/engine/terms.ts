/**
 * Halachic terms in two forms: English letters, or Hebrew script.
 *
 * All sentences in the app are English. A term inside a sentence is written
 * as {key}, and is filled in with one form or the other according to the
 * household's setting.
 */
import { HDate, months } from '@hebcal/hdate';

export type TermLanguage = 'en' | 'he';

const TERMS = {
  niddah: ['niddah', 'נדה'],
  tehorah: ['tehorah', 'טהורה'],
  flow: ['flow', 'ראייה'],
  stain: ['stain', 'כתם'],
  hefsek: ['hefsek taharah', 'הפסק טהרה'],
  clean_days: ['seven clean days', 'שבעה נקיים'],
  clean_day: ['clean day', 'יום נקי'],
  bedikah: ['bedikah', 'בדיקה'],
  bedikot: ['bedikos', 'בדיקות'],
  mikvah_night: ['mikvah night', 'ליל טבילה'],
  immersion: ['immersion', 'טבילה'],
  onah: ['onah', 'עונה'],
  onot: ['onos', 'עונות'],
  veset_onah: ['onas havest', 'עונת הוסת'],
  onat_perishah: ['onas perishah', 'עונת פרישה'],
  veset: ['vest', 'וסת'],
  vesatot: ['vestos', 'וסתות'],
  onah_beinonit: ['onah beinonis', 'עונה בינונית'],
  veset_hachodesh: ['vest hachodesh', 'וסת החודש'],
  veset_haflagah: ['vest haflagah', 'וסת ההפלגה'],
  haflagah: ['haflagah', 'הפלגה'],
  or_zarua: ['Or Zarua', 'אור זרוע'],
  veset_kavua: ['vest kavua', 'וסת קבוע'],
  veset_hadilug: ['vest hadilug', 'וסת הדילוג'],
  full_day: ['full day', 'מעת לעת'],
  minchah_ketanah: ['minchah ketanah', 'מנחה קטנה'],
  sunset: ['sunset', 'שקיעה'],
  nightfall: ['nightfall', 'צאת הכוכבים'],
  yom_tov: ['Yom Tov', 'יום טוב'],
  shabbat: ['Shabbos', 'שבת'],
  yom_kippur: ['Yom Kippur', 'יום הכיפורים'],
  tisha_bav: ["Tisha B'Av", 'תשעה באב'],
  rav: ['rav', 'רב'],
} as const;

export type TermKey = keyof typeof TERMS;

export function term(key: TermKey, lang: TermLanguage): string {
  return TERMS[key][lang === 'he' ? 1 : 0];
}

/** Every term in one form, for the dashboard page to fill its own sentences. */
export function allTerms(lang: TermLanguage): Record<TermKey, string> {
  const out = {} as Record<TermKey, string>;
  for (const key of Object.keys(TERMS) as TermKey[]) out[key] = term(key, lang);
  return out;
}

/** Fills the {key} places in an English sentence. An unknown key is a programming error. */
export function fill(template: string, lang: TermLanguage): string {
  return template.replace(/\{([a-z_]+)\}/g, (_, key: string) => {
    if (!(key in TERMS)) throw new Error(`unknown term {${key}}`);
    return term(key as TermKey, lang);
  });
}

/** Capitalises the first letter, for a term that begins a sentence or a title. */
export function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const ENGLISH_MONTHS: Record<number, string> = {
  [months.NISAN]: 'Nisan',
  [months.IYYAR]: 'Iyar',
  [months.SIVAN]: 'Sivan',
  [months.TAMUZ]: 'Tammuz',
  [months.AV]: 'Av',
  [months.ELUL]: 'Elul',
  [months.TISHREI]: 'Tishrei',
  [months.CHESHVAN]: 'Cheshvan',
  [months.KISLEV]: 'Kislev',
  [months.TEVET]: 'Teves',
  [months.SHVAT]: 'Shvat',
};

/** "13 Kislev 5787", or "י״ג כסלו תשפ״ז". `abs` is the R.D. number of the Hebrew date's daytime. */
export function hebrewDate(abs: number, lang: TermLanguage, withYear = true): string {
  const hd = new HDate(abs);
  if (lang === 'he') return hd.renderGematriya(true, !withYear);
  const m = hd.getMonth();
  let name = ENGLISH_MONTHS[m];
  if (name === undefined) {
    if (m === months.ADAR_I) name = hd.isLeapYear() ? 'Adar I' : 'Adar';
    else if (m === months.ADAR_II) name = 'Adar II';
    else throw new Error(`unknown Hebrew month ${m}`);
  }
  return `${hd.getDate()} ${name}${withYear ? ` ${hd.getFullYear()}` : ''}`;
}

/** A day of the Hebrew month as a number: "30", or "ל׳". */
export function dayOfMonth(day: number, lang: TermLanguage): string {
  if (lang === 'en') return String(day);
  // use the calendar's own numerals
  return new HDate(day, months.TISHREI, 5787).renderGematriya(true, true).split(' ')[0] as string;
}
