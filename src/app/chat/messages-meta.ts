/**
 * How the operator's Texts page lists the texts of the registry
 * (messages.ts): a short name and a plain "sent when" for each, the
 * category it is listed under, its place in that category, and whether it
 * is one of the texts most people will ever get ("important").
 *
 * This is kept apart from the registry, by key, so that the registry can
 * grow without touching it. A key with no entry here is still listed, under
 * "Other", with its key as its name and the registry's own "when" line
 * (test/texts-meta.test.ts names any key that has no entry).
 *
 * Two kinds of grouping keep the list short:
 *   - a variant: the same text in another wording, shown inside the row of
 *     its main text (each reminder's discreet wording, by its ".discreet"
 *     key; a few others named here with `variantOf`);
 *   - a set: texts that differ only by what they are about, shown as one
 *     row that opens to its members (the twelve customs questions).
 */
import { SMS_CUSTOMS } from './customs';

export const CATEGORIES = [
  { id: 'reminders', name: 'Reminders' },
  { id: 'recording', name: 'Recording' },
  { id: 'status', name: 'Status' },
  { id: 'signup', name: 'Sign-up and setup' },
  { id: 'menu', name: 'Menu and not understood' },
  { id: 'settings', name: 'Settings by text', subs: ['Reminders', 'Location', 'Customs', 'Calendar', 'Terms and dates'] },
  { id: 'phones', name: 'Phones and account' },
  { id: 'carrier', name: 'Carrier words and sign-in' },
  { id: 'other', name: 'Other' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];

/** Rows that open to their members. */
export const TEXT_SETS: Record<string, { name: string; sent: string }> = {
  'customs.questions': { name: 'Customs questions', sent: 'CUSTOMS, setup, or going through all 12.' },
  'customs.pages': { name: 'List of customs', sent: 'CUSTOMS: the customs in three short pages.' },
  'reminder.rest.lines': { name: 'Lines before Shabbat', sent: 'The lines of the text before Shabbat or Yom Tov, after its first line.' },
};

export interface TextMeta {
  /** 2 to 5 words. */
  name: string;
  /** When it is sent, in one plain sentence. */
  sent: string;
  category: CategoryId;
  /** A part of the category (only "Settings by text" has parts). */
  sub?: string;
  /** The key of a set in TEXT_SETS. */
  set?: string;
  /** Another wording of this text: the key of the main text. */
  variantOf?: string;
  /** The name of this wording inside the main text's row ("Discreet"). */
  variant?: string;
  /** One of the texts most people will ever get. */
  important?: true;
}

type Entry = [name: string, sent: string, extra?: Partial<Pick<TextMeta, 'sub' | 'set' | 'variantOf' | 'variant' | 'important'>>];

const IMPORTANT = { important: true } as const;

/** The entries, by category, in the order they are listed. */
const BY_CATEGORY: Record<CategoryId, Record<string, Entry>> = {
  reminders: {
    'reminder.hefsek': ['Hefsek taharah day', 'The day the hefsek can be done. DONE records it.', IMPORTANT],
    'reminder.bedikah_morning': ['Morning bedikah', 'The morning of each clean day.', IMPORTANT],
    'reminder.bedikah_afternoon': ['Afternoon bedikah', 'Before sunset on each clean day.', IMPORTANT],
    'reminder.mikvah_book': ['Book the mikvah', 'The morning after the hefsek was recorded.', IMPORTANT],
    'reminder.mikvah': ['Mikvah night', 'The day of the mikvah night.', IMPORTANT],
    'reminder.onah': ['Onah coming', 'Before an onah of separation begins.', IMPORTANT],
    'reminder.rest': ['Before Shabbat or Yom Tov', 'The morning it begins: one text with what falls on it, a line each.', IMPORTANT],
    'reminder.rest.hefsek': ['Line: hefsek day', 'In the text before Shabbat or Yom Tov.', { set: 'reminder.rest.lines' }],
    'reminder.rest.bedikot': ['Line: both bedikot', 'In the text before Shabbat or Yom Tov: morning and before sunset.', { set: 'reminder.rest.lines' }],
    'reminder.rest.bedikah_morning': ['Line: morning bedikah', 'In the text before Shabbat or Yom Tov: the morning one alone.', { set: 'reminder.rest.lines' }],
    'reminder.rest.bedikah_afternoon': ['Line: bedikah before sunset', 'In the text before Shabbat or Yom Tov: the one before sunset alone.', { set: 'reminder.rest.lines' }],
    'reminder.rest.mikvah': ['Line: mikvah night', 'In the text before Shabbat or Yom Tov: a mikvah night on it or right after.', { set: 'reminder.rest.lines' }],
    'reminder.rest.mikvah_book': ['Line: book the mikvah', 'In the text before Shabbat or Yom Tov.', { set: 'reminder.rest.lines' }],
    'reminder.rest.onah': ['Line: onah', 'In the text before Shabbat or Yom Tov: an onah that begins on it.', { set: 'reminder.rest.lines' }],
  },
  recording: {
    'record.when_flow': ['When did the period begin', 'PERIOD with no time given.', IMPORTANT],
    'record.flow': ['Period recorded', 'A period was recorded.', IMPORTANT],
    'record.when_hefsek': ['Which day was the hefsek', 'HEFSEK with no day given.', IMPORTANT],
    'record.hefsek': ['Hefsek recorded', 'A hefsek was recorded (or DONE on its reminder).', IMPORTANT],
    'menu.entries': ['Other entries menu', 'The option OTHER ENTRIES.'],
    'record.when_stain': ['When was the stain', 'STAIN with no time given.'],
    'record.stain': ['Stain recorded', 'A stain was recorded.'],
    'record.when_broken': ['When was the count broken', 'COUNT BROKEN with no time given.'],
    'record.broken': ['Broken count recorded', 'A broken count was recorded.'],
    'record.when_immersion': ['Which night was the immersion', 'IMMERSION with no night given.'],
    'record.immersion': ['Immersion recorded', 'An immersion was recorded.'],
    'record.date_onah': ['Ask for date and onah', 'ANOTHER DAY, for a period, stain or break.'],
    'record.date_day': ['Ask for a date', 'ANOTHER DAY, for a hefsek or an immersion.'],
    'undo.done': ['Undo done', 'UNDO removed the latest entry (48 hours).'],
    'undo.nothing': ['Nothing to undo', 'UNDO with nothing from the last 48 hours.'],
    'history.list': ['History list', 'HISTORY: the last five entries, to erase one.'],
    'history.empty': ['History is empty', 'HISTORY with no entries yet.'],
    'history.erase_ask': ['Erase this entry?', 'An entry was chosen from HISTORY.'],
    'history.erased': ['Entry erased', 'YES to erasing an entry.'],
    'history.gone': ['Entry already gone', 'The entry chosen was already removed.'],
    'refuse.duplicate': ['Already recorded', 'The same entry is already recorded.'],
    'refuse.future': ['Not yet: future time', 'A time or date that has not come yet.'],
    'refuse.no_period': ['Not recorded: no period', 'A hefsek or an immersion with no period open.'],
    'refuse.before_start': ['Not recorded: before period', 'A hefsek dated before the period began.'],
    'refuse.no_count': ['Not recorded: no count', 'COUNT BROKEN with no count going on.'],
    'refuse.no_hefsek': ['Not recorded: no hefsek', 'An immersion with no hefsek recorded.'],
    'refuse.too_early': ['Not recorded: too early', 'An immersion before the count is complete.'],
    'refuse.too_early_plain': ['Night not known', 'The same, when the mikvah night is not known.', { variantOf: 'refuse.too_early', variant: 'Night not known' }],
    'refuse.other': ['Not recorded', 'Any other entry that cannot be recorded.'],
    'refuse.no_place': ['Not recorded: no location', 'Recording before a location is set.'],
    'refuse.read_only': ['Phone may not record', 'Recording from a view-only phone.'],
    'date.read_as': ['How the date was read', 'Added to a refusal of a written date.'],
    'date.form': ['Date not understood', 'A date not written as month and day.'],
    'date.no_such': ['No such date', 'A date that does not exist, such as 2/30.'],
    'date.year': ['Year not possible', 'A year that cannot be right.'],
    'date.not_recent': ['Not in the past year', 'Feb 29 without a year, none in the past year.'],
    'date.needs_onah': ['Date needs day or night', 'A period date with no day, night or time.'],
    'date.nothing_more': ['Date alone, please', 'A hefsek or immersion date with more after it.'],
    'date.adar': ['Adar I or Adar II?', 'A Hebrew date in Adar, in a leap year, without I or II.'],
  },
  status: {
    'status.tehorah_onah': ['Tehorah, next onah', 'STATUS when tehorah, with the next onah.', IMPORTANT],
    'status.tehorah': ['No onah ahead', 'STATUS when tehorah and no onah is coming.', { variantOf: 'status.tehorah_onah', variant: 'No onah ahead' }],
    'status.before_hefsek': ['Before the hefsek', 'STATUS before the hefsek.', IMPORTANT],
    'status.before_hefsek_later': ['First day passed', 'STATUS once the first hefsek day passed.', { variantOf: 'status.before_hefsek', variant: 'First day passed' }],
    'status.before_first_day': ['After the hefsek', 'STATUS after the hefsek, before clean day 1.', IMPORTANT],
    'status.counting': ['Counting clean days', 'STATUS during the seven clean days.', IMPORTANT],
    'status.mikvah_tonight': ['Mikvah tonight', 'STATUS on the mikvah night.', IMPORTANT],
    'status.postponed': ['Immersion put off', 'STATUS when the immersion is put off.'],
    'status.no_place': ['Status: no location', 'STATUS before a location is set.'],
  },
  signup: {
    'signup.welcome': ['Welcome, open sign-up', 'A first text from a new number (open sign-up).', IMPORTANT],
    'signup.invite': ['Welcome, by invitation', 'A first text from a new number (by invitation).'],
    'signup.bad_word': ['Invitation not valid', 'JOIN with a word or code that is not valid.'],
    'signup.join_full': ['Account is full', 'JOIN for an account that has four phones.'],
    'setup.start': ['Setup step 1: ZIP code', 'Right after JOIN: the first step of setup.', IMPORTANT],
    'setup.again': ['SETUP, no location', 'SETUP when no location is set.', { variantOf: 'setup.start', variant: 'SETUP again' }],
    'setup.start_place': ['Setup step 1: keep location', 'SETUP when a location is set.'],
    'setup.customs': ['Setup step 2: customs', 'Setup, after the location.'],
    'setup.recent': ['Setup step 3: last period', 'Setup, after the customs.'],
    'setup.recent_hefsek': ['Setup: hefsek done?', 'Setup, after the last period was given.'],
    'setup.done': ['Setup done', 'The end of setup.', IMPORTANT],
    'setup.joined': ['Phone joined', 'A phone joined an account with a code.'],
  },
  menu: {
    'menu.main': ['Main options', 'MENU, ?, or OPTIONS.', IMPORTANT],
    'menu.more': ['More options', 'The option MORE.', IMPORTANT],
    'menu.settings': ['Settings menu', 'The option SETTINGS.'],
    'menu.account': ['Account menu', 'The option ACCOUNT.'],
    'not_understood': ['Not understood', 'A reply that matches no option and no word.', IMPORTANT],
    'confirm.no': ['Nothing changed', 'NO to a question, or KEEP for one custom.'],
    'website.only': ['On the website only', 'PASSWORD, DOWNLOAD, GOOGLE or TIMES.'],
  },
  settings: {
    'reminders.show': ['Reminders: this phone', 'REMINDERS: on or off, kinds, wording, bedikot, Shabbat.', { sub: 'Reminders' }],
    'reminders.on': ['Reminders turned on', 'TURN ON: the consent to reminder texts.', { sub: 'Reminders', important: true }],
    'reminders.already_on': ['Already on', 'TURN ON when reminders are already on.', { sub: 'Reminders' }],
    'reminders.off': ['Reminders turned off', 'TURN OFF.', { sub: 'Reminders' }],
    'reminders.already_off': ['Already off', 'TURN OFF when reminders are already off.', { sub: 'Reminders' }],
    'reminders.opted_out': ['Phone replied STOP', 'TURN ON from a phone that replied STOP.', { sub: 'Reminders' }],
    'reminders.kinds': ['Kinds of reminders', 'KINDS: each option turns one kind on or off.', { sub: 'Reminders' }],
    'reminders.kinds_changed': ['Kind turned on or off', 'A kind was turned on or off.', { sub: 'Reminders' }],
    'reminders.wording': ['Plain or discreet', 'WORDING: plain or discreet, for every phone.', { sub: 'Reminders' }],
    'reminders.wording_changed': ['Wording changed', 'The wording was changed.', { sub: 'Reminders' }],
    'reminders.wording_same': ['Wording unchanged', 'The wording chosen is already set.', { sub: 'Reminders' }],
    'reminders.bedikot': ['Bedikah reminders', 'BEDIKOT: which clean days, morning and before sunset.', { sub: 'Reminders' }],
    'reminders.bedikot_changed': ['Bedikah reminders changed', 'The days, or the morning or before-sunset reminder, were changed.', { sub: 'Reminders' }],
    'reminders.bedikot_same': ['Bedikah reminders unchanged', 'A bedikah choice that is already set.', { sub: 'Reminders' }],
    'reminders.days_ask': ['Which clean days', 'CHOOSE DAYS: she writes the day numbers.', { sub: 'Reminders' }],
    'reminders.days_bad': ['Clean days not understood', 'Numbers that are not clean days 1 to 7.', { sub: 'Reminders' }],
    'reminders.rest_eve': ['Text before Shabbat: time', 'SHABBAT: its time; a time written in reply changes it.', { sub: 'Reminders' }],
    'reminders.rest_eve_changed': ['Time before Shabbat set', 'A time was written after SHABBAT.', { sub: 'Reminders' }],
    'reminders.rest_eve_bad': ['Time not understood', 'Numbers after SHABBAT that are not a time.', { sub: 'Reminders' }],
    'location.show': ['Location now', 'LOCATION when one is set.', { sub: 'Location' }],
    'location.ask': ['Ask for a ZIP code', 'LOCATION when none is set.', { sub: 'Location' }],
    'location.set': ['Location set', 'A ZIP code was set.', { sub: 'Location' }],
    'location.unknown': ['No place found', 'A ZIP code with no place found.', { sub: 'Location' }],
    'location.not_postal': ['Not a ZIP code', 'LOCATION with something not a ZIP code.', { sub: 'Location' }],
    'location.confirm': ['Use shared location?', 'RCS: a location was shared unasked.', { sub: 'Location' }],
    'location.none_near': ['No place near it', 'RCS: a shared location outside US and Canada.', { sub: 'Location' }],
    // the twelve questions (custom.<key>) are added below, in the order of SMS_CUSTOMS
    'customs.page1': ['Page 1 of 3', 'CUSTOMS.', { sub: 'Customs', set: 'customs.pages' }],
    'customs.page2': ['Page 2 of 3', 'NEXT on page 1.', { sub: 'Customs', set: 'customs.pages' }],
    'customs.page3': ['Page 3 of 3', 'NEXT on page 2.', { sub: 'Customs', set: 'customs.pages' }],
    'custom.changed': ['Custom changed', 'One custom was changed.', { sub: 'Customs' }],
    'custom.same': ['Custom unchanged', 'One custom answered with its current option.', { sub: 'Customs' }],
    'custom.saved': ['Saved, going through all', 'Going through all 12: an answer that changed.', { sub: 'Customs' }],
    'custom.kept': ['Kept, going through all', 'Going through all 12: an answer that kept.', { sub: 'Customs' }],
    'customs.done': ['All 12 saved', 'The end of going through all 12 customs.', { sub: 'Customs' }],
    'vesatot.pause_ask': ['Pause vesatot?', 'PAUSED for vesatot, or PAUSE VESATOT.', { sub: 'Customs' }],
    'vesatot.paused': ['Vesatot paused', 'YES to pausing vesatot.', { sub: 'Customs' }],
    'vesatot.already_paused': ['Already paused', 'Pausing vesatot when they are already paused.', { sub: 'Customs' }],
    'vesatot.resumed': ['Vesatot resumed', 'RESUME VESATOT.', { sub: 'Customs' }],
    'vesatot.already_on': ['Already calculated', 'RESUME VESATOT when already calculated.', { sub: 'Customs' }],
    'calendar.none': ['No calendar link', 'CALENDAR with no link yet.', { sub: 'Calendar' }],
    'calendar.has': ['Calendar link is on', 'CALENDAR when a link exists.', { sub: 'Calendar' }],
    'calendar.link': ['The calendar link', 'CREATE LINK or SHOW LINK.', { sub: 'Calendar' }],
    'calendar.new_ask': ['Replace the link?', 'NEW LINK.', { sub: 'Calendar' }],
    'calendar.replaced': ['Link replaced', 'YES to a new link.', { sub: 'Calendar' }],
    'calendar.off_ask': ['Remove the link?', 'REMOVE LINK.', { sub: 'Calendar' }],
    'calendar.removed': ['Link removed', 'YES to removing the link.', { sub: 'Calendar' }],
    'calendar.no_link': ['There is no link', 'NEW LINK or REMOVE LINK with no link.', { sub: 'Calendar' }],
    'terms.show': ['Hebrew or English terms', 'TERMS.', { sub: 'Terms and dates' }],
    'terms.changed': ['Terms changed', 'The terms were changed.', { sub: 'Terms and dates' }],
    'terms.same': ['Terms unchanged', 'The terms chosen are already set.', { sub: 'Terms and dates' }],
    'dates.show': ['Hebrew, civil or both dates', 'DATES.', { sub: 'Terms and dates' }],
    'dates.changed': ['Dates changed', 'The dates were changed.', { sub: 'Terms and dates' }],
    'dates.same': ['Dates unchanged', 'The dates chosen are already set.', { sub: 'Terms and dates' }],
  },
  phones: {
    'phones.list': ['Phones on the account', 'PHONES.'],
    'phones.add_code': ['Code to add a phone', 'ADD: a code for the other phone to text.'],
    'phones.add_failed': ['No code now', 'ADD when no code can be made.'],
    'phones.add_full': ['Too many phones', 'ADD when the account has four phones.'],
    'phones.add_already': ['Number already added', 'ADD with a number already on the account.'],
    'phones.add_format': ['ADD not understood', 'ADD with something not a phone number.'],
    'phones.remove_which': ['Remove which phone?', 'REMOVE.'],
    'phones.remove_ask': ['Remove this phone?', 'A phone was chosen to remove.'],
    'phones.removed': ['Phone removed', 'YES to removing a phone.'],
    'phones.remove_failed': ['Could not remove', 'The phone could not be removed.'],
    'phones.gone': ['Phone already gone', 'The phone chosen is no longer on the account.'],
    'phones.leave_ask': ['Leave the account?', 'LEAVE.'],
    'phones.left': ['Phone left', 'YES to leaving the account.'],
    'phones.leave_failed': ['Could not leave', 'This phone could not leave the account.'],
    'phones.last': ['Only phone, cannot leave', 'LEAVE from the only phone on the account.'],
    'join.already': ['Already signed up', 'JOIN from a phone that is on an account.'],
    'join.other_account': ['On another account', 'JOIN from a phone on another account.'],
    'web.link': ['Website sign-in link', 'WEB LINK: a one-time link to the website.'],
    'web.failed': ['No sign-in link now', 'WEB LINK when no link can be made.'],
    'delete.ask': ['Delete the account?', 'DELETE ACCOUNT.'],
    'delete.done': ['Account deleted', 'YES to deleting the account.'],
    'delete.failed': ['Could not delete', 'The account could not be deleted.'],
  },
  carrier: {
    'carrier.code': ['Sign-in code', 'A sign-in code asked for on the website.'],
    'carrier.help': ['Reply to HELP', 'HELP or INFO, from any number.'],
    'carrier.start': ['Reply to START', 'START, UNSTOP, or reminders on, on the website.'],
    'other.test': ['Test text', 'A test from the console or the website.'],
  },
  other: {},
};

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The twelve customs questions, one set, after the list of customs. */
const CUSTOM_QUESTIONS: Record<string, Entry> = Object.fromEntries(
  SMS_CUSTOMS.map(c => [`custom.${c.key}`, [`${cap(c.name)} question`, 'In CUSTOMS, in setup, or going through all 12.', { sub: 'Customs', set: 'customs.questions' }] as Entry]),
);

function build(): Map<string, TextMeta & { order: number }> {
  const out = new Map<string, TextMeta & { order: number }>();
  let order = 0;
  const put = (key: string, category: CategoryId, [name, sent, extra]: Entry): void => {
    out.set(key, { name, sent, category, ...(extra ?? {}), order: order++ });
  };
  for (const { id } of CATEGORIES) {
    for (const [key, entry] of Object.entries(BY_CATEGORY[id])) {
      if (key === 'customs.page1') for (const [k, e] of Object.entries(CUSTOM_QUESTIONS)) put(k, 'settings', e);
      put(key, id, entry);
    }
  }
  return out;
}

const META = build();

/** Whether a key has its own entry (or is the discreet wording of one that has). */
export function hasMeta(key: string): boolean {
  return META.has(key) || (key.endsWith('.discreet') && META.has(key.slice(0, -'.discreet'.length)));
}

/**
 * The listing of one text. A ".discreet" key is the discreet wording of its
 * main text; a key with no entry is listed under "Other".
 */
export function textMeta(key: string, when: string): TextMeta & { order: number } {
  const own = META.get(key);
  if (own) return own;
  if (key.endsWith('.discreet')) {
    const base = META.get(key.slice(0, -'.discreet'.length));
    if (base) return { name: base.name, sent: base.sent, category: base.category, ...(base.sub ? { sub: base.sub } : {}), variantOf: key.slice(0, -'.discreet'.length), variant: 'Discreet', order: base.order };
  }
  return { name: key, sent: when, category: 'other', order: META.size };
}
