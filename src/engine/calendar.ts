/**
 * Turns the timeline into calendar events.
 *
 * Sentences are English. Halachic terms are shown in English letters or in
 * Hebrew script, as the household chooses. A third style uses symbols only,
 * for a calendar that other people may see.
 */
import { absToCivil, dayOfWeek } from './civil';
import { dayWords, nightWords, type DateStyle } from './dates';
import { onahIndex } from './onah';
import { clock12, roundToMinute } from './present';
import { capital, dayOfMonth, fill, hebrewDate, term, type TermLanguage } from './terms';
import type { CivilPart } from './hebrewText';
import { HE, heClock, heDay, heEvening, heOnahWhen, hePart, heTime, rtl } from './hebrewText';
import type { OnahView, PeriodView, Timeline } from './timeline';
import type { BaseReason, VesetReason } from './vesatot';

const MINUTE = 60_000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbos'] as const;
/** The civil weekday of an evening: "the night of Shabbos" would be read as Friday night. */
const CIVIL_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "Thursday" */
export function weekday(abs: number): string {
  return WEEKDAYS[dayOfWeek(abs)] as string;
}

/** "Nov 26, 2026" */
export function civilDate(abs: number): string {
  const c = absToCivil(abs);
  return `${MONTHS[c.m - 1]} ${c.d}, ${c.y}`;
}

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** A date in running text: "Wed, Nov 25". */
export function shortDate(abs: number): string {
  const c = absToCivil(abs);
  return `${SHORT_WEEKDAYS[dayOfWeek(abs)]}, ${MONTHS[c.m - 1]} ${c.d}`;
}

function baseReason(r: BaseReason, lang: TermLanguage): string {
  switch (r.kind) {
    case 'beinonit':
      return fill(`{onah_beinonit} (day ${r.day})`, lang);
    case 'chodesh':
      if (r.rule === 'same_date') return fill(`{veset_hachodesh} (day ${dayOfMonth(r.dayOfMonth, lang)} of the month)`, lang);
      if (r.rule === 'day29') return fill('{veset_hachodesh} (the 29th, for a {flow} on the 30th)', lang);
      return fill('{veset_hachodesh} (the 1st of the following month, for a {flow} on the 30th)', lang);
    case 'haflagah': {
      const unit = r.unit === 'days' ? 'days' : term('onot', lang);
      return r.latest
        ? fill(`{veset_haflagah} (${r.length} ${unit})`, lang)
        : fill(`an earlier {haflagah} not yet passed (${r.length} ${unit})`, lang);
    }
  }
}

/** One reason for an onat perishah, as a line of text. */
export function reasonText(r: VesetReason, lang: TermLanguage): string {
  if (r.kind === 'or_zarua') return capital(fill('{or_zarua} of ', lang) + baseReason(r.of, lang));
  if (r.kind === 'full_day') return capital(fill('{full_day} of ', lang) + baseReason(r.of, lang));
  return capital(baseReason(r, lang));
}

/** The reason itself, without "Or Zarua of" or "full day of". */
function baseOf(r: VesetReason): BaseReason {
  return r.kind === 'or_zarua' || r.kind === 'full_day' ? r.of : r;
}

/** A reason in plain words, with its name in brackets: "day 31 from the last period (onah beinonit)". */
function whyEnglish(r: BaseReason, lang: TermLanguage): string {
  switch (r.kind) {
    case 'beinonit':
      return fill(`day ${r.day} from the last period ({onah_beinonit})`, lang);
    case 'chodesh':
      if (r.rule === 'same_date') return fill(`day ${dayOfMonth(r.dayOfMonth, 'en')} of the Hebrew month ({veset_hachodesh})`, lang);
      if (r.rule === 'day29') return fill('the 29th, for a period on the 30th ({veset_hachodesh})', lang);
      return fill('the 1st of the next month, for a period on the 30th ({veset_hachodesh})', lang);
    case 'haflagah': {
      const unit = r.unit === 'days' ? 'days' : term('onot', lang);
      return r.latest ? fill(`an interval of ${r.length} ${unit} ({veset_haflagah})`, lang) : fill(`an earlier interval of ${r.length} ${unit} ({haflagah})`, lang);
    }
  }
}

