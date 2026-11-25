/**
 * The conversation engine (src/app/chat): every reply ends with its
 * options; replies are read by option, by word, or as a date; nothing is
 * guessed; digits are never commands.
 */
import { describe, expect, it } from 'vitest';
import { begin, CHAT_TTL_MS, converse, greet, joinWord, validChat, type ChatState } from '../src/app/chat';
import { inviteCode, postalOf } from '../src/app/chat/engine';
import { repairs } from '../src/app/chat/gsm';
import { matchGeneral, matchOption, NO_TEXTS, optionsOf, parseSiteTexts } from '../src/app/chat/site-texts';
import { newHousehold } from '../src/app/model';
import { REMINDER_KINDS } from '../src/app/settings';
import { at, bodies, household, labels, lookupPostal, makeRandom, ME, nearestPostal, NOW, phone, Phone, PLACES, SPOUSE } from './chat-fixtures';

const MAIN = ['PERIOD', 'HEFSEK', 'STATUS', 'MORE'];

describe('signing up: greet', () => {
  it('open: any text gets one welcome with JOIN as its option; JOIN creates the account', () => {
    const hi = greet({ text: 'Hi', signup: 'open', inviteValid: null });
    expect(hi.action).toBe('reply');
    expect(hi.out).toHaveLength(1);
    expect(hi.out[0]!.text).toBe(
      'Betaharah: a mikvah calendar by text. Msg frequency varies. Msg&data rates may apply. Reply STOP to stop, HELP for help. Terms: betaharah.com/terms\nReply: JOIN',
    );
    expect(hi.out[0]!.suggestions).toEqual([{ label: 'JOIN', send: 'JOIN' }]);
    for (const t of ['JOIN', 'join', ' Join. ']) expect(greet({ text: t, signup: 'open', inviteValid: null })).toEqual({ action: 'create', out: [] });
  });
  it('by invitation: JOIN <word> creates the account only with a valid sign-up invitation', () => {
    expect(greet({ text: 'JOIN spring26', signup: 'invite', inviteValid: true, inviteKind: 'signup' })).toEqual({ action: 'create', out: [], invite: 'spring26' });
    expect(greet({ text: 'JOIN', signup: 'invite', inviteValid: null }).out[0]!.body).toMatch(/^Betaharah: a mikvah calendar by text\. By invitation: JOIN and the invitation word\./);
    expect(greet({ text: 'JOIN wrong', signup: 'invite', inviteValid: false }).out[0]!.body).toMatch(/not valid, or it expired\. Nothing was set up\./);
  });
  it('open, with a word that is not valid: not created (a mistyped code must not make a second account)', () => {
    expect(greet({ text: 'JOIN WRONGCODE', signup: 'open', inviteValid: false }).action).toBe('reply');
  });
  it('closed: nothing is sent, whatever is typed', () => {
    for (const t of ['Hi', 'JOIN', 'JOIN word']) expect(greet({ text: t, signup: 'closed', inviteValid: false }).out).toEqual([]);
  });
  it('an invitation from an account adds the phone in every sign-up mode', () => {
    for (const signup of ['open', 'invite', 'closed'] as const) {
      expect(greet({ text: 'JOIN NRMAAABZ', signup, inviteValid: true, inviteKind: 'phone' })).toEqual({ action: 'join', out: [], invite: 'NRMAAABZ' });
    }
  });
  it('joinWord reads only "JOIN <one word>"', () => {
    expect(joinWord('JOIN abc')).toBe('abc');
    expect(joinWord(' join NRMAAABZ. ')).toBe('NRMAAABZ');
    for (const t of ['JOIN', 'JOIN a b', 'please JOIN abc', 'JOINabc']) expect(joinWord(t), t).toBeNull();
  });
});

