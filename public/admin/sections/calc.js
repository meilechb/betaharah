/*
 * The calculation test: a blank calendar on which the operator clicks a day,
 * says what happened on it, and sees what a person's account would show.
 * Every calculation is done by POST /api/admin/sandbox, which runs the same
 * code as an account (src/app/sandbox.ts) and stores nothing. Every sentence
 * that says why a day is marked comes from the server.
 *
 * How the page is meant to be used:
 *   - the calendar comes first; a click on a day opens "What happened on this
 *     day?" beside it, where one button adds a date;
 *   - the test's "today" is the latest date entered, so that dates can be
 *     entered one after another as they would happen; it can be moved ahead
 *     to see what an account shows on a later day;
 *   - what was entered and what the calendar works out are kept apart, in the
 *     marks (a tick for what was entered, a question mark and a dashed outline
 *     for a hefsek taharah that is expected but was not entered) and in words.
 *
 * This page keeps the scenario (place, customs, the dates in the order added,
 * and a "today" moved ahead) in this browser's sessionStorage only, and can
 * copy it as text and load it back.
 */
import { alert, button, card, checkRow, confirmDialog, h, icon, segmented, selectField, tag, textField, toast } from '/app/lib.js';
import { cleanDayNumber, isDone, isNight, mark } from '/app/views/marks.js';
import { addDays, fmtDate, longDate, shortDate, weekdayOf } from '/app/views/shared.js';
import { call, run } from '../state.js';

const STORAGE_KEY = 'betaharah-calc-scenario';
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
const PART_RANK = { day: 0, night: 1 };

/** The browser's own date, only as the first "today" offered; the calculation never reads a clock. */
function browserToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * `today` is what is sent; it is worked out from the dates and `ahead` before
 * every calculation (syncToday). `ahead` is a "today" the tester moved to, or
 * null while the test follows the latest date entered.
 */
const blankScenario = () => ({ place: { name: 'Lakewood, NJ' }, terms: 'en', halachic: null, today: { date: browserToday(), part: 'day' }, ahead: null, entries: [] });
const blankAdd = () => ({ error: '', message: '', time: '', timeKind: 'flow', veset: true });

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
  add: blankAdd(),
  zip: '',
  zipError: '',
  paste: '',
  pasteError: '',
  copied: '',
  todayError: '',
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

// ---------- "today" in the test ----------

const isLater = (a, b) => a.date > b.date || (a.date === b.date && PART_RANK[a.part] > PART_RANK[b.part]);
const sameMoment = (a, b) => a.date === b.date && a.part === b.part;

/**
 * The onah a date falls in, as far as this page needs it: never earlier than
 * the real one, so that "today" is never before a date that was entered.
 * A hefsek taharah is done by day; an immersion on the evening of its date;
 * a date entered with a clock time is taken as that date's night.
 */
function momentOf(e) {
  if (e.kind === 'hefsek') return { date: e.date, part: 'day' };
  if (e.kind === 'mikvah') return { date: e.date, part: 'night' };
  return { date: e.date, part: e.time ? 'night' : e.part === 'night' ? 'night' : 'day' };
}

function latestMoment() {
  let latest = null;
  for (const e of scenario.entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) continue;
    const m = momentOf(e);
    if (!latest || isLater(m, latest)) latest = m;
  }
  return latest;
}

/** Whether the tester's own "today" is in force: it is later than every date entered (or there are none). */
function isAhead() {
  const latest = latestMoment();
  return Boolean(scenario.ahead && (!latest || isLater(scenario.ahead, latest)));
}

/**
 * Sets scenario.today: the latest date entered, or a later day the tester
 * moved to. The day he moved to is kept while a later date is entered, so
 * that it is in force again if that date is refused or removed.
 */
function syncToday() {
  scenario.today = isAhead() ? scenario.ahead : latestMoment() || { date: browserToday(), part: 'day' };
}

function stepOnah(t, direction) {
  if (direction > 0) return t.part === 'day' ? { date: t.date, part: 'night' } : { date: addDays(t.date, 1), part: 'day' };
  return t.part === 'night' ? { date: t.date, part: 'day' } : { date: addDays(t.date, -1), part: 'night' };
}

