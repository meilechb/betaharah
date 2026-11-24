import { describe, expect, it } from 'vitest';
import { parseClock, parseDayWords, parseOnahWords, resolveHefsekDay, resolveMikvahNight, resolveWhen, type ResolveContext } from '../src/app/commands';
import { civilToAbs, localToInstant } from '../src/engine/civil';
import type { GeoPoint } from '../src/engine/sun';
import { dayTimes } from '../src/engine/zmanim';
import { BASIC } from './helpers';

const LAKEWOOD: GeoPoint = { latitude: 40.0821, longitude: -74.2097, timeZone: 'America/New_York', elevation: 16 };
const ZOPTS = { useElevation: false, tzeit: BASIC.tzeit };
const at = (d: number, hh: number, mi = 0): number => localToInstant({ y: 2026, m: 11, d, hh, mi, ss: 0 }, LAKEWOOD.timeZone);
const MON = civilToAbs({ y: 2026, m: 11, d: 23 });
const TUE = MON + 1;
const ctx = (now: number): ResolveContext => ({ now, place: LAKEWOOD, zopts: ZOPTS, boundaryMarginMs: 20 * 60_000 });

describe('reading when, in words (no digits are commands)', () => {
  const w = (t: string) => parseOnahWords(t.split(/\s+/));
  it('now, day, night, last night, tonight, yesterday', () => {
    expect(w('now')).toEqual({ type: 'now' });
    expect(w('night')).toEqual({ type: 'onah', part: 'night', yesterday: false });
    expect(w('last night')).toEqual({ type: 'onah', part: 'night', yesterday: false });
    expect(w('tonight')).toEqual({ type: 'onah', part: 'night', yesterday: false });
    expect(w('d')).toEqual({ type: 'onah', part: 'day', yesterday: false });
    expect(w('today by day')).toEqual({ type: 'onah', part: 'day', yesterday: false });
    expect(w('yesterday day')).toEqual({ type: 'onah', part: 'day', yesterday: true });
    expect(w('Y N')).toEqual({ type: 'onah', part: 'night', yesterday: true });
    expect(w('it began yesterday night')).toEqual({ type: 'onah', part: 'night', yesterday: true });
  });
  it('a clock time', () => {
    expect(w('9pm')).toEqual({ type: 'time', minutes: 21 * 60, yesterday: false });
    expect(w('at 9:30 PM')).toEqual({ type: 'time', minutes: 21 * 60 + 30, yesterday: false });
    expect(w('yesterday 21:30')).toEqual({ type: 'time', minutes: 21 * 60 + 30, yesterday: true });
    expect(w('6:15am')).toEqual({ type: 'time', minutes: 6 * 60 + 15, yesterday: false });
  });
  it('a hefsek: today or yesterday', () => {
    expect(parseDayWords(['today'])).toEqual({ yesterday: false });
    expect(parseDayWords(['yesterday.'])).toEqual({ yesterday: true });
    expect(parseDayWords(['it', 'was', 'yesterday'])).toEqual({ yesterday: true });
    expect(parseDayWords(['tomorrow'])).toBeNull();
    expect(parseDayWords([])).toBeNull();
  });

  it('clock times', () => {
    expect(parseClock('12am')).toBe(0);
    expect(parseClock('12pm')).toBe(720);
    expect(parseClock('12:05am')).toBe(5);
    expect(parseClock('1am')).toBe(60);
    expect(parseClock('11:59pm')).toBe(23 * 60 + 59);
    expect(parseClock('0:00')).toBe(0);
    expect(parseClock('23:59')).toBe(23 * 60 + 59);
    for (const bad of ['13pm', '0am', '24:00', '9:60', '9', '930', '9:3', 'pm', '9:30xm']) expect(parseClock(bad)).toBeNull();
  });

  it('nothing for anything it does not fully understand (then the question "when?" is asked)', () => {
    for (const t of ['', 'hello', '1', '11', '6', 'tomorrow', 'yesterday', 'day night', 'night 9pm', '9pm 10pm', 'yesterday yesterday', 'one', '1st', '25:00', 'last day', 'last', 'constructor', '__proto__ 9pm']) {
      expect(w(t), JSON.stringify(t)).toBeNull();
    }
  });
});