describe('begin', () => {
  it('setup: asks for the ZIP code first, with SKIP', () => {
    const data = newHousehold();
    data.phones.push(phone(ME));
    const out = begin({ data, from: ME, now: NOW }, 'setup');
    expect(bodies(out)).toBe('Welcome to Betaharah. Setup step 1 of 3: your ZIP code (or Canadian postal code), for the times of sunset.');
    expect(labels(out)).toEqual(['SKIP']);
    expect(out.chat).toMatchObject({ v: 2, key: 'setup.start', expect: 'zip', ctx: { setup: true } });
  });
  it('joined: names the other phones and says reminders are off', () => {
    const data = household({ spouse: true });
    const out = begin({ data, from: SPOUSE, now: NOW }, 'joined');
    expect(bodies(out)).toBe('This phone is now on the account with the phone ending 0101. Its reminders are off.');
    expect(labels(out)).toEqual(MAIN);
  });
});

describe('the setup conversation', () => {
  function started(place = false): Phone {
    const data = household({ place });
    const p = new Phone(data);
    p.chat = begin({ data, from: ME, now: NOW }, 'setup').chat;
    return p;
  }
  it('a ZIP that is not found asks again with SKIP; a Canadian postal code works; the name is made GSM-7', () => {
    const p = started();
    expect(p.say('99999')).toBe('No place was found for 99999. Places outside the US and Canada are set on the website.');
    expect(p.options()).toEqual(['SKIP', 'WEB LINK', 'MENU']);
    expect(p.say('h3w 1a1')).toBe('Location set: Cote-Saint-Luc, QC H3W. Step 2 of 3: customs. Until they are chosen, the stricter option of each is used.');
    expect(p.options()).toEqual(['KEEP FOR NOW', 'ANSWER BY TEXT', 'LATER']);
  });
  it('SKIP leaves the location for later and goes to the customs', () => {
    const p = started();
    expect(p.say('skip')).toBe('Step 2 of 3: customs. Until they are chosen, the stricter option of each is used.');
    expect(p.data.app.place).toBeNull();
  });
  it('RCS: a shared location answers the ZIP question', () => {
    const p = started();
    const l = PLACES['60645']!;
    expect(p.send('', { location: { latitude: l.latitude, longitude: l.longitude } }).out[0]!.body).toMatch(/^Location set: Chicago, IL 60645\. Step 2 of 3/);
  });
  it('KEEP FOR NOW and LATER go to step 3; ANSWER BY TEXT goes through the 12 customs first', () => {
    for (const choice of ['KEEP FOR NOW', 'later']) {
      const p = started();
      p.send('08701');
      expect(p.say(choice)).toBe('Step 3 of 3: when did the last period begin? For example: Nov 22 night.');
      expect(p.options()).toEqual(['SKIP']);
    }
    const p = started();
    p.send('08701');
    expect(p.say('answer by text')).toMatch(/^Custom 1 of 12: Days before the hefsek/);
  });
  it('step 3: a date records, then the hefsek date, then setup is done; NOT YET finishes too', () => {
    const p = started();
    p.send('08701');
    p.send('KEEP FOR NOW');
    expect(p.say('Nov 1 night')).toBe('Recorded: flow Sun night, Nov 1, 2026. Hefsek from Fri, Nov 6. Hefsek done? Its date, for example: Nov 27.');
    expect(p.options()).toEqual(['NOT YET']);
    expect(p.say('Nov 6')).toMatch(/^Recorded: hefsek Fri, Nov 6, 2026\. Clean days from Shabbat, Nov 7\. Mikvah Fri night, Nov 13 after \d:\d\d PM\. Setup is done\. Reminders are off for now\.$/);
    expect(p.options()).toEqual(['PERIOD', 'HEFSEK', 'REMINDERS', 'MORE']);
    const q = started();
    q.send('08701');
    q.send('LATER');
    q.send('Nov 1 night');
    expect(q.say('NOT YET')).toBe('Setup is done. Reminders are off for now.');
  });
  it('step 3: a refused date says why and asks the step again', () => {
    const p = started();
    p.send('08701');
    p.send('LATER');
    expect(p.say('Nov 1')).toBe('The date needs day, night or a time, e.g. Nov 22 night. Nothing was changed.');
    expect(p.say('12/30/2026 night')).toBe('Not recorded: that time has not come yet. Step 3 of 3: when did the last period begin? For example: Nov 22 night.');
    expect(p.options()).toEqual(['SKIP']);
  });
  it('SKIP finishes; SETUP starts again and offers to keep the location', () => {
    const p = started();
    p.send('08701');
    p.send('KEEP FOR NOW');
    expect(p.say('SKIP')).toBe('Setup is done. Reminders are off for now.');
    expect(p.say('setup')).toBe('Setup step 1 of 3: the location is Lakewood, NJ 08701. A new ZIP code changes it.');
    expect(p.options()).toEqual(['KEEP']);
    expect(p.say('keep')).toMatch(/^Step 2 of 3: customs/);
  });
});

