/*
 * Recording an event: the step most likely now is one button and one
 * confirmation; any other kind, and any other time, is one choice away.
 * Used on the Today tab and (for past entries) on the Log tab. The server's
 * confirmation sentence is shown in the card; a refusal is shown next to the form.
 */
import { alert, api, button, card, checkRow, h, icon, radioRow, textField } from '../lib.js';
import { S, adopt, go, render, t } from '../store.js';
import { isDone, mark } from './marks.js';
import { attempt, longDate, refresh, region, today } from './shared.js';

const KINDS = ['flow', 'stain', 'hefsek', 'broken', 'mikvah'];

const blank = () => ({ open: false, kind: null, mode: 'now', date: '', how: '', time: '', veset: true, note: '', error: '', fieldError: '', confirm: false });

let rec = blank();
/** The server's sentence after the last entry was recorded. */
let lastMessage = null;

const timed = kind => kind === 'flow' || kind === 'stain' || kind === 'broken';

function kindHelp(kind) {
  switch (kind) {
    case 'flow':
      return t('The start of a period.');
    case 'stain':
      return t('Only when a {rav} has said that it makes her {niddah}.');
    case 'hefsek':
      return t('Done before {sunset}. The {clean_days} begin the night after it.');
    case 'broken':
      return t('When your {rav} says the {clean_days} must start again. A new {hefsek} is then needed.');
    case 'mikvah':
      return t('After she has immersed, on the {mikvah_night}.');
    default:
      return '';
  }
}

function kindMark(kind) {
  if (kind === 'flow' || kind === 'stain') return mark({ kind: 'flow' });
  if (kind === 'broken') return h('span', { class: 'mk broken', 'aria-hidden': 'true' }, '×');
  return mark({ kind }, { number: 1 });
}

const nowLabel = kind => (kind === 'hefsek' ? 'Today' : kind === 'mikvah' ? 'Tonight' : 'Now');

/** Where the household stands, read from the calendar events. */
export function cyclePhase() {
  if (!S.grid) return { phase: 'unknown' };
  const day = S.grid.today;
  const events = S.grid.events;
  const flows = events.filter(e => e.kind === 'flow' && e.startDate <= day);
  if (flows.length === 0) return { phase: 'tehorah' };
  const last = flows[flows.length - 1];
  const after = events.filter(e => e.startDate >= last.startDate);
  if (after.some(e => e.kind === 'mikvah' && isDone(e))) return { phase: 'tehorah' };
  const mikvah = after.find(e => e.kind === 'mikvah' && !isDone(e)) || null;
  const hefsek = after.find(e => e.kind === 'hefsek' && !isDone(e)) || null;
  if (hefsek) return { phase: hefsek.startDate <= day ? 'hefsek_due' : 'waiting', hefsek, mikvah };
  if (mikvah && mikvah.startDate <= day) return { phase: 'mikvah_due', mikvah };
  return { phase: 'counting', mikvah };
}