describe('placing an event in an onah (Lakewood; Monday 23 November 2026: sunrise about 6:51, sunset about 4:34)', () => {
  it('now', () => {
    expect(resolveWhen({ type: 'now' }, ctx(at(23, 12)))).toMatchObject({ ok: true, onah: { abs: MON, part: 'day' }, nearBoundary: null });
    expect(resolveWhen({ type: 'now' }, ctx(at(23, 21)))).toMatchObject({ ok: true, onah: { abs: TUE, part: 'night' }, nearBoundary: null });
    expect(resolveWhen({ type: 'now' }, ctx(at(23, 3)))).toMatchObject({ ok: true, onah: { abs: MON, part: 'night' }, nearBoundary: null });
  });

  it('says when the time is close to sunrise or sunset', () => {
    const sunset = dayTimes(MON, LAKEWOOD, ZOPTS).sunset;
    const justAfter = resolveWhen({ type: 'now' }, ctx(sunset + 5 * 60_000));
    expect(justAfter).toMatchObject({ ok: true, onah: { abs: TUE, part: 'night' }, nearBoundary: { boundary: sunset, msAway: 5 * 60_000 } });
    const justBefore = resolveWhen({ type: 'now' }, ctx(sunset - 5 * 60_000));
    expect(justBefore).toMatchObject({ ok: true, onah: { abs: MON, part: 'day' }, nearBoundary: { boundary: sunset, msAway: 5 * 60_000 } });
    expect(resolveWhen({ type: 'now' }, ctx(sunset - 25 * 60_000))).toMatchObject({ nearBoundary: null });
    const sunrise = dayTimes(MON, LAKEWOOD, ZOPTS).sunrise;
    expect(resolveWhen({ type: 'now' }, ctx(sunrise + 60_000))).toMatchObject({ onah: { abs: MON, part: 'day' }, nearBoundary: { boundary: sunrise } });
  });

  it('a clock time earlier today', () => {
    const r = resolveWhen({ type: 'time', minutes: 9 * 60, yesterday: false }, ctx(at(23, 12)));
    expect(r).toMatchObject({ ok: true, onah: { abs: MON, part: 'day' } });
  });

  it('a clock time that has not come yet today means yesterday', () => {
    // at 8 am, "9pm" is last night: Sunday 9 pm, the night of Monday's Hebrew date
    const r = resolveWhen({ type: 'time', minutes: 21 * 60, yesterday: false }, ctx(at(23, 8)));
    expect(r).toMatchObject({ ok: true, onah: { abs: MON, part: 'night' } });
  });

  it('a clock time yesterday', () => {
    expect(resolveWhen({ type: 'time', minutes: 14 * 60, yesterday: true }, ctx(at(23, 8)))).toMatchObject({ ok: true, onah: { abs: MON - 1, part: 'day' } });
    expect(resolveWhen({ type: 'time', minutes: 21 * 60, yesterday: true }, ctx(at(23, 22)))).toMatchObject({ ok: true, onah: { abs: MON, part: 'night' } });
  });

  it('"day" and "night" on their own mean the current or most recent one', () => {
    const day = { type: 'onah', part: 'day', yesterday: false } as const;
    const night = { type: 'onah', part: 'night', yesterday: false } as const;
    // Monday noon
    expect(resolveWhen(day, ctx(at(23, 12)))).toMatchObject({ ok: true, onah: { abs: MON, part: 'day' } });
    expect(resolveWhen(night, ctx(at(23, 12)))).toMatchObject({ ok: true, onah: { abs: MON, part: 'night' } }); // last night
    // Monday 9 pm
    expect(resolveWhen(day, ctx(at(23, 21)))).toMatchObject({ ok: true, onah: { abs: MON, part: 'day' } }); // today, before sunset
    expect(resolveWhen(night, ctx(at(23, 21)))).toMatchObject({ ok: true, onah: { abs: TUE, part: 'night' } }); // tonight
    // Tuesday 3 am
    expect(resolveWhen(day, ctx(at(24, 3)))).toMatchObject({ ok: true, onah: { abs: MON, part: 'day' } });
    expect(resolveWhen(night, ctx(at(24, 3)))).toMatchObject({ ok: true, onah: { abs: TUE, part: 'night' } });
  });

  it('"yesterday day" and "yesterday night"', () => {
    const day = { type: 'onah', part: 'day', yesterday: true } as const;
    const night = { type: 'onah', part: 'night', yesterday: true } as const;
    // Tuesday 8 am: yesterday is Monday; the night that began Monday evening is Tuesday's
    expect(resolveWhen(day, ctx(at(24, 8)))).toMatchObject({ ok: true, onah: { abs: MON, part: 'day' } });
    expect(resolveWhen(night, ctx(at(24, 8)))).toMatchObject({ ok: true, onah: { abs: TUE, part: 'night' } });
    // Tuesday 10 pm: the night that began Monday evening
    expect(resolveWhen(night, ctx(at(24, 22)))).toMatchObject({ ok: true, onah: { abs: TUE, part: 'night' } });
  });

  it('never records anything in the future', () => {
    expect(resolveWhen({ type: 'onah', part: 'day', yesterday: false }, ctx(at(23, 12)))).toMatchObject({ ok: true });
    // every result begins no later than now
    for (let hour = 0; hour < 48; hour++) {
      const now = at(23, 0) + hour * 3_600_000;
      const specs = [
        { type: 'now' } as const,
        { type: 'onah', part: 'day', yesterday: false } as const,
        { type: 'onah', part: 'night', yesterday: false } as const,
        { type: 'onah', part: 'day', yesterday: true } as const,
        { type: 'onah', part: 'night', yesterday: true } as const,
        ...[0, 6 * 60, 12 * 60, 18 * 60, 23 * 60 + 59].flatMap(minutes => [
          { type: 'time', minutes, yesterday: false } as const,
          { type: 'time', minutes, yesterday: true } as const,
        ]),
      ];
      for (const spec of specs) {
        const r = resolveWhen(spec, ctx(now));
        if (r.ok) expect(r.window.start, JSON.stringify({ hour, spec })).toBeLessThanOrEqual(now + 5 * 60_000);
      }
    }
  });
});

