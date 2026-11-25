/*
 * The home screen's month, drawn from S.grid (src/app/grid.ts), and the small
 * popup of a day. The month pages by Hebrew month or by civil month, as the
 * Dates setting has it (dates.js):
 *   hebrew  Hebrew months; the large number is the Hebrew day, the small one the civil day
 *   civil   civil months; the civil day only
 *   both    civil months; the large number is the civil day, the small one the Hebrew day
 * Each day: its numbers, today outlined, Shabbat and Yom Tov shaded, the days
 * of a niddah period (from the day it began through its mikvah night) tinted,
 * and the marks of marks.js (with a word beside each from about 700 px).
 * Under the month: "Tap a day" / "Choose a day" and "Key" (the legend, in a sheet).
 *
 * Tapping a day opens a small popup beside it (daypop.js): what is expected
 * that day, what is recorded on it with Edit and Delete, and what can be added.
 * Arrow keys move between days, across months.
 */
import { button, h } from '../lib.js';
import { S, currentTab, go, t } from '../store.js';
import { cleanDayNumber, isNight, legend, mark, spoken } from './marks.js';
import { addDays, fmtDate, refresh, region, term, weekdayOf } from './shared.js';
import { clearNotice, notice } from './record.js';
import { datesMode, spokenDate } from './dates.js';
import { openSheet } from './sheet.js';
import { dayPopup, placePopup } from './daypop.js';

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

/** What is shown: the page (a month's key), the chosen day, and the day whose popup is open. */
const cal = { page: null, selected: null, pop: null, grid: null, mode: null };

let idx = { grid: null };

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** A Hebrew day as a number: '14' -> 14; 'י״ד' -> 14 (the letters' values added up). */
const LETTERS = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ל: 30 };
function hebrewNumber(text) {
  if (/^\d+$/.test(text)) return Number(text);
  let n = 0;
  for (const ch of text) n += LETTERS[ch] || 0;
  return n;
}

/**
 * The niddah days: from the day a period began through the date of its
 * mikvah night. A period that began before the grid starts at its first day.
 */
function niddahDays(events, first, last) {
  const set = new Set();
  const fill = (a, b) => {
    for (let d = a; d <= b; d = addDays(d, 1)) set.add(d);
  };
  let start = null;
  let seen = false;
  let lastStep = null;
  for (const e of events) {
    if (e.kind === 'flow') {
      if (start === null) start = e.startDate;
      lastStep = e.startDate;
    } else if (e.kind === 'hefsek' || e.kind === 'clean_day') {
      if (start === null && !seen) start = first;
      if (start !== null) lastStep = e.endDate;
    } else if (e.kind === 'mikvah') {
      if (start === null && !seen) start = first;
      if (start !== null) fill(start, e.startDate);
      start = null;
      lastStep = null;
    } else continue;
    seen = true;
  }
  if (start !== null) fill(start, lastStep && lastStep > start ? (lastStep > last ? last : lastStep) : start);
  return set;
}

/** Indexes S.grid by date, once for each new state. */
function index() {
  if (idx.grid === S.grid) return idx;
  const days = new Map(S.grid.days.map(d => [d.date, d]));
  const starting = new Map();
  for (const e of S.grid.events) {
    if (e.allDay) {
      for (let d = e.startDate; d <= e.endDate; d = addDays(d, 1)) push(starting, d, e);
    } else push(starting, e.startDate, e);
  }
  for (const list of starting.values()) list.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (isNight(a) ? 1 : 0) - (isNight(b) ? 1 : 0));
  const first = S.grid.days[0].date;
  const last = S.grid.days[S.grid.days.length - 1].date;
  idx = { grid: S.grid, days, starting, niddah: niddahDays(S.grid.events, first, last), pages: {} };
  return idx;
}

// ---------- pages: civil months or Hebrew months ----------

const FALL = ['Tishrei', 'Cheshvan', 'Kislev', 'Tevet', 'תשרי', 'חשון', 'חשוון', 'מרחשון', 'כסלו', 'טבת'];

/** The Hebrew year of a page: the grid's, when it sends it; otherwise worked out from the civil year. */
function hebrewYear(day) {
  if (day.hebrewYear !== undefined && day.hebrewYear !== null) return String(day.hebrewYear);
  const [y, m] = day.date.split('-').map(Number);
  return String(y + 3760 + (m >= 9 && FALL.includes(day.hebrewMonth) ? 1 : 0));
}

const shortMonth = date => fmtDate(date, { month: 'short' });
const yearOf = date => date.slice(0, 4);

/** "Nov – Dec 2026", "Dec 2026 – Jan 2027", "Nov 2026". */
function civilSpan(a, b) {
  if (a.slice(0, 7) === b.slice(0, 7)) return shortMonth(a) + ' ' + yearOf(a);
  if (yearOf(a) === yearOf(b)) return shortMonth(a) + ' – ' + shortMonth(b) + ' ' + yearOf(b);
  return shortMonth(a) + ' ' + yearOf(a) + ' – ' + shortMonth(b) + ' ' + yearOf(b);
}