describe('reading a reply', () => {
  it('an option is chosen by its label, in any case, with punctuation, or tapped', () => {
    for (const t of ['STATUS', 'status', ' Status. ', 'status!']) {
      const p = new Phone(household());
      p.send('menu');
      expect(p.say(t), t).toBe('Tehorah.');
    }
  });
  it('an option is chosen by one of its own words', () => {
    const p = new Phone(household());
    p.send('period');
    expect(p.options()).toEqual(['NOW', 'LAST NIGHT', 'ANOTHER DAY']);
    expect(p.say('another one')).toBe('Which date, and day or night? For example: Nov 22 night.');
  });
  it('two options matching is not understood, and changes nothing', () => {
    const data = household();
    const p = new Phone(data);
    p.send('reminders');
    p.send('kinds');
    expect(p.say('am or pm bedikah')).toBe('Not understood; nothing was changed.');
    expect(p.options()).toEqual(MAIN);
    expect(data.phones[0]!.reminders).toEqual(REMINDER_KINDS);
    expect(matchOption('yes no', [['yes', 'YES'], ['no', 'NO']])).toBe('ambiguous');
  });
  it('a digit alone is answered like any reply that was not understood; no text mentions a digit command', () => {
    for (const d of ['1', '2', '9', '0', '5.']) {
      const data = household();
      const p = new Phone(data);
      expect(p.say(d), d).toBe('Not understood; nothing was changed.');
      expect(p.options()).toEqual(MAIN);
      expect(data.entries).toEqual([]);
    }
  });
  it('? is a word for the main options', () => {
    const p = new Phone(household());
    expect(p.say('?')).toBe('Betaharah.');
    expect(p.options()).toEqual(MAIN);
  });
  it('the general words work at any time, with or without options waiting', () => {
    const p = new Phone(household());
    p.send('calendar');
    expect(p.say('where am I')).toBe('Tehorah.');
    expect(p.say('I started bleeding')).toBe('When did it begin?');
  });
  it('options last 24 hours; a YES-or-NO question about something that cannot be undone only 30 minutes', () => {
    expect(CHAT_TTL_MS).toBe(24 * 3_600_000);
    const data = household();
    const p = new Phone(data);
    // a confirmation answered within the half hour
    p.send('delete account');
    p.wait(29);
    expect(p.say('no')).toBe('Nothing was changed.');
    // after it, YES deletes nothing
    p.send('delete account');
    p.wait(31);
    const late = p.send('YES');
    expect(bodies(late)).toBe('Not understood; nothing was changed.');
    expect(late.effects).toEqual([]);
    expect(data.entries.length).toBeGreaterThanOrEqual(0);
    // ordinary options stay for a day, and not longer
    p.send('period');
    p.wait(23 * 60);
    expect(bodies(p.send('another day'))).not.toBe('Not understood; nothing was changed.');
    p.send('period');
    p.wait(24 * 60 + 1);
    expect(bodies(p.send('another day'))).toBe('Not understood; nothing was changed.');
  });
  it('a malformed or older stored state counts as none', () => {
    expect(validChat({ v: 1, at: NOW, setup: false, q: { kind: 'zip' } })).toBeNull();
    expect(validChat({ v: 2, at: NOW, key: 'no.such', opts: [], ctx: {} })).toBeNull();
    expect(validChat({ v: 2, at: NOW, key: 'menu.main', opts: [['x', 'A VERY LONG LABEL OF MANY WORDS']], ctx: {} })).toBeNull();
    expect(validChat({ v: 2, at: NOW, key: 'menu.main', opts: optionsOf(NO_TEXTS, 'menu.main'), ctx: { action: { type: 'boom' } } })).toBeNull();
    expect(validChat({ v: 2, at: NOW, key: 'menu.main', opts: optionsOf(NO_TEXTS, 'menu.main'), ctx: {} })).not.toBeNull();
  });
  it('a reply naming another action leaves the options for it', () => {
    const p = new Phone(household());
    p.send('history');
    expect(p.say('status')).toBe('Tehorah.');
    const general = matchGeneral('my period started', { period: ['period', 'started'], hefsek: ['hefsek'] });
    expect(general).toEqual({ id: 'period', rest: ['my'] });
  });
});

