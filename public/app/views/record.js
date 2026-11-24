/*
 * Recording an entry, in three ways that share one request and one answer:
 *   - one click: the next step in "Where things stand", and the buttons of a
 *     day of the calendar (recordNow);
 *   - the full form, for any kind, any date, a clock time, a note and the
 *     vesatot switch: on Today it opens under the status card from a link
 *     (openRecord, recordPanel), on the Log it is "Add a past entry" (recordCard).
 * The server's confirmation is shown where the entry was recorded from, with
 * Undo; a refusal is shown beside the button or in the form (notice()).
 */
import { alert, api, button, card, checkRow, h, icon, radioRow, textField } from '../lib.js';
import { S, adopt, go, render, t } from '../store.js';
import { entryMark } from './marks.js';
import { attempt, longDate, refresh, region, today } from './shared.js';

const KINDS = ['flow', 'stain', 'hefsek', 'broken', 'mikvah'];

/** The form. where: where its confirmation is shown ('status' on Today, 'log' on the Log); opener: the id of the control that opened it. */
const blank = () => ({ open: false, kind: null, mode: 'now', date: '', how: '', time: '', veset: true, note: '', error: '', fieldError: '', where: 'status', opener: null });

let rec = blank();
/** The server's sentence after the last entry was recorded, where it was recorded from, and the entry's id (for Undo). */
let done = null;
/** A one-click entry the server refused: { where, message }. */
let refused = null;

const timed = kind => kind === 'flow' || kind === 'stain' || kind === 'broken';
const smooth = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

function kindHelp(kind) {
  switch (kind) {
    case 'flow':
      return '';
    case 'stain':
      return t('Makes her {niddah}');
    case 'hefsek':
      return t('Before {sunset}');
    case 'broken':
      return t('The count restarts');
    case 'mikvah':
      return 'Optional';
    default:
      return '';
  }
}

const nowLabel = kind => (kind === 'hefsek' ? 'Today' : kind === 'mikvah' ? 'Tonight' : 'Now');

// ---------- the answer: confirmation with Undo, or the refusal ----------

/** The entry was recorded: adopt the new state, and show the server's sentence where it was recorded from. */
function succeeded(result, where) {
  adopt(result.state);
  rec = blank();
  refused = null;
  done = { where, message: result.message || 'Recorded.', id: result.entryId || null, undoError: '' };
  render();
  document.getElementById('rec-done')?.focus();
}

/**
 * Records one entry at once (POST /api/entries), from a button: the next step
 * ('status') or a day of the calendar ('day'). btn is shown busy meanwhile.
 *   recordNow({ kind: 'flow', when: 'now' }, e.currentTarget, 'status')
 */
export function recordNow(body, btn, where) {
  refused = null;
  attempt(() => api('POST', '/api/entries', body), {
    button: btn,
    done: result => succeeded(result, where),
    fail: message => {
      done = null;
      refused = { where, message };
      render();
    },
  });
}

/** A refusal that is not the server's (a field left empty), shown in the same place. */
export function refuse(where, message) {
  done = null;
  refused = { where, message };
  render();
}

/** Forgets the confirmation and the refusal shown at this place (another day was chosen). */
export function clearNotice(where) {
  if (done && done.where === where) done = null;
  if (refused && refused.where === where) refused = null;
}

/** Removes the entry just recorded (DELETE /api/entries/:id). */
function undo(e) {
  const d = done;
  if (!d || !d.id) return;
  d.undoError = '';
  attempt(() => api('DELETE', '/api/entries/' + encodeURIComponent(d.id)), {
    button: e.currentTarget,
    done: r => {
      adopt(r.state);
      done = { where: d.where, message: 'Removed.', id: null, undoError: '' };
      render();
      document.getElementById('rec-done')?.focus();
    },
    fail: message => {
      d.undoError = message + ' Remove it in the Log.';
      render();
    },
  });
}

/** The confirmation (with Undo) or the refusal shown at this place, or null. */
export function notice(where) {
  if (refused && refused.where === where) {
    return alert({ kind: 'bad', role: 'alert', className: 'rec-error quick-error' }, h('span', { id: 'quick-error', tabindex: '-1' }, refused.message));
  }
  if (!done || done.where !== where) return null;
  return alert(
    { kind: 'ok', className: 'rec-done' },
    h('span', { id: 'rec-done', tabindex: '-1' }, done.message),
    h(
      'span',
      { class: 'rec-done-actions' },
      done.id ? button({ label: 'Undo', variant: 'link', attrs: { id: 'rec-undo' }, onclick: undo }) : null,
      where === 'log' ? null : button({ label: 'See in Log', variant: 'link', attrs: { id: 'rec-see-log' }, onclick: () => go('log') }),
    ),
    done.undoError ? h('span', { class: 'error', role: 'alert' }, icon('alert', { size: 'sm' }), h('span', {}, done.undoError)) : null,
  );
}

