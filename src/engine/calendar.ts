/**
 * Turns the timeline into calendar events.
 *
 * Sentences are English. Halachic terms are shown in English letters or in
 * Hebrew script, as the household chooses. A third style uses symbols only,
 * for a calendar that other people may see.
 */
import { absToCivil, dayOfWeek } from './civil';
import { onahIndex } from './onah';
import { clock12, roundToMinute } from './present';
import { capital, dayOfMonth, fill, hebrewDate, term, type TermLanguage } from './terms';
import type { OnahView, PeriodView, Timeline } from './timeline';
import type { BaseReason, VesetReason } from './vesatot';

const MINUTE = 60_000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbat'] as const;
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

/** "Thursday, 16 Kislev 5787 (Nov 26, 2026)" for the daytime of a Hebrew date. */
export function fullDate(abs: number, lang: TermLanguage): string {
  return `${weekday(abs)}, ${hebrewDate(abs, lang)} (${civilDate(abs)})`;
}

/**
 * An onah in words. A night belongs to the Hebrew date that follows it, so
 * it is named by the evening on which it begins:
 * "Sunday evening, Dec 20, 2026 (the night of 11 Tevet 5787)", or
 * "Monday, 11 Tevet 5787 (Dec 21, 2026), by day".
 */
const CIVIL_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/**
 * A night in words: the civil evening on which it begins, and the Hebrew
 * date it belongs to: "Saturday evening, Dec 12, 2026 (the night of 3 Tevet
 * 5787)". `nightAbs` is the R.D. number of that Hebrew date's daytime. The
 * evening is named by its civil weekday, because "the night of Shabbat"
 * would be read as Friday night.
 */
export function eveningLabel(nightAbs: number, lang: TermLanguage): string {
  const evening = nightAbs - 1;
  return `${CIVIL_WEEKDAYS[dayOfWeek(evening)]} evening, ${civilDate(evening)} (the night of ${hebrewDate(nightAbs, lang)})`;
}