describe('recording', () => {
  it('PERIOD asks when, with the options that fit the hour', () => {
    const day = new Phone(household(), at(2026, 11, 24, 12));
    day.send('period');
    expect(day.options()).toEqual(['NOW', 'LAST NIGHT', 'ANOTHER DAY']);
    const night = new Phone(household(), at(2026, 11, 24, 21));
    night.send('period');
    expect(night.options()).toEqual(['NOW', 'TODAY BY DAY', 'ANOTHER DAY']);
  });
  it('NOW, LAST NIGHT and TODAY BY DAY record, each confirmed with UNDO and STATUS', () => {
    const p = new Phone(household(), at(2026, 11, 24, 12));
    p.send('period');
    expect(p.say('NOW')).toBe('Recorded: flow today by day. Hefsek from Shabbat.');
    expect(p.options()).toEqual(['UNDO', 'STATUS']);
    p.send('UNDO');
    p.send('period');
    expect(p.say('last night')).toBe('Recorded: flow last night. Hefsek from Shabbat.');
    const n = new Phone(household(), at(2026, 11, 24, 21));
    n.send('flow');
    expect(n.say('today by day')).toBe('Recorded: flow today by day. Hefsek from Shabbat.');
  });
  it('written words record too: "period yesterday night", "period now", "flow at 9pm", "stain day"', () => {
    const p = new Phone(household(), at(2026, 11, 24, 12));
    expect(p.say('period yesterday night')).toBe('Recorded: flow last night. Hefsek from Shabbat.');
    p.say('undo');
    expect(p.say('my period started now')).toBe('Recorded: flow today by day. Hefsek from Shabbat.');
    p.say('undo');
    expect(p.say('flow at 9pm')).toMatch(/^Recorded: flow last night\./);
    p.say('undo');
    expect(p.say('stain day')).toBe('Recorded: stain today by day. Hefsek from Shabbat.');
  });
  it('words that do not say when ask "when?" and record nothing', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('period tomorrow')).toBe('When did it begin?');
    expect(data.entries).toEqual([]);
  });
  it('HEFSEK offers TODAY, YESTERDAY, ANOTHER DAY', () => {
    const p = new Phone(household(), at(2026, 11, 28, 15));
    p.send('period 11/22 night');
    p.wait(1);
    expect(p.say('hefsek')).toBe('Hefsek tahara: which day?');
    expect(p.options()).toEqual(['TODAY', 'YESTERDAY', 'ANOTHER DAY']);
    expect(p.say('today')).toMatch(/^Recorded: hefsek today\. Clean days from tomorrow\. Mikvah Sat night, Dec 5 after \d:\d\d PM\.$/);
    p.send('undo');
    expect(p.say('hefsek yesterday')).toMatch(/^Recorded: hefsek yesterday\. Clean days from today\. Mikvah Fri night after/);
  });
  it('the immersion is under MORE, OTHER ENTRIES; nothing prompts for it', () => {
    const p = new Phone(household(), at(2026, 12, 5, 10));
    p.send('period 11/22 night');
    p.send('hefsek 11/27');
    expect(p.say('more')).toBe('More:');
    expect(p.options()).toEqual(['OTHER ENTRIES', 'HISTORY', 'UNDO', 'SETTINGS', 'ACCOUNT']);
    expect(p.say('other entries')).toBe('Record:');
    expect(p.options()).toEqual(['STAIN', 'COUNT BROKEN', 'IMMERSION']);
    expect(p.say('immersion')).toBe('Immersion: which night?');
    expect(p.options()).toEqual(['LAST NIGHT', 'ANOTHER DAY']);
    expect(p.say('last night')).toBe('Recorded: mikvah last night.');
  });
  it('COUNT BROKEN and the refusals', () => {
    const p = new Phone(household(), at(2026, 11, 24, 12));
    p.send('more');
    p.send('other entries');
    p.send('count broken');
    expect(p.say('now')).toBe('Not recorded: there is no count in progress.');
    expect(p.options()).toEqual(MAIN);
    expect(p.say('hefsek today')).toBe('Not recorded: no period is open.');
    expect(p.say('period now')).toMatch(/^Recorded/);
    expect(p.say('period now')).toBe('Already recorded.');
  });
  it('UNDO removes the latest entry of the last 48 hours and gives the status', () => {
    const p = new Phone(household(), at(2026, 11, 24, 12));
    expect(p.say('undo')).toBe('Nothing recent to undo.');
    expect(p.options()).toEqual(['HISTORY', 'MENU']);
    p.send('period now');
    expect(p.say('UNDO')).toBe('Removed: flow today by day. Tehorah.');
  });
});