// ---------- the full form ----------

/**
 * Opens the form on Today, under "Where things stand", preset as asked, and
 * shows it. preset: { kind, mode: 'now' | 'other', date }; opener: the id of
 * the link that opened it (the focus goes back there on Close).
 */
export function openRecord(preset, opener) {
  const p = preset || {};
  rec = { ...blank(), open: true, kind: p.kind || null, mode: p.mode || 'now', date: p.date || '', where: 'status', opener: opener || null };
  done = null;
  refused = null;
  render();
  const panel = document.getElementById('record-panel');
  if (panel) panel.scrollIntoView({ block: 'start', behavior: smooth() });
  const first = document.getElementById(rec.kind ? (rec.mode === 'other' ? 'rec-date' : 'rec-kind-' + rec.kind) : 'rec-kind-flow');
  if (first) first.focus({ preventScroll: true });
}

/** Closes the form; the focus goes back to what opened it. */
function closeRecord() {
  const opener = rec.opener;
  rec = blank();
  render();
  const el = opener && document.getElementById(opener);
  if (el) el.focus({ preventScroll: true });
}

function choose(kind) {
  const keepDate = rec.mode === 'other' && rec.date;
  rec = { ...blank(), open: true, kind, mode: keepDate ? 'other' : 'now', date: keepDate ? rec.date : '', where: rec.where, opener: rec.opener };
  done = null;
  refused = null;
  refresh('record');
  document.getElementById('rec-kind-' + kind)?.focus();
}

function submit(e) {
  e.preventDefault();
  const body = { kind: rec.kind };
  rec.error = '';
  rec.fieldError = '';
  if (rec.mode === 'now') body.when = 'now';
  else {
    if (!rec.date) {
      rec.fieldError = 'date';
      rec.error = 'Choose a date.';
      refresh('record');
      document.getElementById('rec-date')?.focus();
      return;
    }
    body.date = rec.date;
    if (timed(rec.kind)) {
      if (!rec.how) {
        rec.fieldError = 'how';
        rec.error = 'Choose day, night or a time.';
        refresh('record');
        document.getElementById('r-rec-how-day')?.focus();
        return;
      }
      if (rec.how === 'time') {
        if (!rec.time) {
          rec.fieldError = 'time';
          rec.error = 'Enter the time.';
          refresh('record');
          document.getElementById('rec-time')?.focus();
          return;
        }
        body.time = rec.time;
      } else body.part = rec.how;
    }
  }
  if (rec.kind === 'flow') body.veset = rec.veset;
  if (rec.note.trim()) body.note = rec.note.trim();
  const where = rec.where;
  attempt(() => api('POST', '/api/entries', body), {
    button: e.submitter || document.getElementById('rec-submit'),
    done: result => succeeded(result, where),
    fail: message => {
      rec.error = message;
      rec.fieldError = '';
      refresh('record');
      document.getElementById('rec-error')?.focus();
    },
  });
}

function nowText(kind) {
  if (kind === 'hefsek') return longDate(today()) + '.';
  if (kind === 'mikvah') return null;
  return S.today ? (S.today.part === 'night' ? 'Night, ' : 'Day, ') + S.today.hebrew : null;
}

function whenPart() {
  const kind = rec.kind;
  const set = (k, v) => {
    rec[k] = v;
    refresh('record');
  };
  const radio = (name, value, label, help) =>
    radioRow({
      name: 'rec-' + name,
      value,
      label,
      help,
      checked: rec[name] === value,
      onchange: () => {
        if (name === 'mode' && value === 'other' && !rec.date) rec.date = today();
        set(name, value);
      },
    });
  const nowHint = nowText(kind);
  const dateLabel = kind === 'mikvah' ? 'Evening of' : 'Date';
  return h(
    'fieldset',
    { class: 'plain when' },
    h('legend', {}, 'When'),
    h('div', { class: 'when-choice' }, radio('mode', 'now', nowLabel(kind), nowHint), radio('mode', 'other', 'Another time')),
    rec.mode === 'other'
      ? h(
          'div',
          { class: 'indent' },
          textField({
            id: 'rec-date',
            label: dateLabel,
            type: 'date',
            value: rec.date,
            max: today(),
            min: S.grid ? S.grid.days[0].date : null,
            error: rec.fieldError === 'date' ? rec.error : '',
            oninput: e => (rec.date = e.target.value),
            onchange: e => {
              rec.date = e.target.value;
            },
          }),
          rec.date && rec.date <= today() ? h('p', { class: 'help date-name' }, longDate(rec.date)) : null,
          timed(kind)
            ? h(
                'fieldset',
                { class: 'plain how' + (rec.fieldError === 'how' ? ' invalid' : '') },
                h('legend', { class: 'small-legend' }, 'Time of day'),
                radio('how', 'day', 'By day', t('Sunrise to {sunset}')),
                radio('how', 'night', 'At night', t('After {sunset}')),
                radio('how', 'time', 'At a time'),
                rec.how === 'time'
                  ? h('div', { class: 'indent' }, textField({ id: 'rec-time', label: 'Time', type: 'time', wide: false, value: rec.time, error: rec.fieldError === 'time' ? rec.error : '', oninput: e => (rec.time = e.target.value) }))
                  : null,
                rec.fieldError === 'how' ? h('div', { class: 'error' }, icon('alert', { size: 'sm' }), h('span', {}, rec.error)) : null,
              )
            : null,
        )
      : null,
  );
}

