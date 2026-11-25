/**
 * Whole conversations, text by text, with the exact replies (options line
 * included): a stranger signs up and finishes setup, then adds a second
 * phone, which joins by texting the code itself. The same exchanges are
 * printed in docs/TEXTING.md.
 */
import { describe, expect, it } from 'vitest';
import { begin, greet, joinWord, type ConverseOutput } from '../src/app/chat';
import { newHousehold } from '../src/app/model';
import { REMINDER_KINDS } from '../src/app/settings';
import { at, ME, phone, Phone, SPOUSE } from './chat-fixtures';

const lines = (out: ConverseOutput | { out: Array<{ text: string }> }): string[] => out.out.map(m => m.text);

describe('from the first text to a finished setup', () => {
  it('runs as one conversation, answered by options and by words', () => {
    const now = at(2026, 11, 24, 20, 15); // Tuesday evening

    // A stranger texts the number.
    expect(lines(greet({ text: 'Hi, what is this?', signup: 'open', inviteValid: null }))).toEqual([
      'Betaharah: a mikvah calendar by text. Msg frequency varies. Msg&data rates may apply. Reply STOP to stop, HELP for help. Terms: betaharah.com/terms\nReply: JOIN',
    ]);
    expect(greet({ text: 'JOIN', signup: 'open', inviteValid: null })).toEqual({ action: 'create', out: [] });

    // The server creates the account with this phone, verified, and starts setup.
    const data = newHousehold();
    data.phones.push({ ...phone(ME), verifiedAt: now });
    const started = begin({ data, from: ME, now }, 'setup');
    expect(lines(started)).toEqual(['Welcome to Betaharah. Setup step 1 of 3: your ZIP code (or Canadian postal code), for the times of sunset.\nReply: SKIP']);
    const p = new Phone(data, now);
    p.chat = started.chat;

    // Step 1: location.
    expect(lines(p.send('08701'))).toEqual([
      'Location set: Lakewood, NJ 08701. Step 2 of 3: customs. Until they are chosen, the stricter option of each is used.\nReply: KEEP FOR NOW, ANSWER BY TEXT, LATER',
    ]);
    expect(p.last!.changed).toBe(true);

    // Step 2: customs, by text.
    p.wait(1);
    expect(lines(p.send('ANSWER BY TEXT'))).toEqual([
      'Custom 1 of 12: Days before the hefsek, the day she became niddah being day 1: five (Ashkenazi, some Sephardi) or four (some Sephardi). Now: five days.\nReply: FIVE DAYS, FOUR DAYS, KEEP',
    ]);
    const answers = ['FIVE DAYS', 'KEEP', 'ONE ONAH', 'one onah', 'OBSERVED', 'IN DAYS', 'LONGER ONES TOO', 'the 29th', 'AS USUAL', 'CALCULATED', 'OUTSIDE ISRAEL', 'KEEP'];
    let last: ConverseOutput | null = null;
    for (const a of answers) {
      p.wait(1);
      last = p.send(a);
    }
    expect(lines(last!)).toEqual(['Kept: nightfall: 8.5 degrees. All 12 customs are saved. Step 3 of 3: when did the last period begin? For example: Nov 22 night.\nReply: SKIP']);
    expect(data.halachicConfirmedAt).toBe(p.now);
    expect(data.halachic.beinonitLength).toBe('onah');
    expect(data.halachic.chodesh30).toBe('day29');

    // Step 3: recent dates.
    p.wait(2);
    expect(lines(p.send('Nov 1 night'))).toEqual(['Recorded: flow Sun night, eve of 22 Cheshvan 5787. Hefsek from Fri, 26 Cheshvan. Hefsek done? Its date, for example: Nov 27.\nReply: NOT YET']);
    p.wait(1);
    expect(lines(p.send('11/6'))[0]).toMatch(
      /^Recorded: hefsek Fri, 26 Cheshvan 5787\. Clean days from Shabbos, 27 Cheshvan\. Mikvah Fri night, eve of 4 Kislev after \d:\d\d PM\. Setup is done\. Reminders are off for now\.\nReply: PERIOD, HEFSEK, REMINDERS, MORE$/,
    );
    expect(data.entries.map(e => e.entry.kind)).toEqual(['flow', 'hefsek']);

    // Everyday use.
    expect(lines(p.send('STATUS'))[0]).toMatch(/^Tehorah\. Next onah: .*\nReply: PERIOD, HEFSEK, HISTORY, MORE$/);
    p.send('REMINDERS');
    expect(lines(p.send('TURN ON'))).toEqual([
      'Reminders are on for this phone (ending 0101). This phone agrees to receive reminder texts from Betaharah. Msg frequency varies. Msg&data rates may apply. Reply STOP to stop, HELP for help.\nReply: KINDS, STATUS',
    ]);

    // A second phone: the person who asks gets a code; nothing is sent to the other phone.
    p.send('MORE');
    p.send('ACCOUNT');
    p.send('PHONES');
    const added = p.send('ADD');
    const effect = added.effects[0]!;
    expect(effect.type).toBe('join_code');
    if (effect.type !== 'join_code') return;
    expect(lines(added)).toEqual([`Have that phone text JOIN ${effect.code} to this number within 7 days. The code works once.\nReply: PHONES, MENU`]);

    // The other phone texts the code from itself.
    const reply = `JOIN ${effect.code}`;
    expect(joinWord(reply)).toBe(effect.code);
    expect(greet({ text: reply, signup: 'closed', inviteValid: true, inviteKind: 'phone' })).toEqual({ action: 'join', out: [], invite: effect.code });
    data.phones.push({ ...phone(SPOUSE), verifiedAt: p.now, reminders: [...REMINDER_KINDS] });
    const joined = begin({ data, from: SPOUSE, now: p.now }, 'joined');
    expect(lines(joined)).toEqual(['This phone is now on the account with the phone ending 0101. Its reminders are off.\nReply: PERIOD, HEFSEK, STATUS, MORE']);
    const spouse = new Phone(data, p.now, SPOUSE);
    expect(lines(spouse.send('phones'))).toEqual([
      'Phones: first ending 0101 (reminders on); second ending 0102 (this phone, reminders off).\nReply: ADD, REMOVE, LEAVE, MENU',
    ]);
  });
});
