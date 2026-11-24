import { describe, expect, it } from 'vitest';
import { civilToAbs, localDateTime, localToInstant } from '../src/engine/civil';
import type { LogEntry } from '../src/engine/cycle';
import { isRestDay } from '../src/engine/holidays';
import {
  DEFAULT_REMINDER_OPTIONS,
  buildReminders,
  clock12,
  clock24,
  englishDate,
  moveAfterRestDay,
  moveBeforeRestDay,
  reasonsEnglish,
  restDayAt,
  statusText,
  type ReminderContext,
} from '../src/engine/present';
import { DEFAULT_HALACHIC_SETTINGS } from '../src/engine/settings';
import type { GeoPoint } from '../src/engine/sun';
import { buildTimeline } from '../src/engine/timeline';
import { dayTimes } from '../src/engine/zmanim';
import { BASIC, M, hd, withSettings } from './helpers';

const LAKEWOOD: GeoPoint = { latitude: 40.0821, longitude: -74.2097, timeZone: 'America/New_York', elevation: 16 };
const TZ = LAKEWOOD.timeZone;
const ZOPTS = { useElevation: false, tzeit: BASIC.tzeit };
const CTX: ReminderContext = { place: LAKEWOOD, zopts: ZOPTS, yomTov: 'diaspora' };
const at = (y: number, m: number, d: number, hh: number, mi = 0): number => localToInstant({ y, m, d, hh, mi, ss: 0 }, TZ);
const SUN = civilToAbs({ y: 2026, m: 11, d: 22 });
const SAT = SUN + 6;

const timeline = (entries: LogEntry[], now: number, patch = {}) =>
  buildTimeline({ entries, settings: withSettings(patch), place: LAKEWOOD, useElevation: false, now });

const flow: LogEntry = { id: 'f', kind: 'flow', onah: { abs: SUN, part: 'day' }, veset: true };
const hefsek: LogEntry = { id: 'h', kind: 'hefsek', abs: SUN + 4 };

describe('formatting', () => {
  it('rounds a deadline down and a start time up', () => {
    const t = at(2026, 11, 26, 16, 33) + 40_000; // 4:33:40 PM
    expect(clock12(t, TZ, 'floor')).toBe('4:33 PM');
    expect(clock12(t, TZ, 'ceil')).toBe('4:34 PM');
    expect(clock24(t, TZ, 'floor')).toBe('16:33');
    expect(clock24(t, TZ, 'ceil')).toBe('16:34');
    expect(clock12(at(2026, 11, 26, 0, 5), TZ, 'floor')).toBe('12:05 AM');
    expect(clock12(at(2026, 11, 26, 12, 0), TZ, 'ceil')).toBe('12:00 PM');
  });

  it('writes dates in English for text messages', () => {
    expect(englishDate(SUN)).toBe('Sun Nov 22');
    expect(englishDate(SUN + 11)).toBe('Thu Dec 3');
  });

  it('summarises reasons briefly for a text message', () => {
    expect(
      reasonsEnglish([
        { kind: 'or_zarua', of: { kind: 'beinonit', day: 30 } },
        { kind: 'beinonit', day: 30 },
        { kind: 'full_day', of: { kind: 'beinonit', day: 30 } },
        { kind: 'chodesh', rule: 'same_date', dayOfMonth: 12 },
        { kind: 'haflagah', unit: 'days', length: 28, latest: true },
      ]),
    ).toBe('day 30, chodesh, haflagah 28d');
    const many = [27, 28, 29, 31, 33, 35].map(length => ({ kind: 'haflagah' as const, unit: 'onot' as const, length, latest: false }));
    expect(reasonsEnglish(many)).toBe('haflagah 27 onot, haflagah 28 onot, haflagah 29 onot, haflagah 31 onot +2 more');
  });
});

