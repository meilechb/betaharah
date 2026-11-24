import { describe, expect, it } from 'vitest';
import { civilToAbs, localDateTime, localToInstant } from '../src/engine/civil';
import type { LogEntry } from '../src/engine/cycle';
import { detectPatterns } from '../src/engine/patterns';
import { sunriseMs, sunsetMs, type GeoPoint } from '../src/engine/sun';
import { buildTimeline, type EngineInput } from '../src/engine/timeline';
import { onahAt } from '../src/engine/zmanim';
import { BASIC, M, hd, onah, withSettings } from './helpers';

const LAKEWOOD: GeoPoint = { latitude: 40.0821, longitude: -74.2097, timeZone: 'America/New_York', elevation: 16 };
const ZOPTS = { useElevation: false, tzeit: BASIC.tzeit };

const at = (y: number, m: number, d: number, hh: number, mi = 0): number =>
  localToInstant({ y, m, d, hh, mi, ss: 0 }, LAKEWOOD.timeZone);

const SUN = civilToAbs({ y: 2026, m: 11, d: 22 }); // Sunday 22 November 2026

function run(entries: LogEntry[], now: number, patch = {}): ReturnType<typeof buildTimeline> {
  const input: EngineInput = { entries, settings: withSettings(patch), place: LAKEWOOD, useElevation: false, now };
  return buildTimeline(input);
}

const hm = (ms: number): string => {
  const l = localDateTime(ms, LAKEWOOD.timeZone);
  return `${l.y}-${String(l.m).padStart(2, '0')}-${String(l.d).padStart(2, '0')} ${String(l.hh).padStart(2, '0')}:${String(l.mi).padStart(2, '0')}`;
};

describe('which onah an instant falls in (Lakewood, 22 November 2026: sunrise 6:51, sunset 4:35)', () => {
  it('before sunrise is the night of the same date', () => {
    expect(onahAt(at(2026, 11, 22, 3), LAKEWOOD, ZOPTS).onah).toEqual({ abs: SUN, part: 'night' });
  });
  it('midday is the day', () => {
    expect(onahAt(at(2026, 11, 22, 12), LAKEWOOD, ZOPTS).onah).toEqual({ abs: SUN, part: 'day' });
  });
  it('after sunset is the night of the next date', () => {
    expect(onahAt(at(2026, 11, 22, 20), LAKEWOOD, ZOPTS).onah).toEqual({ abs: SUN + 1, part: 'night' });
  });
  it('changes exactly at sunrise and sunset', () => {
    const noon = onahAt(at(2026, 11, 22, 12), LAKEWOOD, ZOPTS);
    // sunrise and sunset themselves are checked against the reference library in sun.test.ts
    expect(noon.window.start).toBe(sunriseMs(SUN, LAKEWOOD));
    expect(noon.window.end).toBe(sunsetMs(SUN, LAKEWOOD));
    expect(hm(noon.window.start)).toBe('2026-11-22 06:50');
    expect(hm(noon.window.end)).toBe('2026-11-22 16:35');
    expect(onahAt(noon.window.start - 1, LAKEWOOD, ZOPTS).onah).toEqual({ abs: SUN, part: 'night' });
    expect(onahAt(noon.window.start, LAKEWOOD, ZOPTS).onah).toEqual({ abs: SUN, part: 'day' });
    expect(onahAt(noon.window.end - 1, LAKEWOOD, ZOPTS).onah).toEqual({ abs: SUN, part: 'day' });
    expect(onahAt(noon.window.end, LAKEWOOD, ZOPTS).onah).toEqual({ abs: SUN + 1, part: 'night' });
  });
  it('reports how close the instant is to the edge of the onah', () => {
    const noon = onahAt(at(2026, 11, 22, 12), LAKEWOOD, ZOPTS);
    expect(onahAt(noon.window.end - 120_000, LAKEWOOD, ZOPTS).msFromBoundary).toBe(120_000);
    expect(onahAt(noon.window.start + 30_000, LAKEWOOD, ZOPTS).msFromBoundary).toBe(30_000);
  });
});

