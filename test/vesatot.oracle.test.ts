/**
 * A second, deliberately naive implementation of the vesatot rules, written
 * by stepping one day or one onah at a time through the calendar instead of
 * doing arithmetic. The engine must agree with it on thousands of generated
 * histories and every combination of settings.
 */
import { describe, expect, it } from 'vitest';
import { HDate } from '@hebcal/hdate';
import { onahIndex, type Onah } from '../src/engine/onah';
import type { HalachicSettings } from '../src/engine/settings';
import { vesatotAfterFlow, type FlowRecord } from '../src/engine/vesatot';
import { BASIC } from './helpers';

// deterministic pseudo-random numbers (mulberry32)
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Key = string;
const key = (abs: number, part: 'night' | 'day'): Key => `${abs}${part === 'night' ? 'N' : 'D'}`;

/** Steps one onah back: day -> the night of the same date; night -> the day of the date before. */
function stepBack(abs: number, part: 'night' | 'day'): [number, 'night' | 'day'] {
  return part === 'day' ? [abs, 'night'] : [abs - 1, 'day'];
}

function naive(flows: FlowRecord[], s: HalachicSettings): Set<Key> {
  const out = new Set<Key>();
  const last = flows[flows.length - 1]!;
  const part = last.onah.part;
  const mark = (abs: number, p: 'night' | 'day', full: boolean): void => {
    out.add(key(abs, p));
    if (full) {
      out.add(key(abs, 'night'));
      out.add(key(abs, 'day'));
    }
    if (s.orZarua === 'yes') {
      const [a, b] = stepBack(abs, p);
      out.add(key(a, b));
    }
  };

  // intervals, by walking day by day from one flow to the next
  const intervals: number[] = [];
  for (let k = 1; k < flows.length; k++) {
    let n = 1;
    for (let d = flows[k - 1]!.onah.abs; d !== flows[k]!.onah.abs; d++) n++;
    intervals.push(n);
  }

  // long-cycle exemption, replayed cycle by cycle
  let exempt = false;
  if (s.longCycle === 'exempt') {
    let established = false;
    for (let k = 0; k < intervals.length; k++) {
      const lastThree = intervals.slice(Math.max(0, k - 2), k + 1);
      if (lastThree.length === 3 && lastThree.every(n => n > 31)) established = true;
      if (lastThree.length === 3 && lastThree.every(n => n <= 31)) established = false;
    }
    exempt = established && intervals.length > 0 && intervals[intervals.length - 1]! > 31;
  }

  if (!exempt) {
    // onah beinonit: count the days off one at a time, the day of the flow being day 1
    let d = last.onah.abs;
    for (let day = 1; day < 30; day++) d++;
    if (s.beinonitDays !== '31') mark(d, part, s.beinonitLength === 'full');
    if (s.beinonitDays !== '30') mark(d + 1, part, s.beinonitLength === 'full');

    // veset hachodesh: walk forward to the next date with the same day of the month
    const from = new HDate(last.onah.abs);
    let c = last.onah.abs + 1;
    while (new HDate(c).getDate() !== from.getDate()) c++;
    const skippedAMonth = c - last.onah.abs > 31;
    if (!skippedAMonth) {
      mark(c, part, s.chodeshLength === 'full');
    } else {
      // the 30th, and the following month has only 29 days: find its 29th
      let d29 = last.onah.abs + 1;
      while (new HDate(d29).getDate() !== 29) d29++;
      if (s.chodesh30 === 'day29' || s.chodesh30 === 'both') mark(d29, part, s.chodeshLength === 'full');
      if (s.chodesh30 === 'first_of_following' || s.chodesh30 === 'both') mark(d29 + 1, part, s.chodeshLength === 'full');
    }
  }

  if (flows.length >= 2) {
    if (s.haflagahMethod === 'days') {
      const latest = intervals[intervals.length - 1]!;
      const lengths = new Set<number>([latest]);
      if (s.longerHaflagah === 'keep_unsurpassed') {
        intervals.forEach((n, k) => {
          if (n > latest && !intervals.slice(k + 1).some(later => later > n)) lengths.add(n);
        });
      }
      for (const n of lengths) {
        let d = last.onah.abs;
        for (let day = 1; day < n; day++) d++;
        mark(d, part, false);
      }
    } else {
      // count onot from the first night after each hefsek up to and including the onah of the next flow
      const counts: Array<number | null> = [];
      for (let k = 1; k < flows.length; k++) {
        const h = flows[k - 1]!.hefsekAbs;
        if (h === null) {
          counts.push(null);
          continue;
        }
        let abs = h + 1;
        let p: 'night' | 'day' = 'night';
        let n = 1;
        const target = flows[k]!.onah;
        let guard = 0;
        while (!(abs === target.abs && p === target.part)) {
          if (p === 'night') p = 'day';
          else {
            p = 'night';
            abs++;
          }
          n++;
          if (++guard > 1000) {
            n = -1;
            break;
          }
        }
        counts.push(n >= 1 ? n : null);
      }
      const latest = counts[counts.length - 1] ?? null;
      if (latest !== null && last.hefsekAbs !== null) {
        const lengths = new Set<number>([latest]);
        if (s.longerHaflagah === 'keep_unsurpassed') {
          counts.forEach((n, k) => {
            if (n !== null && n > latest && !counts.slice(k + 1).some(later => later !== null && later > n)) lengths.add(n);
          });
        }
        for (const n of lengths) {
          let abs = last.hefsekAbs + 1;
          let p: 'night' | 'day' = 'night';
          for (let i = 1; i < n; i++) {
            if (p === 'night') p = 'day';
            else {
              p = 'night';
              abs++;
            }
          }
          mark(abs, p, false);
        }
      }
    }
  }

  // nothing at or before the flow itself
  const startIndex = onahIndex(last.onah);
  for (const k of [...out]) {
    const abs = Number(k.slice(0, -1));
    const p: Onah['part'] = k.endsWith('N') ? 'night' : 'day';
    if (onahIndex({ abs, part: p }) <= startIndex) out.delete(k);
  }
  return out;
}

