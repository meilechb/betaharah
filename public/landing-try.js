// "Try it" on the home page: a visitor picks the day a period began and sees
// the month worked out, as an account would show it, then adds the hefsek
// taharah: the calendar then shows the clean days and the mikvah night, and
// the walk ends with the sign-up button (the immersion is not asked for: an
// account takes it that she immersed). The calculation is POST /api/try; nothing is
// saved. Without JavaScript, or when the request fails, the section keeps
// its plain sentence with a link to sign up.

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

/** el('p', { class: 'x', onclick: fn }, 'text', node) */
function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'value') node.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') node[k] = Boolean(v);
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

// ---------- dates ('YYYY-MM-DD', counted in UTC so that no time zone moves them) ----------

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

// ---------- state ----------

const T = {
  info: null,
  place: 'Lakewood, NJ',
  postal: '',
  byPostal: false,
  today: browserToday(),
  /** By day, or at night (after nightfall): "Make today" for an immersion moves to the evening. */
  part: 'day',
  start: addDays(browserToday(), -3),
  startPart: 'day',
  customs: {},
  entries: [],
  result: null,
  busy: false,
  error: '',
  formError: '',
  next: { date: '', part: 'day' },
  month: null,
  selected: null,
  grid: null,
  /** True after "today" moved: the next calendar opens on the new today. */
  follow: false,
};

let root = null;

// ---------- marks, as the calendar shows them ----------

/** A title without the server's "(projected)": the page says it with a label beside the title. */
const plainTitle = e => (e.title || '').replace(' (projected)', '');
/** The label for something the calendar expects that was not entered; null otherwise. */
function expectedLabel(e) {
  if (!e.projected) return null;
  return el('em', { class: 'try-tag' }, e.kind === 'hefsek' ? 'not entered' : 'expected');
}

const isNight = e => e.kind === 'mikvah' || (e.startDate && e.endDate && e.startDate !== e.endDate) || /\((night|לילה)\)/.test(e.title || '');

function mark(e) {
  const kind = e.kind === 'clean_day' ? 'clean' : e.kind;
  const cls = ['mk', kind];
  if (e.projected) cls.push('projected');
  if (e.light) cls.push('light');
  let glyph = '•';
  if (e.kind === 'flow') glyph = svgIcon('i-drop');
  else if (e.kind === 'hefsek') {
    // the day it can be done is not a hefsek taharah that was entered: a question mark says so
    glyph = e.projected ? 'H?' : 'H';
    if (e.projected) cls.push('wide');
  }
  else if (e.kind === 'mikvah') glyph = 'M';
  else if (e.kind === 'clean_day') {
    const m = /:(\d)$/.exec(e.key || '');
    glyph = m ? m[1] : '';
  } else if (e.kind === 'onah') glyph = svgIcon(isNight(e) ? 'i-moon' : 'i-sun');
  return el('span', { class: cls.join(' '), 'aria-hidden': 'true' }, glyph);
}

// ---------- talking to the site ----------

