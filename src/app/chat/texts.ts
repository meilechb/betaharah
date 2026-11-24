/**
 * The fixed wording of the conversation. Every text here is GSM-7 and fits
 * one or two SMS segments (the tests check each one). Plain, literal
 * sentences; halachic terms in English letters.
 */
import type { OutMessage, Suggestion } from './types';

export const SITE = 'betaharah.com';

// ---------- a number with no account (greet) ----------

/** Any first text from an unknown number while sign-up is open. */
export const WELCOME_OPEN =
  'Betaharah is a mikvah calendar by text message. Reply JOIN to sign up. Msg frequency varies. Msg&data rates may apply. Reply STOP to stop, HELP for help. Terms: betaharah.com/terms';

/** Any first text from an unknown number while sign-up is by invitation. */
export const WELCOME_INVITE =
  'Betaharah is a mikvah calendar by text message. Sign-up is by invitation: reply JOIN and your invitation word. Msg&data rates may apply. Reply STOP to stop, HELP for help. Terms: betaharah.com/terms';

export const BAD_INVITATION = 'Betaharah: that code or invitation word is not valid, or it has expired. Nothing was set up. Reply STOP to stop, HELP for help.';

// ---------- setup ----------

export const SETUP_START =
  'Welcome to Betaharah. This phone is signed up. Step 1 of 3: reply with your ZIP code (in Canada, your postal code, e.g. H3W 1A1). It sets the times of sunset.';

export function setupStartWithPlace(name: string): string {
  return `Setup. Step 1 of 3: your location is ${name}. Reply with a new ZIP code, or KEEP to keep it.`;
}

export const ASK_ZIP = 'Reply with your ZIP code (in Canada, your postal code, e.g. H3W 1A1). It sets the times of sunset.';

export function unknownZip(typed: string): string {
  return `No place was found for ${typed}. Reply with a 5-digit US ZIP code or a Canadian postal code. For other countries, send WEB for a link to set it on the website.`;
}

export const NOT_A_ZIP =
  'Not understood; nothing was changed. Reply with a 5-digit ZIP code (or a Canadian postal code such as H3W 1A1). For other countries, send WEB for a link to the website.';

export const NO_PLACE_NEAR = 'No US or Canadian place was found near the location you shared. Nothing was changed. Reply with your ZIP code instead.';

export function placeSet(name: string): string {
  return `Location set: ${name}. Sunset and nightfall are now worked out for it.`;
}

export const CUSTOMS_INTRO =
  'Step 2 of 3: customs. Until you choose, the calendar uses the stricter option of each custom, ideally chosen with your rav. Any can be changed at any time. A: keep them for now. B: answer the 12 questions by text. C: do it later on the website. Reply A, B or C.';

export const CUSTOMS_INTRO_SUGGEST: Suggestion[] = [
  { label: 'A: Keep for now', send: 'A' },
  { label: 'B: Answer by text', send: 'B' },
  { label: 'C: Later, website', send: 'C' },
];

export const CUSTOMS_KEPT = 'The stricter option of each custom stays until you change it. CUSTOMS changes one at any time.';
export const CUSTOMS_LATER = 'Customs can be reviewed on the website, under Customs. Until then the stricter option of each is used.';

export const RECENT_ASK =
  'Step 3 of 3: recent dates. Send the start of the most recent period: 1, the date, and day or night, e.g. 1 11/22 night (the night that begins that evening). Or reply SKIP.';

export const RECENT_NEXT = 'If the hefsek was done: send 2 and its date, e.g. 2 11/26. Reply DONE when finished.';

export const SETUP_DONE =
  'Setup is finished. From now on text 1 when a flow begins, 2 after the hefsek, 9 for status. Reminders are off until you text REMINDERS ON. MENU lists everything.';

export function joinedText(others: string): string {
  return `This phone is now on the account${others}. Text 9 for status, MENU for everything. Reminders are off for this phone until you text REMINDERS ON.`;
}

// ---------- the menu and its words ----------

export const MENU =
  'Words: STATUS, HISTORY, UNDO, LOCATION, CUSTOMS, NIGHTFALL, REMINDERS, PHONES, CALENDAR, TERMS, WEB, SETUP, DELETE ACCOUNT. Send one to see its options. Digits record: 1 flow, 2 hefsek, 3 count broken, 4 mikvah, 5 stain, 9 status, 0 undo; ? for more.';

export const MENU_SUGGEST: Suggestion[] = [
  { label: 'Status', send: 'STATUS' },
  { label: 'History', send: 'HISTORY' },
  { label: 'Customs', send: 'CUSTOMS' },
  { label: 'Reminders', send: 'REMINDERS' },
];

export const UNKNOWN =
  'Not understood; nothing was changed. Digits record: 1 flow, 2 hefsek, 3 count broken, 4 mikvah, 5 stain, 9 status, 0 undo. MENU lists the other words.';

