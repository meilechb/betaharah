import { describe, expect, it } from 'vitest';
import { HELP_TEXT, parseClock, parseCommand, resolveHefsekDay, resolveMikvahNight, resolveWhen, type ResolveContext } from '../src/app/commands';
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

describe('reading a message', () => {
  it('the plain codes', () => {
    expect(parseCommand('1')).toEqual({ kind: 'flow', when: { type: 'now' } });
    expect(parseCommand('2')).toEqual({ kind: 'hefsek', yesterday: false });
    expect(parseCommand('3')).toEqual({ kind: 'broken', when: { type: 'now' } });
    expect(parseCommand('4')).toEqual({ kind: 'mikvah', yesterday: false });
    expect(parseCommand('5')).toEqual({ kind: 'stain', when: { type: 'now' } });
    expect(parseCommand('9')).toEqual({ kind: 'status' });
    expect(parseCommand('0')).toEqual({ kind: 'undo' });
    expect(parseCommand(' 1 \n')).toEqual({ kind: 'flow', when: { type: 'now' } });
    expect(parseCommand('1.')).toEqual({ kind: 'flow', when: { type: 'now' } });
  });

  it('help', () => {
    for (const t of ['?', 'help', 'HELP', 'info']) expect(parseCommand(t)).toEqual({ kind: 'help' });
    expect(HELP_TEXT.length).toBeLessThanOrEqual(160);
  });

  it('when it happened', () => {
    expect(parseCommand('1 night')).toEqual({ kind: 'flow', when: { type: 'onah', part: 'night', yesterday: false } });
    expect(parseCommand('1 d')).toEqual({ kind: 'flow', when: { type: 'onah', part: 'day', yesterday: false } });
    expect(parseCommand('1 yesterday day')).toEqual({ kind: 'flow', when: { type: 'onah', part: 'day', yesterday: true } });
    expect(parseCommand('1 Y N')).toEqual({ kind: 'flow', when: { type: 'onah', part: 'night', yesterday: true } });
    expect(parseCommand('1 9pm')).toEqual({ kind: 'flow', when: { type: 'time', minutes: 21 * 60, yesterday: false } });
    expect(parseCommand('1 9:30 PM')).toEqual({ kind: 'flow', when: { type: 'time', minutes: 21 * 60 + 30, yesterday: false } });
    expect(parseCommand('5 yesterday 21:30')).toEqual({ kind: 'stain', when: { type: 'time', minutes: 21 * 60 + 30, yesterday: true } });
    expect(parseCommand('3 6:15am')).toEqual({ kind: 'broken', when: { type: 'time', minutes: 6 * 60 + 15, yesterday: false } });
    expect(parseCommand('2 yesterday')).toEqual({ kind: 'hefsek', yesterday: true });
    expect(parseCommand('4 y')).toEqual({ kind: 'mikvah', yesterday: true });
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

  it('changes nothing for anything it does not fully understand', () => {
    for (const t of [
      '', 'hello', '11', '12', '6', '7', '8', '1 tomorrow', '1 yesterday', '1 day night', '1 night 9pm', '1 9pm 10pm',
      '2 night', '2 9pm', '4 day', '9 now', '0 0', '1 yesterday yesterday', 'one', '1st', '1 25:00', '+1', '-1', '1,2',
      'stop', 'yes',
    ]) {
      expect(parseCommand(t), JSON.stringify(t)).toEqual({ kind: 'unknown' });
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

  it('does not mistake the built-in names of an object for a command', () => {
    for (const text of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'constructor day', '__proto__ 9pm']) {
      expect(parseCommand(text), text).toEqual({ kind: 'unknown' });
    }
  });
});
