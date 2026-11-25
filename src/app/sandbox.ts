/**
 * The calculation test: a made-up household, worked out in memory exactly
 * as a real account is, and then forgotten. Used by the operator's
 * "Calculation test" (POST /api/admin/sandbox) and by "Try it" on the home
 * page (POST /api/try). Nothing here reads the clock, the database or the
 * network, and nothing is written anywhere.
 *
 * Each step is the one a real account goes through:
 *   - a new household (newHousehold), as an account starts;
 *   - its settings, as PUT /api/app and PUT /api/halachic save them
 *     (parseAppSettings, parseHalachicSettings, assertSunTimesExist);
 *   - each date in the order given, as POST /api/entries records it
 *     (draftFromForm, then the checks of recordEntry: addEntry), with the
 *     same refusal sentence (rejectionText);
 *   - the picture (compute) and the dashboard's data (calculationState,
 *     which builds the month calendar with buildGrid).
 * recordEntry works the whole picture out after every entry; here it is
 * worked out once, after the last one. What is accepted or refused does not
 * depend on that picture (test/sandbox.test.ts compares the two).
 */
import { absToCivil, civilToAbs, localToInstant } from '../engine/civil';
import { choicesFor, DEFAULT_HALACHIC_SETTINGS, parseHalachicSettings, tzeitPresetsFor, type HalachicSettings } from '../engine/settings';
import { dayTimes } from '../engine/zmanim';
import { calculationState, draftFromForm, kindLabels } from './dashboard';
import { addEntries, compute, confirmationText, rejectionText, whereOf, type AddResult, type DraftEntry, type Where } from './household';
import { newHousehold, type HouseholdData } from './model';
import { assertSunTimesExist, DEFAULT_APP_SETTINGS, parseAppSettings, PLACES, ValidationError, type PlaceSetting } from './settings';
import { lookupPostal } from './zip';

const MINUTE = 60_000;

export type EntryKind = 'flow' | 'stain' | 'broken' | 'hefsek' | 'mikvah';
export const ALL_KINDS: readonly EntryKind[] = ['flow', 'stain', 'hefsek', 'broken', 'mikvah'];

export interface SandboxLimits {
  /** The most entries one request may carry. */
  maxEntries: number;
  /** The kinds of entries that may be added. */
  kinds: readonly EntryKind[];
}

/** What became of one entry of the input, in the order given. */
export type EntryOutcome = { index: number; ok: true; entryId: string } | { index: number; ok: false; error: string };

/** "Pretend today is": a civil date at the place, by day or at night (the night that begins on its evening). */
export interface PretendToday {
  date: string;
  part: 'day' | 'night';
}

function object(input: unknown, what: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new ValidationError(`${what}: expected an object`);
  return input as Record<string, unknown>;
}

/**
 * The place: a full place (as the Settings tab saves it), a place of the
 * app's list by its name ({ name }), or a US ZIP or Canadian postal code
 * ({ postal }), found as the location form finds it.
 */
export function placeFrom(input: unknown): unknown {
  const o = object(input, 'place');
  if (typeof o.postal === 'string') {
    const found = lookupPostal(o.postal);
    if (!found) throw new ValidationError('No place was found for that code. Enter a 5-digit US ZIP code or a Canadian postal code.');
    const { name, latitude, longitude, timeZone, elevation } = found;
    return { name, latitude, longitude, timeZone, elevation };
  }
  if (typeof o.name === 'string' && o.latitude === undefined) {
    const listed = PLACES.find(p => p.name === o.name);
    if (!listed) throw new ValidationError('place: choose a place from the list');
    return { ...listed };
  }
  return o;
}

