/**
 * Dates in words (src/engine/dates.ts) in the household's three settings,
 * Hebrew, civil and both, on every surface that writes a date: the status,
 * Coming up, the Log, the reminders, the confirmations, the texts; the
 * DATES option by text; and Hebrew dates typed by text.
 */
import { describe, expect, it } from 'vitest';
import { parseDated } from '../src/app/chat';
import { resolveHebrewDate } from '../src/app/chat/dated';
import { calculationState } from '../src/app/dashboard';
import { compute, confirmationText, recordEntry } from '../src/app/household';
import type { HouseholdData } from '../src/app/model';
import { DEFAULT_APP_SETTINGS, parseAppSettings, ValidationError } from '../src/app/settings';
import { entryText, statusLines } from '../src/app/wording';
import { buildCalendar } from '../src/engine/calendar';
import { civilToAbs } from '../src/engine/civil';
import type { LogEntry } from '../src/engine/cycle';
import { DATE_STYLES, dayWords, momentWords, nightWords, onahWords, type DateStyle, type DateWords } from '../src/engine/dates';
import { absOfHebrew } from '../src/engine/hebrew';
import { buildReminders, DEFAULT_REMINDER_OPTIONS, statusMessage, statusText } from '../src/engine/present';
import type { GeoPoint } from '../src/engine/sun';
import { buildTimeline } from '../src/engine/timeline';
import { dayTimes } from '../src/engine/zmanim';
import { at, household, NOW, Phone } from './chat-fixtures';
import { BASIC, withSettings } from './helpers';

const LAKEWOOD: GeoPoint = { latitude: 40.0821, longitude: -74.2097, timeZone: 'America/New_York', elevation: 16 };
const TZ = LAKEWOOD.timeZone;
const abs = (y: number, m: number, d: number): number => civilToAbs({ y, m, d });
/** Tuesday 24 November 2026 (14 Kislev 5787), as in the chat tests. */
const TUE = abs(2026, 11, 24);
const w = (dates: DateStyle, extra: Partial<DateWords> = {}): DateWords => ({ dates, lang: 'en', ...extra });

