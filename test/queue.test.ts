import { describe, expect, it } from 'vitest';
import { newHousehold, type HouseholdData } from '../src/app/model';
import { allowText, nextWake, postponeDue, rebuildQueue, refundText, RETRY_MS, SENDING_TIMEOUT_MS, settle, takeDue, textsThisMonth } from '../src/app/queue';
import { restText, type Reminder, type RestItem } from '../src/engine/present';

const A = '+17325550101';
const B = '+17325550102';
const NOW = Date.UTC(2026, 10, 23, 15);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function household(): HouseholdData {
  const data = newHousehold();
  data.phones.push({ number: A, name: '', canUpdate: true, reminders: ['hefsek', 'mikvah'], verifiedAt: 1, consentAt: 1, optedOut: false });
  data.phones.push({ number: B, name: '', canUpdate: true, reminders: ['mikvah'], verifiedAt: 1, consentAt: 1, optedOut: false });
  return data;
}

const reminder = (key: string, kind: Reminder['kind'], at: number, until = at + 3 * HOUR): Reminder => ({ key, kind, at, until, text: `text of ${key}`, msg: { key: 'reminder.onah', vars: {} } });
const LIST = [reminder('hefsek:1', 'hefsek', NOW + HOUR), reminder('mikvah:1', 'mikvah', NOW + 2 * DAY)];
const pending = (data: HouseholdData): string[] => data.queue.filter(q => q.status === 'pending').map(q => `${q.key}>${q.to.slice(-1)}`);

describe('building the list of waiting reminders', () => {
  it('each phone gets the kinds it chose, if it agreed to texts', () => {
    const data = household();
    rebuildQueue(data, LIST, NOW);
    expect(pending(data)).toEqual(['hefsek:1>1', 'mikvah:1>1', 'mikvah:1>2']);
    expect(data.queue[0]).toEqual({ key: 'hefsek:1', to: A, at: NOW + HOUR, until: NOW + 4 * HOUR, text: 'text of hefsek:1', msg: { key: 'reminder.onah', vars: {} }, status: 'pending', notBefore: 0, doneAt: null });
  });

  it('nothing for a phone that has not agreed, has not proved its number, or replied STOP', () => {
    for (const change of [(d: HouseholdData) => (d.phones[0]!.consentAt = null), (d: HouseholdData) => (d.phones[0]!.verifiedAt = null), (d: HouseholdData) => (d.phones[0]!.optedOut = true)]) {
      const data = household();
      change(data);
      rebuildQueue(data, LIST, NOW);
      expect(pending(data)).toEqual(['mikvah:1>2']);
    }
  });

  it('leaves out what is already over and what is far ahead', () => {
    const data = household();
    rebuildQueue(data, [reminder('hefsek:old', 'hefsek', NOW - 4 * HOUR), reminder('hefsek:late', 'hefsek', NOW - HOUR), reminder('hefsek:far', 'hefsek', NOW + 46 * DAY)], NOW);
    // one that is late but still within its time is kept; it is sent at the next run
    expect(pending(data)).toEqual(['hefsek:late>1']);
  });

  it('with no location (no picture), nothing waits', () => {
    const data = household();
    rebuildQueue(data, LIST, NOW);
    rebuildQueue(data, null, NOW);
    expect(data.queue).toEqual([]);
  });

  it('what was sent or dropped is never queued again, even if its time changes', () => {
    const data = household();
    rebuildQueue(data, LIST, NOW);
    const taken = takeDue(data, NOW + HOUR, 8, 100);
    expect(taken.map(q => q.key)).toEqual(['hefsek:1']);
    settle(data, taken[0]!, 'sent', NOW + HOUR);
    rebuildQueue(data, [reminder('hefsek:1', 'hefsek', NOW + 2 * HOUR), LIST[1]!], NOW + HOUR + MINUTE);
    expect(pending(data)).toEqual(['mikvah:1>1', 'mikvah:1>2']);
    expect(data.queue.find(q => q.key === 'hefsek:1')).toMatchObject({ status: 'sent', text: '', doneAt: NOW + HOUR });
    // the note of it is dropped after 45 days
    rebuildQueue(data, [], NOW + 47 * DAY);
    expect(data.queue).toEqual([]);
  });

  it('a reminder that is no longer called for stops waiting', () => {
    const data = household();
    rebuildQueue(data, LIST, NOW);
    rebuildQueue(data, [LIST[1]!], NOW);
    expect(pending(data)).toEqual(['mikvah:1>1', 'mikvah:1>2']);
  });

  it('forgets a phone that was removed from the account', () => {
    const data = household();
    rebuildQueue(data, LIST, NOW);
    settle(data, takeDue(data, NOW + HOUR, 8, 100)[0]!, 'sent', NOW + HOUR);
    data.phones = data.phones.filter(p => p.number !== A);
    rebuildQueue(data, LIST, NOW + HOUR);
    expect(data.queue.map(q => q.to)).toEqual([B]);
  });
});