/** The same, wholly in Hebrew. */
function whyHebrew(r: BaseReason): string {
  switch (r.kind) {
    case 'beinonit':
      return `יום ${r.day} מהראייה האחרונה (${term('onah_beinonit', 'he')})`;
    case 'chodesh':
      if (r.rule === 'same_date') return `${dayOfMonth(r.dayOfMonth, 'he')} בחודש (${term('veset_hachodesh', 'he')})`;
      if (r.rule === 'day29') return `כ״ט בחודש, לראייה בל׳ בחודש (${term('veset_hachodesh', 'he')})`;
      return `א׳ בחודש הבא, לראייה בל׳ בחודש (${term('veset_hachodesh', 'he')})`;
    case 'haflagah': {
      const unit = r.unit === 'days' ? 'ימים' : term('onot', 'he');
      return r.latest ? `${term('haflagah', 'he')} של ${r.length} ${unit} (${term('veset_haflagah', 'he')})` : `${term('haflagah', 'he')} קודמת של ${r.length} ${unit}`;
    }
  }
}

/**
 * An onah as a calendar app shows it, for a person who does not know the
 * terms: when it is in plain day words with its hours, what applies, why
 * (each reason once, with its name in brackets), and the customs by which
 * this onah is kept when it is not the onah of the reason itself.
 *
 *   Onah: Saturday night
 *   Saturday night, 4:36 PM to 6:50 AM
 *   Separation and a bedikah
 *   Why: day 31 from the last period (onah beinonit); day 12 of the Hebrew month (veset hachodesh)
 *   Custom: full day (24 hours); Or Zarua (the onah before)
 */
function onahEventForApp(o: OnahView, opts: CalendarOptions): CalendarEvent {
  const { lang, timeZone: tz } = opts;
  const he = hebrewOnly(opts);
  const night = o.onah.part === 'night';
  // A night is named by the civil day of its evening.
  const civil = night ? o.onah.abs - 1 : o.onah.abs;
  const from = clock12(o.start, tz, 'floor');
  const to = clock12(o.end, tz, 'ceil');
  const bases: BaseReason[] = [];
  const seen = new Set<string>();
  for (const r of o.reasons) {
    const base = baseOf(r);
    const id = JSON.stringify(base);
    if (!seen.has(id)) {
      seen.add(id);
      bases.push(base);
    }
  }
  const fullDay = o.reasons.some(r => r.kind === 'full_day');
  const orZarua = o.reasons.some(r => r.kind === 'or_zarua');
  const timed = { start: roundToMinute(o.start, 'floor'), end: roundToMinute(o.end, 'ceil') };
  const common = { key: `onah:${onahIndex(o.onah)}`, kind: 'onah' as const, timed, projected: false, light: !o.veset };
  if (he) {
    const when = heOnahWhen(civil, o.onah.part);
    const customs = [fullDay ? `${term('full_day', 'he')} (כל היממה)` : '', orZarua ? `${term('or_zarua', 'he')} (העונה שלפני)` : ''].filter(x => x !== '');
    const lines = [`${when}, מ־${heTime(from)} עד ${heTime(to)}`, o.veset ? HE.separationAndBedikah : HE.separation, `למה: ${bases.map(whyHebrew).join('; ')}`];
    if (customs.length > 0) lines.push(`מנהג: ${customs.join('; ')}`);
    if (o.onMikvahNight) lines.push(HE.onMikvahNight);
    return { ...common, title: rtl(`${term('onat_perishah', 'he')}${o.veset ? '' : ` (${term('or_zarua', 'he')})`} – ${when}`), description: lines.map(rtl).join('\n') };
  }
  const when = night ? `${CIVIL_WEEKDAYS[dayOfWeek(civil)]} night` : `${weekday(civil)} by day`;
  const customs = [fullDay ? fill('{full_day} (24 hours)', lang) : '', orZarua ? fill('{or_zarua} (the {onah} before)', lang) : ''].filter(x => x !== '');
  const lines = [`${when}, ${from} to ${to}`, o.veset ? fill('Separation and a {bedikah}', lang) : 'Separation', `Why: ${bases.map(r => whyEnglish(r, lang)).join('; ')}`];
  if (customs.length > 0) lines.push(`Custom: ${customs.join('; ')}`);
  if (o.onMikvahNight) lines.push(fill('It falls on the {mikvah_night}.', lang));
  return { ...common, title: `${capital(term('onah', lang))}${o.veset ? '' : fill(' ({or_zarua})', lang)}: ${when}`, description: lines.join('\n') };
}

