/**
 * The worked examples here are the ones published by Nishmat's Yoatzot
 * Halacha (yoatzot.org): Onah Beinonit, Veset Haflagah, Veset Kavua and
 * Guide to Vesatot pages, and the FAQ on a flow that began on the 30th.
 */
import { describe, expect, it } from 'vitest';
import { dayOfWeek } from '../src/engine/civil';
import { hebrewOfAbs } from '../src/engine/hebrew';
import { onahIndex, type Onah } from '../src/engine/onah';
import {
  longCycleExempt,
  vesatotAfterFlow,
  type FlowRecord,
  type OnatPerishah,
  type VesetReason,
} from '../src/engine/vesatot';
import { BASIC, M, hd, onah, withSettings } from './helpers';

const flow = (o: Onah, hefsekAbs: number | null = null): FlowRecord => ({ onah: o, hefsekAbs });

function find(onot: OnatPerishah[], o: Onah): VesetReason[] {
  return onot.find(x => x.onah.abs === o.abs && x.onah.part === o.part)?.reasons ?? [];
}

function kinds(onot: OnatPerishah[], o: Onah): string[] {
  return find(onot, o)
    .map(r => (r.kind === 'or_zarua' || r.kind === 'full_day' ? `${r.kind}:${r.of.kind}` : r.kind))
    .sort();
}

describe('onah beinonit', () => {
  it('flow by day on 1 Nisan: the day onah of 30 Nisan', () => {
    const r = vesatotAfterFlow([flow(onah(1, M.NISAN, 'day'))], 0, BASIC);
    expect(kinds(r.onot, onah(30, M.NISAN, 'day'))).toContain('beinonit');
    expect(find(r.onot, onah(30, M.NISAN, 'night'))).toEqual([]);
  });

  it('flow on the night of 2 Nisan: the night onah of 1 Iyar', () => {
    const r = vesatotAfterFlow([flow(onah(2, M.NISAN, 'night'))], 0, BASIC);
    expect(kinds(r.onot, onah(1, M.IYYAR, 'night'))).toContain('beinonit');
  });

  it('always falls four weeks and one day after the flow, on the date of veset hachodesh or the day before', () => {
    for (let abs = hd(1, M.TISHREI, 5785); abs < hd(1, M.TISHREI, 5790); abs++) {
      const r = vesatotAfterFlow([flow({ abs, part: 'day' })], 0, BASIC);
      const beinonit = r.onot.find(o => o.reasons.some(x => x.kind === 'beinonit'));
      const chodesh = r.onot.find(o => o.reasons.some(x => x.kind === 'chodesh'));
      expect(beinonit).toBeDefined();
      expect(chodesh).toBeDefined();
      expect(beinonit!.onah.abs - abs).toBe(29);
      expect(dayOfWeek(beinonit!.onah.abs)).toBe((dayOfWeek(abs) + 1) % 7);
      const gap = chodesh!.onah.abs - beinonit!.onah.abs;
      expect(gap === 0 || gap === 1).toBe(true);
    }
  });

  it('day 31 only, and days 30 and 31', () => {
    const start = onah(1, M.NISAN, 'day');
    const only31 = vesatotAfterFlow([flow(start)], 0, withSettings({ beinonitDays: '31' }));
    expect(kinds(only31.onot, { abs: start.abs + 29, part: 'day' })).not.toContain('beinonit');
    expect(kinds(only31.onot, { abs: start.abs + 30, part: 'day' })).toContain('beinonit');
    const both = vesatotAfterFlow([flow(start)], 0, withSettings({ beinonitDays: '30_31' }));
    expect(kinds(both.onot, { abs: start.abs + 29, part: 'day' })).toContain('beinonit');
    expect(kinds(both.onot, { abs: start.abs + 30, part: 'day' })).toContain('beinonit');
  });

  it('kept a full day: the night and the day of the same Hebrew date', () => {
    const byDay = vesatotAfterFlow([flow(onah(1, M.NISAN, 'day'))], 0, withSettings({ beinonitLength: 'full' }));
    expect(kinds(byDay.onot, onah(30, M.NISAN, 'day'))).toContain('beinonit');
    expect(kinds(byDay.onot, onah(30, M.NISAN, 'night'))).toEqual(['full_day:beinonit']);
    const byNight = vesatotAfterFlow([flow(onah(2, M.NISAN, 'night'))], 0, withSettings({ beinonitLength: 'full' }));
    expect(kinds(byNight.onot, onah(1, M.IYYAR, 'night'))).toContain('beinonit');
    expect(kinds(byNight.onot, onah(1, M.IYYAR, 'day'))).toContain('full_day:beinonit');
  });
});

