/**
 * The eleven halachic choices and nightfall, worded for text messages.
 *
 * Each question and option is a shortening of the dashboard's wording in
 * engine/settings.ts (HALACHIC_CHOICES and TZEIT_PRESETS), with the same
 * meaning, the same options in the same order, and the halachic terms in
 * English letters. A test checks that every setting key and every option
 * value appears here exactly once and maps to the right stored value.
 */
import { HALACHIC_CHOICES, TZEIT_PRESETS, type HalachicSettings } from '../../engine/settings';
import type { TzeitRule } from '../../engine/zmanim';

export type CustomKey = keyof HalachicSettings;
export type CustomValue = string | TzeitRule;

export interface SmsOption {
  /** The stored value. */
  value: CustomValue;
  /** The option as texted, after its letter. */
  text: string;
  /** A few words, used in confirmations and (after the letter) on the RCS button; with the letter at most 20 characters. */
  short: string;
}

export interface SmsCustom {
  key: CustomKey;
  /** Short name, used in confirmations and in the list of customs. */
  name: string;
  /** The question as texted, before the options. */
  question: string;
  /** A note after the options, or ''. */
  note: string;
  options: SmsOption[];
}

export const SMS_CUSTOMS: SmsCustom[] = [
  {
    key: 'minWaitDays',
    name: 'wait before hefsek',
    question: 'Days to wait before the hefsek, counting the day she became niddah (by a flow or a stain) as day 1.',
    note: 'For four days from the last relations, ask a rav.',
    options: [
      { value: '5', text: 'five days (Ashkenazi custom, and some Sephardi communities)', short: 'Five days' },
      { value: '4', text: 'four days (some Sephardi communities)', short: 'Four days' },
    ],
  },
  {
    key: 'beinonitDays',
    name: 'onah beinonit day',
    question: 'Onah beinonit: which day. The day of the flow is day 1.',
    note: '',
    options: [
      { value: '30', text: 'day 30 only', short: 'Day 30 only' },
      { value: '31', text: 'day 31 only', short: 'Day 31 only' },
      { value: '30_31', text: 'day 30 and day 31', short: 'Days 30 and 31' },
    ],
  },
  {
    key: 'beinonitLength',
    name: 'onah beinonit length',
    question: 'Onah beinonit: how long.',
    note: '',
    options: [
      { value: 'onah', text: 'one onah, the same as that of the flow (day or night)', short: 'One onah' },
      { value: 'full', text: 'the full day: the night and the day of that date', short: 'Full day' },
    ],
  },
  {
    key: 'chodeshLength',
    name: 'veset hachodesh length',
    question: 'Veset hachodesh: how long.',
    note: '',
    options: [
      { value: 'onah', text: 'one onah, the same as that of the flow (day or night)', short: 'One onah' },
      { value: 'full', text: 'the full day: the night and the day of that date', short: 'Full day' },
    ],
  },
  {
    key: 'orZarua',
    name: 'Or Zarua',
    question: 'The onah of the Or Zarua: separation also on the onah before each veset onah.',
    note: '',
    options: [
      { value: 'yes', text: 'observed', short: 'Observed' },
      { value: 'no', text: 'not observed', short: 'Not observed' },
    ],
  },
  {
    key: 'haflagahMethod',
    name: 'haflagah count',
    question: 'How the veset haflagah is counted.',
    note: 'Counting in onot, record the hefsek every month: the count starts from it.',
    options: [
      { value: 'days', text: 'in days, from the start of one flow to the start of the next', short: 'In days' },
      { value: 'onot_from_hefsek', text: 'in onot, from the hefsek to the next flow (Shulchan Aruch HaRav; Chabad custom)', short: 'Onot from hefsek' },
    ],
  },
  {
    key: 'longerHaflagah',
    name: 'longer haflagah',
    question: 'A longer haflagah never passed: a flow came after a shorter interval, before the day of the earlier, longer one.',
    note: '',
    options: [
      { value: 'latest_only', text: 'only the latest haflagah is observed', short: 'Latest only' },
      { value: 'keep_unsurpassed', text: 'every longer haflagah not yet passed without a flow is observed too', short: 'Keep longer ones' },
    ],
  },
  {
    key: 'chodesh30',
    name: 'flow on the 30th',
    question: 'A flow on the 30th, when the next month has 29 days.',
    note: '',
    options: [
      { value: 'first_of_following', text: 'the 1st of the month after is observed', short: '1st of next month' },
      { value: 'day29', text: 'the 29th is observed', short: 'The 29th' },
      { value: 'both', text: 'both the 29th and the 1st of the month after are observed', short: 'Both' },
      { value: 'none', text: 'no veset hachodesh that month', short: 'None that month' },
    ],
  },
  {
    key: 'longCycle',
    name: 'long cycles',
    question: 'Cycles that regularly run past day 31: three times in a row the flow began after day 31 from the one before.',
    note: '',
    options: [
      { value: 'observe', text: 'onah beinonit and veset hachodesh are observed as usual', short: 'Observed as usual' },
      { value: 'exempt', text: 'they are not observed, as long as a flow does not come earlier again', short: 'Not observed' },
    ],
  },
  {
    key: 'vesatot',
    name: 'vesatot',
    question: 'Calculating vesatot (pregnancy, nursing, or on the instruction of a rav).',
    note: '',
    options: [
      { value: 'active', text: 'vesatot are calculated', short: 'Calculated' },
      { value: 'paused', text: 'no vesatot are calculated for now', short: 'Paused' },
    ],
  },
  {
    key: 'yomTov',
    name: 'Yom Tov',
    question: 'Yom Tov.',
    note: '',
    options: [
      { value: 'diaspora', text: 'outside Israel (two days)', short: 'Outside Israel' },
      { value: 'israel', text: 'Israel', short: 'Israel' },
    ],
  },
  {
    key: 'tzeit',
    name: 'nightfall',
    question: 'Nightfall, for the time of immersion.',
    note: '',
    options: [
      { value: { kind: 'degrees', value: 8.5 }, text: 'the sun 8.5 degrees below the horizon', short: '8.5 degrees' },
      { value: { kind: 'degrees', value: 7.083 }, text: 'the sun 7.083 degrees below the horizon', short: '7.083 degrees' },
      { value: { kind: 'minutes', value: 50 }, text: '50 minutes after sunset', short: '50 minutes' },
      { value: { kind: 'minutes', value: 72 }, text: '72 minutes after sunset (Rabbeinu Tam)', short: '72 minutes' },
    ],
  },
];