export type CalendarStyle = 'words' | 'discreet';

export interface CalendarEvent {
  /** Stable identity of the event, used to update rather than duplicate it. */
  key: string;
  /** 'apart' (a whole niddah period, the 'niddah' switch) is made only for calendar apps: see calendarAppEvents. */
  kind: 'flow' | 'onah' | 'hefsek' | 'clean_day' | 'mikvah' | 'apart';
  title: string;
  description: string;
  /** Set for events with clock times (epoch ms). */
  timed?: { start: number; end: number };
  /** Set for all-day events: civil dates as R.D. numbers, end exclusive. */
  allDay?: { startAbs: number; endAbsExclusive: number };
  /** True when the event rests on an assumption (the hefsek has not been recorded yet). */
  projected: boolean;
  /** True for an onah that is only an Or Zarua onah; shown in a lighter colour. */
  light?: boolean;
}

export interface CalendarOptions {
  style: CalendarStyle;
  lang: TermLanguage;
  timeZone: string;
  /**
   * Which date a description writes after a weekday. A description has no
   * "today" (it is read on any day): dates in it are written in full, with
   * the helpers of src/engine/dates.ts.
   */
  dates: DateStyle;
  /**
   * True for the events given to a calendar app (see calendarAppEvents).
   * There each title and description is in one language only: with Hebrew
   * terms it is wholly Hebrew, because a calendar app scrambles a line that
   * mixes Hebrew and English. The start of a period is an all-day event on
   * its date, so that it is seen in a month view.
   */
  forApp?: boolean;
}

/** True when the texts are written wholly in Hebrew. */
const hebrewOnly = (opts: CalendarOptions): boolean => opts.forApp === true && opts.lang === 'he' && opts.style === 'words';

const PROJECTED = ' (projected)';
/** The line a projected event ends with; the pages find it by its first word. */
const PROJECTED_NOTE = 'Projected: if the {hefsek} is done on the first day it can be.';

function onahEvent(o: OnahView, opts: CalendarOptions): CalendarEvent {
  const { lang } = opts;
  const part = o.onah.part;
  const timed = { start: roundToMinute(o.start, 'floor'), end: roundToMinute(o.end, 'ceil') };
  const key = `onah:${onahIndex(o.onah)}`;
  if (opts.style === 'discreet') {
    return { key, kind: 'onah', title: o.veset ? '◆' : '◇', description: '', timed, projected: false, light: !o.veset };
  }
  if (opts.forApp) return onahEventForApp(o, opts);
  // The event's own date and hours are not repeated: the reasons, then what is done.
  const lines = [...o.reasons.map(r => reasonText(r, lang)), o.veset ? fill('Separation, and a {bedikah}.', lang) : 'Separation.'];
  if (o.onMikvahNight) lines.push(fill('It falls on the {mikvah_night}.', lang));
  return {
    key,
    kind: 'onah',
    title: `${capital(term(o.veset ? 'veset_onah' : 'or_zarua', lang))} (${part})`,
    description: lines.join('\n'),
    timed,
    projected: false,
    light: !o.veset,
  };
}