describe('dates in words', () => {
  it('a daytime: the weekday, then the date as the setting has it', () => {
    expect(dayWords(TUE, w('hebrew'))).toBe('Tue, 14 Kislev');
    expect(dayWords(TUE, w('civil'))).toBe('Tue, Nov 24');
    expect(dayWords(TUE, w('both'))).toBe('Tue, Nov 24 (14 Kislev)');
    expect(dayWords(TUE, w('both', { long: true, year: true }))).toBe('Tuesday, Nov 24, 2026 (14 Kislev 5787)');
    expect(dayWords(TUE, w('hebrew', { lang: 'he' }))).toBe('Tue, י״ד כסלו');
    // Saturday by day is Shabbat, short or long
    expect(dayWords(TUE + 4, w('civil'))).toBe('Shabbat, Nov 28');
    expect(dayWords(TUE + 4, w('civil', { long: true }))).toBe('Shabbat, Nov 28');
  });

  it('a night: the weekday of its evening; its civil date is the evening, its Hebrew date the one that begins then, as its eve', () => {
    // The night of 15 Kislev begins on the evening of Tuesday 24 November.
    expect(nightWords(TUE + 1, w('hebrew'))).toBe('Tue night, eve of 15 Kislev');
    expect(nightWords(TUE + 1, w('civil'))).toBe('Tue night, Nov 24');
    expect(nightWords(TUE + 1, w('both'))).toBe('Tue night, Nov 24 (eve of 15 Kislev)');
    expect(nightWords(TUE + 1, w('both', { long: true, year: true }))).toBe('Tuesday night, Nov 24, 2026 (eve of 15 Kislev 5787)');
    // Friday night stays Friday night; Saturday night is the night after Shabbat
    expect(nightWords(TUE + 4, w('civil'))).toBe('Fri night, Nov 27');
    expect(nightWords(TUE + 5, w('civil', { long: true }))).toBe('Saturday night, Nov 28');
  });

  it('the night before Rosh Chodesh, a night across a civil month and across a civil year, and the eve of a new Hebrew year', () => {
    // 30 Kislev is Thursday 10 December; the night of 1 Tevet begins that evening
    expect(nightWords(abs(2026, 12, 11), w('both'))).toBe('Thu night, Dec 10 (eve of 1 Tevet)');
    expect(dayWords(abs(2026, 12, 10), w('hebrew'))).toBe('Thu, 30 Kislev');
    // the evening of 30 November belongs to 21 Kislev, whose daytime is 1 December
    expect(nightWords(abs(2026, 12, 1), w('both'))).toBe('Mon night, Nov 30 (eve of 21 Kislev)');
    expect(dayWords(abs(2026, 12, 1), w('both'))).toBe('Tue, Dec 1 (21 Kislev)');
    // the evening of 31 December 2026 belongs to 22 Tevet, whose daytime is 1 January 2027
    expect(nightWords(abs(2027, 1, 1), w('both', { year: true }))).toBe('Thu night, Dec 31, 2026 (eve of 22 Tevet 5787)');
    expect(dayWords(abs(2027, 1, 1), w('both', { year: true }))).toBe('Fri, Jan 1, 2027 (22 Tevet 5787)');
    // Rosh Hashanah 5788 begins on the evening of Friday 1 October 2027
    expect(nightWords(abs(2027, 10, 2), w('hebrew', { year: true }))).toBe('Fri night, eve of 1 Tishrei 5788');
    expect(onahWords({ abs: abs(2027, 10, 2), part: 'day' }, w('hebrew', { year: true }), ' by day')).toBe('Shabbat, 1 Tishrei 5788 by day');
  });

  it('today, tonight, tomorrow, tomorrow night, yesterday and last night, when exact as of now', () => {
    for (const dates of DATE_STYLES) {
      const now = w(dates, { today: TUE });
      expect(dayWords(TUE, now)).toBe('today');
      expect(dayWords(TUE + 1, now)).toBe('tomorrow');
      expect(dayWords(TUE - 1, now)).toBe('yesterday');
      expect(nightWords(TUE + 1, now)).toBe('tonight');
      expect(nightWords(TUE + 2, now)).toBe('tomorrow night');
      expect(nightWords(TUE, now)).toBe('last night');
    }
  });

  it('within the coming six days the weekday alone; from the seventh day, and in the past, the weekday and the date', () => {
    const now = w('both', { today: TUE, long: true });
    expect(dayWords(TUE + 2, now)).toBe('Thursday');
    expect(dayWords(TUE + 4, now)).toBe('Shabbat');
    expect(dayWords(TUE + 6, now)).toBe('Monday');
    expect(dayWords(TUE + 7, now)).toBe('Tuesday, Dec 1 (21 Kislev)');
    expect(nightWords(TUE + 7, now)).toBe('Monday night');
    expect(nightWords(TUE + 8, now)).toBe('Tuesday night, Dec 1 (eve of 22 Kislev)');
    expect(dayWords(TUE - 2, now)).toBe('Sunday, Nov 22 (12 Kislev)');
    expect(nightWords(TUE - 1, now)).toBe('Sunday night, Nov 22 (eve of 13 Kislev)');
    // without "now" (the Log, calendar descriptions) every date is in full
    expect(dayWords(TUE, w('civil'))).toBe('Tue, Nov 24');
  });

  it('where the words may be read on another day, no "today" or "tomorrow"', () => {
    const maybeLater = w('civil', { today: TUE, relative: false });
    expect(dayWords(TUE, maybeLater)).toBe('Tue');
    expect(dayWords(TUE + 1, maybeLater)).toBe('Wed');
    expect(nightWords(TUE + 1, maybeLater)).toBe('Tue night');
    expect(dayWords(TUE - 1, maybeLater)).toBe('Mon, Nov 23');
  });

  it('a moment with a clock time: after sunset, its night', () => {
    expect(momentWords(TUE, TUE, w('civil', { today: TUE }))).toBe('today');
    expect(momentWords(TUE, TUE + 1, w('civil', { today: TUE }))).toBe('tonight');
    expect(momentWords(TUE, TUE + 1, w('hebrew'))).toBe('Tue night, eve of 15 Kislev');
  });
});

