import { describe, expect, it } from 'vitest';
import { begin, CHAT_TTL_MS, converse, greet, joinWord, type ChatState, type ConverseOutput, type Question } from '../src/app/chat';
import { inviteCode, pack, postalOf, validChat } from '../src/app/chat/engine';
import { isGsmBasic, MAX_TEXT_CHARS, repairs, SEGMENT_CHARS } from '../src/app/chat/gsm';
import * as T from '../src/app/chat/texts';
import { runCommand } from '../src/app/household';
import { newHousehold } from '../src/app/model';
import { REMINDER_KINDS } from '../src/app/settings';
import { household, lookupPostal, makeRandom, ME, nearestPostal, NOW, phone, Phone, PLACES, SPOUSE, texts } from './chat-fixtures';

function checkOut(out: ConverseOutput): void {
  expect(out.out.length).toBeLessThanOrEqual(2);
  for (const m of out.out) {
    expect(isGsmBasic(m.text), m.text).toBe(true);
    expect(m.text.length, m.text).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    expect(m.text.length).toBeGreaterThan(0);
    if (m.suggestions) {
      expect(m.suggestions.length).toBeGreaterThan(0);
      expect(m.suggestions.length).toBeLessThanOrEqual(4);
      for (const s of m.suggestions) {
        expect(s.label.length, s.label).toBeLessThanOrEqual(20);
        expect(isGsmBasic(s.label + s.send)).toBe(true);
      }
    }
  }
}

describe('the fixed texts', () => {
  const all = Object.entries(T).filter(([, v]) => typeof v === 'string') as Array<[string, string]>;
  it('are GSM-7 and fit two segments', () => {
    for (const [name, text] of all) {
      expect(isGsmBasic(text), name).toBe(true);
      expect(text.length, name).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    }
  });
  it('the welcome and setup texts each fit one segment where they can', () => {
    for (const name of ['SETUP_START', 'ASK_ZIP', 'RECENT_NEXT', 'NOTHING_PENDING', 'UNKNOWN', 'ALREADY_JOINED', 'REMINDERS_OFF', 'CALENDAR_OFF', 'WEBSITE_PASSWORD', 'WEBSITE_DATA']) {
      expect((T as unknown as Record<string, string>)[name]!.length, name).toBeLessThanOrEqual(SEGMENT_CHARS);
    }
  });
  it('carry no exclamation marks, and no emoji', () => {
    for (const [name, text] of all) expect(text, name).not.toMatch(/!/);
  });
  it('the sign-up texts carry the compliance wording', () => {
    for (const text of [T.WELCOME_OPEN]) {
      expect(text).toMatch(/Reply JOIN/);
      expect(text).toMatch(/Msg frequency varies/);
      expect(text).toMatch(/Msg&data rates may apply/);
      expect(text).toMatch(/Reply STOP to stop/);
      expect(text).toMatch(/HELP for help/);
      expect(text).toMatch(/betaharah\.com\/terms/);
    }
    expect(T.remindersOn('0101')).toMatch(/agrees to receive reminder texts.*Msg frequency varies\. Msg&data rates may apply\. Reply STOP to stop/);
  });
});

describe('carrier keywords', () => {
  // service.ts: the opt-out, opt-in and help words handled before this engine.
  const CARRIER = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT', 'OPT', 'START', 'UNSTOP', 'HELP', 'INFO'];
  it('none is a command word or an answer word', () => {
    const words = new Set<string>();
    for (const text of [T.MENU, T.CUSTOMS_LIST, T.CALENDAR_HAS, T.CALENDAR_NONE]) for (const w of text.match(/\b[A-Z]{2,}\b/g) ?? []) words.add(w);
    for (const w of ['YES', 'NO', 'KEEP', 'SKIP', 'DONE', 'ALL', 'NONE', 'JOIN', 'ERASE', 'REMOVE', 'ADD', 'LEAVE', 'KINDS', 'WORDING', 'PAUSE', 'RESUME', 'ZIP']) words.add(w);
    for (const c of CARRIER) expect(words.has(c), c).toBe(false);
  });
  it('the engine does not act on them if they ever arrive', () => {
    for (const w of CARRIER) {
      const data = household();
      const before = JSON.stringify(data);
      const out = new Phone(data).send(w);
      expect(out.changed).toBe(false);
      expect(out.effects).toEqual([]);
      expect(JSON.stringify(data)).toBe(before);
    }
  });
});

