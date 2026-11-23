/**
 * Halachic settings: every point on which customs differ and the couple
 * (with their rav) chooses. The labels are in Hebrew because those are the
 * terms the settings are known by.
 *
 * Sources for the options are listed in docs/HALACHA.md.
 */
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
  /** Hebrew title */
  title: string;
  /** Hebrew explanation shown under the title */
  help: string;
  options: Array<{ value: HalachicSettings[K]; label: string }>;
}

function spec<K extends ChoiceKey>(s: ChoiceSpec<K>): ChoiceSpec {
  return s as unknown as ChoiceSpec;
}

/** The settings as the dashboard presents them, in order. */
export const HALACHIC_CHOICES: ChoiceSpec[] = [
  spec({
    key: 'minWaitDays',
    title: 'ימי המתנה קודם הפסק טהרה',
    help: 'מונים מיום תחילת האיסור (יום הראייה או מציאת הכתם), והוא היום הראשון. למונים ארבעה ימים מיום התשמיש יש לשאול רב.',
    options: [
      { value: '5', label: 'חמישה ימים (מנהג אשכנז וחלק מקהילות הספרדים)' },
      { value: '4', label: 'ארבעה ימים (מנהג חלק מקהילות הספרדים)' },
    ],
  }),
  spec({
    key: 'beinonitDays',
    title: 'עונה בינונית',
    help: 'יום הראייה הוא היום הראשון למניין.',
    options: [
      { value: '30', label: 'יום ל׳ בלבד' },
      { value: '31', label: 'יום ל״א בלבד' },
      { value: '30_31', label: 'יום ל׳ ויום ל״א' },
    ],
  }),
  spec({
    key: 'beinonitLength',
    title: 'משך העונה הבינונית',
    help: '',
    options: [
      { value: 'onah', label: 'עונה אחת, כעונת הראייה (יום או לילה)' },
      { value: 'full', label: 'מעת לעת: הלילה והיום של אותו תאריך' },
    ],
  }),
  spec({
    key: 'chodeshLength',
    title: 'משך וסת החודש',
    help: '',
    options: [
      { value: 'onah', label: 'עונה אחת, כעונת הראייה (יום או לילה)' },
      { value: 'full', label: 'מעת לעת: הלילה והיום של אותו תאריך' },
    ],
  }),
  spec({
    key: 'orZarua',
    title: 'עונת האור זרוע',
    help: 'פרישה גם בעונה שקודם עונת הוסת.',
    options: [
      { value: 'yes', label: 'חוששים' },
      { value: 'no', label: 'אין חוששים' },
    ],
  }),
  spec({
    key: 'haflagahMethod',
    title: 'חשבון וסת ההפלגה',
    help: 'במניין העונות יש לרשום את יום הפסק הטהרה בכל חודש, שממנו מתחיל החשבון.',
    options: [
      { value: 'days', label: 'מניין ימים, מתחילת ראייה עד תחילת הראייה שאחריה' },
      { value: 'onot_from_hefsek', label: 'מניין עונות, מהפסק טהרה עד הראייה (שולחן ערוך הרב, מנהג חב״ד)' },
    ],
  }),
  spec({
    key: 'longerHaflagah',
    title: 'הפלגה ארוכה שלא נעקרה',
    help: 'ראתה בהפלגה קצרה קודם שהגיע יום ההפלגה הארוכה שלפניה.',
    options: [
      { value: 'latest_only', label: 'חוששים להפלגה האחרונה בלבד' },
      { value: 'keep_unsurpassed', label: 'חוששים גם לכל הפלגה ארוכה שעדיין לא עברה עליה בלא ראייה' },
    ],
  }),
  spec({
    key: 'chodesh30',
    title: 'ראתה ביום ל׳ בחודש, והחודש הבא חסר',
    help: '',
    options: [
      { value: 'first_of_following', label: 'חוששים לא׳ בחודש שלאחריו' },
      { value: 'day29', label: 'חוששים לכ״ט בחודש' },
      { value: 'both', label: 'חוששים לכ״ט ולא׳ בחודש שלאחריו' },
      { value: 'none', label: 'אין חוששים לוסת החודש באותו חודש' },
    ],
  }),
  spec({
    key: 'longCycle',
    title: 'הרגילה לראות לאחר יום ל״א',
    help: 'שלוש פעמים רצופות ראתה לאחר יום ל״א לראייתה הקודמת.',
    options: [
      { value: 'observe', label: 'חוששת לעונה בינונית ולוסת החודש כרגיל' },
      { value: 'exempt', label: 'אינה חוששת לעונה בינונית ולוסת החודש, כל זמן שלא חזרה לראות מוקדם' },
    ],
  }),
  spec({
    key: 'vesatot',
    title: 'חישוב הוסתות',
    help: 'מעוברת, מניקה, או על פי הוראת רב.',
    options: [
      { value: 'active', label: 'מחשבים וסתות' },
      { value: 'paused', label: 'אין מחשבים וסתות כעת' },
    ],
  }),
  spec({
    key: 'yomTov',
    title: 'יום טוב',
    help: '',
    options: [
      { value: 'diaspora', label: 'חוץ לארץ (שני ימים טובים של גלויות)' },
      { value: 'israel', label: 'ארץ ישראל' },
    ],
  }),
];

/** Presets offered for nightfall; any other value can be typed in. */
export const TZEIT_PRESETS: Array<{ rule: TzeitRule; label: string }> = [
  { rule: { kind: 'degrees', value: 8.5 }, label: 'השמש 8.5 מעלות תחת האופק' },
  { rule: { kind: 'degrees', value: 7.083 }, label: 'השמש 7.083 מעלות תחת האופק' },
  { rule: { kind: 'minutes', value: 50 }, label: '50 דקות אחר השקיעה' },
  { rule: { kind: 'minutes', value: 72 }, label: '72 דקות אחר השקיעה (רבינו תם)' },
];

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
    if (value < 3 || value > 20) throw new SettingsError('tzeit degrees must be between 3 and 20');
    return { kind, value };
  }
  if (kind === 'minutes') {
    if (value < 10 || value > 120) throw new SettingsError('tzeit minutes must be between 10 and 120');
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