export const NOTHING_PENDING = 'There is no question waiting for an answer, so nothing was changed. MENU lists the words.';

export function expired(again: string): string {
  return `That question was sent more than 30 minutes ago, so it was closed and nothing was changed. ${again}`;
}

export const ALREADY_JOINED = 'This phone is already signed up. MENU lists the words.';

/** JOIN and a code from a phone that is already on an account. */
export const ALREADY_ON_ACCOUNT = 'This phone is already on a Betaharah account, so nothing was changed. To join another account, send LEAVE first, then the JOIN text again.';

export const NO_PLACE_STATUS = 'No location is set yet. Text LOCATION and your ZIP code, e.g. LOCATION 08701, or choose it on the website.';

export const READ_ONLY = 'This phone may not record entries. That is changed on the website, under Settings.';

export const ZIP_HINT = 'To change your location, send LOCATION and the ZIP code, e.g. LOCATION 08701. Nothing was changed.';

export const HISTORY_EMPTY = 'No entries yet. Record with 1, 2, 3, 4 or 5; send ? for the details.';

export const ERASE_NEEDS_LIST = 'Send HISTORY first, then ERASE and the letter of the entry. Nothing was changed.';
export const ENTRY_GONE = 'That entry is no longer there. Nothing was changed. Send HISTORY for the current list.';

export const REMOVE_NEEDS_LIST = 'Send PHONES first, then REMOVE and the letter of the phone. Nothing was changed.';
export const REMOVE_SELF = 'That is this phone. To take this phone off the account, send LEAVE. Nothing was changed.';
export const LAST_PHONE = 'This is the only phone on the account, so it cannot leave it. To close the account, send DELETE ACCOUNT. Nothing was changed.';

export const ADD_FORMAT = 'Not understood; nothing was changed. Send ADD on its own: it gives a code for the other phone to text to this number.';

export const CUSTOMS_LIST =
  'Customs: reply a letter to see or change one. A wait before hefsek, B onah beinonit day, C onah beinonit length, D veset hachodesh length, E Or Zarua, F haflagah count, G longer haflagah, H flow on the 30th, I long cycles, J vesatot, K Yom Tov, L nightfall. CUSTOMS ALL goes through all 12.';

export const CUSTOMS_ALL_DONE = 'All 12 customs are saved. The calendar follows what you selected. CUSTOMS changes one at any time.';

export const KEPT_ONE = 'Kept as it was; nothing was changed.';

export const VESATOT_ALREADY_PAUSED = 'Vesatot are already paused: no onot perishah are calculated. RESUME VESATOT turns them back on.';
export const VESATOT_ALREADY_ON = 'Vesatot are already calculated. Nothing was changed.';
export const PAUSE_ASK =
  'Pause vesatot? The calendar will then show no onot perishah (for pregnancy, nursing, or on the instruction of a rav) until you send RESUME VESATOT. Reply YES to pause them, NO to keep them.';
export const PAUSED = 'Changed: no vesatot are calculated for now, as you selected. RESUME VESATOT turns them back on.';
export const RESUMED = 'Changed: vesatot are calculated again, as you selected.';

export const TERMS_HE = 'Changed: halachic terms in the calendar and on the website are now in Hebrew. Texts stay in English letters. TERMS ENGLISH changes it back.';
export const TERMS_EN = 'Changed: halachic terms in the calendar and on the website are now in English letters. TERMS HEBREW changes it back.';
export function termsNow(lang: 'en' | 'he'): string {
  return `Halachic terms in the calendar and on the website are in ${lang === 'he' ? 'Hebrew' : 'English letters'}. TERMS HEBREW or TERMS ENGLISH changes it. Texts are always in English letters.`;
}

// ---------- reminders ----------

export function remindersOn(last4: string): string {
  return `Reminders are on for this phone (ending ${last4}). This phone agrees to receive reminder texts from Betaharah. Msg frequency varies. Msg&data rates may apply. Reply STOP to stop, HELP for help.`;
}
export const REMINDERS_ALREADY_ON = 'Reminders are already on for this phone. REMINDERS OFF turns them off.';
export const REMINDERS_OFF = 'Changed: reminders are off for this phone. Replies to your texts still come. REMINDERS ON turns them back on.';
export const REMINDERS_ALREADY_OFF = 'Reminders are already off for this phone. REMINDERS ON turns them on.';
export const OPTED_OUT = 'This phone replied STOP earlier. Reply START first, then REMINDERS ON.';

export const KIND_NAMES = ['hefsek', 'morning bedikah', 'afternoon bedikah', 'mikvah night', 'book the mikvah', 'onah'] as const;