/** The pages for a setting: [{ key, cells: [{ date, day }], title, sub }], in order; and which page each date is on. */
function pagesFor(i, mode) {
  if (i.pages[mode]) return i.pages[mode];
  const pages = [];
  const of = new Map();
  if (mode === 'hebrew') {
    let cur = null;
    for (const d of S.grid.days) {
      // The grid's stable month id when it sends one; otherwise a new month starts on its first day.
      const id = d.hebrewMonthId !== undefined && d.hebrewMonthId !== null ? 'h' + d.hebrewMonthId + (d.hebrewYear !== undefined ? '-' + d.hebrewYear : '') : null;
      const fresh = !cur || (id !== null ? id !== cur.key : d.monthStart);
      if (fresh) {
        cur = { key: id || 'h' + d.date, cells: [], first: d };
        // A month that began before the grid: its earlier days are drawn empty.
        const missing = cur.cells.length === 0 && !d.monthStart ? Math.max(0, hebrewNumber(d.hebrewDay) - 1) : 0;
        for (let k = missing; k > 0; k--) cur.cells.push({ date: addDays(d.date, -k), day: null });
        pages.push(cur);
      }
      cur.cells.push({ date: d.date, day: d });
      of.set(d.date, cur.key);
    }
    for (const p of pages) {
      p.title = p.first.hebrewMonth + ' ' + hebrewYear(p.first);
      p.sub = civilSpan(p.cells[0].date, p.cells[p.cells.length - 1].date);
    }
  } else {
    const months = [...new Set(S.grid.days.map(d => d.date.slice(0, 7)))];
    for (const month of months) {
      const [y, m] = month.split('-').map(Number);
      const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const cells = [];
      for (let d = 1; d <= length; d++) {
        const date = month + '-' + String(d).padStart(2, '0');
        const day = i.days.get(date) || null;
        cells.push({ date, day });
        if (day) of.set(date, month);
      }
      let sub = '';
      if (mode === 'both') {
        const inMonth = cells.filter(c => c.day);
        const a = inMonth[0].day.hebrewMonth;
        const b = inMonth[inMonth.length - 1].day.hebrewMonth;
        sub = a === b ? a : a + ' – ' + b;
      }
      pages.push({ key: month, cells, title: fmtDate(month + '-01', { month: 'long', year: 'numeric' }), sub });
    }
  }
  i.pages[mode] = { list: pages, of };
  return i.pages[mode];
}

function ensureState() {
  const i = index();
  const mode = datesMode();
  const p = pagesFor(i, mode);
  // A new day (or a first visit) starts on today; a new setting shows the chosen day's month.
  if (cal.grid !== S.grid || cal.mode !== mode) {
    if (!cal.selected || !i.days.has(cal.selected)) cal.selected = S.grid.today;
    if (cal.mode !== mode || !p.list.some(x => x.key === cal.page)) cal.page = p.of.get(cal.selected);
    cal.grid = S.grid;
    cal.mode = mode;
  }
  return { i, p };
}

// ---------- the month ----------

/** The word beside a mark, from about 700 px: "Period", "Hefsek", "Clean 3", "Mikvah", "Onah". */
function cellWord(e) {
  const he = S.terms === 'he';
  const firstWord = key => t('{' + key + '}').split(' ')[0];
  switch (e.kind) {
    case 'flow':
      return 'Period';
    case 'hefsek':
      return cap(firstWord('hefsek'));
    case 'clean_day':
      return (he ? t('{clean_day}').split(' ').pop() : 'Clean') + ' ' + (cleanDayNumber(e) || '');
    case 'mikvah':
      return he ? t('{mikvah_night}') : 'Mikvah';
    case 'onah':
      return term('onah');
    default:
      return '';
  }
}

function dayLabel(date, day, events, niddah) {
  const parts = [spokenDate(date)];
  if (niddah) parts.push(cap(t('{niddah} day')));
  if (day.rest) parts.push(t('{shabbat} or {yom_tov}'));
  for (const e of events) parts.push(spoken(e));
  if (events.length === 0) parts.push('Nothing marked');
  return parts.join('. ') + '.';
}

/** The big and small numbers of a day, as the setting has them. */
function numbers(date, day, mode) {
  const civilDay = String(Number(date.slice(8)));
  const lang = S.terms === 'he' ? 'he' : null;
  if (mode === 'hebrew') {
    return [h('span', { class: 'cd', lang }, day.hebrewDay), h('span', { class: 'hd' }, civilDay === '1' ? shortMonth(date) + ' 1' : civilDay)];
  }
  if (mode === 'civil') return [h('span', { class: 'cd' }, civilDay)];
  return [h('span', { class: 'cd' }, civilDay), h('span', { class: 'hd', lang }, day.hebrewDay, day.monthStart ? h('span', { class: 'hm' }, ' ' + day.hebrewMonth) : null)];
}