describe('the time of the next reminder', () => {
  it('is the earliest waiting one, or nothing', () => {
    const data = household();
    expect(nextWake(data)).toBeNull();
    rebuildQueue(data, LIST, NOW);
    expect(nextWake(data)).toBe(NOW + HOUR);
    settle(data, takeDue(data, NOW + HOUR, 8, 100)[0]!, 'sent', NOW + HOUR);
    expect(nextWake(data)).toBe(NOW + 2 * DAY);
  });

  it('after a failed attempt it is the time of the next attempt; while one is being sent, the time it would be given up', () => {
    const data = household();
    rebuildQueue(data, [LIST[0]!], NOW);
    const [taken] = takeDue(data, NOW + HOUR, 8, 100);
    expect(nextWake(data)).toBe(NOW + HOUR + SENDING_TIMEOUT_MS);
    settle(data, taken!, 'failed', NOW + HOUR);
    expect(nextWake(data)).toBe(NOW + HOUR + RETRY_MS);
  });
});

describe('taking the reminders that are due', () => {
  it('takes only what is due, marks it, and does not take it twice', () => {
    const data = household();
    rebuildQueue(data, LIST, NOW);
    expect(takeDue(data, NOW, 8, 100)).toEqual([]);
    const first = takeDue(data, NOW + HOUR, 8, 100);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ key: 'hefsek:1', to: A, text: 'text of hefsek:1', status: 'sending' });
    // a second run at the same moment finds nothing to take
    expect(takeDue(data, NOW + HOUR, 8, 100)).toEqual([]);
    expect(textsThisMonth(data, NOW)).toBe(1);
  });

  it('respects the limit of one run and leaves the rest for the next', () => {
    const data = household();
    rebuildQueue(data, [reminder('mikvah:1', 'mikvah', NOW), reminder('mikvah:2', 'mikvah', NOW)], NOW);
    expect(takeDue(data, NOW, 3, 100)).toHaveLength(3);
    expect(pending(data)).toHaveLength(1);
    expect(takeDue(data, NOW, 3, 100)).toHaveLength(1);
  });

  it('drops a reminder whose time is over, or whose phone no longer receives texts', () => {
    const data = household();
    rebuildQueue(data, LIST, NOW);
    data.phones[1]!.optedOut = true;
    expect(takeDue(data, NOW + 2 * DAY + 4 * HOUR, 8, 100)).toEqual([]);
    expect(data.queue.map(q => q.status)).toEqual(['dropped', 'dropped', 'dropped']);
    expect(data.queue.every(q => q.text === '')).toBe(true);
    expect(nextWake(data)).toBeNull();
    expect(textsThisMonth(data, NOW)).toBe(0);
  });

  it('gives back to waiting what a stopped run had taken, after ten minutes', () => {
    const data = household();
    rebuildQueue(data, [LIST[0]!], NOW);
    takeDue(data, NOW + HOUR, 8, 100);
    expect(takeDue(data, NOW + HOUR + 9 * MINUTE, 8, 100)).toEqual([]);
    expect(takeDue(data, NOW + HOUR + 10 * MINUTE, 8, 100)).toHaveLength(1);
  });

  it('stops at the household\'s monthly limit', () => {
    const data = household();
    rebuildQueue(data, [reminder('mikvah:1', 'mikvah', NOW), reminder('mikvah:2', 'mikvah', NOW)], NOW);
    expect(takeDue(data, NOW, 8, 3)).toHaveLength(3);
    expect(data.queue.map(q => q.status).sort()).toEqual(['dropped', 'sending', 'sending', 'sending']);
  });
});