function periodEvents(p: PeriodView, clash: boolean, opts: CalendarOptions): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const discreet = opts.style === 'discreet';
  const { lang, timeZone: tz } = opts;
  const he = hebrewOnly(opts);
  const suffix = p.projected ? (he ? HE.projectedSuffix : PROJECTED) : '';
  /** A line or a title: wholly Hebrew when the texts are, otherwise the English sentence with its terms filled in. */
  const say = (english: string, hebrew: string): string => (he ? rtl(hebrew) : fill(english, lang));

  // The start of the period.
  if (opts.forApp) {
    // In a calendar app: all day, on the civil date it began (a night: the date of that evening).
    const startAbs = p.start.part === 'night' ? p.start.abs - 1 : p.start.abs;
    const part: CivilPart = p.start.part;
    out.push({
      key: `flow:${p.startId}`,
      kind: 'flow',
      title: discreet
        ? '•'
        : p.cause === 'flow'
          ? say(`Period began (${part === 'day' ? 'by day' : 'at night'})`, `${HE.periodBegan} – ${hePart(part, true)}`)
          : say(`Stain: {niddah} began (${part === 'day' ? 'by day' : 'at night'})`, `${term('stain', 'he')}, ${HE.niddahBegan} – ${hePart(part, true)}`),
      description: '',
      allDay: { startAbs, endAbsExclusive: startAbs + 1 },
      projected: false,
    });
  } else {
    out.push({
      key: `flow:${p.startId}`,
      kind: 'flow',
      title: discreet
        ? '•'
        : p.cause === 'flow'
          ? `${capital(term('flow', lang))} (${p.start.part})`
          : `${capital(term('stain', lang))}: ${term('niddah', lang)} began (${p.start.part})`,
      description: '',
      timed: { start: roundToMinute(p.startWindow.start, 'floor'), end: roundToMinute(p.startWindow.end, 'ceil') },
      projected: false,
    });
  }

  // Hefsek taharah.
  const hefsekTimed = { start: roundToMinute(p.hefsekMinchaKetana, 'ceil'), end: roundToMinute(p.hefsekSunset, 'floor') };
  const hefsek = capital(term('hefsek', lang));
  if (p.hefsekAbs !== null) {
    const lines: string[] = [];
    if (p.hefsekEarly) lines.push(say('Before the days of waiting ended; the {clean_days} begin after them.', HE.hefsekEarly));
    out.push({
      key: `hefsek:${p.startId}`,
      kind: 'hefsek',
      title: discreet ? 'H ✓' : he ? rtl(`${hefsek} ✓`) : `${hefsek} ✓`,
      description: discreet ? '' : lines.join('\n'),
      timed: hefsekTimed,
      projected: false,
    });
  } else if (p.closedByNextPeriod) {
    // The next period began with no hefsek taharah recorded for this one: nothing more is known of it.
    return out;
  } else if (p.mikvahDoneAbs === null) {
    const deadline = clock12(p.hefsekSunset, tz, 'floor');
    // The event runs from minchah ketanah to sunset; its hours are not repeated here.
    const lines = [say('Before {sunset}; preferably after {minchah_ketanah}.', HE.hefsekWhen)];
    out.push({
      key: `hefsek:${p.startId}`,
      kind: 'hefsek',
      title: discreet ? `H < ${deadline}` : he ? rtl(`${hefsek} (עד ${heClock(deadline)})`) : `${hefsek} (by ${deadline})`,
      description: discreet ? '' : lines.join('\n'),
      timed: hefsekTimed,
      projected: true,
    });
  }

  // The seven clean days.
  for (const day of p.planCleanDays) {
    const sunset = clock12(day.sunset, tz, 'floor');
    const lines = [he ? rtl(`בדיקה בבוקר ולפני השקיעה (${heClock(sunset)})`) : capital(fill(`{bedikah} in the morning and before {sunset} (${sunset}).`, lang))];
    if (day.n === 1 || day.n === 7) lines.push(say('A {bedikah} on this day is required.', HE.bedikahRequired));
    if (p.projected) lines.push(say(PROJECTED_NOTE, HE.projectedNote));
    out.push({
      key: `clean:${p.startId}:${day.n}`,
      kind: 'clean_day',
      title: discreet
        ? `${day.n}/7${p.projected ? ' ?' : ''}`
        : he
          ? rtl(`${term('clean_days', 'he')}: יום ${day.n}${suffix}`)
          : `${capital(term('clean_days', lang))}: day ${day.n}${suffix}`,
      description: discreet ? '' : lines.join('\n'),
      allDay: { startAbs: day.abs, endAbsExclusive: day.abs + 1 },
      projected: p.projected,
    });
  }

  // Immersion.
  if (p.doneMikvah) {
    const m = p.doneMikvah;
    out.push({
      key: `mikvah:${p.startId}`,
      kind: 'mikvah',
      title: discreet ? 'M ✓' : he ? rtl(`${term('immersion', 'he')} ✓`) : `${capital(term('immersion', lang))} ✓`,
      description: '',
      timed: { start: roundToMinute(m.tzeit, 'ceil'), end: roundToMinute(m.tzeit, 'ceil') + 60 * MINUTE },
      projected: false,
    });
  } else {
    // The night worked out. Once it has passed she is taken to have immersed on it; nothing asks to record it.
    const m = p.planMikvah;
    const after = clock12(m.tzeit, tz, 'ceil');
    const lines: string[] = [];
    if (m.postponedOver.length > 0) lines.push(say('Moved: no {immersion} on the night of {yom_kippur} or {tisha_bav}.', HE.mikvahMoved));
    if (m.restNight) lines.push(say('The night of {shabbat} or {yom_tov}: prepare beforehand.', HE.mikvahRestNight));
    if (m.afterRestDay && !m.restNight) lines.push(say('The night after {shabbat} or {yom_tov}.', HE.mikvahAfterRest));
    if (m.afterRestDay && m.restNight) lines.push(say('The day before is {shabbat} or {yom_tov}: prepare before that.', HE.mikvahRestBefore));
    if (clash) lines.push(say('It falls on an {onat_perishah}.', HE.onOnatPerishah));
    if (p.projected) lines.push(say(PROJECTED_NOTE, HE.projectedNote));
    out.push({
      key: `mikvah:${p.startId}`,
      kind: 'mikvah',
      title: discreet
        ? `M > ${after}${p.projected ? ' ?' : ''}`
        : he
          ? rtl(`${term('mikvah_night', 'he')} (אחרי ${heClock(after)})${suffix}`)
          : `${capital(term('mikvah_night', lang))} (after ${after})${suffix}`,
      description: discreet ? '' : lines.join('\n'),
      timed: { start: roundToMinute(m.tzeit, 'ceil'), end: roundToMinute(m.tzeit, 'ceil') + 90 * MINUTE },
      projected: p.projected,
    });
  }
  return out;
}