describe('status', () => {
  it('in each phase', () => {
    const p = new Phone(household(), at(2026, 11, 24, 12));
    expect(p.say('status')).toBe('Tehorah.');
    expect(p.options()).toEqual(['PERIOD', 'HEFSEK', 'HISTORY', 'MORE']);
    p.send('period 11/22 night');
    expect(p.say('status')).toMatch(/^Niddah since Sun night, Nov 22\. Hefsek from Fri before \d:\d\d PM\.$/);
    p.now = at(2026, 11, 28, 12);
    expect(p.say('status')).toMatch(/^Niddah since Sun night, Nov 22\. Hefsek can be done today before \d:\d\d PM\.$/);
    p.send('hefsek today');
    expect(p.say('status')).toMatch(/^Clean days begin tomorrow\. Mikvah Sat night, Dec 5 after \d:\d\d PM\.$/);
    p.now = at(2026, 12, 1, 12);
    expect(p.say('where')).toMatch(/^Clean day 3 of 7\. Mikvah Sat night after \d:\d\d PM\.$/);
    p.now = at(2026, 12, 5, 19);
    expect(p.say('status')).toMatch(/^(Mikvah tonight after \d:\d\d PM\.|Count complete; no immersion tonight\. Mikvah .*)$/);
    p.now = at(2026, 12, 7, 12);
    expect(p.say('status')).toMatch(/^Tehorah\. Next onah: \d+:\d\d [AP]M \w{3}( night)?, \w{3} \d+\.$/);
  });
  it('without a location', () => {
    const p = new Phone(household({ place: false }));
    expect(p.say('status')).toBe('No location is set yet.');
    expect(p.options()).toEqual(['LOCATION', 'MENU']);
  });
});