describe('while the site cannot send texts', () => {
  it('a due reminder is put off ten minutes at a time, and the next wake time moves forward', () => {
    const data = household();
    rebuildQueue(data, LIST, NOW);
    expect(postponeDue(data, NOW)).toBe(0); // nothing is due yet
    expect(postponeDue(data, NOW + HOUR)).toBe(1);
    expect(data.queue[0]).toMatchObject({ key: 'hefsek:1', status: 'pending', notBefore: NOW + HOUR + RETRY_MS, text: 'text of hefsek:1' });
    expect(nextWake(data)).toBe(NOW + HOUR + RETRY_MS);
    // not again before then
    expect(postponeDue(data, NOW + HOUR + 5 * MINUTE)).toBe(0);
    expect(postponeDue(data, NOW + HOUR + RETRY_MS)).toBe(1);
    expect(nextWake(data)).toBe(NOW + HOUR + 2 * RETRY_MS);
    // nothing was counted against the monthly limit, and the reminders not yet due are untouched
    expect(textsThisMonth(data, NOW)).toBe(0);
    expect(data.queue.filter(q => q.key === 'mikvah:1').every(q => q.notBefore === 0)).toBe(true);
  });

  it('it is still sent if texting comes back within its time', () => {
    const data = household();
    rebuildQueue(data, [LIST[0]!], NOW);
    postponeDue(data, NOW + HOUR);
    expect(takeDue(data, NOW + HOUR + 5 * MINUTE, 8, 100)).toEqual([]);
    expect(takeDue(data, NOW + HOUR + RETRY_MS, 8, 100).map(q => q.key)).toEqual(['hefsek:1']);
  });

  it('it is dropped once its time is over, and then nothing waits', () => {
    const data = household();
    rebuildQueue(data, [LIST[0]!], NOW);
    for (let t = NOW + HOUR; t < NOW + 4 * HOUR; t += RETRY_MS) postponeDue(data, t);
    expect(data.queue[0]!.status).toBe('pending');
    expect(postponeDue(data, NOW + 4 * HOUR + RETRY_MS)).toBe(1);
    expect(data.queue[0]).toMatchObject({ status: 'dropped', text: '' });
    expect(nextWake(data)).toBeNull();
  });

  it('drops a due reminder whose phone no longer receives texts, and gives back what a stopped run had taken', () => {
    const data = household();
    rebuildQueue(data, [reminder('mikvah:1', 'mikvah', NOW)], NOW);
    takeDue(data, NOW, 8, 100); // both taken by a run that then stopped
    data.phones[1]!.optedOut = true;
    expect(postponeDue(data, NOW + 5 * MINUTE)).toBe(0);
    expect(postponeDue(data, NOW + SENDING_TIMEOUT_MS)).toBe(2);
    expect(data.queue.map(q => `${q.to.slice(-1)}:${q.status}`)).toEqual(['1:pending', '2:dropped']);
    expect(nextWake(data)).toBe(NOW + SENDING_TIMEOUT_MS + RETRY_MS);
  });
});