describe('the setting', () => {
  it('is Hebrew by default, and an account saved before there was a choice reads as Hebrew', () => {
    expect(DEFAULT_APP_SETTINGS.dates).toBe('hebrew');
    const { dates: _, ...old } = DEFAULT_APP_SETTINGS;
    expect(parseAppSettings(old).dates).toBe('hebrew');
    for (const dates of DATE_STYLES) expect(parseAppSettings({ ...DEFAULT_APP_SETTINGS, dates }).dates).toBe(dates);
  });

  it('is checked when saved', () => {
    expect(() => parseAppSettings({ ...DEFAULT_APP_SETTINGS, dates: 'gregorian' })).toThrow(ValidationError);
    expect(() => parseAppSettings({ ...DEFAULT_APP_SETTINGS, dates: null })).toThrow(ValidationError);
  });
});

// ---------- the surfaces ----------

const flow: LogEntry = { id: 'f', kind: 'flow', onah: { abs: abs(2026, 11, 22), part: 'day' }, veset: true };
const hefsek: LogEntry = { id: 'h', kind: 'hefsek', abs: abs(2026, 11, 26) };
const localAt = (y: number, m: number, d: number, hh: number): number => at(y, m, d, hh);
const timeline = (entries: LogEntry[], now: number) => buildTimeline({ entries, settings: withSettings({}), place: LAKEWOOD, useElevation: false, now });

describe('the status', () => {
  it('on the page: near dates by weekday alone in every setting; the mikvah night a week ahead with its date', () => {
    for (const dates of DATE_STYLES) {
      expect(statusLines(timeline([flow], localAt(2026, 11, 23, 10)), TZ, 'en', dates).detail).toBe('Hefsek taharah from Thursday, before 4:33 PM.');
    }
    const after = (dates: DateStyle, lang: 'en' | 'he' = 'en') => statusLines(timeline([flow, hefsek], localAt(2026, 11, 26, 16)), TZ, lang, dates).detail;
    expect(after('hebrew')).toBe('The seven clean days begin tomorrow. Mikvah night: Thursday night, eve of 24 Kislev, after 5:16 PM.');
    expect(after('civil')).toBe('The seven clean days begin tomorrow. Mikvah night: Thursday night, Dec 3, after 5:16 PM.');
    expect(after('both')).toBe('The seven clean days begin tomorrow. Mikvah night: Thursday night, Dec 3 (eve of 24 Kislev), after 5:16 PM.');
    expect(after('hebrew', 'he')).toBe('The שבעה נקיים begin tomorrow. ליל טבילה: Thursday night, eve of כ״ד כסלו, after 5:16 PM.');
  });

  it('by text, in English letters', () => {
    const t = timeline([flow, hefsek], localAt(2026, 11, 26, 16));
    expect(statusText(t, TZ, 'hebrew')).toBe('Clean days begin tomorrow. Mikvah Thu night, eve of 24 Kislev after 5:16 PM.');
    expect(statusText(t, TZ, 'civil')).toBe('Clean days begin tomorrow. Mikvah Thu night, Dec 3 after 5:16 PM.');
    expect(statusText(t, TZ, 'both')).toBe('Clean days begin tomorrow. Mikvah Thu night, Dec 3 (eve of 24 Kislev) after 5:16 PM.');
    // a period that began last night, by its evening
    const night: LogEntry = { id: 'n', kind: 'flow', onah: { abs: abs(2026, 11, 24), part: 'night' }, veset: true };
    expect(statusMessage(timeline([night], localAt(2026, 11, 24, 10)), TZ, 'hebrew').vars.start).toBe('last night');
    expect(statusMessage(timeline([night], localAt(2026, 11, 27, 10)), TZ, 'hebrew').vars.start).toBe('Mon night, eve of 14 Kislev');
  });
});

