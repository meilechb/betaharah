import { describe, expect, it } from 'vitest';
import { parseDated, resolveDate } from '../src/app/chat';
import { draftFromForm } from '../src/app/dashboard';
import { whereOf } from '../src/app/household';
import { civilToAbs } from '../src/engine/civil';
import { dayTimes } from '../src/engine/zmanim';
import { at, household, NOW, Phone, TZ } from './chat-fixtures';

const abs = (y: number, m: number, d: number): number => civilToAbs({ y, m, d });

describe('reading dated record commands', () => {
  const ok: Array<[string, unknown]> = [
    ['1 11/22 day', { kind: 'ok', code: 'flow', date: { m: 11, d: 22, y: null }, when: { type: 'part', part: 'day' } }],
    ['1 11/22 night', { kind: 'ok', code: 'flow', date: { m: 11, d: 22, y: null }, when: { type: 'part', part: 'night' } }],
    ['1 11/22 n', { kind: 'ok', code: 'flow', date: { m: 11, d: 22, y: null }, when: { type: 'part', part: 'night' } }],
    ['1 11/22 D', { kind: 'ok', code: 'flow', date: { m: 11, d: 22, y: null }, when: { type: 'part', part: 'day' } }],
    ['1 nov 22 9pm', { kind: 'ok', code: 'flow', date: { m: 11, d: 22, y: null }, when: { type: 'time', minutes: 21 * 60 } }],
    ['1 November 22 9:30 PM', { kind: 'ok', code: 'flow', date: { m: 11, d: 22, y: null }, when: { type: 'time', minutes: 21 * 60 + 30 } }],
    ['5 11/20 day', { kind: 'ok', code: 'stain', date: { m: 11, d: 20, y: null }, when: { type: 'part', part: 'day' } }],
    ['3 11/28 21:15', { kind: 'ok', code: 'broken', date: { m: 11, d: 28, y: null }, when: { type: 'time', minutes: 21 * 60 + 15 } }],
    ['2 11/26', { kind: 'ok', code: 'hefsek', date: { m: 11, d: 26, y: null }, when: null }],
    ['4 12/3', { kind: 'ok', code: 'mikvah', date: { m: 12, d: 3, y: null }, when: null }],
    ['4 12/3/25', { kind: 'ok', code: 'mikvah', date: { m: 12, d: 3, y: 2025 }, when: null }],
    ['2 1/5/2026', { kind: 'ok', code: 'hefsek', date: { m: 1, d: 5, y: 2026 }, when: null }],
    ['1 sept 3 2025 night', { kind: 'ok', code: 'flow', date: { m: 9, d: 3, y: 2025 }, when: { type: 'part', part: 'night' } }],
    ['  1   11/22   day.  ', { kind: 'ok', code: 'flow', date: { m: 11, d: 22, y: null }, when: { type: 'part', part: 'day' } }],
    ['1 2/29 day', { kind: 'ok', code: 'flow', date: { m: 2, d: 29, y: null }, when: { type: 'part', part: 'day' } }],
  ];
  for (const [text, expected] of ok) it(`"${text}"`, () => expect(parseDated(text)).toEqual(expected));

  const errors: Array<[string, RegExp]> = [
    ['1 2/30 day', /no such date as 2\/30/],
    ['1 13/1 day', /no such date as 13\/1/],
    ['1 0/5 day', /no such date as 0\/5/],
    ['1 4/31 night', /no such date as 4\/31/],
    ['1 11/22', /add day, night .* or a time/],
    ['5 11/22', /add day, night/],
    ['1 11/22 day night', /add day, night/],
    ['1 11/22 yesterday', /add day, night/],
    ['1 11/22 25:00', /add day, night/],
    ['1 11/22 day 9pm', /add day, night/],
    ['2 11/26 night', /2 takes nothing more/],
    ['4 12/3 9pm', /4 takes nothing more/],
    ['1 nov day', /day of the month is missing/],
    ['1 nov', /day of the month is missing/],
    ['1 11-22 day', /Write the month and day/],
    ['1 11/22/333 day', /Write the month and day/],
    ['1 2026/11/22 day', /Write the month and day/],
    ['1 11/22/1999 day', /year 1999 is not possible/],
  ];
  for (const [text, re] of errors) {
    it(`"${text}" is not understood, and says so`, () => {
      const r = parseDated(text);
      expect(r.kind).toBe('error');
      if (r.kind === 'error') {
        expect(r.text).toMatch(re);
        expect(r.text).toMatch(/Nothing was changed\.$/);
      }
    });
  }

  for (const text of ['1', '1 day', '1 yesterday night', '9', '0', '0 11/22', '6 11/22 day', '11/22', 'hello', '1 constructor', 'nov 22', '12 11/22 day', '']) {
    it(`"${text}" is not a dated command`, () => expect(parseDated(text)).toEqual({ kind: 'none' }));
  }
});

