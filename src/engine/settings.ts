/**
 * Halachic settings: every point on which customs differ and the couple
 * chooses.
 *
 * The explanations are English sentences; the halachic terms inside them
 * are written as {key} and shown in English letters or Hebrew script
 * according to the household's choice (see terms.ts).
 *
 * Sources for the options are listed in docs/HALACHA.md.
 */
import { fill, type TermLanguage } from './terms';
import type { TzeitRule } from './zmanim';

export interface HalachicSettings {
  /** Days before the hefsek taharah, counting the day niddah began as day 1. */
  minWaitDays: '5' | '4';
  /** Which day(s) from the start of the last flow are the onah beinonit. */
  beinonitDays: '30' | '31' | '30_31';
  /** One onah (that of the flow) or the whole Hebrew date, night and day. */
  beinonitLength: 'onah' | 'full';
  /** The same choice for veset hachodesh. */
  chodeshLength: 'onah' | 'full';
  /** Also separate on the onah before each veset onah. */
  orZarua: 'yes' | 'no';
  /** How the haflagah interval is counted. */
  haflagahMethod: 'days' | 'onot_from_hefsek';
  /** Whether a longer interval that was never passed stays in force. */
  longerHaflagah: 'latest_only' | 'keep_unsurpassed';
  /** Flow began on the 30th and the next month has only 29 days. */
  chodesh30: 'first_of_following' | 'day29' | 'both' | 'none';
  /** Three consecutive cycles that began after day 31. */
  longCycle: 'observe' | 'exempt';
  /** Whether vesatot are calculated at all. */
  vesatot: 'active' | 'paused';
  /** One day of Yom Tov (Israel) or two (diaspora). */
  yomTov: 'diaspora' | 'israel';
  /** Nightfall, for the time of immersion. */
  tzeit: TzeitRule;
}

/**
 * Defaults take the stricter side wherever one option adds days of
 * separation, so that an unreviewed setting never permits something a
 * stricter custom forbids. They are a starting point, not a ruling.
 */
export const DEFAULT_HALACHIC_SETTINGS: HalachicSettings = {
  minWaitDays: '5',
  beinonitDays: '30_31',
  beinonitLength: 'full',
  chodeshLength: 'onah',
  orZarua: 'yes',
  haflagahMethod: 'days',
  longerHaflagah: 'keep_unsurpassed',
  chodesh30: 'both',
  longCycle: 'observe',
  vesatot: 'active',
  yomTov: 'diaspora',
  tzeit: { kind: 'degrees', value: 8.5 },
};

type ChoiceKey = Exclude<keyof HalachicSettings, 'tzeit'>;

export interface ChoiceSpec<K extends ChoiceKey = ChoiceKey> {
  key: K;
  /** English sentence with {term} places */
  title: string;
  /** Explanation shown under the title; may be empty */
  help: string;
  options: Array<{ value: HalachicSettings[K]; label: string }>;
}

function spec<K extends ChoiceKey>(s: ChoiceSpec<K>): ChoiceSpec {
  return s as unknown as ChoiceSpec;
}

/** The settings as the dashboard presents them, in order. Texts are templates. */
export const HALACHIC_CHOICES: ChoiceSpec[] = [
  spec({
    key: 'minWaitDays',
    title: 'Days before the {hefsek}',
    help: 'The day she became {niddah} is day 1.',
    options: [
      { value: '5', label: 'Five (Ashkenazi, some Sephardi)' },
      { value: '4', label: 'Four (some Sephardi)' },
    ],
  }),
  spec({
    key: 'beinonitDays',
    title: '{onah_beinonit}: day',
    help: 'The day of the {flow} is day 1.',
    options: [
      { value: '30', label: 'Day 30' },
      { value: '31', label: 'Day 31' },
      { value: '30_31', label: 'Days 30 and 31' },
    ],
  }),
  spec({
    key: 'beinonitLength',
    title: '{onah_beinonit}: length',
    help: '',
    options: [
      { value: 'onah', label: 'The {onah} of the {flow}' },
      { value: 'full', label: 'The {full_day}' },
    ],
  }),
  spec({
    key: 'chodeshLength',
    title: '{veset_hachodesh}: length',
    help: '',
    options: [
      { value: 'onah', label: 'The {onah} of the {flow}' },
      { value: 'full', label: 'The {full_day}' },
    ],
  }),
  spec({
    key: 'orZarua',
    title: '{or_zarua}',
    help: 'The {onah} before each {veset_onah}.',
    options: [
      { value: 'yes', label: 'Observed' },
      { value: 'no', label: 'Not observed' },
    ],
  }),
  spec({
    key: 'haflagahMethod',
    title: '{veset_haflagah}: counted',
    help: '',
    options: [
      { value: 'days', label: 'In days, {flow} to {flow}' },
      { value: 'onot_from_hefsek', label: 'In {onot}, {hefsek} to {flow} (Chabad)' },
    ],
  }),
  spec({
    key: 'longerHaflagah',
    title: 'Longer {haflagah} not yet passed',
    help: '',
    options: [
      { value: 'latest_only', label: 'Only the latest' },
      { value: 'keep_unsurpassed', label: 'Kept too' },
    ],
  }),
  spec({
    key: 'chodesh30',
    title: '{flow} on the 30th, next month of 29 days',
    help: '',
    options: [
      { value: 'first_of_following', label: 'The 1st of the month after' },
      { value: 'day29', label: 'The 29th' },
      { value: 'both', label: 'Both' },
      { value: 'none', label: 'Neither' },
    ],
  }),
  spec({
    key: 'longCycle',
    title: 'Cycles past day 31',
    help: 'Three in a row.',
    options: [
      { value: 'observe', label: '{onah_beinonit} and {veset_hachodesh} as usual' },
      { value: 'exempt', label: 'Not observed until a shorter cycle' },
    ],
  }),
  spec({
    key: 'vesatot',
    title: '{vesatot}',
    help: '',
    options: [
      { value: 'active', label: 'Calculated' },
      { value: 'paused', label: 'Paused' },
    ],
  }),
  spec({
    key: 'yomTov',
    title: '{yom_tov}',
    help: '',
    options: [
      { value: 'diaspora', label: 'Outside Israel' },
      { value: 'israel', label: 'Israel' },
    ],
  }),
];

