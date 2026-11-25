// The calendar at the top of the home page. A sample month is already
// filled in. Tapping a day opens the same choices as the app; the month
// is worked out again by POST /api/try. The first time she adds a day,
// the browser is asked for its location (for sunset). If that is refused,
// a default place is used and nothing is said about it.

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
const FALLBACK = { postal: '08701' };

const OPTIONS = [
  { id: 'try-add-flow-day', kind: 'flow', part: 'day', label: 'Flow, by day', mark: 'flow' },
  { id: 'try-add-flow-night', kind: 'flow', part: 'night', label: 'Flow, at night', mark: 'flow' },
  { id: 'try-add-hefsek', kind: 'hefsek', label: 'Hefsek taharah', mark: 'hefsek' },
  { id: 'try-add-stain-day', kind: 'stain', part: 'day', label: 'Stain, by day', mark: 'flow', more: true },
  { id: 'try-add-stain-night', kind: 'stain', part: 'night', label: 'Stain, at night', mark: 'flow', more: true },
  { id: 'try-add-broken-day', kind: 'broken', part: 'day', label: 'Count broken, by day', mark: 'broken', more: true },
  { id: 'try-add-broken-night', kind: 'broken', part: 'night', label: 'Count broken, at night', mark: 'broken', more: true },
  { id: 'try-add-mikvah', kind: 'mikvah', label: 'Immersion, that evening', mark: 'mikvah', more: true },
];

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
const isoOf = ms => new Date(ms).toISOString().slice(0, 10);
const addDays = (d, n) => isoOf(parse(d) + n * DAY_MS);
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
  const kind = e.kind === 'clean_day' ? 'clean' : e.kind === 'broken' ? 'broken' : e.kind;
  const cls = ['mk', kind];
  if (e.projected) cls.push('projected');
  if (e.kind === 'hefsek' && e.projected) cls.push('plan');
  let glyph = '•';
  if (e.kind === 'flow' || e.kind === 'stain') glyph = svgIcon('i-drop');
  else if (e.kind === 'hefsek') glyph = 'H';
  else if (e.kind === 'mikvah') glyph = 'M';
  else if (e.kind === 'broken') glyph = '×';
  else if (e.kind === 'clean_day') {
    const m = /:(\d)$/.exec(e.key || '');
    glyph = m ? m[1] : '';
  } else if (e.kind === 'onah') glyph = svgIcon(isNight(e) ? 'i-moon' : 'i-sun');
  return el('span', { class: cls.join(' '), 'aria-hidden': 'true' }, glyph);
}

function friendly(message) {
  const text = message || '';
  if (/not come yet|future/i.test(text)) return 'That day has not come yet.';
  if (/already/i.test(text)) return 'That is already on the calendar.';
  if (/no period/i.test(text)) return 'There is no period open for that.';
  if (/no hefsek/i.test(text)) return 'The hefsek is not on the calendar yet.';
  if (/not complete/i.test(text)) return 'The clean days are not finished yet.';
  if (/too many|wait/i.test(text)) return 'Too many tries. Please wait a few minutes.';
  return 'That could not be added.';
}

let root = null;
let statusLine = null;
let errorLine = null;
let sheet = null;
let sheetDate = null;
let sheetError = null;
let grid = null;
let indexCache = null;
let month = null;
let selected = null;
let entries = [];
let place = FALLBACK;
let askedLocation = false;
let animate = false;
let prevMarks = new Map();
let generation = 0;

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

function resultSentence(state) {
  const mikvah = (state.grid.events || []).find(e => e.kind === 'mikvah');
  if (mikvah) return 'Mikvah night is ' + longDate(mikvah.startDate) + '.';
  const detail = state.status && state.status.detail;
  if (detail) return detail.endsWith('.') ? detail : detail + '.';
  return '';
}

function showSheetError(text) {
  if (!sheetError) return;
  sheetError.textContent = text;
  sheetError.hidden = !text;
}

