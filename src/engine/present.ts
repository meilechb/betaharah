/**
 * Turns the timeline into what people see: calendar events and reminder
 * texts. Calendar text is Hebrew (or neutral symbols, for a calendar that
 * may be seen by others); text messages are plain English letters so that
 * each fits in one SMS.
 */
import { gematriya } from '@hebcal/hdate';
import { absToCivil, dayOfWeek, localAbs, localDateTime, localToInstant } from './civil';
import { formatHebrewDate, hebrewWeekday } from './hebrew';
import { isRestDay } from './holidays';
import { onahIndex } from './onah';
import type { GeoPoint } from './sun';
import type { OnahView, PeriodView, Timeline } from './timeline';
import type { BaseReason, VesetReason } from './vesatot';
import { dayTimes, type ZmanimOptions } from './zmanim';

// ---------- formatting ----------

const MINUTE = 60_000;

function roundToMinute(ms: number, mode: 'floor' | 'ceil'): number {
  return (mode === 'floor' ? Math.floor(ms / MINUTE) : Math.ceil(ms / MINUTE)) * MINUTE;
}

/**
 * Clock time in the location's zone. A time something must be done *before*
 * is rounded down to the minute and a time something starts *after* is
 * rounded up, so a rounded time never allows what the exact time forbids.
 */
export function clock24(ms: number, timeZone: string, mode: 'floor' | 'ceil'): string {
  const l = localDateTime(roundToMinute(ms, mode), timeZone);
  return `${l.hh}:${String(l.mi).padStart(2, '0')}`;
}

export function clock12(ms: number, timeZone: string, mode: 'floor' | 'ceil'): string {
  const l = localDateTime(roundToMinute(ms, mode), timeZone);
  const h = l.hh % 12 === 0 ? 12 : l.hh % 12;
  return `${h}:${String(l.mi).padStart(2, '0')} ${l.hh < 12 ? 'AM' : 'PM'}`;
}

const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** e.g. "Thu Nov 26" */
export function englishDate(abs: number): string {
  const c = absToCivil(abs);
  return `${EN_DAYS[dayOfWeek(abs)]} ${EN_MONTHS[c.m - 1]} ${c.d}`;
}

const HEBREW_DAY_NUMBERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ז׳'] as const;

function baseReasonHebrew(r: BaseReason): string {
  switch (r.kind) {
    case 'beinonit':
      return `עונה בינונית (יום ${gematriya(r.day)})`;
    case 'chodesh':
      if (r.rule === 'same_date') return `וסת החודש (${gematriya(r.dayOfMonth)} בחודש)`;
      if (r.rule === 'day29') return 'וסת החודש (כ״ט בחודש, לראייה שביום ל׳)';
      return 'וסת החודש (א׳ בחודש שלאחריו, לראייה שביום ל׳)';
    case 'haflagah': {
      const unit = r.unit === 'days' ? 'ימים' : 'עונות';
      return r.latest ? `וסת ההפלגה (${r.length} ${unit})` : `הפלגה קודמת שלא נעקרה (${r.length} ${unit})`;
    }
  }
}

export function reasonHebrew(r: VesetReason): string {
  if (r.kind === 'or_zarua') return `אור זרוע של ${baseReasonHebrew(r.of)}`;
  if (r.kind === 'full_day') return `מעת לעת של ${baseReasonHebrew(r.of)}`;
  return baseReasonHebrew(r);
}

function baseOf(r: VesetReason): BaseReason {
  return r.kind === 'or_zarua' || r.kind === 'full_day' ? r.of : r;
}

function baseReasonEnglish(r: BaseReason): string {
  switch (r.kind) {
    case 'beinonit':
      return `day ${r.day}`;
    case 'chodesh':
      return 'chodesh';
    case 'haflagah':
      return `haflagah ${r.length}${r.unit === 'days' ? 'd' : ' onot'}`;
  }
}

/** A short list of what a stretch of onot is for, e.g. "day 30, chodesh, haflagah 28d". */
export function reasonsEnglish(reasons: readonly VesetReason[], maxItems = 4): string {
  const names = [...new Set(reasons.map(r => baseReasonEnglish(baseOf(r))))];
  const shown = names.slice(0, maxItems);
  const more = names.length - shown.length;
  return shown.join(', ') + (more > 0 ? ` +${more} more` : '');
}