function form() {
  const kind = rec.kind;
  const label = S.labels.kinds[kind];
  return h(
    'form',
    { class: 'record-form', onsubmit: submit, novalidate: true },
    h('h3', { class: 'form-title' }, entryMark(kind), h('span', {}, label)),
    whenPart(),
    kind === 'flow'
      ? checkRow({ id: 'rec-veset', label: t('Counts for the {vesatot}'), checked: rec.veset, onchange: e => (rec.veset = e.target.checked) })
      : null,
    textField({ id: 'rec-note', label: 'Note (optional)', maxlength: 200, value: rec.note, oninput: e => (rec.note = e.target.value) }),
    rec.error && !rec.fieldError ? alert({ kind: 'bad', role: 'alert', className: 'rec-error' }, h('span', { id: 'rec-error', tabindex: '-1' }, rec.error)) : null,
    h('div', { class: 'actions' }, button({ label: 'Record ' + label.toLowerCase(), variant: 'primary', type: 'submit', attrs: { id: 'rec-submit' } }), button({ label: 'Cancel', attrs: { id: 'rec-cancel' }, onclick: closeRecord })),
  );
}

function kindPicker() {
  return h(
    'div',
    { class: 'kinds', role: 'group', 'aria-label': 'What to record' },
    KINDS.map(kind =>
      h(
        'button',
        {
          type: 'button',
          class: 'kind',
          id: 'rec-kind-' + kind,
          'aria-pressed': String(rec.kind === kind),
          onclick: () => choose(kind),
        },
        entryMark(kind),
        h('span', { class: 'kind-text' }, h('span', { class: 'kind-label' }, S.labels.kinds[kind]), kindHelp(kind) ? h('span', { class: 'kind-help' }, kindHelp(kind)) : null),
      ),
    ),
  );
}

/** The form's body: what to record, then when. */
function formBody() {
  const forDate = rec.mode === 'other' && rec.date && !rec.kind;
  return h(
    'div',
    {},
    forDate ? h('p', { class: 'for-date' }, icon('calendar', { size: 'sm' }), h('span', {}, 'For ' + longDate(rec.date) + '.')) : null,
    h('p', { class: 'kinds-title' }, 'What to record'),
    kindPicker(),
    rec.kind ? form() : null,
  );
}

/** Today: the full form, open only after a link asked for it. */
export function recordPanel() {
  if (!rec.open || rec.where !== 'status') return null;
  return card(
    {
      title: 'Record',
      icon: 'plus',
      className: 'record-card record-panel',
      attrs: { id: 'record-panel' },
      headerAction: button({ label: 'Close', icon: 'close', size: 'sm', attrs: { id: 'rec-close' }, onclick: closeRecord }),
    },
    region('record', formBody),
  );
}

/** The Log: "Add a past entry", closed until asked for. */
export function recordCard() {
  return card(
    { title: 'Add a past entry', icon: 'plus', className: 'record-card', attrs: { id: 'record-card' } },
    region('record', () => {
      if (!rec.open || rec.where !== 'log') {
        return h(
          'div',
          {},
          notice('log'),
          button({
            label: 'Add entry',
            attrs: { id: 'rec-open' },
            onclick: () => {
              rec = { ...blank(), open: true, mode: 'other', date: today(), where: 'log', opener: 'rec-open' };
              done = null;
              refused = null;
              refresh('record');
              document.getElementById('rec-kind-flow')?.focus();
            },
          }),
        );
      }
      return formBody();
    }),
  );
}
