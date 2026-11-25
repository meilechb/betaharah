/**
 * Every text the service sends, in one list: the registry. Nothing is sent
 * that is not here (test/texts-registry.test.ts checks the source for it).
 *
 * Each message has a stable key, a group and one line for the operator
 * saying when it is sent; its default body with {placeholders}; the
 * placeholders with an example value each (a name ending in "?" may be
 * empty, the others are required); and its options: the choices offered
 * with it, each with a fixed id (what it does, decided by the code) and a
 * default label (the word shown and matched). The operator can change the
 * body and the labels (src/app/chat/site-texts.ts); never the ids.
 *
 * A message sends all its options unless the code offers a part of them
 * (for example, the ordinals of a list that has three entries).
 *
 * Three texts are worded exactly as filed with the carrier for the
 * toll-free verification (`filed`): the sign-in code, the reply to HELP and
 * the reply to START. They carry no options line.
 */
import { civilToAbs } from '../../engine/civil';
import { dayWords, nightWords, type DateStyle, type DateWords } from '../../engine/dates';
import { REMINDER_TEXTS, STATUS_TEXTS } from '../../engine/present';
import { SMS_CUSTOMS } from './customs';

export const GROUPS = ['Sign-up', 'Recording', 'Status', 'Reminders', 'Settings', 'Phones', 'Calendar', 'Carrier words', 'Other'] as const;
export type Group = (typeof GROUPS)[number];

export interface OptionDef {
  /** What the option does; fixed. */
  id: string;
  /** The default label: the word shown on the options line and on the RCS button. */
  label: string;
}

export interface VarDef {
  name: string;
  /** Shown in the preview. */
  example: string;
  /** A required placeholder must stay in the body. */
  required: boolean;
}

export interface MessageDef {
  key: string;
  group: Group;
  /** When it is sent, in one line, for the operator. */
  when: string;
  body: string;
  vars: VarDef[];
  options: OptionDef[];
  /** The wording filed with the carrier: no options line. */
  filed?: true;
}

// ---------- the general words ----------

/**
 * The words a person can write at any time, by what they do. The operator
 * can change every list. The first five are the ones the main options use.
 */
export const GENERAL_ACTIONS: Array<{ action: string; name: string; words: string[] }> = [
  { action: 'period', name: 'Period began', words: ['period', 'flow', 'started', 'bleeding'] },
  { action: 'hefsek', name: 'Hefsek done', words: ['hefsek'] },
  { action: 'status', name: 'Status', words: ['status', 'where'] },
  { action: 'undo', name: 'Undo', words: ['undo'] },
  { action: 'menu', name: 'Main options', words: ['menu', 'options', 'more'] },
  { action: 'stain', name: 'Stain', words: ['stain'] },
  { action: 'broken', name: 'Count broken', words: ['broken'] },
  { action: 'history', name: 'History', words: ['history'] },
  { action: 'location', name: 'Location', words: ['location', 'zip'] },
  { action: 'customs', name: 'Customs', words: ['customs', 'custom'] },
  { action: 'nightfall', name: 'Nightfall', words: ['nightfall'] },
  { action: 'vesatot', name: 'Vestos (pause, resume)', words: ['vestos', 'vesatot'] },
  { action: 'reminders', name: 'Reminders (on, off)', words: ['reminders', 'reminder'] },
  { action: 'kinds', name: 'Reminder kinds', words: ['kinds'] },
  { action: 'wording', name: 'Reminder wording', words: ['wording'] },
  { action: 'phones', name: 'Phones', words: ['phones', 'phone'] },
  { action: 'add', name: 'Add a phone', words: ['add'] },
  { action: 'leave', name: 'Leave the account', words: ['leave'] },
  { action: 'calendar', name: 'Calendar link', words: ['calendar'] },
  { action: 'terms', name: 'Terms (Hebrew, English)', words: ['terms'] },
  { action: 'dates', name: 'Dates (Hebrew, civil, both)', words: ['dates'] },
  { action: 'web', name: 'Sign-in link', words: ['web', 'website'] },
  { action: 'setup', name: 'Setup again', words: ['setup'] },
  { action: 'delete', name: 'Delete the account', words: ['delete'] },
  { action: 'join', name: 'Join (already signed up)', words: ['join'] },
  { action: 'website', name: 'On the website only', words: ['password', 'download', 'export', 'google', 'times'] },
];

export const DEFAULT_WORDS: Record<string, string[]> = Object.fromEntries(GENERAL_ACTIONS.map(a => [a.action, a.words]));

/**
 * Options whose labels may use the words of a general action other than
 * their own id: they belong to it (MORE is a page of the main options,
 * REMOVE removes a phone, and so on).
 */
export const OPTION_FAMILY: Record<string, string[]> = {
  more: ['menu'],
  entries: ['menu'],
  settings: ['menu'],
  account: ['menu'],
  remove: ['phones'],
  immersion: [],
};

// ---------- building the list ----------

type Opt = [id: string, label: string];

const o = (...pairs: Opt[]): OptionDef[] => pairs.map(([id, label]) => ({ id, label }));

/** The main options, also offered after most answers. */
export const MAIN: Opt[] = [
  ['period', 'PERIOD'],
  ['hefsek', 'HEFSEK'],
  ['status', 'STATUS'],
  ['more', 'MORE'],
];
const MENU: Opt = ['menu', 'MENU'];

const MESSAGES_LIST: MessageDef[] = [];

/**
 * Adds a message. `vars` maps each placeholder to its example; a name
 * ending in "?" may be left out or empty.
 */
function add(key: string, group: Group, when: string, body: string, options: Opt[], vars: Record<string, string> = {}, extra: { filed?: true } = {}): void {
  MESSAGES_LIST.push({
    key,
    group,
    when,
    body,
    vars: Object.entries(vars).map(([name, example]) => ({ name: name.replace(/\?$/, ''), example, required: !name.endsWith('?') })),
    options: o(...options),
    ...extra,
  });
}

