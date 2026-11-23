import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import { GeoLocation, NOAACalculator } from '@hebcal/noaa';
import { absToCivil, civilToAbs, localAbs } from '../src/engine/civil';
import { duskAtDegreesMs, sunriseMs, sunsetMs, type GeoPoint } from '../src/engine/sun';

const PLACES: Array<GeoPoint & { name: string; elevation: number }> = [
  { name: 'Lakewood', latitude: 40.0821, longitude: -74.2097, timeZone: 'America/New_York', elevation: 16 },
  { name: 'Brooklyn', latitude: 40.6501, longitude: -73.9496, timeZone: 'America/New_York', elevation: 20 },
  { name: 'Jerusalem', latitude: 31.7781, longitude: 35.2353, timeZone: 'Asia/Jerusalem', elevation: 786 },
  { name: 'Los Angeles', latitude: 34.0522, longitude: -118.2437, timeZone: 'America/Los_Angeles', elevation: 89 },
  { name: 'London', latitude: 51.5074, longitude: -0.1278, timeZone: 'Europe/London', elevation: 11 },
  { name: 'Melbourne', latitude: -37.8136, longitude: 144.9631, timeZone: 'Australia/Melbourne', elevation: 31 },
  { name: 'Johannesburg', latitude: -26.2041, longitude: 28.0473, timeZone: 'Africa/Johannesburg', elevation: 1753 },
  { name: 'Denver', latitude: 39.7392, longitude: -104.9903, timeZone: 'America/Denver', elevation: 1609 },
];

function reference(place: (typeof PLACES)[number], abs: number) {
  const c = absToCivil(abs);
  const geo = new GeoLocation(place.name, place.latitude, place.longitude, place.elevation, place.timeZone);
  const calc = new NOAACalculator(geo, new Temporal.PlainDate(c.y, c.m, c.d));
  return {
    seaSunrise: calc.getSeaLevelSunrise()?.epochMilliseconds ?? null,
    seaSunset: calc.getSeaLevelSunset()?.epochMilliseconds ?? null,
    elevSunrise: calc.getSunrise()?.epochMilliseconds ?? null,
    elevSunset: calc.getSunset()?.epochMilliseconds ?? null,
    dusk85: calc.getSunsetOffsetByDegrees(90 + 8.5)?.epochMilliseconds ?? null,
    dusk7083: calc.getSunsetOffsetByDegrees(90 + 7.083)?.epochMilliseconds ?? null,
  };
}

/** Largest difference tolerated against the reference library, in ms. */
const TOLERANCE_MS = 2_000;

describe('sunrise and sunset', () => {
  it('agrees with @hebcal/noaa to within 2 seconds, every day for two years, in 8 places', () => {
    const start = civilToAbs({ y: 2026, m: 1, d: 1 });
    const end = civilToAbs({ y: 2027, m: 12, d: 31 });
    let worst = 0;
    for (const place of PLACES) {
      for (let abs = start; abs <= end; abs++) {
        const ref = reference(place, abs);
        const pairs: Array<[number | null, number | null]> = [
          [sunriseMs(abs, place), ref.seaSunrise],
          [sunsetMs(abs, place), ref.seaSunset],
          [sunriseMs(abs, place, { useElevation: true }), ref.elevSunrise],
          [sunsetMs(abs, place, { useElevation: true }), ref.elevSunset],
          [duskAtDegreesMs(abs, place, 8.5), ref.dusk85],
          [duskAtDegreesMs(abs, place, 7.083), ref.dusk7083],
        ];
        for (const [mine, theirs] of pairs) {
          expect(mine).not.toBeNull();
          expect(theirs).not.toBeNull();
          const diff = Math.abs((mine as number) - (theirs as number));
          worst = Math.max(worst, diff);
          expect(diff).toBeLessThanOrEqual(TOLERANCE_MS);
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(TOLERANCE_MS);
  });

  it('puts every event on the requested civil date, in order', () => {
    const start = civilToAbs({ y: 2026, m: 1, d: 1 });
    for (const place of PLACES) {
      for (let abs = start; abs < start + 366; abs++) {
        const rise = sunriseMs(abs, place) as number;
        const set = sunsetMs(abs, place) as number;
        const dusk = duskAtDegreesMs(abs, place, 8.5) as number;
        expect(localAbs(rise, place.timeZone)).toBe(abs);
        expect(localAbs(set, place.timeZone)).toBe(abs);
        expect(rise).toBeLessThan(set);
        expect(set).toBeLessThan(dusk);
      }
    }
  });

  it('matches published times for New York City', () => {
    // timeanddate.com / NOAA: New York, 21 June 2026 sunrise 5:25 am, sunset 8:31 pm EDT;
    // 21 December 2026 sunrise 7:17 am, sunset 4:32 pm EST.
    const nyc: GeoPoint = { latitude: 40.7128, longitude: -74.006, timeZone: 'America/New_York' };
    const hm = (ms: number) => {
      const d = new Date(ms + (ms > Date.UTC(2026, 9, 1) ? -5 : -4) * 3_600_000);
      return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
    };
    const june = civilToAbs({ y: 2026, m: 6, d: 21 });
    const dec = civilToAbs({ y: 2026, m: 12, d: 21 });
    expect(Math.abs(hm(sunriseMs(june, nyc) as number) - (5 * 60 + 25))).toBeLessThanOrEqual(1.5);
    expect(Math.abs(hm(sunsetMs(june, nyc) as number) - (20 * 60 + 31))).toBeLessThanOrEqual(1.5);
    expect(Math.abs(hm(sunriseMs(dec, nyc) as number) - (7 * 60 + 17))).toBeLessThanOrEqual(1.5);
    expect(Math.abs(hm(sunsetMs(dec, nyc) as number) - (16 * 60 + 32))).toBeLessThanOrEqual(1.5);
  });

  it('returns null where the sun does not rise or set', () => {
    const tromso: GeoPoint = { latitude: 69.6492, longitude: 18.9553, timeZone: 'Europe/Oslo' };
    expect(sunsetMs(civilToAbs({ y: 2026, m: 6, d: 21 }), tromso)).toBeNull();
    expect(sunriseMs(civilToAbs({ y: 2026, m: 12, d: 21 }), tromso)).toBeNull();
  });

  it('handles a zone whose civil date runs a day ahead of local mean time', () => {
    const apia: GeoPoint = { latitude: -13.8333, longitude: -171.7667, timeZone: 'Pacific/Apia' };
    const abs = civilToAbs({ y: 2026, m: 11, d: 23 });
    const rise = sunriseMs(abs, apia) as number;
    const set = sunsetMs(abs, apia) as number;
    expect(localAbs(rise, apia.timeZone)).toBe(abs);
    expect(localAbs(set, apia.timeZone)).toBe(abs);
    expect(rise).toBeLessThan(set);
  });

  it('rejects bad coordinates', () => {
    expect(() => sunriseMs(739943, { latitude: 91, longitude: 0, timeZone: 'UTC' })).toThrow(RangeError);
    expect(() => sunriseMs(739943.5, { latitude: 0, longitude: 0, timeZone: 'UTC' })).toThrow(RangeError);
  });
});
