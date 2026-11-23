/**
 * Settings that are not halachic choices: the location, the phones, the
 * reminders, how the calendar looks. Validated whenever they are saved.
 */
import { civilToAbs, isValidTimeZone } from '../engine/civil';
import { DEFAULT_REMINDER_OPTIONS, type ReminderKind, type ReminderOptions } from '../engine/present';
import type { GeoPoint } from '../engine/sun';
import { dayTimes, type ZmanimOptions } from '../engine/zmanim';

export interface PlaceSetting {
  name: string;
  latitude: number;
  longitude: number;
  timeZone: string;
  /** Metres above sea level */
  elevation: number;
}

export interface PhoneSetting {
  /** E.164, e.g. +17325550123 */
  number: string;
  name: string;
  /** May record events by text message. */
  canUpdate: boolean;
  /** Which reminders this phone receives. */
  reminders: ReminderKind[];
}

export interface AppSettings {
  place: PlaceSetting | null;
  useElevation: boolean;
  calendar: {
    style: 'hebrew' | 'discreet';
    /** How far back events are kept up to date in Google Calendar. */
    historyDays: number;
  };
  phones: PhoneSetting[];
  reminders: ReminderOptions;
  /**
   * When an event is recorded "now" within this many minutes of sunrise or
   * sunset, the reply says so and asks for confirmation of day or night.
   */
  boundaryMarginMinutes: number;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  place: null,
  useElevation: false,
  calendar: { style: 'hebrew', historyDays: 400 },
  phones: [],
  reminders: DEFAULT_REMINDER_OPTIONS,
  boundaryMarginMinutes: 20,
};

export const REMINDER_KINDS: ReminderKind[] = ['hefsek', 'bedikah_morning', 'bedikah_afternoon', 'mikvah', 'mikvah_confirm', 'onah'];

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function obj(input: unknown, what: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new ValidationError(`${what}: expected an object`);
  return input as Record<string, unknown>;
}

function num(input: unknown, what: string, min: number, max: number, integer = false): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) throw new ValidationError(`${what}: expected a number`);
  if (integer && !Number.isInteger(input)) throw new ValidationError(`${what}: expected a whole number`);
  if (input < min || input > max) throw new ValidationError(`${what}: must be between ${min} and ${max}`);
  return input;
}

function bool(input: unknown, what: string): boolean {
  if (typeof input !== 'boolean') throw new ValidationError(`${what}: expected true or false`);
  return input;
}

function str(input: unknown, what: string, maxLength: number): string {
  if (typeof input !== 'string') throw new ValidationError(`${what}: expected text`);
  const s = input.trim();
  if (s.length > maxLength) throw new ValidationError(`${what}: too long`);
  return s;
}

function oneOf<T extends string>(input: unknown, what: string, values: readonly T[]): T {
  if (typeof input !== 'string' || !values.includes(input as T)) {
    throw new ValidationError(`${what}: must be one of ${values.join(', ')}`);
  }
  return input as T;
}

export const E164 = /^\+[1-9]\d{7,14}$/;

/** Checks that sunrise, sunset and nightfall exist on every day of a year at this place. */
export function assertSunTimesExist(place: GeoPoint, zopts: ZmanimOptions): void {
  const start = civilToAbs({ y: 2026, m: 1, d: 1 });
  for (let abs = start; abs < start + 366; abs++) dayTimes(abs, place, zopts);
}

export function parsePlace(input: unknown): PlaceSetting {
  const o = obj(input, 'place');
  const place: PlaceSetting = {
    name: str(o.name, 'place.name', 80),
    latitude: num(o.latitude, 'place.latitude', -90, 90),
    longitude: num(o.longitude, 'place.longitude', -180, 180),
    timeZone: str(o.timeZone, 'place.timeZone', 64),
    elevation: num(o.elevation ?? 0, 'place.elevation', -430, 6000),
  };
  if (!place.name) throw new ValidationError('place.name: required');
  if (!isValidTimeZone(place.timeZone)) throw new ValidationError(`place.timeZone: "${place.timeZone}" is not a known time zone`);
  return place;
}