describe('the reminders', () => {
  const CTX = { place: LAKEWOOD, zopts: { useElevation: false, tzeit: BASIC.tzeit }, yomTov: 'diaspora' as const };
  const texts = (dates: DateStyle, now: number, opts = DEFAULT_REMINDER_OPTIONS) => buildReminders(timeline([flow, hefsek], now), opts, { ...CTX, dates });

  it('name the day as of when they are sent, the same in every setting when it is near', () => {
    for (const dates of DATE_STYLES) {
      const r = texts(dates, localAt(2026, 11, 26, 18));
      expect(r.find(x => x.kind === 'bedikah_morning')!.text).toMatch(/^Clean day 1 of 7 is today: /);
      expect(r.find(x => x.kind === 'mikvah')!.text).toMatch(/^Mikvah night: tonight, after 5:1\d PM\.$/);
      expect(r.find(x => x.kind === 'mikvah_book')!.text).toMatch(/^Book the mikvah: mikvah night is Thu night, after 5:1\d PM\.$/);
    }
  });

  it('an onah reminder that may go out after midnight names its days by weekday, never "tomorrow"', () => {
    const late = { ...DEFAULT_REMINDER_OPTIONS, onah: { on: true, minutesBefore: 600 } };
    const fourNights = buildTimeline({ entries: [flow], settings: withSettings({}), place: LAKEWOOD, useElevation: false, now: localAt(2026, 12, 18, 10) });
    const onah = buildReminders(fourNights, late, { ...CTX, dates: 'civil' }).filter(x => x.kind === 'onah');
    expect(onah.length).toBeGreaterThan(0);
    for (const r of onah) {
      const sameDay = Math.floor((r.at - localAt(2026, 1, 1, 0)) / 86_400_000) === Math.floor((r.until - 1 - localAt(2026, 1, 1, 0)) / 86_400_000);
      if (!sameDay) expect(r.text).not.toMatch(/today|tonight|tomorrow/);
    }
    // each text is GSM-7 and one segment in every setting
    for (const dates of DATE_STYLES) {
      for (const r of buildReminders(fourNights, late, { ...CTX, dates })) {
        expect(r.text).toMatch(/^[A-Za-z0-9 .,:;()\-/]+$/);
        expect(r.text.length).toBeLessThanOrEqual(160);
      }
    }
  });
});

/** A household with a location and the given entries. */
function withEntries(dates: DateStyle, entries: LogEntry[], terms: 'en' | 'he' = 'en'): HouseholdData {
  const data = household();
  data.app.dates = dates;
  data.app.terms = terms;
  data.entries = entries.map(entry => ({ entry, source: 'web', note: null, createdAt: 0 }));
  return data;
}

