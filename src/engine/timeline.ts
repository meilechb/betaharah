/**
 * The whole picture for one household: every niddah period with its dates
 * and times, every onat perishah, the current status, and anything that
 * needs attention. A pure function of the log, the settings, the location
 * and the current time.
 */
import { localAbs } from './civil';
import { processLog, deriveCount, type LogEntry, type LogWarning, type NiddahPeriod } from './cycle';
import { isRestDay } from './holidays';
import { onahIndex, type Onah } from './onah';
import { detectPatterns, type PatternAlert } from './patterns';
import type { HalachicSettings } from './settings';
import type { GeoPoint } from './sun';
import { isVesetProper, vesatotAfterFlow, type VesatotNote, type VesetReason } from './vesatot';
import { dayTimes, onahAt, onahWindow, type ZmanimOptions } from './zmanim';

export interface EngineInput {
  entries: readonly LogEntry[];
  settings: HalachicSettings;
  place: GeoPoint;
  /** Adjust sunrise and sunset for the elevation in `place`. */
  useElevation: boolean;
  /** The current time, epoch milliseconds. */
  now: number;
  /**
   * Optional: an R.D. day before which nothing needs to be shown. Periods
   * that ended before it and onot that were superseded before it are left
   * out of the result. The whole log is still used for the calculation.
   */
  since?: number;
}

export interface OnahView {
  onah: Onah;
  /** Start of the onah, epoch ms */
  start: number;
  /** End of the onah, epoch ms */
  end: number;
  reasons: VesetReason[];
  /** The flow these are counted from. */
  flowId: string;
  /** False when the onah is only an Or Zarua onah. */
  veset: boolean;
  /** It is also the night planned for immersion. */
  onMikvahNight: boolean;
}

export interface CleanDayView {
  /** 1 to 7 */
  n: number;
  /** Hebrew date, as the R.D. number of its daytime civil date */
  abs: number;
  sunrise: number;
  sunset: number;
}

export interface MikvahView {
  /** Hebrew date whose night it is */
  nightAbs: number;
  /** Civil date of that evening */
  eveningAbs: number;
  sunset: number;
  /** Nightfall: immersion is after this time */
  tzeit: number;
  /** Nights passed over because immersion is not done on them */
  postponedOver: number[];
  /** The night is Shabbat or Yom Tov */
  restNight: boolean;
  /** The day before the night is Shabbat or Yom Tov (preparation is done earlier) */
  afterRestDay: boolean;
}

export interface PeriodView extends NiddahPeriod {
  /** Start and end of the onah in which she became niddah */
  startWindow: { start: number; end: number };
  /**
   * True while no hefsek is recorded. The plan below then assumes the hefsek
   * is done on `planHefsekAbs`, the first day it still can be.
   */
  projected: boolean;
  planHefsekAbs: number;
  /** Sunset on the day of the hefsek: it must be done before this */
  hefsekSunset: number;
  /** Minchah ketanah on that day: the hefsek is ideally done after this */
  hefsekMinchaKetana: number;
  planCleanDays: CleanDayView[];
  planMikvah: MikvahView;
  /** The night on which immersion was recorded, with its times; null while the period is open */
  doneMikvah: MikvahView | null;
}

export type Status =
  | { state: 'tehorah' }
  | {
      state: 'niddah';
      period: PeriodView;
      phase:
        /** Waiting for the hefsek taharah. */
        | { kind: 'before_hefsek'; canBeDoneFrom: number }
        /** Hefsek done; the first clean day has not begun (the evening of the hefsek, or a gap day). */
        | { kind: 'before_first_day' }
        /** In the seven clean days. */
        | { kind: 'counting'; day: number }
        /** The count is complete but immersion is passed over tonight (Yom Kippur / Tisha B'Av). */
        | { kind: 'postponed' }
        /** Tonight is the night of immersion. */
        | { kind: 'mikvah_tonight' }
        /** The night of immersion has passed and no immersion is recorded. */
        | { kind: 'mikvah_not_recorded' };
    };

export interface Timeline {
  now: number;
  /** The onah containing `now` */
  nowOnah: Onah;
  status: Status;
  periods: PeriodView[];
  /** All onot perishah, in order */
  onot: OnahView[];
  /** Notes on the vesatot of the current cycle */
  vesatotNotes: VesatotNote[];
  /** Days from the previous flow to the latest, counting both first days */
  latestIntervalDays: number | null;
  warnings: LogWarning[];
  patterns: PatternAlert[];
}

function mikvahView(
  nightAbs: number,
  postponedOver: number[],
  input: EngineInput,
  zopts: ZmanimOptions,
): MikvahView {
  const eveningAbs = nightAbs - 1;
  const t = dayTimes(eveningAbs, input.place, zopts);
  return {
    nightAbs,
    eveningAbs,
    sunset: t.sunset,
    tzeit: t.tzeit,
    postponedOver,
    restNight: isRestDay(nightAbs, input.settings.yomTov),
    afterRestDay: isRestDay(eveningAbs, input.settings.yomTov),
  };
}

