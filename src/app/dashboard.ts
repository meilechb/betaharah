/** The data the dashboard page shows, prepared on the server. */
import { absToCivil, civilToAbs, localAbs, localDateTime, localToInstant } from '../engine/civil';
import { hebrewWeekday, formatHebrewDate } from '../engine/hebrew';
import { clock24 } from '../engine/present';
import { HALACHIC_CHOICES, TZEIT_PRESETS } from '../engine/settings';
import { onahAt } from '../engine/zmanim';
import { resolveHefsekDay } from './commands';
import { entryHebrew, noteHebrew, patternHebrew, statusHebrew, warningHebrew } from './hebrew';
import type { Computed, DraftEntry, Where } from './service';
import { PLACES, REMINDER_KINDS, ValidationError } from './settings';
import { SECRET_KEYS, type SmsRow, type Stored, type StoredEntry } from './store';

function civilLabel(abs: number): string {
  const c = absToCivil(abs);
  return `${hebrewWeekday(abs)} ${c.d}.${c.m}.${c.y}`;
}

/** The dashboard lists this many of the most recent entries. */
const MAX_LISTED_ENTRIES = 150;

export interface UpcomingItem {
  key: string;
  kind: string;
  title: string;
  description: string;
  when: string;
  projected: boolean;
  light: boolean;
}

export function dashboardState(stored: Stored, entries: readonly StoredEntry[], computed: Computed | null, sms: readonly SmsRow[], now: number, origin: string) {
  const tz = computed?.place.timeZone ?? 'UTC';
  const alerts: Array<{ level: 'warn' | 'info'; text: string; dir: 'rtl' | 'ltr' }> = [];
  if (!stored.app.place) alerts.push({ level: 'warn', text: 'No location is set yet. Nothing can be calculated until one is chosen under Settings.', dir: 'ltr' });
  if (stored.halachic.confirmedAt === null) {
    alerts.push({ level: 'warn', text: 'ההגדרות ההלכתיות טרם אושרו. החישוב נעשה כעת לפי ברירת המחדל (לחומרא). יש לעבור עליהן, רצוי עם רב, ולשמור.', dir: 'rtl' });
  }
  if (stored.sync.lastError) alerts.push({ level: 'warn', text: `Google Calendar: ${stored.sync.lastError}`, dir: 'ltr' });

  let status: { headline: string; detail: string } | null = null;
  let upcoming: UpcomingItem[] = [];
  let reminders: Array<{ at: number; when: string; kind: string; text: string }> = [];
  let today: { hebrew: string; civil: string; onah: string } | null = null;
  if (computed) {
    const t = computed.timeline;
    status = statusHebrew(t, tz);
    for (const w of t.warnings) alerts.push({ level: 'warn', text: warningHebrew(w.code), dir: 'rtl' });
    for (const p of t.patterns) alerts.push({ level: 'warn', text: patternHebrew(p), dir: 'rtl' });
    for (const n of t.vesatotNotes) alerts.push({ level: 'info', text: noteHebrew(n), dir: 'rtl' });
    if (t.onot.some(o => o.onMikvahNight && o.end > now)) alerts.push({ level: 'warn', text: 'ליל הטבילה חל בעונת פרישה. יש לשאול רב.', dir: 'rtl' });
    today = {
      hebrew: `${hebrewWeekday(t.nowOnah.abs)}, ${formatHebrewDate(t.nowOnah.abs)}`,
      civil: civilLabel(localAbs(now, tz)),
      onah: t.nowOnah.part === 'night' ? 'לילה' : 'יום',
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
        if (e.timed) {
          const a = localAbs(e.timed.start, tz);
          const b = localAbs(e.timed.end, tz);
          const from = clock24(e.timed.start, tz, 'floor');
          const to = clock24(e.timed.end, tz, 'ceil');
          when = a === b ? `${civilLabel(a)}, מ־${from} עד ${to}` : `מ${civilLabel(a)} ${from} עד ${civilLabel(b)} ${to}`;
        } else {
          when = civilLabel(e.allDay!.startAbs);
        }
        return { key: e.key, kind: e.kind, title: e.title, description: e.description, when, projected: e.projected, light: e.light === true };
      });
    reminders = computed.reminders
      .filter(r => r.at > now)
      .slice(0, 30)
      .map(r => {
        const l = localDateTime(r.at, tz);
        return { at: r.at, when: `${l.m}/${l.d} ${l.hh}:${String(l.mi).padStart(2, '0')}`, kind: r.kind, text: r.text };
      });
  }

  const secretsSet = Object.fromEntries(SECRET_KEYS.map(k => [k, Boolean(stored.secrets[k])]));
  return {
    now,
    timeZone: tz,
    today,
    status,
    alerts,
    upcoming,
    reminders,
    entryCount: entries.length,
    // newest first; the page lists the most recent ones
    entries: [...entries]
      .sort((a, b) => {
        const pa = 'onah' in a.entry ? a.entry.onah.abs : a.entry.abs;
        const pb = 'onah' in b.entry ? b.entry.onah.abs : b.entry.abs;
        return pb - pa || b.createdAt - a.createdAt;
      })
      .slice(0, MAX_LISTED_ENTRIES)
      .map(e => ({ id: e.entry.id, kind: e.entry.kind, text: entryHebrew(e.entry), source: e.source, note: e.note, createdAt: e.createdAt })),
    halachic: { settings: stored.halachic.settings, confirmedAt: stored.halachic.confirmedAt, choices: HALACHIC_CHOICES, tzeitPresets: TZEIT_PRESETS },
    app: stored.app,
    places: PLACES,
    reminderKinds: REMINDER_KINDS,
    connections: {
      google: { connected: Boolean(stored.google && stored.secrets.googleRefreshToken), calendarId: stored.google?.calendarId ?? null },
      sms: { configured: Boolean(stored.secrets.telnyxApiKey && stored.secrets.telnyxPublicKey && stored.secrets.telnyxNumber), number: stored.secrets.telnyxNumber ?? null },
      secretsSet,
      redirectUri: `${origin}/api/google/callback`,
      webhookUrl: `${origin}/webhooks/telnyx`,
    },
    sync: stored.sync,
    sms: sms.map(m => ({ ...m })),
  };
}