describe('recording what became of a reminder', () => {
  const taken = (): { data: HouseholdData; q: { key: string; to: string } } => {
    const data = household();
    rebuildQueue(data, [LIST[0]!], NOW);
    return { data, q: takeDue(data, NOW + HOUR, 8, 100)[0]! };
  };

  it('sent: counted, and its words are no longer kept', () => {
    const { data, q } = taken();
    settle(data, q, 'sent', NOW + HOUR);
    expect(data.queue[0]).toMatchObject({ status: 'sent', text: '' });
    expect(textsThisMonth(data, NOW)).toBe(1);
  });

  it('failed: not counted, tried again ten minutes later, and dropped once its time would be over', () => {
    const { data, q } = taken();
    settle(data, q, 'failed', NOW + HOUR);
    expect(data.queue[0]).toMatchObject({ status: 'pending', notBefore: NOW + HOUR + RETRY_MS, text: 'text of hefsek:1' });
    expect(textsThisMonth(data, NOW)).toBe(0);
    expect(takeDue(data, NOW + HOUR + 5 * MINUTE, 8, 100)).toEqual([]);
    // a rebuild in between keeps the waiting time
    rebuildQueue(data, [LIST[0]!], NOW + HOUR + 5 * MINUTE);
    expect(takeDue(data, NOW + HOUR + 6 * MINUTE, 8, 100)).toEqual([]);
    const again = takeDue(data, NOW + HOUR + 10 * MINUTE, 8, 100);
    expect(again).toHaveLength(1);
    settle(data, again[0]!, 'failed', NOW + 4 * HOUR - 5 * MINUTE); // less than ten minutes of its time are left
    expect(data.queue[0]).toMatchObject({ status: 'dropped' });
  });

  it('blocked by the carrier: the phone is noted as opted out', () => {
    const { data, q } = taken();
    settle(data, q, 'blocked', NOW + HOUR);
    expect(data.phones[0]!.optedOut).toBe(true);
    expect(data.queue[0]).toMatchObject({ status: 'dropped' });
    expect(textsThisMonth(data, NOW)).toBe(0);
  });

  it('refused by the site\'s own limit: dropped and not counted', () => {
    const { data, q } = taken();
    settle(data, q, 'refused', NOW + HOUR);
    expect(data.queue[0]).toMatchObject({ status: 'dropped' });
    expect(textsThisMonth(data, NOW)).toBe(0);
  });
});

describe('a household\'s monthly count of texts', () => {
  it('counts up to the limit and starts again each month', () => {
    const data = household();
    expect(allowText(data, 2, NOW)).toBe(true);
    expect(allowText(data, 2, NOW)).toBe(true);
    expect(allowText(data, 2, NOW)).toBe(false);
    expect(textsThisMonth(data, NOW)).toBe(2);
    refundText(data, NOW);
    expect(textsThisMonth(data, NOW)).toBe(1);
    const december = Date.UTC(2026, 11, 1, 0, 0, 1);
    expect(textsThisMonth(data, december)).toBe(0);
    refundText(data, december); // nothing to give back in a new month
    expect(allowText(data, 2, december)).toBe(true);
    expect(textsThisMonth(data, december)).toBe(1);
    expect(allowText(data, 0, december)).toBe(false);
  });
});

