/**
 * The calendar as an iCalendar file (RFC 5545), for the subscription link.
 * Any calendar app can subscribe to it; nothing has to be signed in to.
 */
import type { CalendarEvent } from '../engine/calendar';
import { absToCivil } from '../engine/civil';

function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Lines longer than 75 bytes are continued on the next line, which begins with a space. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines carry a leading space
    if (size + n > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function utc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function dateValue(abs: number): string {
  const c = absToCivil(abs);
  return `${c.y}${String(c.m).padStart(2, '0')}${String(c.d).padStart(2, '0')}`;
}

/** `events` should already be limited to the span of time worth publishing. */
export function toICalendar(events: readonly CalendarEvent[], name: string, now: number): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//betaharah//calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `NAME:${escapeText(name)}`,
    `X-WR-CALNAME:${escapeText(name)}`,
    'COLOR:#6E3D45',
    'X-APPLE-CALENDAR-COLOR:#6E3D45',
    'IMAGE;VALUE=URI;DISPLAY=BADGE;FMTTYPE=image/png:https://betaharah.com/brand/logo-224.png',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  const stamp = utc(now);
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.key.replace(/[^A-Za-z0-9:._-]/g, '_')}@betaharah`, `DTSTAMP:${stamp}`);
    if (e.timed) {
      lines.push(`DTSTART:${utc(e.timed.start)}`, `DTEND:${utc(e.timed.end)}`);
    } else if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateValue(e.allDay.startAbs)}`, `DTEND;VALUE=DATE:${dateValue(e.allDay.endAbsExclusive)}`);
    } else {
      throw new Error(`event ${e.key} has no time`);
    }
    lines.push(`SUMMARY:${escapeText(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