export function buildTimeline(input: EngineInput): Timeline {
  const { settings, place, now } = input;
  const zopts: ZmanimOptions = { useElevation: input.useElevation, tzeit: settings.tzeit };
  const minWait = Number(settings.minWaitDays);
  const processed = processLog(input.entries, settings);
  const nowResolved = onahAt(now, place, zopts);
  const nowOnah = nowResolved.onah;
  const todayCivil = localAbs(now, place.timeZone);
  const todaySunset = dayTimes(todayCivil, place, zopts).sunset;

  const since = input.since ?? Number.NEGATIVE_INFINITY;
  const shownPeriods = processed.periods.filter(p => {
    if (p.mikvahDoneAbs !== null) return p.mikvahDoneAbs >= since;
    // a period the next one superseded with no immersion recorded: by the night she could have immersed
    return !p.endedWithoutImmersion || p.mikvahNightAbs === null || p.mikvahNightAbs >= since;
  });
  const periods: PeriodView[] = shownPeriods.map(p => {
    const projected = p.hefsekAbs === null;
    let planHefsekAbs: number;
    let plan: ReturnType<typeof deriveCount>;
    if (p.hefsekAbs !== null) {
      planHefsekAbs = p.hefsekAbs;
      plan = deriveCount(p.start.abs, p.hefsekAbs, minWait);
    } else {
      // The first day on which the hefsek can still be done.
      const stillPossible = now < todaySunset ? todayCivil : todayCivil + 1;
      planHefsekAbs = Math.max(p.earliestHefsekAbs, stillPossible);
      plan = deriveCount(p.start.abs, planHefsekAbs, minWait);
    }
    const hefsekDay = dayTimes(planHefsekAbs, place, zopts);
    if (!plan.cleanDays || plan.mikvahNightAbs === null) throw new Error('plan is incomplete');
    return {
      ...p,
      startWindow: onahWindow(p.start, place, zopts),
      projected,
      planHefsekAbs,
      hefsekSunset: hefsekDay.sunset,
      hefsekMinchaKetana: hefsekDay.minchaKetana,
      planCleanDays: plan.cleanDays.map((abs, k) => {
        const t = dayTimes(abs, place, zopts);
        return { n: k + 1, abs, sunrise: t.sunrise, sunset: t.sunset };
      }),
      planMikvah: mikvahView(plan.mikvahNightAbs, plan.postponedOver, input, zopts),
      doneMikvah: p.mikvahDoneAbs === null ? null : mikvahView(p.mikvahDoneAbs, [], input, zopts),
    };
  });

  // Vesatot: for each flow, the onot that follow it, up to the next flow.
  const onot: OnahView[] = [];
  let vesatotNotes: VesatotNote[] = [];
  let latestIntervalDays: number | null = null;
  const mikvahNights = new Set(periods.filter(p => p.mikvahDoneAbs === null && !p.endedWithoutImmersion).map(p => p.planMikvah.nightAbs));
  for (const p of periods) if (p.mikvahDoneAbs !== null) mikvahNights.add(p.mikvahDoneAbs);
  processed.flows.forEach((flow, i) => {
    const next = processed.flows[i + 1];
    if (next && next.onah.abs < since) return; // everything after this flow was superseded before the window
    const result = vesatotAfterFlow(processed.flows, i, settings);
    const limit = next ? onahIndex(next.onah) : Number.POSITIVE_INFINITY;
    for (const o of result.onot) {
      if (onahIndex(o.onah) >= limit) continue; // superseded by the next flow
      const w = onahWindow(o.onah, place, zopts);
      onot.push({
        onah: o.onah,
        start: w.start,
        end: w.end,
        reasons: o.reasons,
        flowId: flow.id,
        veset: isVesetProper(o),
        onMikvahNight: o.onah.part === 'night' && mikvahNights.has(o.onah.abs),
      });
    }
    if (i === processed.flows.length - 1) {
      vesatotNotes = result.notes;
      latestIntervalDays = result.intervalDays;
    }
  });
  onot.sort((a, b) => onahIndex(a.onah) - onahIndex(b.onah));

  // Status as of now.
  let status: Status = { state: 'tehorah' };
  const open = periods[periods.length - 1];
  if (open && open.mikvahDoneAbs === null && !open.endedWithoutImmersion) {
    const today = nowOnah.abs; // the Hebrew date that `now` belongs to
    let phase: Extract<Status, { state: 'niddah' }>['phase'];
    if (open.hefsekAbs === null || !open.cleanDays || open.mikvahNightAbs === null) {
      phase = { kind: 'before_hefsek', canBeDoneFrom: open.earliestHefsekAbs };
    } else {
      const first = open.cleanDays[0] as number;
      const seventh = open.cleanDays[6] as number;
      if (today < first) phase = { kind: 'before_first_day' };
      else if (today <= seventh) phase = { kind: 'counting', day: today - first + 1 };
      else if (today < open.mikvahNightAbs) phase = { kind: 'postponed' };
      else if (today === open.mikvahNightAbs && nowOnah.part === 'night') phase = { kind: 'mikvah_tonight' };
      else phase = { kind: 'mikvah_not_recorded' };
    }
    status = { state: 'niddah', period: open, phase };
  }

  return {
    now,
    nowOnah,
    status,
    periods,
    onot,
    vesatotNotes,
    latestIntervalDays,
    warnings: processed.warnings,
    patterns: settings.vesatot === 'paused' ? [] : detectPatterns(processed.flows),
  };
}