describe('Shabbat and Yom Tov for reminders', () => {
  it('knows when it is Shabbat: from candle lighting on Friday until nightfall on Saturday', () => {
    const friday = dayTimes(SAT - 1, LAKEWOOD, ZOPTS);
    const saturday = dayTimes(SAT, LAKEWOOD, ZOPTS);
    expect(restDayAt(friday.sunset - 19 * 60_000, CTX)).toBeNull();
    expect(restDayAt(friday.sunset - 17 * 60_000, CTX)).toBe(SAT);
    expect(restDayAt(at(2026, 11, 28, 2), CTX)).toBe(SAT);
    expect(restDayAt(at(2026, 11, 28, 12), CTX)).toBe(SAT);
    expect(restDayAt(saturday.sunset + 60_000, CTX)).toBe(SAT);
    expect(restDayAt(saturday.tzeit - 1, CTX)).toBe(SAT);
    expect(restDayAt(saturday.tzeit, CTX)).toBeNull();
    expect(restDayAt(at(2026, 11, 29, 9), CTX)).toBeNull();
  });

  it('moves a time on Shabbat to Friday afternoon, or to Saturday night', () => {
    const friday = dayTimes(SAT - 1, LAKEWOOD, ZOPTS);
    const saturday = dayTimes(SAT, LAKEWOOD, ZOPTS);
    const noon = at(2026, 11, 28, 12);
    expect(moveBeforeRestDay(noon, CTX)).toBe(friday.sunset - 108 * 60_000);
    expect(moveAfterRestDay(noon, CTX)).toBe(saturday.tzeit + 45 * 60_000);
    const weekday = at(2026, 11, 25, 12);
    expect(moveBeforeRestDay(weekday, CTX)).toBe(weekday);
    expect(moveAfterRestDay(weekday, CTX)).toBe(weekday);
  });

  it('treats Yom Tov running into Shabbat as one stretch', () => {
    // Rosh Hashanah 5788 is Saturday and Sunday, 2-3 October 2027.
    const rh1 = hd(1, M.TISHREI, 5788);
    expect(isRestDay(rh1, 'diaspora') && isRestDay(rh1 + 1, 'diaspora') && !isRestDay(rh1 + 2, 'diaspora')).toBe(true);
    const sundayNoon = localToInstant({ y: 2027, m: 10, d: 3, hh: 12, mi: 0, ss: 0 }, TZ);
    const before = moveBeforeRestDay(sundayNoon, CTX);
    expect(localDateTime(before, TZ)).toMatchObject({ y: 2027, m: 10, d: 1 }); // Friday
    const after = moveAfterRestDay(localToInstant({ y: 2027, m: 10, d: 2, hh: 12, mi: 0, ss: 0 }, TZ), CTX);
    expect(localDateTime(after, TZ)).toMatchObject({ y: 2027, m: 10, d: 3 }); // Sunday night
    expect(after).toBeGreaterThan(dayTimes(rh1 + 1, LAKEWOOD, ZOPTS).tzeit);
  });
});