/**
 * The example values of the dates, as the texts write them for a date more
 * than six days away (the longest form: nearer dates are a weekday alone or
 * "today"), in each setting of the household's dates. The registry shows
 * the default setting's; test/texts.test.ts checks every text in all three.
 */
export function dateExamples(dates: DateStyle) {
  const w: DateWords = { dates, lang: 'en' };
  const SUN = civilToAbs({ y: 2026, m: 11, d: 22 });
  const day = (n: number): string => dayWords(SUN + n, w);
  const night = (n: number): string => nightWords(SUN + n, w);
  return {
    day: day(3),
    mikvahNight: night(12),
    entry: `flow ${night(2)}`,
    stain: `stain ${day(2)} by day`,
    broken: `count broken ${day(2)} by day`,
    hefsek: `hefsek ${day(7)}`,
    immersion: `mikvah ${night(15)}`,
    flowDetails: ` Hefsek from ${day(7)}.`,
    hefsekDetails: ` Clean days from ${day(8)}. Mikvah ${night(15)} after 5:16 PM.`,
    readAs: dayWords(SUN - 360, { ...w, year: true }),
    history: `first: hefsek ${day(-16)}; second: flow ${day(-21)} by day`,
    historyEntry: `flow ${day(-21)} by day`,
    from: `4:31 PM ${night(29)}`,
    to: `4:32 PM ${day(30)}`,
    nextDay: night(29),
    start: night(0),
    hefsekDay: day(4),
    firstDay: day(5),
    example: day(2),
  };
}

const EX = dateExamples('hebrew');
const DATE = EX.day;
const ENTRY = EX.entry;

// ---------- carrier words (filed) ----------

add('carrier.code', 'Carrier words', 'A sign-in code, asked for on the website.', 'Betaharah code: {code}. It expires in {minutes} minutes. Do not share it.', [], { code: '493817', minutes: '10' }, { filed: true });
add('carrier.help', 'Carrier words', 'HELP or INFO, from any number.', 'Betaharah: text ? for commands. Help: admin@betaharah.com. Reply STOP to opt out.', [], {}, { filed: true });
add(
  'carrier.start',
  'Carrier words',
  'START or UNSTOP from any number, and when reminders are turned on on the website.',
  "Betaharah: you're subscribed to reminder texts. Message frequency varies. Msg&data rates may apply. Reply ? for help, STOP to opt out.",
  [],
  {},
  { filed: true },
);

// ---------- sign-up ----------

const JOIN: Opt = ['join', 'JOIN'];
add(
  'signup.welcome',
  'Sign-up',
  'Any first text from a number with no account, while sign-up by text is open.',
  'Betaharah: a mikvah calendar by text. Msg frequency varies. Msg&data rates may apply. Reply STOP to stop, HELP for help. Terms: betaharah.com/terms',
  [JOIN],
);
add(
  'signup.invite',
  'Sign-up',
  'Any first text from a number with no account, while sign-up is by invitation.',
  'Betaharah: a mikvah calendar by text. By invitation: JOIN and the invitation word. Msg&data rates may apply. Reply STOP to stop, HELP for help.',
  [JOIN],
);
add('signup.bad_word', 'Sign-up', 'JOIN and a word that is not a valid invitation or code.', 'Betaharah: that invitation word or code is not valid, or it expired. Nothing was set up. Reply STOP to stop, HELP for help.', [JOIN]);
add('signup.join_full', 'Sign-up', 'JOIN and a code, for an account that already has four phones.', 'That account already has the most phones, so this phone was not added.', [JOIN]);
add('setup.start', 'Sign-up', 'Right after JOIN: setup, step 1.', 'Welcome to Betaharah. Setup step 1 of 3: your ZIP code (or Canadian postal code), for the times of sunset.', [['skip_place', 'SKIP']]);
add('setup.start_place', 'Sign-up', 'SETUP, when a location is set: step 1.', 'Setup step 1 of 3: the location is {place}. A new ZIP code changes it.', [['keep_place', 'KEEP']], { place: 'Lakewood, NJ 08701' });
add('setup.customs', 'Sign-up', 'Setup, step 2: the customs.', 'Step 2 of 3: customs. Until they are chosen, the stricter option of each is used.', [
  ['keep_customs', 'KEEP FOR NOW'],
  ['answer_customs', 'ANSWER BY TEXT'],
  ['customs_later', 'LATER'],
]);
add('setup.recent', 'Sign-up', 'Setup, step 3: the most recent period.', 'Step 3 of 3: when did the last period begin? For example: Nov 22 night.', [['skip_recent', 'SKIP']]);
add('setup.recent_hefsek', 'Sign-up', 'Setup, step 3, after the period was recorded.', 'Hefsek done? Its date, for example: Nov 27.', [['not_yet', 'NOT YET']]);
add('setup.done', 'Sign-up', 'The end of setup.', 'Setup is done. Reminders are off for now.', [['period', 'PERIOD'], ['hefsek', 'HEFSEK'], ['reminders', 'REMINDERS'], ['more', 'MORE']]);
add('setup.joined', 'Sign-up', 'A phone that joined an account with a code.', 'This phone is now on the account{others}. Its reminders are off.', MAIN, { 'others?': ' with the phone ending 0101' });

// ---------- menus ----------

