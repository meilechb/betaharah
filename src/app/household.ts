/**
 * Everything that is worked out from one household's data, with no access
 * to the database or the network: the current picture, recording and
 * removing entries, and the reply to a text command.
 */
import { buildCalendar, type CalendarEvent } from '../engine/calendar';
import { localAbs } from '../engine/civil';
import { processLog, type LogEntry, type LogWarningCode } from '../engine/cycle';
import { buildReminders, clock12, englishDate, statusText, type Reminder, type ReminderContext } from '../engine/present';
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
import { MAX_REMOVED_KEPT, type HouseholdData, type StoredEntry } from './model';

// ---------- the current picture ----------

export interface Where {
  place: GeoPoint;
  zopts: ZmanimOptions;
}

export interface Computed extends Where {
  timeline: Timeline;
  events: CalendarEvent[];
  reminders: Reminder[];
}

/** The location and the definitions of the times, or null while no location is set. */
export function whereOf(data: HouseholdData): Where | null {
  const p = data.app.place;
  if (!p) return null;
  return {
    place: { latitude: p.latitude, longitude: p.longitude, timeZone: p.timeZone, elevation: p.elevation },
    zopts: { useElevation: data.app.useElevation, tzeit: data.halachic.tzeit },
  };
}

/** Days kept beyond the calendar's history, so that events at its edge are complete. */
const WINDOW_MARGIN_DAYS = 3;

/** The whole computed picture, or null while no location is set. */
export function compute(data: HouseholdData, now: number): Computed | null {
  const where = whereOf(data);
  if (!where) return null;
  const { place, zopts } = where;
  const timeline = buildTimeline({
    entries: data.entries.map(e => e.entry),
    settings: data.halachic,
    place,
    useElevation: data.app.useElevation,
    now,
    // Only what the calendar keeps is worked out in full; the whole log still feeds the calculation.
    since: localAbs(now, place.timeZone) - data.app.calendar.historyDays - WINDOW_MARGIN_DAYS,
  });
  const events = buildCalendar(timeline, { style: data.app.calendar.style, lang: data.app.terms, timeZone: place.timeZone });
  const ctx: ReminderContext = { place, zopts, yomTov: data.halachic.yomTov };
  const reminders = buildReminders(timeline, data.app.reminders, ctx);
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

export type RejectReason = 'no_place' | 'duplicate' | 'future' | LogWarningCode;

export type RecordResult =
  | { ok: true; entry: LogEntry; computed: Computed; notes: LogWarningCode[] }
  | { ok: false; reason: RejectReason; computed: Computed | null };

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
 * Adds an entry to the household's data, after checking that it is not a
 * repeat, not in the future, and makes sense where it falls. The data is
 * left untouched otherwise.
 */
export function recordEntry(data: HouseholdData, draft: DraftEntry, source: string, note: string | null, now: number): RecordResult {
  const where = whereOf(data);
  if (!where) return { ok: false, reason: 'no_place', computed: null };
  if (data.entries.some(e => sameMoment(draft, e.entry))) return { ok: false, reason: 'duplicate', computed: null };
  if (inFuture(draft, where, now)) return { ok: false, reason: 'future', computed: null };

  const entry = { ...draft, id: randomId() } as LogEntry;
  const trial = processLog([...data.entries.map(e => e.entry), entry], data.halachic);
  const mine = trial.warnings.filter(w => w.entryId === entry.id).map(w => w.code);
  const rejected = mine.find(code => REJECTED.includes(code));
  if (rejected) {
    // The reply to an immersion recorded too early names the right night, which needs the current picture.
    return { ok: false, reason: rejected, computed: rejected === 'mikvah_too_early' ? compute(data, now) : null };
  }

  data.entries.push({ entry, source, note, createdAt: now });
  data.sync.dirty = true;
  const computed = compute(data, now);
  if (!computed) throw new Error('location disappeared while recording');
  return { ok: true, entry, computed, notes: mine };
}

/** Removes an entry. Returns it, or null if there was none with that id. */
export function removeEntry(data: HouseholdData, id: string, now: number): StoredEntry | null {
  const index = data.entries.findIndex(e => e.entry.id === id);
  if (index < 0) return null;
  const [removed] = data.entries.splice(index, 1) as [StoredEntry];
  data.removed.unshift({ ...removed, removedAt: now });
  if (data.removed.length > MAX_REMOVED_KEPT) data.removed.length = MAX_REMOVED_KEPT;
  data.sync.dirty = true;
  return removed;
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

export function rejectionText(reason: RejectReason, computed: Computed | null): string {
  switch (reason) {
    case 'no_place':
      return 'Not recorded: choose your location on the website first.';
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
      if (computed && s?.state === 'niddah') {
        const m = s.period.planMikvah;
        return `Not recorded: the count is not complete. Mikvah night is ${englishDate(m.eveningAbs)} after ${clock12(m.tzeit, computed.place.timeZone, 'ceil')}.`;
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
        text += ` Clean days ${englishDate(period.cleanDays[0] as number)} - ${englishDate(period.cleanDays[6] as number)}. Mikvah ${englishDate(m.eveningAbs)} after ${clock12(m.tzeit, tz, 'ceil')}.`;
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

// ---------- text commands ----------

/** Entries older than this cannot be removed by text message. */
const UNDO_WINDOW_MS = 48 * 3_600_000;

export interface Reply {
  text: string;
  /** True if the household's data changed. */
  changed: boolean;
  /** The picture after the change, when there was one. */
  computed?: Computed;
}

/** Carries out a text command on the household's data and returns the reply. */
export function runCommand(data: HouseholdData, text: string, now: number): Reply {
  const command = parseCommand(text);
  if (command.kind === 'unknown') return { text: `Not understood; nothing was changed. ${HELP_TEXT}`, changed: false };
  if (command.kind === 'help') return { text: HELP_TEXT, changed: false };

  const where = whereOf(data);
  if (!where) return { text: rejectionText('no_place', null), changed: false };
  const tz = where.place.timeZone;

  if (command.kind === 'status') {
    const computed = compute(data, now);
    return { text: computed ? statusText(computed.timeline, tz) : rejectionText('no_place', null), changed: false };
  }

  if (command.kind === 'undo') {
    const last = [...data.entries].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!last || now - last.createdAt > UNDO_WINDOW_MS) {
      return { text: 'Nothing recent to undo. Older entries can be removed on the website.', changed: false };
    }
    removeEntry(data, last.entry.id, now);
    const after = compute(data, now);
    return {
      text: `Removed: ${entryEnglish(last.entry)}. ${after ? statusText(after.timeline, tz) : ''}`.trim(),
      changed: true,
      computed: after ?? undefined,
    };
  }

  const ctx: ResolveContext = { now, place: where.place, zopts: where.zopts, boundaryMarginMs: data.app.boundaryMarginMinutes * 60_000 };
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
  const result = recordEntry(data, draft, 'sms', null, now);
  if (!result.ok) return { text: rejectionText(result.reason, result.computed), changed: false };
  return { text: confirmationText(result, resolved), changed: true, computed: result.computed };
}