export function parseToday(input: unknown): PretendToday {
  const o = object(input, 'today');
  if (typeof o.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw new ValidationError('today.date: use YYYY-MM-DD');
  const [y, m, d] = o.date.split('-').map(Number) as [number, number, number];
  if (y < 1950 || y > 2150) throw new ValidationError('today.date: choose a year from 1950 to 2150');
  let abs: number;
  try {
    abs = civilToAbs({ y, m, d });
  } catch {
    throw new ValidationError('today.date: no such date');
  }
  const back = absToCivil(abs);
  if (back.m !== m || back.d !== d) throw new ValidationError('today.date: no such date');
  if (o.part !== 'day' && o.part !== 'night') throw new ValidationError('today.part: day or night');
  return { date: o.date, part: o.part };
}

/**
 * The moment used as "now" for a pretended day at a place. By day: halfway
 * between sunrise and sunset. At night: half an hour after nightfall on the
 * evening of that date (or, where nightfall is close to midnight, a minute
 * before midnight, and never before sunset), so that the evening's
 * immersion can be recorded and the civil date is still that date.
 */
export function instantOf(today: PretendToday, where: Where): number {
  const [y, m, d] = today.date.split('-').map(Number) as [number, number, number];
  const abs = civilToAbs({ y, m, d });
  const t = dayTimes(abs, where.place, where.zopts);
  if (today.part === 'day') return Math.round((t.sunrise + t.sunset) / 2);
  const midnight = localToInstant({ ...absToCivil(abs + 1), hh: 0, mi: 0, ss: 0 }, where.place.timeZone);
  return Math.max(t.sunset + MINUTE, Math.min(t.tzeit + 30 * MINUTE, midnight - MINUTE));
}

/** The settings of the made-up household, exactly as the two settings routes save them on a new account. */
export function settleSettings(data: HouseholdData, place: unknown, terms: unknown, halachic: unknown, dates?: unknown): void {
  // PUT /api/app, with the customs a new account has. The checks use the
  // location object the calculation keeps for this place (whereOf), so that
  // the sun times worked out for them are kept for later requests; the
  // check is the same.
  const app = parseAppSettings({ ...DEFAULT_APP_SETTINGS, place, terms: terms ?? DEFAULT_APP_SETTINGS.terms, dates: dates ?? DEFAULT_APP_SETTINGS.dates });
  const kept = whereOf({ ...data, app }) as Where;
  assertSunTimesExist(kept.place, { useElevation: app.useElevation, tzeit: data.halachic.tzeit });
  data.app = app;
  // PUT /api/halachic
  const settings: HalachicSettings = parseHalachicSettings(halachic ?? DEFAULT_HALACHIC_SETTINGS);
  assertSunTimesExist(kept.place, { useElevation: data.app.useElevation, tzeit: settings.tzeit });
  data.halachic = settings;
}

/** Keeps the month calendar's days and events of the months asked for ('YYYY-MM'). */
function onlyMonths<G extends { days: Array<{ date: string }>; events: Array<{ startDate: string; endDate: string }> }>(grid: G, months: string[]): G {
  const first = months.reduce((a, b) => (a < b ? a : b));
  const last = months.reduce((a, b) => (a > b ? a : b));
  const wanted = new Set(months);
  return {
    ...grid,
    days: grid.days.filter(d => wanted.has(d.date.slice(0, 7))),
    events: grid.events.filter(e => e.endDate.slice(0, 7) >= first && e.startDate.slice(0, 7) <= last),
  };
}

function parseMonths(input: unknown): string[] | null {
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input) || input.length === 0 || input.length > 12) throw new ValidationError('months: a list of one to twelve months');
  return input.map(m => {
    if (typeof m !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new ValidationError('months: use YYYY-MM');
    return m;
  });
}

/**
 * Works out the picture for a made-up household. `input`:
 *   { place, halachic?, terms?, dates?, today: { date, part }, entries: [ ... as POST /api/entries takes them ], months? }
 * Throws ValidationError (or SettingsError, NoSunError) for input that a
 * settings route would refuse; an entry that POST /api/entries would refuse
 * is not an error: it is reported in `outcomes` with the same sentence.
 */