add('menu.main', 'Other', 'MENU, ?, or the word "options".', 'Betaharah.', MAIN);
add('menu.more', 'Other', 'The option MORE.', 'More:', [
  ['entries', 'OTHER ENTRIES'],
  ['history', 'HISTORY'],
  ['undo', 'UNDO'],
  ['settings', 'SETTINGS'],
  ['account', 'ACCOUNT'],
]);
add('menu.entries', 'Recording', 'The option OTHER ENTRIES.', 'Record:', [
  ['stain', 'STAIN'],
  ['broken', 'COUNT BROKEN'],
  ['immersion', 'IMMERSION'],
]);
add('menu.settings', 'Settings', 'The option SETTINGS.', 'Settings:', [
  ['reminders', 'REMINDERS'],
  ['location', 'LOCATION'],
  ['customs', 'CUSTOMS'],
  ['calendar', 'CALENDAR'],
  ['terms', 'TERMS'],
  ['dates', 'DATES'],
]);
add('menu.account', 'Settings', 'The option ACCOUNT.', 'Account:', [
  ['phones', 'PHONES'],
  ['web', 'WEB LINK'],
  ['setup', 'SETUP'],
  ['delete', 'DELETE ACCOUNT'],
]);
add('not_understood', 'Other', 'A reply that matches no option and no word, or a digit alone.', 'Not understood; nothing was changed.', MAIN);
add('confirm.no', 'Other', 'NO to a question, or KEEP for one custom.', 'Nothing was changed.', MAIN);

// ---------- recording ----------

const WHEN_FLOW: Opt[] = [
  ['now', 'NOW'],
  ['last_night', 'LAST NIGHT'],
  ['today_day', 'TODAY BY DAY'],
  ['another_day', 'ANOTHER DAY'],
];
add('record.when_flow', 'Recording', 'PERIOD with no time. NOW is offered with LAST NIGHT by day, with TODAY BY DAY at night.', 'When did it begin?', WHEN_FLOW);
add('record.when_stain', 'Recording', 'STAIN with no time.', 'When was the stain?', WHEN_FLOW);
add('record.when_broken', 'Recording', 'COUNT BROKEN with no time.', 'When was the count broken?', WHEN_FLOW);
add('record.when_hefsek', 'Recording', 'HEFSEK with no day.', 'Hefsek taharah: which day?', [
  ['today', 'TODAY'],
  ['yesterday', 'YESTERDAY'],
  ['another_day', 'ANOTHER DAY'],
]);
add('record.when_immersion', 'Recording', 'IMMERSION (under MORE). TONIGHT is offered only at night.', 'Immersion: which night?', [
  ['tonight', 'TONIGHT'],
  ['last_night', 'LAST NIGHT'],
  ['another_day', 'ANOTHER DAY'],
]);
add('record.date_onah', 'Recording', 'ANOTHER DAY, for a period, a stain or a broken count.', 'Which date, and day or night? For example: Nov 22 night.', [MENU]);
add('record.date_day', 'Recording', 'ANOTHER DAY, for a hefsek or an immersion.', 'Which date? For example: Nov 26.', [MENU]);

const AFTER_RECORD: Opt[] = [
  ['undo', 'UNDO'],
  ['status', 'STATUS'],
];
const DETAILS = { 'details?': EX.flowDetails };
add('record.flow', 'Recording', 'A period was recorded.', 'Recorded: {entry}.{details}', AFTER_RECORD, { entry: ENTRY, ...DETAILS });
add('record.stain', 'Recording', 'A stain was recorded.', 'Recorded: {entry}.{details}', AFTER_RECORD, { entry: EX.stain, ...DETAILS });
add('record.broken', 'Recording', 'A broken count was recorded.', 'Recorded: {entry}. A new hefsek is needed.{details}', AFTER_RECORD, { entry: EX.broken, 'details?': '' });
add('record.hefsek', 'Recording', 'A hefsek was recorded (also DONE on the hefsek reminder).', 'Recorded: {entry}.{details}', AFTER_RECORD, {
  entry: EX.hefsek,
  'details?': EX.hefsekDetails,
});
add('record.immersion', 'Recording', 'An immersion was recorded.', 'Recorded: {entry}.{details}', AFTER_RECORD, { entry: EX.immersion, 'details?': '' });

add('refuse.duplicate', 'Recording', 'The same entry is already recorded.', 'Already recorded.', MAIN);
add('refuse.future', 'Recording', 'A time or date that has not come yet.', 'Not recorded: that time has not come yet.', MAIN);
add('refuse.no_period', 'Recording', 'A hefsek or an immersion with no period open.', 'Not recorded: no period is open.', MAIN);
add('refuse.before_start', 'Recording', 'A hefsek dated before the period began.', 'Not recorded: that is before the period began.', MAIN);
add('refuse.no_count', 'Recording', 'COUNT BROKEN with no count of clean days.', 'Not recorded: there is no count in progress.', MAIN);
add('refuse.no_hefsek', 'Recording', 'An immersion with no hefsek recorded.', 'Not recorded: no hefsek is recorded.', MAIN);
add('refuse.too_early', 'Recording', 'An immersion before the count is complete.', 'Not recorded: the count is not complete. Mikvah night is {day} after {time}.', MAIN, { day: EX.mikvahNight, time: '5:16 PM' });
add('refuse.too_early_plain', 'Recording', 'An immersion before the count is complete, when the night is not known.', 'Not recorded: the count is not complete.', MAIN);
add('refuse.other', 'Recording', 'Any other entry that is not recorded.', 'Not recorded.', MAIN);
add('refuse.no_place', 'Recording', 'Recording before a location is set.', 'Not recorded: no location is set yet.', [['location', 'LOCATION'], MENU]);
add('refuse.read_only', 'Recording', 'Recording from a phone that may not record (set on the website).', 'This phone may not record entries. That is set on the website.', [['status', 'STATUS'], MENU]);
add('date.read_as', 'Recording', 'After a refusal for a written date: the date as it was read.', '(Read as {date}.)', MAIN, { date: EX.readAs });
add('date.form', 'Recording', 'A date that is not written as month and day.', 'Not understood: dates are written like Nov 22 or 11/22. Nothing was changed.', [MENU]);
add('date.no_such', 'Recording', 'A date that does not exist.', 'There is no date {date}. Nothing was changed.', [MENU], { date: '2/30' });
add('date.year', 'Recording', 'A year that is not possible.', 'The year {year} is not possible here. Nothing was changed.', [MENU], { year: '1999' });
add('date.not_recent', 'Recording', 'A date without a year that was not in the past year (Feb 29).', 'There was no {date} in the past year. With the year it works, e.g. {example}. Nothing was changed.', [MENU], {
  date: 'Feb 29',
  example: '2/29/2024',
});
add('date.adar', 'Recording', 'A Hebrew date in Adar, in a leap year, without I or II.', 'This year has Adar I and Adar II: which one? E.g. 3 Adar II. Nothing was changed.', [MENU]);
add('date.needs_onah', 'Recording', 'A date for a period, stain or broken count without day, night or a time.', 'The date needs day, night or a time, e.g. Nov 22 night. Nothing was changed.', [MENU]);
add('date.nothing_more', 'Recording', 'A date for a hefsek or an immersion with more after it.', 'Not understood: the date alone, e.g. Nov 26. Nothing was changed.', [MENU]);
add('undo.done', 'Recording', 'UNDO: the latest entry (of the last 48 hours) was removed.', 'Removed: {entry}. {status}', MAIN, { entry: ENTRY, status: 'Tehorah.' });
add('undo.nothing', 'Recording', 'UNDO with nothing from the last 48 hours.', 'Nothing recent to undo.', [['history', 'HISTORY'], MENU]);

