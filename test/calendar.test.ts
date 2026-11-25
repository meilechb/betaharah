import { describe, expect, it } from 'vitest';
import { toICalendar } from '../src/app/ics';
import { entryText, noteText, patternText, statusLines, warningText } from '../src/app/wording';
import { planSync, toDesired } from '../src/app/sync';
import {
  buildCalendar,
  calendarAppEvents,
  civilDate,
  DEFAULT_CALENDAR_SHOW,
  hiddenKey,
  reasonText,
  SHOWN_KINDS,
  weekday,
  type CalendarEvent,
  type CalendarOptions,
  type CalendarShow,
  type ShownKind,
} from '../src/engine/calendar';
import { civilToAbs, localDateTime, localToInstant } from '../src/engine/civil';
import type { LogEntry } from '../src/engine/cycle';
import { choicesFor, DEFAULT_HALACHIC_SETTINGS, HALACHIC_CHOICES, tzeitPresetsFor } from '../src/engine/settings';
import type { GeoPoint } from '../src/engine/sun';
import { allTerms, dayOfMonth, fill, hebrewDate, term } from '../src/engine/terms';
import { buildTimeline } from '../src/engine/timeline';
import { dayTimes } from '../src/engine/zmanim';
import { BASIC, withSettings } from './helpers';

const LAKEWOOD: GeoPoint = { latitude: 40.0821, longitude: -74.2097, timeZone: 'America/New_York', elevation: 16 };
const TZ = LAKEWOOD.timeZone;
const ZOPTS = { useElevation: false, tzeit: BASIC.tzeit };
const at = (y: number, m: number, d: number, hh: number, mi = 0): number => localToInstant({ y, m, d, hh, mi, ss: 0 }, TZ);
const SUN = civilToAbs({ y: 2026, m: 11, d: 22 });
const EN: CalendarOptions = { style: 'words', lang: 'en', timeZone: TZ, dates: 'civil' };
const HE: CalendarOptions = { style: 'words', lang: 'he', timeZone: TZ, dates: 'hebrew' };
const HEBREW = /[֐-׿]/;

const timeline = (entries: LogEntry[], now: number, patch = {}) =>
  buildTimeline({ entries, settings: withSettings(patch), place: LAKEWOOD, useElevation: false, now });

const flow: LogEntry = { id: 'f', kind: 'flow', onah: { abs: SUN, part: 'day' }, veset: true };
const hefsek: LogEntry = { id: 'h', kind: 'hefsek', abs: SUN + 4 };