describe('veset hachodesh', () => {
  it('flow on 4 Tishrei by day: 4 Cheshvan by day', () => {
    const r = vesatotAfterFlow([flow(onah(4, M.TISHREI, 'day'))], 0, BASIC);
    expect(kinds(r.onot, onah(4, M.CHESHVAN, 'day'))).toContain('chodesh');
  });

  it('keeps the onah of the flow', () => {
    const r = vesatotAfterFlow([flow(onah(4, M.TISHREI, 'night'))], 0, BASIC);
    expect(kinds(r.onot, onah(4, M.CHESHVAN, 'night'))).toContain('chodesh');
    expect(kinds(r.onot, onah(4, M.CHESHVAN, 'day'))).toEqual([]);
  });

  it('crosses into the next year, and through both Adars of a leap year', () => {
    // 5787 is a leap year: Shevat -> Adar I -> Adar II -> Nisan.
    const elul = vesatotAfterFlow([flow(onah(10, M.ELUL, 'day', 5786))], 0, BASIC);
    expect(kinds(elul.onot, onah(10, M.TISHREI, 'day', 5787))).toContain('chodesh');
    const shevat = vesatotAfterFlow([flow(onah(10, M.SHVAT, 'day', 5787))], 0, BASIC);
    expect(kinds(shevat.onot, onah(10, M.ADAR_I, 'day', 5787))).toContain('chodesh');
    const adar1 = vesatotAfterFlow([flow(onah(10, M.ADAR_I, 'day', 5787))], 0, BASIC);
    expect(kinds(adar1.onot, onah(10, M.ADAR_II, 'day', 5787))).toContain('chodesh');
    const adar2 = vesatotAfterFlow([flow(onah(10, M.ADAR_II, 'day', 5787))], 0, BASIC);
    expect(kinds(adar2.onot, onah(10, M.NISAN, 'day', 5787))).toContain('chodesh');
    // 5786 is a common year: Shevat -> Adar -> Nisan.
    const adar = vesatotAfterFlow([flow(onah(10, M.ADAR_I, 'day', 5786))], 0, BASIC);
    expect(kinds(adar.onot, onah(10, M.NISAN, 'day', 5786))).toContain('chodesh');
  });

  describe('flow on 30 Nisan, and Iyar has 29 days', () => {
    const start = flow(onah(30, M.NISAN, 'day'));
    const day29 = onah(29, M.IYYAR, 'day');
    const first = onah(1, M.SIVAN, 'day');

    it('the 1st of the following month (the Yoatzot Halacha ruling)', () => {
      const r = vesatotAfterFlow([start], 0, withSettings({ chodesh30: 'first_of_following' }));
      expect(kinds(r.onot, first)).toEqual(['chodesh']);
      // the onah beinonit falls on 29 Iyar, as that answer notes
      expect(kinds(r.onot, day29)).toEqual(['beinonit']);
    });
    it('the 29th', () => {
      const r = vesatotAfterFlow([start], 0, withSettings({ chodesh30: 'day29' }));
      expect(kinds(r.onot, day29)).toEqual(['beinonit', 'chodesh']);
      expect(kinds(r.onot, first)).toEqual([]);
    });
    it('both', () => {
      const r = vesatotAfterFlow([start], 0, withSettings({ chodesh30: 'both' }));
      expect(kinds(r.onot, day29)).toEqual(['beinonit', 'chodesh']);
      expect(kinds(r.onot, first)).toEqual(['chodesh']);
    });
    it('none', () => {
      const r = vesatotAfterFlow([start], 0, withSettings({ chodesh30: 'none' }));
      expect(r.onot.some(o => o.reasons.some(x => x.kind === 'chodesh'))).toBe(false);
    });
    it('a 30th followed by a 30-day month is an ordinary case', () => {
      // 30 Tishrei -> 30 Cheshvan exists only when Cheshvan is long (5783).
      const r = vesatotAfterFlow([flow(onah(30, M.TISHREI, 'day', 5783))], 0, withSettings({ chodesh30: 'none' }));
      expect(kinds(r.onot, onah(30, M.CHESHVAN, 'day', 5783))).toContain('chodesh');
    });
  });
});

