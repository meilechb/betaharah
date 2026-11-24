// The calendar in the hero. A date and a ZIP code, then the month from
// POST /api/try (the same calculation as an account, nothing saved). The
// ZIP is looked up on the server. The page is complete without this script:
// it keeps the example month.

const SVG = 'http://www.w3.org/2000/svg';
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
const DAY_MS = 86400000;

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

function svgIcon(id) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', '#' + id);
  svg.append(use);
  return svg;
}

const parse = iso => Date.parse(iso + 'T00:00:00Z');
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const addDays = (d, n) => iso(parse(d) + n * DAY_MS);
const weekdayOf = d => new Date(parse(d)).getUTCDay();
const fmt = (d, opts) => new Date(parse(d)).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
const longDate = d => fmt(d, { weekday: 'long', month: 'long', day: 'numeric' });

function browserToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const plainTitle = e => (e.title || '').replace(' (projected)', '');
const isNight = e => e.kind === 'mikvah' || (e.startDate && e.endDate && e.startDate !== e.endDate) || /\((night|לילה)\)/.test(e.title || '');

function mark(e) {
  const kind = e.kind === 'clean_day' ? 'clean' : e.kind;
  const cls = ['mk', kind];
  if (e.projected) cls.push('projected');
  let glyph = '•';
  if (e.kind === 'flow') glyph = svgIcon('i-drop');
  else if (e.kind === 'hefsek') glyph = 'H';
  else if (e.kind === 'mikvah') glyph = 'M';
  else if (e.kind === 'clean_day') {
    const m = /:(\d)$/.exec(e.key || '');
    glyph = m ? m[1] : '';
  } else if (e.kind === 'onah') glyph = svgIcon(isNight(e) ? 'i-moon' : 'i-sun');
  return el('span', { class: cls.join(' '), 'aria-hidden': 'true' }, glyph);
}

function friendly(status, message) {
  const text = message || '';
  if (status === 429) return 'Too many tries. Please wait a few minutes.';
  if (/zip|postal|place/i.test(text)) return "We don't know that zip code.";
  if (/not come yet|future/i.test(text)) return "That day hasn't come yet.";
  return 'The calendar could not be shown just now.';
}

let root = null;
let statusLine = null;
let errorLine = null;
let dateInput = null;
let zipInput = null;
let month = null;
let selected = null;
let grid = null;
let indexCache = null;
let sent = '';
let generation = 0;
let timer = 0;

function indexOf(g) {
  if (indexCache && indexCache.grid === g) return indexCache;
  const days = new Map(g.days.map(d => [d.date, d]));
  const starting = new Map();
  for (const e of g.events) {
    const add = d => {
      if (!starting.has(d)) starting.set(d, []);
      starting.get(d).push(e);
    };
    if (e.allDay) for (let d = e.startDate; d <= e.endDate; d = addDays(d, 1)) add(d);
    else add(e.startDate);
  }
  for (const list of starting.values()) list.sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || (isNight(a) ? 1 : 0) - (isNight(b) ? 1 : 0));
  indexCache = { grid: g, days, starting, months: [...new Set(g.days.map(d => d.date.slice(0, 7)))] };
  return indexCache;
}

function showError(text) {
  if (!errorLine) return;
  errorLine.replaceChildren(text, ' ', el('a', { href: '/app/' }, 'Start for free'));
  errorLine.hidden = false;
}

function clearError() {
  if (!errorLine) return;
  errorLine.replaceChildren();
  errorLine.hidden = true;
}

function choose(date, focus) {
  selected = date;
  month = date.slice(0, 7);
  draw();
  if (focus) document.getElementById('try-day-' + date)?.focus();
}

function dayLabel(g, date, day, events) {
  const parts = [longDate(date)];
  if (day.hebrewDay) parts[0] += ', ' + day.hebrewDay + (day.hebrewMonth ? ' ' + day.hebrewMonth : '');
  if (date === g.today) parts.push('Today');
  if (day.rest) parts.push('Shabbat or Yom Tov');
  for (const e of events) parts.push(plainTitle(e));
  if (events.length === 0) parts.push('Nothing on this day');
  return parts.join('. ') + '.';
}