async function locate() {
  if (askedLocation) return place;
  askedLocation = true;
  if (!navigator.geolocation) return place;
  const point = await new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 4000);
    navigator.geolocation.getCurrentPosition(
      pos => {
        clearTimeout(timer);
        resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { timeout: 3500, maximumAge: 600000 },
    );
  });
  if (point) place = point;
  return place;
}

async function calculate(added) {
  const today = browserToday();
  const gen = ++generation;
  root.setAttribute('aria-busy', 'true');
  try {
    let res = await post(place, today);
    if (res.status === 400 && place !== FALLBACK) {
      place = FALLBACK;
      res = await post(place, today);
    }
    const json = res.json;
    if (gen !== generation) return false;
    if (!res.ok) {
      if (added) {
        entries.pop();
        showSheetError(friendly((json && json.error) || ''));
      } else if (errorLine) {
        errorLine.replaceChildren('The calendar could not be shown just now. ', el('a', { href: '/app/' }, 'Start for free'));
        errorLine.hidden = false;
      }
      return false;
    }
    const refused = (json.outcomes || []).find(o => o && !o.ok);
    if (refused) {
      if (added) entries.pop();
      showSheetError(friendly(refused.error));
      return false;
    }
    showSheetError('');
    grid = json.state.grid;
    indexCache = null;
    fillSummary(json.state, added);
    if (errorLine) errorLine.hidden = true;
    animate = added;
    draw();
    return true;
  } catch {
    if (gen === generation && added) {
      entries.pop();
      showSheetError('That could not be added.');
    } else if (gen === generation && errorLine) {
      errorLine.replaceChildren('The calendar could not be shown just now. ', el('a', { href: '/app/' }, 'Start for free'));
      errorLine.hidden = false;
    }
    return false;
  } finally {
    if (gen === generation) root.removeAttribute('aria-busy');
  }
}

