/**
 * Reminder texts and the one-line status. Text messages are plain English
 * letters so that each fits in one SMS. (Calendar events are in calendar.ts.)
 */
import { absToCivil, dayOfWeek, localAbs, localDateTime, localToInstant } from './civil';
import { dayWords, nightWords, onahWords, type DateStyle, type DateWords } from './dates';
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

/** e.g. "Thu Nov 26": a civil date alone, for the operator's pages (dates for a household are made in dates.ts). */
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

/**
 * A text by its message key (src/app/chat/messages.ts) and the values of
 * its placeholders. `day` is the day a reminder is about (the hefsek
 * reminder's DONE records the hefsek on it).
 */
export interface TextMessage {
  key: string;
  vars: Record<string, string>;
  day?: number;
}

/** Fills {placeholders} with values; an unknown or missing one becomes empty. */
export function fillText(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? '');
}

/**
 * The default wording of the reminders, by message key. The operator can
 * change each one (the registry in src/app/chat/messages.ts takes these as
 * its defaults); `text` below is always this default.
 */
export const REMINDER_TEXTS: Record<string, string> = {
  'reminder.hefsek': 'Hefsek tahara: {day}, before sunset at {sunset}.{eve}',
  'reminder.hefsek.discreet': 'H {day} before {sunset}.',
  'reminder.bedikah_morning': 'Clean day {n} of 7 is {day}: bedikah in the morning and again before sunset at {sunset}.{required}',
  'reminder.bedikah_morning.discreet': 'Day {n}/7 {day}: AM, and before {sunset}.',
  'reminder.bedikah_afternoon': 'Clean day {n} of 7, {day}: afternoon bedikah before sunset at {sunset}.{required}',
  'reminder.bedikah_afternoon.discreet': 'Day {n}/7 {day}: before {sunset}.',
  'reminder.mikvah_book': 'Book the mikvah: mikvah night is {day}, after {time}.',
  'reminder.mikvah_book.discreet': 'Book M: {day} after {time}.',
  'reminder.mikvah': 'Mikvah night: {day}, after {time}{notes}.',
  'reminder.mikvah.discreet': 'M night: {day} after {time}{notes}.',
  'reminder.onah': 'Onah: {from} until {to}. {why}.{bedikah}{clash}',
  'reminder.onah.discreet': '{mark} {from} - {to}.',
  // The one text sent the morning a Shabbat or Yom Tov begins: its first line, then one line per reminder
  // that falls in it, in time order (restPieces below). After it ends, what she did not get is sent as the lines alone.
  'reminder.rest': 'Over {rest}.',
  'reminder.rest.discreet': 'Over {rest}.',
  'reminder.rest.hefsek': '{day}: hefsek tahara before {sunset}.',
  'reminder.rest.hefsek.discreet': '{day}: H before {sunset}.',
  'reminder.rest.bedikot': '{day}: clean day {n}, bedikah morning and before {sunset}{required}.',
  'reminder.rest.bedikot.discreet': '{day}: day {n}/7, AM and before {sunset}.',
  'reminder.rest.bedikah_morning': '{day}: clean day {n}, bedikah in the morning{required}.',
  'reminder.rest.bedikah_morning.discreet': '{day}: day {n}/7, AM.',
  'reminder.rest.bedikah_afternoon': '{day}: clean day {n}, bedikah before {sunset}{required}.',
  'reminder.rest.bedikah_afternoon.discreet': '{day}: day {n}/7, before {sunset}.',
  'reminder.rest.mikvah': '{day}: mikvah night, after {time}{notes}.',
  'reminder.rest.mikvah.discreet': '{day}: M night after {time}{notes}.',
  'reminder.rest.mikvah_book': 'Book the mikvah for {day}, after {time}.',
  'reminder.rest.mikvah_book.discreet': 'Book M: {day} after {time}.',
  'reminder.rest.onah': 'Onah {from} until {to} ({why}).{bedikah}',
  'reminder.rest.onah.discreet': '{mark} {from} - {to}.',
};

/**
 * One reminder carried by the text of a Shabbat or Yom Tov: the reminder it
 * replaces (its key and kind), its own time (for the order), until when it
 * is still of use, and the values of its line.
 */
export interface RestItem {
  key: string;
  kind: ReminderKind;
  at: number;
  end: number;
  vars: Record<string, string>;
}

/**
 * The words of a text of a Shabbat or Yom Tov: `rest` names it ("Shabbat",
 * "Yom Tov and Shabbat") on the first line; null for the text after it ends,
 * which is its lines alone.
 */
