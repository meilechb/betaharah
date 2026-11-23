/**
 * Onot perishah for a woman without a veset kavua: onah beinonit, veset
 * hachodesh and veset haflagah, with the variations set in HalachicSettings.
 *
 * Everything is calculated from the start of flows ("re'iyot"). The onot
 * returned are those that follow one particular flow; they stop applying
 * once the next flow begins.
 */
import { absOfHebrew, daysInHebrewMonth, hebrewOfAbs, nextHebrewMonth } from './hebrew';
import { onahFromIndex, onahIndex, otherHalfOfDay, previousOnah, type Onah } from './onah';
import type { HalachicSettings } from './settings';

export interface FlowRecord {
  /** The onah in which the flow began. */
  onah: Onah;
  /**
   * The day of the hefsek taharah that ended this period (the one whose
   * count led to immersion), or null if none is recorded. Needed only when
   * the haflagah is counted in onot from the hefsek.
   */
  hefsekAbs: number | null;
}

export type BaseReason =
  | { kind: 'beinonit'; day: 30 | 31 }
  | { kind: 'chodesh'; rule: 'same_date' | 'day29' | 'first_of_following'; dayOfMonth: number }
  | { kind: 'haflagah'; unit: 'days' | 'onot'; length: number; latest: boolean };

export type VesetReason =
  | BaseReason
  /** The other half of the Hebrew date, for those who keep the veset a full day. */
  | { kind: 'full_day'; of: BaseReason }
  /** The onah before the veset onah (Or Zarua). */
  | { kind: 'or_zarua'; of: BaseReason };

export interface OnatPerishah {
  onah: Onah;
  reasons: VesetReason[];
}

export type VesatotNote =
  /** Vesatot are switched off in the settings. */
  | 'paused'
  /** Onah beinonit and veset hachodesh are not observed: three consecutive long cycles. */
  | 'long_cycle_exempt'
  /** Haflagah in onot cannot be measured: the previous period has no hefsek recorded. */
  | 'haflagah_previous_hefsek_missing'
  /** Haflagah in onot will be added once this period's hefsek is recorded. */
  | 'haflagah_awaits_hefsek';

export interface VesatotResult {
  /** Sorted by time. */
  onot: OnatPerishah[];
  notes: VesatotNote[];
  /** Days from the previous flow's first day to this flow's first day, counting both; null for the first flow. */
  intervalDays: number | null;
}

/** A cycle is "long" when the next flow begins after day 31, i.e. on day 32 or later. */
const LONG_CYCLE_MIN_INTERVAL = 32;

/**
 * Whether the long-cycle exemption is in force for the cycle that follows
 * the last interval given. Intervals count both first days (a flow on day 32
 * is an interval of 32).
 *
 * Established by three consecutive long intervals. Once established, a
 * shorter interval suspends it for the next cycle only; a long interval
 * brings it straight back; three consecutive shorter intervals end it until
 * three consecutive long ones establish it again.
 */
export function longCycleExempt(intervals: readonly number[]): boolean {
  let established = false;
  let longRun = 0;
  let shortRun = 0;
  for (const n of intervals) {
    if (n >= LONG_CYCLE_MIN_INTERVAL) {
      longRun++;
      shortRun = 0;
      if (longRun >= 3) established = true;
    } else {
      shortRun++;
      longRun = 0;
      if (shortRun >= 3) established = false;
    }
  }
  const last = intervals[intervals.length - 1];
  return established && last !== undefined && last >= LONG_CYCLE_MIN_INTERVAL;
}

/** Checks that flows are in strictly increasing order of onah. */
export function assertFlowsSorted(flows: readonly FlowRecord[]): void {
  for (let k = 1; k < flows.length; k++) {
    const a = flows[k - 1];
    const b = flows[k];
    if (!a || !b || onahIndex(b.onah) <= onahIndex(a.onah)) {
      throw new RangeError('flows must be in strictly increasing order');
    }
  }
}

/** Interval in days ending at flow k (k >= 1), counting both first days. */
function intervalDaysAt(flows: readonly FlowRecord[], k: number): number {
  const prev = flows[k - 1];
  const cur = flows[k];
  if (!prev || !cur) throw new RangeError('flow index out of range');
  return cur.onah.abs - prev.onah.abs + 1;
}

/**
 * Interval in onot ending at flow k (k >= 1), counted from the first night
 * of the clean days that followed flow k-1 through the onah in which flow k
 * began, both included. Null if that hefsek is not recorded or the flow
 * began before those clean days.
 */
function intervalOnotAt(flows: readonly FlowRecord[], k: number): number | null {
  const prev = flows[k - 1];
  const cur = flows[k];
  if (!prev || !cur) throw new RangeError('flow index out of range');
  if (prev.hefsekAbs === null) return null;
  const firstCleanNight = onahIndex({ abs: prev.hefsekAbs + 1, part: 'night' });
  const n = onahIndex(cur.onah) - firstCleanNight + 1;
  return n >= 1 ? n : null;
}

/**
 * Lengths of earlier intervals that are longer than the latest one and that
 * no later interval has exceeded, i.e. that she has not yet passed without a
 * flow. `values[k]` is the interval ending at flow k; index 0 is unused.
 */
