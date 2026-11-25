import { describe, expect, it } from 'vitest';
import { parseDated, resolveDate } from '../src/app/chat';
import type { DatedKind } from '../src/app/chat/dated';
import { draftFromForm } from '../src/app/dashboard';
import { whereOf } from '../src/app/household';
import { civilToAbs } from '../src/engine/civil';
import { dayTimes } from '../src/engine/zmanim';
import { at, household, NOW, Phone, TZ } from './chat-fixtures';

const abs = (y: number, m: number, d: number): number => civilToAbs({ y, m, d });
const parse = (kind: DatedKind, text: string) => parseDated(kind, text.trim().split(/\s+/).map(t => t.replace(/[.,]$/, '')));

describe('reading a date and what follows it', () => {
  const ok: Array<[DatedKind, string, unknown]> = [
    ['flow', '11/22 day', { kind: 'ok', code: 'flow', date: { m: 11, d: 22, y: null }, when: { type: 'part', part: 'day' } }],
    ['flow', '11/22 night', { kind: 'ok', code: 'flow', date: { m: 11, d: 22, y: null }, when: { type: 'part', part: 'night' } }],
    ['flow', '11/22 n', { kind: 'ok', code: 'flow', date: { m: 11, d: 22, y: null }, when: { type: 'part', part: 'night' } }],
    ['flow', '11/22 by day', { kind: 'ok', code: 'flow', date: { m: 11, d: 22, y: null }, when: { type: 'part', part: 'day' } }],
    ['flow', 'nov 22 9pm', { kind: 'ok', code: 'flow', date: { m: 11, d: 22, y: null }, when: { type: 'time', minutes: 21 * 60 } }],
    ['flow', 'November 22 9:30 PM', { kind: 'ok', code: 'flow', date: { m: 11, d: 22, y: null }, when: { type: 'time', minutes: 21 * 60 + 30 } }],
    ['stain', '11/20 day', { kind: 'ok', code: 'stain', date: { m: 11, d: 20, y: null }, when: { type: 'part', part: 'day' } }],
    ['broken', '11/28 21:15', { kind: 'ok', code: 'broken', date: { m: 11, d: 28, y: null }, when: { type: 'time', minutes: 21 * 60 + 15 } }],
    ['hefsek', '11/26', { kind: 'ok', code: 'hefsek', date: { m: 11, d: 26, y: null }, when: null }],
    ['mikvah', '12/3', { kind: 'ok', code: 'mikvah', date: { m: 12, d: 3, y: null }, when: null }],
    ['mikvah', '12/3/25', { kind: 'ok', code: 'mikvah', date: { m: 12, d: 3, y: 2025 }, when: null }],
    ['hefsek', '1/5/2026', { kind: 'ok', code: 'hefsek', date: { m: 1, d: 5, y: 2026 }, when: null }],
    ['flow', 'sept 3 2025 night', { kind: 'ok', code: 'flow', date: { m: 9, d: 3, y: 2025 }, when: { type: 'part', part: 'night' } }],
    ['flow', '2/29 day', { kind: 'ok', code: 'flow', date: { m: 2, d: 29, y: null }, when: { type: 'part', part: 'day' } }],
  ];
  for (const [kind, text, expected] of ok) it(`${kind} "${text}"`, () => expect(parse(kind, text)).toEqual(expected));

  const errors: Array<[DatedKind, string, string, Record<string, string>?]> = [
    ['flow', '2/30 day', 'date.no_such', { date: '2/30' }],
    ['flow', '13/1 day', 'date.no_such', { date: '13/1' }],
    ['flow', '0/5 day', 'date.no_such', { date: '0/5' }],
    ['flow', '4/31 night', 'date.no_such', { date: '4/31' }],
    ['flow', '11/22', 'date.needs_onah'],
    ['stain', '11/22', 'date.needs_onah'],
    ['flow', '11/22 day night', 'date.needs_onah'],
    ['flow', '11/22 yesterday', 'date.needs_onah'],
    ['flow', '11/22 25:00', 'date.needs_onah'],
    ['flow', '11/22 day 9pm', 'date.needs_onah'],
    ['hefsek', '11/26 night', 'date.nothing_more'],
    ['mikvah', '12/3 9pm', 'date.nothing_more'],
    ['flow', 'nov day', 'date.form'],
    ['flow', 'nov', 'date.form'],
    ['flow', '11-22 day', 'date.form'],
    ['flow', '11/22/333 day', 'date.form'],
    ['flow', '2026/11/22 day', 'date.form'],
    ['flow', '11/22/1999 day', 'date.year', { year: '1999' }],
  ];
  for (const [kind, text, key, vars] of errors) {
    it(`${kind} "${text}" is not understood, and says why`, () => {
      const r = parse(kind, text);
      expect(r.kind).toBe('error');
      if (r.kind === 'error') {
        expect(r.problem.key).toBe(key);
        if (vars) expect('vars' in r.problem ? r.problem.vars : null).toEqual(vars);
      }
    });
  }

  for (const text of ['day', 'yesterday night', '9', 'hello', 'constructor', '22', '']) {
    it(`"${text}" is not a date`, () => expect(parse('flow', text)).toEqual({ kind: 'none' }));
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

describe('recording with a date, by words and by ANOTHER DAY', () => {
  it('the same entry as the dashboard form makes, for day, night and a clock time', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['period 11/22 day', { kind: 'flow', date: '2026-11-22', part: 'day' }],
      ['period 11/22 night', { kind: 'flow', date: '2026-11-22', part: 'night' }],
      ['flow 11/22 9pm', { kind: 'flow', date: '2026-11-22', time: '21:00' }],
      ['period Nov 22 6:30am', { kind: 'flow', date: '2026-11-22', time: '06:30' }],
      ['stain 11/22 3pm', { kind: 'stain', date: '2026-11-22', time: '15:00' }],
      ['stain 11/21 night', { kind: 'stain', date: '2026-11-21', part: 'night' }],
    ];
    for (const [text, form] of cases) {
      const data = household();
      const p = new Phone(data);
      const out = p.send(text);
      expect(out.changed, text).toBe(true);
      const { id: _id, ...rest } = data.entries[0]!.entry;
      expect(rest, text).toEqual(draftFromForm(form, whereOf(data)!, NOW));
      expect(data.entries[0]!.source).toBe('sms');
    }
  });

  it('ANOTHER DAY asks for the date; the date then records', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('period')).toBe('When did it begin?');
    expect(p.options()).toEqual(['NOW', 'LAST NIGHT', 'ANOTHER DAY']);
    expect(p.say('another day')).toBe('Which date, and day or night? For example: Nov 22 night.');
    expect(p.options()).toEqual(['MENU']);
    expect(p.say('Nov 22 night')).toBe('Recorded: flow Sun night, Nov 22, 2026. Hefsek from Fri.');
    expect(p.options()).toEqual(['UNDO', 'STATUS']);
    expect(data.entries[0]!.entry).toMatchObject({ kind: 'flow', onah: { abs: abs(2026, 11, 23), part: 'night' } });
  });

  it('a hefsek and an immersion by date, as the form does (the immersion: the evening she immersed)', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('period 11/1 day')).toMatch(/^Recorded: flow Sun, Nov 1, 2026 by day\./);
    expect(p.say('hefsek 11/6')).toMatch(/^Recorded: hefsek Fri, Nov 6, 2026\. Clean days from Shabbos, Nov 7\. Mikvah Fri night, Nov 13 after/);
    p.send('MORE');
    p.send('OTHER ENTRIES');
    expect(p.say('IMMERSION')).toBe('Immersion: which night?');
    p.send('ANOTHER DAY');
    expect(p.say('11/13')).toMatch(/^Recorded: mikvah Fri night, Nov 13, 2026\./);
    const where = whereOf(data)!;
    const strip = (e: object) => {
      const { id: _id, ...rest } = e as { id: string };
      return rest;
    };
    expect(strip(data.entries[1]!.entry)).toEqual(draftFromForm({ kind: 'hefsek', date: '2026-11-06' }, where, NOW));
    expect(strip(data.entries[2]!.entry)).toEqual(draftFromForm({ kind: 'mikvah', date: '2026-11-13' }, where, NOW));
  });

  it('the existing validations apply, and the date as read is added', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('hefsek 11/20')).toBe('Not recorded: no period is open. (Read as Fri, Nov 20, 2026.)');
    p.say('period 11/1 day');
    p.send('MORE');
    p.send('OTHER ENTRIES');
    p.send('IMMERSION');
    p.send('ANOTHER DAY');
    expect(p.say('11/10')).toBe('Not recorded: no hefsek is recorded. (Read as Tue, Nov 10, 2026.)');
    p.say('hefsek 11/6');
    p.send('MORE');
    p.send('OTHER ENTRIES');
    p.send('IMMERSION');
    p.send('ANOTHER DAY');
    expect(p.say('11/10')).toMatch(/^Not recorded: the count is not complete\. Mikvah night is Fri night, Nov 13 after \d+:\d\d PM\. \(Read as Tue, Nov 10, 2026\.\)$/);
    expect(p.say('period 11/1 day')).toBe('Already recorded. (Read as Sun, Nov 1, 2026.)');
    expect(data.entries).toHaveLength(2);
  });

  it('a date this year that is still to come is read as last year, and the reply says so', () => {
    const p = new Phone(household());
    expect(p.say('hefsek 11/27')).toBe('Not recorded: no period is open. (Read as Thu, Nov 27, 2025.)');
    expect(p.say('period 11/30 day')).toBe('Recorded: flow Sun, Nov 30, 2025 by day. Hefsek from Thu, Dec 4.');
  });

  it('never records a time that has not come', () => {
    const data = household();
    const morning = at(2026, 11, 24, 9);
    const p = new Phone(data, morning);
    expect(p.say('period 11/24 night')).toBe('Not recorded: that time has not come yet. (Read as Tue, Nov 24, 2026.)');
    expect(p.say('period 11/24 3pm')).toBe('Not recorded: that time has not come yet.');
    expect(p.say('period 11/24/2026 day')).toMatch(/^Recorded: flow Tue, Nov 24, 2026 by day\./); // the day onah has begun
    expect(p.say('hefsek 12/1/2026')).toBe('Not recorded: that time has not come yet.');
    expect(data.entries).toHaveLength(1);
  });

  it('Feb 29 and impossible dates change nothing', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('period 2/29 day')).toBe('There was no Feb 29 in the past year. With the year it works, e.g. 2/29/2024. Nothing was changed.');
    expect(p.say('period 2/29/2025 day')).toBe('There is no date 2/29/2025. Nothing was changed.');
    expect(p.say('period 2/30 day')).toBe('There is no date 2/30. Nothing was changed.');
    expect(p.say('period 2/29/2024 day')).toMatch(/^Recorded: flow Thu, Feb 29, 2024 by day\./);
    expect(data.entries).toHaveLength(1);
  });

  it('a time shortly after sunset is counted as night, and the reply says so (information only)', () => {
    const data = household();
    const p = new Phone(data);
    const sunset = dayTimes(abs(2026, 11, 22), whereOf(data)!.place, whereOf(data)!.zopts).sunset;
    const after = new Date(sunset + 10 * 60_000).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
    const typed = after.replace(' ', '').toLowerCase();
    expect(p.say(`period 11/22 ${typed}`)).toMatch(/^Recorded: flow Sun night, Nov 22, 2026\..* Counted as night: sunset was \d+:\d\d PM\.$/);
  });

  it('UNDO undoes a dated entry like any other', () => {
    const data = household();
    const p = new Phone(data);
    p.say('period 11/22 night');
    expect(p.say('UNDO')).toMatch(/^Removed: flow Sun night, Nov 22\./);
    expect(data.entries).toHaveLength(0);
  });

  it('no location yet: says so, with LOCATION as an option', () => {
    const p = new Phone(household({ place: false }));
    expect(p.say('period 11/22 night')).toBe('Not recorded: no location is set yet.');
    expect(p.options()).toEqual(['LOCATION', 'MENU']);
    expect(p.say('period')).toBe('Not recorded: no location is set yet.');
    expect(p.say('status')).toBe('No location is set yet.');
  });

  it('a phone that may not record cannot record by date either', () => {
    const data = household();
    data.phones[0]!.canUpdate = false;
    const p = new Phone(data);
    for (const t of ['period 11/22 night', 'period', 'hefsek', 'undo']) expect(p.say(t), t).toBe('This phone may not record entries. That is set on the website.');
    expect(data.entries).toHaveLength(0);
    expect(p.say('status')).toMatch(/^Tehorah\./);
  });
});