/** Every event of the timeline. The caller chooses which window of time to publish. */
export function buildCalendar(t: Timeline, opts: CalendarOptions): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const clashNights = new Set(t.onot.filter(o => o.onMikvahNight).map(o => o.onah.abs));
  for (const p of t.periods) {
    events.push(...periodEvents(p, p.mikvahDoneAbs === null && clashNights.has(p.planMikvah.nightAbs), opts));
  }
  for (const o of t.onot) events.push(onahEvent(o, opts));
  const seen = new Set<string>();
  for (const e of events) {
    if (seen.has(e.key)) throw new Error(`duplicate calendar event key ${e.key}`);
    seen.add(e.key);
  }
  return events;
}

// ---------- what a calendar app shows ----------

/**
 * The kinds of event a household chooses to show in its calendar app.
 * 'niddah' is the one all-day event for each niddah period; 'onot' are the
 * onot of separation. They are separate switches: the niddah days are known
 * without a calendar, the onot are not.
 */
export type ShownKind = 'onot' | 'period' | 'hefsek' | 'niddah' | 'cleanDays' | 'mikvah';
export type CalendarShow = Record<ShownKind, boolean>;

export const SHOWN_KINDS: readonly ShownKind[] = ['onot', 'period', 'hefsek', 'niddah', 'cleanDays', 'mikvah'];

/** By default only the onot of separation, the start of each period and the hefsek taharah. */
export const DEFAULT_CALENDAR_SHOW: CalendarShow = { onot: true, period: true, hefsek: true, niddah: false, cleanDays: false, mikvah: false };

const SHOWN_AS: Record<CalendarEvent['kind'], ShownKind> = {
  apart: 'niddah',
  onah: 'onot',
  flow: 'period',
  hefsek: 'hefsek',
  clean_day: 'cleanDays',
  mikvah: 'mikvah',
};

