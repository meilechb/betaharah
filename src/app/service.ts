/**
 * The operations of the app: computing the current picture, recording an
 * entry, answering a text message, sending reminders, syncing the calendar.
 */
import { localAbs } from '../engine/civil';
import { processLog, type LogEntry, type LogWarningCode } from '../engine/cycle';
import {
  buildCalendar,
  buildReminders,
  clock12,
  englishDate,
  restDayAt,
  statusText,
  type CalendarEvent,
  type Reminder,
  type ReminderContext,
} from '../engine/present';
import type { GeoPoint } from '../engine/sun';
import { buildTimeline, type Timeline } from '../engine/timeline';
import { dayTimes, onahWindow, type ZmanimOptions } from '../engine/zmanim';
import {
  HELP_TEXT,
  parseCommand,
  resolveHefsekDay,
  resolveMikvahNight,
  resolveWhen,
  type ResolveContext,
  type ResolvedOnah,
} from './commands';
import { randomId } from './crypto';
import type { Deps, Env } from './env';
import { GoogleCalendar, GoogleError, refreshAccessToken } from './google';
import { sendTelnyx, type InboundMessage } from './sms';
import {
  addEntry,
  claimReminder,
  inboundCountSince,
  listEntries,
  loadStored,
  markDirty,
  recordInbound,
  recordOutbound,
  removeEntry,
  saveSync,
  setSmsStatus,
  type Stored,
  type StoredEntry,
} from './store';
import { applySync, planSync, toDesired, type SyncResult } from './sync';

// ---------- computing ----------

export interface Computed {
  timeline: Timeline;
  events: CalendarEvent[];
  reminders: Reminder[];
  place: GeoPoint;
  zopts: ZmanimOptions;
}

export interface Where {
  place: GeoPoint;
  zopts: ZmanimOptions;
}

/** The location and the definitions of the times, or null while no location is set. */
export function whereOf(stored: Stored): Where | null {
  const p = stored.app.place;
  if (!p) return null;
  return {
    place: { latitude: p.latitude, longitude: p.longitude, timeZone: p.timeZone, elevation: p.elevation },
    zopts: { useElevation: stored.app.useElevation, tzeit: stored.halachic.settings.tzeit },
  };
}

/** Days kept beyond the calendar's history, so that events at its edge are complete. */
const WINDOW_MARGIN_DAYS = 3;

/** The whole computed picture, or null while no location is set. */
export function compute(stored: Stored, entries: readonly StoredEntry[], now: number): Computed | null {
  const where = whereOf(stored);
  if (!where) return null;
  const { place, zopts } = where;
  const settings = stored.halachic.settings;
  const timeline = buildTimeline({
    entries: entries.map(e => e.entry),
    settings,
    place,
    useElevation: stored.app.useElevation,
    now,
    // Only what the calendar keeps is worked out in full; the whole log still feeds the calculation.
    since: localAbs(now, place.timeZone) - stored.app.calendar.historyDays - WINDOW_MARGIN_DAYS,
  });
  const events = buildCalendar(timeline, { style: stored.app.calendar.style, timeZone: place.timeZone });
  const ctx: ReminderContext = { place, zopts, yomTov: settings.yomTov };
  const reminders = buildReminders(timeline, stored.app.reminders, ctx);
  return { timeline, events, reminders, place, zopts };
}

// ---------- recording an entry ----------

/** An entry before it has an id. */
export type DraftEntry =
  | { kind: 'flow'; onah: { abs: number; part: 'night' | 'day' }; veset: boolean }
  | { kind: 'stain' | 'broken'; onah: { abs: number; part: 'night' | 'day' } }
  | { kind: 'hefsek' | 'mikvah'; abs: number };

/** Problems for which an entry is not recorded at all. */
const REJECTED: readonly LogWarningCode[] = [
  'hefsek_without_niddah',
  'hefsek_before_start',
  'broken_without_count',
  'mikvah_without_niddah',
  'mikvah_without_hefsek',
  'mikvah_too_early',
];

export type RecordResult =
  | { ok: true; entry: LogEntry; entries: StoredEntry[]; computed: Computed; notes: LogWarningCode[] }
  | { ok: false; reason: 'no_place' | 'duplicate' | 'future' | LogWarningCode; computed: Computed | null };