describe('veset haflagah, counted in days', () => {
  const cases: Array<[string, Onah, Onah, Onah]> = [
    ['day, then day', onah(2, M.NISAN, 'day'), onah(30, M.NISAN, 'day'), onah(28, M.IYYAR, 'day')],
    ['night, then night', onah(2, M.NISAN, 'night'), onah(30, M.NISAN, 'night'), onah(28, M.IYYAR, 'night')],
    ['day, then night: the veset is at night', onah(2, M.NISAN, 'day'), onah(30, M.NISAN, 'night'), onah(28, M.IYYAR, 'night')],
    ['night, then day: the veset is by day', onah(2, M.NISAN, 'night'), onah(30, M.NISAN, 'day'), onah(28, M.IYYAR, 'day')],
  ];
  for (const [name, first, second, expected] of cases) {
    it(`2 Nisan then 30 Nisan is a 29-day interval, veset on 28 Iyar (${name})`, () => {
      const r = vesatotAfterFlow([flow(first), flow(second)], 1, BASIC);
      expect(r.intervalDays).toBe(29);
      expect(find(r.onot, expected)).toContainEqual({ kind: 'haflagah', unit: 'days', length: 29, latest: true });
      const haflagahOnot = r.onot.filter(o => o.reasons.some(x => x.kind === 'haflagah'));
      expect(haflagahOnot).toHaveLength(1);
    });
  }

  it('has no haflagah after a first flow', () => {
    const r = vesatotAfterFlow([flow(onah(2, M.NISAN, 'day'))], 0, BASIC);
    expect(r.intervalDays).toBeNull();
    expect(r.onot.some(o => o.reasons.some(x => x.kind === 'haflagah'))).toBe(false);
  });

  it('1 Nisan then 2 Iyar is 32 days: veset on 4 Sivan, veset hachodesh on 2 Sivan', () => {
    const r = vesatotAfterFlow([flow(onah(1, M.NISAN, 'day')), flow(onah(2, M.IYYAR, 'day'))], 1, BASIC);
    expect(r.intervalDays).toBe(32);
    expect(kinds(r.onot, onah(4, M.SIVAN, 'day'))).toEqual(['haflagah']);
    // Iyar has 29 days, so day 30 from 2 Iyar is also 2 Sivan. (In the published example
    // she has a veset kavua and so does not observe the onah beinonit.)
    expect(kinds(r.onot, onah(2, M.SIVAN, 'day'))).toEqual(['beinonit', 'chodesh']);
  });

  it('flows on 2 Iyar, 3 Sivan (night), 2 Tammuz (day): all three vesatot fall on 2 Av by day', () => {
    const flows = [flow(onah(2, M.IYYAR, 'day')), flow(onah(3, M.SIVAN, 'night')), flow(onah(2, M.TAMUZ, 'day'))];
    const r = vesatotAfterFlow(flows, 2, BASIC);
    expect(r.onot).toHaveLength(1);
    expect(r.onot[0]!.onah).toEqual(onah(2, M.AV, 'day'));
    expect(kinds(r.onot, onah(2, M.AV, 'day'))).toEqual(['beinonit', 'chodesh', 'haflagah']);
  });

  it('1 Nisan, 29 Nisan, 27 Iyar, 26 Sivan are 29-day intervals: next on 24 Tammuz', () => {
    const flows = [
      flow(onah(1, M.NISAN, 'day')),
      flow(onah(29, M.NISAN, 'day')),
      flow(onah(27, M.IYYAR, 'day')),
      flow(onah(26, M.SIVAN, 'day')),
    ];
    for (const i of [1, 2, 3]) expect(vesatotAfterFlow(flows, i, BASIC).intervalDays).toBe(29);
    expect(kinds(vesatotAfterFlow(flows, 3, BASIC).onot, onah(24, M.TAMUZ, 'day'))).toContain('haflagah');
  });

  describe('a shorter interval before the longer one arrived (32 days, then 29)', () => {
    const a = onah(1, M.NISAN, 'day');
    const b: Onah = { abs: a.abs + 31, part: 'day' }; // 32-day interval
    const c: Onah = { abs: b.abs + 28, part: 'day' }; // 29-day interval
    const flows = [flow(a), flow(b), flow(c)];
    const day29: Onah = { abs: c.abs + 28, part: 'day' };
    const day32: Onah = { abs: c.abs + 31, part: 'day' };

    it('latest interval only: day 29', () => {
      const r = vesatotAfterFlow(flows, 2, withSettings({ longerHaflagah: 'latest_only' }));
      expect(kinds(r.onot, day29)).toContain('haflagah');
      expect(kinds(r.onot, day32)).toEqual([]);
    });
    it('longer interval kept: days 29 and 32, both counted from the latest flow', () => {
      const r = vesatotAfterFlow(flows, 2, withSettings({ longerHaflagah: 'keep_unsurpassed' }));
      expect(find(r.onot, day29)).toContainEqual({ kind: 'haflagah', unit: 'days', length: 29, latest: true });
      expect(find(r.onot, day32)).toContainEqual({ kind: 'haflagah', unit: 'days', length: 32, latest: false });
    });
    it('the longer interval lapses once she passes it without a flow', () => {
      const d: Onah = { abs: c.abs + 33, part: 'day' }; // 34-day interval: day 32 passed
      const e: Onah = { abs: d.abs + 27, part: 'day' }; // 28-day interval
      const r = vesatotAfterFlow([...flows, flow(d), flow(e)], 4, withSettings({ longerHaflagah: 'keep_unsurpassed' }));
      const lengths = r.onot.flatMap(o => o.reasons).flatMap(x => (x.kind === 'haflagah' ? [x.length] : []));
      expect(lengths.sort((x, y) => x - y)).toEqual([28, 34]);
    });
    it('an equal interval is not a longer one and is not listed twice', () => {
      const d: Onah = { abs: c.abs + 28, part: 'day' }; // 29 again
      const r = vesatotAfterFlow([...flows, flow(d)], 3, withSettings({ longerHaflagah: 'keep_unsurpassed' }));
      const lengths = r.onot.flatMap(o => o.reasons).flatMap(x => (x.kind === 'haflagah' ? [x.length] : []));
      expect(lengths.sort((x, y) => x - y)).toEqual([29, 32]);
    });
  });
});

