/**
 * From the log of recorded events to niddah periods and the list of flows.
 *
 * A niddah period begins with a flow or a stain and ends with immersion.
 * Within it: the minimum wait, the hefsek taharah, the seven clean days,
 * and the night of immersion. Once a hefsek taharah is recorded and the
 * seven clean days are complete, she is taken to have immersed on the night
 * of immersion: nothing has to record it. An immersion that is recorded
 * closes the period on its own night.
 */
import { isNoImmersionNight } from './holidays';
import { onahIndex, type Onah } from './onah';
import type { HalachicSettings } from './settings';
import type { FlowRecord } from './vesatot';

export type LogEntry =
  /** A flow began in this onah. `veset: false` records a flow that is not counted for vesatot. */
  | { id: string; kind: 'flow'; onah: Onah; veset: boolean }
  /** Became niddah without a flow (a stain, a bedikah). Does not create vesatot. */
  | { id: string; kind: 'stain'; onah: Onah }
  /** A valid hefsek taharah was done on this day, before sunset. */
  | { id: string; kind: 'hefsek'; abs: number }
  /** The count of clean days was broken in this onah; a new hefsek is needed. */
  | { id: string; kind: 'broken'; onah: Onah }
  /** Immersed on the night that begins Hebrew date `abs` (the evening of the civil date before). */
  | { id: string; kind: 'mikvah'; abs: number };

export type LogWarningCode =
  /** Hefsek recorded while not niddah; ignored. */
  | 'hefsek_without_niddah'
  /** Hefsek dated before the period began; ignored. */
  | 'hefsek_before_start'
  /** Hefsek before the minimum wait was over; the clean days start only after the wait. */
  | 'hefsek_early'
  /** "Count broken" recorded when there was no count; ignored. */
  | 'broken_without_count'
  /** Immersion recorded while not niddah; ignored. */
  | 'mikvah_without_niddah'
  /** Immersion recorded with no valid hefsek; ignored. */
  | 'mikvah_without_hefsek'
  /** Immersion recorded before the seven clean days were complete; ignored. */
  | 'mikvah_too_early'
  /** Immersion recorded on the night of Yom Kippur or Tisha B'Av. Recorded as entered. */
  | 'mikvah_on_fast_night'
  /** A flow or stain after the hefsek cancelled the count. */
  | 'count_cancelled_by_flow'
  /**
   * A flow or stain came when the period before it has no hefsek taharah
   * recorded, on or after the night that would have been its first night of
   * immersion. It is taken as the start of a new period, with the days of
   * waiting, which is the stricter reading of an incomplete record.
   */
  | 'period_began_without_hefsek';

export interface LogWarning {
  entryId: string;
  code: LogWarningCode;
}

export interface NiddahPeriod {
  /** The onah in which she became niddah. Its Hebrew date is day 1 of the minimum wait. */
  start: Onah;
  startId: string;
  cause: 'flow' | 'stain';
  /** First day on which the hefsek taharah may be done. */
  earliestHefsekAbs: number;
  /** Day of the hefsek now in force, or null. */
  hefsekAbs: number | null;
  hefsekId: string | null;
  /** The hefsek was done before `earliestHefsekAbs`. */
  hefsekEarly: boolean;
  /** Hebrew dates of the seven clean days (their daytime civil dates), or null without a hefsek. */
  cleanDays: number[] | null;
  /** Hebrew date whose night is the first on which the count allows immersion, before any postponement. */
  earliestMikvahAbs: number | null;
  /** Hebrew date whose night is the night of immersion, after skipping Yom Kippur / Tisha B'Av nights. */
  mikvahNightAbs: number | null;
  /** Nights skipped because immersion is not done on them. */
  postponedOver: number[];
  /** Hebrew date on whose night an immersion was recorded, or null. */
  mikvahDoneAbs: number | null;
  mikvahId: string | null;
  /**
   * True when the next period began with no recorded immersion for this one:
   * after its night of immersion (she is taken to have immersed then), or,
   * with no hefsek taharah, as 'period_began_without_hefsek' says. The
   * period is then not open any more, although `mikvahDoneAbs` is null.
   */
  closedByNextPeriod: boolean;
}