const OPTIONS: { [K in keyof HalachicSettings]?: Array<HalachicSettings[K]> } = {
  beinonitDays: ['30', '31', '30_31'],
  beinonitLength: ['onah', 'full'],
  chodeshLength: ['onah', 'full'],
  orZarua: ['yes', 'no'],
  haflagahMethod: ['days', 'onot_from_hefsek'],
  longerHaflagah: ['latest_only', 'keep_unsurpassed'],
  chodesh30: ['first_of_following', 'day29', 'both', 'none'],
  longCycle: ['observe', 'exempt'],
};

describe('engine agrees with the day-by-day reference', () => {
  it('on 6,000 generated histories with random settings', () => {
    const rand = rng(20261123);
    const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
    const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;
    let compared = 0;
    let thirtieths = 0;
    for (let n = 0; n < 6000; n++) {
      const settings: HalachicSettings = { ...BASIC };
      for (const [k, values] of Object.entries(OPTIONS)) {
        (settings as unknown as Record<string, unknown>)[k] = pick(values as readonly unknown[]);
      }
      const count = int(1, 8);
      let abs = 738_500 + int(0, 2_600); // Hebrew years 5783-5790
      const flows: FlowRecord[] = [];
      for (let k = 0; k < count; k++) {
        const part = rand() < 0.5 ? 'night' : 'day';
        // a hefsek 4-8 days after the flow, sometimes missing
        const hefsekAbs = rand() < 0.9 ? abs + int(4, 8) : null;
        flows.push({ onah: { abs, part }, hefsekAbs });
        const r = rand();
        abs += r < 0.05 ? int(12, 20) : r < 0.8 ? int(24, 34) : int(35, 60);
      }
      if (new HDate(flows[flows.length - 1]!.onah.abs).getDate() === 30) thirtieths++;
      const expected = [...naive(flows, settings)].sort();
      const got = vesatotAfterFlow(flows, flows.length - 1, settings)
        .onot.map(o => key(o.onah.abs, o.onah.part))
        .sort();
      expect(got, JSON.stringify({ flows, settings })).toEqual(expected);
      compared++;
    }
    expect(compared).toBe(6000);
    expect(thirtieths).toBeGreaterThan(50); // the 30th-of-the-month case is exercised
  });

  it('on every start date for five years, for the 30th-of-the-month rule in each setting', () => {
    for (const chodesh30 of ['first_of_following', 'day29', 'both', 'none'] as const) {
      for (const part of ['night', 'day'] as const) {
        const settings: HalachicSettings = { ...BASIC, chodesh30, orZarua: 'yes', beinonitDays: '30_31' };
        for (let abs = 738_500; abs < 738_500 + 1900; abs++) {
          const flows: FlowRecord[] = [{ onah: { abs, part }, hefsekAbs: null }];
          const expected = [...naive(flows, settings)].sort();
          const got = vesatotAfterFlow(flows, 0, settings)
            .onot.map(o => key(o.onah.abs, o.onah.part))
            .sort();
          expect(got).toEqual(expected);
        }
      }
    }
  });
});