const FUTURE_TOLERANCE_MS = 5 * 60_000;

function sameMoment(a: DraftEntry, b: LogEntry): boolean {
  if (a.kind !== b.kind) return false;
  if ('onah' in a && 'onah' in b) return a.onah.abs === b.onah.abs && a.onah.part === b.onah.part;
  if ('abs' in a && 'abs' in b) return a.abs === b.abs;
  return false;
}

/** True if the entry is dated after the present moment. */
function inFuture(draft: DraftEntry, where: Where, now: number): boolean {
  if ('onah' in draft) return onahWindow(draft.onah, where.place, where.zopts).start > now + FUTURE_TOLERANCE_MS;
  if (draft.kind === 'hefsek') return draft.abs > localAbs(now, where.place.timeZone);
  // immersion: the night must have begun
  return dayTimes(draft.abs - 1, where.place, where.zopts).sunset > now + FUTURE_TOLERANCE_MS;
}

/**
 * Records an entry, after checking that it is not a repeat, not in the
 * future, and makes sense where it falls. Nothing is saved otherwise.
 */
export async function recordEntry(
  env: Env,
  stored: Stored,
  entries: readonly StoredEntry[],
  draft: DraftEntry,
  source: string,
  note: string | null,
  now: number,
): Promise<RecordResult> {
  const where = whereOf(stored);
  if (!where) return { ok: false, reason: 'no_place', computed: null };
  if (entries.some(e => sameMoment(draft, e.entry))) return { ok: false, reason: 'duplicate', computed: null };
  if (inFuture(draft, where, now)) return { ok: false, reason: 'future', computed: null };

  const entry = { ...draft, id: randomId() } as LogEntry;
  const trial = processLog([...entries.map(e => e.entry), entry], stored.halachic.settings);
  const mine = trial.warnings.filter(w => w.entryId === entry.id).map(w => w.code);
  const rejected = mine.find(code => REJECTED.includes(code));
  if (rejected) {
    // The reply to an immersion recorded too early names the right night, which needs the current picture.
    return { ok: false, reason: rejected, computed: rejected === 'mikvah_too_early' ? compute(stored, entries, now) : null };
  }

  await addEntry(env.DB, entry, source, note, now);
  await markDirty(env.DB, stored.sync, now);
  const all = [...entries, { entry, source, note, createdAt: now }];
  const after = compute(stored, all, now);
  if (!after) throw new Error('location disappeared while recording');
  return { ok: true, entry, entries: all, computed: after, notes: mine };
}

// ---------- wording of replies ----------

/** e.g. "Sun Nov 22 by day", "Sat Nov 21 night" (a night is named by the evening it begins). */
export function whenEnglish(onah: { abs: number; part: 'night' | 'day' }): string {
  return onah.part === 'day' ? `${englishDate(onah.abs)} by day` : `${englishDate(onah.abs - 1)} night`;
}

export function entryEnglish(e: DraftEntry | LogEntry): string {
  switch (e.kind) {
    case 'flow':
      return `flow ${whenEnglish(e.onah)}`;
    case 'stain':
      return `stain ${whenEnglish(e.onah)}`;
    case 'broken':
      return `count broken ${whenEnglish(e.onah)}`;
    case 'hefsek':
      return `hefsek ${englishDate(e.abs)}`;
    case 'mikvah':
      return `mikvah ${englishDate(e.abs - 1)} night`;
  }
}

function boundaryNote(resolved: ResolvedOnah, timeZone: string): string {
  if (!resolved.ok || !resolved.nearBoundary) return '';
  // Only a time shortly *after* sunrise or sunset leaves a doubt about which side it began on.
  if (resolved.nearBoundary.boundary !== resolved.window.start) return '';
  const t = clock12(resolved.nearBoundary.boundary, timeZone, 'floor');
  return resolved.onah.part === 'night'
    ? ` Counted as night (sunset was ${t}). If it began before sunset send 0, then the same with: day. If unsure ask a rav.`
    : ` Counted as day (sunrise was ${t}). If it began before sunrise send 0, then the same with: night. If unsure ask a rav.`;
}