export function onahLabel(onah: { abs: number; part: 'night' | 'day' }, lang: TermLanguage): string {
  if (onah.part === 'day') return `${fullDate(onah.abs, lang)}, by day`;
  return capital(eveningLabel(onah.abs, lang));
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

export type CalendarStyle = 'words' | 'discreet';

export interface CalendarEvent {
  /** Stable identity of the event, used to update rather than duplicate it. */
  key: string;
  kind: 'flow' | 'onah' | 'hefsek' | 'clean_day' | 'mikvah';
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
}

const PROJECTED = ' (projected)';
const PROJECTED_NOTE = 'Projected: this assumes the {hefsek} is done on the first day it can be.';

function onahEvent(o: OnahView, opts: CalendarOptions): CalendarEvent {
  const { lang, timeZone: tz } = opts;
  const part = o.onah.part;
  const timed = { start: roundToMinute(o.start, 'floor'), end: roundToMinute(o.end, 'ceil') };
  const key = `onah:${onahIndex(o.onah)}`;
  if (opts.style === 'discreet') {
    return { key, kind: 'onah', title: o.veset ? '◆' : '◇', description: '', timed, projected: false, light: !o.veset };
  }
  const lines = [
    onahLabel(o.onah, lang),
    `From ${clock12(o.start, tz, 'floor')} until ${clock12(o.end, tz, 'ceil')}`,
    '',
    ...o.reasons.map(r => reasonText(r, lang)),
    '',
    o.veset ? fill('Separation, and a {bedikah}.', lang) : 'Separation.',
  ];
  if (o.onMikvahNight) lines.push('', fill('This {onah} falls on the {mikvah_night}. Ask a {rav}.', lang));
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
  const suffix = p.projected ? PROJECTED : '';

  // The start of the period.
  out.push({
    key: `flow:${p.startId}`,
    kind: 'flow',
    title: discreet
      ? '•'
      : p.cause === 'flow'
        ? `${capital(term('flow', lang))} (${p.start.part})`
        : `${capital(term('stain', lang))}: ${term('niddah', lang)} began (${p.start.part})`,
    description: discreet ? '' : onahLabel(p.start, lang),
    timed: { start: roundToMinute(p.startWindow.start, 'floor'), end: roundToMinute(p.startWindow.end, 'ceil') },
    projected: false,
  });

  // Hefsek taharah.
  const hefsekTimed = { start: roundToMinute(p.hefsekMinchaKetana, 'ceil'), end: roundToMinute(p.hefsekSunset, 'floor') };
  const hefsek = capital(term('hefsek', lang));
  if (p.hefsekAbs !== null) {
    const lines = [fullDate(p.hefsekAbs, lang)];
    if (p.hefsekEarly) {
      lines.push('', fill('The {hefsek} was done before the days of waiting were over; the {clean_days} begin only after them. Ask a {rav}.', lang));
    }
    out.push({
      key: `hefsek:${p.startId}`,
      kind: 'hefsek',
      title: discreet ? 'H ✓' : `${hefsek} ✓`,
      description: discreet ? '' : lines.join('\n'),
      timed: hefsekTimed,
      projected: false,
    });
  } else if (p.mikvahDoneAbs === null) {
    const deadline = clock12(p.hefsekSunset, tz, 'floor');
    const lines = [
      fullDate(p.planHefsekAbs, lang),
      fill(`Before {sunset}: ${deadline}`, lang),
      fill(`Preferably after {minchah_ketanah}: ${clock12(p.hefsekMinchaKetana, tz, 'ceil')}`, lang),
    ];
    if (p.planHefsekAbs > p.earliestHefsekAbs) {
      lines.push('', fill(`The {hefsek} could have been done from ${weekday(p.earliestHefsekAbs)}, ${hebrewDate(p.earliestHefsekAbs, lang, false)}.`, lang));
    }
    out.push({
      key: `hefsek:${p.startId}`,
      kind: 'hefsek',
      title: discreet ? `H < ${deadline}` : `${hefsek} (by ${deadline})`,
      description: discreet ? '' : lines.join('\n'),
      timed: hefsekTimed,
      projected: true,
    });
  }

  // The seven clean days.
  for (const day of p.planCleanDays) {
    const lines = [
      fullDate(day.abs, lang),
      fill(`A {bedikah} in the morning, and a {bedikah} before {sunset} (${clock12(day.sunset, tz, 'floor')}).`, lang),
    ];
    if (day.n === 1 || day.n === 7) lines.push(fill('A {bedikah} on this day is required.', lang));
    if (p.projected) lines.push('', fill(PROJECTED_NOTE, lang));
    out.push({
      key: `clean:${p.startId}:${day.n}`,
      kind: 'clean_day',
      title: discreet ? `${day.n}/7${p.projected ? ' ?' : ''}` : `${capital(term('clean_days', lang))}: day ${day.n}${suffix}`,
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
      title: discreet ? 'M ✓' : `${capital(term('immersion', lang))} ✓`,
      description: discreet ? '' : capital(eveningLabel(m.nightAbs, lang)),
      timed: { start: roundToMinute(m.tzeit, 'ceil'), end: roundToMinute(m.tzeit, 'ceil') + 60 * MINUTE },
      projected: false,
    });
  } else {
    const m = p.planMikvah;
    const after = clock12(m.tzeit, tz, 'ceil');
    const lines = [
      eveningLabel(m.nightAbs, lang),
      fill(`{immersion} after {nightfall}: ${after}`, lang),
    ].map(capital);
    if (m.postponedOver.length > 0) lines.push(fill('Moved: there is no {immersion} on the night of {yom_kippur} or of {tisha_bav}.', lang));
    if (m.restNight) lines.push(fill('The night of {shabbat} or {yom_tov}: preparation is done beforehand.', lang));
    if (m.afterRestDay && !m.restNight) lines.push(fill('The night after {shabbat} or {yom_tov}.', lang));
    if (m.afterRestDay && m.restNight) lines.push(fill('The day before is {shabbat} or {yom_tov}: preparation is done before that.', lang));
    if (clash) lines.push('', fill('The {mikvah_night} falls on an {onat_perishah}. Ask a {rav}.', lang));
    if (p.projected) lines.push('', fill(PROJECTED_NOTE, lang));
    out.push({
      key: `mikvah:${p.startId}`,
      kind: 'mikvah',
      title: discreet ? `M > ${after}${p.projected ? ' ?' : ''}` : `${capital(term('mikvah_night', lang))} (after ${after})${suffix}`,
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