async function ask(method, body) {
  const res = await fetch('/api/try', {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/json', 'x-betaharah': '1', accept: 'application/json' } : { accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = new Error((json && json.error) || '');
    err.status = res.status;
    throw err;
  }
  return json;
}

/** Works the dates out again. `added`: an entry was just added at the end; if it is refused, it is taken out and the reason shown. */
async function calculate(added) {
  T.busy = true;
  T.error = '';
  draw();
  const place = T.byPostal ? { postal: T.postal } : { name: T.place };
  try {
    const r = await ask('POST', { place, today: { date: T.today, part: T.part }, customs: T.customs, entries: T.entries });
    T.busy = false;
    if (added) {
      const outcome = r.outcomes[r.outcomes.length - 1];
      if (outcome && !outcome.ok) {
        T.entries.pop();
        r.outcomes.pop();
        T.formError = outcome.error;
      } else {
        T.formError = '';
      }
    }
    T.result = r;
    T.next = nextDefault(r);
    draw();
    const target = document.getElementById(added ? (T.formError ? 'try-form-error' : 'try-status') : 'try-status');
    if (target) target.focus({ preventScroll: !added });
  } catch (e) {
    T.busy = false;
    if (added) T.entries.pop();
    if (e.status === 400 && e.message) {
      if (added) T.formError = e.message;
      else T.error = e.message;
    } else if (e.status === 429 && e.message) {
      T.error = e.message;
    } else {
      T.error = 'The calendar could not be shown just now.';
    }
    draw();
    const target = document.getElementById(T.formError && added ? 'try-form-error' : 'try-error');
    if (target) target.focus();
  }
}

/** The date offered for the next step: the day the calendar shows for it. */
function nextDefault(r) {
  const phase = r.state.status ? r.state.status.phase : 'tehorah';
  const item = phase === 'before_hefsek' ? r.state.upcoming.find(u => u.kind === 'hefsek') : null;
  return { date: item ? item.date : T.today, part: 'day' };
}

// ---------- drawing ----------

/** Redraws the section, keeping the focus on the control that had it. */
function draw() {
  const active = document.activeElement;
  const id = active && root.contains(active) ? active.id : null;
  root.replaceChildren(...view());
  if (id) {
    const again = document.getElementById(id);
    if (again && again !== document.activeElement) again.focus({ preventScroll: true });
  }
}

function view() {
  const parts = [];
  if (!T.result) parts.push(startForm());
  if (T.error) {
    parts.push(
      el('p', { class: 'try-error', id: 'try-error', tabindex: '-1', role: 'alert' }, svgIcon('i-alert'), el('span', {}, T.error + ' ', el('a', { href: '/app/' }, 'Sign up'), ' to see your own calendar.')),
    );
  }
  if (T.result) parts.push(resultView());
  return parts;
}

function placeField() {
  const places = T.info ? T.info.places : [];
  return el(
    'div',
    { class: 'try-field' },
    el('label', { for: 'try-place' }, 'Where you live'),
    el(
      'select',
      {
        id: 'try-place',
        onchange: e => {
          const v = e.target.value;
          T.byPostal = v === '';
          if (v) T.place = v;
          draw();
          if (T.result && v) calculate();
        },
      },
      places.map(p => el('option', { value: p, selected: !T.byPostal && p === T.place }, p)),
      el('option', { value: '', selected: T.byPostal }, 'Other (ZIP or postal code)'),
    ),
    T.byPostal
      ? el(
          'span',
          { class: 'try-postal' },
          el('label', { for: 'try-postal', class: 'visually-hidden' }, 'ZIP or postal code'),
          el('input', { id: 'try-postal', type: 'text', inputmode: 'text', autocomplete: 'postal-code', placeholder: 'ZIP or postal code', value: T.postal, oninput: e => (T.postal = e.target.value.trim()) }),
          T.result ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'try-postal-use', onclick: () => calculate() }, 'Use this code') : null,
        )
      : null,
  );
}

function partChoice(name, value, onchange) {
  return el(
    'fieldset',
    { class: 'try-part' },
    el('legend', { class: 'visually-hidden' }, 'By day or at night'),
    [
      ['day', 'By day', 'After sunrise'],
      ['night', 'At night', 'After sunset'],
    ].map(([v, label, help]) =>
      el(
        'label',
        { class: 'try-radio' },
        el('input', { type: 'radio', name, id: name + '-' + v, value: v, checked: value === v, onchange: () => onchange(v) }),
        el('span', {}, el('b', {}, label), el('small', {}, help)),
      ),
    ),
  );
}

function moreChoices() {
  const info = T.info;
  if (!info) return null;
  return el(
    'details',
    { class: 'try-more', id: 'try-more' },
    el('summary', {}, 'Customs and today'),
    el(
      'div',
      { class: 'try-more-body' },
      info.customs.map(c =>
        el(
          'div',
          { class: 'try-field' },
          el('label', { for: 'try-c-' + c.key }, c.title),
          el(
            'select',
            {
              id: 'try-c-' + c.key,
              onchange: e => {
                T.customs = { ...T.customs, [c.key]: e.target.value };
                if (T.result) calculate();
              },
            },
            c.options.map(o => el('option', { value: o.value, selected: (T.customs[c.key] || info.defaults[c.key]) === o.value }, o.label)),
          ),
        ),
      ),
      el(
        'div',
        { class: 'try-field' },
        el('label', { for: 'try-today' }, 'Today’s date'),
        el('input', {
          id: 'try-today',
          type: 'date',
          value: T.today,
          onchange: e => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) return;
            T.today = e.target.value;
            T.part = 'day';
            T.follow = true; // the calendar moves to the new today
            if (T.result) calculate();
          },
        }),
      ),
    ),
  );
}