describe('the day of a hefsek and the night of an immersion', () => {
  it('a hefsek recorded in the afternoon or evening is today\'s', () => {
    expect(resolveHefsekDay(false, ctx(at(23, 16)))).toBe(MON);
    expect(resolveHefsekDay(false, ctx(at(23, 22)))).toBe(MON);
    expect(resolveHefsekDay(false, ctx(at(23, 9)))).toBe(MON);
  });
  it('recorded after midnight, before sunrise, it is yesterday\'s', () => {
    expect(resolveHefsekDay(false, ctx(at(24, 1)))).toBe(MON);
  });
  it('"yesterday" is the day before that', () => {
    expect(resolveHefsekDay(true, ctx(at(24, 10)))).toBe(MON);
    expect(resolveHefsekDay(true, ctx(at(24, 1)))).toBe(MON - 1);
  });
  it('an immersion recorded at night is tonight\'s; by day, last night\'s', () => {
    expect(resolveMikvahNight(false, ctx(at(23, 21)))).toBe(TUE); // Monday night
    expect(resolveMikvahNight(false, ctx(at(24, 1)))).toBe(TUE); // still Monday night
    expect(resolveMikvahNight(false, ctx(at(24, 10)))).toBe(TUE); // Tuesday morning: last night
    expect(resolveMikvahNight(true, ctx(at(24, 10)))).toBe(MON); // the night before
  });
});