describe('veset haflagah, counted in onot from the hefsek taharah (Chabad)', () => {
  const chabad = withSettings({ haflagahMethod: 'onot_from_hefsek' });

  it('flow 1 Nisan, hefsek 5 Nisan, flow 29 Nisan by day (48 onot), hefsek 5 Iyar: 29 Iyar by day', () => {
    const flows = [flow(onah(1, M.NISAN, 'day'), hd(5, M.NISAN)), flow(onah(29, M.NISAN, 'day'), hd(5, M.IYYAR))];
    const r = vesatotAfterFlow(flows, 1, chabad);
    expect(find(r.onot, onah(29, M.IYYAR, 'day'))).toContainEqual({ kind: 'haflagah', unit: 'onot', length: 48, latest: true });
  });

  it('flow 1 Nisan, hefsek 5 Nisan, flow on the night of 30 Nisan (49 onot), hefsek 4 Iyar: the night of 29 Iyar', () => {
    const flows = [flow(onah(1, M.NISAN, 'day'), hd(5, M.NISAN)), flow(onah(30, M.NISAN, 'night'), hd(4, M.IYYAR))];
    const r = vesatotAfterFlow(flows, 1, chabad);
    expect(find(r.onot, onah(29, M.IYYAR, 'night'))).toContainEqual({ kind: 'haflagah', unit: 'onot', length: 49, latest: true });
  });

  it('waits for this period\'s hefsek', () => {
    const flows = [flow(onah(1, M.NISAN, 'day'), hd(5, M.NISAN)), flow(onah(29, M.NISAN, 'day'))];
    const r = vesatotAfterFlow(flows, 1, chabad);
    expect(r.notes).toContain('haflagah_awaits_hefsek');
    expect(r.onot.some(o => o.reasons.some(x => x.kind === 'haflagah'))).toBe(false);
  });

  it('says so when the previous hefsek was never recorded', () => {
    const flows = [flow(onah(1, M.NISAN, 'day')), flow(onah(29, M.NISAN, 'day'), hd(5, M.IYYAR))];
    const r = vesatotAfterFlow(flows, 1, chabad);
    expect(r.notes).toContain('haflagah_previous_hefsek_missing');
    expect(r.onot.some(o => o.reasons.some(x => x.kind === 'haflagah'))).toBe(false);
  });

  it('keeps a longer count that was not passed, when that is the custom', () => {
    const flows = [
      flow(onah(1, M.NISAN, 'day'), hd(5, M.NISAN)),
      flow(onah(1, M.IYYAR, 'day'), hd(5, M.IYYAR)), // 6 Nisan night .. 1 Iyar day = 52 onot
      flow(onah(27, M.IYYAR, 'day'), hd(2, M.SIVAN)), // 6 Iyar night .. 27 Iyar day = 44 onot
    ];
    const r = vesatotAfterFlow(flows, 2, { ...chabad, longerHaflagah: 'keep_unsurpassed' });
    const lengths = r.onot.flatMap(o => o.reasons).flatMap(x => (x.kind === 'haflagah' ? [x.length] : []));
    expect(lengths.sort((x, y) => x - y)).toEqual([44, 52]);
    // 3 Sivan night is onah 1; onah 44 is the day of 24 Sivan, onah 52 the day of 28 Sivan.
    expect(kinds(r.onot, onah(24, M.SIVAN, 'day'))).toContain('haflagah');
    expect(kinds(r.onot, onah(28, M.SIVAN, 'day'))).toContain('haflagah');
  });
});

