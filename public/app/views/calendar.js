/*
 * The month calendar on the Today tab, drawn from S.grid (src/app/grid.ts):
 * a weekday header, each day with its civil and Hebrew day, marks for what
 * falls on it, Shabbat and Yom Tov shaded, today outlined. Choosing a day
 * shows its details below the month. Arrow keys move between days.
 */
import { button, card, h, icon } from '../lib.js';
import { S, t } from '../store.js';
import { cleanDayNumber, isNight, legend, mark } from './marks.js';
import { addDays, fmtDate, longDate, refresh, region, weekdayOf } from './shared.js';
import { openRecordFor } from './record.js';

const WEEKDAYS = [
  ['Sun', 'Sunday'],
  ['Mon', 'Monday'],
  ['Tue', 'Tuesday'],
  ['Wed', 'Wednesday'],
  ['Thu', 'Thursday'],
  ['Fri', 'Friday'],
  ['Sat', 'Saturday'],
];
const KIND_ORDER = { flow: 0, hefsek: 1, clean_day: 2, mikvah: 3, onah: 4 };

/** What is shown: the month ('YYYY-MM') and the chosen day. */
const cal = { month: null, selected: null, grid: null, legendOpen: false };

let idx = { grid: null, days: new Map(), starting: new Map(), continuing: new Map(), months: [] };

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

/** Indexes S.grid by date, once for each new state. */
function index() {
  if (idx.grid === S.grid) return idx;
  const days = new Map(S.grid.days.map(d => [d.date, d]));
  const starting = new Map();
  const continuing = new Map();
  for (const e of S.grid.events) {
    if (e.allDay) {
      for (let d = e.startDate; d <= e.endDate; d = addDays(d, 1)) push(starting, d, e);
    } else {
      push(starting, e.startDate, e);
      if (e.endDate !== e.startDate) push(continuing, e.endDate, e);
    }
  }
  for (const list of starting.values()) list.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (isNight(a) ? 1 : 0) - (isNight(b) ? 1 : 0));
  const months = [...new Set(S.grid.days.map(d => d.date.slice(0, 7)))];
  idx = { grid: S.grid, days, starting, continuing, months };
  return idx;
}

/** Shows the month of this date and chooses the date (used by "Coming up"). */
export function showDate(date) {
  if (!S.grid) return;
  const i = index();
  if (!i.days.has(date)) return;
  cal.selected = date;
  cal.month = date.slice(0, 7);
  refresh('cal');
  const el = document.getElementById('day-' + date);
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  }
}

function ensureState() {
  const i = index();
  // A new day (or a first visit) starts on today.
  if (cal.grid !== S.grid) {
    if (!cal.selected || !i.days.has(cal.selected)) cal.selected = S.grid.today;
    if (!cal.month || !i.months.includes(cal.month)) cal.month = cal.selected.slice(0, 7);
    cal.grid = S.grid;
  }
  return i;
}

const monthTitle = month => fmtDate(month + '-01', { month: 'long', year: 'numeric' });

function hebrewSpan(i, month) {
  const inMonth = S.grid.days.filter(d => d.date.startsWith(month));
  if (inMonth.length === 0) return '';
  const a = inMonth[0].hebrewMonth;
  const b = inMonth[inMonth.length - 1].hebrewMonth;
  return a === b ? a : a + ' – ' + b;
}

function eventLabel(e) {
  return e.title + (e.projected && !/projected/.test(e.title) ? ' (projected)' : '');
}

function dayLabel(date, day, events) {
  const parts = [longDate(date) + ', ' + day.hebrewDay + ' ' + day.hebrewMonth];
  if (date === S.grid.today) parts.push('Today');
  if (day.rest) parts.push(t('{shabbat} or {yom_tov}'));
  for (const e of events) parts.push(eventLabel(e));
  if (events.length === 0) parts.push('Nothing marked');
  return parts.join('. ') + '.';
}

function select(date, focus) {
  const i = index();
  if (!i.days.has(date)) return;
  cal.selected = date;
  cal.month = date.slice(0, 7);
  refresh('cal');
  if (focus) {
    const el = document.getElementById('day-' + date);
    if (el) el.focus();
  }
}

