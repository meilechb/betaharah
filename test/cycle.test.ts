/**
 * Examples from Yoatzot Halacha: "Minimum Wait", "Hefsek Taharah",
 * "Seven Clean Days", and the answers on immersion after Yom Kippur and
 * around Tisha B'Av.
 */
import { describe, expect, it } from 'vitest';
import { civilToAbs, dayOfWeek } from '../src/engine/civil';
import { deriveCount, processLog, sortLog, type LogEntry } from '../src/engine/cycle';
import { isNoImmersionNight, isRestDay, isShabbat, isYomTov, tishaBavObserved } from '../src/engine/holidays';
import { hebrewOfAbs } from '../src/engine/hebrew';
import { BASIC, M, hd, withSettings } from './helpers';

const SUN = civilToAbs({ y: 2026, m: 11, d: 22 }); // a Sunday
const [MON, TUE, WED, THU, FRI, SAT] = [1, 2, 3, 4, 5, 6].map(n => SUN + n) as [number, number, number, number, number, number];

describe('the test calendar', () => {
  it('starts on a Sunday', () => {
    expect(dayOfWeek(SUN)).toBe(0);
    expect(dayOfWeek(SAT)).toBe(6);
  });
});

describe('minimum wait and the seven clean days', () => {
  it('niddah on Sunday: hefsek on Thursday (day 5), Friday is the first clean day, immersion the next Thursday night', () => {
    const d = deriveCount(SUN, THU, 5);
    expect(d.earliestHefsekAbs).toBe(THU);
    expect(d.hefsekEarly).toBe(false);
    expect(d.cleanDays).toEqual([FRI, FRI + 1, FRI + 2, FRI + 3, FRI + 4, FRI + 5, FRI + 6]);
    expect(dayOfWeek(d.cleanDays![6]!)).toBe(4); // the seventh day is a Thursday
    // Thursday night belongs to the Hebrew date of Friday
    expect(d.mikvahNightAbs).toBe(THU + 8);
    expect(dayOfWeek(d.mikvahNightAbs!)).toBe(5);
  });

  it('a flow that began after sunset on Saturday belongs to Sunday', () => {
    const p = processLog([{ id: 'a', kind: 'flow', onah: { abs: SUN, part: 'night' }, veset: true }], BASIC).periods[0]!;
    expect(p.earliestHefsekAbs).toBe(THU);
  });

  it('four days: hefsek on Wednesday, Thursday is the first clean day', () => {
    const d = deriveCount(SUN, WED, 4);
    expect(d.earliestHefsekAbs).toBe(WED);
    expect(d.hefsekEarly).toBe(false);
    expect(d.cleanDays![0]).toBe(THU);
    expect(d.mikvahNightAbs).toBe(THU + 7); // Wednesday night
  });

  it('hefsek on Monday afternoon: the days are Tuesday to Monday, immersion the following Monday night', () => {
    const d = deriveCount(MON - 7, MON, 5); // niddah began well before
    expect(d.cleanDays![0]).toBe(TUE);
    expect(d.cleanDays![6]).toBe(MON + 7);
    expect(d.mikvahNightAbs).toBe(TUE + 7); // Monday night = the Hebrew date of Tuesday
  });

  it('an early hefsek on Wednesday (day 4): Thursday is a gap, Friday the first clean day, immersion Thursday night', () => {
    const d = deriveCount(SUN, WED, 5);
    expect(d.hefsekEarly).toBe(true);
    expect(d.cleanDays![0]).toBe(FRI);
    expect(d.mikvahNightAbs).toBe(THU + 8);
  });

  it('a later hefsek moves everything later', () => {
    const d = deriveCount(SUN, SAT, 5);
    expect(d.cleanDays![0]).toBe(SAT + 1);
    expect(d.mikvahNightAbs).toBe(SAT + 8);
  });

  it('without a hefsek there is no count', () => {
    const d = deriveCount(SUN, null, 5);
    expect(d.cleanDays).toBeNull();
    expect(d.mikvahNightAbs).toBeNull();
    expect(d.earliestHefsekAbs).toBe(THU);
  });

  it('the immersion night is always eight days after the first clean night and never before the wait allows', () => {
    for (let start = SUN; start < SUN + 400; start++) {
      for (const wait of [4, 5]) {
        for (let h = start; h < start + 14; h++) {
          const d = deriveCount(start, h, wait);
          expect(d.cleanDays).toHaveLength(7);
          expect(d.cleanDays![0]! > h).toBe(true);
          expect(d.cleanDays![0]! >= start + wait).toBe(true);
          expect(d.earliestMikvahAbs).toBe(d.cleanDays![6]! + 1);
          expect(d.mikvahNightAbs! >= d.earliestMikvahAbs!).toBe(true);
          expect(isNoImmersionNight(d.mikvahNightAbs!)).toBe(false);
          // earliest possible: day 5 hefsek gives immersion on the night after day 12
          expect(d.mikvahNightAbs! >= start + wait + 7).toBe(true);
        }
      }
    }
  });
});