describe('history', () => {
  it('lists the latest five by ordinal options; an erase needs YES', () => {
    const data = household();
    const p = new Phone(data, at(2026, 11, 24, 12));
    p.send('period 11/1 day');
    p.send('hefsek 11/6');
    expect(p.say('history')).toBe('Latest: first: hefsek Fri, Nov 6; second: flow Sun, Nov 1 by day. Erase one?');
    expect(p.options()).toEqual(['FIRST', 'SECOND', 'MENU']);
    expect(p.say('second')).toBe('Erase flow Sun, Nov 1 by day?');
    expect(p.options()).toEqual(['YES', 'NO']);
    expect(p.say('no')).toBe('Nothing was changed.');
    expect(data.entries).toHaveLength(2);
    p.send('history');
    p.send('first');
    expect(p.say('yes')).toMatch(/^Erased: hefsek Fri, Nov 6\. Niddah since Sun, Nov 1\./);
    expect(data.entries).toHaveLength(1);
  });
  it('none yet; the year shown when not this year', () => {
    const p = new Phone(household());
    expect(p.say('history')).toBe('No entries yet.');
    p.send('period 12/20/2025 day');
    expect(p.say('history')).toBe('Latest: first: flow Shabbat, Dec 20, 2025 by day. Erase one?');
  });
});

describe('settings by text', () => {
  it('LOCATION with and without a ZIP code; a bare ZIP outside a question is not taken', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('11219')).toBe('Not understood; nothing was changed.');
    expect(p.say('location')).toBe('Location: Lakewood, NJ 08701. A new ZIP code changes it.');
    expect(p.say('11219')).toBe('Location set: Brooklyn, NY 11219.');
    expect(p.say('zip 08701')).toBe('Location set: Lakewood, NJ 08701.');
    expect(p.say('location here')).toBe('Not understood: a ZIP code has 5 digits, a Canadian postal code is like H3W 1A1. Nothing was changed.');
  });
  it('RCS: a location shared with no question needs YES', () => {
    const data = household();
    const p = new Phone(data);
    const l = PLACES['60645']!;
    p.send('', { location: { latitude: l.latitude, longitude: l.longitude } });
    expect(bodies(p.last!)).toBe('Set the location to Chicago, IL 60645? Now: Lakewood, NJ 08701.');
    expect(p.say('yes')).toBe('Location set: Chicago, IL 60645.');
    expect(data.app.place!.name).toBe('Chicago, IL 60645');
  });
  it('REMINDERS: TURN ON carries the consent wording and sets consent; TURN OFF clears it', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('reminders')).toBe('Reminders for this phone are off. Kinds on: 6 of 6. Wording: plain.');
    expect(p.options()).toEqual(['TURN ON', 'KINDS', 'WORDING']);
    expect(p.say('turn on')).toBe(
      'Reminders are on for this phone (ending 0101). This phone agrees to receive reminder texts from Betaharah. Msg frequency varies. Msg&data rates may apply. Reply STOP to stop, HELP for help.',
    );
    expect(data.phones[0]!.consentAt).toBe(NOW);
    expect(p.say('reminders on')).toBe('Reminders are already on for this phone.');
    expect(p.say('reminders off')).toBe('Changed: reminders are off for this phone. Replies still come.');
    expect(data.phones[0]!.consentAt).toBeNull();
    data.phones[0]!.optedOut = true;
    expect(p.say('reminders on')).toBe('This phone replied STOP, so no texts are sent to it. START turns texts back on.');
  });
  it('KINDS: each option turns one kind on or off', () => {
    const data = household();
    const p = new Phone(data);
    p.send('kinds');
    expect(p.options()).toEqual(['TAHARA', 'AM BEDIKAH', 'PM BEDIKAH', 'MIKVAH NIGHT', 'BOOKING', 'ONAH']);
    expect(p.say('onah')).toBe('Changed. On: tahara, am bedikah, pm bedikah, mikvah night, booking. Off: onah.');
    expect(p.say('am')).toBe('Changed. On: tahara, pm bedikah, mikvah night, booking. Off: am bedikah, onah.');
    expect(p.say('ONAH')).toBe('Changed. On: tahara, pm bedikah, mikvah night, booking, onah. Off: am bedikah.');
    expect(data.phones[0]!.reminders).toEqual(['hefsek', 'bedikah_afternoon', 'mikvah', 'mikvah_book', 'onah']);
  });
  it('WORDING: plain or discreet, for the household', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('wording')).toBe('Reminder wording: plain, for every phone. Discreet uses letters, such as H for hefsek.');
    expect(p.say('discreet')).toBe('Changed: reminder wording is discreet for every phone.');
    expect(data.app.reminders.style).toBe('discreet');
    expect(p.say('wording discreet')).toBe('Reminder wording is already discreet. Nothing was changed.');
  });
  it('CALENDAR: create, show, replace (YES), remove (YES)', () => {
    const data = household();
    const p = new Phone(data);
    p.random = makeRandom();
    expect(p.say('calendar')).toBe('No calendar link yet. A link shows the calendar in any calendar app.');
    expect(p.say('create link')).toBe('Calendar link: https://betaharah.com/cal/Tok0001_abcdefghijklmnopqrstuvw.ics Anyone who has it can read the calendar.');
    expect(p.say('calendar')).toBe('The calendar link is on.');
    expect(p.options()).toEqual(['SHOW LINK', 'NEW LINK', 'REMOVE LINK', 'MENU']);
    expect(p.say('new link')).toBe('Replace the calendar link? The old link stops working.');
    expect(p.say('yes')).toBe('New calendar link: https://betaharah.com/cal/Tok0002_abcdefghijklmnopqrstuvw.ics The old link no longer works.');
    p.send('calendar');
    p.send('remove link');
    expect(p.say('yes')).toBe('The calendar link is removed.');
    expect(data.calendarLinkToken).toBeNull();
    expect(p.say('calendar off')).toBe('There is no calendar link. Nothing was changed.');
  });
  it('TERMS: HEBREW or ENGLISH', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('terms')).toBe('Halachic terms in the calendar and on the website: English letters. Texts are in English letters.');
    expect(p.say('hebrew')).toBe('Changed: terms in the calendar and on the website are in Hebrew.');
    expect(data.app.terms).toBe('he');
    expect(p.say('terms hebrew')).toBe('The terms are already in Hebrew. Nothing was changed.');
  });
  it('WEB LINK: the server texts the link; nothing else is sent', () => {
    const p = new Phone(household());
    p.send('more');
    p.send('account');
    const out = p.send('web link');
    expect(out.out).toEqual([]);
    expect(out.effects).toEqual([
      expect.objectContaining({ type: 'web_link', number: ME, text: 'Betaharah sign-in link for this phone. It works once, within 10 minutes: @@LINK@@\nReply: MENU' }),
    ]);
  });
  it('website-only things answer with one line', () => {
    for (const t of ['password', 'download my data', 'google', 'times']) expect(new Phone(household()).say(t), t).toMatch(/^Passwords, data downloads, Google Calendar and reminder times are on the website/);
  });
});