function parseReminders(input: unknown): ReminderOptions {
  const o = obj(input, 'reminders');
  const hefsek = obj(o.hefsek, 'reminders.hefsek');
  const bedikot = obj(o.bedikot, 'reminders.bedikot');
  const mikvah = obj(o.mikvah, 'reminders.mikvah');
  const confirm = obj(o.mikvahConfirm, 'reminders.mikvahConfirm');
  const onah = obj(o.onah, 'reminders.onah');
  return {
    style: oneOf(o.style, 'reminders.style', ['plain', 'discreet'] as const),
    hefsek: { on: bool(hefsek.on, 'reminders.hefsek.on'), minutesBeforeSunset: num(hefsek.minutesBeforeSunset, 'reminders.hefsek.minutesBeforeSunset', 20, 600, true) },
    bedikot: {
      on: bool(bedikot.on, 'reminders.bedikot.on'),
      morningHour: num(bedikot.morningHour, 'reminders.bedikot.morningHour', 0, 23, true),
      morningMinute: num(bedikot.morningMinute, 'reminders.bedikot.morningMinute', 0, 59, true),
      minutesBeforeSunset: num(bedikot.minutesBeforeSunset, 'reminders.bedikot.minutesBeforeSunset', 20, 600, true),
    },
    mikvah: { on: bool(mikvah.on, 'reminders.mikvah.on'), minutesBeforeSunset: num(mikvah.minutesBeforeSunset, 'reminders.mikvah.minutesBeforeSunset', 20, 600, true) },
    mikvahConfirm: {
      on: bool(confirm.on, 'reminders.mikvahConfirm.on'),
      hour: num(confirm.hour, 'reminders.mikvahConfirm.hour', 0, 23, true),
      minute: num(confirm.minute, 'reminders.mikvahConfirm.minute', 0, 59, true),
    },
    onah: { on: bool(onah.on, 'reminders.onah.on'), minutesBefore: num(onah.minutesBefore, 'reminders.onah.minutesBefore', 0, 1440, true) },
    beforeRestDays: bool(o.beforeRestDays, 'reminders.beforeRestDays'),
    hefsekMaxDays: num(o.hefsekMaxDays, 'reminders.hefsekMaxDays', 1, 30, true),
  };
}

export function parseAppSettings(input: unknown): AppSettings {
  const o = obj(input, 'settings');
  const calendar = obj(o.calendar, 'calendar');
  if (!Array.isArray(o.phones)) throw new ValidationError('phones: expected a list');
  if (o.phones.length > 6) throw new ValidationError('phones: at most 6');
  const phones = o.phones.map((p, i) => {
    const ph = obj(p, `phones[${i}]`);
    const number = str(ph.number, `phones[${i}].number`, 20).replace(/[\s().-]/g, '');
    if (!E164.test(number)) throw new ValidationError(`phones[${i}].number: write the full number with country code, like +17325550123`);
    if (!Array.isArray(ph.reminders)) throw new ValidationError(`phones[${i}].reminders: expected a list`);
    const reminders = [...new Set(ph.reminders.map(r => oneOf(r, `phones[${i}].reminders`, REMINDER_KINDS)))];
    return { number, name: str(ph.name, `phones[${i}].name`, 40), canUpdate: bool(ph.canUpdate, `phones[${i}].canUpdate`), reminders };
  });
  if (new Set(phones.map(p => p.number)).size !== phones.length) throw new ValidationError('phones: the same number is listed twice');
  return {
    place: o.place === null || o.place === undefined ? null : parsePlace(o.place),
    useElevation: bool(o.useElevation, 'useElevation'),
    calendar: {
      style: oneOf(calendar.style, 'calendar.style', ['hebrew', 'discreet'] as const),
      historyDays: num(calendar.historyDays, 'calendar.historyDays', 30, 800, true),
    },
    phones,
    reminders: parseReminders(o.reminders),
    boundaryMarginMinutes: num(o.boundaryMarginMinutes, 'boundaryMarginMinutes', 0, 120, true),
  };
}