function startForm() {
  return el(
    'form',
    {
      class: 'try-card try-start',
      novalidate: true,
      onsubmit: e => {
        e.preventDefault();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(T.start)) {
          T.formError = 'Choose the day the period began.';
          draw();
          return;
        }
        if (T.byPostal && !T.postal) {
          T.formError = 'Enter a ZIP or postal code.';
          draw();
          return;
        }
        T.formError = '';
        T.entries = [{ kind: 'flow', date: T.start, part: T.startPart }];
        calculate(true);
      },
    },
    placeField(),
    el(
      'div',
      { class: 'try-field' },
      el('label', { for: 'try-start' }, 'Period began'),
      el('input', { id: 'try-start', type: 'date', value: T.start, max: T.today, required: true, oninput: e => (T.start = e.target.value) }),
    ),
    partChoice('try-start-part', T.startPart, v => (T.startPart = v)),
    moreChoices(),
    formError(),
    el('div', { class: 'try-actions' }, el('button', { type: 'submit', class: 'btn btn-primary btn-lg', id: 'try-go', disabled: T.busy }, T.busy ? 'Working…' : 'Show calendar')),
  );
}

function formError() {
  return T.formError ? el('p', { class: 'try-error', id: 'try-form-error', tabindex: '-1', role: 'alert' }, svgIcon('i-alert'), el('span', {}, T.formError)) : null;
}

// ---------- the result ----------

function resultView() {
  const s = T.result.state;
  return el(
    'div',
    { class: 'try-result' + (T.busy ? ' busy' : '') },
    el(
      'div',
      { class: 'try-grid' },
      el('div', { class: 'try-card try-cal' }, calendar(s)),
      el(
        'div',
        { class: 'try-side' },
        el(
          'div',
          { class: 'try-card try-status', id: 'try-status', tabindex: '-1', 'aria-live': 'polite' },
          el('p', { class: 'eyebrow' }, 'Where things stand'),
          s.status ? el('p', { class: 'try-headline' }, s.status.headline) : null,
          s.status && s.status.detail ? el('p', { class: 'try-detail' }, s.status.detail) : null,
          s.today ? el('p', { class: 'try-small' }, 'Today: ' + s.today.hebrew + ' (' + s.today.civil + '), in ' + T.result.place + '.') : null,
          s.alerts.map(a => el('p', { class: 'try-alert ' + a.level }, svgIcon(a.level === 'info' ? 'i-check' : 'i-alert'), el('span', {}, a.text))),
        ),
        nextStep(s),
        upcoming(s),
      ),
    ),
    el(
      'div',
      { class: 'try-cta' },
      el('p', {}, 'Nothing was saved.'),
      el(
        'div',
        { class: 'try-actions' },
        el('a', { class: 'btn btn-primary btn-lg', href: '/app/', id: 'try-signup' }, 'Get started free', svgIcon('i-arrow')),
        el(
          'button',
          {
            type: 'button',
            class: 'btn btn-ghost btn-lg',
            id: 'try-again',
            onclick: () => {
              T.result = null;
              T.entries = [];
              T.formError = '';
              T.error = '';
              T.month = null;
              T.selected = null;
              draw();
              document.getElementById('try-start')?.focus();
            },
          },
          'Start again',
        ),
      ),
    ),
  );
}