/** The step most likely to be recorded next, or null. */
function suggestion() {
  const p = cyclePhase();
  if (p.phase === 'tehorah') return { kind: 'flow', label: cap(t('A {flow} began')), line: t('Record it when it happens. Choose "Another time" if it began earlier.') };
  if (p.phase === 'hefsek_due') return { kind: 'hefsek', label: cap(t('{hefsek} done today')), line: t('Record it after the {hefsek} is done, before {sunset}.') };
  if (p.phase === 'mikvah_due') return { kind: 'mikvah', label: cap(t('{immersion} tonight')), line: t('Record it after she has immersed.') };
  return null;
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function choose(kind, opts) {
  const keepDate = rec.mode === 'other' && rec.date;
  rec = { ...blank(), open: true, kind, mode: keepDate ? 'other' : (opts && opts.mode) || 'now', date: keepDate ? rec.date : '', confirm: Boolean(opts && opts.confirm) };
  lastMessage = null;
  refresh('record');
  const target = document.getElementById(rec.confirm ? 'rec-submit' : 'rec-kind-' + kind);
  if (target) target.focus();
}

function close() {
  rec = blank();
  refresh('record');
}

/** Opens the form with this date chosen (from a day of the calendar). */
export function openRecordFor(date) {
  rec = { ...blank(), open: true, mode: 'other', date };
  lastMessage = null;
  refresh('record');
  const el = document.getElementById('record-card');
  if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const first = document.getElementById('rec-kind-flow');
  if (first) first.focus({ preventScroll: true });
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
        rec.error = 'Choose by day, at night, or a time.';
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
  attempt(() => api('POST', '/api/entries', body), {
    button: e.submitter || document.getElementById('rec-submit'),
    done: result => {
      adopt(result.state);
      rec = blank();
      lastMessage = result.message || 'Recorded.';
      render();
      document.getElementById('rec-done')?.focus();
    },
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
  if (kind === 'mikvah') return 'The night that begins at this evening’s nightfall, or the night now.';
  return S.today ? 'It is now ' + (S.today.part === 'night' ? t('night (after {sunset})') : 'day (after sunrise)') + ': ' + S.today.hebrew + '.' : null;
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
  const dateLabel = kind === 'hefsek' ? t('The day the {hefsek} was done') : kind === 'mikvah' ? 'The evening she immersed' : 'Date';
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
                radio('how', 'day', 'By day', t('Between sunrise and {sunset}.')),
                radio('how', 'night', 'At night', t('The night that begins on the evening of this date, after {sunset}. For example, at 9 PM on Monday: choose Monday, at night.')),
                radio('how', 'time', 'At a time I know', 'The calendar works out whether it was day or night.'),
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
  if (rec.confirm && rec.mode === 'now') {
    // The suggested step: one confirmation.
    return h(
      'form',
      { class: 'record-form confirm', onsubmit: submit, novalidate: true },
      h('p', { class: 'confirm-line' }, kindMark(kind), h('span', {}, h('strong', {}, label), ' · ' + nowLabel(kind))),
      h('p', { class: 'help confirm-hint' }, nowText(kind)),
      rec.error ? alert({ kind: 'bad', role: 'alert', className: 'rec-error' }, h('span', { id: 'rec-error', tabindex: '-1' }, rec.error)) : null,
      h(
        'div',
        { class: 'actions' },
        button({ label: 'Record ' + label.toLowerCase(), variant: 'primary', type: 'submit', attrs: { id: 'rec-submit' } }),
        button({
          label: 'Another time',
          attrs: { id: 'rec-other' },
          onclick: () => {
            rec.confirm = false;
            rec.mode = 'other';
            rec.date = today();
            refresh('record');
            document.getElementById('rec-date')?.focus();
          },
        }),
        button({ label: 'Cancel', variant: 'link', attrs: { id: 'rec-cancel' }, onclick: close }),
      ),
    );
  }
  return h(
    'form',
    { class: 'record-form', onsubmit: submit, novalidate: true },
    h('h3', { class: 'form-title' }, kindMark(kind), h('span', {}, label)),
    kind === 'broken' ? h('p', { class: 'help' }, t('A {flow} or {stain} recorded after the {hefsek} cancels the count by itself; this entry is for any other reason your {rav} gives.')) : null,
    whenPart(),
    kind === 'flow'
      ? checkRow({ id: 'rec-veset', label: t('This {flow} counts for the {vesatot}'), help: t('Leave this on unless a {rav} said it does not count.'), checked: rec.veset, onchange: e => (rec.veset = e.target.checked) })
      : null,
    textField({ id: 'rec-note', label: 'Note (optional)', help: 'Only you see it, in the Log.', maxlength: 200, value: rec.note, oninput: e => (rec.note = e.target.value) }),
    rec.error && !rec.fieldError ? alert({ kind: 'bad', role: 'alert', className: 'rec-error' }, h('span', { id: 'rec-error', tabindex: '-1' }, rec.error)) : null,
    h('div', { class: 'actions' }, button({ label: 'Record ' + label.toLowerCase(), variant: 'primary', type: 'submit', attrs: { id: 'rec-submit' } }), button({ label: 'Cancel', attrs: { id: 'rec-cancel' }, onclick: close })),
  );
}

function kindPicker(compact) {
  return h(
    'div',
    { class: 'kinds' + (compact ? ' compact' : ''), role: 'group', 'aria-label': 'What to record' },
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
        kindMark(kind),
        h('span', { class: 'kind-text' }, h('span', { class: 'kind-label' }, S.labels.kinds[kind]), h('span', { class: 'kind-help' }, kindHelp(kind))),
      ),
    ),
  );
}

/**
 * The card. opts.past: the Log's version, which starts closed and records past entries.
 */
export function recordCard(opts) {
  const past = Boolean(opts && opts.past);
  return card(
    { title: past ? 'Add a past entry' : 'Record', icon: past ? 'plus' : null, className: 'record-card', attrs: { id: 'record-card' } },
    region('record', () => {
      const sug = past ? null : suggestion();
      const done = lastMessage
        ? alert(
            { kind: 'ok', className: 'rec-done' },
            h('span', { id: 'rec-done', tabindex: '-1' }, lastMessage),
            past ? null : ' ',
            past ? null : button({ label: 'See it in the Log', variant: 'link', attrs: { id: 'rec-see-log' }, onclick: () => go('log') }),
          )
        : null;
      if (past && !rec.open) {
        return h(
          'div',
          {},
          done,
          h('p', { class: 'help' }, 'For something that happened before you started using this calendar, or that was not recorded at the time.'),
          button({
            label: 'Choose what to add',
            attrs: { id: 'rec-open' },
            onclick: () => {
              rec = { ...blank(), open: true, mode: 'other', date: today() };
              lastMessage = null;
              refresh('record');
              document.getElementById('rec-kind-flow')?.focus();
            },
          }),
        );
      }
      const forDate = rec.open && rec.mode === 'other' && rec.date && !rec.kind;
      const showSug = sug && !forDate;
      return h(
        'div',
        {},
        done,
        forDate ? h('p', { class: 'for-date' }, icon('calendar', { size: 'sm' }), h('span', {}, 'For ' + longDate(rec.date) + '. Choose what to record.')) : null,
        showSug
          ? rec.kind && rec.confirm
            ? form()
            : h('div', { class: 'suggested' }, button({ label: sug.label, variant: 'primary', size: 'lg', block: true, attrs: { id: 'rec-suggested' }, onclick: () => choose(sug.kind, { confirm: true }) }), h('p', { class: 'help' }, sug.line))
          : null,
        h('p', { class: 'kinds-title' }, showSug ? 'Something else' : 'What to record'),
        kindPicker(),
        rec.kind && !rec.confirm ? form() : null,
      );
    }),
  );
}
