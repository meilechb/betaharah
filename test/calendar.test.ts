import { describe, expect, it } from 'vitest';
import { toICalendar } from '../src/app/ics';
import { entryText, noteText, patternText, statusLines, warningText } from '../src/app/wording';
import { buildCalendar, civilDate, fullDate, onahLabel, reasonText, weekday, type CalendarOptions } from '../src/engine/calendar';
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
const EN: CalendarOptions = { style: 'words', lang: 'en', timeZone: TZ };
const HE: CalendarOptions = { style: 'words', lang: 'he', timeZone: TZ };
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
    expect(choicesFor('en')[0]!.title).toBe('Days to wait before the hefsek taharah');
    expect(choicesFor('he')[0]!.title).toBe('Days to wait before the הפסק טהרה');
    // the values the engine reads are never touched by the wording
    expect(choicesFor('he').map(c => c.options.map(o => o.value))).toEqual(HALACHIC_CHOICES.map(c => c.options.map(o => o.value)));
  });
});

describe('dates in words', () => {
  it('names a day by its weekday, Hebrew date and civil date', () => {
    expect(weekday(SUN)).toBe('Sunday');
    expect(weekday(SUN + 6)).toBe('Shabbat');
    expect(civilDate(SUN)).toBe('Nov 22, 2026');
    expect(fullDate(SUN, 'en')).toBe('Sunday, 12 Kislev 5787 (Nov 22, 2026)');
  });

  it('names a night by the evening on which it begins, with the Hebrew date it belongs to', () => {
    // The night of 12 Kislev begins on the evening of Saturday 21 November.
    expect(onahLabel({ abs: SUN, part: 'night' }, 'en')).toBe('The night of Shabbat, Nov 21, 2026 (12 Kislev 5787)');
    expect(onahLabel({ abs: SUN, part: 'day' }, 'en')).toBe('Sunday, 12 Kislev 5787 (Nov 22, 2026), by day');
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
    expect(byKind('flow')[0]!.description).toBe('Sunday, 12 Kislev 5787 (Nov 22, 2026), by day');
    const h = byKind('hefsek')[0]!;
    expect(h.title).toBe('Hefsek taharah (by 4:33 PM)');
    expect(h.projected).toBe(true);
    expect(h.description).toBe('Thursday, 16 Kislev 5787 (Nov 26, 2026)\nBefore sunset: 4:33 PM\nPreferably after minchah ketanah: 2:33 PM');
    expect(h.timed!.end).toBeLessThanOrEqual(dayTimes(SUN + 4, LAKEWOOD, ZOPTS).sunset);
    expect(byKind('clean_day').map(e => e.title)).toEqual([1, 2, 3, 4, 5, 6, 7].map(n => `Seven clean days: day ${n} (projected)`));
    expect(byKind('clean_day').map(e => e.allDay!.startAbs)).toEqual([5, 6, 7, 8, 9, 10, 11].map(n => SUN + n));
    const m = byKind('mikvah')[0]!;
    expect(m.title).toBe('Mikvah night (after 5:16 PM) (projected)');
    expect(m.description).toContain('The night of Thursday, Dec 3, 2026 (24 Kislev 5787)');
    expect(m.description).toContain('Immersion after nightfall: 5:16 PM');
    expect(localDateTime(m.timed!.start, TZ)).toMatchObject({ y: 2026, m: 12, d: 3 });
    expect(m.timed!.start).toBeGreaterThanOrEqual(dayTimes(SUN + 11, LAKEWOOD, ZOPTS).tzeit);
    // 22 November 2026 is 12 Kislev, and Kislev has 30 days this year:
    // day 30 is 21 December (11 Tevet) and veset hachodesh is 22 December (12 Tevet).
    expect(byKind('onah').map(e => e.title)).toEqual(['Veset onah (day)', 'Veset onah (day)']);
    expect(byKind('onah')[0]!.description).toBe(
      'Monday, 11 Tevet 5787 (Dec 21, 2026), by day\nFrom 7:15 AM until 4:35 PM\n\nOnah beinonit (day 30)\n\nSeparation, and a bedikah.',
    );
    expect(byKind('onah')[1]!.description).toContain('Veset hachodesh (day 12 of the month)');
    expect(byKind('onah')[1]!.description).toContain('Tuesday, 12 Tevet 5787 (Dec 22, 2026), by day');
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
    expect(he.find(e => e.kind === 'hefsek')!.description).toBe('Thursday, ט״ז כסלו תשפ״ז (Nov 26, 2026)\nBefore שקיעה: 4:33 PM\nPreferably after מנחה קטנה: 2:33 PM');
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
    expect(m.description).toBe('The night of Friday, Dec 4, 2026 (25 Kislev 5787)');
    expect(localDateTime(m.timed!.start, TZ)).toMatchObject({ m: 12, d: 4 });
  });

  it('separate Or Zarua onot are titled as such, and a night is named by its evening', () => {
    const events = buildCalendar(timeline([flow], at(2026, 11, 23, 10), { orZarua: 'yes' }), EN);
    const onot = events.filter(e => e.kind === 'onah');
    expect(onot.map(e => e.title)).toEqual(['Or Zarua (night)', 'Veset onah (day)', 'Or Zarua (night)', 'Veset onah (day)']);
    expect(onot[0]!.description).toBe(
      'The night of Sunday, Dec 20, 2026 (11 Tevet 5787)\nFrom 4:34 PM until 7:16 AM\n\nOr Zarua of onah beinonit (day 30)\n\nSeparation.',
    );
    expect(onot.map(e => e.light)).toEqual([true, false, true, false]);
  });

  it('discreet style has no words and no descriptions, whichever form of terms is chosen', () => {
    for (const lang of ['en', 'he'] as const) {
      const events = buildCalendar(timeline([flow], at(2026, 11, 23, 10), { orZarua: 'yes' }), { style: 'discreet', lang, timeZone: TZ });
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
    expect(events.find(e => e.key === 'mikvah:a')!.description).toContain('The mikvah night falls on an onat perishah. Ask a rav.');
    expect(events.find(e => e.kind === 'onah' && e.description.includes('This onah falls on the mikvah night. Ask a rav.'))).toBeDefined();
  });
});

describe('wording for the dashboard', () => {
  it('describes where things stand at each stage', () => {
    const lines = (entries: LogEntry[], now: number, lang: 'en' | 'he' = 'en') => statusLines(timeline(entries, now), TZ, lang);
    expect(lines([], at(2026, 11, 23, 10))).toEqual({ headline: 'Tehorah', detail: '' });
    expect(lines([], at(2026, 11, 23, 10), 'he')).toEqual({ headline: 'טהורה', detail: '' });
    expect(lines([flow], at(2026, 11, 23, 10))).toEqual({
      headline: 'Niddah, before the hefsek taharah',
      detail:
        'Began: Sunday, 12 Kislev 5787 (Nov 22, 2026), by day. The hefsek taharah can be done from Thursday, 16 Kislev 5787 (Nov 26, 2026). Next possible day: Thursday, Nov 26, 2026, before 4:33 PM.',
    });
    // a flow at night is named by the evening it began
    expect(lines([{ id: 'n', kind: 'flow', onah: { abs: SUN, part: 'night' }, veset: true }], at(2026, 11, 23, 10)).detail).toMatch(
      /^Began: the night of Shabbat, Nov 21, 2026 \(12 Kislev 5787\)\. /,
    );
    // on the afternoon of the hefsek, before sunset; from sunset on it is the first clean day
    expect(lines([flow, hefsek], at(2026, 11, 26, 16))).toEqual({
      headline: 'Niddah, after the hefsek taharah',
      detail: 'The first of the seven clean days is Friday, Nov 27, 2026. Mikvah night: Thursday, Dec 3, 2026, after 5:16 PM.',
    });
    expect(lines([flow, hefsek], at(2026, 11, 26, 20))).toEqual({ headline: 'Seven clean days: day 1', detail: 'Mikvah night: Thursday, Dec 3, 2026, after 5:16 PM.' });
    expect(lines([flow, hefsek], at(2026, 11, 29, 10))).toEqual({ headline: 'Seven clean days: day 3', detail: 'Mikvah night: Thursday, Dec 3, 2026, after 5:16 PM.' });
    expect(lines([flow, hefsek], at(2026, 11, 29, 10), 'he')).toEqual({ headline: 'שבעה נקיים: day 3', detail: 'ליל טבילה: Thursday, Dec 3, 2026, after 5:16 PM.' });
    expect(lines([flow, hefsek], at(2026, 12, 3, 19))).toEqual({ headline: 'Mikvah night', detail: 'Immersion after nightfall: 5:16 PM.' });
    expect(lines([flow, hefsek], at(2026, 12, 5, 10))).toEqual({
      headline: 'The count is complete; no immersion is recorded',
      detail: 'The mikvah night was Thursday, Dec 3, 2026.',
    });
  });

  it('describes each kind of entry', () => {
    expect(entryText(flow, 'en')).toBe('Flow: Sunday, 12 Kislev 5787 (Nov 22, 2026), by day');
    expect(entryText({ id: 'x', kind: 'flow', onah: { abs: SUN, part: 'night' }, veset: false }, 'en')).toBe(
      'Flow: the night of Shabbat, Nov 21, 2026 (12 Kislev 5787) (not counted for vesatot)',
    );
    expect(entryText({ id: 'x', kind: 'stain', onah: { abs: SUN, part: 'day' } }, 'he')).toBe('כתם: Sunday, י״ב כסלו תשפ״ז (Nov 22, 2026), by day');
    expect(entryText({ id: 'x', kind: 'broken', onah: { abs: SUN, part: 'day' } }, 'en')).toBe('Count broken: Sunday, 12 Kislev 5787 (Nov 22, 2026), by day');
    expect(entryText(hefsek, 'en')).toBe('Hefsek taharah: Thursday, 16 Kislev 5787 (Nov 26, 2026)');
    // an immersion is stored under the Hebrew date of its night, and shown by the evening
    expect(entryText({ id: 'm', kind: 'mikvah', abs: SUN + 12 }, 'en')).toBe('Immersion: the night of Thursday, Dec 3, 2026 (24 Kislev 5787)');
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
        expect(text.length).toBeGreaterThan(20);
        expect(text).not.toMatch(/[{}]|undefined/);
      }
    }
    expect(patternText({ kind: 'kavua_chodesh', dayOfMonth: 12, part: 'day' }, 'en')).toBe(
      'Three times in a row the flow began on day 12 of the month, by day. A veset kavua for the date may have been established. Ask a rav.',
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
    expect(unfolded).toContain('DESCRIPTION:Thursday\\, ט״ז כסלו תשפ״ז (Nov 26\\, 2026)\\nBefore שקיעה: 4:33 PM\\nPreferably after מנחה קטנה: 2:33 PM');
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