describe('phones and the account', () => {
  it('PHONES lists them; REMOVE needs YES and leaves the removal to the server', () => {
    const data = household({ spouse: true });
    const p = new Phone(data);
    expect(p.say('phones')).toBe('Phones: first ending 0101 (this phone, reminders off); second ending 0102 (reminders off).');
    expect(p.options()).toEqual(['ADD', 'REMOVE', 'LEAVE', 'MENU']);
    expect(p.say('remove')).toBe('Remove which phone? second ending 0102.');
    expect(p.options()).toEqual(['SECOND', 'MENU']);
    expect(p.say('second')).toBe('Remove the phone ending 0102? It will no longer see the calendar or get reminders.');
    const out = p.send('yes');
    expect(bodies(out)).toBe('Removed the phone ending 0102.');
    expect(out.effects).toEqual([expect.objectContaining({ type: 'remove_phone', number: SPOUSE })]);
  });
  it('ADD gives a code to pass on and texts nobody else; a number already on it, or a full account, changes nothing', () => {
    const data = household({ spouse: true });
    const p = new Phone(data);
    p.random = makeRandom();
    const out = p.send('add');
    const effect = out.effects[0]!;
    expect(effect.type).toBe('join_code');
    if (effect.type !== 'join_code') return;
    expect(bodies(out)).toBe(`Have that phone text JOIN ${effect.code} to this number within 7 days. The code works once.`);
    expect(p.say('add (732) 555-0102')).toBe('The number ending 0102 is already on this account. Nothing was changed.');
    expect(p.say('add me please')).toBe('Not understood: ADD alone gives a code for the other phone. Nothing was changed.');
    data.phones.push(phone('+17325550103'), phone('+17325550104'));
    expect(p.say('add')).toBe('This account already has 4 phones, the most allowed. Nothing was changed.');
  });
  it('JOIN from a phone on an account', () => {
    const p = new Phone(household());
    expect(p.say('join')).toBe('This phone is already signed up.');
    expect(p.say('JOIN NRMAAABZ')).toBe('This phone is already on an account, so nothing was changed.');
  });
  it('LEAVE needs YES, and the last phone cannot leave', () => {
    expect(new Phone(household()).say('leave')).toBe('This is the only phone on the account, so it cannot leave it. Nothing was changed.');
    const p = new Phone(household({ spouse: true }));
    expect(p.say('leave')).toBe('Take this phone off the account? It will get no more reminders and cannot see the calendar.');
    const out = p.send('YES');
    expect(bodies(out)).toBe('This phone is off the account.');
    expect(out.effects).toEqual([expect.objectContaining({ type: 'leave', number: ME })]);
  });
  it('DELETE ACCOUNT needs YES', () => {
    const p = new Phone(household());
    expect(p.say('delete account')).toBe('Delete the account? All dates, settings and phones are erased. This cannot be undone.');
    expect(p.options()).toEqual(['YES', 'NO']);
    expect(p.say('no')).toBe('Nothing was changed.');
    p.send('delete account');
    const out = p.send('yes');
    expect(bodies(out)).toBe('The account is deleted.');
    expect(out.effects).toEqual([expect.objectContaining({ type: 'delete_account' })]);
  });
});