export interface RestText {
  rest: string | null;
  style: 'plain' | 'discreet';
  items: RestItem[];
}

/** The two texts of one Shabbat or Yom Tov: the morning it begins, and (for what she did not get) after it ends. */
export interface RestGroup {
  eve: RestText;
  after: { at: number; until: number; text: RestText };
}

export interface Reminder {
  /** Stable identity: a reminder is sent once per key. */
  key: string;
  /** 'rest': the one text, the morning a Shabbat or Yom Tov begins, of every reminder that falls in it. */
  kind: ReminderKind | 'rest';
  /** For kind 'rest': its items, sent to each phone as far as that phone gets their kinds. */
  rest?: RestGroup;
  /** When to send it, epoch ms. */
  at: number;
  /**
   * It is no longer sent from this time on: a few hours after `at`, or the
   * start of the next Shabbat or Yom Tov if that comes first.
   */
  until: number;
  /** The text in its default wording. */
  text: string;
  /** The same text by its message key, so that the operator's wording is used when it is sent. */
  msg: TextMessage;
}

/** A reminder not sent within this long of its time is dropped. */
export const REMINDER_WINDOW_MS = 3 * 3_600_000;

export interface ReminderOptions {
  style: 'plain' | 'discreet';
  hefsek: { on: boolean; minutesBeforeSunset: number };
  /**
   * `days`: which of the seven clean days (1 to 7) get bedikah reminders;
   * `morning` and `beforeSunset`: which of the two each of those days gets.
   */
  bedikot: { on: boolean; morningHour: number; morningMinute: number; minutesBeforeSunset: number; days: number[]; morning: boolean; beforeSunset: boolean };
  mikvah: { on: boolean; minutesBeforeSunset: number };
  /** To book the mikvah: the morning after the day the hefsek taharah was recorded. */
  mikvahBook: { on: boolean; hour: number; minute: number };
  onah: { on: boolean; minutesBefore: number };
  /**
   * Nothing is sent during Shabbat or Yom Tov. What falls in one goes out as
   * one text the morning it begins, at this time (or 90 minutes before
   * candle lighting, if that is earlier).
   */
  restEve: { hour: number; minute: number };
  /** Stop reminding about the hefsek this many days after the first possible day. */
  hefsekMaxDays: number;
}

export const ALL_CLEAN_DAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

export const DEFAULT_REMINDER_OPTIONS: ReminderOptions = {
  style: 'plain',
  hefsek: { on: true, minutesBeforeSunset: 60 },
  bedikot: { on: true, morningHour: 8, morningMinute: 0, minutesBeforeSunset: 60, days: [...ALL_CLEAN_DAYS], morning: true, beforeSunset: true },
  mikvah: { on: true, minutesBeforeSunset: 60 },
  mikvahBook: { on: true, hour: 9, minute: 0 },
  onah: { on: true, minutesBefore: 60 },
  restEve: { hour: 9, minute: 0 },
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
  /** Which date the texts write after a weekday (src/engine/dates.ts). */
  dates: DateStyle;
}

const CANDLE_LIGHTING_MINUTES = 18;
/** How long before candle lighting a moved reminder is sent. */
const BEFORE_REST_DAY_MINUTES = 90;

/** How long after nightfall what is still of use is sent, to a phone that did not get the text before Shabbat or Yom Tov. */
const AFTER_REST_DAY_MINUTES = 45;

/** A mikvah night is of use in a text this long after its nightfall. */
const MIKVAH_NIGHT_MS = 6 * 3_600_000;

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
  first: { abs: number; part: 'night' | 'day' };
  last: { abs: number; part: 'night' | 'day' };
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
      current.last = o.onah;
      current.veset = current.veset || o.veset;
      current.reasons.push(...o.reasons);
      current.onMikvahNight = current.onMikvahNight || o.onMikvahNight;
    } else {
      blocks.push({ start: o.start, end: o.end, first: o.onah, last: o.onah, firstIndex: index, veset: o.veset, reasons: [...o.reasons], onMikvahNight: o.onMikvahNight });
    }
    lastIndex = index;
  }
  return blocks;
}

