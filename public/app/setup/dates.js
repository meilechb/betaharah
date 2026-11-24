/*
 * Setup step: the most recent dates, so that the calendar can start.
 * Three short questions: when the last flow began, whether a hefsek taharah
 * was done, and whether she has immersed. Each answer is recorded at once
 * with POST /api/entries, and the server's confirmation or refusal is shown
 * as it comes back. "Nothing to record now" is a valid answer.
 */
import { alert, api, button, h, icon, radioRow, setFieldError, textField, withBusy } from '../lib.js';
import { S, adopt, render, t, todayIso } from '../store.js';
import { back, flow, goTo, next, onEnter, problem, screen } from './flow.js';

const QUESTIONS = ['flow', 'hefsek', 'mikvah'];

let q = 'flow'; // 'flow' | 'hefsek' | 'mikvah' | 'summary'
let form = { date: '', part: '' };
let fieldError = '';
let partError = '';
let last = null; // { id, kind, message } of the entry just recorded, for its confirmation and Undo
let note = ''; // a short status line ("Removed.")

/** Where to start: after what was already recorded. */
function questionAfterEntries() {
  const newest = S.entries[0];
  if (!newest) return 'flow';
  if (newest.kind === 'hefsek') return 'mikvah';
  if (newest.kind === 'mikvah') return 'summary';
  return 'hefsek';
}

onEnter('dates', direction => {
  q = direction === 'back' && S.entries.length ? 'summary' : questionAfterEntries();
  form = { date: '', part: '' };
  fieldError = '';
  partError = '';
  last = null;
  note = '';
});

function ask(next) {
  q = next;
  form = { date: '', part: '' };
  fieldError = '';
  partError = '';
  render();
}

function record(e, kind) {
  const btn = e.currentTarget;
  fieldError = '';
  partError = '';
  if (!form.date) fieldError = 'Choose the date.';
  else if (form.date > todayIso()) fieldError = 'The date cannot be later than today.';
  if (!fieldError && kind === 'flow' && !form.part) partError = 'Choose whether it began by day or at night.';
  if (fieldError || partError) {
    flow.focus = fieldError ? 'sd-date' : 'r-sd-part-day';
    render();
    return;
  }
  const body = { kind, date: form.date };
  if (kind === 'flow') body.part = form.part;
  const before = new Set(S.entries.map(x => x.id));
  withBusy(btn, () => api('POST', '/api/entries', body)).then(
    r => {
      adopt(r.state);
      const added = S.entries.find(x => !before.has(x.id));
      last = { id: added ? added.id : null, kind, message: r.message || 'Recorded.' };
      note = '';
      flow.focus = 'sd-recorded';
      ask(kind === 'flow' ? 'hefsek' : kind === 'hefsek' ? 'mikvah' : 'summary');
    },
    err => {
      fieldError = problem(err);
      flow.focus = 'sd-date';
      render();
    },
  );
}

function undo(e) {
  const btn = e.currentTarget;
  const removed = last;
  withBusy(btn, () => api('DELETE', '/api/entries/' + encodeURIComponent(removed.id))).then(
    r => {
      adopt(r.state);
      last = null;
      note = 'That date was removed. Enter it again below.';
      flow.focus = 'sd-note';
      ask(removed.kind);
    },
    err => {
      note = problem(err);
      flow.focus = 'sd-note';
      render();
    },
  );
}

/** The server's confirmation of the date just recorded, with Undo. */
function recordedBox() {
  if (!last) return null;
  return h(
    'div',
    { id: 'sd-recorded', tabindex: '-1', class: 'setup-recorded' },
    alert(
      { kind: 'ok', role: 'status' },
      h('p', {}, last.message),
      last.id ? h('p', { class: 'link-row' }, button({ label: 'Undo: remove this date', variant: 'link', attrs: { id: 'sd-undo' }, onclick: undo })) : null,
    ),
  );
}

function noteBox() {
  return note ? h('p', { class: 'muted small', id: 'sd-note', tabindex: '-1', role: 'status' }, note) : null;
}

function dateField(label, help) {
  return textField({
    id: 'sd-date',
    label,
    help,
    type: 'date',
    required: true,
    max: todayIso(),
    value: form.date,
    error: fieldError,
    oninput: e => {
      form.date = e.target.value;
      if (fieldError) {
        fieldError = '';
        setFieldError(e.target.closest('.field'), '');
      }
    },
  });
}