/** Moves the test's today to `moment` (null: back to the latest date entered). */
function moveToday(moment, btn) {
  const latest = latestMoment();
  ui.todayError = '';
  if (moment && latest && isLater(latest, moment)) {
    ui.todayError = 'Today cannot be before the latest date entered (' + shortDate(latest.date) + '). Remove that date first, or choose a later day.';
    redrawMe();
    return;
  }
  scenario.ahead = moment && (!latest || isLater(moment, latest)) ? moment : null;
  syncToday();
  // the calendar follows "today"
  ui.selected = scenario.today.date;
  ui.month = scenario.today.date.slice(0, 7);
  save();
  calculate({ button: btn });
}

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
 * if it is refused it is taken out again, and the reason is shown where it was added.
 */
function calculate(opts) {
  const o = opts || {};
  const mine = ++sequence;
  syncToday();
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
          ui.add = { ...ui.add, error: outcome.error, message: '' };
          save();
          // "Today" may have moved ahead for this date; without it, work the picture out as it was.
          calculate({ focus: 'calc-add-result' });
          return;
        }
        ui.add = { ...blankAdd(), message: r.message || 'Recorded.' };
        save();
      }
      if (o.zip) ui.zipError = '';
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
        syncToday();
        save();
        ui.add = { ...ui.add, error: err.message, message: '' };
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

// ---------- the bar at the top: place, terms, today ----------

function placeLabel() {
  const p = ui.result && ui.result.place;
  return p ? p.name : '';
}

/** "Friday, November 20, by day": the test's today, in words. */
function todayWords() {
  const t = scenario.today;
  return longDate(t.date) + ', ' + t.date.slice(0, 4) + (t.part === 'night' ? ', at night' : ', by day');
}

function setupCard() {
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
            const code = ui.zip.trim() || scenario.place.postal || '';
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
        byZip && placeLabel() && scenario.place.postal ? h('p', { class: 'small muted', id: 'calc-place-used' }, 'Calculated for ' + placeLabel() + '.') : null,
      )
    : null;
  return h(
    'section',
    { class: 'card calc-setup', 'aria-label': 'Place and terms' },
    h(
      'div',
      { class: 'calc-setup-row' },
      h('div', { class: 'calc-place' }, placeSelect, zip),
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
      h('div', { class: 'calc-setup-end' }, button({ label: 'Start over', icon: 'refresh', variant: 'danger', attrs: { id: 'calc-reset' }, onclick: e => clearAll(e.currentTarget, true) })),
    ),
    todayBar(),
    ui.error ? alert({ kind: 'bad', role: 'alert', className: 'calc-error' }, h('span', { id: 'calc-error' }, ui.error)) : null,
  );
}

