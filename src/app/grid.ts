/**
 * The data for the dashboard's month calendar: for each civil day around
 * today its Hebrew date, whether it is Shabbat or Yom Tov, and its sunrise
 * and sunset; and the calendar events that touch those days. The page
 * cannot work these out itself.
 *
 * The events are always in words, with full descriptions, even when the
 * household's calendar style is discreet: the dashboard is seen only by the
 * signed-in household.
 */
import { buildCalendar, type CalendarEvent } from '../engine/calendar';
import type { DateStyle } from '../engine/dates';
import { absToCivil, localAbs, localToInstant, zoneOffsetMs, type CivilDate } from '../engine/civil';
import { daysInHebrewMonth, hebrewOfAbs } from '../engine/hebrew';
import { isRestDay } from '../engine/holidays';
import { sunriseMs, sunsetMs } from '../engine/sun';
import { dayOfMonth, hebrewDate, type TermLanguage } from '../engine/terms';
import type { Computed } from './household';

/** Days shown before and after today. */
export const GRID_DAYS_BEFORE = 62;
export const GRID_DAYS_AFTER = 124;

export interface GridDay {
  date: string;
  hebrewDay: string;
  hebrewMonth: string;
  /** The Hebrew year as a number (5787), for a Hebrew-month view. */
  hebrewYear: number;
  /** The Hebrew year as the household writes it: '5787', or 'תשפ״ז'. */
  hebrewYearText: string;
  /**
   * The Hebrew month, stable and unique: 'YYYY-MM' with the Hebrew year and
   * the month numbered as the calendar numbers it (Nisan = 01 ... Tishrei =
   * 07 ... Adar I = 12, Adar II = 13), e.g. '5787-09' for Kislev 5787. For
   * grouping days by Hebrew month; it does not sort in calendar order
   * (the year begins with Tishrei), so keep the days' order.
   */
  hebrewMonthId: string;
  monthStart: boolean;
  rest: boolean;
  sunrise: string;
  sunset: string;
}

export interface GridEvent {
  key: string;
  kind: CalendarEvent['kind'];
  title: string;
  description: string;
  projected: boolean;
  light: boolean;
  allDay: boolean;
  startDate: string;
  endDate: string;
  start: string | null;
  end: string | null;
}

export interface Grid {
  today: string;
  days: GridDay[];
  events: GridEvent[];
}

const MINUTE = 60_000;
const DAY = 86_400_000;

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));
const civilIso = (c: CivilDate): string => `${c.y}-${pad2(c.m)}-${pad2(c.d)}`;

/** 'YYYY-MM-DD' for an R.D. day number. */
export function isoDate(abs: number): string {
  return civilIso(absToCivil(abs));
}