describe('immersion is not done on the night of Yom Kippur or Tisha B\'Av', () => {
  it('Yom Kippur night moves to the night after the fast', () => {
    const yk = hd(10, M.TISHREI, 5787);
    const d = deriveCount(yk - 20, yk - 8, 5); // count ends so that immersion would be on the night of 10 Tishrei
    expect(d.earliestMikvahAbs).toBe(yk);
    expect(d.mikvahNightAbs).toBe(yk + 1);
    expect(d.postponedOver).toEqual([yk]);
  });

  it('Tisha B\'Av night moves to the night after the fast', () => {
    const tb = hd(9, M.AV, 5787);
    expect(isShabbat(tb)).toBe(false);
    expect(tishaBavObserved(5787)).toBe(tb);
    const d = deriveCount(tb - 20, tb - 8, 5);
    expect(d.mikvahNightAbs).toBe(tb + 1);
  });

  it('when 9 Av is Shabbat: Friday night is allowed, Saturday night is not, and immersion is on Sunday night', () => {
    // 9 Av 5789 falls on Shabbat (21 July 2029); the fast is observed on Sunday, 10 Av.
    const ninth = hd(9, M.AV, 5789);
    expect(isShabbat(ninth)).toBe(true);
    expect(tishaBavObserved(5789)).toBe(ninth + 1);
    expect(isNoImmersionNight(ninth)).toBe(false); // Friday night
    expect(isNoImmersionNight(ninth + 1)).toBe(true); // Saturday night, the fast begins
    const friday = deriveCount(ninth - 20, ninth - 8, 5);
    expect(friday.mikvahNightAbs).toBe(ninth);
    const saturday = deriveCount(ninth - 20, ninth - 7, 5);
    expect(saturday.earliestMikvahAbs).toBe(ninth + 1);
    expect(saturday.mikvahNightAbs).toBe(ninth + 2); // Sunday night
  });

  it('no other night of the year is excluded', () => {
    let count = 0;
    for (let abs = hd(1, M.TISHREI, 5787); abs < hd(1, M.TISHREI, 5788); abs++) if (isNoImmersionNight(abs)) count++;
    expect(count).toBe(2);
  });
});

describe('Shabbat and Yom Tov', () => {
  it('lists the days of Yom Tov, two in the diaspora and one in Israel', () => {
    const days = (where: 'diaspora' | 'israel'): string[] => {
      const out: string[] = [];
      for (let abs = hd(1, M.TISHREI, 5787); abs < hd(1, M.TISHREI, 5788); abs++) {
        if (isYomTov(abs, where)) {
          const h = hebrewOfAbs(abs);
          out.push(`${h.dd}/${h.mm}`);
        }
      }
      return out;
    };
    expect(days('diaspora')).toEqual(['1/7', '2/7', '10/7', '15/7', '16/7', '22/7', '23/7', '15/1', '16/1', '21/1', '22/1', '6/3', '7/3']);
    expect(days('israel')).toEqual(['1/7', '2/7', '10/7', '15/7', '22/7', '15/1', '21/1', '6/3']);
  });

  it('a rest day is Shabbat or Yom Tov', () => {
    expect(isRestDay(SAT, 'diaspora')).toBe(true);
    expect(isRestDay(SUN, 'diaspora')).toBe(false);
    expect(isRestDay(hd(16, M.NISAN, 5787), 'diaspora')).toBe(true);
    expect(isRestDay(hd(16, M.NISAN, 5787), 'israel')).toBe(isShabbat(hd(16, M.NISAN, 5787)));
  });
});