function unsurpassedLonger(values: ReadonlyArray<number | null>, i: number): number[] {
  const latest = values[i];
  if (latest === null || latest === undefined) return [];
  const out = new Set<number>();
  for (let k = 1; k < i; k++) {
    const v = values[k];
    if (v === null || v === undefined || v <= latest) continue;
    let surpassed = false;
    for (let j = k + 1; j <= i; j++) {
      const later = values[j];
      if (later !== null && later !== undefined && later > v) {
        surpassed = true;
        break;
      }
    }
    if (!surpassed) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * The onot perishah that follow flow number `i` (0-based) of `flows`, using
 * the history up to and including that flow.
 */
export function vesatotAfterFlow(flows: readonly FlowRecord[], i: number, settings: HalachicSettings): VesatotResult {
  assertFlowsSorted(flows);
  const flow = flows[i];
  if (!flow) throw new RangeError('flow index out of range');
  const start = flow.onah;
  const startIndex = onahIndex(start);
  const intervalDays = i >= 1 ? intervalDaysAt(flows, i) : null;

  if (settings.vesatot === 'paused') {
    return { onot: [], notes: ['paused'], intervalDays };
  }

  const notes: VesatotNote[] = [];
  const byIndex = new Map<number, VesetReason[]>();
  const add = (onah: Onah, reason: VesetReason): void => {
    const index = onahIndex(onah);
    if (index <= startIndex) return; // nothing is anticipated at or before the flow itself
    const list = byIndex.get(index);
    if (list) list.push(reason);
    else byIndex.set(index, [reason]);
  };
  const addVeset = (onah: Onah, reason: BaseReason, fullDay: boolean): void => {
    add(onah, reason);
    if (fullDay) add(otherHalfOfDay(onah), { kind: 'full_day', of: reason });
    if (settings.orZarua === 'yes') add(previousOnah(onah), { kind: 'or_zarua', of: reason });
  };

  const daysIntervals: Array<number | null> = [null];
  for (let k = 1; k <= i; k++) daysIntervals.push(intervalDaysAt(flows, k));

  const exempt =
    settings.longCycle === 'exempt' && longCycleExempt(daysIntervals.slice(1).map(n => n as number));
  if (exempt) notes.push('long_cycle_exempt');

  if (!exempt) {
    // Onah beinonit: the day of the flow is day 1.
    const fullBeinonit = settings.beinonitLength === 'full';
    if (settings.beinonitDays === '30' || settings.beinonitDays === '30_31') {
      addVeset({ abs: start.abs + 29, part: start.part }, { kind: 'beinonit', day: 30 }, fullBeinonit);
    }
    if (settings.beinonitDays === '31' || settings.beinonitDays === '30_31') {
      addVeset({ abs: start.abs + 30, part: start.part }, { kind: 'beinonit', day: 31 }, fullBeinonit);
    }

    // Veset hachodesh: the same day of the next Hebrew month.
    const fullChodesh = settings.chodeshLength === 'full';
    const h = hebrewOfAbs(start.abs);
    const next = nextHebrewMonth(h.yy, h.mm);
    const nextLength = daysInHebrewMonth(next.yy, next.mm);
    if (h.dd <= nextLength) {
      addVeset(
        { abs: absOfHebrew({ ...next, dd: h.dd }), part: start.part },
        { kind: 'chodesh', rule: 'same_date', dayOfMonth: h.dd },
        fullChodesh,
      );
    } else {
      // The flow began on the 30th and the next month has 29 days.
      const day29 = absOfHebrew({ ...next, dd: 29 });
      if (settings.chodesh30 === 'day29' || settings.chodesh30 === 'both') {
        addVeset({ abs: day29, part: start.part }, { kind: 'chodesh', rule: 'day29', dayOfMonth: h.dd }, fullChodesh);
      }
      if (settings.chodesh30 === 'first_of_following' || settings.chodesh30 === 'both') {
        addVeset(
          { abs: day29 + 1, part: start.part },
          { kind: 'chodesh', rule: 'first_of_following', dayOfMonth: h.dd },
          fullChodesh,
        );
      }
    }
  }

  // Veset haflagah. Always a single onah, also for those who keep the others a full day.
  if (i >= 1) {
    const keep = settings.longerHaflagah === 'keep_unsurpassed';
    if (settings.haflagahMethod === 'days') {
      const latest = daysIntervals[i] as number;
      const lengths = [latest, ...(keep ? unsurpassedLonger(daysIntervals, i) : [])];
      for (const length of lengths) {
        addVeset(
          { abs: start.abs + length - 1, part: start.part },
          { kind: 'haflagah', unit: 'days', length, latest: length === latest },
          false,
        );
      }
    } else {
      const onotIntervals: Array<number | null> = [null];
      for (let k = 1; k <= i; k++) onotIntervals.push(intervalOnotAt(flows, k));
      const latest = onotIntervals[i] ?? null;
      if (latest === null) {
        notes.push('haflagah_previous_hefsek_missing');
      } else if (flow.hefsekAbs === null) {
        notes.push('haflagah_awaits_hefsek');
      } else {
        const firstCleanNight = onahIndex({ abs: flow.hefsekAbs + 1, part: 'night' });
        const lengths = [latest, ...(keep ? unsurpassedLonger(onotIntervals, i) : [])];
        for (const length of lengths) {
          addVeset(
            onahFromIndex(firstCleanNight + length - 1),
            { kind: 'haflagah', unit: 'onot', length, latest: length === latest },
            false,
          );
        }
      }
    }
  }

  const onot = [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, reasons]) => ({ onah: onahFromIndex(index), reasons }));
  return { onot, notes, intervalDays };
}

/** True if the onah is itself a veset onah, not only an Or Zarua onah before one. */
export function isVesetProper(o: OnatPerishah): boolean {
  return o.reasons.some(r => r.kind !== 'or_zarua');
}