/** Presets offered for nightfall; any other value can be typed in. */
export const TZEIT_PRESETS: Array<{ rule: TzeitRule; label: string }> = [
  { rule: { kind: 'degrees', value: 8.5 }, label: 'Sun 8.5° below the horizon' },
  { rule: { kind: 'degrees', value: 7.083 }, label: 'Sun 7.083° below the horizon' },
  { rule: { kind: 'minutes', value: 50 }, label: '50 minutes after {sunset}' },
  { rule: { kind: 'minutes', value: 72 }, label: '72 minutes after {sunset} (Rabbeinu Tam)' },
];

export const TZEIT_TITLE = '{nightfall}';

/** The choices with every term filled in for one language. */
export function choicesFor(lang: TermLanguage): ChoiceSpec[] {
  return HALACHIC_CHOICES.map(c => ({
    key: c.key,
    title: capitalFirst(fill(c.title, lang)),
    help: capitalFirst(fill(c.help, lang)),
    options: c.options.map(o => ({ value: o.value, label: capitalFirst(fill(o.label, lang)) })),
  }));
}

export function tzeitPresetsFor(lang: TermLanguage): Array<{ rule: TzeitRule; label: string }> {
  return TZEIT_PRESETS.map(p => ({ rule: p.rule, label: fill(p.label, lang) }));
}

function capitalFirst(text: string): string {
  // Hebrew has no capitals; an English first letter is raised.
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsError';
  }
}

function parseTzeit(input: unknown): TzeitRule {
  if (typeof input !== 'object' || input === null) throw new SettingsError('tzeit: expected an object');
  const { kind, value } = input as { kind?: unknown; value?: unknown };
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new SettingsError('tzeit.value: expected a number');
  if (kind === 'degrees') {
    if (value < 3 || value > 20) throw new SettingsError('Nightfall in degrees must be between 3 and 20.');
    return { kind, value };
  }
  if (kind === 'minutes') {
    if (value < 10 || value > 120) throw new SettingsError('Nightfall in minutes must be between 10 and 120.');
    return { kind, value };
  }
  throw new SettingsError('tzeit.kind: expected "degrees" or "minutes"');
}

/**
 * Validates halachic settings from storage or the dashboard. Every key must
 * be present with one of its listed values; nothing is filled in silently.
 */
export function parseHalachicSettings(input: unknown): HalachicSettings {
  if (typeof input !== 'object' || input === null) throw new SettingsError('settings: expected an object');
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const choice of HALACHIC_CHOICES) {
    const value = src[choice.key];
    if (!choice.options.some(o => o.value === value)) {
      throw new SettingsError(`${choice.key}: "${String(value)}" is not one of the options`);
    }
    out[choice.key] = value;
  }
  out.tzeit = parseTzeit(src.tzeit);
  const known = new Set<string>([...HALACHIC_CHOICES.map(c => c.key), 'tzeit']);
  for (const key of Object.keys(src)) {
    if (!known.has(key)) throw new SettingsError(`unknown setting "${key}"`);
  }
  return out as unknown as HalachicSettings;
}