function questionCount() {
  return 'Question ' + (QUESTIONS.indexOf(q) + 1) + ' of 3';
}

function noPlaceView() {
  return screen({
    title: 'Your most recent dates',
    body: [
      alert({ kind: 'warn' }, 'Dates can be recorded once the location is chosen, because the times of day are worked out for that place.'),
    ],
    back,
    skip: { label: 'Skip this step', onclick: next },
    main: { label: 'Choose the location', icon: 'map', onclick: () => goTo('place', 'back'), id: 'sd-to-place' },
  });
}

function flowView() {
  return screen({
    count: questionCount(),
    title: t('When did the most recent {flow} begin?'),
    intro: 'This lets the calendar start. Earlier ones can be added later from the Log; the intervals become accurate after a few have been recorded.',
    body: [
      recordedBox(),
      noteBox(),
      dateField('Date it began'),
      h(
        'fieldset',
        { class: 'plain' + (partError ? ' has-error' : '') },
        h('legend', {}, 'By day or at night?'),
        radioRow({ name: 'sd-part', value: 'day', label: 'By day', checked: form.part === 'day', onchange: () => ((form.part = 'day'), (partError = '')) }),
        radioRow({
          name: 'sd-part',
          value: 'night',
          label: 'At night (the night that begins on the evening of that date)',
          checked: form.part === 'night',
          onchange: () => ((form.part = 'night'), (partError = '')),
        }),
        partError ? h('p', { class: 'setup-error', role: 'alert' }, icon('alert', { size: 'sm' }), h('span', {}, partError)) : null,
      ),
    ],
    back,
    skip: { label: 'Nothing to record now', onclick: () => (S.entries.length ? ask('summary') : next()) },
    main: { label: 'Record this date', onclick: e => record(e, 'flow'), id: 'sd-record' },
  });
}

function hefsekView() {
  return screen({
    count: questionCount(),
    title: t('Has the {hefsek} been done since then?'),
    intro: 'If it has, enter its date. If not yet, choose “Not yet”.',
    body: [recordedBox(), noteBox(), dateField(t('Date of the {hefsek}'))],
    back: () => ((last = null), (note = ''), ask('flow')),
    skip: { label: 'Not yet', onclick: () => ask('summary') },
    main: { label: t('Record the {hefsek}'), onclick: e => record(e, 'hefsek'), id: 'sd-record' },
  });
}

function mikvahView() {
  return screen({
    count: questionCount(),
    title: t('Has the {immersion} taken place since then?'),
    intro: 'If it has, enter the date of that evening. If not yet, choose “Not yet”.',
    body: [recordedBox(), noteBox(), dateField(t('The evening of the {immersion}'), 'The date of that evening, as on an ordinary calendar.')],
    back: () => ((last = null), (note = ''), ask('hefsek')),
    skip: { label: 'Not yet', onclick: () => ask('summary') },
    main: { label: t('Record the {immersion}'), onclick: e => record(e, 'mikvah'), id: 'sd-record' },
  });
}

function summaryView() {
  const rows = S.entries.slice(0, 6);
  return screen({
    title: 'Your recent dates',
    body: [
      recordedBox(),
      rows.length
        ? h(
            'ul',
            { class: 'list setup-entries' },
            rows.map(x => h('li', {}, h('span', { class: 'dot ' + x.kind, 'aria-hidden': 'true' }), h('div', { class: 'main' }, h('div', { class: 'title' }, x.text)))),
          )
        : h('p', { class: 'muted' }, 'Nothing has been recorded yet.'),
      h('p', { class: 'muted small' }, 'Earlier ones can be added later from the Log. The intervals become accurate after a few have been recorded. A mistake can be removed in the Log.'),
    ],
    back: () => ((last = null), (note = ''), ask(rows.length ? questionAfterEntriesForBack() : 'flow')),
    main: { label: 'Continue', onclick: next },
  });
}

/** Going back from the list: to the last question that was answered. */
function questionAfterEntriesForBack() {
  const newest = S.entries[0];
  if (!newest) return 'flow';
  if (newest.kind === 'mikvah' || newest.kind === 'hefsek') return 'mikvah';
  return 'hefsek';
}

export function datesView() {
  if (!S.app.place) return noPlaceView();
  if (q === 'hefsek') return hefsekView();
  if (q === 'mikvah') return mikvahView();
  if (q === 'summary') return summaryView();
  return flowView();
}