export function runSandbox(input: unknown, limits: SandboxLimits) {
  const o = object(input, 'request');
  const today = parseToday(o.today);
  const months = parseMonths(o.months);
  const list = o.entries === undefined ? [] : o.entries;
  if (!Array.isArray(list)) throw new ValidationError('entries: expected a list');
  if (list.length > limits.maxEntries) throw new ValidationError(`At most ${limits.maxEntries} dates can be added here.`);

  const data = newHousehold();
  settleSettings(data, placeFrom(o.place), o.terms, o.halachic, o.dates);
  const where = whereOf(data) as Where;
  const now = instantOf(today, where);

  // As POST /api/entries reads the form (a note is not kept here). A form it
  // cannot read changes nothing, so it does not matter to the entries after it.
  const outcomes: EntryOutcome[] = new Array(list.length);
  const drafts: Array<{ index: number; draft: DraftEntry }> = [];
  list.forEach((item, index) => {
    const kind = typeof item === 'object' && item !== null ? (item as Record<string, unknown>).kind : undefined;
    if (!limits.kinds.includes(kind as EntryKind)) {
      outcomes[index] = { index, ok: false, error: 'That kind of entry cannot be added here.' };
      return;
    }
    try {
      drafts.push({ index, draft: draftFromForm(item, where, now) });
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      outcomes[index] = { index, ok: false, error: e.message };
    }
  });

  // Recorded in order, with the checks of POST /api/entries (recordEntry), and the same sentence for a refusal.
  let last: Extract<AddResult, { ok: true }> | null = null;
  addEntries(
    data,
    drafts.map(d => d.draft),
    'dashboard',
    now,
  ).forEach((added, k) => {
    const index = (drafts[k] as { index: number }).index;
    if (added.ok) {
      outcomes[index] = { index, ok: true, entryId: added.entry.id };
      last = added;
    } else {
      outcomes[index] = { index, ok: false, error: rejectionText(added.reason, added.computed) };
    }
  });

  const computed = compute(data, now);
  if (!computed) throw new Error('the made-up household has no location');
  const calc = calculationState(data, computed, now);
  const indexOf = new Map(outcomes.flatMap(r => (r.ok ? [[r.entryId, r.index] as const] : [])));
  const recorded = last as Extract<AddResult, { ok: true }> | null;

  return {
    /** The moment used as "now", and the place's time zone. */
    now,
    today,
    place: data.app.place as PlaceSetting,
    halachic: data.halachic,
    terms: data.app.terms,
    dates: data.app.dates,
    outcomes,
    /** What POST /api/entries answers after the last entry that was recorded. */
    message: recorded ? confirmationText({ ok: true, entry: recorded.entry, computed, notes: recorded.notes }, null) : null,
    state: {
      now: calc.now,
      timeZone: calc.timeZone,
      terms: calc.terms,
      words: calc.words,
      today: calc.today,
      status: calc.status,
      alerts: calc.alerts,
      upcoming: calc.upcoming,
      reminders: calc.reminders,
      grid: calc.grid && months ? onlyMonths(calc.grid, months) : calc.grid,
      entries: calc.entries.map(e => ({ ...e, input: indexOf.get(e.id) ?? null })),
      labels: { kinds: kindLabels(data.app.terms) },
    },
  };
}

export type SandboxResult = ReturnType<typeof runSandbox>;

/** What a form needs before its first calculation: the places, and the customs with their options and the defaults of a new account. */
export function sandboxChoices(terms: 'en' | 'he') {
  return {
    places: PLACES.map(p => p.name),
    defaults: DEFAULT_HALACHIC_SETTINGS,
    choices: choicesFor(terms),
    tzeitPresets: tzeitPresetsFor(terms),
    labels: { kinds: kindLabels(terms) },
  };
}

/** "Try it" on the home page: at most this many dates, of these kinds, with the defaults of a new account except these customs. */
export const TRY_LIMITS: SandboxLimits = { maxEntries: 12, kinds: ['flow', 'hefsek', 'mikvah'] };
export const TRY_CUSTOMS = ['minWaitDays', 'beinonitDays', 'orZarua'] as const;
/** "Try it": at most this many calculations per network address in ten minutes. */
export const TRY_PER_ADDRESS = 60;
export const TRY_WINDOW_MS = 10 * MINUTE;

/** The customs for "Try it": a new account's defaults, with the few a visitor may change. */
export function tryCustoms(input: unknown): HalachicSettings {
  const settings: Record<string, unknown> = { ...DEFAULT_HALACHIC_SETTINGS };
  if (input !== undefined && input !== null) {
    const o = object(input, 'customs');
    for (const key of Object.keys(o)) {
      if (!(TRY_CUSTOMS as readonly string[]).includes(key)) throw new ValidationError(`customs: ${key} cannot be changed here`);
      settings[key] = o[key];
    }
  }
  return settings as unknown as HalachicSettings;
}

/** "Try it": only a place of the list or a postal code. */
export function tryPlace(input: unknown): unknown {
  const o = object(input, 'place');
  if (typeof o.postal === 'string') return { postal: o.postal };
  if (typeof o.name === 'string') return { name: o.name };
  throw new ValidationError('place: choose a place from the list, or enter a ZIP code');
}

/** The months ('YYYY-MM') from `before` months before the month of `date` ('YYYY-MM-DD') to `after` months after it. */
export function monthsAround(date: string, before: number, after: number): string[] {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const out: string[] = [];
  for (let k = -before; k <= after; k++) {
    const n = y * 12 + (m - 1) + k;
    out.push(`${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}

/** "Try it": the month before today's, today's, and the two after it. */
export function tryMonths(today: unknown): string[] | undefined {
  const date = typeof today === 'object' && today !== null ? (today as Record<string, unknown>).date : undefined;
  return typeof date === 'string' && /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date) ? monthsAround(date, 1, 2) : undefined;
}