async function post(where, today) {
  const res = await fetch('/api/try', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-betaharah': '1', accept: 'application/json' },
    body: JSON.stringify({ place: where, today: { date: today, part: 'day' }, entries }),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

function fillSummary(state, added) {
  const box = document.getElementById('try-summary');
  if (!box) return;
  const events = (state.grid && state.grid.events) || [];
  const short = d => fmt(d, { weekday: 'short', month: 'short', day: 'numeric' });
  const rows = [];
  const hefsek = events.find(e => e.kind === 'hefsek');
  const mikvah = events.find(e => e.kind === 'mikvah');
  if (hefsek) rows.push(['Hefsek', short(hefsek.startDate)]);
  if (mikvah) rows.push(['Mikvah night', short(mikvah.startDate)]);
  box.replaceChildren(...rows.map(([name, when]) => el('li', {}, el('b', {}, name), el('span', {}, when))));
  box.hidden = rows.length === 0;
  if (added) {
    box.classList.remove('changed');
    void box.offsetWidth;
    box.classList.add('changed');
  }
}

function toneOf(events) {
  if (events.some(e => e.kind === 'mikvah')) return ' tone-mikvah';
  if (events.some(e => e.kind === 'hefsek')) return ' tone-hefsek';
  if (events.some(e => e.kind === 'flow' || e.kind === 'stain')) return ' tone-flow';
  if (events.some(e => e.kind === 'clean_day')) return ' tone-clean';
  if (events.some(e => e.kind === 'onah')) return ' tone-onah';
  return '';
}

function samplePlan(today) {
  const [y, m, d] = today.split('-').map(Number);
  let year = y;
  let monthNo = d >= 14 ? m : m - 1;
  if (monthNo < 1) {
    monthNo = 12;
    year -= 1;
  }
  const key = year + '-' + String(monthNo).padStart(2, '0');
  return {
    month: key,
    entries: [
      { kind: 'flow', date: key + '-01', part: 'day' },
      { kind: 'hefsek', date: key + '-05' },
    ],
  };
}

function openSheet(date) {
  selected = date;
  const day = grid && indexOf(grid).days.get(date);
  const hebrew = day && day.hebrewDay ? day.hebrewDay + ' ' + (day.hebrewMonth || '') : '';
  sheetDate.textContent = longDate(date) + (hebrew ? ' · ' + hebrew : '');
  const heb = document.getElementById('try-sheet-hebrew');
  if (heb) heb.textContent = '';
  showSheetError('');
  draw();
  const mobile = window.matchMedia('(max-width: 720px)').matches;
  sheet.classList.toggle('sheet-mobile', mobile);
  sheet.classList.toggle('sheet-pop', !mobile);
  if (!sheet.open) sheet.show();
  sheet.style.margin = '0';
  sheet.style.inset = 'auto';
  sheet.style.position = mobile ? 'fixed' : 'absolute';
  if (mobile) {
    sheet.style.left = '0';
    sheet.style.right = '0';
    sheet.style.top = 'auto';
    sheet.style.bottom = '0';
    sheet.style.width = '100%';
    sheet.classList.remove('point-left', 'point-right');
    return;
  }
  const host = document.getElementById('try');
  const btn = document.getElementById('try-day-' + date);
  const cell = btn.getBoundingClientRect();
  const hostBox = host.getBoundingClientRect();
  const margin = 8;
  const gap = 12;
  const w = Math.min(340, window.innerWidth - margin * 2);
  sheet.style.width = w + 'px';
  sheet.style.right = 'auto';
  sheet.style.bottom = 'auto';
  const h = sheet.offsetHeight || 360;
  let left = cell.right - hostBox.left + gap;
  let point = 'point-left';
  if (hostBox.left + left + w > window.innerWidth - margin) {
    left = cell.left - hostBox.left - w - gap;
    point = 'point-right';
  }
  if (hostBox.left + left < margin) left = margin - hostBox.left;
  let top = cell.top - hostBox.top;
  if (hostBox.top + top + h > window.innerHeight - margin) {
    top -= hostBox.top + top + h - (window.innerHeight - margin);
  }
  if (hostBox.top + top < margin) top = margin - hostBox.top;
  sheet.style.left = left + 'px';
  sheet.style.top = top + 'px';
  sheet.classList.remove('point-left', 'point-right');
  sheet.classList.add(point);
  const arrow = cell.top + cell.height / 2 - (hostBox.top + top) - 6;
  sheet.style.setProperty('--arrow', Math.max(18, Math.min(h - 28, arrow)) + 'px');
}

function closeSheet() {
  if (sheet.open) sheet.close();
}

async function addOption(option) {
  const body = { kind: option.kind, date: selected };
  if (option.part) body.part = option.part;
  entries.push(body);
  await locate();
  const ok = await calculate(true);
  if (ok) closeSheet();
}

function dayLabel(g, date, day, events) {
  const parts = [longDate(date)];
  if (day.hebrewDay) parts[0] += ', ' + day.hebrewDay + (day.hebrewMonth ? ' ' + day.hebrewMonth : '');
  if (date === g.today) parts.push('Today');
  for (const e of events) parts.push(plainTitle(e));
  if (events.length === 0) parts.push('Nothing on this day');
  return parts.join('. ') + '. Tap to add something.';
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
    const home = selected || (entries[0] && entries[0].date) || g.today;
    const sig = events.map(e => e.kind + (e.key || '')).join('|');
    const fresh = animate && prevMarks.get(date) !== sig && sig !== '';
    cells.push(
      el(
        'td',
        {},
        el(
          'button',
          {
            type: 'button',
            id: 'try-day-' + date,
            class: 'day' + (day.rest ? ' rest' : '') + (today ? ' today' : '') + (isSelected ? ' selected' : '') + toneOf(events) + (fresh ? ' just' : ''),
            tabindex: date === home ? '0' : '-1',
            'aria-pressed': String(isSelected),
            'aria-current': today ? 'date' : null,
            'aria-label': dayLabel(g, date, day, events),
            onclick: e => {
              e.stopPropagation();
              openSheet(date);
            },
          },
          el('span', { class: 'cd' }, String(d)),
          day.hebrewDay ? el('span', { class: 'hd' }, day.hebrewDay, day.monthStart ? el('span', { class: 'hm' }, ' ' + day.hebrewMonth) : null) : null,
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
        const current = selected || g.today;
        if (keys[e.key] === undefined || !current) return;
        const to = addDays(current, keys[e.key]);
        if (!i.days.has(to)) return;
        e.preventDefault();
        selected = to;
        month = to.slice(0, 7);
        draw();
        document.getElementById('try-day-' + to)?.focus();
      },
    },
    el('thead', {}, el('tr', {}, WEEKDAYS.map(([short, long], k) => el('th', { scope: 'col' }, el('span', { 'aria-hidden': 'true' }, short), el('span', { class: 'visually-hidden' }, long))))),
    el('tbody', {}, rows),
  );
}

function draw() {
  if (!root || !grid) return;
  const i = indexOf(grid);
  if (!month || !i.months.includes(month)) month = (entries[0] ? entries[0].date : grid.today).slice(0, 7);
  const at = i.months.indexOf(month);
  const prev = i.months[at - 1];
  const next = i.months[at + 1];
  const go = to => {
    month = to;
    draw();
  };
  const inMonth = grid.days.filter(d => d.date.startsWith(month));
  const hebrew = inMonth.length ? (inMonth[0].hebrewMonth === inMonth[inMonth.length - 1].hebrewMonth ? inMonth[0].hebrewMonth : inMonth[0].hebrewMonth + ' – ' + inMonth[inMonth.length - 1].hebrewMonth) : '';
  const marks = new Map();
  for (const [date, evs] of i.starting) marks.set(date, evs.map(e => e.kind + (e.key || '')).join('|'));
  root.replaceChildren(
    el(
      'div',
      { class: 'month-nav' },
      el('button', { type: 'button', class: 'cal-btn', id: 'try-prev', 'aria-label': 'Previous month', disabled: !prev, onclick: () => prev && go(prev) }, svgIcon('i-left')),
      el('div', { class: 'month-title' }, el('h2', { id: 'try-month' }, fmt(month + '-01', { month: 'long', year: 'numeric' })), hebrew ? el('p', { class: 'hebrew-months' }, hebrew) : null),
      el('button', { type: 'button', class: 'cal-btn', id: 'try-next', 'aria-label': 'Next month', disabled: !next, onclick: () => next && go(next) }, svgIcon('i-right')),
    ),
    monthTable(i, grid),
  );
  prevMarks = marks;
  animate = false;
}

function optionButton(option) {
  const glyph = option.mark === 'flow' ? svgIcon('i-drop') : option.mark === 'hefsek' ? 'H' : option.mark === 'mikvah' ? 'M' : '×';
  return el(
    'button',
    { type: 'button', class: 'addbtn tile-' + option.mark, id: option.id, onclick: () => addOption(option) },
    el('span', { class: 'mk ' + (option.mark === 'broken' ? 'broken' : option.mark), 'aria-hidden': 'true' }, glyph),
    el('span', {}, option.label),
  );
}

export function startTry() {
  root = document.getElementById('try-cal');
  statusLine = document.getElementById('try-status');
  errorLine = document.getElementById('try-error');
  sheet = document.getElementById('try-sheet');
  sheetDate = document.getElementById('try-sheet-date');
  sheetError = document.getElementById('try-sheet-error');
  if (!root || !sheet) return;
  const main = document.getElementById('try-sheet-main');
  const more = document.getElementById('try-sheet-more');
  if (main && more) {
    main.replaceChildren(...OPTIONS.filter(o => !o.more).map(optionButton));
    more.replaceChildren(...OPTIONS.filter(o => o.more).map(optionButton));
  }
  sheet.addEventListener('click', e => {
    if (e.target === sheet) closeSheet();
  });
  document.getElementById('try-cancel')?.addEventListener('click', closeSheet);
  document.addEventListener('click', e => {
    if (!sheet.open || sheet.contains(e.target)) return;
    closeSheet();
  });
  const plan = samplePlan(browserToday());
  entries = plan.entries;
  month = plan.month;
  calculate(false).then(ok => {
    if (ok) return;
    entries = [plan.entries[0]];
    calculate(false);
  });
}
