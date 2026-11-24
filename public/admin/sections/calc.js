/*
 * The calculation test: a blank calendar on which the operator adds dates
 * and sees what a person's account would show, as of a day he chooses.
 * Every calculation is done by POST /api/admin/sandbox, which runs the same
 * code as an account (src/app/sandbox.ts) and stores nothing. Every sentence
 * that says why a day is marked comes from the server. This page keeps the
 * scenario (place, customs, "today", the dates in the order added) in this
 * browser's sessionStorage only, and can copy it as text and load it back.
 */
import { alert, button, card, checkRow, confirmDialog, h, icon, radioRow, segmented, selectField, tag, textField, toast } from '/app/lib.js';
import { cleanDayNumber, isNight, mark } from '/app/views/marks.js';
import { addDays, fmtDate, longDate, weekdayOf } from '/app/views/shared.js';
import { call, run } from '../state.js';

const STORAGE_KEY = 'betaharah-calc-scenario';
const KINDS = ['flow', 'stain', 'hefsek', 'broken', 'mikvah'];
const TIMED = new Set(['flow', 'stain', 'broken']);
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

/** The browser's own date, only as the first "today" offered; the calculation never reads a clock. */
function browserToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const blankScenario = () => ({ place: { name: 'Lakewood, NJ' }, terms: 'en', halachic: null, today: { date: browserToday(), part: 'day' }, entries: [] });
const blankForm = () => ({ kind: null, how: '', time: '', veset: true, error: '', message: '' });

/** The scenario sent to the server; kept in sessionStorage. */
let scenario = blankScenario();
/** What the page shows, besides the scenario. */
const ui = {
  started: false,
  choices: null,
  choicesTerms: null,
  result: null,
  error: '',
  busy: false,
  month: null,
  selected: null,
  grid: null,
  form: blankForm(),
  zip: '',
  zipError: '',
  paste: '',
  pasteError: '',
  copied: '',
};

const redrawMe = () => window.dispatchEvent(new CustomEvent('admin:section', { detail: 'calc' }));

function save() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(scenario));
  } catch (e) {
    // private window, or storage turned off: the scenario lives only until the page is left
  }
}

function restore() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s && typeof s === 'object' && s.today && Array.isArray(s.entries) && s.place) scenario = { ...blankScenario(), ...s };
  } catch (e) {
    // nothing kept, or not readable: start blank
  }
}

