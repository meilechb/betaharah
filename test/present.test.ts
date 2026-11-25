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
  restText,
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
// Civil dates; the three settings are tested in test/dates.test.ts.
const CTX: ReminderContext = { place: LAKEWOOD, zopts: ZOPTS, yomTov: 'diaspora', dates: 'civil' };
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
    expect(r[0]!.text).toMatch(/^Hefsek tahara: today, before sunset at 4:3\d PM\.$/);
  });

  it('each later day gets its own hefsek reminder, up to the limit', () => {
    const fri = reminders([flow], at(2026, 11, 27, 9)).filter(x => x.kind === 'hefsek');
    expect(fri[0]!.key).toBe(`hefsek:f:${SUN + 5}`);
    expect(fri[0]!.text).toContain('Candle lighting is that evening.');
    const late = reminders([flow], at(2026, 12, 10, 9)).filter(x => x.kind === 'hefsek');
    expect(late).toEqual([]);
  });

  it('during the count: bedikah reminders for each day, booking the mikvah, and the immersion night', () => {
    const r = reminders([flow, hefsek], at(2026, 11, 26, 18));
    expect(r.filter(x => x.kind === 'hefsek')).toEqual([]);
    // day 2 is Shabbat: it is in Friday's text (below)
    const mornings = r.filter(x => x.kind === 'bedikah_morning');
    expect(mornings).toHaveLength(6);
    expect(mornings[0]!.text).toMatch(/^Clean day 1 of 7 is today: bedikah in the morning and again before sunset at 4:3\d PM\. Required on this day\.$/);
    expect(mornings[1]!.text).toContain('Clean day 3 of 7');
    expect(mornings[1]!.text).not.toContain('Required');
    expect(mornings[5]!.text).toContain('Required on this day.');
    const mikvah = r.filter(x => x.kind === 'mikvah');
    expect(mikvah).toHaveLength(1);
    expect(mikvah[0]!.text).toMatch(/^Mikvah night: tonight, after 5:\d\d PM\.$/);
    expect(mikvah[0]!.at).toBe(dayTimes(SUN + 11, LAKEWOOD, ZOPTS).sunset - 180 * 60_000);
    // the morning after the hefsek (recorded on its day): Friday 27 November at 9:00
    const book = r.filter(x => x.kind === 'mikvah_book');
    expect(book).toHaveLength(1);
    expect(book[0]!.key).toBe(`mikvah_book:f:${SUN + 4}`);
    expect(book[0]!.text).toMatch(/^Book the mikvah: mikvah night is Thu night, after 5:\d\d PM\.$/);
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
    expect(discreet.text).toMatch(/^Book M: Thu night after 5:\d\d PM\.$/);
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

  it('booking the mikvah: a morning on Shabbat is a line of the Shabbat text, and after it for whoever did not get that', () => {
    // hefsek on Friday 27 November, recorded that day after candle lighting: Shabbat morning is in the Shabbat text,
    // whose Friday-morning time is past, so it also waits for Saturday night
    const r = reminders([flow, { id: 'h', kind: 'hefsek', abs: SUN + 5 }], at(2026, 11, 27, 17));
    expect(r.find(x => x.kind === 'mikvah_book')).toBeUndefined();
    const rest = r.find(x => x.key === `rest:${SAT}`)!;
    expect(rest.rest!.eve.items.map(i => i.kind)).toContain('mikvah_book');
    expect(rest.rest!.after.text.items.map(i => i.kind)).toContain('mikvah_book');
    expect(rest.rest!.after.at).toBeGreaterThan(dayTimes(SAT, LAKEWOOD, ZOPTS).tzeit);
    expect(restDayAt(rest.rest!.after.at, CTX)).toBeNull();
  });

  it('Shabbat: its reminders are one text on Friday morning at 9:00, a line for each day, both bedikot of a day on one line', () => {
    const r = reminders([flow, hefsek], at(2026, 11, 26, 18));
    expect(r.find(x => x.key === `bedikah_am:f:${SUN + 4}:2`)).toBeUndefined(); // Saturday 28 November
    expect(r.find(x => x.key === `bedikah_pm:f:${SUN + 4}:2`)).toBeUndefined();
    const rest = r.filter(x => x.kind === 'rest');
    expect(rest).toHaveLength(1);
    expect(rest[0]!.key).toBe(`rest:${SAT}`);
    expect(localDateTime(rest[0]!.at, TZ)).toMatchObject({ m: 11, d: 27, hh: 9, mi: 0 });
    expect(rest[0]!.until).toBe(dayTimes(SAT - 1, LAKEWOOD, ZOPTS).sunset - 18 * 60_000);
    expect(rest[0]!.text).toMatch(/^Over Shabbat\. Tomorrow: clean day 2, bedikah morning and before 4:3\d PM\.$/);
    // Friday's own reminders are before candle lighting and stay
    expect(r.find(x => x.key === `bedikah_am:f:${SUN + 4}:1`)).toBeDefined();
    expect(r.find(x => x.key === `bedikah_pm:f:${SUN + 4}:1`)).toBeDefined();
    expect(r.filter(x => x.kind === 'bedikah_afternoon')).toHaveLength(6);
    const discreet = buildReminders(timeline([flow, hefsek], at(2026, 11, 26, 18)), { ...DEFAULT_REMINDER_OPTIONS, style: 'discreet' }, CTX).find(x => x.kind === 'rest')!;
    expect(discreet.text).toMatch(/^Over Shabbat\. Tomorrow: day 2\/7, AM and before 4:3\d PM\.$/);
    expect(discreet.key).toBe(rest[0]!.key);
  });

  it('a Saturday-night immersion is in the Friday text, with its time, and again after Shabbat for whoever did not get that', () => {
    const r = reminders([flow, { id: 'h', kind: 'hefsek', abs: SUN + 6 }], at(2026, 11, 30, 10));
    expect(r.find(x => x.kind === 'mikvah')).toBeUndefined();
    const rest = r.find(x => x.key === `rest:${SAT + 7}`)!;
    expect(localDateTime(rest.at, TZ)).toMatchObject({ m: 12, d: 4, hh: 9 });
    expect(rest.text).toMatch(/Tomorrow night: mikvah night, after 5:\d\d PM \(after Shabbat or Yom Tov\)\.$/);
    expect(rest.rest!.after.text.items.map(i => i.kind)).toEqual(['mikvah']);
  });

  it('a Friday-night immersion is in the Friday text, with a note that it is Shabbat or Yom Tov night', () => {
    const r = reminders([flow, { id: 'h', kind: 'hefsek', abs: SUN + 5 }], at(2026, 11, 30, 10));
    expect(r.find(x => x.kind === 'mikvah')).toBeUndefined();
    const rest = r.find(x => x.key === `rest:${SAT + 7}`)!;
    expect(localDateTime(rest.at, TZ)).toMatchObject({ m: 12, d: 4, hh: 9 });
    expect(rest.text).toMatch(/^Over Shabbat\. Tonight: mikvah night, after 5:\d\d PM \(Shabbat or Yom Tov night\)\.$/);
  });

  it('consecutive onot are announced once, with the whole stretch', () => {
    const strict = { orZarua: 'yes', beinonitLength: 'full', beinonitDays: '30_31' } as const;
    const r = reminders([flow, hefsek, { id: 'm', kind: 'mikvah', abs: SUN + 12 }], at(2026, 12, 10, 10), DEFAULT_REMINDER_OPTIONS, strict)
      .filter(x => x.kind === 'onah');
    // night and day of day 30, night and day of day 31 (which is also the 12th of Tevet): one stretch
    expect(r).toHaveLength(1);
    expect(r[0]!.text).toMatch(/^Onah: 4:3\d PM tonight until 4:3\d PM Tue\./);
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
    for (const [style, dates] of [['plain', 'civil'], ['discreet', 'civil'], ['plain', 'hebrew'], ['plain', 'both'], ['discreet', 'both']] as const) {
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
          for (const r of buildReminders(t, { ...DEFAULT_REMINDER_OPTIONS, style }, { ...CTX, dates })) {
            expect(r.text, r.text).toMatch(basic);
            // the text of a Shabbat or Yom Tov has a line per reminder: two segments, with room for its options
            expect(r.text.length, r.text).toBeLessThanOrEqual(r.kind === 'rest' ? 290 : 160);
            if (r.rest) for (const x of [r.rest.after.text]) expect(restText(x).length).toBeLessThanOrEqual(290);
            checked++;
          }
          expect(statusText(t, TZ, dates)).toMatch(basic);
          expect(statusText(t, TZ, dates).length).toBeLessThanOrEqual(160);
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
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
    // (the text of a Shabbat is one per Shabbat: its lines carry the keys of the reminders it brings)
    const counted = (xs: typeof a) => xs.flatMap(x => (x.rest ? x.rest.eve.items.map(i => i.key) : x.kind === 'onah' ? [] : [x.key]));
    expect(counted(c).some(k => counted(a).includes(k))).toBe(false);
  });
});

describe('bedikah reminders: which days, morning and before sunset', () => {
  const run = (bedikot: Partial<typeof DEFAULT_REMINDER_OPTIONS.bedikot>) =>
    buildReminders(timeline([flow, hefsek], at(2026, 11, 26, 18)), { ...DEFAULT_REMINDER_OPTIONS, bedikot: { ...DEFAULT_REMINDER_OPTIONS.bedikot, ...bedikot } }, CTX);
  const days = (r: ReturnType<typeof run>, kind: 'bedikah_morning' | 'bedikah_afternoon') =>
    r.flatMap(x => (x.rest ? x.rest.eve.items : [{ kind: x.kind, key: x.key }])).filter(x => x.kind === kind).map(x => Number(x.key.split(':').at(-1))).sort((a, b) => a - b);

  it('all seven days, morning and before sunset, by default', () => {
    expect(DEFAULT_REMINDER_OPTIONS.bedikot).toMatchObject({ days: [1, 2, 3, 4, 5, 6, 7], morning: true, beforeSunset: true });
    const r = run({});
    expect(days(r, 'bedikah_morning')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(days(r, 'bedikah_afternoon')).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('only the days chosen; a day not chosen gets no bedikah reminder at all, also on Shabbat', () => {
    const r = run({ days: [1, 7] });
    expect(days(r, 'bedikah_morning')).toEqual([1, 7]);
    expect(days(r, 'bedikah_afternoon')).toEqual([1, 7]);
    // day 2 is Shabbat: no Shabbat text, since nothing else falls on it
    expect(r.find(x => x.kind === 'rest')).toBeUndefined();
    expect(days(run({ days: [] }), 'bedikah_morning')).toEqual([]);
  });

  it('morning only, or before sunset only; the Shabbat line names the one chosen', () => {
    const morning = run({ beforeSunset: false });
    expect(days(morning, 'bedikah_afternoon')).toEqual([]);
    expect(days(morning, 'bedikah_morning')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(morning.find(x => x.kind === 'rest')!.text).toBe('Over Shabbat. Tomorrow: clean day 2, bedikah in the morning.');
    const sunset = run({ morning: false });
    expect(days(sunset, 'bedikah_morning')).toEqual([]);
    expect(days(sunset, 'bedikah_afternoon')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(sunset.find(x => x.kind === 'rest')!.text).toMatch(/^Over Shabbat\. Tomorrow: clean day 2, bedikah before 4:3\d PM\.$/);
    // the switch for the bedikot as a whole still turns them all off
    expect(days(run({ on: false }), 'bedikah_morning')).toEqual([]);
  });

  it('the bedikah before sunset is 90 minutes before sunset by default, and follows a saved time', () => {
    const r = run({});
    const pm = r.find(x => x.key === `bedikah_pm:f:${SUN + 4}:3`)!;
    expect(pm.at).toBe(dayTimes(SUN + 7, LAKEWOOD, ZOPTS).sunset - 90 * 60_000);
    const saved = run({ minutesBeforeSunset: 60 }).find(x => x.key === pm.key)!;
    expect(saved.at).toBe(dayTimes(SUN + 7, LAKEWOOD, ZOPTS).sunset - 60 * 60_000);
  });
});

describe('Shabbat and Yom Tov: one text the morning before', () => {
  const reminders = (entries: LogEntry[], now: number, opts = DEFAULT_REMINDER_OPTIONS) => buildReminders(timeline(entries, now), opts, CTX);
  // Pesach 5787: Thursday and Friday, 22-23 April 2027, then Shabbat: three days in a row.
  const P1 = hd(15, M.NISAN, 5787);
  const atP = (d: number, hh: number, mi = 0) => at(2027, 4, d, hh, mi);

  it('a two-day Yom Tov followed by Shabbat is one stretch: one text on erev Yom Tov, a line per day in order', () => {
    expect([0, 1, 2, 3].map(i => isRestDay(P1 + i, 'diaspora'))).toEqual([true, true, true, false]);
    // hefsek on Monday 19 April: clean days 3, 4 and 5 are the three days
    const entries: LogEntry[] = [
      { id: 'f', kind: 'flow', onah: { abs: P1 - 8, part: 'day' }, veset: true },
      { id: 'h', kind: 'hefsek', abs: P1 - 3 },
    ];
    const r = reminders(entries, atP(19, 20));
    const rest = r.filter(x => x.kind === 'rest');
    expect(rest).toHaveLength(1);
    expect(rest[0]!.key).toBe(`rest:${P1}`);
    expect(localDateTime(rest[0]!.at, TZ)).toMatchObject({ m: 4, d: 21, hh: 9, mi: 0 });
    expect(rest[0]!.text).toMatch(
      /^Over Yom Tov and Shabbat\. Tomorrow: clean day 3, bedikah morning and before 7:4\d PM\. Fri: clean day 4, bedikah morning and before 7:4\d PM\. Shabbat: clean day 5, bedikah morning and before 7:4\d PM\.$/,
    );
    // nothing of those days is sent on its own, and nothing at all is sent during them
    for (const x of r) {
      expect(restDayAt(x.at, CTX)).toBeNull();
      expect(restDayAt(x.until - 1, CTX)).toBeNull();
    }
    expect(r.filter(x => x.kind === 'bedikah_morning').map(x => x.key.split(':').at(-1))).toEqual(['1', '2', '6', '7']);
  });

  it('a reminder just before candle lighting, or just after nightfall, keeps its own time', () => {
    // hefsek on Friday 27 November, recorded on Friday morning: Friday's hefsek reminder 20 minutes before sunset
    // (two minutes before candle lighting) and the booking at 8 PM on Saturday night (after nightfall)
    const friday = dayTimes(SAT - 1, LAKEWOOD, ZOPTS);
    const hefsekOnly = reminders([flow], at(2026, 11, 27, 8), { ...DEFAULT_REMINDER_OPTIONS, hefsek: { on: true, minutesBeforeSunset: 20 } });
    const h = hefsekOnly.find(x => x.kind === 'hefsek')!;
    expect(h.at).toBe(friday.sunset - 20 * 60_000);
    expect(h.until).toBe(friday.sunset - 18 * 60_000);
    expect(hefsekOnly.find(x => x.kind === 'rest')).toBeUndefined();
    const ctx: ReminderContext = { ...CTX, recordedAt: () => at(2026, 11, 27, 10) };
    const book = buildReminders(timeline([flow, { id: 'h', kind: 'hefsek', abs: SUN + 5 }], at(2026, 11, 27, 10)), { ...DEFAULT_REMINDER_OPTIONS, mikvahBook: { on: true, hour: 20, minute: 0 } }, ctx);
    const b = book.find(x => x.kind === 'mikvah_book')!;
    expect(localDateTime(b.at, TZ)).toMatchObject({ m: 11, d: 28, hh: 20, mi: 0 });
    expect(b.at).toBeGreaterThan(dayTimes(SAT, LAKEWOOD, ZOPTS).tzeit);
    expect(book.find(x => x.key === `rest:${SAT}`)!.rest!.eve.items.map(i => i.kind)).not.toContain('mikvah_book');
  });

  it('at the time chosen, unless that is later than 90 minutes before candle lighting', () => {
    const entries = [flow, hefsek];
    const early = reminders(entries, at(2026, 11, 26, 18), { ...DEFAULT_REMINDER_OPTIONS, restEve: { hour: 7, minute: 30 } }).find(x => x.kind === 'rest')!;
    expect(localDateTime(early.at, TZ)).toMatchObject({ m: 11, d: 27, hh: 7, mi: 30 });
    const late = reminders(entries, at(2026, 11, 26, 18), { ...DEFAULT_REMINDER_OPTIONS, restEve: { hour: 15, minute: 0 } }).find(x => x.kind === 'rest')!;
    expect(late.at).toBe(dayTimes(SAT - 1, LAKEWOOD, ZOPTS).sunset - (18 + 90) * 60_000);
  });

  it('every kind is a line: an onah that begins on Shabbat morning', () => {
    // a period that began by day on Friday 30 October: its day 30 is the daytime of Shabbat 28 November
    const entries: LogEntry[] = [
      { id: 'f', kind: 'flow', onah: { abs: SAT - 29, part: 'day' }, veset: true },
      { id: 'h', kind: 'hefsek', abs: SAT - 25 },
      { id: 'm', kind: 'mikvah', abs: SAT - 17 },
    ];
    const r = reminders(entries, at(2026, 11, 20, 10)).filter(x => x.kind === 'rest');
    const onah = r.flatMap(x => x.rest!.eve.items).filter(i => i.kind === 'onah');
    expect(onah.length).toBeGreaterThan(0);
    expect(r.find(x => x.rest!.eve.items.some(i => i.kind === 'onah'))!.text).toMatch(/Onah \d+:\d\d AM tomorrow until \d+:\d\d PM tomorrow \(day 30\)\. Bedikah\./);
  });
});

describe('status line', () => {
  it('reads sensibly at each stage', () => {
    expect(statusText(timeline([], at(2026, 11, 23, 10)), TZ, 'civil')).toBe('Tehorah.');
    expect(statusText(timeline([flow], at(2026, 11, 23, 10)), TZ, 'civil')).toMatch(/^Niddah since yesterday\. Hefsek from Thu before 4:3\d PM\.$/);
    // once the first day has passed, it says so
    expect(statusText(timeline([flow], at(2026, 11, 27, 10)), TZ, 'civil')).toMatch(/^Niddah since Sun, Nov 22\. Hefsek can be done today before 4:3\d PM\.$/);
    expect(statusText(timeline([flow, hefsek], at(2026, 11, 29, 10)), TZ, 'civil')).toMatch(/^Clean day 3 of 7\. Mikvah Thu night after 5:\d\d PM\.$/);
    expect(statusText(timeline([flow, hefsek], at(2026, 12, 3, 19)), TZ, 'civil')).toMatch(/^Mikvah tonight after 5:\d\d PM\.$/);
    // the next morning, with no immersion recorded
    expect(statusText(timeline([flow, hefsek], at(2026, 12, 4, 10)), TZ, 'civil')).toMatch(/^Tehorah\./);
    expect(statusText(timeline([flow, hefsek, { id: 'm', kind: 'mikvah', abs: SUN + 12 }], at(2026, 12, 4, 10)), TZ, 'civil')).toMatch(
      /^Tehorah\. Next onah: \d+:\d\d [AP]M (\w{3}( night)?, Dec \d+|\w{3}( night)?)\.$/,
    );
  });
});