describe('signing up: greet', () => {
  it('open: any text gets one welcome; JOIN creates the account', () => {
    for (const text of ['hi', 'Hello?', '', 'what is this', '1', '9', 'YES']) {
      const g = greet({ text, signup: 'open', inviteValid: null });
      expect(g.action).toBe('reply');
      expect(g.out).toEqual([{ text: T.WELCOME_OPEN, suggestions: [{ label: 'Join', send: 'JOIN' }] }]);
    }
    for (const text of ['JOIN', 'join', ' Join. ', 'JOIN!']) expect(greet({ text, signup: 'open', inviteValid: null })).toEqual({ action: 'create', out: [] });
  });
  it('by invitation: JOIN <word> creates the account only with a valid sign-up invitation', () => {
    expect(greet({ text: 'JOIN Ab3-x', signup: 'invite', inviteValid: true, inviteKind: 'signup' })).toEqual({ action: 'create', out: [], invite: 'Ab3-x' });
    expect(greet({ text: 'JOIN nope', signup: 'invite', inviteValid: false })).toEqual({ action: 'reply', out: [{ text: T.BAD_INVITATION }], invite: 'nope' });
    expect(greet({ text: 'JOIN', signup: 'invite', inviteValid: null }).out[0]!.text).toBe(T.WELCOME_INVITE);
    expect(greet({ text: 'hello', signup: 'invite', inviteValid: null }).out[0]!.text).toBe(T.WELCOME_INVITE);
  });
  it('open, with a word that is not valid: not created (a mistyped code must not make a second account)', () => {
    expect(greet({ text: 'JOIN XYZ', signup: 'open', inviteValid: false }).action).toBe('reply');
  });
  it('closed: nothing is sent, whatever is typed', () => {
    for (const text of ['hi', 'JOIN', 'JOIN abc']) expect(greet({ text, signup: 'closed', inviteValid: text === 'JOIN abc' ? true : null, inviteKind: 'signup' })).toMatchObject({ action: 'ignore', out: [] });
  });
  it('an invitation from an account adds the phone in every sign-up mode', () => {
    for (const signup of ['open', 'invite', 'closed'] as const) {
      expect(greet({ text: 'JOIN QWERTYUP', signup, inviteValid: true, inviteKind: 'phone' })).toEqual({ action: 'join', out: [], invite: 'QWERTYUP' });
    }
  });
  it('joinWord reads only "JOIN <one word>"', () => {
    expect(joinWord('JOIN abc')).toBe('abc');
    expect(joinWord(' join  QWERTYUP. ')).toBe('QWERTYUP');
    for (const t of ['JOIN', 'JOIN a b', 'JOINabc', 'please JOIN abc', 'JOIN a!b', '']) expect(joinWord(t), t).toBeNull();
  });
});

describe('begin', () => {
  it('setup: asks for the ZIP code first', () => {
    const data = newHousehold();
    data.phones.push(phone(ME));
    const out = begin({ data, from: ME, now: NOW }, 'setup');
    expect(texts(out)).toBe(T.SETUP_START);
    expect(out.chat).toEqual({ v: 1, at: NOW, setup: true, q: { kind: 'zip' } });
    expect(out.changed).toBe(false);
  });
  it('joined: names the other phones and says reminders are off', () => {
    const data = household({ spouse: true });
    const out = begin({ data, from: SPOUSE, now: NOW }, 'joined');
    expect(texts(out)).toBe('This phone is now on the account with the phone ending 0101. Text 9 for status, MENU for everything. Reminders are off for this phone until you text REMINDERS ON.');
    expect(out.chat).toBeNull();
  });
});

