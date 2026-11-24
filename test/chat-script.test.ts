/**
 * Whole conversations, text by text, with the exact replies: a stranger
 * signs up and finishes setup, then adds a second phone, which joins by
 * texting the code itself.
 * The same exchanges are printed in docs/TEXTING.md.
 */
import { describe, expect, it } from 'vitest';
import { begin, greet, joinWord, type ConverseOutput } from '../src/app/chat';
import * as T from '../src/app/chat/texts';
import { newHousehold } from '../src/app/model';
import { REMINDER_KINDS } from '../src/app/settings';
import { at, ME, phone, Phone, SPOUSE } from './chat-fixtures';

const lines = (out: ConverseOutput | { out: Array<{ text: string }> }): string[] => out.out.map(m => m.text);

describe('from the first text to a finished setup', () => {
  it('runs as one conversation', () => {
    const now = at(2026, 11, 24, 20, 15); // Tuesday evening

    // A stranger texts the number.
    expect(lines(greet({ text: 'Hi, what is this?', signup: 'open', inviteValid: null }))).toEqual([T.WELCOME_OPEN]);
    const join = greet({ text: 'JOIN', signup: 'open', inviteValid: null });
    expect(join).toEqual({ action: 'create', out: [] });

    // The server creates the account with this phone, verified, and starts setup.
    const data = newHousehold();
    data.phones.push({ ...phone(ME), verifiedAt: now });
    const started = begin({ data, from: ME, now }, 'setup');
    expect(lines(started)).toEqual([T.SETUP_START]);
    const p = new Phone(data, now);
    p.chat = started.chat;

    // Step 1: location.
    expect(lines(p.send('08701'))).toEqual([`Location set: Lakewood, NJ 08701. Sunset and nightfall are now worked out for it. ${T.CUSTOMS_INTRO}`]);
    expect(p.last!.changed).toBe(true);

    // Step 2: customs, by text.
    p.wait(1);
    expect(lines(p.send('B'))[0]).toMatch(/^Custom 1 of 12: Days before the hefsek/);
    const answers = ['A', 'KEEP', 'A', 'A', 'A', 'A', 'A', 'B', 'A', 'A', 'A', 'A'];
    let last: ConverseOutput | null = null;
    for (const a of answers) {
      p.wait(1);
      last = p.send(a);
    }
    expect(lines(last!).join(' ')).toBe(`Kept: nightfall: 8.5 degrees. ${T.CUSTOMS_ALL_DONE} ${T.RECENT_ASK}`);
    expect(data.halachicConfirmedAt).toBe(p.now);
    expect(data.halachic.beinonitLength).toBe('onah');
    expect(data.halachic.chodesh30).toBe('day29');

    // Step 3: recent dates.
    p.wait(2);
    expect(lines(p.send('1 11/1 night'))).toEqual([`Recorded: flow Sun Nov 1 night, 2026. Hefsek from Fri Nov 6. 0 to undo. ${T.RECENT_NEXT}`]);
    p.wait(1);
    expect(lines(p.send('2 11/6'))[0]).toMatch(/^Recorded: hefsek Fri Nov 6, 2026\. Clean days Sat Nov 7 - Fri Nov 13\. Mikvah Fri Nov 13 after \d:\d\d PM\. 0 to undo\. The question before is still open: send 2 with a date, or DONE\.$/);
    p.wait(1);
    expect(lines(p.send('4 11/13'))).toEqual(['Recorded: mikvah Fri Nov 13 night, 2026. 0 to undo. The question before is still open: send 2 with a date, or DONE.']);
    p.wait(1);
    expect(lines(p.send('DONE'))).toEqual([T.SETUP_DONE]);
    expect(p.chat).toBeNull();
    expect(data.entries.map(e => e.entry.kind)).toEqual(['flow', 'hefsek', 'mikvah']);

    // Everyday use.
    expect(lines(p.send('9'))[0]).toMatch(/^Tehorah\. Next onah: /);
    expect(lines(p.send('REMINDERS ON'))).toEqual([T.remindersOn('0101')]);

    // A second phone: the person who asks gets a code; nothing is sent to the other phone.
    const added = p.send('ADD');
    const effect = added.effects[0]!;
    expect(effect.type).toBe('join_code');
    if (effect.type !== 'join_code') return;
    expect(lines(added)).toEqual([T.addCode(effect.code, 7)]);

    // The other phone texts the code from itself.
    const reply = `JOIN ${effect.code}`;
    expect(joinWord(reply)).toBe(effect.code);
    expect(greet({ text: reply, signup: 'closed', inviteValid: true, inviteKind: 'phone' })).toEqual({ action: 'join', out: [], invite: effect.code });
    data.phones.push({ ...phone(SPOUSE), verifiedAt: p.now, reminders: [...REMINDER_KINDS] });
    const joined = begin({ data, from: SPOUSE, now: p.now }, 'joined');
    expect(lines(joined)).toEqual([T.joinedText(' with the phone ending 0101')]);
    const spouse = new Phone(data, p.now, SPOUSE);
    expect(lines(spouse.send('PHONES'))[0]).toBe(
      'Phones: A ending 0101 (reminders on), B ending 0102 (this phone, reminders off). ADD gives a code to add a phone. REMOVE and a letter removes one. LEAVE takes this phone off.',
    );
  });
});