// ---------- status ----------

const STATUS_WHEN: Record<string, string> = {
  'status.tehorah': 'STATUS, when tehorah and no onah is coming.',
  'status.tehorah_onah': 'STATUS, when tehorah.',
  'status.before_hefsek': 'STATUS, before the hefsek, when it can be done from the planned day.',
  'status.before_hefsek_later': 'STATUS, before the hefsek, when its first possible day has passed.',
  'status.before_first_day': 'STATUS, after the hefsek, before the first clean day.',
  'status.counting': 'STATUS, during the seven clean days.',
  'status.postponed': 'STATUS, when the count is complete but the immersion is put off.',
  'status.mikvah_tonight': 'STATUS, on the mikvah night.',
};
const STATUS_EXAMPLES: Record<string, string> = {
  next_time: '4:31 PM',
  next_day: EX.nextDay,
  start: EX.start,
  hefsek_day: EX.hefsekDay,
  sunset: '4:33 PM',
  first_day: EX.firstDay,
  mikvah_day: EX.mikvahNight,
  mikvah_time: '5:16 PM',
  day: '3',
};
const STATUS_OPTIONS: Opt[] = [['period', 'PERIOD'], ['hefsek', 'HEFSEK'], ['history', 'HISTORY'], ['more', 'MORE']];
for (const [key, body] of Object.entries(STATUS_TEXTS)) {
  add(key, 'Status', STATUS_WHEN[key] ?? 'STATUS.', body, STATUS_OPTIONS, Object.fromEntries([...body.matchAll(/\{(\w+)\}/g)].map(m => [m[1] as string, STATUS_EXAMPLES[m[1] as string] ?? ''])));
}
add('status.no_place', 'Status', 'STATUS before a location is set.', 'No location is set yet.', [['location', 'LOCATION'], MENU]);

// ---------- history ----------

const ORDINALS: Opt[] = [
  ['first', 'FIRST'],
  ['second', 'SECOND'],
  ['third', 'THIRD'],
  ['fourth', 'FOURTH'],
  ['fifth', 'FIFTH'],
];
add('history.list', 'Recording', 'HISTORY: the latest five entries, to erase one.', 'Latest: {list}. Erase one?', [...ORDINALS, MENU], { list: EX.history });
add('history.empty', 'Recording', 'HISTORY with no entries.', 'No entries yet.', MAIN);
add('history.erase_ask', 'Recording', 'An entry was chosen from HISTORY.', 'Erase {entry}?', [['yes', 'YES'], ['no', 'NO']], { entry: EX.historyEntry });
add('history.erased', 'Recording', 'YES: the entry was erased.', 'Erased: {entry}. {status}', MAIN, { entry: EX.historyEntry, status: 'Tehorah.' });
add('history.gone', 'Recording', 'The chosen entry was already removed.', 'That entry is no longer there. Nothing was changed.', [['history', 'HISTORY'], MENU]);

// ---------- reminders ----------

