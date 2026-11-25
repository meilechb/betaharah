/** The data the dashboard page shows, prepared on the server. */
import { civilDate, weekday } from '../engine/calendar';
import { absToCivil, civilToAbs, localAbs, localToInstant } from '../engine/civil';
import type { LogEntry } from '../engine/cycle';
import { dayWords, momentWords, nightWords, onahWords, type DateWords } from '../engine/dates';
import { clock12 } from '../engine/present';
import { choicesFor, TZEIT_TITLE, tzeitPresetsFor } from '../engine/settings';
import { allTerms, capital, fill, hebrewDate } from '../engine/terms';
import { onahAt } from '../engine/zmanim';
import type { Session } from './auth';
import { NO_TEXTS, optionsOf, type SiteTexts } from './chat/site-texts';
import { resolveHefsekDay } from './commands';
import { buildGrid, isoDate, type Grid } from './grid';
import type { Computed, DraftEntry, Where } from './household';
import { canText, donateReady, googleReady, MAX_PHONES, smsReady, type HouseholdData, type Site } from './model';
import { textsThisMonth } from './queue';
import { PLACES, REMINDER_KINDS, ValidationError } from './settings';
import { entryText, noteText, patternText, statusLines, warningText } from './wording';

/** The dashboard lists this many of the most recent entries. */
const MAX_LISTED_ENTRIES = 150;

/** The texting number the test account shows while the site has none of its own (a fictional number). */
export const DEMO_TEXTING_NUMBER = '+18885550100';

/** For this long after signing in, a session may change how the account is signed in to (its password). */
export const FRESH_MS = 15 * 60_000;

export interface UpcomingItem {
  key: string;
  kind: string;
  title: string;
  description: string;
  when: string;
  /** The civil date it begins on, 'YYYY-MM-DD' (a night: the evening it begins). */
  date: string;
  /** The civil date it ends on, 'YYYY-MM-DD' (the same as `date` for most). */
  endDate: string;
  projected: boolean;
  light: boolean;
}

/** Where the household stands, as a key for the page (the timeline's phase); `day` only while counting. */
export type StatusPhase = 'tehorah' | 'before_hefsek' | 'before_first_day' | 'counting' | 'postponed' | 'mikvah_tonight';

/**
 * The main options by text, for the page (Settings, Texting, and Today):
 * the labels of the main menu in the operator's wording. Any message's
 * options can be answered by word; there are no digit commands.
 */
const MAIN_MEANINGS = ['a period began: the reply asks when', 'the hefsek is done: the reply asks which day', 'where things stand', 'history, undo, a stain, settings, the account'];

export function mainOptions(texts: SiteTexts | undefined): string[] {
  return optionsOf(texts ?? NO_TEXTS, 'menu.main').map(([, label]) => label);
}

export interface StateArgs {
  data: HouseholdData;
  computed: Computed | null;
  site: Site;
  session: Session;
  /** The number of the phone this session signed in with. */
  myNumber: string | null;
  now: number;
  origin: string;
}

/**
 * The parts of the dashboard's data that come from the calculation: where
 * things stand, today, the alerts, what is coming up, the reminders, the
 * month calendar and the list of entries. The dashboard (dashboardState)
 * and the calculation test (sandbox.ts) both build them here.
 */