/** "Shabbat", "Yom Tov", "Yom Tov and Shabbat": the days of a stretch, as its text names them. */
export function restName(first: number, last: number): string {
  const names = new Set<string>();
  for (let d = first; d <= last; d++) names.add(dayOfWeek(d) === 6 ? 'Shabbat' : 'Yom Tov');
  return [...names].join(' and ');
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The values of a reminder's line in the text of a Shabbat or Yom Tov, from
 * those of its own text: the day first, with a capital; "(required)" for
 * the bedikah of days 1 and 7.
 */
function lineVars(kind: ReminderKind, vars: Record<string, string>): Record<string, string> {
  const v = { ...vars };
  if (kind === 'hefsek' || kind === 'bedikah_morning' || kind === 'bedikah_afternoon' || kind === 'mikvah') v.day = capital(v.day ?? '');
  if (kind === 'bedikah_morning' || kind === 'bedikah_afternoon') v.required = v.required ? ' (required)' : '';
  delete v.eve;
  return v;
}

/**
 * A text of a Shabbat or Yom Tov as messages of the registry: its first line
 * (unless `rest` is null), then one line per item in time order; the morning
 * and afternoon bedikah of one day are one line.
 */
export function restPieces(t: RestText): TextMessage[] {
  const sfx = t.style === 'discreet' ? '.discreet' : '';
  const out: TextMessage[] = t.rest === null ? [] : [{ key: `reminder.rest${sfx}`, vars: { rest: t.rest } }];
  const items = [...t.items].sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
  const used = new Set<RestItem>();
  for (const i of items) {
    if (used.has(i)) continue;
    used.add(i);
    let base: string = i.kind;
    if (i.kind === 'bedikah_morning') {
      const same = i.key.replace(/^bedikah_am:/, '');
      const pm = items.find(x => !used.has(x) && x.kind === 'bedikah_afternoon' && x.key.replace(/^bedikah_pm:/, '') === same);
      if (pm) {
        used.add(pm);
        base = 'bedikot';
      }
    }
    out.push({ key: `reminder.rest.${base}${sfx}`, vars: i.vars });
  }
  return out;
}

/** The text of a Shabbat or Yom Tov in the default wording. */
export function restText(t: RestText): string {
  return restPieces(t)
    .map(m => fillText(REMINDER_TEXTS[m.key] as string, m.vars))
    .join(' ');
}

/**
 * Reminders that are still ahead of `t.now` (or due within the last few
 * minutes), for the open period and for coming onot.
 *
 * Nothing is sent during Shabbat or Yom Tov (candle lighting to nightfall,
 * a run of such days being one stretch). Every reminder whose time falls in
 * one, and a mikvah night that is the night of one, is a line of one text
 * sent the morning the stretch begins (kind 'rest'); a reminder after it
 * ends is sent as usual.
 */
export function buildReminders(t: Timeline, opts: ReminderOptions, ctx: ReminderContext): Reminder[] {
  const tz = ctx.place.timeZone;
  const discreet = opts.style === 'discreet';
  const out: Reminder[] = [];
  /** The reminders that fall in each stretch, by its first day. */
  const stretches = new Map<number, Array<{ key: string; kind: ReminderKind; at: number; end: number; varsFor: (w: DateWords) => Record<string, string> }>>();
  /**
   * A reminder at `at`, of use until `end`. The texts name their day, so they
   * read correctly whenever they are sent: "today" or "tomorrow" only when
   * the whole time it may be sent falls on one civil date. `restNight`: the
   * Shabbat or Yom Tov whose text it belongs to although its time is before.
   */
  const push = (
    key: string,
    kind: ReminderKind,
    at: number,
    base: string,
    varsFor: (w: DateWords) => Record<string, string>,
    end: number,
    extra: { day?: number; restNight?: number | null } = {},
  ): void => {
    const restDay = restDayAt(at, ctx) ?? extra.restNight ?? null;
    if (restDay !== null) {
      let first = restDay;
      while (isRestDay(first - 1, ctx.yomTov)) first--;
      const list = stretches.get(first) ?? [];
      list.push({ key, kind, at, end, varsFor });
      stretches.set(first, list);
      return;
    }
    const until = Math.min(at + REMINDER_WINDOW_MS, nextRestStart(at, ctx));
    const sentOn = localAbs(at, tz);
    const vars = varsFor({ dates: ctx.dates, lang: 'en', today: sentOn, relative: localAbs(until - 1, tz) === sentOn });
    const msgKey = discreet ? `${base}.discreet` : base;
    const msg: TextMessage = extra.day === undefined ? { key: msgKey, vars } : { key: msgKey, vars, day: extra.day };
    out.push({ key, kind, at, until, text: fillText(REMINDER_TEXTS[msgKey] as string, vars), msg });
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
        const eve = isRestDay(open.planHefsekAbs + 1, ctx.yomTov) ? ' Candle lighting is that evening.' : '';
        push(
          `hefsek:${open.startId}:${open.planHefsekAbs}`,
          'hefsek',
          open.hefsekSunset - opts.hefsek.minutesBeforeSunset * MINUTE,
          'reminder.hefsek',
          w => ({ day: dayWords(open.planHefsekAbs, w), sunset: deadline, eve }),
          open.hefsekSunset,
          { day: open.planHefsekAbs },
        );
      }
    } else {
      const chosen = new Set(opts.bedikot.days);
      for (const day of open.planCleanDays) {
        if (!opts.bedikot.on || !chosen.has(day.n)) continue;
        const sunset = clock12(day.sunset, tz, 'floor');
        const required = day.n === 1 || day.n === 7 ? ' Required on this day.' : '';
        const vars = (w: DateWords) => ({ n: String(day.n), day: dayWords(day.abs, w), sunset, required });
        if (opts.bedikot.morning) {
          push(
            `bedikah_am:${open.startId}:${open.hefsekAbs}:${day.n}`,
            'bedikah_morning',
            localTime(day.abs, opts.bedikot.morningHour, opts.bedikot.morningMinute),
            'reminder.bedikah_morning',
            vars,
            day.sunset,
          );
        }
        if (opts.bedikot.beforeSunset) {
          push(
            `bedikah_pm:${open.startId}:${open.hefsekAbs}:${day.n}`,
            'bedikah_afternoon',
            day.sunset - opts.bedikot.minutesBeforeSunset * MINUTE,
            'reminder.bedikah_afternoon',
            vars,
            day.sunset,
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
            'reminder.mikvah_book',
            w => ({ day: nightWords(m.nightAbs, w), time: after }),
            m.tzeit,
          );
        }
      }
      if (opts.mikvah.on) {
        const notes: string[] = [];
        if (m.postponedOver.length > 0) notes.push('moved past the fast');
        if (m.restNight) notes.push('Shabbat or Yom Tov night');
        else if (m.afterRestDay) notes.push('after Shabbat or Yom Tov');
        const clash = t.onot.some(o => o.onMikvahNight && o.onah.abs === m.nightAbs);
        if (clash) notes.push('also an onah');
        const tail = notes.length ? ` (${notes.join('; ')})` : '';
        push(
          `mikvah:${open.startId}:${open.hefsekAbs}:${m.nightAbs}`,
          'mikvah',
          m.sunset - opts.mikvah.minutesBeforeSunset * MINUTE,
          'reminder.mikvah',
          w => ({ day: nightWords(m.nightAbs, w), time: after, notes: tail }),
          m.tzeit + MIKVAH_NIGHT_MS,
          // A mikvah night that is the night of a Shabbat or Yom Tov is in that day's text, whenever its own time.
          { restNight: isRestDay(m.nightAbs, ctx.yomTov) ? m.nightAbs : null },
        );
      }
    }
  }

  if (opts.onah.on) {
    for (const b of onahBlocks(t.onot.filter(o => o.end > t.now))) {
      // A night begins at sunset (its evening); a daytime begins at sunrise, and either ends on the daytime of its date.
      const from = (w: DateWords): string => `${clock12(b.start, tz, 'floor')} ${onahWords(b.first, w)}`;
      const to = (w: DateWords): string => `${clock12(b.end, tz, 'ceil')} ${dayWords(b.last.abs, w)}`;
      const why = reasonsEnglish(b.reasons);
      const orZaruaOnly = b.reasons.every(r => r.kind === 'or_zarua') ? 'Or Zarua of ' : '';
      const clash = b.onMikvahNight ? ' Mikvah night too.' : '';
      push(
        `onah:${b.firstIndex}:${Math.round((b.end - b.start) / MINUTE)}`,
        'onah',
        b.start - opts.onah.minutesBefore * MINUTE,
        'reminder.onah',
        w => ({ from: from(w), to: to(w), why: `${orZaruaOnly}${why}`, bedikah: b.veset ? ' Bedikah.' : '', clash, mark: b.veset ? 'O' : 'OZ' }),
        b.end,
      );
    }
  }

  // One text per stretch of Shabbat and Yom Tov, the morning it begins; and what is still of use after it
  // ends, for whoever did not get that text (src/app/queue.ts sends each line once).
  const style = opts.style;
  for (const [first, items] of stretches) {
    let last = first;
    while (isRestDay(last + 1, ctx.yomTov)) last++;
    const start = dayTimes(first - 1, ctx.place, ctx.zopts).sunset - CANDLE_LIGHTING_MINUTES * MINUTE;
    const at = Math.min(localTime(first - 1, opts.restEve.hour, opts.restEve.minute), start - BEFORE_REST_DAY_MINUTES * MINUTE);
    const afterAt = dayTimes(last, ctx.place, ctx.zopts).tzeit + AFTER_REST_DAY_MINUTES * MINUTE;
    const afterUntil = Math.min(afterAt + REMINDER_WINDOW_MS, nextRestStart(afterAt, ctx));
    const words = (sent: number, until: number): DateWords => ({ dates: ctx.dates, lang: 'en', today: localAbs(sent, tz), relative: localAbs(until - 1, tz) === localAbs(sent, tz) });
    const item = (i: (typeof items)[number], w: DateWords): RestItem => ({ key: i.key, kind: i.kind, at: i.at, end: i.end, vars: lineVars(i.kind, i.varsFor(w)) });
    const eve: RestText = { rest: restName(first, last), style, items: items.map(i => item(i, words(at, start))) };
    const after: RestText = { rest: null, style, items: items.filter(i => i.end > afterAt).map(i => item(i, words(afterAt, afterUntil))) };
    out.push({
      key: `rest:${first}`,
      kind: 'rest',
      at,
      until: start,
      text: restText(eve),
      msg: { key: discreet ? 'reminder.rest.discreet' : 'reminder.rest', vars: { rest: eve.rest as string } },
      rest: { eve, after: { at: afterAt, until: afterUntil, text: after } },
    });
  }

  return out.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}