export function rejectionText(reason: Exclude<RecordResult, { ok: true }>['reason'], computed: Computed | null): string {
  switch (reason) {
    case 'no_place':
      return 'Not recorded: set the location in the dashboard first.';
    case 'duplicate':
      return 'Already recorded.';
    case 'future':
      return 'Not recorded: that time has not come yet.';
    case 'hefsek_without_niddah':
      return 'Not recorded: no period is open. Send 1 or 5 first.';
    case 'hefsek_before_start':
      return 'Not recorded: that is before the period began.';
    case 'broken_without_count':
      return 'Not recorded: there is no count in progress.';
    case 'mikvah_without_niddah':
      return 'Not recorded: no period is open.';
    case 'mikvah_without_hefsek':
      return 'Not recorded: no hefsek is recorded. Send 2 first.';
    case 'mikvah_too_early': {
      const s = computed?.timeline.status;
      if (s?.state === 'niddah') {
        const m = s.period.planMikvah;
        return `Not recorded: the count is not complete. Mikvah night is ${englishDate(m.eveningAbs)} after ${clock12(m.tzeit, computed!.place.timeZone, 'ceil')}.`;
      }
      return 'Not recorded: the count is not complete.';
    }
    default:
      return 'Not recorded.';
  }
}

export function confirmationText(result: Extract<RecordResult, { ok: true }>, resolved: ResolvedOnah | null): string {
  const { entry, computed, notes } = result;
  const tz = computed.place.timeZone;
  const status = computed.timeline.status;
  const period = status.state === 'niddah' ? status.period : null;
  const undo = ' 0 to undo.';
  switch (entry.kind) {
    case 'flow':
    case 'stain': {
      let text = `Recorded: ${entryEnglish(entry)}.`;
      if (notes.includes('count_cancelled_by_flow')) text += ' The count is cancelled; a new hefsek is needed.';
      else if (period && period.startId === entry.id) text += ` Hefsek from ${englishDate(period.earliestHefsekAbs)}.`;
      return text + undo + (resolved ? boundaryNote(resolved, tz) : '');
    }
    case 'broken':
      return `Recorded: ${entryEnglish(entry)}. A new hefsek is needed.${undo}${resolved ? boundaryNote(resolved, tz) : ''}`;
    case 'hefsek': {
      let text = `Recorded: ${entryEnglish(entry)}.`;
      if (period && period.cleanDays) {
        const m = period.planMikvah;
        text += ` Clean days ${englishDate(period.cleanDays[0]!)} - ${englishDate(period.cleanDays[6]!)}. Mikvah ${englishDate(m.eveningAbs)} after ${clock12(m.tzeit, tz, 'ceil')}.`;
      }
      if (notes.includes('hefsek_early')) text += ' It was before the wait ended; ask a rav.';
      return text + undo;
    }
    case 'mikvah': {
      let text = `Recorded: ${entryEnglish(entry)}.`;
      if (notes.includes('mikvah_on_fast_night')) text += ' Note: that was a fast night.';
      return text + undo;
    }
  }
}

// ---------- text messages ----------

/** Entries older than this cannot be removed by text message. */
const UNDO_WINDOW_MS = 48 * 3_600_000;
/** More messages than this from one number in an hour are ignored. */
const MAX_INBOUND_PER_HOUR = 30;

export interface Reply {
  text: string;
  /** True if the log changed. */
  changed: boolean;
  /** After a change: the entries and the picture as they now are, for reuse by the caller. */
  after?: { entries: StoredEntry[]; computed: Computed };
}