export function calculationState(data: HouseholdData, computed: Computed | null, now: number) {
  const lang = data.app.terms;
  const tz = computed?.place.timeZone ?? 'UTC';
  const f = (template: string): string => fill(template, lang);

  const alerts: Array<{ level: 'warn' | 'info'; text: string }> = [];
  if (data.sync.lastError) alerts.push({ level: 'warn', text: `Google Calendar: ${data.sync.lastError}` });

  let status: { headline: string; detail: string; phase: StatusPhase; day: number | null } | null = null;
  let upcoming: UpcomingItem[] = [];
  let reminders: Array<{ at: number; when: string; kind: string; text: string }> = [];
  let today: { hebrew: string; civil: string; text: string; part: 'night' | 'day'; date: string; civilDate: string } | null = null;
  let grid: Grid | null = null;
  if (computed) {
    const t = computed.timeline;
    const phase = t.status.state === 'tehorah' ? null : t.status.phase;
    status = { ...statusLines(t, tz, lang, data.app.dates), phase: phase ? phase.kind : 'tehorah', day: phase && phase.kind === 'counting' ? phase.day : null };
    // The note about a period that began with no hefsek recorded before it is shown for the latest period only:
    // an older one is history.
    const latestStart = t.periods.length > 0 ? t.periods[t.periods.length - 1]!.startId : null;
    for (const w of t.warnings) {
      if (w.code === 'period_began_without_hefsek' && w.entryId !== latestStart) continue;
      alerts.push({ level: 'warn', text: warningText(w.code, lang) });
    }
    for (const p of t.patterns) alerts.push({ level: 'warn', text: patternText(p, lang) });
    for (const n of t.vesatotNotes) alerts.push({ level: 'info', text: noteText(n, lang) });
    if (t.onot.some(o => o.onMikvahNight && o.end > now)) {
      alerts.push({ level: 'warn', text: f('The {mikvah_night} falls on an {onat_perishah}.') });
    }
    const civilToday = localAbs(now, tz);
    // Coming up and the reminders: long weekdays, relative to today.
    const w: DateWords = { dates: data.app.dates, lang, long: true, today: civilToday };
    /**
     * The words for a moment with a clock time: after sunset, its night. A
     * time is rounded to the minute: a start may be up to a minute before
     * the true moment, an end up to a minute after it.
     */
    const onahOf = (ms: number): { abs: number; part: 'night' | 'day' } => onahAt(ms, computed.place, computed.zopts).onah;
    const momentText = (ms: number): string => momentWords(localAbs(ms, tz), onahOf(ms).abs, w);
    today = {
      hebrew: `${weekday(t.nowOnah.abs)}, ${hebrewDate(t.nowOnah.abs, lang)}`,
      civil: civilDate(civilToday),
      // The onah it is now, in words with its date as the household chooses: "Monday night, eve of 14 Kislev".
      text: onahWords(t.nowOnah, { dates: data.app.dates, lang, long: true }),
      part: t.nowOnah.part,
      // The daytime of the Hebrew date it is now (after sunset: tomorrow's civil date), and the civil date.
      date: isoDate(t.nowOnah.abs),
      civilDate: isoDate(civilToday),
    };
    const endOf = (e: Computed['events'][number]): number =>
      e.timed ? e.timed.end : localToInstant({ ...absToCivil(e.allDay!.endAbsExclusive), hh: 0, mi: 0, ss: 0 }, tz);
    const startOf = (e: Computed['events'][number]): number =>
      e.timed ? e.timed.start : localToInstant({ ...absToCivil(e.allDay!.startAbs), hh: 0, mi: 0, ss: 0 }, tz);
    upcoming = computed.events
      .filter(e => endOf(e) > now)
      .sort((a, b) => startOf(a) - startOf(b))
      .slice(0, 60)
      .map(e => {
        let when: string;
        let a: number;
        let b: number;
        if (e.timed) {
          a = localAbs(e.timed.start, tz);
          // The end is exclusive: an event that ends at midnight ends on the day before.
          b = e.timed.end > e.timed.start ? localAbs(e.timed.end - 1, tz) : a;
          const from = clock12(e.timed.start, tz, 'floor');
          const to = clock12(e.timed.end, tz, 'ceil');
          if (e.kind === 'mikvah') {
            // The calendar event has a length only so that calendar apps show it; immersion is any time after nightfall.
            b = a;
            when = `${momentText(e.timed.start + 59_999)}, after ${clock12(e.timed.start, tz, 'ceil')}`;
          } else {
            // Within one onah (a night, or a daytime): named once. "Wednesday night, 4:12 PM to 7:01 AM"
            const first = onahOf(e.timed.start + 59_999);
            const last = onahOf(Math.max(e.timed.start, e.timed.end - 60_000));
            when =
              first.abs === last.abs && first.part === last.part
                ? `${onahWords(first, w)}, ${from} to ${to}`
                : `${from} ${momentText(e.timed.start + 59_999)} to ${to} ${momentText(Math.max(e.timed.start, e.timed.end - 60_000))}`;
          }
        } else {
          a = e.allDay!.startAbs;
          b = e.allDay!.endAbsExclusive - 1;
          when = a === b ? dayWords(a, w) : `${dayWords(a, w)} to ${dayWords(b, w)}`;
        }
        return { key: e.key, kind: e.kind, title: e.title, description: e.description, when, date: isoDate(a), endDate: isoDate(b), projected: e.projected, light: e.light === true };
      });
    reminders = computed.reminders
      .filter(r => r.at > now)
      .slice(0, 30)
      .map(r => {
        return { at: r.at, when: `${momentText(r.at)}, ${clock12(r.at, tz, 'floor')}`, kind: r.kind, text: r.text };
      });
    grid = buildGrid(computed, { lang, dates: data.app.dates, style: data.app.calendar.style, yomTov: data.halachic.yomTov, now });
  }

  return {
    now,
    timeZone: tz,
    terms: lang,
    words: allTerms(lang),
    today,
    status,
    alerts,
    upcoming,
    reminders,
    /** The month calendar's days and events; null while no location is set. */
    grid,
    entryCount: data.entries.length,
    // newest first; the page lists the most recent ones
    entries: [...data.entries]
      .sort((a, b) => {
        const pa = 'onah' in a.entry ? a.entry.onah.abs : a.entry.abs;
        const pb = 'onah' in b.entry ? b.entry.onah.abs : b.entry.abs;
        return pb - pa || b.createdAt - a.createdAt;
      })
      .slice(0, MAX_LISTED_ENTRIES)
      .map(e => ({
        id: e.entry.id,
        kind: e.entry.kind,
        text: entryText(e.entry, lang, data.app.dates),
        ...entryWhen(e.entry),
        source: e.source,
        note: e.note,
        createdAt: e.createdAt,
      })),
  };
}