const daysInCivilMonth = (y: number, m: number): number => (m === 2 ? (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31);

/** "7:01 AM" for each minute of the day, made once. */
let clockTexts: string[] | null = null;

/**
 * The same text as clock12(ms, timeZone, mode) in engine/present.ts,
 * without building a Date for each time: the month calendar asks for a few
 * hundred of them in one request.
 */
export function fastClock12(ms: number, timeZone: string, mode: 'floor' | 'ceil'): string {
  const t = (mode === 'floor' ? Math.floor(ms / MINUTE) : Math.ceil(ms / MINUTE)) * MINUTE;
  const local = Math.floor(t / 1000) * 1000 + zoneOffsetMs(t, timeZone);
  const minuteOfDay = Math.floor((((local % DAY) + DAY) % DAY) / MINUTE);
  if (!clockTexts) {
    clockTexts = [];
    for (let i = 0; i < 1440; i++) {
      const hh = Math.floor(i / 60);
      clockTexts.push(`${hh % 12 === 0 ? 12 : hh % 12}:${pad2(i % 60)} ${hh < 12 ? 'AM' : 'PM'}`);
    }
  }
  return clockTexts[minuteOfDay] as string;
}

const hebrewDays = new Map<number, string>();

/** The day of the Hebrew month in the household's form: '14', or 'י״ד'. */
function hebrewDayText(dd: number, lang: TermLanguage): string {
  if (lang === 'en') return String(dd);
  let s = hebrewDays.get(dd);
  if (s === undefined) {
    s = dayOfMonth(dd, 'he');
    hebrewDays.set(dd, s);
  }
  return s;
}

/** The name of the Hebrew month that the daytime of `abs` falls in, as hebrewDate writes it. */
function hebrewMonthText(abs: number, lang: TermLanguage): string {
  const text = hebrewDate(abs, lang, false); // "13 Kislev", "י״ג כסלו", "1 Adar II", "א׳ אדר ב׳"
  return text.slice(text.indexOf(' ') + 1);
}

/** The Hebrew year that the daytime of `abs` falls in, as hebrewDate writes it: '5787', or 'תשפ״ז'. */
function hebrewYearText(abs: number, lang: TermLanguage): string {
  const text = hebrewDate(abs, lang); // "13 Kislev 5787", "י״ג כסלו תשפ״ז"
  return text.slice(text.lastIndexOf(' ') + 1);
}

export interface GridOptions {
  lang: TermLanguage;
  dates: DateStyle;
  style: 'words' | 'discreet';
  yomTov: 'diaspora' | 'israel';
  now: number;
}

/** The month calendar's data for a household with a location. */
export function buildGrid(computed: Computed, opts: GridOptions): Grid {
  const { place, zopts, timeline } = computed;
  const tz = place.timeZone;
  const { lang } = opts;
  const todayAbs = localAbs(opts.now, tz);
  const first = todayAbs - GRID_DAYS_BEFORE;
  const last = todayAbs + GRID_DAYS_AFTER;
  const sunOpts = { useElevation: zopts.useElevation };

  // The Hebrew date is worked out once and then counted forward; the
  // calendar is asked again only where a month ends.
  const days: GridDay[] = [];
  let h = hebrewOfAbs(first);
  let monthLength = daysInHebrewMonth(h.yy, h.mm);
  let monthName = hebrewMonthText(first, lang);
  let yearText = hebrewYearText(first, lang);
  // The civil date is counted forward in the same way.
  const civil = absToCivil(first);
  for (let abs = first; abs <= last; abs++) {
    if (abs > first) {
      if (h.dd < monthLength) {
        h = { yy: h.yy, mm: h.mm, dd: h.dd + 1 };
      } else {
        h = hebrewOfAbs(abs);
        monthLength = daysInHebrewMonth(h.yy, h.mm);
        monthName = hebrewMonthText(abs, lang);
        yearText = hebrewYearText(abs, lang);
      }
      if (civil.d < daysInCivilMonth(civil.y, civil.m)) civil.d++;
      else if (civil.m < 12) Object.assign(civil, { m: civil.m + 1, d: 1 });
      else Object.assign(civil, { y: civil.y + 1, m: 1, d: 1 });
    }
    const rise = sunriseMs(abs, place, sunOpts);
    const set = sunsetMs(abs, place, sunOpts);
    days.push({
      date: civilIso(civil),
      hebrewDay: hebrewDayText(h.dd, lang),
      hebrewMonth: monthName,
      hebrewYear: h.yy,
      hebrewYearText: yearText,
      hebrewMonthId: `${h.yy}-${pad2(h.mm)}`,
      monthStart: h.dd === 1,
      rest: isRestDay(abs, opts.yomTov),
      // Rounded as everywhere else: sunrise up, sunset down.
      sunrise: rise === null ? '' : fastClock12(rise, tz, 'ceil'),
      sunset: set === null ? '' : fastClock12(set, tz, 'floor'),
    });
  }

  const source = opts.style === 'words' ? computed.events : buildCalendar(timeline, { style: 'words', lang, timeZone: tz, dates: opts.dates });
  const placed: Array<{ at: number; event: GridEvent }> = [];
  for (const e of source) {
    let startAbs: number;
    let endAbs: number;
    let at: number;
    if (e.timed) {
      startAbs = localAbs(e.timed.start, tz);
      // The end is exclusive: an event that ends at midnight ends on the day before.
      endAbs = e.timed.end > e.timed.start ? localAbs(e.timed.end - 1, tz) : startAbs;
      at = e.timed.start;
    } else {
      const span = e.allDay!;
      startAbs = span.startAbs;
      endAbs = span.endAbsExclusive - 1;
      at = Number.NaN; // worked out below, only for the events that are kept
    }
    if (endAbs < first || startAbs > last) continue;
    if (!e.timed) at = localToInstant({ ...absToCivil(startAbs), hh: 0, mi: 0, ss: 0 }, tz);
    placed.push({
      at,
      event: {
        key: e.key,
        kind: e.kind,
        title: e.title,
        description: e.description,
        projected: e.projected,
        light: e.light === true,
        allDay: !e.timed,
        startDate: isoDate(startAbs),
        endDate: isoDate(endAbs),
        start: e.timed ? fastClock12(e.timed.start, tz, 'floor') : null,
        end: e.timed ? fastClock12(e.timed.end, tz, 'ceil') : null,
      },
    });
  }
  placed.sort((a, b) => a.at - b.at);

  return { today: isoDate(todayAbs), days, events: placed.map(p => p.event) };
}