// ---------- calendar events ----------

export type TitleStyle = 'hebrew' | 'discreet';

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
  style: TitleStyle;
  timeZone: string;
}

const PROJECTED_SUFFIX = ' (משוער)';

function onahEvent(o: OnahView, opts: CalendarOptions): CalendarEvent {
  const part = o.onah.part === 'night' ? 'לילה' : 'יום';
  const timed = { start: roundToMinute(o.start, 'floor'), end: roundToMinute(o.end, 'ceil') };
  const key = `onah:${onahIndex(o.onah)}`;
  if (opts.style === 'discreet') {
    return { key, kind: 'onah', title: o.veset ? '◆' : '◇', description: '', timed, projected: false, light: !o.veset };
  }
  const lines = [
    `${hebrewWeekday(o.onah.abs)}, ${formatHebrewDate(o.onah.abs)}, עונת ה${part}`,
    `מ־${clock24(o.start, opts.timeZone, 'floor')} עד ${clock24(o.end, opts.timeZone, 'ceil')}`,
    '',
    ...o.reasons.map(reasonHebrew),
    '',
    o.veset ? 'פרישה ובדיקה.' : 'פרישה.',
  ];
  if (o.onMikvahNight) lines.push('', 'עונה זו חלה בליל הטבילה. יש לשאול רב.');
  return {
    key,
    kind: 'onah',
    title: o.veset ? `עונת הוסת (${part})` : `אור זרוע (${part})`,
    description: lines.join('\n'),
    timed,
    projected: false,
    light: !o.veset,
  };
}