describe('status through one period', () => {
  const flow: LogEntry = { id: 'f', kind: 'flow', onah: { abs: SUN, part: 'day' }, veset: true };
  const hefsek: LogEntry = { id: 'h', kind: 'hefsek', abs: SUN + 4 }; // Thursday 26 November

  it('with nothing recorded she is tehorah', () => {
    const t = run([], at(2026, 11, 22, 12));
    expect(t.status).toEqual({ state: 'tehorah' });
    expect(t.onot).toEqual([]);
    expect(t.periods).toEqual([]);
  });

  it('before the hefsek: the plan assumes the first day it can be done', () => {
    const t = run([flow], at(2026, 11, 23, 10));
    expect(t.status.state).toBe('niddah');
    if (t.status.state !== 'niddah') return;
    expect(t.status.phase).toEqual({ kind: 'before_hefsek', canBeDoneFrom: SUN + 4 });
    const p = t.status.period;
    expect(p.projected).toBe(true);
    expect(p.planHefsekAbs).toBe(SUN + 4);
    expect(p.hefsekSunset).toBe(sunsetMs(SUN + 4, LAKEWOOD));
    expect(hm(p.hefsekSunset).slice(0, 13)).toBe('2026-11-26 16');
    expect(p.planCleanDays.map(d => d.abs)).toEqual([5, 6, 7, 8, 9, 10, 11].map(n => SUN + n));
    expect(p.planMikvah.eveningAbs).toBe(SUN + 11); // Thursday 3 December
    expect(p.planMikvah.nightAbs).toBe(SUN + 12);
  });

  it('if the first day passes without a hefsek, the plan moves to the next day it can be done', () => {
    // Friday morning, no hefsek yet: today is still possible
    expect(run([flow], at(2026, 11, 27, 9)).periods[0]!.planHefsekAbs).toBe(SUN + 5);
    // Friday after sunset: now Saturday at the earliest
    expect(run([flow], at(2026, 11, 27, 18)).periods[0]!.planHefsekAbs).toBe(SUN + 6);
  });

  it('after the hefsek, the evening before the first clean day', () => {
    const t = run([flow, hefsek], at(2026, 11, 26, 16, 0));
    expect(t.status.state === 'niddah' && t.status.phase).toEqual({ kind: 'before_first_day' });
  });

  it('the first clean day begins at sunset after the hefsek', () => {
    const t = run([flow, hefsek], at(2026, 11, 26, 17, 0));
    expect(t.status.state === 'niddah' && t.status.phase).toEqual({ kind: 'counting', day: 1 });
    const friday = run([flow, hefsek], at(2026, 11, 27, 12));
    expect(friday.status.state === 'niddah' && friday.status.phase).toEqual({ kind: 'counting', day: 1 });
  });

  it('day 7 by day, then the night of immersion', () => {
    const day7 = run([flow, hefsek], at(2026, 12, 3, 12));
    expect(day7.status.state === 'niddah' && day7.status.phase).toEqual({ kind: 'counting', day: 7 });
    const night = run([flow, hefsek], at(2026, 12, 3, 19));
    expect(night.status.state === 'niddah' && night.status.phase).toEqual({ kind: 'mikvah_tonight' });
    expect(night.periods[0]!.projected).toBe(false);
    expect(night.periods[0]!.planMikvah.sunset).toBe(sunsetMs(SUN + 11, LAKEWOOD));
    // nightfall at 8.5 degrees is some 40 minutes after sunset
    const gap = (night.periods[0]!.planMikvah.tzeit - night.periods[0]!.planMikvah.sunset) / 60_000;
    expect(gap).toBeGreaterThan(35);
    expect(gap).toBeLessThan(50);
  });

  it('from sunrise after the night of immersion she is tehorah, with no immersion recorded', () => {
    // the night of immersion goes on until sunrise
    const before = run([flow, hefsek], at(2026, 12, 4, 6));
    expect(before.status.state === 'niddah' && before.status.phase).toEqual({ kind: 'mikvah_tonight' });
    const t = run([flow, hefsek], at(2026, 12, 4, 10));
    expect(t.status).toEqual({ state: 'tehorah' });
    expect(t.periods[0]!.mikvahDoneAbs).toBeNull();
    expect(t.warnings).toEqual([]);
    // and weeks later, still
    expect(run([flow, hefsek], at(2026, 12, 20, 10)).status).toEqual({ state: 'tehorah' });
  });

  it('after immersion she is tehorah', () => {
    const t = run([flow, hefsek, { id: 'm', kind: 'mikvah', abs: SUN + 12 }], at(2026, 12, 4, 10));
    expect(t.status).toEqual({ state: 'tehorah' });
    expect(t.periods[0]!.mikvahDoneAbs).toBe(SUN + 12);
  });

  it('notes a Friday night immersion and one after Shabbat', () => {
    // hefsek on Friday 27 November -> immersion on Friday night 4 December
    const fri = run([flow, { id: 'h', kind: 'hefsek', abs: SUN + 5 }], at(2026, 12, 1, 10));
    expect(fri.periods[0]!.planMikvah).toMatchObject({ eveningAbs: SUN + 12, restNight: true, afterRestDay: false });
    // hefsek on Shabbat 28 November -> immersion on Saturday night 5 December
    const sat = run([flow, { id: 'h', kind: 'hefsek', abs: SUN + 6 }], at(2026, 12, 1, 10));
    expect(sat.periods[0]!.planMikvah).toMatchObject({ eveningAbs: SUN + 13, restNight: false, afterRestDay: true });
  });

  it('Yom Kippur night: the phase is "postponed" and the plan is the next night', () => {
    const yk = hd(10, M.TISHREI, 5788); // Monday 11 October 2027
    const entries: LogEntry[] = [
      { id: 'f', kind: 'flow', onah: { abs: yk - 13, part: 'day' }, veset: true },
      { id: 'h', kind: 'hefsek', abs: yk - 8 },
    ];
    const erev = localToInstant({ y: 2027, m: 10, d: 10, hh: 20, mi: 0, ss: 0 }, LAKEWOOD.timeZone);
    expect(onahAt(erev, LAKEWOOD, ZOPTS).onah).toEqual({ abs: yk, part: 'night' });
    const t = run(entries, erev);
    expect(t.status.state === 'niddah' && t.status.phase).toEqual({ kind: 'postponed' });
    expect(t.periods[0]!.planMikvah).toMatchObject({ nightAbs: yk + 1, postponedOver: [yk] });
  });
});