const REMINDER_WHEN: Record<string, string> = {
  'reminder.hefsek': 'Reminder: the day the hefsek taharah can be done. DONE records the hefsek for that day.',
  'reminder.bedikah_morning': 'Reminder: the morning of each clean day.',
  'reminder.bedikah_afternoon': 'Reminder: before sunset on each clean day.',
  'reminder.mikvah_book': 'Reminder: the morning after the hefsek was recorded.',
  'reminder.mikvah': 'Reminder: the day of the mikvah night.',
  'reminder.onah': 'Reminder: before an onah.',
  'reminder.rest':
    'Reminder: the morning a Shabbos or Yom Tov begins (at the time set), the first line of one text with every reminder that falls in it, one line each.',
  'reminder.rest.hefsek': 'A line of the text before Shabbos or Yom Tov: the hefsek taharah on one of its days.',
  'reminder.rest.bedikot': 'A line of the text before Shabbos or Yom Tov: both bedikos of a clean day on one of its days.',
  'reminder.rest.bedikah_morning': 'A line of the text before Shabbos or Yom Tov: the morning bedikah alone.',
  'reminder.rest.bedikah_afternoon': 'A line of the text before Shabbos or Yom Tov: the bedikah before sunset alone.',
  'reminder.rest.mikvah': 'A line of the text before Shabbos or Yom Tov: a mikvah night on it, or right after it.',
  'reminder.rest.mikvah_book': 'A line of the text before Shabbos or Yom Tov: booking the mikvah, which would have been sent on it.',
  'reminder.rest.onah': 'A line of the text before Shabbos or Yom Tov: an onah that begins on it.',
};
/** The examples of the lines of the text before Shabbos or Yom Tov: days that are near. */
const REST_EXAMPLES: Record<string, string> = { rest: 'Shabbos', day: 'Shabbos', required: ' (required)', from: '6:52 AM Shabbos', to: '4:30 PM Shabbos' };
const REMINDER_EXAMPLES: Record<string, string> = {
  day: DATE,
  sunset: '4:31 PM',
  eve: ' Candle lighting is that evening.',
  n: '1',
  required: ' Required on this day.',
  time: '5:16 PM',
  notes: ' (after Shabbos or Yom Tov)',
  from: EX.from,
  to: EX.to,
  why: 'day 30, chodesh',
  bedikah: ' Bedikah.',
  clash: ' Mikvah night too.',
  mark: 'O',
};
const OPTIONAL_REMINDER_VARS = new Set(['eve', 'required', 'notes', 'bedikah', 'clash']);
for (const [key, body] of Object.entries(REMINDER_TEXTS)) {
  const base = key.replace(/\.discreet$/, '');
  const when = (REMINDER_WHEN[base] ?? 'Reminder.') + (key.endsWith('.discreet') ? ' Discreet wording.' : '');
  const options: Opt[] = base === 'reminder.hefsek' ? [['done', 'DONE'], ['status', 'STATUS']] : [['status', 'STATUS']];
  // The mikvah night and the reminder to book it name a night.
  const examples =
    base === 'reminder.mikvah' || base === 'reminder.mikvah_book'
      ? { ...REMINDER_EXAMPLES, day: EX.mikvahNight }
      : base === 'reminder.rest.mikvah' || base === 'reminder.rest.mikvah_book'
        ? { ...REMINDER_EXAMPLES, ...REST_EXAMPLES, day: 'Sat night' }
        : base.startsWith('reminder.rest')
          ? { ...REMINDER_EXAMPLES, ...REST_EXAMPLES }
          : REMINDER_EXAMPLES;
  const vars = Object.fromEntries([...body.matchAll(/\{(\w+)\}/g)].map(m => [`${m[1]}${OPTIONAL_REMINDER_VARS.has(m[1] as string) ? '?' : ''}`, examples[m[1] as string] ?? '']));
  add(key, 'Reminders', when, body, options, vars);
}

const ON_OFF: Opt[] = [
  ['on', 'TURN ON'],
  ['off', 'TURN OFF'],
];
add('reminders.show', 'Reminders', 'REMINDERS. TURN ON or TURN OFF is offered, whichever applies.', 'Reminders for this phone are {state}. Kinds on: {kinds} of 6. Wording: {style}.', [
  ...ON_OFF,
  ['kinds', 'KINDS'],
  ['wording', 'WORDING'],
  ['bedikot', 'BEDIKOS'],
  ['rest_eve', 'SHABBOS'],
], {
  state: 'off',
  kinds: '6',
  style: 'plain',
});
add(
  'reminders.on',
  'Reminders',
  'TURN ON (or REMINDERS ON): the consent to reminder texts.',
  'Reminders are on for this phone (ending {last4}). This phone agrees to receive reminder texts from Betaharah. Msg frequency varies. Msg&data rates may apply. Reply STOP to stop, HELP for help.',
  [['kinds', 'KINDS'], ['status', 'STATUS']],
  { last4: '0101' },
);
add('reminders.already_on', 'Reminders', 'TURN ON when reminders are already on.', 'Reminders are already on for this phone.', [['off', 'TURN OFF'], ['kinds', 'KINDS'], MENU]);
add('reminders.off', 'Reminders', 'TURN OFF (or REMINDERS OFF).', 'Changed: reminders are off for this phone. Replies still come.', [['on', 'TURN ON'], MENU]);
add('reminders.already_off', 'Reminders', 'TURN OFF when reminders are already off.', 'Reminders are already off for this phone.', [['on', 'TURN ON'], MENU]);
add('reminders.opted_out', 'Reminders', 'TURN ON from a phone that replied STOP.', 'This phone replied STOP, so no texts are sent to it. START turns texts back on.', [MENU]);
const KINDS: Opt[] = [
  ['kind_hefsek', 'TAHARA'],
  ['kind_bedikah_morning', 'AM BEDIKAH'],
  ['kind_bedikah_afternoon', 'PM BEDIKAH'],
  ['kind_mikvah', 'MIKVAH NIGHT'],
  ['kind_mikvah_book', 'BOOKING'],
  ['kind_onah', 'ONAH'],
];
add('reminders.kinds', 'Reminders', 'KINDS: which reminders this phone gets. Each option turns one on or off.', 'Kinds on: {on}. Off: {off}.', KINDS, {
  on: 'tahara, am bedikah, pm bedikah, mikvah night, booking',
  off: 'onah',
});
add('reminders.kinds_changed', 'Reminders', 'A kind was turned on or off.', 'Changed. On: {on}. Off: {off}.', KINDS, { on: 'tahara, mikvah night', off: 'am bedikah, pm bedikah, booking, onah' });
add('reminders.wording', 'Reminders', 'WORDING: plain or discreet, for every phone on the account.', 'Reminder wording: {style}, for every phone. Discreet uses letters, such as H for hefsek.', [
  ['plain', 'PLAIN'],
  ['discreet', 'DISCREET'],
], { style: 'plain' });
add('reminders.wording_changed', 'Reminders', 'The wording was changed.', 'Changed: reminder wording is {style} for every phone.', MAIN, { style: 'discreet' });
add('reminders.wording_same', 'Reminders', 'The wording chosen is the one already set.', 'Reminder wording is already {style}. Nothing was changed.', MAIN, { style: 'plain' });
/** BEDIKOS: which clean days (DAYS), and the morning and before-sunset reminders, each offered in its other state. */
const BEDIKOT: Opt[] = [
  ['days', 'DAYS'],
  ['morning_on', 'MORNING ON'],
  ['morning_off', 'MORNING OFF'],
  ['sunset_on', 'BEFORE SUNSET ON'],
  ['sunset_off', 'BEFORE SUNSET OFF'],
  MENU,
];
const DAYS: Opt[] = [['days_all', 'ALL DAYS'], ['days_1_7', '1 AND 7'], MENU];
const BEDIKOT_EXAMPLE = { state: 'on', days: 'all 7', morning: 'on', sunset: 'on' };
const BEDIKOT_BODY = 'Bedikah reminders are {state}: clean days {days}; morning {morning}; before sunset {sunset}.';
add('reminders.bedikot', 'Reminders', 'BEDIKOS: the bedikah reminders of the account. MORNING and BEFORE SUNSET offer whichever applies.', BEDIKOT_BODY, BEDIKOT, BEDIKOT_EXAMPLE);
add('reminders.bedikot_changed', 'Reminders', 'The bedikah days, or the morning or before-sunset reminder, were changed.', `Changed. ${BEDIKOT_BODY}`, BEDIKOT, {
  ...BEDIKOT_EXAMPLE,
  days: '1 and 7',
});
add('reminders.bedikot_same', 'Reminders', 'A bedikah choice that is already set.', `Nothing was changed. ${BEDIKOT_BODY}`, BEDIKOT, BEDIKOT_EXAMPLE);
add(
  'reminders.days_ask',
  'Reminders',
  'DAYS: all seven, 1 and 7, or other clean days written in reply by their numbers.',
  'Bedikah reminders on clean days {days}. Other days: their numbers, such as 1 2 7.',
  DAYS,
  { days: 'all 7' },
);
add('reminders.days_bad', 'Reminders', 'Numbers after DAYS that are not clean days from 1 to 7.', 'Not understood: clean days are 1 to 7, such as 1 2 7. Nothing was changed.', DAYS);
add(
  'reminders.rest_eve',
  'Reminders',
  'SHABBOS: the time of the one text the morning before Shabbos or Yom Tov; a time written in reply changes it.',
  'Before Shabbos and Yom Tov: one text that morning at {time}, with what falls on those days. A time such as 8:30 AM changes it.',
  [['bedikot', 'BEDIKOS'], MENU],
  { time: '9:00 AM' },
);
add('reminders.rest_eve_changed', 'Reminders', 'A time was written after SHABBOS.', 'The text before Shabbos and Yom Tov comes at {time} that morning.', MAIN, { time: '8:30 AM' });
add('reminders.rest_eve_bad', 'Reminders', 'Numbers after SHABBOS that are not a time.', 'Not understood: a time such as 8:30 AM. Nothing was changed.', [MENU]);