describe('the one text before Shabbat or Yom Tov', () => {
  // The text goes at EVE (the morning before), until START (candle lighting); after the days end (AFTER), a
  // text brings what is still of use to whoever did not get it.
  const EVE = NOW + 2 * HOUR;
  const START = NOW + 8 * HOUR;
  const AFTER = NOW + 34 * HOUR;
  const item = (key: string, kind: RestItem['kind'], at: number, end = at + HOUR): RestItem => ({
    key,
    kind,
    at,
    end,
    vars: { day: 'Shabbos', n: '2', sunset: '4:31 PM', required: '', time: '5:16 PM', notes: '' },
  });
  const HEFSEK = item('hefsek:1', 'hefsek', START + 20 * HOUR);
  const MIKVAH = item('mikvah:1', 'mikvah', START + 24 * HOUR, AFTER + 6 * HOUR);
  const LATE = item('mikvah_book:1', 'mikvah', START + 10 * HOUR, AFTER + 6 * HOUR);
  const rest = (items: RestItem[]): Reminder => ({
    key: 'rest:100',
    kind: 'rest',
    at: EVE,
    until: START,
    text: '',
    msg: { key: 'reminder.rest', vars: { rest: 'Shabbos' } },
    rest: {
      eve: { rest: 'Shabbos', style: 'plain', items },
      after: { at: AFTER, until: AFTER + 3 * HOUR, text: { rest: null, style: 'plain', items: items.filter(i => i.end > AFTER) } },
    },
  });
  const sendAll = (data: HouseholdData, now: number): string[] => {
    const taken = takeDue(data, now, 8, 100);
    for (const q of taken) settle(data, q, 'sent', now);
    return taken.map(q => `${q.key}>${q.to.slice(-1)}: ${q.text}`);
  };

  it('each phone gets one text with the lines of the kinds it gets, as one item that a refresh updates in place', () => {
    const data = household();
    rebuildQueue(data, [rest([HEFSEK])], NOW);
    expect(pending(data)).toEqual(['rest:100>1']); // B does not get the hefsek kind
    rebuildQueue(data, [rest([HEFSEK, MIKVAH])], NOW + HOUR);
    expect(pending(data)).toEqual(['rest:100>1', 'rest:100:after>1', 'rest:100>2', 'rest:100:after>2']);
    expect(data.queue.find(q => q.key === 'rest:100' && q.to === A)!.text).toBe(restText({ rest: 'Shabbos', style: 'plain', items: [HEFSEK, MIKVAH] }));
    expect(sendAll(data, EVE)).toEqual([
      'rest:100>1: Over Shabbos. Shabbos: hefsek taharah before 4:31 PM. Shabbos: mikvah night, after 5:16 PM.',
      'rest:100>2: Over Shabbos. Shabbos: mikvah night, after 5:16 PM.',
    ]);
    expect(data.queue.find(q => q.key === 'rest:100' && q.to === A)).toMatchObject({ status: 'sent', text: '', covered: ['hefsek:1', 'mikvah:1'] });
  });

  it('a refresh after it went out sends nothing again; what becomes known before the days begin goes at once, alone', () => {
    const data = household();
    rebuildQueue(data, [rest([HEFSEK, MIKVAH])], NOW);
    sendAll(data, EVE);
    // the six-hourly refresh: nothing more
    rebuildQueue(data, [rest([HEFSEK, MIKVAH])], EVE + HOUR);
    expect(sendAll(data, EVE + HOUR)).toEqual([]);
    // something recorded at noon on Friday: only it, at once, in a text of its own
    rebuildQueue(data, [rest([HEFSEK, LATE, MIKVAH])], EVE + 2 * HOUR);
    expect(sendAll(data, EVE + 2 * HOUR)).toEqual([
      'rest:100:more:1>1: Over Shabbos. Shabbos: mikvah night, after 5:16 PM.',
      'rest:100:more:1>2: Over Shabbos. Shabbos: mikvah night, after 5:16 PM.',
    ]);
    // and again: nothing
    rebuildQueue(data, [rest([HEFSEK, LATE, MIKVAH])], EVE + 3 * HOUR);
    expect(sendAll(data, EVE + 3 * HOUR)).toEqual([]);
    // after the days end: everything was brought already, so nothing
    rebuildQueue(data, [rest([HEFSEK, LATE, MIKVAH])], AFTER);
    expect(sendAll(data, AFTER)).toEqual([]);
    expect(data.queue.filter(q => q.key === 'rest:100:after').map(q => q.status)).toEqual(['dropped', 'dropped']);
    // the reminders it replaced are never sent on their own
    expect(data.queue.some(q => !q.key.startsWith('rest:'))).toBe(false);
  });

  it('known only once the days have begun: nothing during them; after they end, only what is still ahead and was not brought', () => {
    const data = household();
    rebuildQueue(data, [rest([HEFSEK])], NOW);
    sendAll(data, EVE);
    // recorded on Shabbat: nothing is sent during it
    rebuildQueue(data, [rest([HEFSEK, MIKVAH, item('bedikah:x', 'hefsek', START + 12 * HOUR)])], START + HOUR);
    expect(sendAll(data, START + 2 * HOUR)).toEqual([]);
    // after it: the mikvah night (still ahead), not the hefsek (brought, and over) nor the line whose day is over
    expect(sendAll(data, AFTER)).toEqual(['rest:100:after>1: Shabbos: mikvah night, after 5:16 PM.', 'rest:100:after>2: Shabbos: mikvah night, after 5:16 PM.']);
  });

  it('all of it known only after candle lighting: what is still ahead goes after the days', () => {
    const data = household();
    rebuildQueue(data, [rest([HEFSEK, MIKVAH])], START + HOUR);
    expect(pending(data)).toEqual(['rest:100:after>1', 'rest:100:after>2']);
    expect(sendAll(data, AFTER)).toEqual(['rest:100:after>1: Shabbos: mikvah night, after 5:16 PM.', 'rest:100:after>2: Shabbos: mikvah night, after 5:16 PM.']);
  });

  it('a text that went as two texts counts as two', () => {
    const data = household();
    rebuildQueue(data, [rest([HEFSEK])], NOW);
    const [q] = takeDue(data, EVE, 8, 100);
    settle(data, q!, 'sent', EVE, 2);
    expect(textsThisMonth(data, EVE)).toBe(2);
  });
});