/** Index of nightfall, and of the vesatot choice, in SMS_CUSTOMS. */
export const NIGHTFALL_INDEX = SMS_CUSTOMS.findIndex(c => c.key === 'tzeit');
export const VESATOT_INDEX = SMS_CUSTOMS.findIndex(c => c.key === 'vesatot');

export const LETTERS = 'ABCDEFGHIJKL';

export function sameValue(a: CustomValue, b: CustomValue): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.kind === b.kind && a.value === b.value;
}

/** The index of the option the household has now, or -1 (a nightfall typed in on the website). */
export function currentOption(c: SmsCustom, settings: HalachicSettings): number {
  const now = settings[c.key] as CustomValue;
  return c.options.findIndex(o => sameValue(o.value, now));
}

/** Describes a nightfall that is not one of the presets. */
export function tzeitWords(rule: TzeitRule): string {
  return rule.kind === 'degrees' ? `the sun ${rule.value} degrees below the horizon` : `${rule.value} minutes after sunset`;
}

/** Stores an option. */
export function applyOption(settings: HalachicSettings, c: SmsCustom, option: SmsOption): void {
  const value = typeof option.value === 'string' ? option.value : { ...option.value };
  (settings as unknown as Record<string, CustomValue>)[c.key] = value;
}

/** For the tests: the dashboard's own lists, in the same order. */
export const SOURCE = { HALACHIC_CHOICES, TZEIT_PRESETS };
