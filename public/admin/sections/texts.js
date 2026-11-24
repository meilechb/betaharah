/*
 * Texts: every text the service sends (the registry, src/app/chat/messages.ts),
 * how each looks on a phone, and the operator's wording of each: its body,
 * the labels of its options, the general words and the options prefix.
 * The server checks every change (GET/PUT/DELETE /api/admin/texts...).
 */
import { alert, button, card, emptyState, h, icon, setFieldError, skeleton, tag, textField, toast } from '/app/lib.js';
import { call, run } from '../state.js';

const GROUPS = ['Sign-up', 'Recording', 'Status', 'Reminders', 'Settings', 'Phones', 'Calendar', 'Carrier words', 'Other'];

let data = null;
let error = '';
let loading = false;
let query = '';
/** The message being edited: { key, body, labels: {id: label}, errors: {field: message} } or null. */
let edit = null;
/** The general words and prefix being edited. */
let words = null;

/** A write that keeps the field the server names in its error ({ error, field }), so the message goes beside that field. */
async function write(method, path, body) {
  const res = await fetch(path, { method, headers: { 'x-betaharah': '1', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((json && json.error) || 'The request failed (' + res.status + ').');
    err.status = res.status;
    err.field = json && json.field;
    throw err;
  }
  return json;
}

const redrawMe = () => window.dispatchEvent(new CustomEvent('admin:section', { detail: 'texts' }));

function adoptTexts(r) {
  data = r;
  words = { lists: Object.fromEntries(r.words.map(w => [w.action, w.words.join(', ')])), prefix: r.prefix, errors: {} };
}

export async function loadTexts(force) {
  if (loading || ((data || error) && !force)) return;
  loading = true;
  try {
    adoptTexts(await call('GET', '/api/admin/texts'));
    error = '';
  } catch (e) {
    error = e.message || 'The texts could not be loaded.';
  } finally {
    loading = false;
    redrawMe();
  }
}

// ---------- making a text, as the server does ----------

const GSM =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ' +
  ' !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§' +
  '¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_SET = new Set(GSM);

const fill = (body, vars) => body.replace(/\{(\w+)\}/g, (_, name) => (Object.hasOwn(vars, name) ? vars[name] : ''));
const examples = m => Object.fromEntries(m.vars.map(v => [v.name, v.example]));
const segments = n => (n <= 160 ? 1 : Math.ceil(n / 153));

/** The text as sent: { sms, body, labels }, from a body and labels. */
function rendered(m, body, labels, prefix) {
  const words = fill(body, examples(m)).trim();
  const shown = m.filed ? [] : m.options.map(o => labels[o.id] || o.label);
  return { sms: shown.length ? words + '\n' + prefix + ' ' + shown.join(', ') : words, body: words, labels: shown };
}

function notGsm(text) {
  for (const ch of text.replace(/\{\w+\}/g, '')) if (!GSM_SET.has(ch)) return ch;
  return null;
}

// ---------- how it looks on a phone ----------

function phone(r, idPrefix) {
  return h(
    'div',
    { class: 'tx-phones' },
    h('div', { class: 'tx-phone', role: 'group', 'aria-label': 'By SMS' }, h('p', { class: 'tx-phone-label' }, 'SMS'), h('div', { class: 'tx-bubble', id: idPrefix + '-sms' }, r.sms)),
    r.labels.length
      ? h(
          'div',
          { class: 'tx-phone', role: 'group', 'aria-label': 'By RCS' },
          h('p', { class: 'tx-phone-label' }, 'RCS'),
          h('div', { class: 'tx-bubble' }, r.body),
          h(
            'div',
            { class: 'tx-chips' },
            r.labels.map(l => h('span', { class: 'tx-chip' }, l)),
          ),
        )
      : null,
  );
}

function count(r, id) {
  const n = r.sms.length;
  const over = n > data.maxChars;
  return h('p', { class: 'tx-count' + (over ? ' over' : ''), id, 'aria-live': 'polite' }, n + ' characters · ' + segments(n) + ' SMS' + (over ? ' · too long' : ''));
}

// ---------- one message ----------

function startEdit(m) {
  edit = { key: m.key, body: m.body, labels: Object.fromEntries(m.options.map(o => [o.id, o.label])), errors: {} };
  redrawMe();
  requestAnimationFrame(() => document.getElementById('tx-body')?.focus());
}

function save(m, btn) {
  const errors = {};
  const ch = notGsm(edit.body);
  if (ch) errors.body = '"' + ch + '" is not in the basic SMS alphabet (GSM-7).';
  edit.errors = errors;
  if (errors.body) return redrawMe();
  run(
    () => write('PUT', '/api/admin/texts/' + encodeURIComponent(m.key), { body: edit.body, labels: edit.labels }),
    r => {
      adoptTexts(r);
      edit = null;
      redrawMe();
      toast('Saved. The next text uses it.');
    },
    btn,
    err => {
      edit.errors = { [err.field || 'body']: err.message };
      redrawMe();
      return true;
    },
  );
}

function reset(m, btn) {
  run(
    () => write('DELETE', '/api/admin/texts/' + encodeURIComponent(m.key)),
    r => {
      adoptTexts(r);
      edit = null;
      redrawMe();
      toast('Back to the original.');
    },
    btn,
  );
}

/** Inserts text at the cursor of the body box. */
function insert(text) {
  const box = document.getElementById('tx-body');
  if (!box) return;
  const start = box.selectionStart ?? box.value.length;
  const end = box.selectionEnd ?? box.value.length;
  edit.body = box.value.slice(0, start) + text + box.value.slice(end);
  box.value = edit.body;
  box.setSelectionRange(start + text.length, start + text.length);
  box.focus();
  livePreview();
}

/** Redraws only the preview and the count while typing (the box keeps its cursor). */
function livePreview() {
  const m = data.messages.find(x => x.key === edit.key);
  const r = rendered(m, edit.body, edit.labels, data.prefix);
  const old = document.getElementById('tx-preview');
  if (old) old.replaceWith(h('div', { id: 'tx-preview' }, phone(r, 'tx-edit'), count(r, 'tx-edit-count')));
}

function editor(m) {
  const r = rendered(m, edit.body, edit.labels, data.prefix);
  const err = edit.errors || {};
  const box = h('textarea', {
    id: 'tx-body',
    rows: 4,
    maxlength: 1000,
    'aria-invalid': err.body ? 'true' : null,
    'aria-describedby': err.body ? 'tx-body-error' : null,
    oninput: e => {
      edit.body = e.target.value;
      livePreview();
    },
  });
  box.value = edit.body;
  return h(
    'form',
    {
      class: 'tx-edit',
      novalidate: true,
      onsubmit: e => {
        e.preventDefault();
        save(m, e.submitter);
      },
    },
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'tx-body' }, 'Text'),
      box,
      err.body ? h('div', { class: 'error', id: 'tx-body-error' }, icon('alert', { size: 'sm' }), h('span', {}, err.body)) : null,
    ),
    m.vars.length
      ? h(
          'div',
          { class: 'tx-vars', role: 'group', 'aria-label': 'Placeholders' },
          m.vars.map(v =>
            button({
              label: '{' + v.name + '}',
              size: 'sm',
              className: 'tx-var' + (v.required ? ' required' : ''),
              attrs: { id: 'tx-var-' + v.name, title: 'Example: ' + (v.example.trim() || '(empty)') + (v.required ? '. Must stay.' : '') },
              onclick: () => insert('{' + v.name + '}'),
            }),
          ),
        )
      : null,
    m.options.length
      ? h(
          'div',
          { class: 'tx-labels' },
          m.options.map(o =>
            textField({
              id: 'tx-label-' + o.id,
              label: 'Option: ' + o.defaultLabel,
              value: edit.labels[o.id] ?? o.label,
              maxlength: 20,
              autocomplete: 'off',
              error: err['label.' + o.id] || '',
              oninput: e => {
                edit.labels[o.id] = e.target.value;
                livePreview();
              },
            }),
          ),
        )
      : null,
    h('div', { id: 'tx-preview' }, phone(r, 'tx-edit'), count(r, 'tx-edit-count')),
    h(
      'div',
      { class: 'actions' },
      button({ label: 'Save', variant: 'primary', type: 'submit', attrs: { id: 'tx-save' } }),
      button({
        label: 'Cancel',
        attrs: { id: 'tx-cancel' },
        onclick: () => {
          edit = null;
          redrawMe();
        },
      }),
      m.changed ? button({ label: 'Reset to the original', variant: 'link', attrs: { id: 'tx-reset' }, onclick: e => reset(m, e.currentTarget) }) : null,
    ),
  );
}