const KEY_PREFIX: Record<string, CalendarEvent['kind']> = {
  apart: 'apart',
  onah: 'onah',
  flow: 'flow',
  hefsek: 'hefsek',
  clean: 'clean_day',
  mikvah: 'mikvah',
};

/** True for the key of an event of a kind that is switched off (an event the app wrote, by its stable key). */
export function hiddenKey(key: string, show: CalendarShow): boolean {
  const prefix = key.split(':', 1)[0] as string;
  if (!Object.hasOwn(KEY_PREFIX, prefix)) return false;
  return !show[SHOWN_AS[KEY_PREFIX[prefix] as CalendarEvent['kind']]];
}

/**
 * One event for each niddah period, all day, from the civil date on which
 * it began (a period that began at night: the date of that evening) through
 * the civil date of the evening of its mikvah night: the recorded
 * immersion's, or the one worked out (while no hefsek is recorded, if it is
 * done on the first day it can be). A period the next one closed with no
 * hefsek recorded runs up to the day before the next began.
 */
export function apartEvents(t: Timeline, opts: CalendarOptions): CalendarEvent[] {
  const { lang, timeZone: tz } = opts;
  const discreet = opts.style === 'discreet';
  // A description is read on any day: the dates in full, as the household chooses (src/engine/dates.ts).
  const w = { dates: opts.dates, lang };
  const civilStart = (p: PeriodView): number => (p.start.part === 'night' ? p.start.abs - 1 : p.start.abs);
  return t.periods.map((p, i) => {
    const startAbs = civilStart(p);
    const next = t.periods[i + 1];
    const mikvah = p.doneMikvah ?? p.planMikvah;
    let lastAbs: number;
    let description = '';
    if (p.closedByNextPeriod && p.hefsekAbs === null && p.doneMikvah === null && next) {
      lastAbs = civilStart(next) - 1;
    } else {
      lastAbs = mikvah.eveningAbs;
      if (next) lastAbs = Math.min(lastAbs, civilStart(next) - 1);
      const after = clock12(mikvah.tzeit, tz, 'ceil');
      if (hebrewOnly(opts)) {
        description =
          p.hefsekAbs !== null || p.doneMikvah !== null
            ? rtl(`עד ${term('mikvah_night', 'he')}: ${heEvening(mikvah.eveningAbs, opts.dates)}, אחרי ${heClock(after)}`)
            : rtl(`${term('mikvah_night', 'he')}: ${heEvening(mikvah.eveningAbs, opts.dates)}, אם ה${term('hefsek', 'he')} ייעשה ב${heDay(p.planHefsekAbs, opts.dates)}`);
      } else {
        description =
          p.hefsekAbs !== null || p.doneMikvah !== null
            ? fill(`Until {mikvah_night}: ${nightWords(mikvah.nightAbs, w)}, after ${after}.`, lang)
            : capital(fill(`{mikvah_night} would be ${nightWords(mikvah.nightAbs, w)}, if the {hefsek} is done ${dayWords(p.planHefsekAbs, w)}.`, lang));
      }
    }
    lastAbs = Math.max(lastAbs, startAbs);
    return {
      key: `apart:${p.startId}`,
      kind: 'apart',
      title: discreet ? 'N' : hebrewOnly(opts) ? rtl(term('niddah', 'he')) : capital(term('niddah', lang)),
      description: discreet ? '' : description,
      allDay: { startAbs, endAbsExclusive: lastAbs + 1 },
      projected: p.projected && p.doneMikvah === null && !p.closedByNextPeriod,
    };
  });
}

/**
 * The events a calendar app is given (Google Calendar and the subscription
 * feed alike): the events of the kinds that are switched on, with one event
 * for each niddah period when the niddah days are. They are written for a
 * calendar app (see CalendarOptions.forApp). The app's own month calendar,
 * the reminders and the texts use buildCalendar's events, all of them.
 */
export function calendarAppEvents(t: Timeline, show: CalendarShow, opts: CalendarOptions): CalendarEvent[] {
  const app = { ...opts, forApp: true };
  const out = show.niddah ? apartEvents(t, app) : [];
  for (const e of buildCalendar(t, app)) if (show[SHOWN_AS[e.kind]]) out.push(e);
  return out;
}