export function wordingChanged(style: 'plain' | 'discreet'): string {
  return style === 'discreet'
    ? 'Changed: reminder wording is now discreet for every phone on the account: short letters, such as H for hefsek and M for mikvah, instead of the words.'
    : 'Changed: reminder wording is now plain for every phone on the account: the full words.';
}
export function wordingSame(style: 'plain' | 'discreet'): string {
  return `Reminder wording is already ${style}. Nothing was changed.`;
}

export const WEBSITE_TIMES = 'Reminder times, in minutes before sunset and so on, are set on the website, under Settings. Send WEB for a sign-in link.';

// ---------- phones ----------

/** The reply to ADD: the code the other phone texts back. Nothing is sent to that phone. */
export function addCode(code: string, days: number): string {
  return `Have that phone text JOIN ${code} to this number within ${days} days. The code works once, for one phone. Its reminders stay off until it texts REMINDERS ON.`;
}
export const ADD_FAILED = 'A code for adding a phone cannot be made now. Nothing was changed. Try again later, or add the phone on the website.';

export function removeAsk(last4: string): string {
  return `Remove the phone ending ${last4} from the account? It will no longer see the calendar or get reminders. Reply YES to remove it, NO to keep it.`;
}
export function removed(last4: string): string {
  return `Removed the phone ending ${last4} from the account.`;
}
export function removeFailed(last4: string): string {
  return `The phone ending ${last4} could not be removed. Nothing was changed. Try again, or use the website.`;
}

export const LEAVE_ASK = 'Take this phone off the account? It will get no more reminders and cannot see the calendar. The other phones keep everything. Reply YES to leave, NO to stay.';
export const LEFT = 'This phone is off the account. It will get no more texts from Betaharah unless it signs up or joins an account again.';
export const LEAVE_FAILED = 'This phone could not be taken off the account. Nothing was changed. Try again, or use the website.';

export const DELETE_ASK =
  'Delete the account? All dates, settings and phones are erased, and this cannot be undone. Download your data first on the website if you want it. Reply YES to delete, NO to keep it.';
export const DELETED = 'The account is deleted: all dates, settings and phones. No more texts will be sent unless you sign up again.';
export const DELETE_FAILED = 'The account could not be deleted. Nothing was changed. Try again, or use the website.';

// ---------- calendar ----------

export const CALENDAR_NONE =
  'No calendar link yet. CALENDAR LINK creates a private link to show the calendar in a calendar app. Google Calendar is connected on the website, under Settings.';
export const CALENDAR_HAS =
  'The calendar link is on. CALENDAR LINK shows it, CALENDAR NEW replaces it, CALENDAR OFF removes it. Google Calendar is connected on the website, under Settings.';
export function calendarCreated(url: string): string {
  return `Calendar link created: ${url} Anyone who has this link can read the calendar, so keep it private. CALENDAR NEW replaces it, CALENDAR OFF removes it.`;
}
export function calendarShow(url: string): string {
  return `Calendar link: ${url} Anyone who has this link can read the calendar, so keep it private.`;
}
export function calendarReplaced(url: string): string {
  return `Changed: new calendar link: ${url} The old link no longer works; add the new one in your calendar app. Anyone who has it can read the calendar.`;
}
export const CALENDAR_NEW_ASK = 'Replace the calendar link? The old link stops working, and calendar apps that use it stop updating. Reply YES to replace it, NO to keep it.';
export const CALENDAR_OFF_ASK = 'Remove the calendar link? Calendar apps that use it stop updating. Reply YES to remove it, NO to keep it.';
export const CALENDAR_OFF = 'Changed: the calendar link is removed and no longer works. CALENDAR LINK creates a new one.';
export const CALENDAR_NO_LINK = 'There is no calendar link. CALENDAR LINK creates one. Nothing was changed.';

// ---------- website only ----------

export const WEB_LINK_TEXT = 'Betaharah sign-in link for this phone. It works once, within 10 minutes: ';
export const WEB_FAILED = 'A sign-in link cannot be sent now. Sign in at betaharah.com with this phone number instead.';
export const WEBSITE_PASSWORD = 'A password is set on the website, under Settings. Send WEB for a sign-in link.';
export const WEBSITE_DATA = 'Download my data is on the website, under Settings. Send WEB for a sign-in link.';
export const WEBSITE_GOOGLE = 'Google Calendar is connected on the website, under Settings. Send WEB for a sign-in link. CALENDAR LINK works with any calendar app by text.';

export const NO_CHANGE = 'Nothing was changed.';

// ---------- helpers ----------

export function msg(text: string, suggestions?: Suggestion[]): OutMessage {
  return suggestions && suggestions.length > 0 ? { text, suggestions } : { text };
}

export const YES_NO: Suggestion[] = [
  { label: 'Yes', send: 'YES' },
  { label: 'No', send: 'NO' },
];
