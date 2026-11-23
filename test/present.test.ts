import { describe, expect, it } from 'vitest';
import { civilToAbs, localDateTime, localToInstant } from '../src/engine/civil';
import type { LogEntry } from '../src/engine/cycle';
import { isRestDay } from '../src/engine/holidays';
import {
  DEFAULT_REMINDER_OPTIONS,
  buildCalendar,
  buildReminders,
  clock12,
  clock24,
  englishDate,
  moveAfterRestDay,
  moveBeforeRestDay,
  reasonHebrew,
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

  it('names each reason in Hebrew', () => {
    expect(reasonHebrew({ kind: 'beinonit', day: 30 })).toBe('עונה בינונית (יום ל׳)');
    expect(reasonHebrew({ kind: 'beinonit', day: 31 })).toBe('עונה בינונית (יום ל״א)');
    expect(reasonHebrew({ kind: 'chodesh', rule: 'same_date', dayOfMonth: 13 })).toBe('וסת החודש (י״ג בחודש)');
    expect(reasonHebrew({ kind: 'haflagah', unit: 'days', length: 28, latest: true })).toBe('וסת ההפלגה (28 ימים)');
    expect(reasonHebrew({ kind: 'haflagah', unit: 'onot', length: 48, latest: false })).toBe('הפלגה קודמת שלא נעקרה (48 עונות)');
    expect(reasonHebrew({ kind: 'or_zarua', of: { kind: 'beinonit', day: 30 } })).toBe('אור זרוע של עונה בינונית (יום ל׳)');
    expect(reasonHebrew({ kind: 'full_day', of: { kind: 'chodesh', rule: 'first_of_following', dayOfMonth: 30 } })).toContain('מעת לעת של וסת החודש');
  });
});