function periodEvents(p: PeriodView, clash: boolean, opts: CalendarOptions): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const discreet = opts.style === 'discreet';
  const tz = opts.timeZone;
  const suffix = p.projected ? PROJECTED_SUFFIX : '';

  // The start of the period.
  const part = p.start.part === 'night' ? 'לילה' : 'יום';
  out.push({
    key: `flow:${p.startId}`,
    kind: 'flow',
    title: discreet ? '•' : `${p.cause === 'flow' ? 'ראייה' : 'תחילת איסור (כתם)'} (${part})`,
    description: discreet ? '' : `${hebrewWeekday(p.start.abs)}, ${formatHebrewDate(p.start.abs)}, עונת ה${part}`,
    timed: { start: roundToMinute(p.startWindow.start, 'floor'), end: roundToMinute(p.startWindow.end, 'ceil') },
    projected: false,
  });

  // Hefsek taharah.
  const hefsekTimed = { start: roundToMinute(p.hefsekMinchaKetana, 'ceil'), end: roundToMinute(p.hefsekSunset, 'floor') };
  if (p.hefsekAbs !== null) {
    const lines = [`${hebrewWeekday(p.hefsekAbs)}, ${formatHebrewDate(p.hefsekAbs)}`];
    if (p.hefsekEarly) lines.push('', 'ההפסק נעשה קודם שעברו ימי ההמתנה; שבעת הנקיים מתחילים רק לאחריהם. יש לשאול רב.');
    out.push({
      key: `hefsek:${p.startId}`,
      kind: 'hefsek',
      title: discreet ? 'H ✓' : 'הפסק טהרה ✓',
      description: discreet ? '' : lines.join('\n'),
      timed: hefsekTimed,
      projected: false,
    });
  } else if (p.mikvahDoneAbs === null) {
    const deadline = clock24(p.hefsekSunset, tz, 'floor');
    const lines = [
      `${hebrewWeekday(p.planHefsekAbs)}, ${formatHebrewDate(p.planHefsekAbs)}`,
      `קודם השקיעה: ${deadline}`,
      `לכתחילה אחר מנחה קטנה: ${clock24(p.hefsekMinchaKetana, tz, 'ceil')}`,
    ];
    if (p.planHefsekAbs > p.earliestHefsekAbs) {
      lines.push('', `אפשר היה להפסיק בטהרה כבר מ${hebrewWeekday(p.earliestHefsekAbs)}, ${formatHebrewDate(p.earliestHefsekAbs, false)}.`);
    }
    out.push({
      key: `hefsek:${p.startId}`,
      kind: 'hefsek',
      title: discreet ? `H < ${deadline}` : `הפסק טהרה (עד ${deadline})`,
      description: discreet ? '' : lines.join('\n'),
      timed: hefsekTimed,
      projected: true,
    });
  }

  // The seven clean days.
  for (const day of p.planCleanDays) {
    const name = HEBREW_DAY_NUMBERS[day.n - 1] as string;
    const lines = [
      `${hebrewWeekday(day.abs)}, ${formatHebrewDate(day.abs)}`,
      `בדיקה בבוקר, ובדיקה קודם השקיעה (${clock24(day.sunset, tz, 'floor')}).`,
    ];
    if (day.n === 1 || day.n === 7) lines.push('בדיקה ביום זה מעכבת.');
    if (p.projected) lines.push('', 'משוער: בהנחה שהפסק הטהרה ייעשה ביום הראשון האפשרי.');
    out.push({
      key: `clean:${p.startId}:${day.n}`,
      kind: 'clean_day',
      title: discreet ? `${day.n}/7${p.projected ? ' ?' : ''}` : `שבעה נקיים: יום ${name}${suffix}`,
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
      title: discreet ? 'M ✓' : 'טבילה ✓',
      description: discreet ? '' : `ליל ${hebrewWeekday(m.nightAbs)}, ${formatHebrewDate(m.nightAbs)}`,
      timed: { start: roundToMinute(m.tzeit, 'ceil'), end: roundToMinute(m.tzeit, 'ceil') + 60 * MINUTE },
      projected: false,
    });
  } else {
    const m = p.planMikvah;
    const after = clock24(m.tzeit, tz, 'ceil');
    const lines = [
      `ליל ${hebrewWeekday(m.nightAbs)}, ${formatHebrewDate(m.nightAbs)}`,
      `הטבילה אחר צאת הכוכבים: ${after}`,
    ];
    if (m.postponedOver.length > 0) lines.push('נדחה: אין טובלים בליל יום הכיפורים ובליל תשעה באב.');
    if (m.restNight) lines.push('ליל שבת או יום טוב: החפיפה מבעוד יום.');
    if (m.afterRestDay && !m.restNight) lines.push('מוצאי שבת או יום טוב.');
    if (m.afterRestDay && m.restNight) lines.push('היום שלפניו שבת או יום טוב: החפיפה קודם לכן.');
    if (clash) lines.push('', 'ליל הטבילה חל בעונת פרישה. יש לשאול רב.');
    if (p.projected) lines.push('', 'משוער: בהנחה שהפסק הטהרה ייעשה ביום הראשון האפשרי.');
    out.push({
      key: `mikvah:${p.startId}`,
      kind: 'mikvah',
      title: discreet ? `M > ${after}${p.projected ? ' ?' : ''}` : `ליל טבילה (אחר ${after})${suffix}`,
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

// ---------- reminders ----------

export type ReminderKind = 'hefsek' | 'bedikah_morning' | 'bedikah_afternoon' | 'mikvah' | 'mikvah_confirm' | 'onah';

export interface Reminder {
  /** Stable identity: a reminder is sent once per key. */
  key: string;
  kind: ReminderKind;
  /** When to send it, epoch ms. */
  at: number;
  text: string;
}

export interface ReminderOptions {
  style: 'plain' | 'discreet';
  hefsek: { on: boolean; minutesBeforeSunset: number };
  bedikot: { on: boolean; morningHour: number; morningMinute: number; minutesBeforeSunset: number };
  mikvah: { on: boolean; minutesBeforeSunset: number };
  /** The morning after the planned night, if no immersion is recorded. */
  mikvahConfirm: { on: boolean; hour: number; minute: number };
  onah: { on: boolean; minutesBefore: number };
  /** Send before Shabbat or Yom Tov what would otherwise be sent during it. */
  beforeRestDays: boolean;
  /** Stop reminding about the hefsek this many days after the first possible day. */
  hefsekMaxDays: number;
}

export const DEFAULT_REMINDER_OPTIONS: ReminderOptions = {
  style: 'plain',
  hefsek: { on: true, minutesBeforeSunset: 120 },
  bedikot: { on: true, morningHour: 8, morningMinute: 0, minutesBeforeSunset: 90 },
  mikvah: { on: true, minutesBeforeSunset: 180 },
  mikvahConfirm: { on: true, hour: 9, minute: 0 },
  onah: { on: true, minutesBefore: 120 },
  beforeRestDays: true,
  hefsekMaxDays: 10,
};

export interface ReminderContext {
  place: GeoPoint;
  zopts: ZmanimOptions;
  yomTov: 'diaspora' | 'israel';
}

const CANDLE_LIGHTING_MINUTES = 18;
/** How long before candle lighting a moved reminder is sent. */
const BEFORE_REST_DAY_MINUTES = 90;

/** How long after nightfall a reminder held over Shabbat or Yom Tov is sent. */
const AFTER_REST_DAY_MINUTES = 45;

/**
 * The Shabbat or Yom Tov (as an R.D. Hebrew date) that an instant falls in,
 * counting from candle lighting until nightfall; null on a weekday.
 */
export function restDayAt(at: number, ctx: ReminderContext): number | null {
  const civil = localAbs(at, ctx.place.timeZone);
  const today = dayTimes(civil, ctx.place, ctx.zopts);
  if (at >= today.sunset - CANDLE_LIGHTING_MINUTES * MINUTE) {
    // From candle lighting on, the time belongs to the next Hebrew date.
    if (isRestDay(civil + 1, ctx.yomTov)) return civil + 1;
    // Until nightfall, a Shabbat or Yom Tov that is ending has not ended.
    if (at < today.tzeit && isRestDay(civil, ctx.yomTov)) return civil;
    return null;
  }
  return isRestDay(civil, ctx.yomTov) ? civil : null;
}

/**
 * A time shortly before the Shabbat or Yom Tov that `at` falls in begins
 * (before the first of consecutive days). `at` unchanged on a weekday.
 */
export function moveBeforeRestDay(at: number, ctx: ReminderContext): number {
  const restDay = restDayAt(at, ctx);
  if (restDay === null) return at;
  let first = restDay;
  while (isRestDay(first - 1, ctx.yomTov)) first--;
  const eve = dayTimes(first - 1, ctx.place, ctx.zopts);
  return eve.sunset - (CANDLE_LIGHTING_MINUTES + BEFORE_REST_DAY_MINUTES) * MINUTE;
}

/**
 * A time shortly after the Shabbat or Yom Tov that `at` falls in ends
 * (after the last of consecutive days). `at` unchanged on a weekday.
 */
export function moveAfterRestDay(at: number, ctx: ReminderContext): number {
  const restDay = restDayAt(at, ctx);
  if (restDay === null) return at;
  let last = restDay;
  while (isRestDay(last + 1, ctx.yomTov)) last++;
  return dayTimes(last, ctx.place, ctx.zopts).tzeit + AFTER_REST_DAY_MINUTES * MINUTE;
}

interface OnahBlock {
  start: number;
  end: number;
  firstIndex: number;
  veset: boolean;
  reasons: VesetReason[];
  onMikvahNight: boolean;
}

/** Joins onot that follow one another without a break. */
function onahBlocks(onot: readonly OnahView[]): OnahBlock[] {
  const blocks: OnahBlock[] = [];
  let lastIndex = Number.NaN;
  for (const o of onot) {
    const index = onahIndex(o.onah);
    const current = blocks[blocks.length - 1];
    if (current && index === lastIndex + 1) {
      current.end = o.end;
      current.veset = current.veset || o.veset;
      current.reasons.push(...o.reasons);
      current.onMikvahNight = current.onMikvahNight || o.onMikvahNight;
    } else {
      blocks.push({ start: o.start, end: o.end, firstIndex: index, veset: o.veset, reasons: [...o.reasons], onMikvahNight: o.onMikvahNight });
    }
    lastIndex = index;
  }
  return blocks;
}

/**
 * Reminders that are still ahead of `t.now` (or due within the last few
 * minutes), for the open period and for coming onot.
 */
export function buildReminders(t: Timeline, opts: ReminderOptions, ctx: ReminderContext): Reminder[] {
  const tz = ctx.place.timeZone;
  const discreet = opts.style === 'discreet';
  const out: Reminder[] = [];
  /**
   * `onRestDay` says what to do with a reminder whose time falls on Shabbat
   * or Yom Tov: send it beforehand, hold it until afterwards, or leave it out.
   * The texts name their day, so they read correctly whenever they are sent.
   */
  const push = (key: string, kind: ReminderKind, at: number, text: string, onRestDay: 'before' | 'after' | 'drop'): void => {
    let when = at;
    if (opts.beforeRestDays && restDayAt(at, ctx) !== null) {
      if (onRestDay === 'drop') return;
      when = onRestDay === 'before' ? moveBeforeRestDay(at, ctx) : moveAfterRestDay(at, ctx);
    }
    out.push({ key, kind, at: when, text });
  };
  const localTime = (abs: number, hh: number, mi: number): number => {
    const c = absToCivil(abs);
    return localToInstant({ ...c, hh, mi, ss: 0 }, tz);
  };

  const open = t.status.state === 'niddah' ? t.status.period : null;
  if (open) {
    if (open.hefsekAbs === null) {
      if (opts.hefsek.on && open.planHefsekAbs - open.earliestHefsekAbs < opts.hefsekMaxDays) {
        const deadline = clock12(open.hefsekSunset, tz, 'floor');
        const eve = isRestDay(open.planHefsekAbs + 1, ctx.yomTov) ? ' Before candle lighting if possible.' : '';
        push(
          `hefsek:${open.startId}:${open.planHefsekAbs}`,
          'hefsek',
          open.hefsekSunset - opts.hefsek.minutesBeforeSunset * MINUTE,
          discreet
            ? `H ${englishDate(open.planHefsekAbs)} before ${deadline}. Reply 2 when done.`
            : `Hefsek tahara: ${englishDate(open.planHefsekAbs)}, before sunset at ${deadline}.${eve} Reply 2 when done.`,
          'before',
        );
      }
    } else {
      for (const day of open.planCleanDays) {
        const sunset = clock12(day.sunset, tz, 'floor');
        const must = day.n === 1 || day.n === 7 ? ' Required on this day.' : '';
        if (opts.bedikot.on) {
          push(
            `bedikah_am:${open.startId}:${open.hefsekAbs}:${day.n}`,
            'bedikah_morning',
            localTime(day.abs, opts.bedikot.morningHour, opts.bedikot.morningMinute),
            discreet
              ? `Day ${day.n}/7 ${englishDate(day.abs)}: AM, and before ${sunset}.`
              : `Clean day ${day.n} of 7 is ${englishDate(day.abs)}: bedikah in the morning and again before sunset at ${sunset}.${must}`,
            'before',
          );
          push(
            `bedikah_pm:${open.startId}:${open.hefsekAbs}:${day.n}`,
            'bedikah_afternoon',
            day.sunset - opts.bedikot.minutesBeforeSunset * MINUTE,
            discreet
              ? `Day ${day.n}/7 ${englishDate(day.abs)}: before ${sunset}.`
              : `Clean day ${day.n} of 7, ${englishDate(day.abs)}: afternoon bedikah before sunset at ${sunset}.${must}`,
            'drop', // the morning reminder, sent beforehand, already names the afternoon bedikah
          );
        }
      }
      const m = open.planMikvah;
      const after = clock12(m.tzeit, tz, 'ceil');
      if (opts.mikvah.on) {
        const notes: string[] = [];
        if (m.postponedOver.length > 0) notes.push('moved past the fast');
        if (m.restNight) notes.push('Shabbat or Yom Tov night, prepare before');
        else if (m.afterRestDay) notes.push('after Shabbat or Yom Tov');
        const clash = t.onot.some(o => o.onMikvahNight && o.onah.abs === m.nightAbs);
        if (clash) notes.push('it is also an onah, ask a rav');
        const tail = notes.length ? ` (${notes.join('; ')})` : '';
        push(
          `mikvah:${open.startId}:${open.hefsekAbs}:${m.nightAbs}`,
          'mikvah',
          m.sunset - opts.mikvah.minutesBeforeSunset * MINUTE,
          discreet
            ? `M night: ${englishDate(m.eveningAbs)} after ${after}${tail}. Reply 4 after.`
            : `Mikvah night: ${englishDate(m.eveningAbs)}, after ${after}${tail}. Reply 4 after immersing.`,
          'before',
        );
      }
      if (opts.mikvahConfirm.on) {
        push(
          `mikvah_confirm:${open.startId}:${open.hefsekAbs}:${m.nightAbs}`,
          'mikvah_confirm',
          localTime(m.nightAbs, opts.mikvahConfirm.hour, opts.mikvahConfirm.minute),
          discreet
            ? `No M recorded for ${englishDate(m.eveningAbs)} night. Reply 4 if done.`
            : `No immersion is recorded for ${englishDate(m.eveningAbs)} night. Reply 4 if she immersed.`,
          'after',
        );
      }
    }
  }

  if (opts.onah.on) {
    for (const b of onahBlocks(t.onot.filter(o => o.end > t.now))) {
      const fromDay = englishDate(localAbs(b.start, tz));
      const toDay = englishDate(localAbs(b.end, tz));
      const from = `${clock12(b.start, tz, 'floor')} ${fromDay}`;
      const to = `${clock12(b.end, tz, 'ceil')} ${toDay}`;
      const why = reasonsEnglish(b.reasons);
      const orZaruaOnly = b.reasons.every(r => r.kind === 'or_zarua') ? 'Or Zarua of ' : '';
      const clash = b.onMikvahNight ? ' Mikvah night too, ask a rav.' : '';
      push(
        `onah:${b.firstIndex}:${Math.round((b.end - b.start) / MINUTE)}`,
        'onah',
        b.start - opts.onah.minutesBefore * MINUTE,
        discreet
          ? `${b.veset ? 'O' : 'OZ'} ${from} - ${to}.`
          : `Onah: ${from} until ${to}. ${orZaruaOnly}${why}.${b.veset ? ' Bedikah.' : ''}${clash}`,
        'before',
      );
    }
  }

  return out.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}

// ---------- status line ----------

/** One or two sentences on where things stand, for a text-message reply. */
export function statusText(t: Timeline, timeZone: string): string {
  const next = t.onot.find(o => o.end > t.now);
  const nextOnah = next
    ? ` Next onah: ${clock12(next.start, timeZone, 'floor')} ${englishDate(localAbs(next.start, timeZone))}.`
    : '';
  if (t.status.state === 'tehorah') return `Tehorah.${nextOnah}`;
  const p = t.status.period;
  const phase = t.status.phase;
  switch (phase.kind) {
    case 'before_hefsek':
      return `Niddah since ${englishDate(p.start.abs)}. Hefsek from ${englishDate(p.earliestHefsekAbs)}; next possible ${englishDate(p.planHefsekAbs)} before ${clock12(p.hefsekSunset, timeZone, 'floor')}.`;
    case 'before_first_day':
      return `Hefsek done ${englishDate(p.planHefsekAbs)}. Clean day 1 is ${englishDate(p.planCleanDays[0]!.abs)}. Mikvah ${englishDate(p.planMikvah.eveningAbs)} after ${clock12(p.planMikvah.tzeit, timeZone, 'ceil')}.`;
    case 'counting':
      return `Clean day ${phase.day} of 7. Mikvah ${englishDate(p.planMikvah.eveningAbs)} after ${clock12(p.planMikvah.tzeit, timeZone, 'ceil')}.`;
    case 'postponed':
      return `Count complete; no immersion tonight. Mikvah ${englishDate(p.planMikvah.eveningAbs)} after ${clock12(p.planMikvah.tzeit, timeZone, 'ceil')}.`;
    case 'mikvah_tonight':
      return `Mikvah tonight after ${clock12(p.planMikvah.tzeit, timeZone, 'ceil')}.`;
    case 'mikvah_not_recorded':
      return `Count complete since ${englishDate(p.planMikvah.eveningAbs)}; no immersion recorded. Reply 4 after immersing.`;
  }
}