/** The one step after the period: the hefsek taharah. Once it is added, the walk ends. */
function nextStep(s) {
  const phase = s.status ? s.status.phase : 'tehorah';
  if (phase !== 'before_hefsek' || T.entries.some(e => e.kind === 'hefsek')) return null;
  const kind = 'hefsek';
  const full = T.entries.length >= (T.info ? T.info.maxEntries : 12);
  const ahead = T.next.date > T.today;
  if (full) return el('div', { class: 'try-card try-next' }, el('p', { class: 'try-small' }, 'No more dates here.'));
  return el(
    'form',
    {
      class: 'try-card try-next',
      novalidate: true,
      onsubmit: e => {
        e.preventDefault();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(T.next.date)) {
          T.formError = 'Choose a date.';
          draw();
          return;
        }
        T.entries.push({ kind, date: T.next.date });
        calculate(true);
      },
    },
    el('p', { class: 'try-next-title' }, mark({ kind }), el('b', {}, 'Next: the hefsek taharah')),
    el(
      'div',
      { class: 'try-field' },
      el('label', { for: 'try-next-date' }, 'Date done'),
      el('input', {
        id: 'try-next-date',
        type: 'date',
        value: T.next.date,
        onchange: e => {
          T.next.date = e.target.value;
          T.formError = '';
          draw();
        },
      }),
    ),
    formError(),
    el(
      'div',
      { class: 'try-actions' },
      el('button', { type: 'submit', class: 'btn btn-primary', id: 'try-add', disabled: T.busy }, 'Add hefsek taharah'),
      ahead
        ? el(
            'button',
            {
              type: 'button',
              class: 'btn btn-ghost',
              id: 'try-jump',
              onclick: () => {
                T.today = T.next.date;
                T.part = 'day';
                T.follow = true; // the calendar moves to the new today
                T.formError = '';
                calculate();
              },
            },
            'Make today ' + fmt(T.next.date, { month: 'short', day: 'numeric' }),
          )
        : null,
    ),
    ahead ? el('p', { class: 'try-small' }, 'That day is after today.') : null,
  );
}

function upcoming(s) {
  const list = s.upcoming.slice(0, 6);
  if (list.length === 0) return null;
  return el(
    'div',
    { class: 'try-card try-up' },
    el('p', { class: 'eyebrow' }, 'Coming up'),
    el(
      'ul',
      {},
      list.map(u =>
        el(
          'li',
          {},
          mark({ ...u, startDate: u.date, endDate: u.endDate }),
          el('span', {}, el('b', {}, plainTitle(u), expectedLabel(u)), el('small', {}, u.when)),
        ),
      ),
    ),
  );
}

// ---------- the month ----------

let idx = { grid: null };

function index(grid) {
  if (idx.grid === grid) return idx;
  const days = new Map(grid.days.map(d => [d.date, d]));
  const starting = new Map();
  for (const e of grid.events) {
    const add = d => {
      if (!starting.has(d)) starting.set(d, []);
      starting.get(d).push(e);
    };
    if (e.allDay) for (let d = e.startDate; d <= e.endDate; d = addDays(d, 1)) add(d);
    else add(e.startDate);
  }
  for (const list of starting.values()) list.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (isNight(a) ? 1 : 0) - (isNight(b) ? 1 : 0));
  idx = { grid, days, starting, months: [...new Set(grid.days.map(d => d.date.slice(0, 7)))] };
  return idx;
}

function choose(date, focus) {
  T.selected = date;
  T.month = date.slice(0, 7);
  draw();
  if (focus) document.getElementById('try-day-' + date)?.focus();
}

function calendar(s) {
  const grid = s.grid;
  const i = index(grid);
  if (T.follow && T.grid !== grid) {
    T.follow = false;
    T.selected = grid.today;
    T.month = null;
  }
  if (!T.selected || !i.days.has(T.selected)) T.selected = grid.today;
  if (!T.month || !i.months.includes(T.month)) T.month = T.selected.slice(0, 7);
  T.grid = grid;
  const at = i.months.indexOf(T.month);
  const prev = i.months[at - 1];
  const next = i.months[at + 1];
  const go = month => {
    const first = grid.days.find(d => d.date.startsWith(month));
    T.month = month;
    T.selected = grid.today.startsWith(month) ? grid.today : first.date;
    draw();
  };
  const inMonth = grid.days.filter(d => d.date.startsWith(T.month));
  const hebrew = inMonth.length ? (inMonth[0].hebrewMonth === inMonth[inMonth.length - 1].hebrewMonth ? inMonth[0].hebrewMonth : inMonth[0].hebrewMonth + ' – ' + inMonth[inMonth.length - 1].hebrewMonth) : '';
  return [
    el(
      'div',
      { class: 'cal-top' },
      el('button', { type: 'button', class: 'cal-btn', id: 'try-prev', 'aria-label': 'Previous month', disabled: !prev, onclick: () => go(prev) }, svgIcon('i-left')),
      el('div', { class: 'cal-title' }, el('b', { id: 'try-month', 'aria-live': 'polite' }, fmt(T.month + '-01', { month: 'long', year: 'numeric' })), el('small', {}, hebrew)),
      el('button', { type: 'button', class: 'cal-btn', id: 'try-next', 'aria-label': 'Next month', disabled: !next, onclick: () => go(next) }, svgIcon('i-right')),
    ),
    monthTable(i, grid),
    el(
      'div',
      { class: 'cal-legend' },
      [
        [mark({ kind: 'flow' }), 'Flow'],
        [mark({ kind: 'hefsek' }), 'Hefsek taharah'],
        [mark({ kind: 'hefsek', projected: true }), 'Hefsek due'],
        [mark({ kind: 'clean_day', key: ':1' }), 'Clean days'],
        [mark({ kind: 'mikvah' }), 'Mikvah night'],
        [[mark({ kind: 'onah', title: '' }), mark({ kind: 'onah', title: '(night)' })], 'Veset onah'],
        [mark({ kind: 'clean_day', key: ':3', projected: true }), 'Expected'],
      ].map(([m, text]) => el('span', {}, m, text)),
    ),
    dayDetail(i, grid),
  ];
}