describe('calendar events', () => {
  it('before the hefsek: the flow, the hefsek deadline, seven projected days, a projected immersion, and the onot', () => {
    const events = buildCalendar(timeline([flow], at(2026, 11, 23, 10)), { style: 'hebrew', timeZone: TZ });
    const byKind = (k: string) => events.filter(e => e.kind === k);
    expect(byKind('flow').map(e => e.title)).toEqual(['ראייה (יום)']);
    const h = byKind('hefsek')[0]!;
    expect(h.title).toMatch(/^הפסק טהרה \(עד 16:3\d\)$/);
    expect(h.projected).toBe(true);
    expect(h.timed!.end).toBeLessThanOrEqual(dayTimes(SUN + 4, LAKEWOOD, ZOPTS).sunset);
    expect(byKind('clean_day').map(e => e.title)).toEqual(
      ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ז׳'].map(n => `שבעה נקיים: יום ${n} (משוער)`),
    );
    expect(byKind('clean_day').map(e => e.allDay!.startAbs)).toEqual([5, 6, 7, 8, 9, 10, 11].map(n => SUN + n));
    const m = byKind('mikvah')[0]!;
    expect(m.title).toMatch(/^ליל טבילה \(אחר 17:\d\d\) \(משוער\)$/);
    expect(localDateTime(m.timed!.start, TZ)).toMatchObject({ y: 2026, m: 12, d: 3 });
    expect(m.timed!.start).toBeGreaterThanOrEqual(dayTimes(SUN + 11, LAKEWOOD, ZOPTS).tzeit);
    // 22 November 2026 is 12 Kislev, and Kislev has 30 days this year:
    // day 30 is 21 December (11 Tevet) and veset hachodesh is 22 December (12 Tevet).
    expect(byKind('onah')).toHaveLength(2);
    expect(byKind('onah').map(e => e.title)).toEqual(['עונת הוסת (יום)', 'עונת הוסת (יום)']);
    expect(byKind('onah')[0]!.description).toContain('עונה בינונית (יום ל׳)');
    expect(byKind('onah')[0]!.description).toContain('י״א טבת');
    expect(byKind('onah')[1]!.description).toContain('וסת החודש (י״ב בחודש)');
    expect(byKind('onah')[1]!.description).toContain('י״ב טבת');
    expect(byKind('onah')[0]!.description).toContain('פרישה ובדיקה.');
  });

  it('after the hefsek nothing is projected', () => {
    const events = buildCalendar(timeline([flow, hefsek], at(2026, 11, 27, 10)), { style: 'hebrew', timeZone: TZ });
    expect(events.filter(e => e.projected)).toEqual([]);
    expect(events.find(e => e.kind === 'hefsek')!.title).toBe('הפסק טהרה ✓');
    expect(events.find(e => e.key === 'clean:f:1')!.title).toBe('שבעה נקיים: יום א׳');
    expect(events.find(e => e.key === 'clean:f:1')!.description).toContain('בדיקה ביום זה מעכבת.');
    expect(events.find(e => e.key === 'clean:f:3')!.description).not.toContain('מעכבת');
  });

  it('after immersion the event is the night she went', () => {
    const entries: LogEntry[] = [flow, hefsek, { id: 'm', kind: 'mikvah', abs: SUN + 13 }]; // a night late
    const events = buildCalendar(timeline(entries, at(2026, 12, 6, 10)), { style: 'hebrew', timeZone: TZ });
    const m = events.find(e => e.kind === 'mikvah')!;
    expect(m.title).toBe('טבילה ✓');
    expect(localDateTime(m.timed!.start, TZ)).toMatchObject({ m: 12, d: 4 });
  });

  it('separate Or Zarua onot are titled as such', () => {
    const events = buildCalendar(timeline([flow], at(2026, 11, 23, 10), { orZarua: 'yes' }), { style: 'hebrew', timeZone: TZ });
    const titles = events.filter(e => e.kind === 'onah').map(e => e.title);
    expect(titles).toEqual(['אור זרוע (לילה)', 'עונת הוסת (יום)', 'אור זרוע (לילה)', 'עונת הוסת (יום)']);
  });

  it('discreet style has no words and no descriptions', () => {
    const events = buildCalendar(timeline([flow], at(2026, 11, 23, 10), { orZarua: 'yes' }), { style: 'discreet', timeZone: TZ });
    for (const e of events) {
      expect(e.description).toBe('');
      expect(e.title).not.toMatch(/[֐-׿]/);
      expect(e.title).not.toMatch(/[A-Za-z]{2,}/);
    }
    expect(events.map(e => e.title)).toContain('1/7 ?');
    expect(events.map(e => e.title)).toContain('◇');
    expect(events.map(e => e.title)).toContain('◆');
  });

  it('gives every event a distinct key and exactly one kind of timing, over a long history', () => {
    const entries: LogEntry[] = [];
    let abs = SUN - 300;
    for (let k = 0; k < 10; k++) {
      entries.push({ id: `f${k}`, kind: 'flow', onah: { abs, part: k % 2 ? 'night' : 'day' }, veset: true });
      entries.push({ id: `h${k}`, kind: 'hefsek', abs: abs + 5 });
      entries.push({ id: `m${k}`, kind: 'mikvah', abs: abs + 13 });
      abs += 27 + (k % 4);
    }
    const t = buildTimeline({ entries, settings: DEFAULT_HALACHIC_SETTINGS, place: LAKEWOOD, useElevation: false, now: at(2026, 11, 23, 10) });
    const events = buildCalendar(t, { style: 'hebrew', timeZone: TZ });
    expect(new Set(events.map(e => e.key)).size).toBe(events.length);
    for (const e of events) {
      expect(Boolean(e.timed) !== Boolean(e.allDay)).toBe(true);
      if (e.timed) expect(e.timed.end).toBeGreaterThan(e.timed.start);
      expect(e.title.length).toBeGreaterThan(0);
    }
    expect(events.filter(e => e.kind === 'mikvah')).toHaveLength(10);
  });

  it('notes an immersion night that is also an onah', () => {
    const a: LogEntry = { id: 'a', kind: 'flow', onah: { abs: SUN - 12, part: 'night' }, veset: true };
    const b: LogEntry = { id: 'b', kind: 'flow', onah: { abs: SUN, part: 'night' }, veset: true };
    const events = buildCalendar(timeline([a, b, hefsek], at(2026, 11, 30, 10)), { style: 'hebrew', timeZone: TZ });
    expect(events.find(e => e.key === 'mikvah:a')!.description).toContain('ליל הטבילה חל בעונת פרישה. יש לשאול רב.');
    expect(events.find(e => e.kind === 'onah' && e.description.includes('בליל הטבילה'))).toBeDefined();
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

  it('during the count: bedikah reminders for each day, the immersion night, and a check the next morning', () => {
    const r = reminders([flow, hefsek], at(2026, 11, 26, 18));
    expect(r.filter(x => x.kind === 'hefsek')).toEqual([]);
    const mornings = r.filter(x => x.kind === 'bedikah_morning');
    expect(mornings).toHaveLength(7);
    expect(mornings[0]!.text).toMatch(/^Clean day 1 of 7 is Fri Nov 27: bedikah in the morning and again before sunset at 4:3\d PM\. Required on this day\.$/);
    expect(mornings[2]!.text).not.toContain('Required');
    expect(mornings[6]!.text).toContain('Required on this day.');
    const mikvah = r.filter(x => x.kind === 'mikvah');
    expect(mikvah).toHaveLength(1);
    expect(mikvah[0]!.text).toMatch(/^Mikvah night: Thu Dec 3, after 5:\d\d PM\. Reply 4 after immersing\.$/);
    expect(mikvah[0]!.at).toBe(dayTimes(SUN + 11, LAKEWOOD, ZOPTS).sunset - 180 * 60_000);
    const confirm = r.filter(x => x.kind === 'mikvah_confirm');
    expect(confirm).toHaveLength(1);
    expect(localDateTime(confirm[0]!.at, TZ)).toMatchObject({ m: 12, d: 4, hh: 9, mi: 0 });
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

  it('a Saturday-night immersion is announced on Friday and confirmed on Sunday morning', () => {
    const r = reminders([flow, { id: 'h', kind: 'hefsek', abs: SUN + 6 }], at(2026, 11, 30, 10));
    const m = r.find(x => x.kind === 'mikvah')!;
    expect(m.text).toContain('Mikvah night: Sat Dec 5');
    expect(m.text).toContain('after Shabbat or Yom Tov');
    expect(localDateTime(m.at, TZ)).toMatchObject({ m: 12, d: 4 });
    expect(localDateTime(r.find(x => x.kind === 'mikvah_confirm')!.at, TZ)).toMatchObject({ m: 12, d: 6, hh: 9 });
  });

  it('a Friday-night immersion: the check the next morning waits until after Shabbat', () => {
    const r = reminders([flow, { id: 'h', kind: 'hefsek', abs: SUN + 5 }], at(2026, 11, 30, 10));
    const m = r.find(x => x.kind === 'mikvah')!;
    expect(m.text).toContain('Shabbat or Yom Tov night, prepare before');
    expect(localDateTime(m.at, TZ)).toMatchObject({ m: 12, d: 4 });
    const confirm = r.find(x => x.kind === 'mikvah_confirm')!;
    expect(confirm.at).toBeGreaterThan(dayTimes(SUN + 13, LAKEWOOD, ZOPTS).tzeit);
    expect(localDateTime(confirm.at, TZ)).toMatchObject({ m: 12, d: 5 });
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
      mikvahConfirm: { ...DEFAULT_REMINDER_OPTIONS.mikvahConfirm, on: false },
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
    expect(statusText(timeline([flow], at(2026, 11, 23, 10)), TZ)).toMatch(
      /^Niddah since Sun Nov 22\. Hefsek from Thu Nov 26; next possible Thu Nov 26 before 4:3\d PM\.$/,
    );
    expect(statusText(timeline([flow, hefsek], at(2026, 11, 29, 10)), TZ)).toMatch(/^Clean day 3 of 7\. Mikvah Thu Dec 3 after 5:\d\d PM\.$/);
    expect(statusText(timeline([flow, hefsek], at(2026, 12, 3, 19)), TZ)).toMatch(/^Mikvah tonight after 5:\d\d PM\.$/);
    expect(statusText(timeline([flow, hefsek, { id: 'm', kind: 'mikvah', abs: SUN + 12 }], at(2026, 12, 4, 10)), TZ)).toMatch(
      /^Tehorah\. Next onah: \d+:\d\d [AP]M \w{3} Dec \d+\.$/,
    );
  });
});