export interface ProcessedLog {
  /** In order; only the last can be open (mikvahDoneAbs === null and not closedByNextPeriod). */
  periods: NiddahPeriod[];
  /** Flows that count for vesatot, in order, with their entry ids. */
  flows: Array<FlowRecord & { id: string }>;
  warnings: LogWarning[];
}

/** Dates that follow from a period's start and hefsek. */
export function deriveCount(
  startAbs: number,
  hefsekAbs: number | null,
  minWaitDays: number,
): Pick<NiddahPeriod, 'earliestHefsekAbs' | 'hefsekEarly' | 'cleanDays' | 'earliestMikvahAbs' | 'mikvahNightAbs' | 'postponedOver'> {
  if (!Number.isInteger(minWaitDays) || minWaitDays < 1) throw new RangeError('minWaitDays must be a positive integer');
  const earliestHefsekAbs = startAbs + minWaitDays - 1;
  if (hefsekAbs === null) {
    return { earliestHefsekAbs, hefsekEarly: false, cleanDays: null, earliestMikvahAbs: null, mikvahNightAbs: null, postponedOver: [] };
  }
  // The first clean day is the day after the hefsek, and never before the wait is over.
  const first = Math.max(hefsekAbs + 1, startAbs + minWaitDays);
  const cleanDays = Array.from({ length: 7 }, (_, k) => first + k);
  // Immersion is on the night after the seventh day: the night that begins the next Hebrew date.
  const earliestMikvahAbs = first + 7;
  let mikvahNightAbs = earliestMikvahAbs;
  const postponedOver: number[] = [];
  while (isNoImmersionNight(mikvahNightAbs)) {
    postponedOver.push(mikvahNightAbs);
    mikvahNightAbs++;
  }
  return { earliestHefsekAbs, hefsekEarly: hefsekAbs < earliestHefsekAbs, cleanDays, earliestMikvahAbs, mikvahNightAbs, postponedOver };
}

/**
 * Whether a flow or stain in `onah` comes after the open period `p` is over,
 * so that it begins a new period rather than continuing `p`:
 *   - `p` has a hefsek taharah and its seven clean days are over (the flow
 *     is on the first night she could have immersed, or later: she is taken
 *     to have immersed); or
 *   - `p` has no hefsek taharah at all, and the flow comes on or after the
 *     night that would have been the earliest night of immersion had the
 *     hefsek been done on the first day it could be.
 * Before that, bleeding continues `p` (and voids a count in progress).
 */
function unclosed(p: NiddahPeriod, onah: Onah, minWaitDays: number): boolean {
  if (p.earliestMikvahAbs !== null) return onah.abs >= p.earliestMikvahAbs;
  return onah.abs >= p.start.abs + minWaitDays + 7;
}

/**
 * Whether an onah comes after the night of immersion of `p`, which has a
 * hefsek taharah: she is taken to have immersed on that night, so a hefsek
 * or a broken count recorded after it has no period to belong to.
 */
function afterImmersionNight(p: NiddahPeriod, onah: Onah): boolean {
  return p.mikvahNightAbs !== null && onahIndex(onah) > onahIndex({ abs: p.mikvahNightAbs, part: 'night' });
}

/** Where an entry falls in time: an onah index, then an order within the onah. */
function position(e: LogEntry): number {
  switch (e.kind) {
    case 'mikvah':
      // at nightfall, the start of the night onah
      return onahIndex({ abs: e.abs, part: 'night' }) * 10;
    case 'broken':
    case 'flow':
    case 'stain':
      return onahIndex(e.onah) * 10 + 2;
    case 'hefsek':
      // late in the day onah, before sunset
      return onahIndex({ abs: e.abs, part: 'day' }) * 10 + 5;
  }
}

/** Entries in the order in which they are applied. */
export function sortLog(entries: readonly LogEntry[]): LogEntry[] {
  return entries
    .map((e, seq) => ({ e, seq, pos: position(e) }))
    .sort((a, b) => a.pos - b.pos || a.seq - b.seq)
    .map(x => x.e);
}