describe('reminders', () => {
  const reminders = (entries: LogEntry[], now: number, opts = DEFAULT_REMINDER_OPTIONS, patch = {}) =>
    buildReminders(timeline(entries, now, patch), opts, CTX);

  it('before the hefsek: one reminder, two hours before sunset on the day it can be done', () => {
    const r = reminders([flow], at(2026, 11, 23, 10)).filter(x => x.kind === 'hefsek');
    expect(r).toHaveLength(1);
    expect(r[0]!.key).toBe(`hefsek:f:${SUN + 4}`);
    expect(r[0]!.at).toBe(dayTimes(SUN + 4, LAKEWOOD, ZOPTS).sunset - 120 * 60_000);
    expect(r[0]!.text).toMatch(/^Hefsek tahara: Thu Nov 26, before sunset at 4:3\d PM\. Reply 2 when done\.$/);
  });

  it('each later day gets its own hefsek reminder, up to the limit', () => {
    const fri = reminders([flow], at(2026, 11, 27, 9)).filter(x => x.kind === 'hefsek');
    expect(fri[0]!.key).toBe(`hefsek:f:${SUN + 5}`);
    expect(fri[0]!.text).toContain('Before candle lighting if possible.');
    const late = reminders([flow], at(2026, 12, 10, 9)).filter(x => x.kind === 'hefsek');
    expect(late).toEqual([]);
  });

  it('during the count: bedikah reminders for each day, booking the mikvah, and the immersion night', () => {
    const r = reminders([flow, hefsek], at(2026, 11, 26, 18));
    expect(r.filter(x => x.kind === 'hefsek')).toEqual([]);
    const mornings = r.filter(x => x.kind === 'bedikah_morning');
    expect(mornings).toHaveLength(7);
    expect(mornings[0]!.text).toMatch(/^Clean day 1 of 7 is Fri Nov 27: bedikah in the morning and again before sunset at 4:3\d PM\. Required on this day\.$/);
    expect(mornings[2]!.text).not.toContain('Required');
    expect(mornings[6]!.text).toContain('Required on this day.');
    const mikvah = r.filter(x => x.kind === 'mikvah');
    expect(mikvah).toHaveLength(1);
    expect(mikvah[0]!.text).toMatch(/^Mikvah night: Thu Dec 3, after 5:\d\d PM\.$/);
    expect(mikvah[0]!.at).toBe(dayTimes(SUN + 11, LAKEWOOD, ZOPTS).sunset - 180 * 60_000);
    // the morning after the hefsek (recorded on its day): Friday 27 November at 9:00
    const book = r.filter(x => x.kind === 'mikvah_book');
    expect(book).toHaveLength(1);
    expect(book[0]!.key).toBe(`mikvah_book:f:${SUN + 4}`);
    expect(book[0]!.text).toMatch(/^Book the mikvah: mikvah night is Thu Dec 3, after 5:\d\d PM\.$/);
    expect(localDateTime(book[0]!.at, TZ)).toMatchObject({ m: 11, d: 27, hh: 9, mi: 0 });
    // nothing asks whether she immersed
    for (const x of r) expect(x.text).not.toMatch(/Reply 4|immersed|recorded/);
  });

  it('booking the mikvah: the morning after the day the hefsek was recorded, at the chosen time, in both wordings', () => {
    const tl = timeline([flow, hefsek], at(2026, 11, 26, 18));
    // recorded two days late, on Saturday night: the reminder is on Sunday morning
    const late: ReminderContext = { ...CTX, recordedAt: id => (id === 'h' ? at(2026, 11, 28, 20) : undefined) };
    const opts = { ...DEFAULT_REMINDER_OPTIONS, mikvahBook: { on: true, hour: 10, minute: 30 } };
    const plain = buildReminders(tl, opts, late).filter(x => x.kind === 'mikvah_book');
    expect(plain).toHaveLength(1);
    expect(localDateTime(plain[0]!.at, TZ)).toMatchObject({ m: 11, d: 29, hh: 10, mi: 30 });
    const discreet = buildReminders(tl, { ...opts, style: 'discreet' }, late).find(x => x.kind === 'mikvah_book')!;
    expect(discreet.text).toMatch(/^Book M: Thu Dec 3 after 5:\d\d PM\.$/);
    expect(discreet.key).toBe(plain[0]!.key);
    for (const text of [plain[0]!.text, discreet.text]) {
      expect(text).toMatch(/^[A-Za-z0-9 .,:]+$/);
      expect(text.length).toBeLessThan(70);
    }
  });

  it('booking the mikvah: nothing when the hefsek is recorded so late that the mikvah night is that day or past', () => {
    // the mikvah night is the evening of Thursday 3 December
    const onTheDay = (recorded: number) => {
      const ctx: ReminderContext = { ...CTX, recordedAt: () => recorded };
      return buildReminders(timeline([flow, hefsek], recorded), DEFAULT_REMINDER_OPTIONS, ctx).filter(x => x.kind === 'mikvah_book');
    };
    expect(onTheDay(at(2026, 12, 1, 20))).toHaveLength(1); // the next morning is Wednesday 2 December
    expect(onTheDay(at(2026, 12, 2, 20))).toEqual([]); // the next morning would be the day of the mikvah night
    expect(onTheDay(at(2026, 12, 3, 12))).toEqual([]);
  });

  it('booking the mikvah: removed when the count is cancelled, and not without a hefsek', () => {
    expect(reminders([flow], at(2026, 11, 23, 10)).filter(x => x.kind === 'mikvah_book')).toEqual([]);
    const cancelled = reminders([flow, hefsek, { id: 'f2', kind: 'flow', onah: { abs: SUN + 6, part: 'day' }, veset: true }], at(2026, 11, 28, 18));
    expect(cancelled.filter(x => x.kind === 'mikvah_book')).toEqual([]);
  });

  it('booking the mikvah: a morning on Shabbat waits until after it', () => {
    // hefsek on Friday 27 November, recorded that day: Shabbat morning is held until Saturday night
    const r = reminders([flow, { id: 'h', kind: 'hefsek', abs: SUN + 5 }], at(2026, 11, 27, 17));
    const book = r.find(x => x.kind === 'mikvah_book')!;
    expect(book.at).toBeGreaterThan(dayTimes(SAT, LAKEWOOD, ZOPTS).tzeit);
    expect(localDateTime(book.at, TZ)).toMatchObject({ m: 11, d: 28 });
    expect(restDayAt(book.at, CTX)).toBeNull();
  });

  it('the clean day that falls on Shabbat is announced on Friday, and its afternoon reminder is left out', () => {
    const r = reminders([flow, hefsek], at(2026, 11, 26, 18));
    const day2 = r.find(x => x.key === `bedikah_am:f:${SUN + 4}:2`)!; // Saturday 28 November
    expect(day2.text).toContain('Clean day 2 of 7 is Sat Nov 28');
    expect(localDateTime(day2.at, TZ)).toMatchObject({ m: 11, d: 27 });
    expect(day2.at).toBeLessThan(dayTimes(SAT - 1, LAKEWOOD, ZOPTS).sunset - 18 * 60_000);
    expect(r.find(x => x.key === `bedikah_pm:f:${SUN + 4}:2`)).toBeUndefined();
    // Friday's own afternoon reminder is before candle lighting and stays
    expect(r.find(x => x.key === `bedikah_pm:f:${SUN + 4}:1`)).toBeDefined();
    expect(r.filter(x => x.kind === 'bedikah_afternoon')).toHaveLength(6);
  });

  it('with the option off, reminders keep their own times on Shabbat', () => {
    const r = reminders([flow, hefsek], at(2026, 11, 26, 18), { ...DEFAULT_REMINDER_OPTIONS, beforeRestDays: false });
    expect(localDateTime(r.find(x => x.key === `bedikah_am:f:${SUN + 4}:2`)!.at, TZ)).toMatchObject({ d: 28, hh: 8 });
    expect(r.filter(x => x.kind === 'bedikah_afternoon')).toHaveLength(7);
  });

  it('a Saturday-night immersion is announced on Friday', () => {
    const r = reminders([flow, { id: 'h', kind: 'hefsek', abs: SUN + 6 }], at(2026, 11, 30, 10));
    const m = r.find(x => x.kind === 'mikvah')!;
    expect(m.text).toContain('Mikvah night: Sat Dec 5');
    expect(m.text).toContain('after Shabbat or Yom Tov');
    expect(localDateTime(m.at, TZ)).toMatchObject({ m: 12, d: 4 });
  });

  it('a Friday-night immersion is announced before Shabbat, with a note to prepare', () => {
    const r = reminders([flow, { id: 'h', kind: 'hefsek', abs: SUN + 5 }], at(2026, 11, 30, 10));
    const m = r.find(x => x.kind === 'mikvah')!;
    expect(m.text).toContain('Shabbat or Yom Tov night, prepare before');
    expect(localDateTime(m.at, TZ)).toMatchObject({ m: 12, d: 4 });
  });

  it('consecutive onot are announced once, with the whole stretch', () => {
    const strict = { orZarua: 'yes', beinonitLength: 'full', beinonitDays: '30_31' } as const;
    const r = reminders([flow, hefsek, { id: 'm', kind: 'mikvah', abs: SUN + 12 }], at(2026, 12, 10, 10), DEFAULT_REMINDER_OPTIONS, strict)
      .filter(x => x.kind === 'onah');
    // night and day of day 30, night and day of day 31 (which is also the 12th of Tevet): one stretch
    expect(r).toHaveLength(1);
    expect(r[0]!.text).toMatch(/^Onah: 4:3\d PM Sun Dec 20 until 4:3\d PM Tue Dec 22\./);
    expect(r[0]!.text).toContain('day 30, day 31, chodesh.');
    expect(r[0]!.text).toContain('Bedikah.');
    expect(r[0]!.at).toBe(dayTimes(SUN + 28, LAKEWOOD, ZOPTS).sunset - 120 * 60_000);
  });

  it('past onot are not announced', () => {
    const r = reminders([flow, hefsek, { id: 'm', kind: 'mikvah', abs: SUN + 12 }], at(2027, 1, 15, 10));
    expect(r.filter(x => x.kind === 'onah')).toEqual([]);
  });

  it('every kind can be switched off', () => {
    const off = {
      ...DEFAULT_REMINDER_OPTIONS,
      hefsek: { ...DEFAULT_REMINDER_OPTIONS.hefsek, on: false },
      bedikot: { ...DEFAULT_REMINDER_OPTIONS.bedikot, on: false },
      mikvah: { ...DEFAULT_REMINDER_OPTIONS.mikvah, on: false },
      mikvahBook: { ...DEFAULT_REMINDER_OPTIONS.mikvahBook, on: false },
      onah: { ...DEFAULT_REMINDER_OPTIONS.onah, on: false },
    };
    expect(reminders([flow], at(2026, 11, 23, 10), off)).toEqual([]);
    expect(reminders([flow, hefsek], at(2026, 11, 27, 10), off)).toEqual([]);
  });

  it('every text fits one SMS in the basic character set, in both styles, across a year of cases', () => {
    const basic = /^[A-Za-z0-9 .,:;()\-\/?!']+$/;
    let checked = 0;
    for (const style of ['plain', 'discreet'] as const) {
      for (let offset = 0; offset < 365; offset += 3) {
        const start = SUN + offset;
        const entries: LogEntry[] = [
          { id: 'p', kind: 'flow', onah: { abs: start - 31, part: 'night' }, veset: true },
          { id: 'f', kind: 'flow', onah: { abs: start, part: offset % 2 ? 'night' : 'day' }, veset: true },
        ];
        const civil = localToInstant({ ...{ y: 2026, m: 11, d: 22 }, hh: 12, mi: 0, ss: 0 }, TZ) + offset * 86_400_000;
        for (const withHefsek of [false, true]) {
          const all = withHefsek ? [...entries, { id: 'h', kind: 'hefsek', abs: start + 4 } as LogEntry] : entries;
          const t = buildTimeline({ entries: all, settings: DEFAULT_HALACHIC_SETTINGS, place: LAKEWOOD, useElevation: false, now: civil + 86_400_000 });
          for (const r of buildReminders(t, { ...DEFAULT_REMINDER_OPTIONS, style }, CTX)) {
            expect(r.text, r.text).toMatch(basic);
            expect(r.text.length, r.text).toBeLessThanOrEqual(160);
            checked++;
          }
          expect(statusText(t, TZ)).toMatch(basic);
          expect(statusText(t, TZ).length).toBeLessThanOrEqual(160);
        }
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it('each reminder stops being worth sending three hours after its time, or at the next candle lighting if that is sooner', () => {
    const r = reminders([flow, hefsek], at(2026, 11, 26, 18));
    const monday = r.find(x => x.key === `bedikah_am:f:${SUN + 4}:4`)!; // Monday 30 November, 8:00
    expect(localDateTime(monday.at, TZ)).toMatchObject({ m: 11, d: 30, hh: 8 });
    expect(monday.until).toBe(monday.at + 3 * 3_600_000);
    // Friday's afternoon reminder is 90 minutes before sunset; candle lighting, 18 minutes before sunset, ends it.
    const friday = r.find(x => x.key === `bedikah_pm:f:${SUN + 4}:1`)!;
    expect(friday.until).toBe(dayTimes(SAT - 1, LAKEWOOD, ZOPTS).sunset - 18 * 60_000);
    expect(friday.until - friday.at).toBe(72 * 60_000);
    for (const x of r) {
      expect(x.until).toBeGreaterThan(x.at);
      // nothing can be sent during Shabbat or Yom Tov
      expect(restDayAt(x.at, CTX)).toBeNull();
      expect(restDayAt(x.until - 1, CTX)).toBeNull();
    }
  });

  it('keys are unique and stable for the same state', () => {
    const a = reminders([flow, hefsek], at(2026, 11, 27, 10));
    const b = reminders([flow, hefsek], at(2026, 11, 28, 10));
    expect(new Set(a.map(x => x.key)).size).toBe(a.length);
    expect(b.map(x => x.key).sort()).toEqual(a.map(x => x.key).sort());
    // a new hefsek gives new keys, so the new dates are announced again
    const c = reminders([flow, hefsek, { id: 'h2', kind: 'hefsek', abs: SUN + 5 }], at(2026, 11, 28, 10));
    const counted = (xs: typeof a) => xs.filter(x => x.kind !== 'onah').map(x => x.key);
    expect(counted(c).some(k => counted(a).includes(k))).toBe(false);
  });
});

describe('status line', () => {
  it('reads sensibly at each stage', () => {
    expect(statusText(timeline([], at(2026, 11, 23, 10)), TZ)).toBe('Tehorah.');
    expect(statusText(timeline([flow], at(2026, 11, 23, 10)), TZ)).toMatch(/^Niddah since Sun Nov 22\. Hefsek from Thu Nov 26 before 4:3\d PM\.$/);
    // once the first day has passed, it says so
    expect(statusText(timeline([flow], at(2026, 11, 27, 10)), TZ)).toMatch(/^Niddah since Sun Nov 22\. Hefsek from Thu Nov 26; next possible Fri Nov 27 before 4:3\d PM\.$/);
    expect(statusText(timeline([flow, hefsek], at(2026, 11, 29, 10)), TZ)).toMatch(/^Clean day 3 of 7\. Mikvah Thu Dec 3 after 5:\d\d PM\.$/);
    expect(statusText(timeline([flow, hefsek], at(2026, 12, 3, 19)), TZ)).toMatch(/^Mikvah tonight after 5:\d\d PM\.$/);
    // the next morning, with no immersion recorded
    expect(statusText(timeline([flow, hefsek], at(2026, 12, 4, 10)), TZ)).toMatch(/^Tehorah\./);
    expect(statusText(timeline([flow, hefsek, { id: 'm', kind: 'mikvah', abs: SUN + 12 }], at(2026, 12, 4, 10)), TZ)).toMatch(
      /^Tehorah\. Next onah: \d+:\d\d [AP]M \w{3} Dec \d+\.$/,
    );
  });
});
