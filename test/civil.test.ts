import { describe, expect, it } from 'vitest';
import { greg2abs } from '@hebcal/hdate';
import {
  absToCivil,
  civilToAbs,
  dayOfWeek,
  isValidTimeZone,
  localAbs,
  localDateTime,
  localDateTimeIntl,
  localToInstant,
  zoneOffsetMs,
  zoneOffsetMsIntl,
} from '../src/engine/civil';

describe('civil dates', () => {
  it('matches the R.D. numbers documented by @hebcal/hdate', () => {
    expect(civilToAbs({ y: 2008, m: 11, d: 13 })).toBe(733359);
    expect(civilToAbs({ y: 2005, m: 4, d: 2 })).toBe(732038);
    expect(civilToAbs({ y: 1970, m: 1, d: 1 })).toBe(719163);
  });

  it('agrees with greg2abs on every day from 1990 to 2100 and round-trips', () => {
    let abs = civilToAbs({ y: 1990, m: 1, d: 1 });
    const end = civilToAbs({ y: 2100, m: 12, d: 31 });
    for (; abs <= end; abs++) {
      const c = absToCivil(abs);
      expect(civilToAbs(c)).toBe(abs);
      // greg2abs reads local-time fields, so build the Date from local fields.
      expect(greg2abs(new Date(c.y, c.m - 1, c.d))).toBe(abs);
    }
  });

  it('rejects impossible dates', () => {
    expect(() => civilToAbs({ y: 2026, m: 2, d: 30 })).toThrow(RangeError);
    expect(() => civilToAbs({ y: 2026, m: 13, d: 1 })).toThrow(RangeError);
    expect(() => absToCivil(1.5)).toThrow(RangeError);
    expect(() => civilToAbs({ y: 50, m: 1, d: 1 })).toThrow(RangeError);
  });

  it('knows the day of the week', () => {
    expect(dayOfWeek(civilToAbs({ y: 2026, m: 11, d: 23 }))).toBe(1); // Monday
    expect(dayOfWeek(civilToAbs({ y: 2026, m: 11, d: 28 }))).toBe(6); // Saturday
    expect(dayOfWeek(civilToAbs({ y: 2026, m: 9, d: 12 }))).toBe(6); // Rosh Hashanah 5787, Saturday
  });
});

describe('time zones', () => {
  it('resolves wall-clock time in a zone', () => {
    const ms = Date.UTC(2026, 10, 23, 3, 30, 0); // 03:30 UTC
    expect(localDateTime(ms, 'America/New_York')).toEqual({ y: 2026, m: 11, d: 22, hh: 22, mi: 30, ss: 0 });
    expect(localDateTime(ms, 'Asia/Jerusalem')).toEqual({ y: 2026, m: 11, d: 23, hh: 5, mi: 30, ss: 0 });
    expect(localAbs(ms, 'America/New_York')).toBe(civilToAbs({ y: 2026, m: 11, d: 22 }));
  });

  it('reports offsets across daylight-saving changes', () => {
    expect(zoneOffsetMs(Date.UTC(2026, 0, 15, 12), 'America/New_York')).toBe(-5 * 3_600_000);
    expect(zoneOffsetMs(Date.UTC(2026, 6, 15, 12), 'America/New_York')).toBe(-4 * 3_600_000);
    expect(zoneOffsetMs(Date.UTC(2026, 6, 15, 12), 'Asia/Jerusalem')).toBe(3 * 3_600_000);
    expect(zoneOffsetMs(Date.UTC(2026, 6, 15, 12), 'Asia/Kolkata')).toBe(5.5 * 3_600_000);
  });

  it('converts wall-clock time back to an instant, round-tripping every hour of a year', () => {
    for (const tz of ['America/New_York', 'Asia/Jerusalem', 'Europe/London', 'Australia/Sydney', 'America/Los_Angeles']) {
      for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2027, 0, 1); ms += 3_600_000) {
        const back = localToInstant(localDateTime(ms, tz), tz);
        // An ambiguous hour (clocks going back) resolves to its first occurrence.
        expect(back === ms || back === ms - 3_600_000).toBe(true);
        expect(localDateTime(back, tz)).toEqual(localDateTime(ms, tz));
      }
    }
  });

  it('moves a skipped wall-clock time forward past the gap', () => {
    // 8 March 2026, 02:30 does not exist in New York.
    const ms = localToInstant({ y: 2026, m: 3, d: 8, hh: 2, mi: 30, ss: 0 }, 'America/New_York');
    expect(localDateTime(ms, 'America/New_York')).toEqual({ y: 2026, m: 3, d: 8, hh: 3, mi: 30, ss: 0 });
  });

  it('the cached offsets agree with Intl at every half hour of 2024-2029, in 16 zones', () => {
    const zones = [
      'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'America/St_Johns',
      'Europe/London', 'Europe/Dublin', 'Europe/Brussels', 'Asia/Jerusalem', 'Africa/Casablanca', 'Africa/Johannesburg',
      'Asia/Kathmandu', 'Australia/Melbourne', 'Australia/Lord_Howe', 'Pacific/Chatham',
    ];
    for (const tz of zones) {
      for (let ms = Date.UTC(2024, 0, 1); ms < Date.UTC(2030, 0, 1); ms += 1_800_000) {
        if (zoneOffsetMs(ms, tz) !== zoneOffsetMsIntl(ms, tz)) {
          throw new Error(`${tz} differs at ${new Date(ms).toISOString()}`);
        }
      }
    }
  });

  it('agrees with Intl to the minute around every change of clocks, 2000-2040', () => {
    for (const tz of ['America/New_York', 'Asia/Jerusalem', 'Europe/London', 'Africa/Casablanca', 'Australia/Lord_Howe', 'America/Sao_Paulo']) {
      let changes = 0;
      for (let year = 2000; year <= 2040; year++) {
        let prev = zoneOffsetMsIntl(Date.UTC(year, 0, 1), tz);
        for (let ms = Date.UTC(year, 0, 1); ms < Date.UTC(year + 1, 0, 1); ms += 3_600_000) {
          const off = zoneOffsetMsIntl(ms, tz);
          if (off !== prev) {
            changes++;
            for (let m = ms - 2 * 3_600_000; m <= ms + 3_600_000; m += 60_000) {
              expect(zoneOffsetMs(m, tz), `${tz} ${new Date(m).toISOString()}`).toBe(zoneOffsetMsIntl(m, tz));
              expect(localDateTime(m + 999, tz)).toEqual(localDateTimeIntl(m + 999, tz));
            }
            prev = off;
          }
        }
      }
      if (tz !== 'America/Sao_Paulo') expect(changes).toBeGreaterThan(40);
    }
  });

  it('outside the cached years it asks Intl directly', () => {
    const ms = Date.UTC(1950, 5, 1, 12);
    expect(zoneOffsetMs(ms, 'America/New_York')).toBe(zoneOffsetMsIntl(ms, 'America/New_York'));
    expect(localDateTime(ms, 'Europe/London')).toEqual(localDateTimeIntl(ms, 'Europe/London'));
  });

  it('validates zone names', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});