describe('onot perishah on the timeline', () => {
  it('have their start and end times', () => {
    const flow: LogEntry = { id: 'f', kind: 'flow', onah: { abs: SUN, part: 'day' }, veset: true };
    const t = run([flow], at(2026, 11, 23, 10));
    // day 30 = Monday 21 December 2026, by day
    const beinonit = t.onot.find(o => o.reasons.some(r => r.kind === 'beinonit'));
    expect(beinonit).toBeDefined();
    expect(beinonit!.onah).toEqual({ abs: SUN + 29, part: 'day' });
    expect(beinonit!.start).toBe(sunriseMs(SUN + 29, LAKEWOOD));
    expect(beinonit!.end).toBe(sunsetMs(SUN + 29, LAKEWOOD));
    expect(hm(beinonit!.start).slice(0, 10)).toBe('2026-12-21');
    expect(hm(beinonit!.end).slice(0, 10)).toBe('2026-12-21');
    expect(beinonit!.veset).toBe(true);
  });

  it('a night onah runs from sunset on the evening before to sunrise', () => {
    const flow: LogEntry = { id: 'f', kind: 'flow', onah: { abs: SUN, part: 'night' }, veset: true };
    const t = run([flow], at(2026, 11, 23, 10));
    const beinonit = t.onot.find(o => o.reasons.some(r => r.kind === 'beinonit'))!;
    expect(beinonit.onah).toEqual({ abs: SUN + 29, part: 'night' });
    expect(beinonit.start).toBe(sunsetMs(SUN + 28, LAKEWOOD));
    expect(beinonit.end).toBe(sunriseMs(SUN + 29, LAKEWOOD));
    expect(hm(beinonit.start).slice(0, 10)).toBe('2026-12-20');
    expect(hm(beinonit.end).slice(0, 10)).toBe('2026-12-21');
  });

  it('the onot of an earlier flow stop at the next flow', () => {
    const a: LogEntry = { id: 'a', kind: 'flow', onah: { abs: SUN, part: 'day' }, veset: true };
    const b: LogEntry = { id: 'b', kind: 'flow', onah: { abs: SUN + 26, part: 'day' }, veset: true };
    const entries: LogEntry[] = [a, { id: 'h', kind: 'hefsek', abs: SUN + 4 }, { id: 'm', kind: 'mikvah', abs: SUN + 12 }, b];
    const t = run(entries, at(2026, 12, 19, 10));
    const fromA = t.onot.filter(o => o.flowId === 'a');
    expect(fromA).toEqual([]); // day 30 and the 13th of Tevet both come after the second flow
    const fromB = t.onot.filter(o => o.flowId === 'b');
    // day 30, the same day of the next month, and day 27 (the interval)
    expect(fromB.map(o => o.onah.abs)).toContain(SUN + 26 + 29);
    expect(fromB.map(o => o.onah.abs)).toContain(SUN + 26 + 26);
    expect(fromB.every(o => o.onah.abs > SUN + 26)).toBe(true);
    expect(t.latestIntervalDays).toBe(27);
    expect(fromB.some(o => o.reasons.some(r => r.kind === 'haflagah' && r.length === 27))).toBe(true);
  });

  it('keeps earlier onot that came before the next flow, for the record', () => {
    const a: LogEntry = { id: 'a', kind: 'flow', onah: { abs: SUN, part: 'day' }, veset: true };
    const b: LogEntry = { id: 'b', kind: 'flow', onah: { abs: SUN + 33, part: 'day' }, veset: true };
    const t = run([a, { id: 'h', kind: 'hefsek', abs: SUN + 4 }, { id: 'm', kind: 'mikvah', abs: SUN + 12 }, b], at(2027, 1, 5, 10));
    expect(t.onot.filter(o => o.flowId === 'a').length).toBeGreaterThan(0);
  });

  it('flags an onah that falls on the night planned for immersion', () => {
    // flow by night; previous interval makes the haflagah fall on the immersion night
    const a: LogEntry = { id: 'a', kind: 'flow', onah: { abs: SUN - 12, part: 'night' }, veset: true };
    const b: LogEntry = { id: 'b', kind: 'flow', onah: { abs: SUN, part: 'night' }, veset: true };
    const t = run([a, b, { id: 'h', kind: 'hefsek', abs: SUN + 4 }], at(2026, 11, 30, 10));
    // interval of 13 days -> haflagah on the night of SUN + 12, which is the immersion night
    const clash = t.onot.find(o => o.onah.abs === SUN + 12 && o.onah.part === 'night');
    expect(clash?.onMikvahNight).toBe(true);
    expect(t.onot.filter(o => o.onMikvahNight)).toHaveLength(1);
  });

  it('reports why there is no haflagah yet under the Chabad count', () => {
    const a: LogEntry = { id: 'a', kind: 'flow', onah: { abs: SUN - 28, part: 'day' }, veset: true };
    const b: LogEntry = { id: 'b', kind: 'flow', onah: { abs: SUN, part: 'day' }, veset: true };
    const entries: LogEntry[] = [a, { id: 'h1', kind: 'hefsek', abs: SUN - 24 }, { id: 'm1', kind: 'mikvah', abs: SUN - 16 }, b];
    const t = run(entries, at(2026, 11, 23, 10), { haflagahMethod: 'onot_from_hefsek' });
    expect(t.vesatotNotes).toEqual(['haflagah_awaits_hefsek']);
    const later = run([...entries, { id: 'h2', kind: 'hefsek', abs: SUN + 4 }], at(2026, 11, 27, 10), { haflagahMethod: 'onot_from_hefsek' });
    expect(later.vesatotNotes).toEqual([]);
    expect(later.onot.some(o => o.reasons.some(r => r.kind === 'haflagah' && r.unit === 'onot'))).toBe(true);
  });
});

