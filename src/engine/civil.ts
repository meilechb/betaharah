/**
 * Civil (Gregorian) dates as R.D. day numbers, and time-zone helpers.
 *
 * R.D. ("Rata Die") day 1 is Monday, January 1, year 1 of the proleptic
 * Gregorian calendar. It is the same day numbering @hebcal/hdate uses, so a
 * civil date and the Hebrew date whose daytime falls on it share one number.
 *
 * Nothing here reads the host machine's time zone.
 */

export interface CivilDate {
  /** Gregorian year */
  y: number;
  /** Month 1-12 */
  m: number;
  /** Day of month 1-31 */
  d: number;
}

const MS_PER_DAY = 86_400_000;
/** R.D. number of 1970-01-01 */
const RD_UNIX_EPOCH = 719_163;

/** R.D. day number of a civil date. */
export function civilToAbs(date: CivilDate): number {
  // Supported range. (Date.UTC also treats years 0-99 as 1900-1999.)
  if (!Number.isInteger(date.y) || date.y < 1900 || date.y > 2400) {
    throw new RangeError(`civil year out of supported range: ${date.y}`);
  }
  const ms = Date.UTC(date.y, date.m - 1, date.d);
  if (!Number.isFinite(ms)) throw new RangeError(`invalid civil date ${JSON.stringify(date)}`);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== date.y || back.getUTCMonth() !== date.m - 1 || back.getUTCDate() !== date.d) {
    throw new RangeError(`invalid civil date ${JSON.stringify(date)}`);
  }
  return ms / MS_PER_DAY + RD_UNIX_EPOCH;
}

/** Civil date of an R.D. day number. */
export function absToCivil(abs: number): CivilDate {
  if (!Number.isInteger(abs)) throw new RangeError(`abs must be an integer, got ${abs}`);
  const dt = new Date((abs - RD_UNIX_EPOCH) * MS_PER_DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** Day of week of an R.D. day number: 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(abs: number): number {
  return ((abs % 7) + 7) % 7;
}

/** Epoch milliseconds of 00:00 UTC on the given R.D. day. */
export function absToUtcMidnightMs(abs: number): number {
  return (abs - RD_UNIX_EPOCH) * MS_PER_DAY;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export interface LocalDateTime extends CivilDate {
  hh: number;
  mi: number;
  ss: number;
}

/** Wall-clock date and time of an instant in an IANA time zone, straight from Intl. */
export function localDateTimeIntl(ms: number, timeZone: string): LocalDateTime {
  if (!Number.isFinite(ms)) throw new RangeError('invalid instant');
  const out: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  const { year, month, day, hour, minute, second } = out;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    throw new Error(`could not resolve local time in ${timeZone}`);
  }
  return { y: year, m: month, d: day, hh: hour, mi: minute, ss: second };
}

/** Offset of a zone from UTC at an instant, in ms, straight from Intl. */
export function zoneOffsetMsIntl(ms: number, timeZone: string): number {
  const l = localDateTimeIntl(ms, timeZone);
  const asUtc = Date.UTC(l.y, l.m - 1, l.d, l.hh, l.mi, l.ss);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/*
 * Intl is slow to ask thousands of times, and a zone's offset changes at
 * most a few times a year. So for each zone and UTC year the moments at
 * which the offset changes are found once (by sampling Intl weekly and
 * bisecting to the minute) and kept; after that an offset is a table lookup.
 * The tests compare the result with Intl itself across many zones and years.
 */
interface ZoneYear {
  /** Start of each stretch of constant offset, epoch ms, ascending. */
  starts: number[];
  /** Offset during the stretch that begins at the same index. */
  offsets: number[];
}

const zoneYears = new Map<string, ZoneYear>();
const WEEK_MS = 7 * MS_PER_DAY;
/** Outside these years Intl is asked directly every time. */
const TABLE_FIRST_YEAR = 1970;
const TABLE_LAST_YEAR = 2200;

function buildZoneYear(timeZone: string, year: number): ZoneYear {
  const from = Date.UTC(year, 0, 1);
  const to = Date.UTC(year + 1, 0, 1);
  const starts = [from];
  const offsets = [zoneOffsetMsIntl(from, timeZone)];
  let prevT = from;
  let prevOff = offsets[0] as number;
  for (let t = from + WEEK_MS; prevT < to; t += WEEK_MS) {
    const sample = Math.min(t, to);
    // More than one change between two samples is handled by repeating the search.
    while (zoneOffsetMsIntl(sample, timeZone) !== prevOff) {
      let lo = prevT; // offset here is prevOff
      let hi = sample; // offset here differs
      while (hi - lo > 60_000) {
        const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
        if (zoneOffsetMsIntl(mid, timeZone) === prevOff) lo = mid;
        else hi = mid;
      }
      prevT = hi;
      prevOff = zoneOffsetMsIntl(hi, timeZone);
      starts.push(hi);
      offsets.push(prevOff);
    }
    prevT = sample;
  }
  return { starts, offsets };
}

/**
 * Offset of a time zone from UTC at an instant, in milliseconds
 * (positive east of Greenwich).
 */
export function zoneOffsetMs(ms: number, timeZone: string): number {
  if (!Number.isFinite(ms)) throw new RangeError('invalid instant');
  const year = new Date(ms).getUTCFullYear();
  if (year < TABLE_FIRST_YEAR || year > TABLE_LAST_YEAR) return zoneOffsetMsIntl(ms, timeZone);
  const key = `${timeZone}|${year}`;
  let table = zoneYears.get(key);
  if (!table) {
    table = buildZoneYear(timeZone, year);
    zoneYears.set(key, table);
  }
  let i = table.starts.length - 1;
  while (i > 0 && (table.starts[i] as number) > ms) i--;
  return table.offsets[i] as number;
}

/** Wall-clock date and time of an instant in an IANA time zone. */
export function localDateTime(ms: number, timeZone: string): LocalDateTime {
  const d = new Date(Math.floor(ms / 1000) * 1000 + zoneOffsetMs(ms, timeZone));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mi: d.getUTCMinutes(), ss: d.getUTCSeconds() };
}

/** R.D. day number of the civil date an instant falls on in a time zone. */
export function localAbs(ms: number, timeZone: string): number {
  return Math.floor((Math.floor(ms / 1000) * 1000 + zoneOffsetMs(ms, timeZone)) / MS_PER_DAY) + RD_UNIX_EPOCH;
}

/**
 * The instant of a wall-clock time in a time zone.
 *
 * A wall-clock time that does not exist (skipped when clocks go forward) is
 * moved forward by the size of the gap; one that occurs twice (clocks go
 * back) resolves to the first occurrence.
 */
export function localToInstant(local: LocalDateTime, timeZone: string): number {
  const wall = Date.UTC(local.y, local.m - 1, local.d, local.hh, local.mi, local.ss);
  // Two candidate offsets: the one in force a day before and a day after.
  const offBefore = zoneOffsetMs(wall - MS_PER_DAY, timeZone);
  const offAfter = zoneOffsetMs(wall + MS_PER_DAY, timeZone);
  const candidates = [wall - offBefore, wall - offAfter].sort((a, b) => a - b);
  for (const c of candidates) {
    if (zoneOffsetMs(c, timeZone) === wall - c) return c;
  }
  // Non-existent wall time: use the earlier offset, which lands after the gap.
  return wall - Math.min(offBefore, offAfter);
}

/** True if the string is an IANA time zone this runtime knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