export function processLog(entries: readonly LogEntry[], settings: HalachicSettings): ProcessedLog {
  const minWait = Number(settings.minWaitDays);
  const periods: NiddahPeriod[] = [];
  const warnings: LogWarning[] = [];
  const flowEntries: Array<{ id: string; onah: Onah; period: NiddahPeriod }> = [];
  const ids = new Set<string>();
  let open: NiddahPeriod | null = null;

  const setHefsek = (p: NiddahPeriod, abs: number | null, id: string | null): void => {
    p.hefsekAbs = abs;
    p.hefsekId = id;
    Object.assign(p, deriveCount(p.start.abs, abs, minWait));
  };

  for (const e of sortLog(entries)) {
    if (ids.has(e.id)) throw new RangeError(`duplicate log entry id "${e.id}"`);
    ids.add(e.id);
    switch (e.kind) {
      case 'flow':
      case 'stain': {
        if (open && unclosed(open, e.onah, minWait)) {
          // With a hefsek and a complete count, she is taken to have immersed: this is a new period.
          // With no hefsek recorded, the record is incomplete: this is taken as a new period too, and said.
          if (open.hefsekAbs === null) warnings.push({ entryId: e.id, code: 'period_began_without_hefsek' });
          open.closedByNextPeriod = true;
          open = null;
        }
        if (!open) {
          open = {
            start: e.onah,
            startId: e.id,
            cause: e.kind,
            hefsekAbs: null,
            hefsekId: null,
            mikvahDoneAbs: null,
            mikvahId: null,
            closedByNextPeriod: false,
            ...deriveCount(e.onah.abs, null, minWait),
          };
          periods.push(open);
        } else if (open.hefsekAbs !== null) {
          // Bleeding after the hefsek: the count is void. The minimum wait is not started again.
          setHefsek(open, null, null);
          warnings.push({ entryId: e.id, code: 'count_cancelled_by_flow' });
        }
        if (e.kind === 'flow' && e.veset) {
          const previous = flowEntries[flowEntries.length - 1];
          if (previous && onahIndex(previous.onah) === onahIndex(e.onah)) break; // same onah recorded twice
          flowEntries.push({ id: e.id, onah: e.onah, period: open });
        }
        break;
      }
      case 'hefsek': {
        if (!open || afterImmersionNight(open, { abs: e.abs, part: 'day' })) {
          warnings.push({ entryId: e.id, code: 'hefsek_without_niddah' });
        } else if (e.abs < open.start.abs) {
          warnings.push({ entryId: e.id, code: 'hefsek_before_start' });
        } else {
          setHefsek(open, e.abs, e.id);
          if (open.hefsekEarly) warnings.push({ entryId: e.id, code: 'hefsek_early' });
        }
        break;
      }
      case 'broken': {
        if (!open || open.hefsekAbs === null || afterImmersionNight(open, e.onah)) {
          warnings.push({ entryId: e.id, code: 'broken_without_count' });
        } else {
          setHefsek(open, null, null);
        }
        break;
      }
      case 'mikvah': {
        if (!open) {
          warnings.push({ entryId: e.id, code: 'mikvah_without_niddah' });
        } else if (open.hefsekAbs === null || open.earliestMikvahAbs === null) {
          warnings.push({ entryId: e.id, code: 'mikvah_without_hefsek' });
        } else if (e.abs < open.earliestMikvahAbs) {
          warnings.push({ entryId: e.id, code: 'mikvah_too_early' });
        } else {
          if (isNoImmersionNight(e.abs)) warnings.push({ entryId: e.id, code: 'mikvah_on_fast_night' });
          open.mikvahDoneAbs = e.abs;
          open.mikvahId = e.id;
          open = null;
        }
        break;
      }
    }
  }

  const flows = flowEntries.map(f => ({ id: f.id, onah: f.onah, hefsekAbs: f.period.hefsekAbs }));
  return { periods, flows, warnings };
}