describe('the setup conversation', () => {
  it('a ZIP that is not found asks again; a Canadian postal code works; the name is made GSM-7', () => {
    const data = newHousehold();
    data.phones.push(phone(ME));
    const p = new Phone(data);
    p.chat = begin({ data, from: ME, now: NOW }, 'setup').chat;
    expect(p.say('99999')).toBe(T.unknownZip('99999'));
    expect(p.chat?.q.kind).toBe('zip');
    expect(p.say('hello')).toBe(T.NOT_A_ZIP);
    expect(p.chat?.q.kind).toBe('zip');
    const out = p.send('h3w 1a1');
    expect(out.out[0]!.text).toBe('Location set: Cote-Saint-Luc, QC H3W. Sunset and nightfall are now worked out for it.');
    expect(data.app.place?.timeZone).toBe('America/Toronto');
    expect(data.app.place?.name).toBe(PLACES.H3W!.name); // stored as found
    expect(out.changed).toBe(true);
    expect(out.chat?.q.kind).toBe('customs_intro');
    checkOut(out);
  });

  it('RCS: a shared location answers the ZIP question', () => {
    const data = newHousehold();
    data.phones.push(phone(ME));
    const p = new Phone(data);
    p.chat = begin({ data, from: ME, now: NOW }, 'setup').chat;
    expect(p.send('', { location: { latitude: 10, longitude: 10 } }).out[0]!.text).toBe(T.NO_PLACE_NEAR);
    expect(data.app.place).toBeNull();
    const out = p.send('', { location: { latitude: 40.08, longitude: -74.2 } });
    expect(out.out[0]!.text).toBe('Location set: Lakewood, NJ 08701. Sunset and nightfall are now worked out for it.');
    expect(out.chat?.q.kind).toBe('customs_intro');
  });

  it('customs A keeps them, C leaves them for the website; both go to step 3', () => {
    for (const [letter, said] of [
      ['A', T.CUSTOMS_KEPT],
      ['C', T.CUSTOMS_LATER],
    ] as const) {
      const data = household();
      const p = new Phone(data);
      p.chat = { v: 1, at: NOW, setup: true, q: { kind: 'customs_intro' } };
      const out = p.send(letter);
      expect(texts(out)).toBe(`${said} ${T.RECENT_ASK}`);
      expect(out.chat?.q).toEqual({ kind: 'recent', recorded: false });
      expect(data.halachicConfirmedAt).toBeNull();
    }
  });

  it('step 3: dated commands record, the hint follows, DONE finishes', () => {
    const data = household();
    const p = new Phone(data);
    p.chat = { v: 1, at: NOW, setup: true, q: { kind: 'recent', recorded: false } };
    expect(p.say('2 11/20')).toBe(`Not recorded: no period is open. Send 1 or 5 first. (Read as Fri Nov 20, 2026.) The question before is still open: send 1 with a date, or SKIP.`);
    expect(p.say('1 11/22 night')).toBe(`Recorded: flow Sun Nov 22 night, 2026. Hefsek from Fri Nov 27. 0 to undo. ${T.RECENT_NEXT}`);
    expect(p.chat?.q).toEqual({ kind: 'recent', recorded: true });
    expect(p.say('DONE')).toBe(T.SETUP_DONE);
    expect(p.chat).toBeNull();
  });

  it('SKIP finishes; SETUP starts again and offers to keep the location', () => {
    const p = new Phone(household());
    p.chat = { v: 1, at: NOW, setup: true, q: { kind: 'recent', recorded: false } };
    expect(p.say('SKIP')).toBe(T.SETUP_DONE);
    expect(p.say('SETUP')).toBe('Setup. Step 1 of 3: your location is Lakewood, NJ 08701. Reply with a new ZIP code, or KEEP to keep it.');
    expect(p.say('KEEP')).toBe(T.CUSTOMS_INTRO);
    expect(p.chat?.q.kind).toBe('customs_intro');
  });
});

