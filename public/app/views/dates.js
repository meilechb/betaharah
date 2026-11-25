/*
 * How the page writes a date of its own (the day sheet, the calendar's labels).
 * A plain word first ("Today", "Tonight", "Tomorrow", "Monday", "Monday night"),
 * then the date as the Dates setting has it (S.app.dates):
 *   'hebrew' (the default, also when the field is absent)   16 Kislev
 *   'civil'                                                 Nov 25
 *   'both'                                                  Nov 25 · 16 Kislev
 * A night is written by the evening it begins on; its Hebrew date is the one
 * that begins that night, written as its eve ("eve of 17 Kislev").
 */
import { S } from '../store.js';
import { addDays, fmtDate } from './shared.js';

const MODES = ['hebrew', 'civil', 'both'];

/** The Dates setting: 'hebrew', 'civil' or 'both'. */
export function datesMode() {
  const v = S && S.app ? S.app.dates : null;
  return MODES.includes(v) ? v : 'hebrew';
}

let byDate = { grid: null, map: new Map() };
/** The grid's day for a civil date, or null. */
export function gridDay(date) {
  if (!S || !S.grid) return null;
  if (byDate.grid !== S.grid) byDate = { grid: S.grid, map: new Map(S.grid.days.map(d => [d.date, d])) };
  return byDate.map.get(date) || null;
}

/** "16 Kislev": the Hebrew date of the daytime of a civil date ('' when it is not known). */
export function hebrewText(date) {
  const d = gridDay(date);
  return d ? d.hebrewDay + ' ' + d.hebrewMonth : '';
}

/** "Today", "Tomorrow", "Yesterday", "Monday"; for a night "Tonight", "Tomorrow night", "Last night", "Monday night". */
export function dayWord(date, night) {
  const today = S && S.grid ? S.grid.today : null;
  if (today) {
    if (date === today) return night ? 'Tonight' : 'Today';
    if (date === addDays(today, 1)) return night ? 'Tomorrow night' : 'Tomorrow';
    if (date === addDays(today, -1)) return night ? 'Last night' : 'Yesterday';
  }
  const weekday = fmtDate(date, { weekday: 'long' });
  return night ? weekday + ' night' : weekday;
}

/** The date as the setting has it: "16 Kislev", "Nov 25", "Nov 25 · 16 Kislev"; for a night, "eve of 17 Kislev". */
export function dateText(date, night) {
  const mode = datesMode();
  const civil = fmtDate(date, { month: 'short', day: 'numeric' });
  const heb = night ? hebrewText(addDays(date, 1)) : hebrewText(date);
  const hebrew = heb ? (night ? 'eve of ' + heb : heb) : '';
  if (mode === 'civil' || !hebrew) return civil;
  if (mode === 'hebrew') return hebrew;
  return civil + ' · ' + hebrew;
}

/** For a label read aloud: the word, then the full date ("Tuesday, 14 Kislev, November 24"). */
export function spokenDate(date) {
  const mode = datesMode();
  const civil = fmtDate(date, { month: 'long', day: 'numeric' });
  const heb = hebrewText(date);
  const parts = [dayWord(date, false)];
  if (mode === 'civil' || !heb) parts.push(civil);
  else if (mode === 'hebrew') parts.push(heb, civil);
  else parts.push(civil, heb);
  return parts.join(', ');
}