/**
 * Turns what the dashboard's "record" form sends into an entry.
 *
 *   { kind, when: 'now' }
 *   { kind, date: 'YYYY-MM-DD', part: 'day' | 'night' }   night = the night that begins on the evening of that date
 *   { kind, date: 'YYYY-MM-DD', time: 'HH:MM' }
 *   hefsek: { kind: 'hefsek', date }            mikvah: { kind: 'mikvah', date }  (the evening she immersed)
 */
export function draftFromForm(input: unknown, computed: Where, now: number): DraftEntry {
  if (typeof input !== 'object' || input === null) throw new ValidationError('expected an object');
  const o = input as Record<string, unknown>;
  const kind = o.kind;
  if (kind !== 'flow' && kind !== 'stain' && kind !== 'broken' && kind !== 'hefsek' && kind !== 'mikvah') throw new ValidationError('kind: unknown');
  const tz = computed.place.timeZone;

  const parseDate = (): number => {
    if (typeof o.date !== 'string') throw new ValidationError('date: required');
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
    if (o.when === 'now') return { kind, abs: resolveHefsekDay(false, { now, place: computed.place, zopts: computed.zopts, boundaryMarginMs: 0 }) };
    return { kind, abs: parseDate() };
  }
  if (kind === 'mikvah') {
    if (o.when === 'now') return { kind, abs: onahAt(now, computed.place, computed.zopts).onah.abs };
    return { kind, abs: parseDate() + 1 }; // the night that begins on that evening belongs to the next Hebrew date
  }

  let onah: { abs: number; part: 'night' | 'day' };
  if (o.when === 'now') {
    onah = onahAt(now, computed.place, computed.zopts).onah;
  } else if (typeof o.time === 'string' && o.time !== '') {
    const t = /^(\d{1,2}):(\d{2})$/.exec(o.time);
    if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) throw new ValidationError('time: use HH:MM');
    const c = absToCivil(parseDate());
    onah = onahAt(localToInstant({ ...c, hh: Number(t[1]), mi: Number(t[2]), ss: 0 }, tz), computed.place, computed.zopts).onah;
  } else {
    const abs = parseDate();
    if (o.part === 'day') onah = { abs, part: 'day' };
    else if (o.part === 'night') onah = { abs: abs + 1, part: 'night' };
    else throw new ValidationError('choose day, night, or a time');
  }
  if (kind === 'flow') return { kind, onah, veset: o.veset !== false };
  return { kind, onah };
}