describe('terms', () => {
  it('fills each term in English letters or in Hebrew', () => {
    expect(fill('The {hefsek} is before {sunset}.', 'en')).toBe('The hefsek taharah is before sunset.');
    expect(fill('The {hefsek} is before {sunset}.', 'he')).toBe('The הפסק טהרה is before שקיעה.');
    expect(term('mikvah_night', 'en')).toBe('mikvah night');
    expect(term('mikvah_night', 'he')).toBe('ליל טבילה');
  });

  it('refuses a term it does not know, so a misspelling cannot reach a person', () => {
    expect(() => fill('{hefsk}', 'en')).toThrow('unknown term');
  });

  it('has both forms of every term, and the Hebrew form is in Hebrew script', () => {
    const en = allTerms('en');
    const he = allTerms('he');
    expect(Object.keys(en).sort()).toEqual(Object.keys(he).sort());
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(en[key], key).toMatch(/^[A-Za-z' ]+$/);
      expect(he[key], key).toMatch(/^[א-ת ]+$/);
    }
  });

  it('writes Hebrew dates in both forms', () => {
    expect(hebrewDate(SUN, 'en')).toBe('12 Kislev 5787');
    expect(hebrewDate(SUN, 'en', false)).toBe('12 Kislev');
    expect(hebrewDate(SUN, 'he')).toBe('י״ב כסלו תשפ״ז');
    expect(hebrewDate(SUN, 'he', false)).toBe('י״ב כסלו');
    // Adar in a common year and in a leap year
    expect(hebrewDate(civilToAbs({ y: 2026, m: 3, d: 3 }), 'en')).toBe('14 Adar 5786');
    expect(hebrewDate(civilToAbs({ y: 2027, m: 2, d: 21 }), 'en')).toBe('14 Adar I 5787');
    expect(hebrewDate(civilToAbs({ y: 2027, m: 3, d: 23 }), 'en')).toBe('14 Adar II 5787');
    expect(dayOfMonth(30, 'en')).toBe('30');
    expect(dayOfMonth(30, 'he')).toBe('ל׳');
    expect(dayOfMonth(13, 'he')).toBe('י״ג');
  });

  it('every setting, option and preset can be shown in both forms, with no place left unfilled', () => {
    for (const lang of ['en', 'he'] as const) {
      const choices = choicesFor(lang);
      expect(choices.map(c => c.key)).toEqual(HALACHIC_CHOICES.map(c => c.key));
      const texts = [...choices.flatMap(c => [c.title, c.help, ...c.options.map(o => o.label)]), ...tzeitPresetsFor(lang).map(p => p.label)];
      for (const text of texts) expect(text).not.toMatch(/[{}]/);
      expect(texts.some(text => HEBREW.test(text))).toBe(lang === 'he');
    }
    expect(choicesFor('en')[0]!.title).toBe('Days before the hefsek taharah');
    expect(choicesFor('he')[0]!.title).toBe('Days before the הפסק טהרה');
    // the values the engine reads are never touched by the wording
    expect(choicesFor('he').map(c => c.options.map(o => o.value))).toEqual(HALACHIC_CHOICES.map(c => c.options.map(o => o.value)));
  });
});

describe('dates in words', () => {
  it('names a day by its weekday, Hebrew date and civil date', () => {
    expect(weekday(SUN)).toBe('Sunday');
    expect(weekday(SUN + 6)).toBe('Shabbat');
    expect(civilDate(SUN)).toBe('Nov 22, 2026');
  });

  it('names each reason', () => {
    expect(reasonText({ kind: 'beinonit', day: 30 }, 'en')).toBe('Onah beinonit (day 30)');
    expect(reasonText({ kind: 'beinonit', day: 31 }, 'he')).toBe('עונה בינונית (day 31)');
    expect(reasonText({ kind: 'chodesh', rule: 'same_date', dayOfMonth: 13 }, 'en')).toBe('Veset hachodesh (day 13 of the month)');
    expect(reasonText({ kind: 'chodesh', rule: 'same_date', dayOfMonth: 13 }, 'he')).toBe('וסת החודש (day י״ג of the month)');
    expect(reasonText({ kind: 'chodesh', rule: 'day29', dayOfMonth: 30 }, 'en')).toBe('Veset hachodesh (the 29th, for a flow on the 30th)');
    expect(reasonText({ kind: 'haflagah', unit: 'days', length: 28, latest: true }, 'en')).toBe('Veset haflagah (28 days)');
    expect(reasonText({ kind: 'haflagah', unit: 'onot', length: 48, latest: false }, 'en')).toBe('An earlier haflagah not yet passed (48 onot)');
    expect(reasonText({ kind: 'or_zarua', of: { kind: 'beinonit', day: 30 } }, 'en')).toBe('Or Zarua of onah beinonit (day 30)');
    expect(reasonText({ kind: 'full_day', of: { kind: 'chodesh', rule: 'first_of_following', dayOfMonth: 30 } }, 'en')).toBe(
      'Full day of veset hachodesh (the 1st of the following month, for a flow on the 30th)',
    );
  });
});

describe('calendar events', () => {
  it('before the hefsek: the flow, the hefsek deadline, seven projected days, a projected immersion, and the onot', () => {
    const events = buildCalendar(timeline([flow], at(2026, 11, 23, 10)), EN);
    const byKind = (k: string) => events.filter(e => e.kind === k);
    expect(byKind('flow').map(e => e.title)).toEqual(['Flow (day)']);
    // descriptions do not repeat the event's own date or hours
    expect(byKind('flow')[0]!.description).toBe('');
    const h = byKind('hefsek')[0]!;
    expect(h.title).toBe('Hefsek taharah (by 4:33 PM)');
    expect(h.projected).toBe(true);
    expect(h.description).toBe('Before sunset; preferably after minchah ketanah.');
    expect(localDateTime(h.timed!.start, TZ)).toMatchObject({ d: 26, hh: 14, mi: 33 });
    expect(h.timed!.end).toBeLessThanOrEqual(dayTimes(SUN + 4, LAKEWOOD, ZOPTS).sunset);
    expect(byKind('clean_day').map(e => e.title)).toEqual([1, 2, 3, 4, 5, 6, 7].map(n => `Seven clean days: day ${n} (projected)`));
    expect(byKind('clean_day').map(e => e.allDay!.startAbs)).toEqual([5, 6, 7, 8, 9, 10, 11].map(n => SUN + n));
    const m = byKind('mikvah')[0]!;
    expect(m.title).toBe('Mikvah night (after 5:16 PM) (projected)');
    expect(m.description).toBe('Projected: if the hefsek taharah is done on the first day it can be.');
    expect(localDateTime(m.timed!.start, TZ)).toMatchObject({ y: 2026, m: 12, d: 3 });
    expect(m.timed!.start).toBeGreaterThanOrEqual(dayTimes(SUN + 11, LAKEWOOD, ZOPTS).tzeit);
    // 22 November 2026 is 12 Kislev, and Kislev has 30 days this year:
    // day 30 is 21 December (11 Tevet) and veset hachodesh is 22 December (12 Tevet).
    expect(byKind('onah').map(e => e.title)).toEqual(['Veset onah (day)', 'Veset onah (day)']);
    expect(byKind('onah')[0]!.description).toBe('Onah beinonit (day 30)\nSeparation, and a bedikah.');
    expect(byKind('onah')[1]!.description).toBe('Veset hachodesh (day 12 of the month)\nSeparation, and a bedikah.');
  });

  it('the same events with Hebrew terms: the sentences stay English, the terms and Hebrew dates change', () => {
    const en = buildCalendar(timeline([flow], at(2026, 11, 23, 10)), EN);
    const he = buildCalendar(timeline([flow], at(2026, 11, 23, 10)), HE);
    expect(he.map(e => e.key)).toEqual(en.map(e => e.key));
    expect(he.map(e => [e.timed, e.allDay, e.projected])).toEqual(en.map(e => [e.timed, e.allDay, e.projected]));
    const title = (kind: string): string => he.find(e => e.kind === kind)!.title;
    expect(title('flow')).toBe('ראייה (day)');
    expect(title('hefsek')).toBe('הפסק טהרה (by 4:33 PM)');
    expect(title('clean_day')).toBe('שבעה נקיים: day 1 (projected)');
    expect(title('mikvah')).toBe('ליל טבילה (after 5:16 PM) (projected)');
    expect(title('onah')).toBe('עונת הוסת (day)');
    expect(he.find(e => e.kind === 'hefsek')!.description).toBe('Before שקיעה; preferably after מנחה קטנה.');
    for (const e of en) expect(e.title + e.description).not.toMatch(HEBREW);
    for (const e of [...en, ...he]) expect(e.title + e.description).not.toMatch(/[{}]/);
  });

  it('after the hefsek nothing is projected', () => {
    const events = buildCalendar(timeline([flow, hefsek], at(2026, 11, 27, 10)), EN);
    expect(events.filter(e => e.projected)).toEqual([]);
    expect(events.find(e => e.kind === 'hefsek')!.title).toBe('Hefsek taharah ✓');
    expect(events.find(e => e.key === 'clean:f:1')!.title).toBe('Seven clean days: day 1');
    expect(events.find(e => e.key === 'clean:f:1')!.description).toContain('A bedikah on this day is required.');
    expect(events.find(e => e.key === 'clean:f:3')!.description).not.toContain('required');
  });

  it('after immersion the event is the night she went', () => {
    const entries: LogEntry[] = [flow, hefsek, { id: 'm', kind: 'mikvah', abs: SUN + 13 }]; // a night late
    const events = buildCalendar(timeline(entries, at(2026, 12, 6, 10)), EN);
    const m = events.find(e => e.kind === 'mikvah')!;
    expect(m.title).toBe('Immersion ✓');
    expect(m.description).toBe('');
    expect(localDateTime(m.timed!.start, TZ)).toMatchObject({ m: 12, d: 4 });
  });

  it('separate Or Zarua onot are titled as such, and a night is named by its evening', () => {
    const events = buildCalendar(timeline([flow], at(2026, 11, 23, 10), { orZarua: 'yes' }), EN);
    const onot = events.filter(e => e.kind === 'onah');
    expect(onot.map(e => e.title)).toEqual(['Or Zarua (night)', 'Veset onah (day)', 'Or Zarua (night)', 'Veset onah (day)']);
    expect(onot[0]!.description).toBe('Or Zarua of onah beinonit (day 30)\nSeparation.');
    expect(localDateTime(onot[0]!.timed!.start, TZ)).toMatchObject({ m: 12, d: 20 }); // the evening it begins
    expect(onot.map(e => e.light)).toEqual([true, false, true, false]);
  });

  it('discreet style has no words and no descriptions, whichever form of terms is chosen', () => {
    for (const lang of ['en', 'he'] as const) {
      const events = buildCalendar(timeline([flow], at(2026, 11, 23, 10), { orZarua: 'yes' }), { style: 'discreet', lang, timeZone: TZ, dates: 'hebrew' });
      for (const e of events) {
        expect(e.description).toBe('');
        expect(e.title).not.toMatch(HEBREW);
        // "AM" and "PM" of a time are the only letters in a row
        expect(e.title.replace(/\b[AP]M\b/g, '')).not.toMatch(/[A-Za-z]{2,}/);
      }
      expect(events.map(e => e.title)).toContain('1/7 ?');
      expect(events.map(e => e.title)).toContain('◇');
      expect(events.map(e => e.title)).toContain('◆');
      expect(events.map(e => e.title)).toContain('H < 4:33 PM');
      expect(events.map(e => e.title)).toContain('M > 5:16 PM ?');
    }
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
    for (const opts of [EN, HE]) {
      const events = buildCalendar(t, opts);
      expect(new Set(events.map(e => e.key)).size).toBe(events.length);
      for (const e of events) {
        expect(Boolean(e.timed) !== Boolean(e.allDay)).toBe(true);
        if (e.timed) expect(e.timed.end).toBeGreaterThan(e.timed.start);
        expect(e.title.length).toBeGreaterThan(0);
        expect(e.title + e.description).not.toMatch(/[{}]|undefined|NaN/);
      }
      expect(events.filter(e => e.kind === 'mikvah')).toHaveLength(10);
    }
  });

  it('notes an immersion night that is also an onah', () => {
    const a: LogEntry = { id: 'a', kind: 'flow', onah: { abs: SUN - 12, part: 'night' }, veset: true };
    const b: LogEntry = { id: 'b', kind: 'flow', onah: { abs: SUN, part: 'night' }, veset: true };
    const events = buildCalendar(timeline([a, b, hefsek], at(2026, 11, 30, 10)), EN);
    // the second flow comes twelve days after the first with nothing recorded between them, so it begins the period the hefsek belongs to
    expect(events.find(e => e.key === 'mikvah:b')!.description).toContain('It falls on an onat perishah.');
    expect(events.find(e => e.kind === 'onah' && e.description.includes('It falls on the mikvah night.'))).toBeDefined();
  });
});

describe('what a calendar app shows', () => {
  const civil = (y: number, m: number, d: number) => civilToAbs({ y, m, d });
  const lastDay = (e: CalendarEvent) => e.allDay!.endAbsExclusive - 1;
  const ALL: CalendarShow = { onot: true, period: true, hefsek: true, niddah: true, cleanDays: true, mikvah: true };
  const WITH_NIDDAH: CalendarShow = { ...DEFAULT_CALENDAR_SHOW, niddah: true };
  const publish = (t: ReturnType<typeof timeline>, show: CalendarShow, opts = EN) => calendarAppEvents(t, show, opts);
  // The owner's example: a period on Friday Oct 23, 2026 by day, the hefsek taharah on Wednesday Oct 28, in Lakewood.
  const OCT23: LogEntry = { id: 'f', kind: 'flow', onah: { abs: civil(2026, 10, 23), part: 'day' }, veset: true };
  const OCT28: LogEntry = { id: 'h', kind: 'hefsek', abs: civil(2026, 10, 28) };

  it('by default: the flow, the hefsek and the onot; no niddah days, no clean days, no mikvah night', () => {
    const t = timeline([OCT23, OCT28], at(2026, 10, 30, 12));
    expect(new Set(publish(t, DEFAULT_CALENDAR_SHOW).map(e => e.kind))).toEqual(new Set(['flow', 'hefsek', 'onah']));
  });

  it('with the niddah days switched on: one all-day event for the period as well', () => {
    const t = timeline([OCT23, OCT28], at(2026, 10, 30, 12));
    const events = publish(t, WITH_NIDDAH);
    expect(new Set(events.map(e => e.kind))).toEqual(new Set(['apart', 'flow', 'hefsek', 'onah']));
    const apart = events.filter(e => e.kind === 'apart');
    expect(apart).toHaveLength(1);
    const p = apart[0]!;
    expect(p).toMatchObject({ key: 'apart:f', title: 'Niddah', projected: false });
    expect(p.allDay!.startAbs).toBe(civil(2026, 10, 23));
    // seven clean days Oct 29 to Nov 4; the mikvah night is the evening of Wednesday Nov 4
    expect(lastDay(p)).toBe(civil(2026, 11, 4));
    expect(p.description).toMatch(/^Until mikvah night: Wed night, Nov 4, after \d:\d\d PM\.$/);
    expect(events.find(e => e.kind === 'hefsek')!.title).toBe('Hefsek taharah ✓');
    const period = events.find(e => e.kind === 'flow')!;
    // the start of the period: all day on its date, so that a month view shows it
    expect(period.title).toBe('Period began (by day)');
    expect(period.allDay).toEqual({ startAbs: civil(2026, 10, 23), endAbsExclusive: civil(2026, 10, 24) });
    expect(period.timed).toBeUndefined();
    // the app's own event for it keeps its hours
    expect(buildCalendar(t, EN).find(e => e.kind === 'flow')).toMatchObject({ title: 'Flow (day)', timed: expect.anything() });
    expect(events.filter(e => e.kind === 'onah').length).toBeGreaterThan(0);
    // the app's own list is unchanged and has no period event
    expect(buildCalendar(t, EN).some(e => e.kind === 'apart')).toBe(false);
  });

  it('each switch adds or removes its own kinds only', () => {
    const t = timeline([OCT23, OCT28], at(2026, 10, 30, 12), { orZarua: 'yes' });
    const kindsOf: Record<ShownKind, string[]> = { onot: ['onah'], niddah: ['apart'], period: ['flow'], hefsek: ['hefsek'], cleanDays: ['clean_day'], mikvah: ['mikvah'] };
    const none: CalendarShow = { onot: false, period: false, hefsek: false, niddah: false, cleanDays: false, mikvah: false };
    expect(publish(t, none)).toEqual([]);
    for (const kind of SHOWN_KINDS) {
      const events = publish(t, { ...none, [kind]: true });
      expect([...new Set(events.map(e => e.kind))].sort(), kind).toEqual(kindsOf[kind]);
    }
    // the Or Zarua onot are among the onot
    expect(publish(t, { ...none, onot: true }).some(e => e.light)).toBe(true);
    // everything on: every event of the app's own list, and the period's
    expect(publish(t, ALL)).toHaveLength(buildCalendar(t, EN).length + 1);
    expect(publish(t, ALL).filter(e => e.kind === 'clean_day')).toHaveLength(7);
  });

  it('a period that began at night begins on the date of that evening', () => {
    const night: LogEntry = { id: 'f', kind: 'flow', onah: { abs: civil(2026, 10, 23), part: 'night' }, veset: true };
    const t = timeline([night, OCT28], at(2026, 10, 30, 12));
    const p = publish(t, WITH_NIDDAH).find(e => e.kind === 'apart')!;
    expect(p.allDay!.startAbs).toBe(civil(2026, 10, 22));
    // the event for the start of the period is on that evening's date too
    const f = publish(t, DEFAULT_CALENDAR_SHOW).find(e => e.kind === 'flow')!;
    expect(f.title).toBe('Period began (at night)');
    expect(f.allDay!.startAbs).toBe(civil(2026, 10, 22));
    expect(lastDay(p)).toBe(t.periods[0]!.planMikvah.eveningAbs);
  });

  it('with no hefsek yet, it runs to the mikvah night it would be, and moves as the days pass', () => {
    const t1 = timeline([flow], at(2026, 11, 23, 10)); // flow Sunday Nov 22
    const p1 = publish(t1, WITH_NIDDAH).find(e => e.kind === 'apart')!;
    const plan = t1.periods[0]!;
    expect(p1.allDay!.startAbs).toBe(SUN);
    expect(lastDay(p1)).toBe(plan.planMikvah.eveningAbs);
    expect(p1.projected).toBe(true);
    expect(p1.description).toBe('Mikvah night would be Thu night, Dec 3, if the hefsek taharah is done Thu, Nov 26.');
    // two days after the first possible day, still no hefsek: two days later
    const t2 = timeline([flow], at(2026, 11, 28, 10));
    const p2 = publish(t2, WITH_NIDDAH).find(e => e.kind === 'apart')!;
    expect(lastDay(p2)).toBe(lastDay(p1) + 2);
    expect(p2.key).toBe(p1.key);
    expect(p2.description).toBe('Mikvah night would be Sat night, Dec 5, if the hefsek taharah is done Shabbat, Nov 28.');
  });

  it('a recorded immersion on a later night extends it to that night', () => {
    const late: LogEntry[] = [flow, hefsek, { id: 'm', kind: 'mikvah', abs: SUN + 13 }]; // a night late: the evening of Dec 4
    const t = timeline(late, at(2026, 12, 6, 10));
    const p = publish(t, WITH_NIDDAH).find(e => e.kind === 'apart')!;
    expect(t.periods[0]!.planMikvah.eveningAbs).toBe(civil(2026, 12, 3));
    expect(lastDay(p)).toBe(civil(2026, 12, 4));
    expect(p.description).toMatch(/^Until mikvah night: Fri night, Dec 4, after \d:\d\d PM\.$/);
  });

  it('a period closed by the next one with no hefsek runs up to the day before the next began', () => {
    const next: LogEntry = { id: 'g', kind: 'flow', onah: { abs: civil(2026, 12, 20), part: 'night' }, veset: true };
    const t = timeline([flow, next], at(2026, 12, 21, 10));
    const [first, second] = publish(t, WITH_NIDDAH).filter(e => e.kind === 'apart');
    expect(first!.key).toBe('apart:f');
    expect(first!.allDay!.startAbs).toBe(SUN);
    expect(lastDay(first!)).toBe(civil(2026, 12, 18)); // the next began the evening of Dec 19
    expect(first!.description).toBe('');
    expect(second!.allDay!.startAbs).toBe(civil(2026, 12, 19));
  });

  it('both title styles and both forms of the terms', () => {
    const t = timeline([OCT23, OCT28], at(2026, 10, 30, 12));
    const he = publish(t, WITH_NIDDAH, HE).find(e => e.kind === 'apart')!;
    expect(he.title).toBe('נדה\u200f');
    expect(he.description).toMatch(/^עד ליל טבילה: יום ד׳ בערב, אור לכ״ה חשון, אחרי \d:\d\d\u200f$/);
    const heProjected = publish(timeline([flow], at(2026, 11, 23, 10)), WITH_NIDDAH, HE).find(e => e.kind === 'apart')!;
    expect(heProjected.description).toBe('ליל טבילה: יום ה׳ בערב, אור לכ״ד כסלו, אם ההפסק טהרה ייעשה ביום ה׳, ט״ז כסלו\u200f');
    for (const lang of ['en', 'he'] as const) {
      const discreet = publish(t, ALL, { style: 'discreet', lang, timeZone: TZ, dates: 'hebrew' });
      const p = discreet.find(e => e.kind === 'apart')!;
      expect(p.title).toBe('N');
      for (const e of discreet) expect(e.description).toBe('');
    }
  });

  it('no description says "rav" or asks anything', () => {
    const scenarios = [
      timeline([flow], at(2026, 11, 23, 10)),
      timeline([flow, hefsek], at(2026, 11, 27, 10)),
      timeline([flow, hefsek, { id: 'm', kind: 'mikvah', abs: SUN + 13 }], at(2026, 12, 6, 10)),
      timeline([flow, { id: 'g', kind: 'flow', onah: { abs: civil(2026, 12, 20), part: 'night' }, veset: true }], at(2026, 12, 21, 10), { orZarua: 'yes' }),
    ];
    for (const t of scenarios) {
      for (const opts of [EN, HE]) {
        for (const e of publish(t, ALL, opts)) {
          // "רב" as a word of its own ("בערב", in the evening, has the same letters)
          expect(e.description).not.toMatch(/\brav\b|(^|[\s(])רב($|[\s.,;:)])|\?/im);
          expect(e.title + e.description).not.toMatch(/[{}]|undefined|NaN/);
        }
      }
    }
  });

  it('knows the kind of an event the app wrote by its key', () => {
    expect(hiddenKey('clean:f:1', DEFAULT_CALENDAR_SHOW)).toBe(true);
    expect(hiddenKey('mikvah:f', DEFAULT_CALENDAR_SHOW)).toBe(true);
    for (const key of ['onah:123', 'flow:f', 'hefsek:f']) expect(hiddenKey(key, DEFAULT_CALENDAR_SHOW)).toBe(false);
    expect(hiddenKey('apart:f', DEFAULT_CALENDAR_SHOW)).toBe(true);
    expect(hiddenKey('apart:f', WITH_NIDDAH)).toBe(false);
    expect(hiddenKey('onah:123', { ...DEFAULT_CALENDAR_SHOW, onot: false })).toBe(true);
    expect(hiddenKey('something:else', { onot: false, period: false, hefsek: false, niddah: false, cleanDays: false, mikvah: false })).toBe(false);
  });

  it('a sync removes the events of a kind switched off, even at the far edge of the window', () => {
    const t = timeline([flow, hefsek], at(2026, 11, 27, 10));
    const all = publish(t, ALL).map(e => toDesired(e, TZ));
    const existing = all.map((d, i) => ({ id: `e${i}`, endMs: d.endMs, props: { mk: '1', k: d.key, h: d.hash } }));
    const shown = publish(t, DEFAULT_CALENDAR_SHOW).map(e => toDesired(e, TZ));
    // a window that begins just before everything: every event is at its edge
    const windowStart = Math.min(...all.map(d => d.endMs)) - 1;
    const ops = planSync(shown, existing, windowStart, key => hiddenKey(key, DEFAULT_CALENDAR_SHOW));
    expect(ops.every(o => o.op === 'delete')).toBe(true);
    expect(ops.map(o => (o.op === 'delete' ? o.key : '')).sort()).toEqual(all.filter(d => hiddenKey(d.key, DEFAULT_CALENDAR_SHOW)).map(d => d.key).sort());
    // switched on again: they are added once, beside the ones kept
    const kept = existing.filter(e => !hiddenKey(e.props.k, DEFAULT_CALENDAR_SHOW));
    const again = planSync(all, kept, windowStart, key => hiddenKey(key, ALL));
    expect(again.filter(o => o.op === 'insert')).toHaveLength(all.length - kept.length);
    expect(again.filter(o => o.op !== 'insert')).toEqual([]);
  });
});

describe('wording for the dashboard', () => {
  it('describes where things stand at each stage', () => {
    // Civil dates; the three settings are tested in test/dates.test.ts.
    const lines = (entries: LogEntry[], now: number, lang: 'en' | 'he' = 'en') => statusLines(timeline(entries, now), TZ, lang, 'civil');
    expect(lines([], at(2026, 11, 23, 10))).toEqual({ headline: 'Tehorah', detail: '' });
    expect(lines([], at(2026, 11, 23, 10), 'he')).toEqual({ headline: 'טהורה', detail: '' });
    expect(lines([flow], at(2026, 11, 23, 10))).toEqual({ headline: 'Niddah, before the hefsek taharah', detail: 'Hefsek taharah from Thursday, before 4:33 PM.' });
    // once the first day has passed, the next day it can be done
    expect(lines([flow], at(2026, 11, 27, 10)).detail).toBe('Hefsek taharah from today, before 4:33 PM.');
    // on the afternoon of the hefsek, before sunset; from sunset on it is the first clean day
    expect(lines([flow, hefsek], at(2026, 11, 26, 16))).toEqual({
      headline: 'Niddah, after the hefsek taharah',
      detail: 'The seven clean days begin tomorrow. Mikvah night: Thursday night, Dec 3, after 5:16 PM.',
    });
    expect(lines([flow, hefsek], at(2026, 11, 26, 20))).toEqual({ headline: 'Seven clean days: day 1', detail: 'Mikvah night: Thursday night, Dec 3, after 5:16 PM.' });
    expect(lines([flow, hefsek], at(2026, 11, 29, 10))).toEqual({ headline: 'Seven clean days: day 3', detail: 'Mikvah night: Thursday night, after 5:16 PM.' });
    expect(lines([flow, hefsek], at(2026, 11, 29, 10), 'he')).toEqual({ headline: 'שבעה נקיים: day 3', detail: 'ליל טבילה: Thursday night, after 5:16 PM.' });
    expect(lines([flow, hefsek], at(2026, 12, 3, 19))).toEqual({ headline: 'Mikvah night', detail: 'Immersion after 5:16 PM.' });
    expect(lines([flow, hefsek], at(2026, 12, 3, 19), 'he')).toEqual({ headline: 'ליל טבילה', detail: 'טבילה after 5:16 PM.' });
    // the morning after the mikvah night, with no immersion recorded: tehorah
    expect(lines([flow, hefsek], at(2026, 12, 4, 10))).toEqual({ headline: 'Tehorah', detail: '' });
    for (const now of [at(2026, 11, 23, 10), at(2026, 11, 26, 16), at(2026, 11, 29, 10), at(2026, 12, 3, 19)]) {
      for (const entries of [[flow], [flow, hefsek]]) expect(lines(entries, now).detail.length).toBeLessThanOrEqual(90);
    }
  });

  it('describes each kind of entry', () => {
    expect(entryText(flow, 'en', 'both')).toBe('Flow: Sunday, Nov 22, 2026 (12 Kislev 5787), by day');
    expect(entryText({ id: 'x', kind: 'flow', onah: { abs: SUN, part: 'night' }, veset: false }, 'en', 'both')).toBe(
      'Flow: Saturday night, Nov 21, 2026 (eve of 12 Kislev 5787) (not counted for vesatot)',
    );
    expect(entryText({ id: 'x', kind: 'stain', onah: { abs: SUN, part: 'day' } }, 'he', 'both')).toBe('כתם: Sunday, Nov 22, 2026 (י״ב כסלו תשפ״ז), by day');
    expect(entryText({ id: 'x', kind: 'broken', onah: { abs: SUN, part: 'day' } }, 'en', 'hebrew')).toBe('Count broken: Sunday, 12 Kislev 5787, by day');
    expect(entryText(hefsek, 'en', 'hebrew')).toBe('Hefsek taharah: Thursday, 16 Kislev 5787');
    expect(entryText(hefsek, 'en', 'civil')).toBe('Hefsek taharah: Thursday, Nov 26, 2026');
    // an immersion is stored under the Hebrew date of its night, and shown by the evening
    expect(entryText({ id: 'm', kind: 'mikvah', abs: SUN + 12 }, 'en', 'both')).toBe('Immersion: Thursday night, Dec 3, 2026 (eve of 24 Kislev 5787)');
    // Shabbat by day
    expect(entryText({ id: 'x', kind: 'stain', onah: { abs: SUN + 6, part: 'day' } }, 'en', 'civil')).toBe('Stain: Shabbat, Nov 28, 2026, by day');
  });

  it('has a sentence for every warning, pattern and note, in both forms, with nothing left unfilled', () => {
    const warnings = [
      'hefsek_without_niddah',
      'hefsek_before_start',
      'hefsek_early',
      'broken_without_count',
      'mikvah_without_niddah',
      'mikvah_without_hefsek',
      'mikvah_too_early',
      'mikvah_on_fast_night',
      'count_cancelled_by_flow',
      'period_began_without_hefsek',
    ] as const;
    const notes = ['paused', 'long_cycle_exempt', 'haflagah_previous_hefsek_missing', 'haflagah_awaits_hefsek'] as const;
    for (const lang of ['en', 'he'] as const) {
      const texts = [
        ...warnings.map(w => warningText(w, lang)),
        ...notes.map(n => noteText(n, lang)),
        patternText({ kind: 'kavua_chodesh', dayOfMonth: 12, part: 'day' }, lang),
        patternText({ kind: 'kavua_haflagah', days: 28, part: 'night' }, lang),
        patternText({ kind: 'dilug_haflagah', step: 1, part: 'day' }, lang),
        patternText({ kind: 'dilug_chodesh', step: -2, part: 'night' }, lang),
      ];
      for (const text of texts) {
        expect(text.length).toBeGreaterThan(15);
        expect(text).not.toMatch(/Ask a|רב\b/);
        expect(text).not.toMatch(/[{}]|undefined/);
      }
    }
    expect(patternText({ kind: 'kavua_chodesh', dayOfMonth: 12, part: 'day' }, 'en')).toBe(
      'Three times in a row the flow began on day 12 of the month, by day. A veset kavua for the date may have been established.',
    );
    expect(patternText({ kind: 'dilug_chodesh', step: -2, part: 'night' }, 'en')).toContain('moved by the same step (2 days)');
    expect(patternText({ kind: 'dilug_haflagah', step: 1, part: 'day' }, 'en')).toContain('(1 day)');
  });
});

describe('the calendar feed', () => {
  const events = buildCalendar(timeline([flow], at(2026, 11, 23, 10)), HE);
  const ics = toICalendar(events, 'Betaharah, home', at(2026, 11, 23, 10));
  const lines = ics.split('\r\n');

  it('is a well-formed iCalendar file', () => {
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines.at(-2)).toBe('END:VCALENDAR');
    expect(lines.at(-1)).toBe('');
    expect(ics).not.toMatch(/[^\r]\n/); // every line ends CR LF
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('X-WR-CALNAME:Betaharah\\, home');
    expect(lines).toContain('COLOR:#2A3C6E');
    expect(ics.replace(/\r\n /g, '')).toContain('IMAGE;VALUE=URI;DISPLAY=BADGE;FMTTYPE=image/png:https://betaharah.com/brand/logo-224.png');
    expect(lines.filter(l => l === 'BEGIN:VEVENT')).toHaveLength(events.length);
    expect(lines.filter(l => l === 'END:VEVENT')).toHaveLength(events.length);
    const uids = lines.filter(l => l.startsWith('UID:'));
    expect(new Set(uids).size).toBe(events.length);
    expect(uids).toContain('UID:flow:f@betaharah');
  });

  it('keeps every line within 75 bytes, continuing long ones, without cutting a Hebrew letter in two', () => {
    const bytes = (s: string): number => new TextEncoder().encode(s).length;
    for (const line of lines) expect(bytes(line), line).toBeLessThanOrEqual(75);
    // unfolding gives back the text exactly
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('SUMMARY:הפסק טהרה (by 4:33 PM)');
    expect(unfolded).toContain('DESCRIPTION:Before שקיעה\\; preferably after מנחה קטנה.');
    // a long line with Hebrew letters, folded and unfolded
    expect(unfolded).toMatch(/DESCRIPTION:בדיקה in the morning and before שקיעה \(4:3\d PM\)\.\\nבדיקה on this day is required\.|DESCRIPTION:בדיקה in the morning and before שקיעה \(4:3\d PM\)\.\\nA בדיקה on this day is required\.\\nProjected: if the הפסק טהרה is done on the first day it can be\./);
    expect(lines.some(l => l.startsWith(' ') && /[\u0590-\u05FF]/.test(l))).toBe(true);
    expect(unfolded).not.toContain('�');
  });

  it('writes timed events in UTC and all-day events as dates', () => {
    const unfolded = ics.replace(/\r\n /g, '').split('\r\n');
    const i = unfolded.indexOf('UID:hefsek:f@betaharah');
    expect(unfolded[i + 2]).toBe('DTSTART:20261126T193300Z'); // 2:33 PM in New York
    expect(unfolded[i + 3]).toBe('DTEND:20261126T213300Z'); // 4:33 PM
    const j = unfolded.indexOf('UID:clean:f:1@betaharah');
    expect(unfolded[j + 2]).toBe('DTSTART;VALUE=DATE:20261127');
    expect(unfolded[j + 3]).toBe('DTEND;VALUE=DATE:20261128');
    expect(unfolded[i + 1]).toBe('DTSTAMP:20261123T150000Z');
  });

  it('escapes the characters that have a meaning in the format', () => {
    const one = toICalendar([{ key: 'k;1', kind: 'flow', title: 'a,b;c\\d', description: 'x\ny', timed: { start: 0, end: 60_000 }, projected: false }], 'n', 0);
    expect(one).toContain('SUMMARY:a\\,b\\;c\\\\d');
    expect(one).toContain('DESCRIPTION:x\\ny');
    expect(one).toContain('UID:k_1@betaharah');
  });
});