describe('Or Zarua', () => {
  it('adds the onah before each veset onah', () => {
    const r = vesatotAfterFlow([flow(onah(1, M.NISAN, 'day'))], 0, withSettings({ orZarua: 'yes' }));
    // beinonit: day of 30 Nisan -> night of 30 Nisan
    expect(kinds(r.onot, onah(30, M.NISAN, 'night'))).toEqual(['or_zarua:beinonit']);
    // chodesh: day of 1 Iyar -> night of 1 Iyar
    expect(kinds(r.onot, onah(1, M.IYYAR, 'night'))).toEqual(['or_zarua:chodesh']);
  });

  it('before a night onah it is the day of the previous Hebrew date', () => {
    const r = vesatotAfterFlow([flow(onah(2, M.NISAN, 'night'))], 0, withSettings({ orZarua: 'yes' }));
    expect(kinds(r.onot, onah(1, M.IYYAR, 'night'))).toContain('beinonit');
    expect(kinds(r.onot, onah(30, M.NISAN, 'day'))).toEqual(['or_zarua:beinonit']);
  });

  it('with a full-day onah beinonit after a night flow: the day before, the night, and the day', () => {
    const s = withSettings({ orZarua: 'yes', beinonitLength: 'full', beinonitDays: '30' });
    const r = vesatotAfterFlow([flow(onah(2, M.NISAN, 'night'))], 0, s);
    expect(kinds(r.onot, onah(30, M.NISAN, 'day'))).toEqual(['or_zarua:beinonit']);
    expect(kinds(r.onot, onah(1, M.IYYAR, 'night'))).toContain('beinonit');
    expect(kinds(r.onot, onah(1, M.IYYAR, 'day'))).toContain('full_day:beinonit');
  });
});