/** Carries out a text command from an authorised phone and returns the reply. */
export async function runCommand(env: Env, stored: Stored, entries: readonly StoredEntry[], text: string, source: string, now: number): Promise<Reply> {
  const command = parseCommand(text);
  if (command.kind === 'unknown') return { text: `Not understood; nothing was changed. ${HELP_TEXT}`, changed: false };
  if (command.kind === 'help') return { text: HELP_TEXT, changed: false };

  const where = whereOf(stored);
  if (!where) return { text: rejectionText('no_place', null), changed: false };
  const tz = where.place.timeZone;

  if (command.kind === 'status') {
    const computed = compute(stored, entries, now);
    return { text: computed ? statusText(computed.timeline, tz) : rejectionText('no_place', null), changed: false };
  }

  if (command.kind === 'undo') {
    const last = [...entries].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!last || now - last.createdAt > UNDO_WINDOW_MS) {
      return { text: 'Nothing recent to undo. Older entries can be removed in the dashboard.', changed: false };
    }
    await removeEntry(env.DB, last.entry.id, now);
    await markDirty(env.DB, stored.sync, now);
    const remaining = entries.filter(e => e.entry.id !== last.entry.id);
    const after = compute(stored, remaining, now);
    return {
      text: `Removed: ${entryEnglish(last.entry)}. ${after ? statusText(after.timeline, tz) : ''}`.trim(),
      changed: true,
      after: after ? { entries: remaining, computed: after } : undefined,
    };
  }

  const ctx: ResolveContext = { now, place: where.place, zopts: where.zopts, boundaryMarginMs: stored.app.boundaryMarginMinutes * 60_000 };
  let draft: DraftEntry;
  let resolved: ResolvedOnah | null = null;
  if (command.kind === 'hefsek') {
    draft = { kind: 'hefsek', abs: resolveHefsekDay(command.yesterday, ctx) };
  } else if (command.kind === 'mikvah') {
    draft = { kind: 'mikvah', abs: resolveMikvahNight(command.yesterday, ctx) };
  } else {
    resolved = resolveWhen(command.when, ctx);
    if (!resolved.ok) return { text: rejectionText('future', null), changed: false };
    draft = command.kind === 'flow' ? { kind: 'flow', onah: resolved.onah, veset: true } : { kind: command.kind, onah: resolved.onah };
  }
  const result = await recordEntry(env, stored, entries, draft, source, null, now);
  if (!result.ok) return { text: rejectionText(result.reason, result.computed), changed: false };
  return { text: confirmationText(result, resolved), changed: true, after: { entries: result.entries, computed: result.computed } };
}

export interface Outgoing {
  to: string;
  text: string;
}

async function send(env: Env, deps: Deps, stored: Stored, out: Outgoing, now: number): Promise<boolean> {
  const { telnyxApiKey, telnyxNumber } = stored.secrets;
  if (!telnyxApiKey || !telnyxNumber) {
    await recordOutbound(env.DB, randomId(), out.to, out.text, now, 'not_sent', 'text messaging is not set up');
    return false;
  }
  const result = await sendTelnyx(deps, { apiKey: telnyxApiKey, from: telnyxNumber, to: out.to, text: out.text });
  await recordOutbound(env.DB, randomId(), out.to, out.text, now, result.ok ? 'sent' : 'failed', result.ok ? result.id : result.error);
  return result.ok;
}

export async function sendText(env: Env, deps: Deps, stored: Stored, out: Outgoing): Promise<boolean> {
  return send(env, deps, stored, out, deps.now());
}

/**
 * Handles one received message. If the log changed, returns what is needed
 * to bring the calendar up to date; otherwise null.
 */
export async function handleInbound(
  env: Env,
  deps: Deps,
  stored: Stored,
  message: InboundMessage,
): Promise<{ entries: StoredEntry[]; computed: Computed } | null> {
  const now = deps.now();
  const isNew = await recordInbound(env.DB, message.eventId, message.from, message.text, now);
  if (!isNew) return null; // a repeated delivery of a message already handled
  const phone = stored.app.phones.find(p => p.number === message.from);
  if (!phone || !phone.canUpdate) {
    await setSmsStatus(env.DB, message.eventId, 'ignored', 'number is not allowed to record');
    return null; // strangers get no reply
  }
  if ((await inboundCountSince(env.DB, message.from, now - 3_600_000)) > MAX_INBOUND_PER_HOUR) {
    await setSmsStatus(env.DB, message.eventId, 'ignored', 'too many messages in an hour');
    return null;
  }
  const entries = await listEntries(env.DB);
  let reply: Reply;
  try {
    reply = await runCommand(env, stored, entries, message.text, `sms:${message.from}`, now);
  } catch (e) {
    await setSmsStatus(env.DB, message.eventId, 'error', e instanceof Error ? e.message : 'error');
    await send(env, deps, stored, { to: message.from, text: 'Something went wrong; nothing was changed. Please use the dashboard.' }, now);
    return null;
  }
  await setSmsStatus(env.DB, message.eventId, reply.changed ? 'recorded' : 'answered', null);
  await send(env, deps, stored, { to: message.from, text: reply.text }, now);
  return reply.changed ? (reply.after ?? null) : null;
}

// ---------- reminders ----------