describe('a calendar app with Hebrew terms', () => {
  const civil = (y: number, m: number, d: number) => civilToAbs({ y, m, d });
  const ALL: CalendarShow = { onot: true, period: true, hefsek: true, niddah: true, cleanDays: true, mikvah: true };
  const scenarios = [
    timeline([flow], at(2026, 11, 23, 10)),
    timeline([flow, hefsek], at(2026, 11, 27, 10)),
    timeline([flow, hefsek, { id: 'm', kind: 'mikvah', abs: SUN + 13 }], at(2026, 12, 6, 10)),
    timeline([flow, { id: 'g', kind: 'flow', onah: { abs: civil(2026, 12, 20), part: 'night' }, veset: true }], at(2026, 12, 21, 10), { orZarua: 'yes' }),
    timeline([{ id: 's', kind: 'stain', onah: { abs: SUN, part: 'night' } }], at(2026, 11, 23, 10)),
  ];

  it('every title and every line is wholly Hebrew: no English letters, begun by a Hebrew letter and kept right-to-left to its end', () => {
    let lines = 0;
    for (const t of scenarios) {
      for (const e of calendarAppEvents(t, ALL, HE)) {
        for (const line of [e.title, ...e.description.split('\n').filter(l => l !== '')]) {
          expect(line, line).not.toMatch(/[A-Za-z]/);
          expect(line, line).toMatch(/^[\u05D0-\u05EA]/);
          expect(line.endsWith('\u200F'), line).toBe(true);
          lines++;
        }
      }
    }
    expect(lines).toBeGreaterThan(60);
  });

  it('says the same as the English: the onah of the owner\'s example', () => {
    const t = timeline([{ id: 'f', kind: 'flow', onah: { abs: civil(2026, 10, 23), part: 'day' }, veset: true }, { id: 'h', kind: 'hefsek', abs: civil(2026, 10, 28) }], at(2026, 10, 30, 12));
    const plain = (e: CalendarEvent) => [e.title, ...e.description.split('\n')].map(l => l.replace(/\u200F/g, ''));
    const onDay = (events: CalendarEvent[], d: number) => events.find(e => e.kind === 'onah' && localDateTime(e.timed!.start, TZ).d === d && localDateTime(e.timed!.start, TZ).hh < 12)!;
    const en = calendarAppEvents(t, DEFAULT_CALENDAR_SHOW, EN);
    const he = calendarAppEvents(t, DEFAULT_CALENDAR_SHOW, HE);
    // when, in plain day words with the hours; what applies; why
    expect(plain(onDay(en, 21))).toEqual(['Onah: Shabbat by day', 'Shabbat by day, 6:49 AM to 4:37 PM', 'Separation and a bedikah', 'Why: day 30 from the last period (onah beinonit)']);
    expect(plain(onDay(he, 21))).toEqual(['עונת פרישה – שבת ביום', 'שבת ביום, מ־6:49 בבוקר עד 4:37', 'פרישה ובדיקה', 'למה: יום 30 מהראייה האחרונה (עונה בינונית)']);
    expect(plain(onDay(en, 22))).toEqual(['Onah: Sunday by day', 'Sunday by day, 6:50 AM to 4:36 PM', 'Separation and a bedikah', 'Why: day 12 of the Hebrew month (veset hachodesh)']);
    expect(plain(onDay(he, 22))).toEqual(['עונת פרישה – יום ראשון ביום', 'יום ראשון ביום, מ־6:50 בבוקר עד 4:36', 'פרישה ובדיקה', 'למה: י״ב בחודש (וסת החודש)']);
  });

  it('an onah kept by Or Zarua or as a full day: each reason once, the customs on their own line, nights by the day of their evening', () => {
    const t = timeline([{ id: 'f', kind: 'flow', onah: { abs: civil(2026, 10, 23), part: 'day' }, veset: true }, { id: 'h', kind: 'hefsek', abs: civil(2026, 10, 28) }], at(2026, 10, 30, 12), { orZarua: 'yes' });
    const plain = (e: CalendarEvent) => [e.title, ...e.description.split('\n')].map(l => l.replace(/\u200F/g, ''));
    const night = (events: CalendarEvent[], d: number) => events.find(e => e.kind === 'onah' && localDateTime(e.timed!.start, TZ).d === d && localDateTime(e.timed!.start, TZ).hh >= 12)!;
    const en = calendarAppEvents(t, DEFAULT_CALENDAR_SHOW, EN);
    const he = calendarAppEvents(t, DEFAULT_CALENDAR_SHOW, HE);
    // Friday 20 November at sunset: the night before the day of the onah beinonit
    expect(plain(night(en, 20))).toEqual(['Onah (Or Zarua): Friday night', 'Friday night, 4:36 PM to 6:50 AM', 'Separation', 'Why: day 30 from the last period (onah beinonit)', 'Custom: Or Zarua (the onah before)']);
    expect(plain(night(he, 20))).toEqual(['עונת פרישה (אור זרוע) – ליל שבת', 'ליל שבת, מ־4:36 עד 6:50 בבוקר', 'פרישה', 'למה: יום 30 מהראייה האחרונה (עונה בינונית)', 'מנהג: אור זרוע (העונה שלפני)']);
    expect(plain(night(en, 21))[0]).toBe('Onah (Or Zarua): Saturday night');
    expect(plain(night(he, 21))[0]).toBe('עונת פרישה (אור זרוע) – מוצאי שבת');
    // no reason is written twice
    for (const e of [...en, ...he].filter(x => x.kind === 'onah')) {
      const why = e.description.split('\n').find(l => /^(Why|למה):/.test(l))!.replace(/^[^:]+: /, '').replace(/\u200F/g, '').split('; ');
      expect(new Set(why).size).toBe(why.length);
    }
  });

  it('the app\'s own events are unchanged by it', () => {
    const t = scenarios[1]!;
    expect(buildCalendar(t, HE).find(e => e.kind === 'hefsek')!.title).toBe('הפסק טהרה ✓');
    expect(buildCalendar(t, HE).find(e => e.kind === 'flow')!.timed).toBeDefined();
  });
});
