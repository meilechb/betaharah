/**
 * Reminder texts and the one-line status. Text messages are plain English
 * letters so that each fits in one SMS. (Calendar events are in calendar.ts.)
 */
import { absToCivil, dayOfWeek, localAbs, localDateTime, localToInstant } from './civil';
import { isRestDay } from './holidays';
import { onahIndex } from './onah';
import type { GeoPoint } from './sun';
import type { OnahView, Timeline } from './timeline';
import type { BaseReason, VesetReason } from './vesatot';
import { dayTimes, type ZmanimOptions } from './zmanim';

// ---------- formatting ----------

const MINUTE = 60_000;

export function roundToMinute(ms: number, mode: 'floor' | 'ceil'): number {
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

// ---------- reminders ----------

export type ReminderKind = 'hefsek' | 'bedikah_morning' | 'bedikah_afternoon' | 'mikvah' | 'mikvah_book' | 'onah';

export interface Reminder {
  /** Stable identity: a reminder is sent once per key. */
  key: string;
  kind: ReminderKind;
  /** When to send it, epoch ms. */
  at: number;
  /**
   * It is no longer sent from this time on: a few hours after `at`, or the
   * start of the next Shabbat or Yom Tov if that comes first.
   */
  until: number;
  text: string;
}

/** A reminder not sent within this long of its time is dropped. */
export const REMINDER_WINDOW_MS = 3 * 3_600_000;

export interface ReminderOptions {
  style: 'plain' | 'discreet';
  hefsek: { on: boolean; minutesBeforeSunset: number };
  bedikot: { on: boolean; morningHour: number; morningMinute: number; minutesBeforeSunset: number };
  mikvah: { on: boolean; minutesBeforeSunset: number };
  /** To book the mikvah: the morning after the day the hefsek taharah was recorded. */
  mikvahBook: { on: boolean; hour: number; minute: number };
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
  mikvahBook: { on: true, hour: 9, minute: 0 },
  onah: { on: true, minutesBefore: 120 },
  beforeRestDays: true,
  hefsekMaxDays: 10,
};

export interface ReminderContext {
  place: GeoPoint;
  zopts: ZmanimOptions;
  yomTov: 'diaspora' | 'israel';
  /**
   * When a log entry was recorded (epoch ms), if known. The reminder to book
   * the mikvah goes the morning after the hefsek taharah was recorded; without
   * this, the morning after the day of the hefsek.
   */
  recordedAt?: (entryId: string) => number | undefined;
}

const CANDLE_LIGHTING_MINUTES = 18;
/** How long before candle lighting a moved reminder is sent. */
const BEFORE_REST_DAY_MINUTES = 90;

/** How long after nightfall a reminder held over Shabbat or Yom Tov is sent. */
const AFTER_REST_DAY_MINUTES = 45;

/**
 * Candle lighting of the next Shabbat or Yom Tov that begins after `at`
 * (the start of the first day of a stretch of such days).
 */
export function nextRestStart(at: number, ctx: ReminderContext): number {
  const civil = localAbs(at, ctx.place.timeZone);
  for (let day = civil; day <= civil + 9; day++) {
    if (!isRestDay(day, ctx.yomTov) || isRestDay(day - 1, ctx.yomTov)) continue;
    const start = dayTimes(day - 1, ctx.place, ctx.zopts).sunset - CANDLE_LIGHTING_MINUTES * MINUTE;
    if (start > at) return start;
  }
  throw new Error('no Shabbat found in the coming days');
}

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
    let until = when + REMINDER_WINDOW_MS;
    if (opts.beforeRestDays) until = Math.min(until, nextRestStart(when, ctx));
    out.push({ key, kind, at: when, until, text });
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
      if (opts.mikvahBook.on && open.hefsekId !== null) {
        // The morning after the day the hefsek was recorded: a hefsek recorded days late still gets it, unless
        // that morning is already the day of the mikvah night (the mikvah reminder comes that day).
        const recorded = ctx.recordedAt?.(open.hefsekId);
        const day = (recorded === undefined ? open.hefsekAbs : localAbs(recorded, tz)) + 1;
        if (day < m.eveningAbs) {
          push(
            `mikvah_book:${open.startId}:${open.hefsekAbs}`,
            'mikvah_book',
            localTime(day, opts.mikvahBook.hour, opts.mikvahBook.minute),
            discreet ? `Book M: ${englishDate(m.eveningAbs)} after ${after}.` : `Book the mikvah: mikvah night is ${englishDate(m.eveningAbs)}, after ${after}.`,
            'after',
          );
        }
      }
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
            ? `M night: ${englishDate(m.eveningAbs)} after ${after}${tail}.`
            : `Mikvah night: ${englishDate(m.eveningAbs)}, after ${after}${tail}.`,
          'before',
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
    case 'before_hefsek': {
      const day = `${englishDate(p.planHefsekAbs)} before ${clock12(p.hefsekSunset, timeZone, 'floor')}`;
      return p.planHefsekAbs === p.earliestHefsekAbs
        ? `Niddah since ${englishDate(p.start.abs)}. Hefsek from ${day}.`
        : `Niddah since ${englishDate(p.start.abs)}. Hefsek from ${englishDate(p.earliestHefsekAbs)}; next possible ${day}.`;
    }
    case 'before_first_day':
      return `Hefsek done ${englishDate(p.planHefsekAbs)}. Clean day 1 is ${englishDate(p.planCleanDays[0]!.abs)}. Mikvah ${englishDate(p.planMikvah.eveningAbs)} after ${clock12(p.planMikvah.tzeit, timeZone, 'ceil')}.`;
    case 'counting':
      return `Clean day ${phase.day} of 7. Mikvah ${englishDate(p.planMikvah.eveningAbs)} after ${clock12(p.planMikvah.tzeit, timeZone, 'ceil')}.`;
    case 'postponed':
      return `Count complete; no immersion tonight. Mikvah ${englishDate(p.planMikvah.eveningAbs)} after ${clock12(p.planMikvah.tzeit, timeZone, 'ceil')}.`;
    case 'mikvah_tonight':
      return `Mikvah tonight after ${clock12(p.planMikvah.tzeit, timeZone, 'ceil')}.`;
  }
}