/** The line that says which day the test treats as today, and the controls that move it. */
function todayBar() {
  const t = scenario.today;
  const latest = latestMoment();
  const following = !isAhead();
  const back = stepOnah(t, -1);
  const canGoBack = !latest || isLater(back, latest) || sameMoment(back, latest);
  return h(
    'div',
    { class: 'calc-todaybar', role: 'group', 'aria-label': 'Today in this test' },
    h(
      'p',
      { class: 'calc-today-text', id: 'calc-today-text' },
      h('span', { class: 'calc-today-label' }, 'Shown as of '),
      h('strong', { id: 'calc-today-words' }, todayWords()),
      h('span', { class: 'small muted', id: 'calc-today-why' }, latest ? (following ? ' · the latest date you entered' : ' · moved ahead by you') : following ? ' · today' : ' · chosen by you'),
    ),
    h(
      'div',
      { class: 'actions calc-steps' },
      button({ label: 'Back one onah', icon: 'chevron-left', size: 'sm', disabled: !canGoBack, attrs: { id: 'calc-prev-onah' }, onclick: e => moveToday(back, e.currentTarget) }),
      button({ label: 'Forward one onah', icon: 'chevron-right', size: 'sm', attrs: { id: 'calc-next-onah' }, onclick: e => moveToday(stepOnah(t, 1), e.currentTarget) }),
      button({ label: 'Forward one day', icon: 'chevron-right', size: 'sm', attrs: { id: 'calc-next-day' }, onclick: e => moveToday({ date: addDays(t.date, 1), part: t.part }, e.currentTarget) }),
      latest && isAhead() ? button({ label: 'Back to the latest date', size: 'sm', variant: 'link', attrs: { id: 'calc-follow' }, onclick: e => moveToday(null, e.currentTarget) }) : null,
    ),
    h(
      'details',
      { class: 'calc-pick', id: 'calc-pick', open: ui.pickOpen, ontoggle: e => (ui.pickOpen = e.currentTarget.open) },
      h('summary', {}, 'Choose another day as today'),
      h(
        'div',
        { class: 'calc-pick-row' },
        textField({
          id: 'calc-today',
          label: 'Today in this test',
          type: 'date',
          wide: false,
          value: t.date,
          onchange: e => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) moveToday({ date: e.target.value, part: t.part });
          },
        }),
        segmented({ id: 'calc-part', label: 'Day or night', value: t.part, options: [{ value: 'day', label: 'By day' }, { value: 'night', label: 'At night' }], onchange: v => moveToday({ date: t.date, part: v }) }),
      ),
      h('p', { class: 'small muted' }, 'A date cannot be entered in the future, so today is never before the latest date you entered. Move it ahead to see what an account shows on a later day.'),
    ),
    ui.todayError ? h('div', { class: 'error', id: 'calc-today-error', role: 'alert' }, icon('alert', { size: 'sm' }), h('span', {}, ui.todayError)) : null,
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
  // The copied "today" is kept only when it is later than the latest date; otherwise the test follows the dates.
  scenario = { ...blankScenario(), ...s, ahead: null };
  const latest = latestMoment();
  const copiedToday = s.today && /^\d{4}-\d{2}-\d{2}$/.test(s.today.date || '') ? { date: s.today.date, part: s.today.part === 'night' ? 'night' : 'day' } : null;
  if (copiedToday && (!latest || isLater(copiedToday, latest))) scenario.ahead = copiedToday;
  ui.paste = '';
  ui.pasteError = '';
  ui.copied = '';
  ui.add = blankAdd();
  ui.month = null;
  ui.selected = null;
  ui.zipOpen = false;
  syncToday();
  save();
  if (s.terms !== ui.choicesTerms) ui.choicesTerms = null;
  calculate({ button: btn });
  toast('The scenario was loaded.');
}

async function clearAll(btn, everything) {
  const ok = await confirmDialog(
    everything
      ? { title: 'Start over?', body: 'The dates are removed, and the place, customs and today go back to where they start. Copy the scenario first to keep it.', confirmLabel: 'Start over', danger: true }
      : { title: 'Remove every date?', body: 'The place and the customs stay as they are.', confirmLabel: 'Remove every date', danger: true },
  );
  if (!ok) return;
  if (everything) {
    scenario = blankScenario();
    scenario.halachic = ui.choices ? JSON.parse(JSON.stringify(ui.choices.defaults)) : null;
    ui.zipOpen = false;
  } else {
    scenario.entries = [];
    scenario.ahead = null;
  }
  ui.month = null;
  ui.selected = null;
  ui.add = blankAdd();
  ui.todayError = '';
  save();
  calculate({ button: btn });
}