describe('a pending question', () => {
  const states: Array<[string, Question, string]> = [
    ['zip', { kind: 'zip' }, '08701'],
    ['customs_intro', { kind: 'customs_intro' }, 'A'],
    ['custom', { kind: 'custom', index: 4, walk: true }, 'B'],
    ['customs_list', { kind: 'customs_list' }, 'E'],
    ['recent', { kind: 'recent', recorded: false }, 'SKIP'],
    ['kinds', { kind: 'kinds' }, 'A B'],
    ['confirm', { kind: 'confirm', action: { type: 'calendar_off' } }, 'YES'],
  ];

  for (const [name, q, answerText] of states) {
    it(`${name}: closes after 30 minutes; the late answer then changes nothing`, () => {
      const data = household();
      data.calendarLinkToken = 'tok';
      const p = new Phone(data);
      p.chat = { v: 1, at: NOW, setup: name === 'customs_intro' || name === 'recent', q };
      p.wait(31);
      const before = JSON.stringify(data);
      const out = p.send(answerText);
      expect(JSON.stringify(data), name).toBe(before);
      expect(out.changed).toBe(false);
      expect(out.chat).toBeNull();
      expect(texts(out)).toMatch(/^That question was sent more than 30 minutes ago, so it was closed and nothing was changed\. Send /);
    });

    it(`${name}: still open at 29 minutes`, () => {
      const data = household();
      data.calendarLinkToken = 'tok';
      const p = new Phone(data);
      p.chat = { v: 1, at: NOW, setup: false, q };
      p.wait(29);
      const out = p.send(answerText);
      expect(texts(out)).not.toMatch(/30 minutes ago/);
    });

    it(`${name}: a bare digit records (or reports), never answers, and the question stays open`, () => {
      for (const d of ['1', '2', '3', '4', '5', '9', '0']) {
        const data = household();
        data.calendarLinkToken = 'tok';
        const p = new Phone(data);
        const chat: ChatState = { v: 1, at: NOW, setup: false, q };
        p.chat = chat;
        const settings = JSON.stringify({ h: data.halachic, a: data.app, c: data.calendarLinkToken, ph: data.phones });
        const out = p.send(d);
        checkOut(out);
        expect(JSON.stringify({ h: data.halachic, a: data.app, c: data.calendarLinkToken, ph: data.phones }), `${name} ${d}`).toBe(settings);
        expect(out.effects).toEqual([]);
        if (q.kind === 'confirm') {
          expect(out.chat, `${name} ${d}`).toBeNull(); // a yes-or-no question is closed by anything else
        } else {
          if (q.kind === 'recent') {
            expect(out.chat?.q.kind, `${name} ${d}`).toBe('recent'); // a recorded entry moves on to the hint for 2 and 4
          } else {
            expect(out.chat?.q, `${name} ${d}`).toEqual(q);
            expect(texts(out)).toMatch(/The question before is still open: /);
          }
        }
      }
    });

    it(`${name}: unknown input changes nothing, says so, and keeps the question`, () => {
      for (const junk of ['maybe', 'Z', 'YES NO', 'hello there', '\u{1F600}', 'A1', '?!']) {
        const data = household();
        data.calendarLinkToken = 'tok';
        const p = new Phone(data);
        p.chat = { v: 1, at: NOW, setup: false, q };
        const before = JSON.stringify(data);
        const out = p.send(junk);
        checkOut(out);
        if (junk === '?!') continue; // "?" is the digit help
        expect(JSON.stringify(data), `${name} ${junk}`).toBe(before);
        expect(texts(out), `${name} ${junk}`).toMatch(/^Not understood; nothing was changed\./);
        expect(out.chat?.q, `${name} ${junk}`).toEqual(q);
      }
    });
  }

  it('a digit command in the middle of the customs walk-through records, and the walk-through continues', () => {
    const data = household();
    const p = new Phone(data);
    p.send('CUSTOMS ALL');
    p.send('B'); // custom 1 answered
    const out = p.send('1 night');
    expect(texts(out)).toMatch(/^Recorded: flow .* The question before is still open: reply A, B or C, or KEEP\.$/);
    expect(data.entries).toHaveLength(1);
    expect(out.chat?.q).toEqual({ kind: 'custom', index: 1, walk: true });
    expect(out.out.at(-1)!.suggestions?.map(s => s.send)).toEqual(['A', 'B', 'C', 'KEEP']);
    p.send('A');
    expect(data.halachic.beinonitDays).toBe('30');
    expect(p.chat?.q).toEqual({ kind: 'custom', index: 2, walk: true });
  });

  it('a command word leaves the question (and setup); SETUP starts it again', () => {
    const p = new Phone(household());
    p.chat = { v: 1, at: NOW, setup: true, q: { kind: 'customs_intro' } };
    expect(p.say('MENU')).toBe(T.MENU);
    expect(p.chat).toBeNull();
    expect(p.say('A')).toBe(T.UNKNOWN);
  });

  it('YES or NO with no question waiting', () => {
    const p = new Phone(household());
    for (const w of ['YES', 'NO', 'KEEP', 'SKIP', 'DONE', 'ALL', 'NONE']) expect(p.say(w)).toBe(T.NOTHING_PENDING);
  });

  it('a malformed stored state counts as none', () => {
    for (const bad of [{}, { v: 2, at: NOW, setup: false, q: { kind: 'zip' } }, { v: 1, at: 'x', setup: false, q: { kind: 'zip' } }, { v: 1, at: NOW, setup: false, q: { kind: 'custom', index: 99, walk: true } }, { v: 1, at: NOW, setup: false, q: { kind: 'nope' } }, 'x', 5, null]) {
      expect(validChat(bad)).toBeNull();
    }
    expect(validChat({ v: 1, at: NOW, setup: false, q: { kind: 'zip' } })).not.toBeNull();
  });

  it(`CHAT_TTL_MS is 30 minutes`, () => expect(CHAT_TTL_MS).toBe(30 * 60_000));
});

describe('a letter never records', () => {
  it('in any state, no letter or word changes the entries', () => {
    const qs: Array<Question | null> = [
      null,
      { kind: 'zip' },
      { kind: 'customs_intro' },
      { kind: 'custom', index: 0, walk: true },
      { kind: 'customs_list' },
      { kind: 'recent', recorded: true },
      { kind: 'kinds' },
      { kind: 'history', ids: [] },
      { kind: 'phones', numbers: [ME] },
      { kind: 'confirm', action: { type: 'leave' } },
    ];
    for (const q of qs) {
      for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').flatMap(l => [l, l.toLowerCase()])) {
        const data = household();
        new Phone(data).send('1 11/1 day');
        const entries = JSON.stringify(data.entries);
        const p = new Phone(data);
        p.chat = q ? { v: 1, at: NOW, setup: false, q } : null;
        p.send(letter);
        expect(JSON.stringify(data.entries), `${JSON.stringify(q)} ${letter}`).toBe(entries);
      }
    }
  });
});

