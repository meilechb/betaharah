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
  /** A few words, used in confirmations and after "Now:". */
  short: string;
}

export interface SmsCustom {
  key: CustomKey;
  /** Short name, used in confirmations and in the list of customs. */
  name: string;
  /** The question as texted, with its options in words (the registry adds "Now:"). */
  question: string;
  /** A note after the options, or ''. */
  note: string;
  options: SmsOption[];
}

export const SMS_CUSTOMS: SmsCustom[] = [
  {
    key: 'minWaitDays',
    name: 'wait before hefsek',
    question: 'Days before the hefsek, the day she became niddah being day 1: five (Ashkenazi, some Sephardi) or four (some Sephardi).',
    note: '',
    options: [
      { value: '5', text: 'five (Ashkenazi, some Sephardi)', short: 'Five days' },
      { value: '4', text: 'four (some Sephardi)', short: 'Four days' },
    ],
  },
  {
    key: 'beinonitDays',
    name: 'onah beinonit day',
    question: 'Onah beinonit (the flow is day 1): day 30, day 31, or both.',
    note: '',
    options: [
      { value: '30', text: 'day 30', short: 'Day 30' },
      { value: '31', text: 'day 31', short: 'Day 31' },
      { value: '30_31', text: 'days 30 and 31', short: 'Both' },
    ],
  },
  {
    key: 'beinonitLength',
    name: 'onah beinonit length',
    question: 'Onah beinonit length: the onah of the flow, or the full day.',
    note: '',
    options: [
      { value: 'onah', text: 'the onah of the flow', short: 'One onah' },
      { value: 'full', text: 'the full day', short: 'Full day' },
    ],
  },
  {
    key: 'chodeshLength',
    name: 'veset hachodesh length',
    question: 'Veset hachodesh length: the onah of the flow, or the full day.',
    note: '',
    options: [
      { value: 'onah', text: 'the onah of the flow', short: 'One onah' },
      { value: 'full', text: 'the full day', short: 'Full day' },
    ],
  },
  {
    key: 'orZarua',
    name: 'Or Zarua',
    question: 'Or Zarua, the onah before each veset onah: observed or not.',
    note: '',
    options: [
      { value: 'yes', text: 'observed', short: 'Observed' },
      { value: 'no', text: 'not observed', short: 'Not observed' },
    ],
  },
  {
    key: 'haflagahMethod',
    name: 'haflagah count',
    question: 'Veset haflagah counted in days, flow to flow, or in onot, hefsek to flow (Chabad).',
    note: '',
    options: [
      { value: 'days', text: 'in days, flow to flow', short: 'In days' },
      { value: 'onot_from_hefsek', text: 'in onot, hefsek to flow (Chabad)', short: 'In onot' },
    ],
  },
  {
    key: 'longerHaflagah',
    name: 'longer haflagah',
    question: 'A longer haflagah not yet passed: only the latest is kept, or longer ones too.',
    note: '',
    options: [
      { value: 'latest_only', text: 'only the latest', short: 'Latest only' },
      { value: 'keep_unsurpassed', text: 'kept too', short: 'Longer ones too' },
    ],
  },
  {
    key: 'chodesh30',
    name: 'flow on the 30th',
    question: 'A flow on the 30th, when the next month has 29 days: the 1st of the month after, the 29th, both, or none.',
    note: '',
    options: [
      { value: 'first_of_following', text: 'the 1st of the month after', short: '1st of next month' },
      { value: 'day29', text: 'the 29th', short: 'The 29th' },
      { value: 'both', text: 'both', short: 'Both' },
      { value: 'none', text: 'neither', short: 'None' },
    ],
  },
  {
    key: 'longCycle',
    name: 'long cycles',
    question: 'Three cycles in a row past day 31: onah beinonit and veset hachodesh as usual, or not until a shorter cycle.',
    note: '',
    options: [
      { value: 'observe', text: 'onah beinonit and veset hachodesh as usual', short: 'As usual' },
      { value: 'exempt', text: 'not observed until a shorter cycle', short: 'Not observed' },
    ],
  },
  {
    key: 'vesatot',
    name: 'vesatot',
    question: 'Vesatot: calculated, or paused.',
    note: '',
    options: [
      { value: 'active', text: 'calculated', short: 'Calculated' },
      { value: 'paused', text: 'paused', short: 'Paused' },
    ],
  },
  {
    key: 'yomTov',
    name: 'Yom Tov',
    question: 'Yom Tov: outside Israel, or Israel.',
    note: '',
    options: [
      { value: 'diaspora', text: 'outside Israel', short: 'Outside Israel' },
      { value: 'israel', text: 'Israel', short: 'Israel' },
    ],
  },
  {
    key: 'tzeit',
    name: 'nightfall',
    question: 'Nightfall: the sun 8.5 or 7.083 degrees down, or 50 or 72 minutes (Rabbeinu Tam) after sunset.',
    note: '',
    options: [
      { value: { kind: 'degrees', value: 8.5 }, text: 'sun 8.5 degrees down', short: '8.5 degrees' },
      { value: { kind: 'degrees', value: 7.083 }, text: 'sun 7.083 degrees down', short: '7.083 degrees' },
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