describe('processing the log', () => {
  const flow = (id: string, abs: number, part: 'night' | 'day' = 'day', veset = true): LogEntry => ({ id, kind: 'flow', onah: { abs, part }, veset });

  it('a whole period: flow, hefsek, immersion', () => {
    const r = processLog(
      [flow('f', SUN), { id: 'h', kind: 'hefsek', abs: THU }, { id: 'm', kind: 'mikvah', abs: THU + 8 }],
      BASIC,
    );
    expect(r.warnings).toEqual([]);
    expect(r.periods).toHaveLength(1);
    expect(r.periods[0]).toMatchObject({ cause: 'flow', hefsekAbs: THU, mikvahNightAbs: THU + 8, mikvahDoneAbs: THU + 8 });
    expect(r.flows).toEqual([{ id: 'f', onah: { abs: SUN, part: 'day' }, hefsekAbs: THU }]);
  });

  it('gives the same result whatever order the entries arrive in', () => {
    const entries: LogEntry[] = [
      flow('f1', SUN),
      { id: 'h1', kind: 'hefsek', abs: THU },
      { id: 'm1', kind: 'mikvah', abs: THU + 8 },
      flow('f2', SUN + 28, 'night'),
      { id: 'h2', kind: 'hefsek', abs: SUN + 33 },
    ];
    const expected = processLog(entries, BASIC);
    expect(processLog([...entries].reverse(), BASIC)).toEqual(expected);
    expect(processLog([entries[3]!, entries[0]!, entries[4]!, entries[2]!, entries[1]!], BASIC)).toEqual(expected);
    expect(expected.periods).toHaveLength(2);
    expect(expected.periods[1]!.mikvahDoneAbs).toBeNull();
  });

  it('a stain makes her niddah and starts the wait, but is not a flow for vesatot', () => {
    const r = processLog([{ id: 's', kind: 'stain', onah: { abs: SUN, part: 'day' } }], BASIC);
    expect(r.periods[0]).toMatchObject({ cause: 'stain', earliestHefsekAbs: THU });
    expect(r.flows).toEqual([]);
  });

  it('a flow marked not to count is niddah but not a veset flow', () => {
    const r = processLog([flow('f', SUN, 'day', false)], BASIC);
    expect(r.periods).toHaveLength(1);
    expect(r.flows).toEqual([]);
  });

  it('a stain and then a flow: the wait runs from the stain, the vesatot from the flow', () => {
    const r = processLog([{ id: 's', kind: 'stain', onah: { abs: SUN, part: 'day' } }, flow('f', TUE)], BASIC);
    expect(r.periods).toHaveLength(1);
    expect(r.periods[0]!.earliestHefsekAbs).toBe(THU);
    expect(r.flows.map(f => f.onah.abs)).toEqual([TUE]);
  });

  it('a broken count needs a new hefsek; the minimum wait is not repeated', () => {
    const r = processLog(
      [flow('f', SUN), { id: 'h1', kind: 'hefsek', abs: THU }, { id: 'b', kind: 'broken', onah: { abs: SAT, part: 'day' } }],
      BASIC,
    );
    expect(r.periods[0]).toMatchObject({ hefsekAbs: null, cleanDays: null, mikvahNightAbs: null });
    const again = processLog(
      [flow('f', SUN), { id: 'h1', kind: 'hefsek', abs: THU }, { id: 'b', kind: 'broken', onah: { abs: SAT, part: 'day' } }, { id: 'h2', kind: 'hefsek', abs: SAT }],
      BASIC,
    );
    expect(again.periods[0]).toMatchObject({ hefsekAbs: SAT, hefsekEarly: false });
    expect(again.periods[0]!.cleanDays![0]).toBe(SAT + 1);
    expect(again.periods[0]!.mikvahNightAbs).toBe(SAT + 8);
  });

  it('a flow after the hefsek cancels the count and says so', () => {
    const r = processLog([flow('f', SUN), { id: 'h', kind: 'hefsek', abs: THU }, flow('f2', SAT)], BASIC);
    expect(r.periods).toHaveLength(1);
    expect(r.periods[0]!.hefsekAbs).toBeNull();
    expect(r.warnings).toEqual([{ entryId: 'f2', code: 'count_cancelled_by_flow' }]);
  });

  it('a second hefsek replaces the first, which can only make immersion later', () => {
    const r = processLog([flow('f', SUN), { id: 'h1', kind: 'hefsek', abs: THU }, { id: 'h2', kind: 'hefsek', abs: FRI }], BASIC);
    expect(r.periods[0]!.hefsekAbs).toBe(FRI);
    expect(r.periods[0]!.mikvahNightAbs).toBe(FRI + 8);
  });

  it('ignores an immersion recorded before the count is complete, and reports it', () => {
    const r = processLog(
      [flow('f', SUN), { id: 'h', kind: 'hefsek', abs: THU }, { id: 'm', kind: 'mikvah', abs: THU + 7 }],
      BASIC,
    );
    expect(r.periods[0]!.mikvahDoneAbs).toBeNull();
    expect(r.warnings).toEqual([{ entryId: 'm', code: 'mikvah_too_early' }]);
  });

  it('accepts an immersion later than the first possible night', () => {
    const r = processLog(
      [flow('f', SUN), { id: 'h', kind: 'hefsek', abs: THU }, { id: 'm', kind: 'mikvah', abs: THU + 10 }],
      BASIC,
    );
    expect(r.periods[0]!.mikvahDoneAbs).toBe(THU + 10);
    expect(r.warnings).toEqual([]);
  });

  it('reports entries that make no sense where they are', () => {
    expect(processLog([{ id: 'h', kind: 'hefsek', abs: THU }], BASIC).warnings).toEqual([{ entryId: 'h', code: 'hefsek_without_niddah' }]);
    expect(processLog([{ id: 'm', kind: 'mikvah', abs: THU }], BASIC).warnings).toEqual([{ entryId: 'm', code: 'mikvah_without_niddah' }]);
    expect(processLog([{ id: 'b', kind: 'broken', onah: { abs: THU, part: 'day' } }], BASIC).warnings).toEqual([{ entryId: 'b', code: 'broken_without_count' }]);
    expect(processLog([flow('f', SUN), { id: 'm', kind: 'mikvah', abs: THU + 8 }], BASIC).warnings).toEqual([{ entryId: 'm', code: 'mikvah_without_hefsek' }]);
    expect(processLog([flow('f', SUN), { id: 'h', kind: 'hefsek', abs: WED }], BASIC).warnings).toEqual([{ entryId: 'h', code: 'hefsek_early' }]);
    expect(processLog([flow('f', SUN), { id: 'h', kind: 'hefsek', abs: WED }], withSettings({ minWaitDays: '4' })).warnings).toEqual([]);
  });

  it('a flow on the night of immersion, after immersing, starts a new period', () => {
    const r = processLog(
      [flow('f', SUN), { id: 'h', kind: 'hefsek', abs: THU }, flow('f2', THU + 8, 'night'), { id: 'm', kind: 'mikvah', abs: THU + 8 }],
      BASIC,
    );
    expect(r.periods).toHaveLength(2);
    expect(r.periods[0]!.mikvahDoneAbs).toBe(THU + 8);
    expect(r.periods[1]!.start).toEqual({ abs: THU + 8, part: 'night' });
  });

  it('a hefsek on the day of a flow is taken to come after it', () => {
    const sorted = sortLog([{ id: 'h', kind: 'hefsek', abs: SAT }, flow('f', SAT)]);
    expect(sorted.map(e => e.id)).toEqual(['f', 'h']);
  });

  it('records one flow per onah', () => {
    const r = processLog([flow('a', SUN), flow('b', SUN)], BASIC);
    expect(r.flows.map(f => f.id)).toEqual(['a']);
  });

  it('rejects duplicate ids', () => {
    expect(() => processLog([flow('a', SUN), flow('a', MON)], BASIC)).toThrow(RangeError);
  });

  it('gives each flow the hefsek that ended its period', () => {
    const r = processLog(
      [
        flow('f1', SUN),
        { id: 'h1', kind: 'hefsek', abs: THU },
        { id: 'b', kind: 'broken', onah: { abs: FRI, part: 'day' } },
        { id: 'h1b', kind: 'hefsek', abs: SAT },
        { id: 'm1', kind: 'mikvah', abs: SAT + 8 },
        flow('f2', SUN + 28),
      ],
      BASIC,
    );
    expect(r.flows).toEqual([
      { id: 'f1', onah: { abs: SUN, part: 'day' }, hefsekAbs: SAT },
      { id: 'f2', onah: { abs: SUN + 28, part: 'day' }, hefsekAbs: null },
    ]);
  });
});