// ---------- status line ----------

/** The default wording of the status, by phase (message keys of src/app/chat/messages.ts). */
export const STATUS_TEXTS: Record<string, string> = {
  'status.tehorah': 'Tehorah.',
  'status.tehorah_onah': 'Tehorah. Next onah: {next_time} {next_day}.',
  'status.before_hefsek': 'Niddah since {start}. Hefsek from {hefsek_day} before {sunset}.',
  'status.before_hefsek_later': 'Niddah since {start}. Hefsek can be done {hefsek_day} before {sunset}.',
  'status.before_first_day': 'Clean days begin {first_day}. Mikvah {mikvah_day} after {mikvah_time}.',
  'status.counting': 'Clean day {day} of 7. Mikvah {mikvah_day} after {mikvah_time}.',
  'status.postponed': 'Count complete; no immersion tonight. Mikvah {mikvah_day} after {mikvah_time}.',
  'status.mikvah_tonight': 'Mikvah tonight after {mikvah_time}.',
};

/** Where things stand, as a message key and its values; the dates as `dates` has them, as of `t.now`. */
export function statusMessage(t: Timeline, timeZone: string, dates: DateStyle): TextMessage {
  const w: DateWords = { dates, lang: 'en', today: localAbs(t.now, timeZone) };
  if (t.status.state === 'tehorah') {
    const next = t.onot.find(o => o.end > t.now);
    return next
      ? { key: 'status.tehorah_onah', vars: { next_time: clock12(next.start, timeZone, 'floor'), next_day: onahWords(next.onah, w) } }
      : { key: 'status.tehorah', vars: {} };
  }
  const p = t.status.period;
  const phase = t.status.phase;
  const mikvah = { mikvah_day: nightWords(p.planMikvah.nightAbs, w), mikvah_time: clock12(p.planMikvah.tzeit, timeZone, 'ceil') };
  switch (phase.kind) {
    case 'before_hefsek': {
      const vars = { start: onahWords(p.start, w), hefsek_day: dayWords(p.planHefsekAbs, w), sunset: clock12(p.hefsekSunset, timeZone, 'floor') };
      return { key: p.planHefsekAbs === p.earliestHefsekAbs ? 'status.before_hefsek' : 'status.before_hefsek_later', vars };
    }
    case 'before_first_day':
      return { key: 'status.before_first_day', vars: { hefsek_day: dayWords(p.planHefsekAbs, w), first_day: dayWords(p.planCleanDays[0]!.abs, w), ...mikvah } };
    case 'counting':
      return { key: 'status.counting', vars: { day: String(phase.day), ...mikvah } };
    case 'postponed':
      return { key: 'status.postponed', vars: mikvah };
    case 'mikvah_tonight':
      return { key: 'status.mikvah_tonight', vars: mikvah };
  }
}

/** One or two sentences on where things stand, in the default wording. */
export function statusText(t: Timeline, timeZone: string, dates: DateStyle): string {
  const m = statusMessage(t, timeZone, dates);
  return fillText(STATUS_TEXTS[m.key] as string, m.vars);
}