// ---------- settings: location ----------

add('location.show', 'Settings', 'LOCATION, when one is set.', 'Location: {place}. A new ZIP code changes it.', [MENU], { place: 'Lakewood, NJ 08701' });
add('location.ask', 'Settings', 'LOCATION, when none is set.', 'Your ZIP code (or Canadian postal code)?', [MENU]);
add('location.set', 'Settings', 'A ZIP code was set.', 'Location set: {place}.', MAIN, { place: 'Brooklyn, NY 11219' });
add('location.unknown', 'Settings', 'A ZIP code with no place found. SKIP is offered in setup.', 'No place was found for {code}. Places outside the US and Canada are set on the website.', [['skip_place', 'SKIP'], ['web', 'WEB LINK'], MENU], {
  code: '99999',
});
add('location.not_postal', 'Settings', 'LOCATION and something that is not a ZIP code.', 'Not understood: a ZIP code has 5 digits, a Canadian postal code is like H3W 1A1. Nothing was changed.', [MENU]);
add('location.confirm', 'Settings', 'RCS: a location shared when no ZIP code was asked for.', 'Set the location to {place}? Now: {current}.', [['yes', 'YES'], ['no', 'NO']], { place: 'Chicago, IL 60645', current: 'Lakewood, NJ 08701' });
add('location.none_near', 'Settings', 'RCS: a shared location with no US or Canadian place near it.', 'No US or Canadian place was found near that location. Nothing was changed.', [MENU]);

// ---------- settings: customs ----------

/** An option's short words inside a sentence: "five days", "outside Israel". */
export function shortWords(short: string): string {
  return /^(Israel|Or Zarua)/.test(short) ? short : short.charAt(0).toLowerCase() + short.slice(1);
}