function monthGrid(i, page, mode) {
  const cells = [];
  for (let k = 0; k < weekdayOf(page.cells[0].date); k++) cells.push(h('td', { class: 'pad' }));
  for (const { date, day } of page.cells) {
    if (!day) {
      cells.push(h('td', { class: 'out' }, h('span', { class: 'day none', 'aria-hidden': 'true' }, mode === 'hebrew' ? null : h('span', { class: 'cd' }, String(Number(date.slice(8)))))));
      continue;
    }
    const events = i.starting.get(date) || [];
    const selected = date === cal.selected;
    const isToday = date === S.grid.today;
    const niddah = i.niddah.has(date);
    cells.push(
      h(
        'td',
        {},
        h(
          'button',
          {
            type: 'button',
            id: 'day-' + date,
            class: 'day' + (day.rest ? ' rest' : '') + (isToday ? ' today' : '') + (selected ? ' selected' : '') + (cal.pop === date ? ' shown' : '') + (date > S.grid.today ? ' future' : '') + (niddah ? ' niddah' : ''),
            tabindex: selected ? '0' : '-1',
            'aria-haspopup': 'dialog',
            'aria-expanded': String(cal.pop === date),
            'aria-current': isToday ? 'date' : null,
            'aria-label': dayLabel(date, day, events, niddah),
            onclick: () => toggleDay(date),
          },
          numbers(date, day, mode),
          h(
            'span',
            { class: 'marks' },
            events.map(e => h('span', { class: 'chip' }, mark(e), h('span', { class: 'cw' }, cellWord(e)))),
          ),
        ),
      ),
    );
  }
  while (cells.length % 7 !== 0) cells.push(h('td', { class: 'pad' }));
  const rows = [];
  for (let k = 0; k < cells.length; k += 7) rows.push(h('tr', {}, cells.slice(k, k + 7)));
  return h(
    'table',
    { class: 'month' + (mode === 'hebrew' ? ' by-hebrew' : ''), 'aria-labelledby': 'cal-title', onkeydown: onKey },
    h('thead', {}, h('tr', {}, WEEKDAYS.map(([short, long], k) => h('th', { scope: 'col', abbr: long, class: k === 6 ? 'sat' : null }, h('span', { 'aria-hidden': 'true' }, short), h('span', { class: 'visually-hidden' }, long))))),
    h('tbody', {}, rows),
  );
}

// ---------- choosing a day, the popup, moving ----------

const focusId = id => {
  const el = document.getElementById(id);
  if (el) el.focus({ preventScroll: true });
};

/** Chooses a day (moves the focus there; the popup closes). */
function select(date, focus) {
  const { i, p } = ensureState();
  if (!i.days.has(date)) return;
  cal.selected = date;
  cal.page = p.of.get(date);
  cal.pop = null;
  refresh('cal');
  if (focus) focusId('day-' + date);
}

/** Opens a day's popup; tapping the open day again closes it. */
function toggleDay(date) {
  if (cal.pop === date) {
    closePop();
    return;
  }
  const { i, p } = ensureState();
  if (!i.days.has(date)) return;
  clearNotice('day');
  cal.selected = date;
  cal.page = p.of.get(date);
  cal.pop = date;
  refresh('cal');
  placePopup(date);
  const first = document.querySelector('#day-pop button, #day-pop input');
  if (first) first.focus({ preventScroll: true });
  else focusId('day-pop');
}

/** Closes the popup; the focus goes back to its day. */
export function closePop(keepFocus, quiet) {
  if (!cal.pop) return;
  const date = cal.pop;
  cal.pop = null;
  if (quiet) return;
  refresh('cal');
  if (!keepFocus) focusId('day-' + date);
}

/** Shows a day on the calendar with its popup (from "Coming up"). */
export async function showDate(date) {
  if (!S.grid) return;
  const { i, p } = ensureState();
  if (!i.days.has(date)) return;
  cal.selected = date;
  cal.page = p.of.get(date);
  cal.pop = date;
  await go('today');
  if (currentTab() === 'today') {
    const first = document.querySelector('#day-pop button');
    if (first) first.focus({ preventScroll: true });
    else focusId('day-pop');
    document.getElementById('day-' + date)?.scrollIntoView({ block: 'nearest' });
  }
}

/** Back from the full form: the focus goes to what opened it, or to the chosen day. */
export function focusDay(openerId) {
  const el = openerId ? document.getElementById(openerId) : null;
  if (el) el.focus();
  else focusId('day-' + cal.selected);
}