describe('Coming up, the Log and the calendar on the page', () => {
  const now = localAt(2026, 11, 26, 16);

  it('Coming up: within six days the weekday alone, farther with the date; a night is named once', () => {
    const when = (dates: DateStyle) => {
      const data = withEntries(dates, [flow, hefsek]);
      return calculationState(data, compute(data, now), now).upcoming;
    };
    for (const dates of DATE_STYLES) {
      const up = when(dates);
      expect(up.find(e => e.key === 'clean:f:1')!.when).toBe('tomorrow');
      expect(up.find(e => e.key === 'clean:f:6')!.when).toBe('Wednesday');
    }
    expect(when('hebrew').find(e => e.key === 'clean:f:7')!.when).toBe('Thursday, 23 Kislev');
    expect(when('civil').find(e => e.key === 'clean:f:7')!.when).toBe('Thursday, Dec 3');
    expect(when('both').find(e => e.key === 'clean:f:7')!.when).toBe('Thursday, Dec 3 (23 Kislev)');
    expect(when('both').find(e => e.kind === 'mikvah')!.when).toBe('Thursday night, Dec 3 (eve of 24 Kislev), after 5:16 PM');
    // the hefsek of today, between minchah ketanah and sunset: one daytime, named once
    expect(when('civil').find(e => e.kind === 'hefsek')!.when).toBe('today, 2:33 PM to 4:33 PM');
    // onot a month ahead: a daytime, or a night named once from sunset to sunrise
    const onot = when('hebrew').filter(e => e.kind === 'onah');
    expect(onot.length).toBeGreaterThan(0);
    for (const o of onot) expect(o.when).toMatch(/^\w+day( night)?, (eve of )?\d+ \w+, \d+:\d\d [AP]M to \d+:\d\d [AP]M$/);
  });

  it('the Log: the weekday and the date in full, in the terms language', () => {
    const night: LogEntry = { id: 'n', kind: 'flow', onah: { abs: abs(2027, 1, 1), part: 'night' }, veset: true };
    expect(entryText(night, 'en', 'hebrew')).toBe('Flow: Thursday night, eve of 22 Tevet 5787');
    expect(entryText(night, 'en', 'civil')).toBe('Flow: Thursday night, Dec 31, 2026');
    expect(entryText(night, 'en', 'both')).toBe('Flow: Thursday night, Dec 31, 2026 (eve of 22 Tevet 5787)');
    expect(entryText(night, 'he', 'hebrew')).toBe('ראייה: Thursday night, eve of כ״ב טבת תשפ״ז');
    const data = withEntries('both', [flow]);
    expect(calculationState(data, compute(data, now), now).entries[0]!.text).toBe('Flow: Sunday, Nov 22, 2026 (12 Kislev 5787), by day');
  });

  it('the calendar events are the same in every setting (their descriptions name no date)', () => {
    const t = timeline([flow, hefsek], now);
    const make = (dates: DateStyle) => buildCalendar(t, { style: 'words', lang: 'en', timeZone: TZ, dates });
    expect(make('civil')).toEqual(make('hebrew'));
    expect(make('both')).toEqual(make('hebrew'));
  });

  it('today, in words with its date as the setting has it', () => {
    const data = withEntries('both', [flow]);
    expect(calculationState(data, compute(data, now), now).today!.text).toBe('Thursday, Nov 26 (16 Kislev)');
    const evening = localAt(2026, 11, 26, 20);
    expect(calculationState(data, compute(data, evening), evening).today!.text).toBe('Thursday night, Nov 26 (eve of 17 Kislev)');
  });
});

describe('confirmations', () => {
  it('on the website, as of now, in each setting', () => {
    const results = DATE_STYLES.map(dates => {
      const data = withEntries(dates, [flow]);
      const r = recordEntry(data, { kind: 'hefsek', abs: abs(2026, 11, 26) }, 'web', null, localAt(2026, 11, 26, 16));
      if (!r.ok) throw new Error(r.reason);
      return confirmationText(r, null);
    });
    expect(results).toEqual([
      'Recorded: hefsek today. Clean days from tomorrow. Mikvah Thu night, eve of 24 Kislev after 5:16 PM.',
      'Recorded: hefsek today. Clean days from tomorrow. Mikvah Thu night, Dec 3 after 5:16 PM.',
      'Recorded: hefsek today. Clean days from tomorrow. Mikvah Thu night, Dec 3 (eve of 24 Kislev) after 5:16 PM.',
    ]);
  });
});

// ---------- by text ----------