function onKey(e) {
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  const from = cal.selected;
  let to = null;
  if (moves[e.key] !== undefined) to = addDays(from, moves[e.key]);
  else if (e.key === 'Home') to = addDays(from, -weekdayOf(from));
  else if (e.key === 'End') to = addDays(from, 6 - weekdayOf(from));
  else if (e.key === 'PageUp' || e.key === 'PageDown') {
    const [y, m, d] = from.split('-').map(Number);
    const target = new Date(Date.UTC(y, m - 1 + (e.key === 'PageUp' ? -1 : 1), 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(d, last));
    to = target.toISOString().slice(0, 10);
  }
  if (to === null) return;
  e.preventDefault();
  if (index().days.has(to)) select(to, true);
}

function goMonth(month) {
  const i = index();
  if (!i.months.includes(month)) return;
  cal.month = month;
  const days = S.grid.days.filter(d => d.date.startsWith(month));
  cal.selected = S.grid.today.startsWith(month) ? S.grid.today : days[0].date;
  refresh('cal');
}

function monthGrid(i) {
  const month = cal.month;
  const [y, m] = month.split('-').map(Number);
  const first = month + '-01';
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = weekdayOf(first);
  const cells = [];
  for (let k = 0; k < lead; k++) cells.push(h('td', { class: 'pad' }));
  for (let d = 1; d <= length; d++) {
    const date = month + '-' + String(d).padStart(2, '0');
    const day = i.days.get(date);
    if (!day) {
      cells.push(h('td', { class: 'out' }, h('span', { class: 'day none', 'aria-hidden': 'true' }, h('span', { class: 'cd' }, String(d)))));
      continue;
    }
    const events = i.starting.get(date) || [];
    const selected = date === cal.selected;
    const isToday = date === S.grid.today;
    cells.push(
      h(
        'td',
        {},
        h(
          'button',
          {
            type: 'button',
            id: 'day-' + date,
            class: 'day' + (day.rest ? ' rest' : '') + (isToday ? ' today' : '') + (selected ? ' selected' : '') + (date > S.grid.today ? ' future' : ''),
            tabindex: selected ? '0' : '-1',
            'aria-pressed': String(selected),
            'aria-current': isToday ? 'date' : null,
            'aria-label': dayLabel(date, day, events),
            onclick: () => select(date, true),
          },
          h('span', { class: 'cd' }, String(d)),
          h('span', { class: 'hd', lang: S.terms === 'he' ? 'he' : null }, day.hebrewDay, day.monthStart ? h('span', { class: 'hm' }, ' ' + day.hebrewMonth) : null),
          h('span', { class: 'marks' }, events.map(e => mark(e))),
        ),
      ),
    );
  }
  while (cells.length % 7 !== 0) cells.push(h('td', { class: 'pad' }));
  const rows = [];
  for (let k = 0; k < cells.length; k += 7) rows.push(h('tr', {}, cells.slice(k, k + 7)));
  return h(
    'table',
    { class: 'month', 'aria-labelledby': 'cal-title', onkeydown: onKey },
    h('thead', {}, h('tr', {}, WEEKDAYS.map(([short, long], k) => h('th', { scope: 'col', abbr: long, class: k === 6 ? 'sat' : null }, h('span', { 'aria-hidden': 'true' }, short), h('span', { class: 'visually-hidden' }, long))))),
    h('tbody', {}, rows),
  );
}

function eventTime(e) {
  if (e.allDay) return 'All day';
  if (e.kind === 'mikvah') return 'After ' + e.start;
  if (e.start === e.end || !e.end) return e.start;
  if (e.startDate !== e.endDate) return e.start + ' to ' + e.end + ' the next morning';
  return e.start + ' to ' + e.end;
}

/** "the night of 15 Kislev": the Hebrew date a night that begins on this civil date belongs to. */
function nightOf(date) {
  const next = index().days.get(addDays(date, 1));
  return next ? 'The night of ' + next.hebrewDay + ' ' + next.hebrewMonth + ': ' : '';
}

function eventRow(e, continuing) {
  const n = e.kind === 'clean_day' ? cleanDayNumber(e) : null;
  const night = !continuing && !e.allDay && isNight(e) && e.kind !== 'flow';
  return h(
    'li',
    { class: 'ev ' + e.kind + (e.projected ? ' projected' : '') },
    mark(e, { number: n }),
    h(
      'div',
      { class: 'ev-main' },
      h('div', { class: 'ev-title' }, e.title, e.projected && !/projected/.test(e.title) ? ' (projected)' : ''),
      h('div', { class: 'ev-when' }, continuing ? 'From the evening before, until ' + e.end : (night ? nightOf(e.startDate) : '') + eventTime(e)),
      e.description && !continuing ? h('div', { class: 'ev-desc' }, e.description) : null,
    ),
  );
}

function dayDetail(i) {
  const date = cal.selected;
  const day = i.days.get(date);
  if (!day) return null;
  const events = i.starting.get(date) || [];
  const continuing = (i.continuing.get(date) || []).filter(e => e.kind === 'onah' || e.kind === 'flow');
  const past = date <= S.grid.today;
  return h(
    'div',
    { class: 'day-detail', 'aria-labelledby': 'detail-title', role: 'region' },
    h(
      'div',
      { class: 'detail-head' },
      h('h3', { id: 'detail-title' }, longDate(date), date === S.grid.today ? h('span', { class: 'tag info' }, 'Today') : null),
      h('p', { class: 'hebrew-date', lang: S.terms === 'he' ? 'he' : null }, day.hebrewDay + ' ' + day.hebrewMonth),
    ),
    nextDay(i, date, day),
    h(
      'p',
      { class: 'sun-times' },
      h('span', {}, icon('sun', { size: 'sm' }), 'Sunrise ' + (day.sunrise || '—')),
      h('span', {}, icon('moon', { size: 'sm' }), cap(t('{sunset} ')) + (day.sunset || '—')),
      day.rest ? h('span', { class: 'tag' }, t('{shabbat} or {yom_tov}')) : null,
    ),
    events.length || continuing.length
      ? h('ul', { class: 'events' }, continuing.map(e => eventRow(e, true)), events.map(e => eventRow(e, false)))
      : h('p', { class: 'muted' }, 'Nothing is marked on this day.'),
    past
      ? h(
          'div',
          { class: 'actions' },
          button({ label: date === S.grid.today ? 'Record something today' : 'Record something on this day', icon: 'plus', size: 'sm', variant: 'secondary', attrs: { id: 'cal-record' }, onclick: () => openRecordFor(date) }),
        )
      : null,
  );
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** The Hebrew date changes at sunset: says until when this day's Hebrew date lasts, and which one follows. */
function nextDay(i, date, day) {
  const next = i.days.get(addDays(date, 1));
  if (!next || !day.sunset) return null;
  return h(
    'p',
    { class: 'small muted date-change' },
    t(day.hebrewDay + ' ' + day.hebrewMonth + ' until {sunset} (' + day.sunset + '). The night after it belongs to ' + next.hebrewDay + ' ' + next.hebrewMonth + '.'),
  );
}

/** The calendar card. Call only when S.grid is set. */
export function calendarCard() {
  return card(
    { title: 'Calendar', icon: 'calendar', className: 'calendar-card' },
    region('cal', () => {
      const i = ensureState();
      const at = i.months.indexOf(cal.month);
      const prev = i.months[at - 1];
      const next = i.months[at + 1];
      const onToday = cal.selected === S.grid.today && cal.month === S.grid.today.slice(0, 7);
      return h(
        'div',
        {},
        h(
          'div',
          { class: 'month-nav' },
          button({ label: 'Previous month', icon: 'chevron-left', iconOnly: true, disabled: !prev, attrs: { id: 'cal-prev' }, onclick: () => goMonth(prev) }),
          h('div', { class: 'month-title' }, h('h3', { id: 'cal-title', 'aria-live': 'polite' }, monthTitle(cal.month)), h('p', { class: 'hebrew-months' }, hebrewSpan(i, cal.month))),
          button({ label: 'Next month', icon: 'chevron-right', iconOnly: true, disabled: !next, attrs: { id: 'cal-next' }, onclick: () => goMonth(next) }),
          button({ label: 'Today', size: 'sm', disabled: onToday, attrs: { id: 'cal-today' }, onclick: () => select(S.grid.today, true) }),
        ),
        monthGrid(i),
        h(
          'details',
          { class: 'legend-box', open: cal.legendOpen, ontoggle: e => (cal.legendOpen = e.currentTarget.open) },
          h('summary', { id: 'cal-legend' }, 'What the marks mean'),
          legend(),
        ),
        dayDetail(i),
      );
    }),
  );
}
