import { absOfHebrew, HEBREW_MONTHS } from '../src/engine/hebrew';
import type { Onah, OnahPart } from '../src/engine/onah';
import { DEFAULT_HALACHIC_SETTINGS, type HalachicSettings } from '../src/engine/settings';

export const M = HEBREW_MONTHS;

/** Hebrew year used by the worked examples: 5786 (a common year; Nisan 30 days, Iyar 29). */
export const YEAR = 5786;

/** R.D. number of a Hebrew date in the example year. */
export function hd(dd: number, mm: number, yy = YEAR): number {
  return absOfHebrew({ yy, mm, dd });
}

export function onah(dd: number, mm: number, part: OnahPart, yy = YEAR): Onah {
  return { abs: hd(dd, mm, yy), part };
}

/** The plainest custom: day 30 only, a single onah, no Or Zarua, latest interval only. */
export const BASIC: HalachicSettings = {
  ...DEFAULT_HALACHIC_SETTINGS,
  beinonitDays: '30',
  beinonitLength: 'onah',
  chodeshLength: 'onah',
  orZarua: 'no',
  haflagahMethod: 'days',
  longerHaflagah: 'latest_only',
  chodesh30: 'first_of_following',
  longCycle: 'observe',
};

export function withSettings(patch: Partial<HalachicSettings>): HalachicSettings {
  return { ...BASIC, ...patch };
}