function onKey(e) {
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  const on = e.target && e.target.id && e.target.id.startsWith('day-') ? e.target.id.slice(4) : null;
  if (!on) return;
  const from = on;
  let to = null;
  if (moves[e.key] !== undefined) to = addDays(from, moves[e.key]);
  else if (e.key === 'Home') to = addDays(from, -weekdayOf(from));
  else if (e.key === 'End') to = addDays(from, 6 - weekdayOf(from));
  else if (e.key === 'PageUp' || e.key === 'PageDown') {
    const { p } = ensureState();
    const at = p.list.findIndex(x => x.key === cal.page);
    const target = p.list[at + (e.key === 'PageUp' ? -1 : 1)];
    if (target) {
      const here = p.list[at].cells.findIndex(c => c.date === from);
      const days = target.cells.filter(c => c.day);
      const same = target.cells[Math.min(here, target.cells.length - 1)];
      to = same && same.day ? same.date : (here < target.cells.length / 2 ? days[0] : days[days.length - 1]).date;
    }
  }
  if (to === null) return;
  e.preventDefault();
  if (index().days.has(to)) select(to, true);
}

function goPage(key) {
  const { p } = ensureState();
  const page = p.list.find(x => x.key === key);
  if (!page) return;
  cal.page = key;
  cal.pop = null;
  clearNotice('day');
  const days = page.cells.filter(c => c.day);
  cal.selected = days.some(c => c.date === S.grid.today) ? S.grid.today : days[0].date;
  refresh('cal');
}

if (typeof window !== 'undefined') {
  // Escape, and a tap outside the popup and its day, close it.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !cal.pop || currentTab() !== 'today' || document.querySelector('dialog[open]')) return;
    if (!document.getElementById('day-pop')) return;
    e.preventDefault();
    closePop();
  });
  document.addEventListener('pointerdown', e => {
    if (!cal.pop || currentTab() !== 'today' || document.querySelector('dialog[open]')) return;
    const pop = document.getElementById('day-pop');
    const day = document.getElementById('day-' + cal.pop);
    if (!pop || pop.contains(e.target) || (day && day.contains(e.target))) return;
    closePop(true);
  });
  window.addEventListener('resize', () => {
    if (cal.pop) placePopup(cal.pop);
  });
}

// ---------- the home calendar ----------

const touch = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches;

function openKey() {
  openSheet({ id: 'key-sheet', title: 'Key', className: 'key-sheet', opener: 'cal-key', body: () => legend() });
}

/** The month, the line under it, and the popup of a day. Call only when S.grid is set. */
export function homeCalendar() {
  return region('cal', () => {
    const { i, p } = ensureState();
    const mode = datesMode();
    const at = p.list.findIndex(x => x.key === cal.page);
    const page = p.list[at];
    const prev = p.list[at - 1];
    const next = p.list[at + 1];
    const onToday = p.of.get(S.grid.today) === cal.page;
    const pop = cal.pop && p.of.get(cal.pop) === cal.page ? cal.pop : null;
    if (pop) queueMicrotask(() => placePopup(pop));
    const said = notice('day');
    return h(
      'div',
      { class: 'cal-wrap' },
      h(
        'div',
        { class: 'cal-main' },
        h(
          'div',
          { class: 'month-nav' },
          button({ label: 'Previous month', icon: 'chevron-left', iconOnly: true, disabled: !prev, attrs: { id: 'cal-prev' }, onclick: () => goPage(prev.key) }),
          h(
            'div',
            { class: 'month-title' },
            h('h2', { id: 'cal-title', 'aria-live': 'polite', lang: mode === 'hebrew' && S.terms === 'he' ? 'he' : null }, page.title),
            page.sub ? h('p', { class: 'month-sub', id: 'cal-sub' }, page.sub) : null,
          ),
          button({ label: 'Next month', icon: 'chevron-right', iconOnly: true, disabled: !next, attrs: { id: 'cal-next' }, onclick: () => goPage(next.key) }),
          h('div', { class: 'today-slot' }, onToday ? null : button({ label: 'Today', size: 'sm', attrs: { id: 'cal-today' }, onclick: () => select(S.grid.today, true) })),
        ),
        monthGrid(i, page, mode),
        said ? h('div', { class: 'cal-said', id: 'cal-said' }, said) : null,
        h('p', { class: 'cal-hint' }, h('span', { id: 'cal-hint' }, touch() ? 'Tap a day' : 'Choose a day'), button({ label: 'Key', size: 'sm', variant: 'link', attrs: { id: 'cal-key', 'aria-haspopup': 'dialog' }, onclick: openKey })),
        pop
          ? dayPopup({
              date: pop,
              events: i.starting.get(pop) || [],
              niddah: i.niddah.has(pop),
              close: closePop,
            })
          : null,
      ),
    );
  });
}