function row(m) {
  const editing = edit && edit.key === m.key;
  const r = rendered(m, m.body, Object.fromEntries(m.options.map(o => [o.id, o.label])), data.prefix);
  return h(
    'li',
    { class: 'tx-row' + (editing ? ' editing' : ''), id: 'tx-' + m.key.replace(/\./g, '-') },
    h(
      'div',
      { class: 'tx-head' },
      h('p', { class: 'tx-when' }, m.when),
      h('span', { class: 'tx-tags' }, m.changed ? tag('changed', 'info') : null, m.filed ? tag('filed', 'warn') : null),
    ),
    m.filed ? h('p', { class: 'small muted tx-filed' }, 'The wording filed with the carrier for the toll-free verification.') : null,
    editing
      ? editor(m)
      : [
          phone(r, 'tx-' + m.key.replace(/\./g, '-')),
          h(
            'div',
            { class: 'tx-foot' },
            count(r, null),
            button({ label: 'Edit', size: 'sm', attrs: { id: 'tx-edit-' + m.key.replace(/\./g, '-'), 'aria-label': 'Edit: ' + m.when }, onclick: () => startEdit(m) }),
          ),
        ],
  );
}

function matches(m, q) {
  if (!q) return true;
  const hay = [m.key, m.when, m.body, m.group, ...m.options.map(o => o.label)].join(' ').toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(w => hay.includes(w));
}