/** The labels of each custom's options, in the order of SMS_CUSTOMS. */
export const CUSTOM_LABELS: Record<string, string[]> = {
  minWaitDays: ['FIVE DAYS', 'FOUR DAYS'],
  beinonitDays: ['DAY 30', 'DAY 31', 'BOTH'],
  beinonitLength: ['ONE ONAH', 'FULL DAY'],
  chodeshLength: ['ONE ONAH', 'FULL DAY'],
  orZarua: ['OBSERVED', 'NOT OBSERVED'],
  haflagahMethod: ['IN DAYS', 'IN ONOS'],
  longerHaflagah: ['LATEST ONLY', 'LONGER ONES TOO'],
  chodesh30: ['FIRST OF NEXT MONTH', 'THE 29TH', 'BOTH', 'NONE'],
  longCycle: ['AS USUAL', 'NOT OBSERVED'],
  vesatot: ['CALCULATED', 'PAUSED'],
  yomTov: ['OUTSIDE ISRAEL', 'ISRAEL'],
  tzeit: ['8 POINT 5 DEGREES', '7 POINT 083 DEGREES', '50 MINUTES', '72 MINUTES'],
};
for (const c of SMS_CUSTOMS) {
  const labels = CUSTOM_LABELS[c.key] ?? [];
  add(
    `custom.${c.key}`,
    'Settings',
    `Custom: ${c.name}. In CUSTOMS, in setup, and when going through all 12.`,
    `{step}${c.question} Now: {now}.`,
    [...c.options.map((_, j): Opt => [`v${j}`, labels[j] ?? `OPTION ${j + 1}`]), ['keep', 'KEEP']],
    { 'step?': `Custom ${SMS_CUSTOMS.indexOf(c) + 1} of 12: `, now: shortWords(c.options[0]!.short) },
  );
}
add('customs.page1', 'Settings', 'CUSTOMS: the first five customs to see or change.', 'Customs (1 of 3):', [
  ['minWaitDays', 'WAIT DAYS'],
  ['beinonitDays', 'BEINONIS DAY'],
  ['beinonitLength', 'BEINONIS LENGTH'],
  ['chodeshLength', 'CHODESH LENGTH'],
  ['all', 'ALL 12'],
  ['next', 'NEXT'],
]);
add('customs.page2', 'Settings', 'NEXT in the list of customs.', 'Customs (2 of 3):', [
  ['orZarua', 'OR ZARUA'],
  ['haflagahMethod', 'HAFLAGAH'],
  ['longerHaflagah', 'LONGER HAFLAGAH'],
  ['chodesh30', 'THE 30TH'],
  ['longCycle', 'LONG CYCLES'],
  ['next', 'NEXT'],
]);
add('customs.page3', 'Settings', 'NEXT again in the list of customs.', 'Customs (3 of 3):', [
  ['vesatot', 'VESTOS'],
  ['yomTov', 'YOM TOV'],
  ['nightfall', 'NIGHTFALL'],
  ['all', 'ALL 12'],
]);
add('custom.saved', 'Settings', 'Going through the customs: an answer that changed one.', 'Saved: {name}: {choice}.', MAIN, { name: 'wait before hefsek', choice: 'four days' });
add('custom.kept', 'Settings', 'Going through the customs: an answer that kept one.', 'Kept: {name}: {choice}.', MAIN, { name: 'wait before hefsek', choice: 'five days' });
add('custom.changed', 'Settings', 'One custom was changed.', 'Changed: {name}: {choice}.', MAIN, { name: 'nightfall', choice: '72 minutes' });
add('custom.same', 'Settings', 'One custom answered with its current option.', 'That is already the setting. Nothing was changed.', MAIN);
add('customs.done', 'Settings', 'The end of going through all 12 customs.', 'All 12 customs are saved.', MAIN);
add('vesatot.pause_ask', 'Settings', 'PAUSED for vestos, or the words PAUSE VESTOS.', 'Pause vestos? No onos perishah are shown while they are paused.', [['yes', 'YES'], ['no', 'NO']]);
add('vesatot.paused', 'Settings', 'YES: vestos are paused.', 'Changed: vestos are paused.', MAIN);
add('vesatot.already_paused', 'Settings', 'Pausing vestos when they are already paused.', 'Vestos are already paused.', [['vesatot', 'VESTOS'], MENU]);
add('vesatot.resumed', 'Settings', 'The words RESUME VESTOS.', 'Changed: vestos are calculated again.', MAIN);
add('vesatot.already_on', 'Settings', 'RESUME VESTOS when they are calculated.', 'Vestos are already calculated. Nothing was changed.', MAIN);

// ---------- settings: terms, web ----------

add('terms.show', 'Settings', 'TERMS.', 'Halachic terms in the calendar and on the website: {lang}. Texts are in English letters.', [
  ['hebrew', 'HEBREW'],
  ['english', 'ENGLISH'],
], { lang: 'English letters' });
add('terms.changed', 'Settings', 'The terms were changed.', 'Changed: terms in the calendar and on the website are in {lang}.', MAIN, { lang: 'Hebrew' });
add('terms.same', 'Settings', 'The terms chosen are the ones already set.', 'The terms are already in {lang}. Nothing was changed.', MAIN, { lang: 'English letters' });
add('dates.show', 'Settings', 'DATES.', 'Dates in texts, the calendar and on the website: {dates}.', [
  ['dates_hebrew', 'HEBREW'],
  ['dates_civil', 'CIVIL'],
  ['dates_both', 'BOTH'],
], { dates: 'Hebrew' });
add('dates.changed', 'Settings', 'The dates were changed.', 'Changed: dates are {dates}, e.g. {example}.', MAIN, { dates: 'Hebrew and civil', example: dateExamples('both').example });
add('dates.same', 'Settings', 'The dates chosen are the ones already set.', 'Dates are already {dates}. Nothing was changed.', MAIN, { dates: 'civil' });
add('web.link', 'Settings', 'WEB LINK: a one-time sign-in link, sent as a plain SMS.', 'Betaharah sign-in link for this phone. It works once, within 10 minutes: {link}', [MENU], { link: 'https://betaharah.com/app/?k=abcdefghijklmnopqrstuvwxyzABCDEF' });
add('web.failed', 'Settings', 'WEB LINK when no link can be made.', 'A sign-in link cannot be sent now. Nothing was changed.', [MENU]);
add('website.only', 'Settings', 'PASSWORD, DOWNLOAD, GOOGLE or TIMES.', 'Passwords, data downloads, Google Calendar and reminder times are on the website, under Settings.', [['web', 'WEB LINK'], MENU]);
add('setup.again', 'Sign-up', 'SETUP when no location is set: setup, step 1.', 'Setup step 1 of 3: your ZIP code (or Canadian postal code), for the times of sunset.', [['skip_place', 'SKIP']]);

// ---------- phones ----------