describe('the menu and the words', () => {
  it('MENU lists the words in one text, with buttons', () => {
    const out = new Phone(household()).send('menu');
    expect(out.out).toEqual([{ text: T.MENU, suggestions: T.MENU_SUGGEST }]);
  });

  it('STATUS is 9; UNDO is 0', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('STATUS')).toBe(p.say('9'));
    p.say('1 11/22 night');
    expect(p.say('UNDO')).toMatch(/^Removed: flow Sun Nov 22 night\./);
    expect(p.say('UNDO')).toBe('Nothing recent to undo. Older entries can be erased by text: send HISTORY.');
  });

  it('? is the digit help, with the dated forms and MENU', () => {
    expect(new Phone(household()).say('?')).toMatch(/^1 flow began, .* A date also works: 1 11\/22 night, 2 11\/26, 4 12\/3\. MENU lists the words\.$/);
  });

  it('the existing digit commands give exactly their existing replies', () => {
    for (const t of ['1', '1 night', '5 yesterday day', '3', '2', '4', '9', '1 tomorrow', '7']) {
      const a = household();
      const b = household();
      const mine = new Phone(a).say(t);
      const theirs = runCommand(b, t, NOW).text;
      expect(mine, t).toBe(theirs);
    }
  });

  it('a bare ZIP code outside a question is not taken as a change of location', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('11219')).toBe(T.ZIP_HINT);
    expect(data.app.place?.name).toBe('Lakewood, NJ 08701');
  });

  it('LOCATION with and without a ZIP code', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('LOCATION')).toBe('Your location is Lakewood, NJ 08701. To change it, reply with the new ZIP code.');
    expect(p.say('60645')).toBe('Location set: Chicago, IL 60645. Sunset and nightfall are now worked out for it.');
    expect(data.app.place?.timeZone).toBe('America/Chicago');
    expect(p.say('ZIP 90036')).toMatch(/^Location set: Los Angeles, CA 90036\./);
    expect(p.say('LOCATION 00000')).toBe(T.unknownZip('00000'));
    expect(p.say('LOCATION nowhere')).toMatch(/^Not understood; nothing was changed\. Write LOCATION and the ZIP code/);
    expect(data.app.place?.name).toBe('Los Angeles, CA 90036');
  });

  it('RCS: a location shared with no question open needs YES', () => {
    const data = household();
    const p = new Phone(data);
    const out = p.send('', { location: { latitude: 41.99, longitude: -87.7 } });
    expect(texts(out)).toBe('Set your location to Chicago, IL 60645? Reply YES to set it, NO to keep Lakewood, NJ 08701.');
    expect(data.app.place?.name).toBe('Lakewood, NJ 08701');
    expect(p.say('YES')).toMatch(/^Location set: Chicago, IL 60645\./);
    expect(data.app.place?.name).toBe('Chicago, IL 60645');
    expect(p.send('', { location: { latitude: Number.NaN, longitude: 0 } }).out[0]!.text).toBe(T.NO_PLACE_NEAR);
  });

  it('HISTORY lists the latest five, lettered; ERASE needs YES', () => {
    const data = household();
    const p = new Phone(data);
    p.say('1 10/1 day');
    p.say('2 10/6');
    p.say('1 11/1 day');
    p.say('2 11/6');
    p.say('1 11/20 night');
    p.say('1 12/1/2025 night');
    const list = p.say('HISTORY');
    expect(list).toBe(
      'Latest entries: A flow Fri Nov 20 night. B hefsek Fri Nov 6. C flow Sun Nov 1 by day. D hefsek Tue Oct 6. E flow Thu Oct 1 by day. To erase one, reply ERASE and its letter, e.g. ERASE A.',
    );
    expect(p.chat?.q.kind).toBe('history');
    expect(p.say('ERASE G')).toBe('There is no entry G in the list. Nothing was changed. Reply ERASE and a letter.');
    expect(p.say('ERASE D')).toBe('Erase hefsek Tue Oct 6? Reply YES to erase it, NO to keep it.');
    expect(data.entries).toHaveLength(6);
    const out = p.send('YES');
    expect(texts(out)).toMatch(/^Erased: hefsek Tue Oct 6\. /);
    expect(out.changed).toBe(true);
    expect(out.computed).toBeDefined();
    expect(data.entries).toHaveLength(5);
    expect(data.removed[0]!.entry.kind).toBe('hefsek');
    expect(p.say('ERASE A')).toBe(T.ERASE_NEEDS_LIST);
  });

  it('ERASE then NO, or then a digit, erases nothing', () => {
    const data = household();
    const p = new Phone(data);
    p.say('1 11/1 day');
    p.say('HISTORY');
    p.say('ERASE A');
    expect(p.say('NO')).toBe('Nothing was changed.');
    p.say('HISTORY');
    p.say('ERASE A');
    p.say('9');
    expect(p.say('YES')).toBe(T.NOTHING_PENDING);
    expect(data.entries).toHaveLength(1);
  });

  it('HISTORY with no entries; years shown when not this year', () => {
    const p = new Phone(household());
    expect(p.say('HISTORY')).toBe(T.HISTORY_EMPTY);
    p.say('1 3/1/2025 day');
    expect(p.say('HISTORY')).toMatch(/A flow Sat Mar 1 by day, 2025\./);
  });

  it('REMINDERS ON carries the consent wording and sets consent; OFF clears it', () => {
    const data = household();
    data.phones[0]!.verifiedAt = null;
    const p = new Phone(data);
    expect(p.say('REMINDERS')).toBe('Reminders for this phone are off. REMINDERS ON turns them on. KINDS chooses which kinds (now 6 of 6). WORDING PLAIN or WORDING DISCREET (now plain). Times are set on the website.');
    const out = p.send('REMINDERS ON');
    expect(texts(out)).toBe(T.remindersOn('0101'));
    expect(out.changed).toBe(true);
    expect(data.phones[0]!.consentAt).toBe(NOW);
    expect(data.phones[0]!.verifiedAt).toBe(NOW);
    expect(p.say('REMINDERS ON')).toBe(T.REMINDERS_ALREADY_ON);
    expect(p.say('REMINDERS OFF')).toBe(T.REMINDERS_OFF);
    expect(data.phones[0]!.consentAt).toBeNull();
    expect(p.say('REMINDERS OFF')).toBe(T.REMINDERS_ALREADY_OFF);
    expect(p.say('REMINDERS LOUDER')).toMatch(/^Not understood; nothing was changed\./);
    expect(p.say('REMINDER TIMES')).toBe(T.WEBSITE_TIMES);
    data.phones[0]!.optedOut = true;
    expect(p.say('REMINDERS ON')).toBe(T.OPTED_OUT);
  });

  it('KINDS: letters choose the kinds this phone receives', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('KINDS')).toMatch(/^Reminder kinds for this phone: A hefsek \(on\), B morning bedikah \(on\)/);
    expect(p.say('a d f')).toBe('Changed: this phone gets reminders for: hefsek, mikvah night, onah. They are sent once you text REMINDERS ON.');
    expect(data.phones[0]!.reminders).toEqual(['hefsek', 'mikvah', 'onah']);
    p.say('KINDS');
    expect(p.say('FDA')).toBe('That is already the choice for this phone; nothing was changed.');
    p.say('KINDS');
    expect(p.say('G')).toMatch(/^Not understood; nothing was changed\. Reply the letters you want, or ALL or NONE\./);
    expect(p.say('NONE')).toBe('Changed: this phone gets no reminders of any kind. KINDS chooses again.');
    expect(data.phones[0]!.reminders).toEqual([]);
    p.say('KINDS');
    p.say('ALL');
    expect(data.phones[0]!.reminders).toEqual(REMINDER_KINDS);
  });

  it('WORDING changes the reminder wording of the household', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('WORDING')).toMatch(/^Reminder wording is plain, for every phone on the account\./);
    expect(p.say('WORDING DISCREET')).toBe(T.wordingChanged('discreet'));
    expect(data.app.reminders.style).toBe('discreet');
    expect(p.say('WORDING DISCREET')).toBe(T.wordingSame('discreet'));
    expect(p.say('WORDING PLAIN')).toBe(T.wordingChanged('plain'));
    expect(newHousehold().app.reminders.style).toBe('plain'); // the defaults were not touched
  });

  it('PHONES lists them by last four digits; REMOVE needs YES and leaves the removal to the server', () => {
    const data = household({ spouse: true });
    const p = new Phone(data);
    data.phones[1]!.consentAt = 5;
    expect(p.say('PHONES')).toBe(
      'Phones: A ending 0101 (this phone, reminders off), B ending 0102 (reminders on). ADD and a number adds one, e.g. ADD 7325551234. REMOVE and a letter removes one. LEAVE takes this phone off.',
    );
    expect(p.say('REMOVE A')).toBe(T.REMOVE_SELF);
    p.say('PHONES');
    expect(p.say('REMOVE C')).toBe('There is no phone C in the list. Nothing was changed. Reply REMOVE and a letter.');
    expect(p.say('REMOVE B')).toBe(T.removeAsk('0102'));
    const out = p.send('YES');
    expect(texts(out)).toBe('Removed the phone ending 0102 from the account.');
    expect(out.effects).toEqual([{ type: 'remove_phone', number: SPOUSE, ifFailed: T.removeFailed('0102') }]);
    expect(out.changed).toBe(false);
    expect(data.phones).toHaveLength(2); // the server removes it (accounts.removePhone)
    expect(p.say('REMOVE B')).toBe(T.REMOVE_NEEDS_LIST);
  });

  it('ADD: asks before texting anyone, then hands the invitation to the server', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('ADD 732-555-1234')).toBe(T.inviteAsk('(732) 555-1234'));
    const out = p.send('YES');
    expect(texts(out)).toBe(T.inviteSent('(732) 555-1234', 7));
    expect(out.effects).toHaveLength(1);
    const e = out.effects[0]!;
    expect(e).toMatchObject({ type: 'invite_phone', number: '+17325551234', days: 7 });
    if (e.type === 'invite_phone') {
      expect(e.code).toMatch(/^[A-HJ-NP-Z]{8}$/);
      expect(e.text).toBe(T.invitationText('0101', e.code, 7));
      expect(e.text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
      expect(isGsmBasic(e.text)).toBe(true);
    }
    expect(data.phones).toHaveLength(1);
    for (const t of ['ADD +1 (732) 555-1234', 'ADD 17325551234', 'ADD (732) 555 1234']) {
      const q = new Phone(household());
      expect(q.say(t), t).toBe(T.inviteAsk('(732) 555-1234'));
    }
    expect(p.say('ADD 12345')).toBe(T.ADD_FORMAT);
    expect(p.say('ADD')).toBe(T.ADD_FORMAT);
    expect(p.say('ADD 7325550101')).toBe('The number ending 0101 is already on this account. Nothing was changed.');
    data.phones.push(phone('+17325550103'), phone('+17325550104'), phone('+17325550105'));
    expect(p.say('ADD 7325551234')).toBe('This account already has 4 phones, the most allowed. Send PHONES to remove one first. Nothing was changed.');
  });

  it('LEAVE needs YES, and the last phone cannot leave', () => {
    expect(new Phone(household()).say('LEAVE')).toBe(T.LAST_PHONE);
    const p = new Phone(household({ spouse: true }), NOW, SPOUSE);
    expect(p.say('LEAVE')).toBe(T.LEAVE_ASK);
    const out = p.send('YES');
    expect(texts(out)).toBe(T.LEFT);
    expect(out.effects).toEqual([{ type: 'leave', number: SPOUSE, ifFailed: T.LEAVE_FAILED }]);
  });

  it('DELETE ACCOUNT needs YES', () => {
    const p = new Phone(household());
    expect(p.say('DELETE')).toMatch(/^Not understood; nothing was changed\. To delete the account, write DELETE ACCOUNT\./);
    expect(p.say('DELETE ACCOUNT')).toBe(T.DELETE_ASK);
    expect(p.send('NO').effects).toEqual([]);
    p.say('DELETE ACCOUNT');
    const out = p.send('YES');
    expect(texts(out)).toBe(T.DELETED);
    expect(out.effects).toEqual([{ type: 'delete_account', ifFailed: T.DELETE_FAILED }]);
  });

  it('CALENDAR: create, show, replace (YES), remove (YES), with the warning', () => {
    const data = household();
    const p = new Phone(data);
    p.random = makeRandom();
    expect(p.say('CALENDAR')).toBe(T.CALENDAR_NONE);
    expect(p.say('CALENDAR OFF')).toBe(T.CALENDAR_NO_LINK);
    const created = p.send('CALENDAR LINK');
    expect(created.changed).toBe(true);
    expect(data.calendarLinkToken).toBe('Tok0001_abcdefghijklmnopqrstuvw');
    expect(texts(created)).toBe(T.calendarCreated('https://betaharah.com/cal/Tok0001_abcdefghijklmnopqrstuvw.ics'));
    expect(texts(created)).toMatch(/Anyone who has this link can read the calendar/);
    expect(p.say('CALENDAR LINK')).toBe(T.calendarShow('https://betaharah.com/cal/Tok0001_abcdefghijklmnopqrstuvw.ics'));
    expect(p.say('CALENDAR')).toBe(T.CALENDAR_HAS);
    expect(p.say('CALENDAR NEW')).toBe(T.CALENDAR_NEW_ASK);
    expect(p.say('YES')).toBe(T.calendarReplaced('https://betaharah.com/cal/Tok0002_abcdefghijklmnopqrstuvw.ics'));
    expect(p.say('CALENDAR OFF')).toBe(T.CALENDAR_OFF_ASK);
    expect(p.say('NO')).toBe('Nothing was changed.');
    expect(data.calendarLinkToken).toBe('Tok0002_abcdefghijklmnopqrstuvw');
    p.say('CALENDAR OFF');
    expect(p.say('YES')).toBe(T.CALENDAR_OFF);
    expect(data.calendarLinkToken).toBeNull();
    expect(p.say('CALENDAR GOOGLE')).toBe(T.WEBSITE_GOOGLE);
  });

  it('TERMS HEBREW / ENGLISH', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('TERMS')).toBe(T.termsNow('en'));
    expect(p.say('TERMS HEBREW')).toBe(T.TERMS_HE);
    expect(data.app.terms).toBe('he');
    expect(p.say('TERMS HEBREW')).toMatch(/already in Hebrew/);
    expect(p.say('TERMS ENGLISH')).toBe(T.TERMS_EN);
    expect(data.app.terms).toBe('en');
  });

  it('WEB: the server texts the link; nothing else is sent', () => {
    const out = new Phone(household()).send('WEB');
    expect(out.out).toEqual([]);
    expect(out.effects).toEqual([{ type: 'web_link', number: ME, text: T.WEB_LINK_TEXT, ifFailed: T.WEB_FAILED }]);
  });

  it('website-only things answer with one line', () => {
    const p = new Phone(household());
    expect(p.say('PASSWORD')).toBe(T.WEBSITE_PASSWORD);
    expect(p.say('DOWNLOAD')).toBe(T.WEBSITE_DATA);
    expect(p.say('GOOGLE')).toBe(T.WEBSITE_GOOGLE);
    expect(p.say('TIMES')).toBe(T.WEBSITE_TIMES);
  });

  it('JOIN from a phone that is already signed up', () => expect(new Phone(household()).say('JOIN')).toBe(T.ALREADY_JOINED));

  it('words with wrong arguments change nothing', () => {
    for (const t of ['MENU NOW', 'HISTORY 5', 'ERASE', 'ERASE AB', 'ERASE 1', 'CUSTOMS SOME', 'NIGHTFALL A', 'KINDS A', 'PHONES 2', 'REMOVE', 'REMOVE 1', 'LEAVE NOW', 'CALENDAR PLEASE', 'TERMS FRENCH', 'WEB LINK', 'SETUP AGAIN', 'WORDING LOUD', 'PASSWORD 1234']) {
      const data = household();
      const before = JSON.stringify(data);
      const out = new Phone(data).send(t);
      expect(texts(out), t).toMatch(/^Not understood; nothing was changed\./);
      expect(out.effects, t).toEqual([]);
      expect(JSON.stringify(data), t).toBe(before);
    }
  });
});