function monthTable(i, g) {
  const [y, m] = month.split('-').map(Number);
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [];
  for (let k = 0; k < weekdayOf(month + '-01'); k++) cells.push(el('td', { class: 'pad' }));
  for (let d = 1; d <= length; d++) {
    const date = month + '-' + String(d).padStart(2, '0');
    const day = i.days.get(date);
    if (!day) {
      cells.push(el('td', { class: 'pad' }));
      continue;
    }
    const events = i.starting.get(date) || [];
    const isSelected = date === selected;
    const today = date === g.today;
    cells.push(
      el(
        'td',
        {},
        el(
          'button',
          {
            type: 'button',
            id: 'try-day-' + date,
            class: 'day' + (day.rest ? ' rest' : '') + (today ? ' today' : '') + (isSelected ? ' selected' : ''),
            tabindex: isSelected ? '0' : '-1',
            'aria-pressed': String(isSelected),
            'aria-current': today ? 'date' : null,
            'aria-label': dayLabel(g, date, day, events),
            onclick: () => choose(date, true),
          },
          el('span', { class: 'cd' }, String(d)),
          day.hebrewDay ? el('span', { class: 'hd' }, day.hebrewDay) : null,
          events.length ? el('span', { class: 'marks' }, events.map(mark)) : null,
        ),
      ),
    );
  }
  while (cells.length % 7 !== 0) cells.push(el('td', { class: 'pad' }));
  const rows = [];
  for (let k = 0; k < cells.length; k += 7) rows.push(el('tr', {}, cells.slice(k, k + 7)));
  const keys = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  return el(
    'table',
    {
      class: 'month',
      'aria-labelledby': 'try-month',
      onkeydown: e => {
        if (keys[e.key] === undefined || !selected) return;
        const to = addDays(selected, keys[e.key]);
        if (!i.days.has(to)) return;
        e.preventDefault();
        choose(to, true);
      },
    },
    el('thead', {}, el('tr', {}, WEEKDAYS.map(([short, long], k) => el('th', { scope: 'col', abbr: long, class: k === 6 ? 'sat' : null }, short)))),
    el('tbody', {}, rows),
  );
}

function detail(i, g) {
  const day = selected && i.days.get(selected);
  if (!day) return null;
  const events = i.starting.get(selected) || [];
  const when = events.length ? events.map(plainTitle).join('. ') : 'Nothing on this day.';
  return el('p', { class: 'demo-day', id: 'try-detail' }, el('b', {}, longDate(selected) + '.'), ' ', when);
}

function draw() {
  if (!root || !grid) return;
  const i = indexOf(grid);
  if (!selected || !i.days.has(selected)) selected = i.days.has(dateInput.value) ? dateInput.value : grid.today;
  if (!month || !i.months.includes(month)) month = (selected || grid.today).slice(0, 7);
  const at = i.months.indexOf(month);
  const prev = i.months[at - 1];
  const next = i.months[at + 1];
  const go = to => {
    const first = grid.days.find(d => d.date.startsWith(to));
    month = to;
    selected = grid.today.startsWith(to) ? grid.today : first.date;
    draw();
  };
  const active = document.activeElement;
  const id = active && root.contains(active) ? active.id : null;
  root.replaceChildren(
    el(
      'div',
      { class: 'cal-top' },
      el('button', { type: 'button', class: 'cal-btn', id: 'try-prev', 'aria-label': 'Previous month', disabled: !prev, onclick: () => prev && go(prev) }, svgIcon('i-left')),
      el('div', { class: 'cal-title' }, el('b', { id: 'try-month' }, fmt(month + '-01', { month: 'long', year: 'numeric' }))),
      el('button', { type: 'button', class: 'cal-btn', id: 'try-next', 'aria-label': 'Next month', disabled: !next, onclick: () => next && go(next) }, svgIcon('i-right')),
    ),
    monthTable(i, grid),
    detail(i, grid),
  );
  if (id) document.getElementById(id)?.focus();
}

async function calculate() {
  const start = dateInput.value;
  const zip = zipInput.value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{5}$/.test(zip)) return;
  const key = start + '|' + zip;
  if (key === sent) return;
  const gen = ++generation;
  root.setAttribute('aria-busy', 'true');
  try {
    const res = await fetch('/api/try', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-betaharah': '1', accept: 'application/json' },
      body: JSON.stringify({ place: { postal: zip }, today: { date: browserToday(), part: 'day' }, entries: [{ kind: 'flow', date: start, part: 'day' }] }),
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (gen !== generation) return;
    if (!res.ok) {
      showError(friendly(res.status, json && json.error));
      return;
    }
    const refused = (json.outcomes || []).find(o => !o.ok);
    if (refused) {
      showError(friendly(400, refused.error));
      return;
    }
    sent = key;
    clearError();
    grid = json.state.grid;
    indexCache = null;
    month = start.slice(0, 7);
    selected = start;
    if (statusLine) statusLine.textContent = (json.state.status && json.state.status.detail) || '';
    draw();
  } catch {
    if (gen === generation) showError(friendly(0, ''));
  } finally {
    if (gen === generation) root.removeAttribute('aria-busy');
  }
}

function queue() {
  clearTimeout(timer);
  timer = setTimeout(calculate, 250);
}

export function startTry() {
  root = document.getElementById('try-cal');
  dateInput = document.getElementById('try-start');
  zipInput = document.getElementById('try-zip');
  statusLine = document.getElementById('try-status');
  errorLine = document.getElementById('try-error');
  if (!root || !dateInput || !zipInput) return;
  const today = browserToday();
  dateInput.max = today;
  dateInput.value = addDays(today, -4);
  if (!/^\d{5}$/.test(zipInput.value)) zipInput.value = '08701';
  dateInput.addEventListener('change', queue);
  zipInput.addEventListener('input', () => {
    zipInput.value = zipInput.value.replace(/\D/g, '').slice(0, 5);
    if (zipInput.value.length === 5) queue();
  });
  document.getElementById('try-form')?.addEventListener('submit', e => {
    e.preventDefault();
    calculate();
  });
  calculate();
}