function keepBox() {
  return h(
    'details',
    { class: 'calc-fold', id: 'calc-keep-box', open: ui.keepOpen, ontoggle: e => (ui.keepOpen = e.currentTarget.open) },
    h('summary', {}, h('span', { class: 'calc-fold-title' }, 'Keep this scenario, or load one'), h('span', { class: 'small muted' }, 'Copy it as text to run the same case again later')),
    h(
      'div',
      { class: 'calc-fold-body' },
      h('div', { class: 'actions' }, button({ label: 'Copy the scenario', icon: 'copy', attrs: { id: 'calc-copy' }, onclick: copyScenario })),
      ui.copied
        ? h('div', { class: 'calc-copied' }, h('p', { class: 'small' }, 'The scenario could not be put on the clipboard. Select it and copy it:'), h('textarea', { id: 'calc-copied', class: 'calc-text', readonly: true, rows: '8', value: ui.copied }))
        : null,
      h(
        'form',
        {
          class: 'calc-paste',
          novalidate: true,
          onsubmit: e => {
            e.preventDefault();
            loadScenario(e.submitter);
          },
        },
        h('label', { for: 'calc-paste', class: 'calc-label' }, 'Load a scenario copied from this page'),
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

// ---------- what an event is, in this page's words ----------

/** Entered by the tester: the start of a period, and a hefsek taharah or immersion that was recorded. */
const wasEntered = e => e.kind === 'flow' || isDone(e);
/** The server's title without its "(projected)": this page says it with a label instead. */
const plainTitle = e => (e.title || '').replace(' (projected)', '');

/** A short label for the state of an event that was not entered; null for one that was. */
function stateTag(e) {
  if (wasEntered(e)) return tag('entered', 'ok');
  if (e.kind === 'hefsek') return tag('not entered', 'warn');
  if (e.projected) return tag('expected', 'info');
  return null;
}

/** What a mark stands for, for a screen reader and the day's label. */
function spoken(e) {
  const t = plainTitle(e);
  if (wasEntered(e)) return t + ' (entered)';
  if (e.kind === 'hefsek') return t + ' (not entered: the day it can be done)';
  return e.projected ? t + ' (expected)' : t;
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
}

function dayLabel(grid, date, day, events) {
  const parts = [longDate(date) + ', ' + day.hebrewDay + ' ' + day.hebrewMonth];
  if (date === grid.today) parts.push('Today in this test');
  if (day.rest) parts.push(fill('{shabbat} or {yom_tov}'));
  for (const e of events) parts.push(spoken(e));
  if (events.length === 0) parts.push('Nothing marked');
  return parts.join('. ') + '.';
}

function select(date, focus) {
  ui.selected = date;
  const i = idx;
  // keep the day in view: it is in the month shown first, or in the one after it
  const at = i.months.indexOf(ui.month);
  const shown = [ui.month, i.months[at + 1]];
  if (!shown.includes(date.slice(0, 7))) ui.month = date.slice(0, 7);
  ui.add = { ...ui.add, error: '', message: '' };
  redrawMe();
  requestAnimationFrame(() => {
    if (focus) document.getElementById('calc-day-' + date)?.focus({ preventScroll: true });
    // the panel for the day is beside the calendar, or under it on a narrow screen
    const panel = document.getElementById('calc-day-panel');
    if (panel) {
      const box = panel.getBoundingClientRect();
      if (box.top < 0 || box.top > window.innerHeight - 160) panel.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  });
}

function onKey(e, i) {
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (moves[e.key] === undefined) return;
  const to = addDays(ui.selected, moves[e.key]);
  e.preventDefault();
  if (i.days.has(to)) select(to, true);
}

function monthTable(i, grid, month, labelId) {
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
          h('span', { class: 'hd', lang: scenario.terms === 'he' ? 'he' : null }, day.hebrewDay),
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
    { class: 'month', 'aria-labelledby': labelId, onkeydown: e => onKey(e, i) },
    h('thead', {}, h('tr', {}, WEEKDAYS.map(([short, long], k) => h('th', { scope: 'col', abbr: long, class: k === 6 ? 'sat' : null }, h('span', { 'aria-hidden': 'true' }, short), h('span', { class: 'visually-hidden' }, long))))),
    h('tbody', {}, rows),
  );
}

function hebrewMonths(grid, month) {
  const inMonth = grid.days.filter(d => d.date.startsWith(month));
  if (!inMonth.length) return '';
  const first = inMonth[0].hebrewMonth;
  const last = inMonth[inMonth.length - 1].hebrewMonth;
  return first === last ? first : first + ' – ' + last;
}

/** The marks, in two groups: what the tester entered, and what the calendar works out. */
function legend() {
  const item = (m, text) => h('li', {}, m, h('span', {}, text));
  return h(
    'div',
    { class: 'calc-legend', id: 'calc-legend' },
    h(
      'div',
      { class: 'calc-legend-group' },
      h('h4', {}, 'Entered'),
      h(
        'ul',
        { class: 'legend' },
        item(mark({ kind: 'flow' }), cap(fill('{flow} or {stain}'))),
        item(mark({ kind: 'hefsek', title: '✓' }), cap(fill('{hefsek}'))),
        item(mark({ kind: 'mikvah', title: '✓' }), cap(fill('{immersion} (optional)'))),
      ),
    ),
    h(
      'div',
      { class: 'calc-legend-group' },
      h('h4', {}, 'Worked out'),
      h(
        'ul',
        { class: 'legend' },
        item(mark({ kind: 'hefsek', projected: true }), cap(fill('{hefsek} day, not entered'))),
        item(mark({ kind: 'clean_day' }, { number: 1 }), cap(fill('{clean_days}, day 1 to 7'))),
        item(mark({ kind: 'mikvah' }), cap(fill('{mikvah_night}'))),
        item(h('span', { class: 'calc-pair' }, mark({ kind: 'onah' }, { night: false }), mark({ kind: 'onah' }, { night: true })), cap(fill('{veset_onah}, day or night'))),
        item(mark({ kind: 'onah', light: true }, { night: true }), cap(fill('{or_zarua} only'))),
        item(mark({ kind: 'clean_day', projected: true }, { number: 3 }), 'Dashed: expected'),
      ),
    ),
  );
}

function calendarCard() {
  const r = ui.result;
  if (!r || !r.state.grid) return card({ title: 'Calendar', icon: 'calendar', className: 'calc-cal' }, h('p', { class: 'muted' }, ui.error ? 'Nothing to show until the calculation can be made.' : 'Working it out…'));
  const grid = r.state.grid;
  const i = index(grid);
  ensureMonth(i, grid);
  const at = i.months.indexOf(ui.month);
  const prev = i.months[at - 1];
  const next = i.months[at + 1];
  const goMonth = month => {
    ui.month = month;
    redrawMe();
  };
  const shown = [ui.month, next].filter(Boolean);
  return card(
    { title: 'Calendar', icon: 'calendar', className: 'calc-cal' + (ui.busy ? ' busy' : ''), headerAction: ui.busy ? h('span', { class: 'small muted', role: 'status' }, 'Working it out…') : null },
    h('p', { class: 'calc-how', id: 'calc-how' }, h('strong', {}, 'Click a day'), ', then choose what happened on it.'),
    h(
      'div',
      { class: 'month-nav' },
      button({ label: 'Earlier month', icon: 'chevron-left', iconOnly: true, disabled: !prev, attrs: { id: 'calc-prev' }, onclick: () => goMonth(prev) }),
      h('span', { class: 'small muted calc-range', 'aria-live': 'polite' }, shown.map(mo => fmtDate(mo + '-01', { month: 'long', year: 'numeric' })).join(' and ')),
      button({ label: 'Later month', icon: 'chevron-right', iconOnly: true, disabled: !i.months[at + 2], attrs: { id: 'calc-next' }, onclick: () => goMonth(next) }),
    ),
    shown.map((mo, k) =>
      h(
        'div',
        { class: 'calc-month' },
        h('div', { class: 'month-title' }, h('h3', { id: 'calc-month-title-' + k }, fmtDate(mo + '-01', { month: 'long', year: 'numeric' })), h('p', { class: 'hebrew-months' }, hebrewMonths(grid, mo))),
        monthTable(i, grid, mo, 'calc-month-title-' + k),
      ),
    ),
    legend(),
  );
}

function eventTime(e) {
  if (e.allDay) return 'All day';
  if (e.kind === 'mikvah') return 'After ' + e.start;
  if (e.start === e.end || !e.end) return e.start;
  if (e.startDate !== e.endDate) return e.start + ' to ' + e.end + ' the next morning';
  return e.start + ' to ' + e.end;
}

function eventRow(e, opts) {
  const o = opts || {};
  const n = e.kind === 'clean_day' ? cleanDayNumber(e) : null;
  const state = stateTag(e);
  return h(
    'li',
    { class: 'ev ' + e.kind + (e.projected ? ' projected' : '') },
    mark(e, { number: n }),
    h(
      'div',
      { class: 'ev-main' },
      h('div', { class: 'ev-title' }, plainTitle(e), state ? ' ' : null, state),
      h('div', { class: 'ev-when' }, o.continuing ? 'From the evening before, until ' + e.end : (o.date ? shortDate(e.startDate) + ' · ' : '') + eventTime(e)),
      e.description && !o.continuing ? h('div', { class: 'ev-desc' }, e.description) : null,
    ),
  );
}

// ---------- the selected day: what happened on it ----------

const labelOf = kind => (ui.result ? ui.result.state.labels.kinds[kind] : kind);

function kindMark(kind) {
  if (kind === 'flow' || kind === 'stain') return mark({ kind: 'flow' });
  if (kind === 'broken') return h('span', { class: 'mk broken', 'aria-hidden': 'true' }, '×');
  if (kind === 'hefsek') return mark({ kind: 'hefsek', title: '✓' });
  return mark({ kind: 'mikvah', title: '✓' });
}

function addDate(entry, btn) {
  ui.add = { ...ui.add, error: '', message: '' };
  scenario.entries.push(entry);
  save();
  calculate({ added: scenario.entries.length - 1, button: btn, focus: 'calc-add-result' });
}

/** One button that adds one date. */
function addButton(id, kind, part, label, date) {
  const entry = { kind, date };
  if (part) entry.part = part;
  return h(
    'button',
    {
      type: 'button',
      class: 'calc-addbtn',
      id,
      onclick: e => {
        if (kind === 'flow' && !ui.add.veset) entry.veset = false;
        addDate(entry, e.currentTarget);
      },
    },
    kindMark(kind),
    h('span', {}, label),
  );
}

function dayPanel() {
  const r = ui.result;
  if (!r || !r.state.grid) return null;
  const grid = r.state.grid;
  const i = index(grid);
  ensureMonth(i, grid);
  const date = ui.selected;
  const day = i.days.get(date);
  if (!day) return null;
  const a = ui.add;
  const events = i.starting.get(date) || [];
  const continuing = (i.continuing.get(date) || []).filter(e => e.kind === 'onah' || e.kind === 'flow');
  const flow = labelOf('flow');
  return card(
    { className: 'calc-day', attrs: { id: 'calc-day-panel', 'aria-labelledby': 'calc-day-title' } },
    h(
      'div',
      { class: 'calc-day-head' },
      h('h2', { id: 'calc-day-title' }, longDate(date) + ', ' + date.slice(0, 4)),
      h(
        'p',
        { class: 'calc-day-sub' },
        h('span', { lang: scenario.terms === 'he' ? 'he' : null }, day.hebrewDay + ' ' + day.hebrewMonth),
        ' · Sunrise ' + (day.sunrise || '—') + ' · ' + cap(fill('{sunset} ')) + (day.sunset || '—'),
        day.rest ? h('span', { class: 'tag' }, fill('{shabbat} or {yom_tov}')) : null,
      ),
    ),
    h('h3', { class: 'calc-q', id: 'calc-add-title' }, 'What happened on this day?'),
    h(
      'div',
      { class: 'calc-addgrid', role: 'group', 'aria-labelledby': 'calc-add-title' },
      addButton('calc-add-flow-day', 'flow', 'day', flow + ', by day', date),
      addButton('calc-add-flow-night', 'flow', 'night', flow + ', at night', date),
      addButton('calc-add-hefsek', 'hefsek', null, labelOf('hefsek'), date),
    ),
    h('p', { class: 'small muted calc-night-note' }, fill('At night: after {sunset} on this date.')),
    h(
      'div',
      { id: 'calc-add-result', tabindex: '-1', class: 'calc-add-result' },
      a.error ? alert({ kind: 'bad', role: 'alert', className: 'calc-refused' }, a.error) : null,
      a.message ? alert({ kind: 'ok', className: 'calc-recorded' }, a.message) : null,
    ),
    h(
      'details',
      { class: 'calc-more', id: 'calc-more', open: ui.moreOpen, ontoggle: e => (ui.moreOpen = e.currentTarget.open) },
      h('summary', {}, 'Other things to add'),
      h(
        'div',
        { class: 'calc-addgrid' },
        addButton('calc-add-stain-day', 'stain', 'day', labelOf('stain') + ', by day', date),
        addButton('calc-add-stain-night', 'stain', 'night', labelOf('stain') + ', at night', date),
        addButton('calc-add-broken-day', 'broken', 'day', labelOf('broken') + ', by day', date),
        addButton('calc-add-broken-night', 'broken', 'night', labelOf('broken') + ', at night', date),
        addButton('calc-add-mikvah', 'mikvah', null, labelOf('mikvah') + ', that evening', date),
      ),
      h('p', { class: 'small muted' }, fill('A {stain} only when a {rav} said it makes her {niddah}.')),
      h(
        'form',
        {
          class: 'calc-timeform',
          novalidate: true,
          onsubmit: e => {
            e.preventDefault();
            if (!a.time) {
              ui.add = { ...a, error: 'Enter the time.', message: '' };
              redrawMe();
              return;
            }
            const entry = { kind: a.timeKind, date, time: a.time };
            if (a.timeKind === 'flow' && !a.veset) entry.veset = false;
            addDate(entry, e.submitter);
          },
        },
        selectField({ id: 'calc-time-kind', label: 'At a time I know', value: a.timeKind, wide: false, options: ['flow', 'stain', 'broken'].map(k => ({ value: k, label: labelOf(k) })), onchange: e => (ui.add.timeKind = e.target.value) }),
        textField({ id: 'calc-time', label: 'Time', type: 'time', wide: false, value: a.time, oninput: e => (ui.add.time = e.target.value) }),
        button({ label: 'Add at this time', type: 'submit', size: 'sm', attrs: { id: 'calc-add-time' } }),
      ),
      h('p', { class: 'small muted' }, 'With a time, the calendar works out whether it was day or night.'),
      checkRow({ id: 'calc-veset', label: fill('A {flow} added here counts for the {vesatot}'), help: fill('Leave this on unless a {rav} said it does not count.'), checked: a.veset, onchange: e => (ui.add.veset = e.target.checked) }),
    ),
    h('h3', { class: 'calc-q' }, 'On this day'),
    events.length || continuing.length
      ? h('ul', { class: 'events', id: 'calc-day-events' }, continuing.map(e => eventRow(e, { continuing: true })), events.map(e => eventRow(e)))
      : h('p', { class: 'muted', id: 'calc-day-events' }, 'Nothing is marked on this day.'),
  );
}

// ---------- where things stand, and what the calendar works out ----------

function statusCard() {
  const r = ui.result;
  if (!r) return card({ title: 'Where things stand', icon: 'info' }, h('p', { class: 'muted' }, 'Working it out…'));
  const s = r.state;
  return card(
    { title: 'Where things stand', icon: 'info', className: 'calc-status' },
    s.today ? h('p', { class: 'small muted calc-today-line', lang: scenario.terms === 'he' ? 'he' : null }, 'As of ' + s.today.civil + ' · ' + s.today.hebrew + ' · ' + (s.today.part === 'night' ? 'at night' : 'by day')) : null,
    s.status ? h('p', { class: 'calc-headline', id: 'calc-headline' }, s.status.headline) : null,
    s.status && s.status.detail ? h('p', { class: 'calc-detail', id: 'calc-detail' }, s.status.detail) : null,
    s.alerts.length ? h('div', { class: 'alerts', id: 'calc-alerts' }, s.alerts.map(a => alert({ kind: a.level === 'info' ? 'info' : 'warn' }, a.text))) : h('p', { class: 'small muted', id: 'calc-alerts' }, 'No warnings, pattern alerts or notes.'),
  );
}

/** The last line of a projected event's description: the server's sentence that says what it assumes. */
function assumption(e) {
  if (!e.projected || !e.description) return '';
  const line = e.description.split('\n').find(l => l.startsWith('Projected: '));
  return line ? cap(line.slice('Projected: '.length)) : '';
}

function worksOutCard() {
  const r = ui.result;
  if (!r || !r.state.grid) return null;
  const grid = r.state.grid;
  // from the test's today on, and not what the tester entered
  const coming = grid.events.filter(e => e.endDate >= grid.today && !wasEntered(e));
  const hefsek = coming.filter(e => e.kind === 'hefsek');
  const clean = coming.filter(e => e.kind === 'clean_day');
  const mikvah = coming.filter(e => e.kind === 'mikvah');
  const onot = coming.filter(e => e.kind === 'onah');
  const steps = hefsek.length + clean.length + mikvah.length;
  const note = [...hefsek, ...clean, ...mikvah].map(assumption).find(Boolean) || '';

  let cleanRow = null;
  if (clean.length) {
    const first = clean[0];
    const last = clean[clean.length - 1];
    const a = cleanDayNumber(first);
    const b = cleanDayNumber(last);
    const state = stateTag(first);
    cleanRow = h(
      'li',
      { class: 'ev clean_day' + (first.projected ? ' projected' : '') },
      mark(first, { number: a }),
      h(
        'div',
        { class: 'ev-main' },
        h('div', { class: 'ev-title' }, cap(fill('{clean_days}')) + (a === b ? ': day ' + a : ': day ' + a + ' to day ' + b), state ? ' ' : null, state),
        h('div', { class: 'ev-when' }, a === b ? shortDate(first.startDate) : shortDate(first.startDate) + ' to ' + shortDate(last.startDate)),
        h(
          'details',
          { class: 'calc-each', open: ui.cleanOpen, ontoggle: e => (ui.cleanOpen = e.currentTarget.open) },
          h('summary', {}, 'Each day'),
          h('ul', { class: 'events' }, clean.map(e => eventRow(e, { date: true }))),
        ),
      ),
    );
  }

  return card(
    { title: 'What the calendar works out', icon: 'clock', className: 'calc-works' },
    h('p', { class: 'small muted' }, 'From the dates you entered, for the days from "today" on. Nothing in this box was entered by you.'),
    steps
      ? h(
          'div',
          { class: 'calc-group', id: 'calc-steps' },
          h('h3', {}, cap(fill('until the {mikvah_night}'))),
          note ? h('p', { class: 'calc-assume small', id: 'calc-assume' }, note) : null,
          h('ul', { class: 'events' }, hefsek.map(e => eventRow(e, { date: true })), cleanRow, mikvah.map(e => eventRow(e, { date: true }))),
        )
      : null,
    h(
      'div',
      { class: 'calc-group', id: 'calc-onot' },
      h('h3', {}, cap(fill('{onot} of separation'))),
      onot.length
        ? h('ul', { class: 'events' }, onot.map(e => eventRow(e, { date: true })))
        : h('p', { class: 'muted' }, scenario.entries.length === 0 ? 'None yet. Click the day a period began and add it.' : 'None from "today" on, in the months the calendar shows.'),
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

// ---------- the dates entered ----------

/** What was entered, in plain words, for a date that was not recorded. */
function entered(e) {
  const label = labelOf(e.kind);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') ? fmtDate(e.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : String(e.date || 'no date');
  const when = e.time ? ', at ' + e.time : e.part === 'night' ? ', at night' : e.part === 'day' ? ', by day' : e.kind === 'mikvah' ? ', in the evening' : '';
  return label + ': ' + day + when;
}

function removeEntry(index, btn) {
  scenario.entries.splice(index, 1);
  ui.add = { ...ui.add, error: '', message: '' };
  save();
  calculate({ button: btn, focus: 'calc-log-title' });
}

function logCard() {
  const r = ui.result;
  const recorded = r ? r.state.entries : [];
  const refused = r ? r.outcomes.filter(o => !o.ok && scenario.entries[o.index]) : [];
  return card(
    {
      title: 'Dates you entered',
      icon: 'list',
      className: 'calc-log',
      headerAction: scenario.entries.length ? button({ label: 'Remove every date', size: 'sm', variant: 'link', attrs: { id: 'calc-clear' }, onclick: e => clearAll(e.currentTarget, false) }) : null,
    },
    h('p', { class: 'small muted', id: 'calc-log-title', tabindex: '-1' }, scenario.entries.length === 0 ? 'None yet. Click a day on the calendar to add one.' : 'Newest first, as an account’s Log shows them. Removing one works everything out again.'),
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

function customsBox() {
  const c = ui.choices;
  if (!c || !scenario.halachic) return null;
  const hal = scenario.halachic;
  const tzeit = hal.tzeit;
  const presetIndex = c.tzeitPresets.findIndex(p => p.rule.kind === tzeit.kind && p.rule.value === tzeit.value);
  const changed = c.choices.filter(ch => hal[ch.key] !== c.defaults[ch.key]).length + (tzeit.kind === c.defaults.tzeit.kind && tzeit.value === c.defaults.tzeit.value ? 0 : 1);
  return h(
    'details',
    { class: 'calc-fold calc-customs', id: 'calc-customs', open: ui.customsOpen, ontoggle: e => (ui.customsOpen = e.currentTarget.open) },
    h(
      'summary',
      {},
      h('span', { class: 'calc-fold-title' }, 'Customs'),
      h('span', { class: 'small muted', id: 'calc-customs-state' }, changed ? changed + ' changed from a new account’s' : 'As a new account has them. Open to change one.'),
    ),
    h(
      'div',
      { class: 'calc-fold-body' },
      h('p', { class: 'small muted' }, 'The twelve settings of the Customs tab. Each change is worked out at once.'),
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
    ),
  );
}

// ---------- the page ----------

export function calcPage() {
  return h(
    'div',
    { class: 'calc' },
    h(
      'p',
      { class: 'calc-note', id: 'calc-note' },
      icon('info', { size: 'sm' }),
      h('span', {}, 'This runs the same calculation as people’s accounts, and saves nothing.'),
    ),
    setupCard(),
    h('div', { class: 'calc-main' }, h('div', { class: 'calc-col calc-col-cal' }, calendarCard()), h('div', { class: 'calc-col calc-col-side' }, dayPanel(), statusCard(), worksOutCard(), logCard())),
    h('div', { class: 'calc-folds' }, customsBox(), keepBox()),
  );
}