describe('small parts', () => {
  it('postal codes', () => {
    expect(postalOf('08701')).toBe('08701');
    expect(postalOf('08701-1234')).toBe('08701');
    expect(postalOf('H3W 1A1')).toBe('H3W 1A1');
    expect(postalOf('H3W1A1')).toBe('H3W 1A1');
    expect(postalOf('H3W')).toBe('H3W');
    for (const bad of ['0870', '087011', 'HHH', '1', 'H3W 1A', '']) expect(postalOf(bad), bad).toBeNull();
  });
  it('invitation codes come only from the injected source', () => {
    expect(inviteCode(() => 'abcdefgh')).toBe(inviteCode(() => 'abcdefgh'));
    expect(inviteCode(() => '')).toMatch(/^[A-Z]{8}$/);
    expect(inviteCode(() => 'x')).toHaveLength(8);
  });
  it('pack joins texts that fit, never sends more than two, and keeps suggestions on the last', () => {
    expect(pack([{ text: 'a' }, { text: 'b', suggestions: T.YES_NO }])).toEqual([{ text: 'a b', suggestions: T.YES_NO }]);
    const long = 'x'.repeat(200);
    expect(pack([{ text: long }, { text: long }])).toHaveLength(2);
  });
  it('no repair of an outgoing text was ever needed', () => expect(repairs).toEqual({ folded: 0, shortened: 0 }));
  it('a phone not on the household gets nothing', () => {
    const out = converse({ data: household(), chat: null, from: '+19999999999', text: '1', now: NOW, limits: { maxPhones: 4 }, lookupPostal, nearestPostal, random: makeRandom() });
    expect(out).toEqual({ chat: null, out: [], effects: [], changed: false });
  });
});