/** A reminder whose time passed longer ago than this is no longer sent. */
const REMINDER_STALE_MS = 3 * 3_600_000;

export async function sendDueReminders(env: Env, deps: Deps, stored: Stored, computed: Computed | null): Promise<number> {
  const now = deps.now();
  if (!stored.secrets.telnyxApiKey || !stored.secrets.telnyxNumber) return 0;
  if (!computed) return 0;
  // Nothing is sent during Shabbat or Yom Tov, even a reminder that is overdue.
  if (stored.app.reminders.beforeRestDays) {
    const ctx: ReminderContext = { place: computed.place, zopts: computed.zopts, yomTov: stored.halachic.settings.yomTov };
    if (restDayAt(now, ctx) !== null) return 0;
  }
  let sent = 0;
  for (const r of computed.reminders) {
    if (r.at > now || r.at <= now - REMINDER_STALE_MS) continue;
    for (const phone of stored.app.phones) {
      if (!phone.reminders.includes(r.kind)) continue;
      // Claim first, so that two runs at once cannot both send it.
      if (!(await claimReminder(env.DB, r.key, phone.number, now))) continue;
      const ok = await send(env, deps, stored, { to: phone.number, text: r.text }, now);
      if (ok) sent++;
      else await env.DB.prepare('DELETE FROM reminders_sent WHERE key = ? AND phone = ?').bind(r.key, phone.number).run(); // try again next time
    }
  }
  return sent;
}

// ---------- calendar ----------

/** Calendar operations per run, to stay within the platform's limit on outgoing requests. */
const MAX_SYNC_OPS = 35;

export type SyncOutcome =
  | { status: 'not_connected' }
  | { status: 'no_place' }
  | { status: 'ok'; result: SyncResult }
  | { status: 'error'; message: string };

/**
 * Brings the Google calendar up to date. `computed` is the current picture
 * (see `compute`), passed in so that it is worked out once per request.
 */
export async function syncCalendar(env: Env, deps: Deps, stored: Stored, computed: Computed | null): Promise<SyncOutcome> {
  const now = deps.now();
  const { googleClientId, googleClientSecret, googleRefreshToken } = stored.secrets;
  if (!stored.google || !googleClientId || !googleClientSecret || !googleRefreshToken) return { status: 'not_connected' };
  if (!computed) return { status: 'no_place' };
  try {
    const token = await refreshAccessToken(deps, { clientId: googleClientId, clientSecret: googleClientSecret, refreshToken: googleRefreshToken });
    const calendar = new GoogleCalendar(deps, token);
    const windowStart = now - stored.app.calendar.historyDays * 86_400_000;
    const tz = computed.place.timeZone;
    const desired = computed.events.map(e => toDesired(e, tz));
    const existing = await calendar.listManagedEvents(stored.google.calendarId, windowStart);
    const ops = planSync(desired, existing, windowStart);
    const result = await applySync(calendar, stored.google.calendarId, ops, MAX_SYNC_OPS);
    await saveSync(env.DB, { dirty: result.remaining > 0, lastRunAt: now, lastOkAt: now, lastError: null }, now);
    return { status: 'ok', result };
  } catch (e) {
    let message = e instanceof Error ? e.message : 'unknown error';
    if (e instanceof GoogleError && e.code === 'invalid_grant') {
      message = 'Google no longer accepts the saved sign-in. Connect Google Calendar again in the dashboard.';
    }
    await saveSync(env.DB, { dirty: true, lastRunAt: now, lastOkAt: stored.sync.lastOkAt, lastError: message }, now);
    return { status: 'error', message };
  }
}

/** The calendar is refreshed at least this often, so that plans that depend on today's date stay current. */
const SYNC_REFRESH_MS = 6 * 3_600_000;

/** The periodic job: reminders, then the calendar if it is due. */
export async function tick(env: Env, deps: Deps): Promise<void> {
  const stored = await loadStored(env);
  const entries = await listEntries(env.DB);
  const now = deps.now();
  const computed = compute(stored, entries, now);
  await sendDueReminders(env, deps, stored, computed);
  if (stored.sync.dirty || stored.sync.lastOkAt === null || now - stored.sync.lastOkAt >= SYNC_REFRESH_MS) {
    await syncCalendar(env, deps, stored, computed);
  }
}