describe('the year of a date without one', () => {
  const today = abs(2026, 11, 24);
  it('this year, when the date is not after today', () => {
    expect(resolveDate({ m: 11, d: 24, y: null }, today)).toEqual({ ok: true, abs: abs(2026, 11, 24) });
    expect(resolveDate({ m: 1, d: 1, y: null }, today)).toEqual({ ok: true, abs: abs(2026, 1, 1) });
  });
  it('last year, when this year it is still to come', () => {
    expect(resolveDate({ m: 11, d: 25, y: null }, today)).toEqual({ ok: true, abs: abs(2025, 11, 25) });
    expect(resolveDate({ m: 12, d: 31, y: null }, today)).toEqual({ ok: true, abs: abs(2025, 12, 31) });
  });
  it('across new year: in January, a December date is last December', () => {
    expect(resolveDate({ m: 12, d: 30, y: null }, abs(2027, 1, 5))).toEqual({ ok: true, abs: abs(2026, 12, 30) });
    expect(resolveDate({ m: 1, d: 5, y: null }, abs(2027, 1, 5))).toEqual({ ok: true, abs: abs(2027, 1, 5) });
  });
  it('Feb 29: only when there was one within the past year', () => {
    expect(resolveDate({ m: 2, d: 29, y: null }, today)).toEqual({ ok: false, reason: 'none_recent' });
    expect(resolveDate({ m: 2, d: 29, y: null }, abs(2028, 3, 1))).toEqual({ ok: true, abs: abs(2028, 2, 29) });
    expect(resolveDate({ m: 2, d: 29, y: null }, abs(2028, 2, 28))).toEqual({ ok: false, reason: 'none_recent' });
    expect(resolveDate({ m: 2, d: 29, y: null }, abs(2029, 1, 10))).toEqual({ ok: true, abs: abs(2028, 2, 29) });
    expect(resolveDate({ m: 2, d: 29, y: 2024 }, today)).toEqual({ ok: true, abs: abs(2024, 2, 29) });
    expect(resolveDate({ m: 2, d: 29, y: 2025 }, today)).toEqual({ ok: false, reason: 'no_such_date' });
  });
  it('a stated year in the future is refused', () => {
    expect(resolveDate({ m: 12, d: 1, y: 2026 }, today)).toEqual({ ok: false, reason: 'future' });
    expect(resolveDate({ m: 11, d: 24, y: 2026 }, today)).toEqual({ ok: true, abs: today });
  });
});