/** {term} places filled with the terms of the last calculation. */
function fill(template) {
  const words = (ui.result && ui.result.state.words) || {};
  return template.replace(/\{([a-z_]+)\}/g, (whole, key) => words[key] || whole);
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- talking to the server ----------

function loadChoices() {
  const terms = scenario.terms;
  if (ui.choicesTerms === terms) return Promise.resolve();
  return call('GET', '/api/admin/sandbox?terms=' + terms).then(c => {
    ui.choices = c;
    ui.choicesTerms = terms;
    if (!scenario.halachic) scenario.halachic = JSON.parse(JSON.stringify(c.defaults));
  });
}

let sequence = 0;

/**
 * Works the scenario out again. `added`: the index of an entry just added;
 * if it is refused it is taken out again, and the reason is shown beside the form.
 */
function calculate(opts) {
  const o = opts || {};
  const mine = ++sequence;
  ui.busy = true;
  redrawMe();
  run(
    () => loadChoices().then(() => call('POST', '/api/admin/sandbox', { place: scenario.place, terms: scenario.terms, halachic: scenario.halachic, today: scenario.today, entries: scenario.entries })),
    r => {
      if (mine !== sequence) return;
      ui.busy = false;
      ui.error = '';
      if (o.added !== undefined) {
        const outcome = r.outcomes[o.added];
        if (outcome && !outcome.ok) {
          // Not recorded, as for a person: it is not kept, and changed nothing.
          scenario.entries.splice(o.added, 1);
          r.outcomes.splice(o.added, 1);
          ui.form.error = outcome.error;
          ui.form.message = '';
        } else {
          ui.form = { ...blankForm(), message: r.message || 'Recorded.' };
        }
        save();
      }
      if (o.zip) {
        // The place found for the ZIP code is kept by its code.
        ui.zipError = '';
      }
      ui.result = r;
      redrawMe();
      if (o.focus) {
        const el = document.getElementById(o.focus);
        if (el) el.focus();
      }
    },
    o.button || null,
    err => {
      if (err.status === 401) return false;
      if (mine !== sequence) return true;
      ui.busy = false;
      if (o.added !== undefined) {
        scenario.entries.splice(o.added, 1);
        save();
        ui.form.error = err.message;
      } else if (o.zip) {
        ui.zipError = err.message;
        scenario.place = o.zip.previous;
        save();
      } else {
        ui.error = err.message;
      }
      redrawMe();
      return true;
    },
  );
}

/** Opened (main.js calls this on every drawing of the page; it starts once). */
export function loadCalc() {
  if (ui.started) return;
  ui.started = true;
  restore();
  calculate();
}

// ---------- the scenario: place, today, terms ----------

function setToday(today, btn) {
  scenario.today = today;
  // the calendar follows "today"
  ui.selected = today.date;
  ui.month = today.date.slice(0, 7);
  save();
  calculate({ button: btn });
}

function stepOnah(direction) {
  const t = scenario.today;
  if (direction > 0) return t.part === 'day' ? { date: t.date, part: 'night' } : { date: addDays(t.date, 1), part: 'day' };
  return t.part === 'night' ? { date: t.date, part: 'day' } : { date: addDays(t.date, -1), part: 'night' };
}

function placeLabel() {
  const p = ui.result && ui.result.place;
  return p ? p.name + ' (' + p.timeZone + ')' : '';
}

/** "Tuesday, November 24, 2026 at 12:01 PM": the moment used as now, at the place. */
function nowText() {
  const r = ui.result;
  if (!r) return '';
  try {
    return new Date(r.now).toLocaleString('en-US', { timeZone: r.state.timeZone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (e) {
    return new Date(r.now).toISOString();
  }
}

function scenarioCard() {
  const places = ui.choices ? ui.choices.places : [];
  const byZip = typeof scenario.place.postal === 'string' || ui.zipOpen;
  const placeSelect = selectField({
    id: 'calc-place',
    label: 'Place',
    value: byZip ? '' : scenario.place.name || '',
    options: [...places.map(p => ({ value: p, label: p })), { value: '', label: 'Another place, by ZIP or postal code' }],
    onchange: e => {
      const v = e.target.value;
      if (!v) {
        ui.zipOpen = true;
        redrawMe();
        return;
      }
      ui.zipOpen = false;
      scenario.place = { name: v };
      save();
      calculate({ focus: 'calc-place' });
    },
  });
  const zip = byZip
    ? h(
        'form',
        {
          class: 'calc-zip',
          novalidate: true,
          onsubmit: e => {
            e.preventDefault();
            const code = ui.zip.trim() || (scenario.place.postal || '');
            if (!code) {
              ui.zipError = 'Type a ZIP or postal code.';
              redrawMe();
              return;
            }
            const previous = scenario.place;
            scenario.place = { postal: code };
            save();
            calculate({ zip: { previous }, button: e.submitter, focus: 'calc-zip' });
          },
        },
        textField({ id: 'calc-zip', label: 'ZIP or postal code', autocomplete: 'off', wide: false, value: ui.zip || scenario.place.postal || '', error: ui.zipError, oninput: e => (ui.zip = e.target.value) }),
        button({ label: 'Use this code', type: 'submit', size: 'sm' }),
      )
    : null;
  const today = scenario.today;
  return card(
    { title: 'Scenario', icon: 'map', className: 'calc-scenario' },
    h('p', { class: 'calc-note' }, icon('info', { size: 'sm' }), h('span', {}, 'This runs the same calculation as people’s accounts, and saves nothing.')),
    h(
      'div',
      { class: 'calc-controls' },
      h('div', { class: 'calc-place' }, placeSelect, zip, ui.result ? h('p', { class: 'small muted', id: 'calc-place-used' }, 'Calculated for ' + placeLabel() + '.') : null),
      h(
        'div',
        { class: 'calc-today' },
        textField({
          id: 'calc-today',
          label: 'Pretend today is',
          type: 'date',
          wide: false,
          value: today.date,
          onchange: e => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setToday({ date: e.target.value, part: today.part });
          },
        }),
        segmented({ id: 'calc-part', label: 'Day or night', value: today.part, options: [{ value: 'day', label: 'By day' }, { value: 'night', label: 'At night' }], onchange: v => setToday({ date: today.date, part: v }) }),
        h(
          'div',
          { class: 'actions calc-steps' },
          button({ label: 'Previous onah', icon: 'chevron-left', size: 'sm', attrs: { id: 'calc-prev-onah' }, onclick: e => setToday(stepOnah(-1), e.currentTarget) }),
          button({ label: 'Next onah', icon: 'chevron-right', size: 'sm', attrs: { id: 'calc-next-onah' }, onclick: e => setToday(stepOnah(1), e.currentTarget) }),
          button({ label: 'Next day', icon: 'chevron-right', size: 'sm', attrs: { id: 'calc-next-day' }, onclick: e => setToday({ date: addDays(today.date, 1), part: today.part }, e.currentTarget) }),
        ),
        ui.result ? h('p', { class: 'small muted', id: 'calc-now' }, 'Now is taken as ' + nowText() + (today.part === 'night' ? ' (the night that begins that evening).' : '.')) : null,
      ),
      h(
        'div',
        { class: 'calc-terms' },
        h('span', { class: 'calc-label', id: 'calc-terms-label' }, 'Halachic terms in'),
        segmented({
          id: 'calc-terms',
          label: 'Language of halachic terms',
          value: scenario.terms,
          options: [
            { value: 'en', label: 'English' },
            { value: 'he', label: 'עברית', lang: 'he' },
          ],
          onchange: v => {
            scenario.terms = v;
            save();
            calculate({ focus: 'calc-terms-' + v });
          },
        }),
      ),
    ),
    ui.error ? alert({ kind: 'bad', role: 'alert', className: 'calc-error' }, h('span', { id: 'calc-error' }, ui.error)) : null,
    keepCard(),
  );
}

// ---------- copy, paste, clear ----------

function scenarioText() {
  return JSON.stringify({ place: scenario.place, terms: scenario.terms, halachic: scenario.halachic, today: scenario.today, entries: scenario.entries }, null, 2);
}

function copyScenario() {
  const text = scenarioText();
  const shown = () => {
    ui.copied = text;
    redrawMe();
  };
  if (!navigator.clipboard) return shown();
  navigator.clipboard.writeText(text).then(() => toast('The scenario was copied as text. Paste it under "Load a scenario" to run it again.'), shown);
}

function loadScenario(btn) {
  let s;
  try {
    s = JSON.parse(ui.paste);
  } catch (e) {
    ui.pasteError = 'This is not a scenario copied from this page.';
    redrawMe();
    return;
  }
  if (!s || typeof s !== 'object' || !s.place || !s.today || !Array.isArray(s.entries)) {
    ui.pasteError = 'This is not a scenario copied from this page: it needs a place, today and a list of dates.';
    redrawMe();
    return;
  }
  scenario = { ...blankScenario(), ...s };
  ui.paste = '';
  ui.pasteError = '';
  ui.copied = '';
  ui.form = blankForm();
  ui.month = null;
  ui.selected = null;
  ui.zipOpen = false;
  save();
  if (s.terms !== ui.choicesTerms) ui.choicesTerms = null;
  calculate({ button: btn });
  toast('The scenario was loaded.');
}

async function clearAll(btn, everything) {
  const ok = await confirmDialog(
    everything
      ? { title: 'Start over?', body: 'The dates are removed, and the place, customs and today go back to where they start. Copy the scenario first to keep it.', confirmLabel: 'Start over', danger: true }
      : { title: 'Remove every date?', body: 'The place, the customs and today stay as they are.', confirmLabel: 'Remove every date', danger: true },
  );
  if (!ok) return;
  if (everything) {
    scenario = blankScenario();
    scenario.halachic = ui.choices ? JSON.parse(JSON.stringify(ui.choices.defaults)) : null;
    ui.zipOpen = false;
    ui.month = null;
    ui.selected = null;
  } else {
    scenario.entries = [];
  }
  ui.form = blankForm();
  save();
  calculate({ button: btn });
}

function keepCard() {
  return h(
    'div',
    { class: 'calc-keep' },
    h(
      'div',
      { class: 'actions' },
      button({ label: 'Copy the scenario', icon: 'copy', attrs: { id: 'calc-copy' }, onclick: copyScenario }),
      button({ label: 'Remove every date', icon: 'trash', attrs: { id: 'calc-clear' }, disabled: scenario.entries.length === 0, onclick: e => clearAll(e.currentTarget, false) }),
      button({ label: 'Start over', icon: 'refresh', variant: 'danger', attrs: { id: 'calc-reset' }, onclick: e => clearAll(e.currentTarget, true) }),
    ),
    ui.copied
      ? h('div', { class: 'calc-copied' }, h('p', { class: 'small' }, 'The scenario could not be put on the clipboard. Select it and copy it:'), h('textarea', { id: 'calc-copied', class: 'calc-text', readonly: true, rows: '8', value: ui.copied }))
      : null,
    h(
      'details',
      { class: 'calc-paste', id: 'calc-paste-box', open: ui.pasteOpen, ontoggle: e => (ui.pasteOpen = e.currentTarget.open) },
      h('summary', {}, 'Load a scenario'),
      h(
        'form',
        {
          novalidate: true,
          onsubmit: e => {
            e.preventDefault();
            loadScenario(e.submitter);
          },
        },
        h('label', { for: 'calc-paste', class: 'calc-label' }, 'A scenario copied from this page'),
        h('textarea', {
          id: 'calc-paste',
          class: 'calc-text',
          rows: '6',
          spellcheck: 'false',
          value: ui.paste,
          'aria-invalid': ui.pasteError ? 'true' : null,
          'aria-describedby': ui.pasteError ? 'calc-paste-error' : null,
          oninput: e => {
            ui.paste = e.target.value;
            ui.pasteError = '';
          },
        }),
        ui.pasteError ? h('div', { class: 'error', id: 'calc-paste-error' }, icon('alert', { size: 'sm' }), h('span', {}, ui.pasteError)) : null,
        h('div', { class: 'actions' }, button({ label: 'Load this scenario', type: 'submit', attrs: { id: 'calc-load' } })),
      ),
    ),
  );
}

// ---------- the month calendar ----------

let idx = { grid: null, days: new Map(), starting: new Map(), continuing: new Map(), months: [] };

function index(grid) {
  if (idx.grid === grid) return idx;
  const days = new Map(grid.days.map(d => [d.date, d]));
  const starting = new Map();
  const continuing = new Map();
  const push = (map, key, value) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  };
  for (const e of grid.events) {
    if (e.allDay) {
      for (let d = e.startDate; d <= e.endDate; d = addDays(d, 1)) push(starting, d, e);
    } else {
      push(starting, e.startDate, e);
      if (e.endDate !== e.startDate) push(continuing, e.endDate, e);
    }
  }
  for (const list of starting.values()) list.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (isNight(a) ? 1 : 0) - (isNight(b) ? 1 : 0));
  idx = { grid, days, starting, continuing, months: [...new Set(grid.days.map(d => d.date.slice(0, 7)))] };
  return idx;
}

function ensureMonth(i, grid) {
  if (!ui.selected || !i.days.has(ui.selected)) ui.selected = grid.today;
  if (!ui.month || !i.months.includes(ui.month)) ui.month = ui.selected.slice(0, 7);
  ui.grid = grid;
}

const eventLabel = e => e.title + (e.projected && !/projected/.test(e.title) ? ' (projected)' : '');

function dayLabel(grid, date, day, events) {
  const parts = [longDate(date) + ', ' + day.hebrewDay + ' ' + day.hebrewMonth];
  if (date === grid.today) parts.push('Today');
  if (day.rest) parts.push(fill('{shabbat} or {yom_tov}'));
  for (const e of events) parts.push(eventLabel(e));
  if (events.length === 0) parts.push('Nothing marked');
  return parts.join('. ') + '.';
}

function select(date, focus) {
  ui.selected = date;
  ui.month = date.slice(0, 7);
  if (ui.form.kind === null) ui.form = { ...blankForm() };
  else ui.form = { ...ui.form, error: '', message: '' };
  redrawMe();
  if (focus) requestAnimationFrame(() => document.getElementById('calc-day-' + date)?.focus());
}

function onKey(e, i) {
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (moves[e.key] === undefined) return;
  const to = addDays(ui.selected, moves[e.key]);
  e.preventDefault();
  if (i.days.has(to)) select(to, true);
}

function monthTable(i, grid) {
  const month = ui.month;
  const [y, m] = month.split('-').map(Number);
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [];
  for (let k = 0; k < weekdayOf(month + '-01'); k++) cells.push(h('td', { class: 'pad' }));
  for (let d = 1; d <= length; d++) {
    const date = month + '-' + String(d).padStart(2, '0');
    const day = i.days.get(date);
    if (!day) {
      cells.push(h('td', { class: 'out' }, h('span', { class: 'day none', 'aria-hidden': 'true' }, h('span', { class: 'cd' }, String(d)))));
      continue;
    }
    const events = i.starting.get(date) || [];
    const selected = date === ui.selected;
    const isToday = date === grid.today;
    cells.push(
      h(
        'td',
        {},
        h(
          'button',
          {
            type: 'button',
            id: 'calc-day-' + date,
            class: 'day' + (day.rest ? ' rest' : '') + (isToday ? ' today' : '') + (selected ? ' selected' : ''),
            tabindex: selected ? '0' : '-1',
            'aria-pressed': String(selected),
            'aria-current': isToday ? 'date' : null,
            'aria-label': dayLabel(grid, date, day, events),
            onclick: () => select(date, true),
          },
          h('span', { class: 'cd' }, String(d)),
          h('span', { class: 'hd', lang: scenario.terms === 'he' ? 'he' : null }, day.hebrewDay, day.monthStart ? h('span', { class: 'hm' }, ' ' + day.hebrewMonth) : null),
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
    { class: 'month', 'aria-labelledby': 'calc-month-title', onkeydown: e => onKey(e, i) },
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

function eventRow(i, e, continuing) {
  const n = e.kind === 'clean_day' ? cleanDayNumber(e) : null;
  const night = !continuing && !e.allDay && isNight(e) && e.kind !== 'flow';
  const next = i.days.get(addDays(e.startDate, 1));
  const nightOf = night && next ? 'The night of ' + next.hebrewDay + ' ' + next.hebrewMonth + ': ' : '';
  return h(
    'li',
    { class: 'ev ' + e.kind + (e.projected ? ' projected' : '') },
    mark(e, { number: n }),
    h(
      'div',
      { class: 'ev-main' },
      h('div', { class: 'ev-title' }, eventLabel(e)),
      h('div', { class: 'ev-when' }, continuing ? 'From the evening before, until ' + e.end : nightOf + eventTime(e)),
      e.description && !continuing ? h('div', { class: 'ev-desc' }, e.description) : null,
    ),
  );
}

function legendList() {
  const items = [
    [mark({ kind: 'flow' }), cap(fill('{flow} or {stain}: the start of a period'))],
    [mark({ kind: 'hefsek' }), cap(fill('{hefsek}'))],
    [mark({ kind: 'clean_day' }, { number: 1 }), fill('Day 1 to 7 of the {clean_days}')],
    [mark({ kind: 'mikvah' }), cap(fill('{mikvah_night}'))],
    [mark({ kind: 'onah' }, { night: false }), cap(fill('{veset_onah} by day'))],
    [mark({ kind: 'onah' }, { night: true }), cap(fill('{veset_onah} at night'))],
    [mark({ kind: 'onah', light: true }, { night: true }), cap(fill('{or_zarua} only (lighter, outlined)'))],
    [mark({ kind: 'clean_day', projected: true }, { number: 3 }), fill('Dashed: projected. It assumes the {hefsek} is done on the first day it can be.')],
  ];
  return h('ul', { class: 'legend' }, items.map(([m, text]) => h('li', {}, m, h('span', {}, text))));
}

function calendarCard() {
  const r = ui.result;
  if (!r || !r.state.grid) return card({ title: 'Calendar', icon: 'calendar', className: 'calc-cal' }, h('p', { class: 'muted' }, ui.error ? 'Nothing to show until the scenario can be worked out.' : 'Working it out…'));
  const grid = r.state.grid;
  const i = index(grid);
  ensureMonth(i, grid);
  const at = i.months.indexOf(ui.month);
  const prev = i.months[at - 1];
  const next = i.months[at + 1];
  const goMonth = month => {
    ui.month = month;
    const days = grid.days.filter(d => d.date.startsWith(month));
    ui.selected = grid.today.startsWith(month) ? grid.today : days[0].date;
    redrawMe();
  };
  const inMonth = grid.days.filter(d => d.date.startsWith(ui.month));
  const hebrew = inMonth.length ? (inMonth[0].hebrewMonth === inMonth[inMonth.length - 1].hebrewMonth ? inMonth[0].hebrewMonth : inMonth[0].hebrewMonth + ' – ' + inMonth[inMonth.length - 1].hebrewMonth) : '';
  return card(
    { title: 'Calendar', icon: 'calendar', className: 'calc-cal' + (ui.busy ? ' busy' : ''), headerAction: ui.busy ? h('span', { class: 'small muted', role: 'status' }, 'Working it out…') : null },
    h(
      'div',
      { class: 'month-nav' },
      button({ label: 'Previous month', icon: 'chevron-left', iconOnly: true, disabled: !prev, attrs: { id: 'calc-prev' }, onclick: () => goMonth(prev) }),
      h('div', { class: 'month-title' }, h('h3', { id: 'calc-month-title', 'aria-live': 'polite' }, fmtDate(ui.month + '-01', { month: 'long', year: 'numeric' })), h('p', { class: 'hebrew-months' }, hebrew)),
      button({ label: 'Next month', icon: 'chevron-right', iconOnly: true, disabled: !next, attrs: { id: 'calc-next' }, onclick: () => goMonth(next) }),
      button({ label: 'Today', size: 'sm', disabled: ui.selected === grid.today, attrs: { id: 'calc-to-today' }, onclick: () => select(grid.today, true) }),
    ),
    monthTable(i, grid),
    h('details', { class: 'legend-box', id: 'calc-legend', open: ui.legendOpen, ontoggle: e => (ui.legendOpen = e.currentTarget.open) }, h('summary', {}, 'What the marks mean'), legendList()),
    dayDetail(i, grid),
  );
}

function dayDetail(i, grid) {
  const date = ui.selected;
  const day = i.days.get(date);
  if (!day) return null;
  const events = i.starting.get(date) || [];
  const continuing = (i.continuing.get(date) || []).filter(e => e.kind === 'onah' || e.kind === 'flow');
  return h(
    'div',
    { class: 'day-detail', role: 'region', 'aria-labelledby': 'calc-detail-title' },
    h(
      'div',
      { class: 'detail-head' },
      h('h3', { id: 'calc-detail-title' }, longDate(date), date === grid.today ? h('span', { class: 'tag info' }, 'Today') : null),
      h('p', { class: 'hebrew-date', lang: scenario.terms === 'he' ? 'he' : null }, day.hebrewDay + ' ' + day.hebrewMonth),
    ),
    h(
      'p',
      { class: 'sun-times' },
      h('span', {}, icon('sun', { size: 'sm' }), 'Sunrise ' + (day.sunrise || '—')),
      h('span', {}, icon('moon', { size: 'sm' }), cap(fill('{sunset} ')) + (day.sunset || '—')),
      day.rest ? h('span', { class: 'tag' }, fill('{shabbat} or {yom_tov}')) : null,
    ),
    events.length || continuing.length ? h('ul', { class: 'events' }, continuing.map(e => eventRow(i, e, true)), events.map(e => eventRow(i, e, false))) : h('p', { class: 'muted' }, 'Nothing is marked on this day.'),
    date !== scenario.today.date
      ? h('div', { class: 'actions' }, button({ label: 'Make this day today', size: 'sm', attrs: { id: 'calc-make-today' }, onclick: e => setToday({ date, part: 'day' }, e.currentTarget) }))
      : null,
    addForm(date),
  );
}

// ---------- adding a date ----------

/** The same short explanations as the Record form of the app (public/app/views/record.js). */
function kindHelp(kind) {
  switch (kind) {
    case 'flow':
      return fill('The start of a period.');
    case 'stain':
      return fill('Only when a {rav} has said that it makes her {niddah}.');
    case 'hefsek':
      return fill('Done before {sunset}. The {clean_days} begin the night after it.');
    case 'broken':
      return fill('When your {rav} says the {clean_days} must start again. A new {hefsek} is then needed.');
    case 'mikvah':
      return fill('After she has immersed, on the {mikvah_night}.');
    default:
      return '';
  }
}

function kindMark(kind) {
  if (kind === 'flow' || kind === 'stain') return mark({ kind: 'flow' });
  if (kind === 'broken') return h('span', { class: 'mk broken', 'aria-hidden': 'true' }, '×');
  return mark({ kind }, { number: 1 });
}

const labelOf = kind => (ui.result ? ui.result.state.labels.kinds[kind] : kind);

function submitEntry(e, date) {
  e.preventDefault();
  const f = ui.form;
  if (!f.kind) {
    f.error = 'Choose what to add.';
    redrawMe();
    return;
  }
  const entry = { kind: f.kind, date };
  if (TIMED.has(f.kind)) {
    if (!f.how) {
      f.error = 'Choose by day, at night, or a time.';
      redrawMe();
      return;
    }
    if (f.how === 'time') {
      if (!f.time) {
        f.error = 'Enter the time.';
        redrawMe();
        return;
      }
      entry.time = f.time;
    } else entry.part = f.how;
  }
  if (f.kind === 'flow' && !f.veset) entry.veset = false;
  f.error = '';
  scenario.entries.push(entry);
  save();
  calculate({ added: scenario.entries.length - 1, button: e.submitter, focus: 'calc-form-result' });
}

function addForm(date) {
  const f = ui.form;
  const set = (key, value) => {
    f[key] = value;
    f.error = '';
    f.message = '';
    redrawMe();
  };
  const timed = f.kind && TIMED.has(f.kind);
  const dateLabel = f.kind === 'hefsek' ? fill('The {hefsek} was done on this day.') : f.kind === 'mikvah' ? 'She immersed on the evening of this day.' : null;
  return h(
    'form',
    { class: 'calc-add', novalidate: true, onsubmit: e => submitEntry(e, date), 'aria-labelledby': 'calc-add-title' },
    h('h4', { id: 'calc-add-title' }, 'Add on ' + longDate(date)),
    h(
      'fieldset',
      { class: 'plain calc-kinds' },
      h('legend', { class: 'small-legend' }, 'What to add'),
      KINDS.map(kind =>
        radioRow({ name: 'calc-kind', value: kind, label: h('span', { class: 'calc-kind' }, kindMark(kind), labelOf(kind)), help: kindHelp(kind), checked: f.kind === kind, onchange: () => set('kind', kind) }),
      ),
    ),
    dateLabel ? h('p', { class: 'help' }, dateLabel) : null,
    timed
      ? h(
          'fieldset',
          { class: 'plain calc-how' },
          h('legend', { class: 'small-legend' }, 'Time of day'),
          radioRow({ name: 'calc-how', value: 'day', label: 'By day', help: fill('Between sunrise and {sunset}.'), checked: f.how === 'day', onchange: () => set('how', 'day') }),
          radioRow({
            name: 'calc-how',
            value: 'night',
            label: 'At night',
            help: fill('The night that begins on the evening of this date, after {sunset}. For example, at 9 PM on Monday: choose Monday, at night.'),
            checked: f.how === 'night',
            onchange: () => set('how', 'night'),
          }),
          radioRow({ name: 'calc-how', value: 'time', label: 'At a time I know', help: 'The calendar works out whether it was day or night.', checked: f.how === 'time', onchange: () => set('how', 'time') }),
          f.how === 'time' ? textField({ id: 'calc-time', label: 'Time', type: 'time', wide: false, value: f.time, oninput: e => (f.time = e.target.value) }) : null,
        )
      : null,
    f.kind === 'flow'
      ? checkRow({ id: 'calc-veset', label: fill('This {flow} counts for the {vesatot}'), help: fill('Leave this on unless a {rav} said it does not count.'), checked: f.veset, onchange: e => (f.veset = e.target.checked) })
      : null,
    h('div', { class: 'actions' }, button({ label: f.kind ? 'Add ' + labelOf(f.kind).toLowerCase() : 'Add', variant: 'primary', type: 'submit', attrs: { id: 'calc-add' } })),
    h(
      'div',
      { id: 'calc-form-result', tabindex: '-1', class: 'calc-form-result' },
      f.error ? alert({ kind: 'bad', role: 'alert', className: 'calc-refused' }, f.error) : null,
      f.message ? alert({ kind: 'ok', className: 'calc-recorded' }, f.message) : null,
    ),
  );
}

// ---------- where things stand, coming up ----------

function statusCard() {
  const r = ui.result;
  if (!r) return card({ title: 'Where things stand', icon: 'info' }, h('p', { class: 'muted' }, 'Working it out…'));
  const s = r.state;
  return card(
    { title: 'Where things stand', icon: 'info', className: 'calc-status' },
    s.today ? h('p', { class: 'small muted calc-today-line', lang: scenario.terms === 'he' ? 'he' : null }, s.today.hebrew + ' · ' + s.today.civil + ' · ' + (s.today.part === 'night' ? 'night' : 'day')) : null,
    s.status ? h('p', { class: 'calc-headline', id: 'calc-headline' }, s.status.headline) : null,
    s.status && s.status.detail ? h('p', { class: 'calc-detail' }, s.status.detail) : null,
    s.alerts.length
      ? h(
          'div',
          { class: 'alerts', id: 'calc-alerts' },
          s.alerts.map(a => alert({ kind: a.level === 'info' ? 'info' : 'warn' }, a.text)),
        )
      : h('p', { class: 'small muted', id: 'calc-alerts' }, 'No warnings, pattern alerts or notes.'),
  );
}

function upcomingCard() {
  const r = ui.result;
  if (!r) return null;
  const list = r.state.upcoming;
  return card(
    { title: 'Coming up', icon: 'clock', className: 'calc-upcoming' },
    list.length === 0
      ? h('p', { class: 'muted' }, 'Nothing is coming up.')
      : h(
          'ul',
          { class: 'up-list', id: 'calc-upcoming' },
          list.map(u =>
            h(
              'li',
              { class: 'up-row' + (u.projected ? ' projected' : '') },
              mark({ ...u, startDate: u.date, endDate: u.endDate }),
              h('div', { class: 'up-main' }, h('div', { class: 'up-title' }, u.title), h('div', { class: 'up-when' }, u.when), u.description ? h('div', { class: 'ev-desc' }, u.description) : null),
            ),
          ),
        ),
    r.state.reminders.length
      ? h(
          'details',
          { class: 'calc-reminders', id: 'calc-reminders', open: ui.remindersOpen, ontoggle: e => (ui.remindersOpen = e.currentTarget.open) },
          h('summary', {}, 'Reminder texts that would be sent (' + r.state.reminders.length + ')'),
          h('ul', { class: 'up-list' }, r.state.reminders.map(rem => h('li', { class: 'up-row' }, h('div', { class: 'up-main' }, h('div', { class: 'up-when' }, rem.when), h('div', {}, rem.text))))),
        )
      : null,
  );
}

// ---------- the Log ----------

/** What was entered, in plain words, for a date that was not recorded. */
function entered(e) {
  const label = labelOf(e.kind);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') ? fmtDate(e.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : String(e.date || 'no date');
  const when = e.time ? ', at ' + e.time : e.part === 'night' ? ', at night' : e.part === 'day' ? ', by day' : e.kind === 'mikvah' ? ', in the evening' : '';
  return label + ': ' + day + when;
}

function removeEntry(index, btn) {
  scenario.entries.splice(index, 1);
  ui.form = { ...ui.form, error: '', message: '' };
  save();
  calculate({ button: btn, focus: 'calc-log-title' });
}

function logCard() {
  const r = ui.result;
  const recorded = r ? r.state.entries : [];
  const refused = r ? r.outcomes.filter(o => !o.ok && scenario.entries[o.index]) : [];
  return card(
    { title: 'Log', icon: 'list', className: 'calc-log', attrs: { 'aria-labelledby': 'calc-log-title' } },
    h('p', { class: 'small muted', id: 'calc-log-title', tabindex: '-1' }, scenario.entries.length === 0 ? 'No dates yet. Choose a day on the calendar to add one.' : 'As the Log shows them, newest first. Removing one works everything out again.'),
    recorded.length
      ? h(
          'ul',
          { class: 'calc-entries', id: 'calc-entries' },
          recorded.map(e =>
            h(
              'li',
              {},
              kindMark(e.kind),
              h('span', { class: 'calc-entry-text' }, e.text),
              button({ label: 'Remove', size: 'sm', variant: 'link', attrs: { id: 'calc-remove-' + e.input, 'aria-label': 'Remove: ' + e.text }, onclick: ev => removeEntry(e.input, ev.currentTarget) }),
            ),
          ),
        )
      : null,
    refused.length
      ? h(
          'div',
          { class: 'calc-not-recorded' },
          h('h3', {}, 'Not recorded now'),
          h('p', { class: 'small muted' }, 'These were added earlier; with the dates as they are now, an account would refuse them.'),
          h(
            'ul',
            { class: 'calc-entries' },
            refused.map(o =>
              h(
                'li',
                {},
                tag('not recorded', 'bad'),
                h('span', { class: 'calc-entry-text' }, entered(scenario.entries[o.index]), h('span', { class: 'small calc-why' }, o.error)),
                button({ label: 'Remove', size: 'sm', variant: 'link', attrs: { id: 'calc-remove-' + o.index }, onclick: ev => removeEntry(o.index, ev.currentTarget) }),
              ),
            ),
          ),
        )
      : null,
  );
}

// ---------- customs ----------

function setCustom(key, value, focus) {
  scenario.halachic = { ...scenario.halachic, [key]: value };
  save();
  calculate({ focus });
}

function customsCard() {
  const c = ui.choices;
  if (!c || !scenario.halachic) return card({ title: 'Customs', icon: 'settings' }, h('p', { class: 'muted' }, 'Loading…'));
  const hal = scenario.halachic;
  const tzeit = hal.tzeit;
  const presetIndex = c.tzeitPresets.findIndex(p => p.rule.kind === tzeit.kind && p.rule.value === tzeit.value);
  const changed = c.choices.filter(ch => hal[ch.key] !== c.defaults[ch.key]).length + (tzeit.kind === c.defaults.tzeit.kind && tzeit.value === c.defaults.tzeit.value ? 0 : 1);
  return card(
    { title: 'Customs', icon: 'settings', className: 'calc-customs', headerAction: changed ? tag(changed + ' changed', 'info') : tag('a new account’s') },
    h('p', { class: 'small muted' }, 'The twelve settings of the Customs tab. They start as a new account’s do; each change is worked out at once.'),
    c.choices.map(ch =>
      selectField({
        id: 'calc-c-' + ch.key,
        label: ch.title,
        help: ch.help || null,
        value: hal[ch.key],
        options: ch.options.map(o => ({ value: o.value, label: o.label + (o.value === c.defaults[ch.key] ? ' (new account)' : '') })),
        onchange: e => setCustom(ch.key, e.target.value, 'calc-c-' + ch.key),
      }),
    ),
    selectField({
      id: 'calc-c-tzeit',
      label: cap(fill('{nightfall}, for the time of {immersion}')),
      value: presetIndex >= 0 ? String(presetIndex) : 'other',
      options: [...c.tzeitPresets.map((p, k) => ({ value: String(k), label: p.label + (k === 0 ? ' (new account)' : '') })), { value: 'other', label: 'Another value' }],
      onchange: e => {
        const v = e.target.value;
        if (v === 'other') {
          ui.tzeitOther = true;
          redrawMe();
          return;
        }
        ui.tzeitOther = false;
        setCustom('tzeit', { ...c.tzeitPresets[Number(v)].rule }, 'calc-c-tzeit');
      },
    }),
    presetIndex < 0 || ui.tzeitOther
      ? h(
          'form',
          {
            class: 'calc-tzeit',
            novalidate: true,
            onsubmit: e => {
              e.preventDefault();
              const kind = document.getElementById('calc-tzeit-kind').value;
              const value = Number(document.getElementById('calc-tzeit-value').value);
              setCustom('tzeit', { kind, value }, 'calc-tzeit-value');
            },
          },
          selectField({ id: 'calc-tzeit-kind', label: 'Counted in', value: tzeit.kind, options: [{ value: 'degrees', label: 'Degrees below the horizon' }, { value: 'minutes', label: fill('Minutes after {sunset}') }] }),
          textField({ id: 'calc-tzeit-value', label: 'Value', type: 'number', step: 'any', wide: false, value: String(tzeit.value) }),
          button({ label: 'Use this value', type: 'submit', size: 'sm' }),
        )
      : null,
    h(
      'div',
      { class: 'actions' },
      button({
        label: 'Back to a new account’s customs',
        size: 'sm',
        disabled: changed === 0,
        attrs: { id: 'calc-c-reset' },
        onclick: e => {
          scenario.halachic = JSON.parse(JSON.stringify(c.defaults));
          ui.tzeitOther = false;
          save();
          calculate({ button: e.currentTarget });
        },
      }),
    ),
  );
}

// ---------- the page ----------

export function calcPage() {
  return h(
    'div',
    { class: 'calc' },
    scenarioCard(),
    h('div', { class: 'grid-2 calc-grid' }, h('div', { class: 'calc-col' }, calendarCard()), h('div', { class: 'calc-col' }, statusCard(), upcomingCard())),
    h('div', { class: 'grid-2 calc-grid' }, logCard(), customsCard()),
  );
}