describe('patterns that may be a veset kavua', () => {
  const f = (o: ReturnType<typeof onah>) => ({ onah: o, hefsekAbs: null });

  it('three months on the same date and onah', () => {
    const flows = [f(onah(1, M.NISAN, 'day')), f(onah(1, M.IYYAR, 'day')), f(onah(1, M.SIVAN, 'day'))];
    expect(detectPatterns(flows)).toEqual([{ kind: 'kavua_chodesh', dayOfMonth: 1, part: 'day' }]);
    expect(detectPatterns(flows.slice(0, 2))).toEqual([]);
  });

  it('not when one of them was at night, or a month was skipped', () => {
    expect(detectPatterns([f(onah(1, M.NISAN, 'day')), f(onah(1, M.IYYAR, 'night')), f(onah(1, M.SIVAN, 'day'))])).toEqual([]);
    expect(detectPatterns([f(onah(1, M.NISAN, 'day')), f(onah(1, M.SIVAN, 'day')), f(onah(1, M.TAMUZ, 'day'))])).toEqual([]);
  });

  it('three equal intervals; the first flow may be in the other onah', () => {
    const flows = [f(onah(1, M.NISAN, 'night')), f(onah(29, M.NISAN, 'day')), f(onah(27, M.IYYAR, 'day')), f(onah(26, M.SIVAN, 'day'))];
    expect(detectPatterns(flows)).toEqual([{ kind: 'kavua_haflagah', days: 29, part: 'day' }]);
    expect(detectPatterns(flows.slice(0, 3))).toEqual([]);
  });

  it('intervals that grow by a fixed step', () => {
    const start = hd(1, M.TISHREI);
    const flows = [0, 26, 53, 81].map(n => f({ abs: start + n, part: 'day' as const })); // 27, 28, 29
    expect(detectPatterns(flows)).toEqual([{ kind: 'dilug_haflagah', step: 1, part: 'day' }]);
  });

  it('dates that move by a fixed step', () => {
    const flows = [f(onah(5, M.NISAN, 'day')), f(onah(6, M.IYYAR, 'day')), f(onah(7, M.SIVAN, 'day'))];
    expect(detectPatterns(flows)).toContainEqual({ kind: 'dilug_chodesh', step: 1, part: 'day' });
  });

  it('nothing for an ordinary irregular history', () => {
    const start = hd(1, M.TISHREI);
    const flows = [0, 27, 57, 85, 116].map((n, k) => f({ abs: start + n, part: k % 2 ? ('night' as const) : ('day' as const) }));
    expect(detectPatterns(flows)).toEqual([]);
  });
});