describe('recording dated commands', () => {
  it('the same entry as the dashboard form makes, for day, night and a clock time', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['1 11/22 day', { kind: 'flow', date: '2026-11-22', part: 'day' }],
      ['1 11/22 night', { kind: 'flow', date: '2026-11-22', part: 'night' }],
      ['1 11/22 9pm', { kind: 'flow', date: '2026-11-22', time: '21:00' }],
      ['1 11/22 6:30am', { kind: 'flow', date: '2026-11-22', time: '06:30' }],
      ['5 11/22 3pm', { kind: 'stain', date: '2026-11-22', time: '15:00' }],
      ['5 11/21 night', { kind: 'stain', date: '2026-11-21', part: 'night' }],
    ];
    for (const [text, form] of cases) {
      const data = household();
      const p = new Phone(data);
      const out = p.send(text);
      expect(out.changed, text).toBe(true);
      const stored = data.entries[0]!.entry;
      const { id: _id, ...rest } = stored;
      expect(rest, text).toEqual(draftFromForm(form, whereOf(data)!, NOW));
      expect(data.entries[0]!.source).toBe('sms');
    }
  });

  it('"night" is the night that begins on the evening of that date, and the reply names it that way, with the year', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('1 11/22 night')).toBe('Recorded: flow Sun Nov 22 night, 2026. Hefsek from Fri Nov 27. 0 to undo.');
    expect(data.entries[0]!.entry).toMatchObject({ kind: 'flow', onah: { abs: abs(2026, 11, 23), part: 'night' } });
  });

  it('a hefsek and an immersion by date, as the form does (4: the evening she immersed)', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('1 11/1 day')).toMatch(/^Recorded: flow Sun Nov 1 by day, 2026\./);
    expect(p.say('2 11/6')).toMatch(/^Recorded: hefsek Fri Nov 6, 2026\. Clean days Sat Nov 7 - Fri Nov 13\. Mikvah Fri Nov 13 after/);
    const before = data.entries.length;
    expect(p.say('4 11/13')).toMatch(/^Recorded: mikvah Fri Nov 13 night, 2026\./);
    expect(data.entries).toHaveLength(before + 1);
    const where = whereOf(data)!;
    const strip = (e: object) => {
      const { id: _id, ...rest } = e as { id: string };
      return rest;
    };
    expect(strip(data.entries[1]!.entry)).toEqual(draftFromForm({ kind: 'hefsek', date: '2026-11-06' }, where, NOW));
    expect(strip(data.entries[2]!.entry)).toEqual(draftFromForm({ kind: 'mikvah', date: '2026-11-13' }, where, NOW));
  });

  it('the existing validations apply, with the existing wording, and the date as read', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('2 11/20')).toBe('Not recorded: no period is open. Send 1 or 5 first. (Read as Fri Nov 20, 2026.)');
    p.say('1 11/1 day');
    expect(p.say('4 11/10')).toBe('Not recorded: no hefsek is recorded. Send 2 first. (Read as Tue Nov 10, 2026.)');
    p.say('2 11/6');
    expect(p.say('4 11/10')).toMatch(/^Not recorded: the count is not complete\. Mikvah night is Fri Nov 13 after \d+:\d\d PM\. \(Read as Tue Nov 10, 2026\.\)$/);
    expect(p.say('1 11/1 day')).toBe('Already recorded. (Read as Sun Nov 1, 2026.)');
    expect(p.say('2 10/30')).toBe('Not recorded: no period is open. Send 1 or 5 first. (Read as Fri Oct 30, 2026.)');
    expect(data.entries).toHaveLength(2);
  });

  it('a date this year that is still to come is read as last year, and the reply says so', () => {
    const p = new Phone(household());
    expect(p.say('2 11/27')).toBe('Not recorded: no period is open. Send 1 or 5 first. (Read as Thu Nov 27, 2025.)');
    expect(p.say('1 11/30 day')).toBe('Recorded: flow Sun Nov 30 by day, 2025. Hefsek from Thu Dec 4. 0 to undo.');
  });

  it('never records a time that has not come', () => {
    const data = household();
    const morning = at(2026, 11, 24, 9);
    const p = new Phone(data, morning);
    expect(p.say('1 11/24 night')).toBe('Not recorded: that time has not come yet. (Read as Tue Nov 24, 2026.)');
    expect(p.say('1 11/24 3pm')).toBe('Not recorded: that time has not come yet.');
    expect(p.say('1 11/24/2026 day')).toMatch(/^Recorded: flow Tue Nov 24 by day, 2026\./); // the day onah has begun
    expect(p.say('2 12/1/2026')).toBe('Not recorded: that time has not come yet.');
    expect(p.say('4 11/24')).toMatch(/^Not recorded: that time has not come yet\./);
    expect(data.entries).toHaveLength(1);
  });

  it('Feb 29 and impossible dates change nothing', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('1 2/29 day')).toBe('Not understood: there was no Feb 29 in the past year. Add the year, e.g. 2/29/2024. Nothing was changed.');
    expect(p.say('1 2/29/2025 day')).toBe('Not understood: there is no such date. Nothing was changed.');
    expect(p.say('1 2/30 day')).toMatch(/no such date as 2\/30/);
    expect(p.say('1 2/29/2024 day')).toMatch(/^Recorded: flow Thu Feb 29 by day, 2024\./);
    expect(data.entries).toHaveLength(1);
  });

  it('a time shortly after sunset is counted as night, and the reply says how to change it', () => {
    const data = household();
    const p = new Phone(data);
    const sunset = dayTimes(abs(2026, 11, 22), whereOf(data)!.place, whereOf(data)!.zopts).sunset;
    const after = new Date(sunset + 10 * 60_000).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
    const typed = after.replace(' ', '').toLowerCase();
    const text = p.say(`1 11/22 ${typed}`);
    expect(text).toMatch(/^Recorded: flow Sun Nov 22 night, 2026\..* Counted as night \(sunset was \d+:\d\d PM\)\. If it began before sunset send 0, then the same with: day\. If unsure ask a rav\.$/);
  });

  it('0 undoes a dated entry like any other', () => {
    const data = household();
    const p = new Phone(data);
    p.say('1 11/22 night');
    expect(p.say('0')).toMatch(/^Removed: flow Sun Nov 22 night\./);
    expect(data.entries).toHaveLength(0);
  });

  it('no location yet: says how to set it by text', () => {
    const p = new Phone(household({ place: false }));
    expect(p.say('1 11/22 night')).toBe('Not recorded: no location is set yet. Text LOCATION and your ZIP code, e.g. LOCATION 08701, or choose it on the website.');
    expect(p.say('1')).toBe('Not recorded: no location is set yet. Text LOCATION and your ZIP code, e.g. LOCATION 08701, or choose it on the website.');
    expect(p.say('9')).toBe('No location is set yet. Text LOCATION and your ZIP code, e.g. LOCATION 08701, or choose it on the website.');
  });

  it('a phone that may not record cannot record by date either', () => {
    const data = household();
    data.phones[0]!.canUpdate = false;
    const p = new Phone(data);
    for (const t of ['1 11/22 night', '1', '2', '0', 'UNDO']) expect(p.say(t), t).toBe('This phone may not record entries. That is changed on the website, under Settings.');
    expect(data.entries).toHaveLength(0);
    expect(p.say('9')).toMatch(/^Tehorah\./);
  });
});