// ---------- the general words ----------

function saveWords(btn) {
  const body = { words: words.lists, prefix: words.prefix };
  run(
    () => write('PUT', '/api/admin/texts-words', body),
    r => {
      adoptTexts(r);
      redrawMe();
      toast('Saved.');
    },
    btn,
    err => {
      words.errors = { [err.field || 'prefix']: err.message };
      redrawMe();
      return true;
    },
  );
}

function wordsCard() {
  const fields = data.words.map(w => {
    const f = textField({
      id: 'tx-words-' + w.action,
      label: w.name,
      value: words.lists[w.action],
      autocomplete: 'off',
      spellcheck: 'false',
      error: words.errors['words.' + w.action] || '',
      oninput: e => {
        words.lists[w.action] = e.target.value;
        if (words.errors['words.' + w.action]) setFieldError(f, '');
      },
    });
    return f;
  });
  const prefix = textField({
    id: 'tx-prefix',
    label: 'Before the options',
    value: words.prefix,
    maxlength: 20,
    autocomplete: 'off',
    error: words.errors.prefix || '',
    help: 'For example: ' + words.prefix + ' PERIOD, HEFSEK, STATUS, MORE',
    oninput: e => {
      words.prefix = e.target.value;
    },
  });
  return card(
    { title: 'Words', icon: 'list', attrs: { id: 'tx-words' }, intro: 'A reply with one of these words does that, at any time. Separate words with commas.' },
    h(
      'form',
      {
        novalidate: true,
        onsubmit: e => {
          e.preventDefault();
          saveWords(e.submitter);
        },
      },
      h('div', { class: 'tx-words' }, fields),
      prefix,
      h('div', { class: 'actions' }, button({ label: 'Save words', variant: 'primary', type: 'submit', attrs: { id: 'tx-words-save' } })),
    ),
  );
}

// ---------- the page ----------

export function textsPage() {
  if (error) return [alert({ kind: 'bad', role: 'alert' }, error), button({ label: 'Try again', onclick: () => loadTexts(true) })];
  if (!data) return [card({ title: 'Texts' }, skeleton({ lines: 6 }))];
  const shown = data.messages.filter(m => matches(m, query));
  const search = textField({
    id: 'tx-search',
    type: 'search',
    label: 'Search',
    value: query,
    autocomplete: 'off',
    oninput: e => {
      query = e.target.value;
      redrawMe();
    },
  });
  const groups = GROUPS.map(g => ({ g, list: shown.filter(m => m.group === g) })).filter(x => x.list.length);
  return [
    h('div', { class: 'tx-top' }, search, h('p', { class: 'small muted', id: 'tx-shown', 'aria-live': 'polite' }, shown.length + ' of ' + data.messages.length + ' texts')),
    groups.length
      ? groups.map(({ g, list }) =>
          card({ title: g, attrs: { id: 'tx-group-' + g.toLowerCase().replace(/[^a-z]+/g, '-') } }, h('ul', { class: 'tx-list' }, list.map(row))),
        )
      : emptyState({ title: 'No text has these words.' }),
    wordsCard(),
  ];
}
