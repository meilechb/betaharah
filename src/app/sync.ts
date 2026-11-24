/**
 * Brings the Google calendar in line with the computed events.
 *
 * Each event the app creates carries three private properties: mk=1 (it is
 * ours), k (the event's stable key) and h (a hash of its content). A sync
 * lists our events, then adds the missing ones, replaces the changed ones
 * and removes those no longer wanted. Events a person adds to the calendar
 * by hand have no mk property and are never touched.
 */
import { absToCivil, localToInstant } from '../engine/civil';
import type { CalendarEvent } from '../engine/calendar';
import type { EventResource, ExistingEvent, GoogleCalendar } from './google';

const COLOR: Record<CalendarEvent['kind'], string> = {
  flow: '4', // flamingo
  onah: '9', // blueberry, the closest Google calendar color to tekhelet #2A3C6E
  hefsek: '5', // banana
  clean_day: '7', // peacock
  mikvah: '10', // basil
};
/** An onah that is only an Or Zarua onah gets a lighter colour. */
const COLOR_OR_ZARUA = '6'; // tangerine

function isoDate(abs: number): string {
  const c = absToCivil(abs);
  return `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
}

export interface DesiredEvent {
  key: string;
  hash: string;
  /** End of the event, epoch ms */
  endMs: number;
  resource: EventResource;
}

/**
 * A fast 53-bit string hash (cyrb53). Used only to notice that an event's
 * content changed, not for security; two of them with different seeds are
 * joined, giving 106 bits.
 */
function hash53(text: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export function contentHash(text: string): string {
  return hash53(text, 1) + hash53(text, 2);
}

export function toDesired(event: CalendarEvent, timeZone: string): DesiredEvent {
  let start: EventResource['start'];
  let end: EventResource['end'];
  let endMs: number;
  if (event.timed) {
    start = { dateTime: new Date(event.timed.start).toISOString(), timeZone };
    end = { dateTime: new Date(event.timed.end).toISOString(), timeZone };
    endMs = event.timed.end;
  } else if (event.allDay) {
    start = { date: isoDate(event.allDay.startAbs) };
    end = { date: isoDate(event.allDay.endAbsExclusive) };
    endMs = localToInstant({ ...absToCivil(event.allDay.endAbsExclusive), hh: 0, mi: 0, ss: 0 }, timeZone);
  } else {
    throw new Error(`event ${event.key} has no time`);
  }
  const content = {
    summary: event.title,
    description: event.description,
    start,
    end,
    transparency: 'transparent' as const,
    colorId: event.light ? COLOR_OR_ZARUA : COLOR[event.kind],
    reminders: { useDefault: true },
  };
  const hash = contentHash(JSON.stringify(content));
  return {
    key: event.key,
    hash,
    endMs,
    resource: { ...content, extendedProperties: { private: { mk: '1', k: event.key, h: hash } } },
  };
}

export type SyncOp =
  | { op: 'insert'; desired: DesiredEvent }
  | { op: 'update'; id: string; desired: DesiredEvent }
  | { op: 'delete'; id: string; key: string | null };

/** Events ending within this long after the start of the window are left as they are. */
const EDGE_MS = 7 * 86_400_000;

/**
 * What must change. `windowStart` is the oldest time the app keeps up to
 * date: desired events that ended before it are not written, and existing
 * events near it are not removed.
 */
export function planSync(desired: readonly DesiredEvent[], existing: readonly ExistingEvent[], windowStart: number): SyncOp[] {
  const ops: SyncOp[] = [];
  const wanted = new Map<string, DesiredEvent>();
  for (const d of desired) {
    if (d.endMs > windowStart) wanted.set(d.key, d);
  }
  const seen = new Set<string>();
  for (const e of existing) {
    const key = e.props.k ?? null;
    const want = key === null ? undefined : wanted.get(key);
    if (key !== null && want && !seen.has(key)) {
      seen.add(key);
      if (e.props.h !== want.hash) ops.push({ op: 'update', id: e.id, desired: want });
      continue;
    }
    // A duplicate of a wanted event is always removed; an unwanted event is
    // removed unless it sits at the far edge of the window.
    const duplicate = key !== null && want !== undefined;
    if (duplicate || !(e.endMs <= windowStart + EDGE_MS)) ops.push({ op: 'delete', id: e.id, key });
  }
  for (const [key, d] of wanted) {
    if (!seen.has(key)) ops.push({ op: 'insert', desired: d });
  }
  // Removals first, so a calendar never shows both the old and the new version of a moved event for long.
  const order = { delete: 0, update: 1, insert: 2 } as const;
  return ops.sort((a, b) => order[a.op] - order[b.op]);
}

export interface SyncResult {
  inserted: number;
  updated: number;
  deleted: number;
  /** Operations left for the next run because of the per-run limit. */
  remaining: number;
}

/** Applies up to `maxOps` operations. */
export async function applySync(calendar: GoogleCalendar, calendarId: string, ops: readonly SyncOp[], maxOps: number): Promise<SyncResult> {
  const result: SyncResult = { inserted: 0, updated: 0, deleted: 0, remaining: 0 };
  let done = 0;
  for (const op of ops) {
    if (done >= maxOps) {
      result.remaining++;
      continue;
    }
    if (op.op === 'delete') {
      await calendar.deleteEvent(calendarId, op.id);
      result.deleted++;
    } else if (op.op === 'update') {
      await calendar.updateEvent(calendarId, op.id, op.desired.resource);
      result.updated++;
    } else {
      await calendar.insertEvent(calendarId, op.desired.resource);
      result.inserted++;
    }
    done++;
  }
  return result;
}