/**
 * The civil date an entry is shown on, and 'day' or 'night' for the kinds
 * that have one: the same date and part that recording it takes (see
 * draftFromForm). A night, and an immersion, are on the date of the evening.
 */
export function entryWhen(e: LogEntry): { date: string; part: 'day' | 'night' | '' } {
  if (e.kind === 'hefsek') return { date: isoDate(e.abs), part: '' };
  if (e.kind === 'mikvah') return { date: isoDate(e.abs - 1), part: '' };
  return { date: isoDate(e.onah.part === 'night' ? e.onah.abs - 1 : e.onah.abs), part: e.onah.part };
}

/** The names of the kinds of entries, as the Record form and the Log show them. */
export function kindLabels(lang: HouseholdData['app']['terms']) {
  const f = (template: string): string => fill(template, lang);
  return {
    flow: capital(f('{flow}')),
    stain: capital(f('{stain}')),
    hefsek: capital(f('{hefsek}')),
    broken: 'Count broken',
    mikvah: capital(f('{immersion}')),
  };
}

export function dashboardState(args: StateArgs) {
  const { data, computed, site, session, now, origin } = args;
  const lang = data.app.terms;
  const f = (template: string): string => fill(template, lang);
  const calc = calculationState(data, computed, now);

  const texting = data.phones.some(canText);
  const setup = [
    { key: 'place', done: data.app.place !== null, text: 'Choose your location', tab: 'settings' },
    { key: 'customs', done: data.halachicConfirmedAt !== null, text: 'Save your customs', tab: 'customs' },
    { key: 'entry', done: data.entries.length > 0, text: f('Record when the last period began, and its {hefsek}'), tab: 'today' },
    { key: 'calendar', done: data.google !== null || data.calendarLinkToken !== null, text: 'Optional: show it in your calendar app', tab: 'settings' },
    { key: 'texts', done: texting, text: 'Optional: turn on text reminders', tab: 'settings' },
  ];

  return {
    now: calc.now,
    timeZone: calc.timeZone,
    terms: calc.terms,
    words: calc.words,
    today: calc.today,
    status: calc.status,
    alerts: calc.alerts,
    setup,
    upcoming: calc.upcoming,
    reminders: calc.reminders,
    /** The month calendar's days and events; null while no location is set. */
    grid: calc.grid,
    entryCount: calc.entryCount,
    // newest first; the page lists the most recent ones
    entries: calc.entries,
    halachic: {
      settings: data.halachic,
      confirmedAt: data.halachicConfirmedAt,
      choices: choicesFor(lang),
      tzeitPresets: tzeitPresetsFor(lang),
      tzeitTitle: capital(f(TZEIT_TITLE)),
    },
    app: data.app,
    places: PLACES,
    reminderKinds: REMINDER_KINDS,
    labels: {
      kinds: kindLabels(lang),
      reminders: {
        hefsek: capital(f('{hefsek}')),
        bedikah_morning: capital(f('{bedikah}, morning')),
        bedikah_afternoon: capital(f('{bedikah}, afternoon')),
        mikvah: capital(f('{mikvah_night}')),
        mikvah_book: 'Book the mikvah',
        onah: capital(f('{onat_perishah}')),
      },
    },
    phones: data.phones.map(p => ({
      number: p.number,
      name: p.name,
      canUpdate: p.canUpdate,
      reminders: p.reminders,
      verified: p.verifiedAt !== null,
      texts: p.consentAt !== null,
      optedOut: p.optedOut,
      me: p.number === args.myNumber,
    })),
    maxPhones: MAX_PHONES,
    account: {
      number: args.myNumber,
      method: session.method,
      hasPassword: session.phone?.password != null,
      googleEmail: data.googleLogin?.email ?? null,
      // Whether this session began recently enough to set, change or remove the password.
      fresh: now - session.startedAt < FRESH_MS,
      // Whether the guided first steps have been shown and closed.
      welcomed: data.welcomedAt !== null,
    },
    calendar: {
      google: { available: googleReady(site), connected: data.google !== null },
      link: data.calendarLinkToken ? `${origin}/cal/${data.calendarLinkToken}.ics` : null,
      sync: data.sync,
    },
    /** The operator's test account: texts are simulated, never sent. */
    demo: data.demo,
    sms: {
      // In the test account texting always "works": the page offers a box to send a simulated text.
      ready: data.demo || smsReady(site),
      simulated: data.demo,
      number: data.demo ? (site.secrets.telnyxNumber ?? DEMO_TEXTING_NUMBER) : smsReady(site) ? (site.secrets.telnyxNumber ?? null) : null,
      usedThisMonth: textsThisMonth(data, now),
      monthlyLimit: site.config.householdMonthlyLimit,
      /** The main options by text, as the texts show them (PERIOD, HEFSEK, STATUS, MORE). */
      mainOptions: mainOptions(site.texts),
      /** The same as rows for a table (the setup's last screen shows them), and one line on how texting works. */
      commandList: mainOptions(site.texts).map((text, i) => ({ text, meaning: MAIN_MEANINGS[i] ?? '' })),
      commandNote: 'Every text ends with its options. Answer with one, or in words: period last night, hefsek yesterday.',
    },
    messages: data.messages,
    /** Whether the site has a Donate page (Settings, Your data, links to it). */
    donate: donateReady(site),
  };
}