describe('DATES by text', () => {
  it('shows the setting with HEBREW, CIVIL and BOTH, changes it with a confirmation, and the texts follow', () => {
    const data = household();
    data.app.dates = 'hebrew';
    const p = new Phone(data);
    expect(p.say('dates')).toBe('Dates in texts, the calendar and on the website: Hebrew.');
    expect(p.options()).toEqual(['HEBREW', 'CIVIL', 'BOTH']);
    expect(p.say('both')).toBe('Changed: dates are Hebrew and civil, e.g. Tue, Nov 24 (14 Kislev).');
    expect(data.app.dates).toBe('both');
    expect(p.say('dates both')).toBe('Dates are already Hebrew and civil. Nothing was changed.');
    expect(p.say('dates civil')).toBe('Changed: dates are civil, e.g. Tue, Nov 24.');
    expect(data.app.dates).toBe('civil');
    // under SETTINGS, with TERMS
    p.say('more');
    p.say('settings');
    expect(p.options()).toContain('DATES');
    expect(p.say('dates')).toBe('Dates in texts, the calendar and on the website: civil.');
    expect(p.say('hebrew')).toBe('Changed: dates are Hebrew, e.g. Tue, 14 Kislev.');
    expect(data.app.dates).toBe('hebrew');
    // a date in a reply follows it
    expect(p.say('period 11/22 day')).toMatch(/^Recorded: flow Sun, 12 Kislev 5787 by day\./);
  });

  it('a reply with dates fits one SMS in every setting', () => {
    for (const dates of DATE_STYLES) {
      const data = household();
      data.app.dates = dates;
      const p = new Phone(data);
      p.say('period 11/22 day');
      for (const out of [p.send('hefsek 11/26'), p.send('status'), p.send('history')]) {
        for (const m of out.out) {
          expect(m.text).toMatch(/^[A-Za-z0-9 .,:;()\-/?\n']+$/);
          expect(m.text.length, m.text).toBeLessThanOrEqual(160);
        }
      }
    }
  });
});

describe('Hebrew dates typed by text', () => {
  const parse = (kind: 'flow' | 'hefsek' | 'mikvah', text: string) => parseDated(kind, text.split(' '));

  it('reads the day and the month in English letters, with the usual spellings', () => {
    expect(parse('flow', '15 kislev day')).toEqual({ kind: 'ok', code: 'flow', date: { m: 9, d: 15, y: null, hebrew: { adar: null } }, when: { type: 'part', part: 'day' } });
    expect(parse('hefsek', '3 teves')).toMatchObject({ kind: 'ok', date: { m: 10, d: 3 } });
    expect(parse('hefsek', "3 sh'vat")).toMatchObject({ kind: 'ok', date: { m: 11, d: 3 } });
    expect(parse('hefsek', '3 cheshvan')).toMatchObject({ kind: 'ok', date: { m: 8, d: 3 } });
    expect(parse('hefsek', '3 tishrei')).toMatchObject({ kind: 'ok', date: { m: 7, d: 3 } });
    expect(parse('hefsek', '3 adar')).toMatchObject({ kind: 'ok', date: { m: 12, d: 3, hebrew: { adar: 'plain' } } });
    expect(parse('hefsek', '3 adar ii')).toMatchObject({ kind: 'ok', date: { m: 12, d: 3, hebrew: { adar: 'second' } } });
    expect(parse('hefsek', '3 adar2')).toMatchObject({ kind: 'ok', date: { m: 12, d: 3, hebrew: { adar: 'second' } } });
    expect(parse('hefsek', '3 adar 1')).toMatchObject({ kind: 'ok', date: { m: 12, d: 3, hebrew: { adar: 'first' } } });
    expect(parse('flow', '15 kislev 9pm')).toMatchObject({ kind: 'ok', when: { type: 'time', minutes: 21 * 60 } });
    expect(parse('flow', '15 kislev')).toEqual({ kind: 'error', problem: { key: 'date.needs_onah' } });
    expect(parse('flow', '31 kislev day')).toEqual({ kind: 'error', problem: { key: 'date.no_such', vars: { date: '31 Kislev' } } });
    expect(parse('flow', '15 days')).toEqual({ kind: 'none' });
  });

  it('means the most recent such date that has begun', () => {
    const today = abs(2026, 11, 24); // 14 Kislev 5787
    expect(resolveHebrewDate({ m: 9, d: 14, y: null, hebrew: { adar: null } }, today)).toEqual({ ok: true, abs: today });
    // 15 Kislev 5787 has not begun: last year's
    expect(resolveHebrewDate({ m: 9, d: 15, y: null, hebrew: { adar: null } }, today)).toEqual({ ok: true, abs: absOfHebrew({ yy: 5786, mm: 9, dd: 15 }) });
    // 5787 is a leap year: plain Adar is not guessed; Adar of 5786 had no I or II
    const spring = absOfHebrew({ yy: 5787, mm: 13, dd: 20 });
    expect(resolveHebrewDate({ m: 12, d: 3, y: null, hebrew: { adar: 'plain' } }, spring)).toEqual({ ok: false, reason: 'adar' });
    expect(resolveHebrewDate({ m: 12, d: 3, y: null, hebrew: { adar: 'second' } }, spring)).toEqual({ ok: true, abs: absOfHebrew({ yy: 5787, mm: 13, dd: 3 }) });
    expect(resolveHebrewDate({ m: 12, d: 3, y: null, hebrew: { adar: 'first' } }, spring)).toEqual({ ok: true, abs: absOfHebrew({ yy: 5787, mm: 12, dd: 3 }) });
    expect(resolveHebrewDate({ m: 12, d: 3, y: null, hebrew: { adar: 'plain' } }, today)).toEqual({ ok: true, abs: absOfHebrew({ yy: 5786, mm: 12, dd: 3 }) });
  });

  it('records as the civil dates do; a Hebrew date’s night is the night before its day', () => {
    const data = household();
    data.app.dates = 'hebrew';
    const p = new Phone(data);
    expect(p.say('period 12 kislev day')).toMatch(/^Recorded: flow Sun, 12 Kislev 5787 by day\./);
    expect(data.entries.at(-1)!.entry).toMatchObject({ kind: 'flow', onah: { abs: abs(2026, 11, 22), part: 'day' } });
    p.say('undo');
    expect(p.say('period 12 kislev night')).toMatch(/^Recorded: flow Sat night, eve of 12 Kislev 5787\./);
    expect(data.entries.at(-1)!.entry).toMatchObject({ kind: 'flow', onah: { abs: abs(2026, 11, 22), part: 'night' } });
    p.say('undo');
    // 9 PM within 13 Kislev is on the evening of Sunday 22 November
    expect(p.say('period 13 kislev 9pm')).toMatch(/^Recorded: flow Sun night, eve of 13 Kislev 5787\./);
    expect(data.entries.at(-1)!.entry).toMatchObject({ onah: { abs: abs(2026, 11, 23), part: 'night' } });
    // 10 AM within 13 Kislev is on Monday 23 November
    p.say('undo');
    expect(p.say('stain 13 kislev 10am')).toMatch(/^Recorded: stain Mon, 13 Kislev 5787 by day\./);
    p.say('undo');
    expect(p.say('period 9 kislev day')).toMatch(/^Recorded: flow Thu, 9 Kislev 5787 by day\./);
    expect(p.say('hefsek 13 kislev')).toMatch(/^Recorded: hefsek Mon, 13 Kislev 5787\./);
    expect(data.entries.at(-1)!.entry).toMatchObject({ kind: 'hefsek', abs: abs(2026, 11, 23) });
  });

  it('an immersion on the night of a Hebrew date, a time not yet come, and Adar in a leap year', () => {
    const data = household();
    const p = new Phone(data, at(2026, 12, 10, 12));
    p.say('period 11/22 day');
    p.say('hefsek 11/26');
    // the mikvah night of 24 Kislev began on the evening of 3 December
    p.send('MORE');
    p.send('OTHER ENTRIES');
    p.send('IMMERSION');
    p.send('ANOTHER DAY');
    expect(p.say('24 kislev')).toMatch(/^Recorded: mikvah Thu night, Dec 3, 2026\./);
    expect(data.entries.at(-1)!.entry).toMatchObject({ kind: 'mikvah', abs: abs(2026, 12, 4) });
    // in the evening the Hebrew date is tomorrow's: its night has begun, its day has not
    const evening = new Phone(household(), at(2026, 11, 24, 20));
    expect(evening.say('period 15 kislev night')).toMatch(/^Recorded: flow Tue night, Nov 24, 2026\./); // a date typed is repeated in full
    expect(evening.say('stain 15 kislev day')).toBe('Not recorded: that time has not come yet. (Read as Wed, Nov 25, 2026.)');
    const spring = new Phone(household(), at(2027, 3, 30, 12));
    expect(spring.say('hefsek 3 adar')).toBe('This year has Adar I and Adar II: which one? E.g. 3 Adar II. Nothing was changed.');
  });

  it('at noon of a day, sunset is later than the time typed', () => {
    // the check above relies on 10 AM being before sunset and 9 PM after it
    const where = { latitude: 40.0821, longitude: -74.2097, timeZone: TZ, elevation: 0 };
    const t = dayTimes(abs(2026, 11, 22), where, { useElevation: false, tzeit: BASIC.tzeit });
    expect(t.sunset).toBeLessThan(at(2026, 11, 22, 21));
    expect(t.sunset).toBeGreaterThan(at(2026, 11, 22, 10));
    expect(NOW).toBe(at(2026, 11, 24, 12));
  });
});