describe('long cycles', () => {
  it('follows the stated rule', () => {
    expect(longCycleExempt([])).toBe(false);
    expect(longCycleExempt([32, 33])).toBe(false);
    expect(longCycleExempt([32, 33, 35])).toBe(true);
    expect(longCycleExempt([31, 32, 33, 35])).toBe(true);
    expect(longCycleExempt([32, 31, 33, 35])).toBe(false); // the three were not consecutive
    // one or two shorter cycles: she observes again
    expect(longCycleExempt([32, 33, 35, 30])).toBe(false);
    expect(longCycleExempt([32, 33, 35, 30, 29])).toBe(false);
    // another long cycle: the exemption returns at once
    expect(longCycleExempt([32, 33, 35, 30, 40])).toBe(true);
    expect(longCycleExempt([32, 33, 35, 30, 29, 40])).toBe(true);
    // three shorter cycles end it until three long ones establish it again
    expect(longCycleExempt([32, 33, 35, 30, 29, 31])).toBe(false);
    expect(longCycleExempt([32, 33, 35, 30, 29, 31, 40])).toBe(false);
    expect(longCycleExempt([32, 33, 35, 30, 29, 31, 40, 41])).toBe(false);
    expect(longCycleExempt([32, 33, 35, 30, 29, 31, 40, 41, 42])).toBe(true);
    // day 31 itself is not "after day 31"
    expect(longCycleExempt([31, 31, 31])).toBe(false);
  });

  it('drops onah beinonit and veset hachodesh but not the haflagah', () => {
    const start = hd(1, M.TISHREI);
    const flows = [0, 34, 68, 102].map(n => flow({ abs: start + n, part: 'day' })); // 35-day intervals
    const exempt = vesatotAfterFlow(flows, 3, withSettings({ longCycle: 'exempt' }));
    expect(exempt.notes).toContain('long_cycle_exempt');
    expect(exempt.onot).toHaveLength(1);
    expect(exempt.onot[0]!.reasons).toEqual([{ kind: 'haflagah', unit: 'days', length: 35, latest: true }]);
    const observing = vesatotAfterFlow(flows, 3, withSettings({ longCycle: 'observe' }));
    expect(observing.notes).not.toContain('long_cycle_exempt');
    expect(observing.onot.some(o => o.reasons.some(x => x.kind === 'beinonit'))).toBe(true);
    expect(observing.onot.some(o => o.reasons.some(x => x.kind === 'chodesh'))).toBe(true);
  });

  it('is not yet in force after only two long cycles', () => {
    const start = hd(1, M.TISHREI);
    const flows = [0, 34, 68].map(n => flow({ abs: start + n, part: 'day' }));
    const r = vesatotAfterFlow(flows, 2, withSettings({ longCycle: 'exempt' }));
    expect(r.notes).not.toContain('long_cycle_exempt');
    expect(r.onot.some(o => o.reasons.some(x => x.kind === 'beinonit'))).toBe(true);
  });
});

describe('general properties', () => {
  it('pausing vesatot returns nothing', () => {
    const r = vesatotAfterFlow([flow(onah(1, M.NISAN, 'day'))], 0, withSettings({ vesatot: 'paused' }));
    expect(r.onot).toEqual([]);
    expect(r.notes).toEqual(['paused']);
  });

  it('rejects flows that are out of order or repeated', () => {
    const a = flow(onah(1, M.NISAN, 'day'));
    const b = flow(onah(29, M.NISAN, 'day'));
    expect(() => vesatotAfterFlow([b, a], 1, BASIC)).toThrow(RangeError);
    expect(() => vesatotAfterFlow([a, a], 1, BASIC)).toThrow(RangeError);
    expect(() => vesatotAfterFlow([a], 3, BASIC)).toThrow(RangeError);
  });

  it('returns onot in order, each once, all after the flow', () => {
    const start = hd(1, M.TISHREI);
    const flows = [0, 27, 57, 85, 116].map((n, k) => flow({ abs: start + n, part: k % 2 ? 'night' : 'day' }));
    const s = withSettings({ orZarua: 'yes', beinonitDays: '30_31', beinonitLength: 'full', chodeshLength: 'full', longerHaflagah: 'keep_unsurpassed' });
    for (let i = 0; i < flows.length; i++) {
      const r = vesatotAfterFlow(flows, i, s);
      const indexes = r.onot.map(o => onahIndex(o.onah));
      expect([...indexes].sort((x, y) => x - y)).toEqual(indexes);
      expect(new Set(indexes).size).toBe(indexes.length);
      expect(indexes.every(x => x > onahIndex(flows[i]!.onah))).toBe(true);
      expect(r.onot.every(o => o.reasons.length > 0)).toBe(true);
    }
  });

  it('veset hachodesh keeps the day of the month whenever the next month has that day', () => {
    for (let abs = hd(1, M.TISHREI, 5785); abs < hd(1, M.TISHREI, 5790); abs++) {
      const r = vesatotAfterFlow([flow({ abs, part: 'night' })], 0, withSettings({ chodesh30: 'none' }));
      const chodesh = r.onot.find(o => o.reasons.some(x => x.kind === 'chodesh'));
      const from = hebrewOfAbs(abs);
      if (!chodesh) {
        expect(from.dd).toBe(30);
        continue;
      }
      const to = hebrewOfAbs(chodesh.onah.abs);
      expect(to.dd).toBe(from.dd);
      expect(chodesh.onah.abs - abs === 29 || chodesh.onah.abs - abs === 30).toBe(true);
      expect(chodesh.onah.part).toBe('night');
    }
  });
});