/** A short list of places to pick from; any other place can be entered by coordinates. */
export const PLACES: PlaceSetting[] = [
  { name: 'Lakewood, NJ', latitude: 40.0821, longitude: -74.2097, timeZone: 'America/New_York', elevation: 16 },
  { name: 'Brooklyn, NY', latitude: 40.6501, longitude: -73.9496, timeZone: 'America/New_York', elevation: 20 },
  { name: 'Monsey, NY', latitude: 41.1112, longitude: -74.0685, timeZone: 'America/New_York', elevation: 167 },
  { name: 'Monroe / Kiryas Joel, NY', latitude: 41.3418, longitude: -74.1679, timeZone: 'America/New_York', elevation: 256 },
  { name: 'Five Towns, NY', latitude: 40.6157, longitude: -73.7296, timeZone: 'America/New_York', elevation: 6 },
  { name: 'Passaic, NJ', latitude: 40.8568, longitude: -74.1285, timeZone: 'America/New_York', elevation: 30 },
  { name: 'Teaneck, NJ', latitude: 40.8976, longitude: -74.016, timeZone: 'America/New_York', elevation: 43 },
  { name: 'Baltimore, MD', latitude: 39.2904, longitude: -76.6122, timeZone: 'America/New_York', elevation: 10 },
  { name: 'Miami Beach, FL', latitude: 25.7907, longitude: -80.13, timeZone: 'America/New_York', elevation: 1 },
  { name: 'Cleveland, OH', latitude: 41.4993, longitude: -81.6944, timeZone: 'America/New_York', elevation: 199 },
  { name: 'Detroit, MI', latitude: 42.3314, longitude: -83.0458, timeZone: 'America/Detroit', elevation: 183 },
  { name: 'Toronto, ON', latitude: 43.6532, longitude: -79.3832, timeZone: 'America/Toronto', elevation: 76 },
  { name: 'Montreal, QC', latitude: 45.5019, longitude: -73.5674, timeZone: 'America/Toronto', elevation: 36 },
  { name: 'Chicago, IL', latitude: 41.8781, longitude: -87.6298, timeZone: 'America/Chicago', elevation: 181 },
  { name: 'Houston, TX', latitude: 29.7604, longitude: -95.3698, timeZone: 'America/Chicago', elevation: 12 },
  { name: 'Denver, CO', latitude: 39.7392, longitude: -104.9903, timeZone: 'America/Denver', elevation: 1609 },
  { name: 'Los Angeles, CA', latitude: 34.0522, longitude: -118.2437, timeZone: 'America/Los_Angeles', elevation: 89 },
  { name: 'London', latitude: 51.5074, longitude: -0.1278, timeZone: 'Europe/London', elevation: 11 },
  { name: 'Manchester', latitude: 53.4808, longitude: -2.2426, timeZone: 'Europe/London', elevation: 38 },
  { name: 'Antwerp', latitude: 51.2194, longitude: 4.4025, timeZone: 'Europe/Brussels', elevation: 7 },
  { name: 'Jerusalem', latitude: 31.7781, longitude: 35.2353, timeZone: 'Asia/Jerusalem', elevation: 786 },
  { name: 'Bnei Brak', latitude: 32.0849, longitude: 34.8352, timeZone: 'Asia/Jerusalem', elevation: 34 },
  { name: 'Melbourne', latitude: -37.8136, longitude: 144.9631, timeZone: 'Australia/Melbourne', elevation: 31 },
  { name: 'Johannesburg', latitude: -26.2041, longitude: 28.0473, timeZone: 'Africa/Johannesburg', elevation: 1753 },
];
