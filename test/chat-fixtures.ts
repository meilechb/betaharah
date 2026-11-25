/** Shared setup for the chat tests (not itself a test file). */
import { converse, type ChatState, type ConverseOutput, type Place, type SiteTexts } from '../src/app/chat';
import { localToInstant } from '../src/engine/civil';
import { newHousehold, type HouseholdData } from '../src/app/model';
import { REMINDER_KINDS, type PhoneRecord } from '../src/app/settings';

export const TZ = 'America/New_York';
export const ME = '+17325550101';
export const SPOUSE = '+17325550102';

/** Local time in Lakewood. */
export function at(y: number, m: number, d: number, hh = 12, mi = 0): number {
  return localToInstant({ y, m, d, hh, mi, ss: 0 }, TZ);
}

/** "Today" in these tests: Tuesday 24 November 2026, noon in Lakewood. */
export const NOW = at(2026, 11, 24, 12);

export const PLACES: Record<string, Place> = {
  '08701': { name: 'Lakewood, NJ 08701', latitude: 40.0821, longitude: -74.2097, timeZone: TZ, elevation: 0, postal: '08701' },
  '11219': { name: 'Brooklyn, NY 11219', latitude: 40.6326, longitude: -73.9967, timeZone: TZ, elevation: 0, postal: '11219' },
  '60645': { name: 'Chicago, IL 60645', latitude: 42.0086, longitude: -87.6947, timeZone: 'America/Chicago', elevation: 0, postal: '60645' },
  '90036': { name: 'Los Angeles, CA 90036', latitude: 34.0699, longitude: -118.3492, timeZone: 'America/Los_Angeles', elevation: 0, postal: '90036' },
  H3W: { name: 'Côte-Saint-Luc, QC H3W', latitude: 45.4775, longitude: -73.6476, timeZone: 'America/Toronto', elevation: 0, postal: 'H3W' },
};

export function lookupPostal(input: string): Place | null {
  const key = input.toUpperCase().slice(0, /^\d/.test(input) ? 5 : 3);
  return PLACES[key] ?? null;
}

export function nearestPostal(lat: number, lon: number): Place | null {
  let best: Place | null = null;
  let bestD = 1;
  for (const p of Object.values(PLACES)) {
    const d = Math.hypot(p.latitude - lat, p.longitude - lon);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

export function makeRandom(): () => string {
  let n = 0;
  return () => `Tok${(++n).toString().padStart(4, '0')}_abcdefghijklmnopqrstuvw`;
}

export function phone(number: string, verified = true): PhoneRecord {
  return { number, name: '', canUpdate: true, reminders: [...REMINDER_KINDS], verifiedAt: verified ? 1 : null, consentAt: null, optedOut: false };
}

/** A household with one phone; with a location unless `place` is false. */
export function household(opts: { place?: boolean; spouse?: boolean } = {}): HouseholdData {
  const data = newHousehold();
  // Civil dates, so that the dates in replies read as month and day; test/dates.test.ts covers the three settings.
  data.app.dates = 'civil';
  data.phones.push(phone(ME));
  if (opts.spouse) data.phones.push(phone(SPOUSE));
  if (opts.place !== false) {
    const p = PLACES['08701']!;
    data.app.place = { name: p.name, latitude: p.latitude, longitude: p.longitude, timeZone: p.timeZone, elevation: 0 };
  }
  return data;
}

/** One phone in a conversation: keeps the pending question between texts. */
export class Phone {
  chat: ChatState | null = null;
  random = makeRandom();
  last: ConverseOutput | null = null;
  texts: SiteTexts | undefined = undefined;
  constructor(
    public data: HouseholdData,
    public now = NOW,
    public from = ME,
  ) {}

  send(text: string, extra: { location?: { latitude: number; longitude: number } } = {}): ConverseOutput {
    const out = converse({
      texts: this.texts,
      data: this.data,
      chat: this.chat,
      from: this.from,
      text,
      now: this.now,
      limits: { maxPhones: 4 },
      lookupPostal,
      nearestPostal,
      random: this.random,
      ...extra,
    });
    this.chat = out.chat;
    this.last = out;
    return out;
  }

  /** The reply's words without the options line (the texts joined by " | "). */
  say(text: string): string {
    return bodies(this.send(text));
  }

  /** The labels of the options of the last reply. */
  options(): string[] {
    return labels(this.last as ConverseOutput);
  }

  wait(minutes: number): this {
    this.now += minutes * 60_000;
    return this;
  }
}

/** The whole texts as sent by SMS (with the options line), joined by " | ". */
export function texts(out: ConverseOutput): string {
  return out.out.map(m => m.text).join(' | ');
}

/** The texts without their options line. */
export function bodies(out: ConverseOutput): string {
  return out.out.map(m => m.body).join(' | ');
}

/** The labels of the options offered with the last text. */
export function labels(out: ConverseOutput): string[] {
  return (out.out[out.out.length - 1]?.suggestions ?? []).map(s => s.label);
}