add('phones.list', 'Phones', 'PHONES. ADD, REMOVE and LEAVE are offered where they apply.', 'Phones: {list}.', [['add', 'ADD'], ['remove', 'REMOVE'], ['leave', 'LEAVE'], MENU], {
  list: 'first ending 0101 (this phone, reminders off); second ending 0102 (reminders on)',
});
add('phones.remove_which', 'Phones', 'REMOVE: which phone.', 'Remove which phone? {list}.', [['second', 'SECOND'], ['third', 'THIRD'], ['fourth', 'FOURTH'], MENU], { list: 'second ending 0102' });
add('phones.remove_ask', 'Phones', 'A phone was chosen to remove.', 'Remove the phone ending {last4}? It will no longer see the calendar or get reminders.', [['yes', 'YES'], ['no', 'NO']], { last4: '0102' });
add('phones.removed', 'Phones', 'YES: the phone was removed.', 'Removed the phone ending {last4}.', MAIN, { last4: '0102' });
add('phones.remove_failed', 'Phones', 'The phone could not be removed.', 'The phone ending {last4} could not be removed. Nothing was changed.', MAIN, { last4: '0102' });
add('phones.gone', 'Phones', 'The phone chosen is no longer on the account.', 'The phone ending {last4} is no longer on the account. Nothing was changed.', MAIN, { last4: '0102' });
add('phones.add_code', 'Phones', 'ADD: a code for another phone to text back as JOIN and the code.', 'Have that phone text JOIN {code} to this number within {days} days. The code works once.', [['phones', 'PHONES'], MENU], {
  code: 'NRMAAABZ',
  days: '7',
});
add('phones.add_failed', 'Phones', 'ADD when no code can be made.', 'A code for adding a phone cannot be made now. Nothing was changed.', MAIN);
add('phones.add_full', 'Phones', 'ADD when the account has the most phones.', 'This account already has {count} phones, the most allowed. Nothing was changed.', [['phones', 'PHONES'], MENU], { count: '4' });
add('phones.add_already', 'Phones', 'ADD and a number already on the account.', 'The number ending {last4} is already on this account. Nothing was changed.', MAIN, { last4: '0102' });
add('phones.add_format', 'Phones', 'ADD and something that is not a phone number.', 'Not understood: ADD alone gives a code for the other phone. Nothing was changed.', [['add', 'ADD'], MENU]);
add('phones.leave_ask', 'Phones', 'LEAVE.', 'Take this phone off the account? It will get no more reminders and cannot see the calendar.', [['yes', 'YES'], ['no', 'NO']]);
add('phones.left', 'Phones', 'YES: this phone left the account.', 'This phone is off the account.', [JOIN]);
add('phones.leave_failed', 'Phones', 'This phone could not leave.', 'This phone could not be taken off the account. Nothing was changed.', MAIN);
add('phones.last', 'Phones', 'LEAVE from the only phone on the account.', 'This is the only phone on the account, so it cannot leave it. Nothing was changed.', [['delete', 'DELETE ACCOUNT'], MENU]);
add('join.already', 'Phones', 'JOIN from a phone that is on an account.', 'This phone is already signed up.', MAIN);
add('join.other_account', 'Phones', 'JOIN and a code from a phone that is on an account.', 'This phone is already on an account, so nothing was changed.', MAIN);

// ---------- calendar ----------

const LINK_OPTIONS: Opt[] = [
  ['show_link', 'SHOW LINK'],
  ['new_link', 'NEW LINK'],
  ['remove_link', 'REMOVE LINK'],
  MENU,
];
add('calendar.none', 'Calendar', 'CALENDAR with no link yet.', 'No calendar link yet. A link shows the calendar in any calendar app.', [['create_link', 'CREATE LINK'], MENU]);
add('calendar.has', 'Calendar', 'CALENDAR when a link exists.', 'The calendar link is on.', LINK_OPTIONS);
add('calendar.link', 'Calendar', 'CREATE LINK or SHOW LINK.', 'Calendar link: {url} Anyone who has it can read the calendar.', [['new_link', 'NEW LINK'], ['remove_link', 'REMOVE LINK'], MENU], {
  url: 'https://betaharah.com/cal/abcdefghijklmnopqrstuvwxyzABCDEF.ics',
});
add('calendar.new_ask', 'Calendar', 'NEW LINK.', 'Replace the calendar link? The old link stops working.', [['yes', 'YES'], ['no', 'NO']]);
add('calendar.replaced', 'Calendar', 'YES: the link was replaced.', 'New calendar link: {url} The old link no longer works.', MAIN, { url: 'https://betaharah.com/cal/abcdefghijklmnopqrstuvwxyzABCDEF.ics' });
add('calendar.off_ask', 'Calendar', 'REMOVE LINK.', 'Remove the calendar link? Calendar apps that use it stop updating.', [['yes', 'YES'], ['no', 'NO']]);
add('calendar.removed', 'Calendar', 'YES: the link was removed.', 'The calendar link is removed.', MAIN);
add('calendar.no_link', 'Calendar', 'NEW LINK or REMOVE LINK with no link.', 'There is no calendar link. Nothing was changed.', [['create_link', 'CREATE LINK'], MENU]);

// ---------- deleting the account ----------

add('delete.ask', 'Settings', 'DELETE ACCOUNT.', 'Delete the account? All dates, settings and phones are erased. This cannot be undone.', [['yes', 'YES'], ['no', 'NO']]);
add('delete.done', 'Settings', 'YES: the account was deleted.', 'The account is deleted.', [JOIN]);
add('delete.failed', 'Settings', 'The account could not be deleted.', 'The account could not be deleted. Nothing was changed.', MAIN);

// ---------- other ----------

add('other.test', 'Other', 'A test text, sent from the console or from Settings on the website.', 'Betaharah: test message.', MAIN);

export const MESSAGES: readonly MessageDef[] = MESSAGES_LIST;
export const MESSAGE_BY_KEY: ReadonlyMap<string, MessageDef> = new Map(MESSAGES_LIST.map(m => [m.key, m]));

/** The message, or an error for a key that is not in the registry (a bug). */
export function messageDef(key: string): MessageDef {
  const m = MESSAGE_BY_KEY.get(key);
  if (!m) throw new Error(`no such message: ${key}`);
  return m;
}