describe("the operator's wording", () => {
  it('a changed body and label are used in the next text, and the changed label is matched', () => {
    const texts = parseSiteTexts({ messages: { 'menu.main': { body: 'Hello from Betaharah.', labels: { status: 'WHERE AM I' } } }, prefix: 'Choose:' });
    const p = new Phone(household());
    p.texts = texts;
    const out = p.send('menu');
    expect(out.out[0]!.text).toBe('Hello from Betaharah.\nChoose: PERIOD, HEFSEK, WHERE AM I, MORE');
    expect(p.say('where am i')).toBe('Tehorah.');
  });
  it('changed general words are read', () => {
    const p = new Phone(household());
    p.texts = parseSiteTexts({ words: { status: ['status', 'situation'] } });
    expect(p.say('situation')).toBe('Tehorah.');
    expect(p.say('where')).toBe('Not understood; nothing was changed.');
  });
});

describe('small parts', () => {
  it('postal codes', () => {
    expect(postalOf('08701')).toBe('08701');
    expect(postalOf('08701-1234')).toBe('08701');
    expect(postalOf('h3w 1a1')).toBe('H3W 1A1');
    expect(postalOf('H3W')).toBe('H3W');
    for (const t of ['0870', '123456', 'ABC', '']) expect(postalOf(t), t).toBeNull();
  });
  it('codes for adding a phone come only from the injected source', () => {
    expect(inviteCode(() => 'aaaaaaaa')).toMatch(/^[A-HJ-NP-Z]{8}$/);
    expect(inviteCode(makeRandom())).toBe(inviteCode(makeRandom()));
  });
  it('no repair of an outgoing text was ever needed', () => expect(repairs).toEqual({ folded: 0, shortened: 0 }));
  it('a phone not on the household gets nothing', () => {
    const out = converse({ data: household(), chat: null as ChatState | null, from: '+19999999999', text: 'status', now: NOW, limits: { maxPhones: 4 }, lookupPostal, nearestPostal, random: makeRandom() });
    expect(out.out).toEqual([]);
  });
});
