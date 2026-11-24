import { describe, expect, it } from 'vitest';
import { newHousehold, type HouseholdData } from '../src/app/model';
import { allowText, nextWake, rebuildQueue, refundText, RETRY_MS, SENDING_TIMEOUT_MS, settle, takeDue, textsThisMonth } from '../src/app/queue';
import type { Reminder } from '../src/engine/present';

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

const reminder = (key: string, kind: Reminder['kind'], at: number, until = at + 3 * HOUR): Reminder => ({ key, kind, at, until, text: `text of ${key}` });
const LIST = [reminder('hefsek:1', 'hefsek', NOW + HOUR), reminder('mikvah:1', 'mikvah', NOW + 2 * DAY)];
const pending = (data: HouseholdData): string[] => data.queue.filter(q => q.status === 'pending').map(q => `${q.key}>${q.to.slice(-1)}`);

describe('building the list of waiting reminders', () => {
  it('each phone gets the kinds it chose, if it agreed to texts', () => {
    const data = household();
    rebuildQueue(data, LIST, NOW);
    expect(pending(data)).toEqual(['hefsek:1>1', 'mikvah:1>1', 'mikvah:1>2']);
    expect(data.queue[0]).toEqual({ key: 'hefsek:1', to: A, at: NOW + HOUR, until: NOW + 4 * HOUR, text: 'text of hefsek:1', status: 'pending', notBefore: 0, doneAt: null });
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