export type DashboardState = ReturnType<typeof dashboardState>;

/**
 * Turns what the dashboard's "record" form sends into an entry.
 *
 *   { kind, when: 'now' }
 *   { kind, date: 'YYYY-MM-DD', part: 'day' | 'night' }   night = the night that begins on the evening of that date
 *   { kind, date: 'YYYY-MM-DD', time: 'HH:MM' }
 *   hefsek: { kind: 'hefsek', date }            mikvah: { kind: 'mikvah', date }  (the evening she immersed)
 */
export function draftFromForm(input: unknown, where: Where, now: number): DraftEntry {
  if (typeof input !== 'object' || input === null) throw new ValidationError('expected an object');
  const o = input as Record<string, unknown>;
  const kind = o.kind;
  if (kind !== 'flow' && kind !== 'stain' && kind !== 'broken' && kind !== 'hefsek' && kind !== 'mikvah') throw new ValidationError('kind: unknown');
  const tz = where.place.timeZone;

  const parseDate = (): number => {
    if (typeof o.date !== 'string') throw new ValidationError('Choose a date.');
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(o.date);
    if (!m) throw new ValidationError('date: use YYYY-MM-DD');
    try {
      return civilToAbs({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) });
    } catch {
      throw new ValidationError('date: no such date');
    }
  };

  if (kind === 'hefsek') {
    // "now": today, or yesterday when it is after midnight and before sunrise (as for a text message)
    if (o.when === 'now') return { kind, abs: resolveHefsekDay(false, { now, place: where.place, zopts: where.zopts, boundaryMarginMs: 0 }) };
    return { kind, abs: parseDate() };
  }
  if (kind === 'mikvah') {
    if (o.when === 'now') return { kind, abs: onahAt(now, where.place, where.zopts).onah.abs };
    return { kind, abs: parseDate() + 1 }; // the night that begins on that evening belongs to the next Hebrew date
  }

  let onah: { abs: number; part: 'night' | 'day' };
  if (o.when === 'now') {
    onah = onahAt(now, where.place, where.zopts).onah;
  } else if (typeof o.time === 'string' && o.time !== '') {
    const t = /^(\d{1,2}):(\d{2})$/.exec(o.time);
    if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) throw new ValidationError('time: use HH:MM');
    const c = absToCivil(parseDate());
    onah = onahAt(localToInstant({ ...c, hh: Number(t[1]), mi: Number(t[2]), ss: 0 }, tz), where.place, where.zopts).onah;
  } else {
    const abs = parseDate();
    if (o.part === 'day') onah = { abs, part: 'day' };
    else if (o.part === 'night') onah = { abs: abs + 1, part: 'night' };
    else throw new ValidationError('Choose day, night, or a time.');
  }
  if (kind === 'flow') return { kind, onah, veset: o.veset !== false };
  return { kind, onah };
}