function dayLabel(grid, date, day, events) {
  const parts = [longDate(date) + ', ' + day.hebrewDay + ' ' + day.hebrewMonth];
  if (date === grid.today) parts.push('Today');
  if (day.rest) parts.push('Shabbat or Yom Tov');
  for (const e of events) parts.push(e.title);
  if (events.length === 0) parts.push('Nothing marked');
  return parts.join('. ') + '.';
}

function monthTable(i, grid) {
  const month = T.month;
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
    const selected = date === T.selected;
    const today = date === grid.today;
    cells.push(
      el(
        'td',
        {},
        el(
          'button',
          {
            type: 'button',
            id: 'try-day-' + date,
            class: 'day' + (day.rest ? ' rest' : '') + (today ? ' today' : '') + (selected ? ' selected' : ''),
            tabindex: selected ? '0' : '-1',
            'aria-pressed': String(selected),
            'aria-current': today ? 'date' : null,
            'aria-label': dayLabel(grid, date, day, events),
            onclick: () => choose(date, true),
          },
          el('span', { class: 'cd' }, String(d)),
          el('span', { class: 'hd' }, day.hebrewDay, day.monthStart ? el('span', { class: 'hm' }, ' ' + day.hebrewMonth) : null),
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
        if (keys[e.key] === undefined) return;
        const to = addDays(T.selected, keys[e.key]);
        e.preventDefault();
        if (i.days.has(to)) choose(to, true);
      },
    },
    el('thead', {}, el('tr', {}, WEEKDAYS.map(([short, long], k) => el('th', { scope: 'col', abbr: long, class: k === 6 ? 'sat' : null }, short)))),
    el('tbody', {}, rows),
  );
}

function eventTime(e) {
  if (e.allDay) return 'All day';
  if (e.kind === 'mikvah') return 'After ' + e.start;
  if (e.start === e.end || !e.end) return e.start;
  if (e.startDate !== e.endDate) return e.start + ' to ' + e.end + ' the next morning';
  return e.start + ' to ' + e.end;
}

function dayDetail(i, grid) {
  const date = T.selected;
  const day = i.days.get(date);
  if (!day) return null;
  const events = i.starting.get(date) || [];
  return el(
    'div',
    { class: 'try-detail-box', id: 'try-detail', 'aria-live': 'polite' },
    el('p', { class: 'pop-head' }, el('b', {}, longDate(date) + (date === grid.today ? ' (today)' : '')), el('small', {}, day.hebrewDay + ' ' + day.hebrewMonth + (day.sunset ? ' · sunset ' + day.sunset : ''))),
    events.length
      ? el(
          'ul',
          {},
          events.map(e => el('li', {}, mark(e), el('span', {}, el('b', {}, plainTitle(e), expectedLabel(e)), el('small', {}, eventTime(e)), e.description ? el('span', { class: 'try-desc' }, e.description) : null))),
        )
      : el('p', { class: 'try-small' }, 'Nothing marked.'),
  );
}

// ---------- start ----------

export async function startTry() {
  root = document.getElementById('try-tool');
  if (!root) return;
  try {
    T.info = await ask('GET');
  } catch {
    return; // the section keeps its sentence and link
  }
  if (!T.info || !Array.isArray(T.info.places)) return;
  draw();
}
