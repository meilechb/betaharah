/*
 * Texts: every text the service sends (the registry, src/app/chat/messages.ts),
 * listed by category with a short name and when it is sent
 * (src/app/chat/messages-meta.ts), one compact row each. A row opens in
 * place to edit its wording and the labels of its options. "Words people
 * can write" is its own tab. The server checks every change
 * (GET/PUT/DELETE /api/admin/texts...).
 *
 * The address keeps the place: #texts/<category>/<key>?important&changed&q=<words>.
 */
import { alert, button, emptyState, h, icon, skeleton, tag, textField, toast } from '/app/lib.js';
import { call, run } from '../state.js';

let data = null;
let error = '';
let loading = false;

/** What is shown: the category ('all', a category id, or 'words'), the filters, the search, and the open text. */
const view = { cat: 'all', important: true, changed: false, q: '', open: null };
/** The address this page last read or wrote, so that a redraw does not read it again. */
let seenHash = null;
/** The open text being edited: { key, body, labels: {id: label}, errors: {field: message} } or null. */
let edit = null;
/** Sets opened by hand. */
const openSets = new Set();
/** Scroll the open row into view after the next draw (after a reload or Back). */
let scrollToOpen = false;
/** The words being added, by action, and the errors of the words tab. */
const wordDraft = { add: {}, errors: {}, prefix: null };

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

// Coming back by the address (Back, a link, the navigation): read it again.
window.addEventListener('hashchange', () => {
  seenHash = null;
});

export async function loadTexts(force) {
  if (loading || ((data || error) && !force)) return;
  loading = true;
  try {
    data = await call('GET', '/api/admin/texts');
    error = '';
  } catch (e) {
    error = e.message || 'The texts could not be loaded.';
  } finally {
    loading = false;
    redrawMe();
  }
}

// ---------- the address ----------

function readHash() {
  const raw = location.hash.slice(1);
  if (raw === seenHash) return;
  seenHash = raw;
  const rest = raw.startsWith('texts/') ? raw.slice(6) : '';
  if (!rest) {
    Object.assign(view, { cat: 'all', important: true, changed: false, q: '', open: null });
  } else {
    const [path, query] = [rest.split('?')[0], rest.split('?').slice(1).join('?')];
    const [cat, key] = path.split('/').map(decodeURIComponent);
    const params = new URLSearchParams(query);
    Object.assign(view, { cat: cat || 'all', important: params.has('important'), changed: params.has('changed'), q: params.get('q') || '', open: key || null });
  }
  edit = null;
  scrollToOpen = Boolean(view.open);
}

function hashOf() {
  const plain = view.cat === 'all' && view.important && !view.changed && !view.q && !view.open;
  if (plain) return 'texts';
  const params = [];
  if (view.important) params.push('important');
  if (view.changed) params.push('changed');
  if (view.q) params.push('q=' + encodeURIComponent(view.q));
  return 'texts/' + encodeURIComponent(view.cat) + (view.open ? '/' + encodeURIComponent(view.open) : '') + (params.length ? '?' + params.join('&') : '');
}

/** Keeps the place in the address without a new history entry (Back leaves the page, and comes back to the same place). */
function writeHash() {
  const next = hashOf();
  seenHash = next;
  if (location.hash.slice(1) !== next) history.replaceState(null, '', '#' + next);
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
const labelsOf = m => Object.fromEntries(m.options.map(o => [o.id, o.label]));
const idOf = key => key.replace(/\./g, '-');

/** The text as sent: { sms, body, labels }, from a body and labels. */
function rendered(m, body, labels) {
  const words = fill(body, examples(m)).trim();
  const shown = m.filed ? [] : m.options.map(o => labels[o.id] || o.label);
  return { sms: shown.length ? words + '\n' + data.prefix + ' ' + shown.join(', ') : words, body: words, labels: shown };
}

function notGsm(text) {
  for (const ch of text.replace(/\{\w+\}/g, '')) if (!GSM_SET.has(ch)) return ch;
  return null;
}

// ---------- the rows: a text with its other wordings, or a set of texts ----------

/** [{ kind: 'text', main, variants: [m], meta } | { kind: 'set', id, name, sent, members: [text rows], meta }] in the order of the listing. */
function allRows() {
  const byKey = new Map(data.messages.map(m => [m.key, m]));
  const sorted = [...data.messages].sort((a, b) => a.meta.order - b.meta.order);
  const rows = [];
  const textRow = new Map();
  for (const m of sorted) {
    if (m.meta.variantOf && byKey.has(m.meta.variantOf)) continue;
    const row = { kind: 'text', main: m, variants: [], meta: m.meta };
    textRow.set(m.key, row);
    rows.push(row);
  }
  for (const m of sorted) {
    const row = m.meta.variantOf && textRow.get(m.meta.variantOf);
    if (row) row.variants.push(m);
  }
  const out = [];
  const sets = new Map();
  for (const row of rows) {
    const setId = row.meta.set;
    if (!setId || !data.sets[setId]) {
      out.push(row);
      continue;
    }
    let set = sets.get(setId);
    if (!set) {
      set = { kind: 'set', id: setId, name: data.sets[setId].name, sent: data.sets[setId].sent, members: [], meta: row.meta };
      sets.set(setId, set);
      out.push(set);
    }
    set.members.push(row);
  }
  return out;
}

const textsOf = row => (row.kind === 'set' ? row.members.flatMap(textsOf) : [row.main, ...row.variants]);
const isChanged = row => textsOf(row).some(m => m.changed);
const isImportant = row => (row.kind === 'set' ? row.members.some(isImportant) : Boolean(row.meta.important));

function searchable(m) {
  const r = rendered(m, m.body, labelsOf(m));
  return [m.key, m.meta.name, m.meta.sent, r.body, ...r.labels].join(' ').toLowerCase();
}

function matchesQuery(row, q) {
  const wordsOf = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!wordsOf.length) return true;
  const hay = textsOf(row).map(searchable).join(' ') + (row.kind === 'set' ? ' ' + (row.name + ' ' + row.sent).toLowerCase() : '');
  return wordsOf.every(w => hay.includes(w));
}

/** A row cut down to what the filters let through (a set keeps only its members that pass), or null. */
function filtered(row, opts) {
  if (row.kind === 'set') {
    const members = row.members.map(r => filtered(r, opts)).filter(Boolean);
    if (members.length) return { ...row, members };
    return opts.q && matchesQuery(row, opts.q) && !opts.changed && !opts.important ? row : null;
  }
  if (opts.important && !isImportant(row)) return null;
  if (opts.changed && !isChanged(row)) return null;
  if (opts.q && !matchesQuery(row, opts.q)) return null;
  return row;
}

function shownRows(rows, cat, opts) {
  return rows.filter(r => cat === 'all' || r.meta.category === cat).map(r => filtered(r, opts)).filter(Boolean);
}

const countTexts = rows => rows.reduce((n, r) => n + textsOf(r).length, 0);

// ---------- one text: the row ----------

/** The wording as sent, with the options as chips at the end. */
function wording(m, label) {
  const r = rendered(m, m.body, labelsOf(m));
  return h(
    'span',
    { class: 'tx-say' },
    label ? h('span', { class: 'tx-variant' }, label + ':') : null,
    h('span', { class: 'tx-body' }, r.body),
    r.labels.map(l => h('span', { class: 'tx-chip' }, l)),
  );
}

function lengthNote(m) {
  const n = m.length;
  if (n > data.maxChars) return h('span', { class: 'tx-len over' }, n + ' · too long');
  return m.segments > 1 ? h('span', { class: 'tx-len' }, n + ' · ' + m.segments + ' SMS') : null;
}

function tags(texts) {
  return [texts.some(m => m.changed) ? tag('changed', 'info') : null, texts.some(m => m.filed) ? tag('filed with the carrier', 'warn') : null];
}

function mainLabel(row) {
  return row.variants.some(v => v.meta.variant === 'Discreet') ? 'Plain' : 'Usual';
}

function textRow(row) {
  const texts = [row.main, ...row.variants];
  const isOpen = view.open !== null && texts.some(m => m.key === view.open);
  const m = row.main;
  return h(
    'li',
    { class: 'tx-row' + (isOpen ? ' open' : ''), id: 'tx-' + idOf(m.key) },
    h(
      'button',
      {
        type: 'button',
        class: 'tx-sum',
        id: 'tx-open-' + idOf(m.key),
        'aria-expanded': isOpen ? 'true' : 'false',
        onclick: () => (isOpen ? closeEditor(m.key) : openEditor(m.key)),
      },
      h('span', { class: 'tx-head' }, h('span', { class: 'tx-name' }, m.meta.name), tags(texts)),
      h('span', { class: 'tx-sent', title: m.meta.sent }, m.meta.sent),
      h(
        'span',
        { class: 'tx-says' },
        wording(m, row.variants.length ? mainLabel(row) : ''),
        row.variants.map(v => wording(v, v.meta.variant)),
      ),
      h('span', { class: 'tx-lens' }, texts.map(lengthNote)),
    ),
    isOpen ? editor(row) : null,
  );
}

function setRow(row) {
  const expanded = openSets.has(row.id) || Boolean(view.q) || view.changed || row.members.some(r => textsOf(r).some(m => m.key === view.open));
  const texts = textsOf(row);
  return h(
    'li',
    { class: 'tx-row tx-set' + (expanded ? ' expanded' : ''), id: 'tx-set-' + idOf(row.id) },
    h(
      'button',
      {
        type: 'button',
        class: 'tx-sum',
        id: 'tx-open-set-' + idOf(row.id),
        'aria-expanded': expanded ? 'true' : 'false',
        onclick: () => {
          if (expanded) openSets.delete(row.id);
          else openSets.add(row.id);
          if (expanded && view.open && texts.some(m => m.key === view.open)) {
            view.open = null;
            edit = null;
            writeHash();
          }
          redrawMe();
        },
      },
      h('span', { class: 'tx-head' }, h('span', { class: 'tx-name' }, row.name), tag(String(row.members.length)), tags(texts)),
      h('span', { class: 'tx-sent' }, row.sent),
      h('span', { class: 'tx-says' }, h('span', { class: 'tx-say' }, h('span', { class: 'tx-body muted' }, row.members.map(r => r.main.meta.name.replace(/ question$/, '')).join(', ')))),
      h('span', { class: 'tx-lens' }, icon(expanded ? 'chevron-up' : 'chevron-down', { size: 'sm' })),
    ),
    expanded ? h('ul', { class: 'tx-list tx-members' }, row.members.map(textRow)) : null,
  );
}

const rowNode = row => (row.kind === 'set' ? setRow(row) : textRow(row));

// ---------- the editor, in the open row ----------

function messageOf(key) {
  return data.messages.find(x => x.key === key);
}

function openEditor(key) {
  const m = messageOf(key);
  if (!m) return;
  view.open = key;
  edit = { key, body: m.body, labels: labelsOf(m), errors: {} };
  writeHash();
  redrawMe();
  document.getElementById('tx-' + idOf(m.meta.variantOf || key))?.scrollIntoView({ block: 'nearest' });
  document.getElementById('tx-body')?.focus({ preventScroll: true });
}

function closeEditor(key) {
  const m = messageOf(key || view.open);
  view.open = null;
  edit = null;
  writeHash();
  redrawMe();
  if (m) document.getElementById('tx-open-' + idOf(m.meta.variantOf || m.key))?.focus();
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
      data = r;
      toast('Saved. The next text uses it.');
      closeEditor(m.key);
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
      data = r;
      toast('Back to the original.');
      closeEditor(m.key);
    },
    btn,
  );
}

/** Inserts text at the cursor of the wording box. */
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

function phones(r) {
  return h(
    'div',
    { class: 'tx-phones' },
    h('div', { class: 'tx-phone', role: 'group', 'aria-label': 'By SMS' }, h('p', { class: 'tx-phone-label' }, 'SMS'), h('div', { class: 'tx-bubble', id: 'tx-edit-sms' }, r.sms)),
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

function count(r) {
  const n = r.sms.length;
  const over = n > data.maxChars;
  return h('p', { class: 'tx-count' + (over ? ' over' : ''), id: 'tx-edit-count', 'aria-live': 'polite' }, n + ' characters · ' + segments(n) + ' SMS' + (over ? ' · too long' : ''));
}

function preview(m) {
  const r = rendered(m, edit.body, edit.labels);
  return h('div', { id: 'tx-preview' }, phones(r), count(r));
}

/** Redraws only the preview and the count while typing (the box keeps its cursor). */
function livePreview() {
  const old = document.getElementById('tx-preview');
  if (old) old.replaceWith(preview(messageOf(edit.key)));
}

function editor(row) {
  const m = messageOf(view.open);
  if (!edit || edit.key !== m.key) edit = { key: m.key, body: m.body, labels: labelsOf(m), errors: {} };
  const err = edit.errors || {};
  const box = h('textarea', {
    id: 'tx-body',
    rows: 3,
    maxlength: 1000,
    'aria-invalid': err.body ? 'true' : null,
    'aria-describedby': err.body ? 'tx-body-error' : null,
    oninput: e => {
      edit.body = e.target.value;
      livePreview();
    },
  });
  box.value = edit.body;
  const texts = [row.main, ...row.variants];
  return h(
    'form',
    {
      class: 'tx-edit',
      novalidate: true,
      onsubmit: e => {
        e.preventDefault();
        save(m, e.submitter);
      },
      onkeydown: e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeEditor(m.key);
        }
      },
    },
    texts.length > 1
      ? h(
          'div',
          { class: 'tx-wordings', role: 'group', 'aria-label': 'Wording' },
          texts.map(t =>
            button({
              label: t === row.main ? mainLabel(row) : t.meta.variant,
              size: 'sm',
              attrs: { id: 'tx-wording-' + idOf(t.key), 'aria-pressed': t.key === m.key ? 'true' : 'false' },
              onclick: () => openEditor(t.key),
            }),
          ),
        )
      : null,
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'tx-body' }, 'Wording'),
      box,
      err.body ? h('div', { class: 'error', id: 'tx-body-error' }, icon('alert', { size: 'sm' }), h('span', {}, err.body)) : null,
    ),
    m.vars.length
      ? h(
          'div',
          { class: 'tx-vars', role: 'group', 'aria-label': 'Placeholders: insert' },
          m.vars.map(v =>
            h(
              'button',
              {
                type: 'button',
                class: 'tx-var' + (v.required ? ' required' : ''),
                id: 'tx-var-' + v.name,
                title: v.required ? 'Must stay in the text' : 'May be left out',
                onclick: () => insert('{' + v.name + '}'),
              },
              h('span', { class: 'tx-var-name' }, '{' + v.name + '}'),
              h('span', { class: 'tx-var-example' }, v.example.trim() || '(empty)'),
            ),
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
              label: 'Option ' + o.defaultLabel,
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
    preview(m),
    h(
      'div',
      { class: 'actions' },
      button({ label: 'Save', variant: 'primary', type: 'submit', attrs: { id: 'tx-save' } }),
      button({ label: 'Cancel', attrs: { id: 'tx-cancel' }, onclick: () => closeEditor(m.key) }),
      m.changed ? button({ label: 'Reset to the original', variant: 'link', attrs: { id: 'tx-reset' }, onclick: e => reset(m, e.currentTarget) }) : null,
    ),
  );
}

// ---------- words people can write ----------

function saveWords(action, list, btn) {
  run(
    () => write('PUT', '/api/admin/texts-words', { words: { [action]: list } }),
    r => {
      data = r;
      wordDraft.add[action] = '';
      wordDraft.errors = {};
      redrawMe();
      toast('Saved.');
      document.getElementById('tx-add-' + action)?.focus();
    },
    btn,
    err => {
      wordDraft.errors = { [err.field || 'words.' + action]: err.message };
      redrawMe();
      return true;
    },
  );
}

function savePrefix(btn) {
  run(
    () => write('PUT', '/api/admin/texts-words', { prefix: wordDraft.prefix ?? data.prefix }),
    r => {
      data = r;
      wordDraft.prefix = null;
      wordDraft.errors = {};
      redrawMe();
      toast('Saved.');
    },
    btn,
    err => {
      wordDraft.errors = { [err.field || 'prefix']: err.message };
      redrawMe();
      return true;
    },
  );
}

function wordLine(w) {
  const errorText = wordDraft.errors['words.' + w.action];
  const changed = w.words.join(',') !== w.defaults.join(',');
  return h(
    'li',
    { class: 'tx-wline', id: 'tx-words-' + w.action },
    h('span', { class: 'tx-wname' }, w.name, changed ? tag('changed', 'info') : null),
    h(
      'form',
      {
        class: 'tx-wchips',
        novalidate: true,
        onsubmit: e => {
          e.preventDefault();
          const add = (wordDraft.add[w.action] || '').trim().toLowerCase();
          if (add) saveWords(w.action, [...w.words, ...add.split(',').map(x => x.trim()).filter(Boolean)], e.submitter);
        },
      },
      w.words.map(word =>
        h(
          'span',
          { class: 'tx-wchip' },
          word,
          h(
            'button',
            {
              type: 'button',
              class: 'tx-wremove',
              id: 'tx-remove-' + w.action + '-' + word.replace(/[^a-z0-9]/g, '_'),
              'aria-label': 'Remove ' + word,
              title: 'Remove',
              disabled: w.words.length === 1,
              onclick: e => saveWords(w.action, w.words.filter(x => x !== word), e.currentTarget),
            },
            icon('close', { size: 'sm' }),
          ),
        ),
      ),
      h('label', { for: 'tx-add-' + w.action, class: 'visually-hidden' }, 'Add a word for ' + w.name),
      h('input', {
        id: 'tx-add-' + w.action,
        class: 'tx-wadd',
        type: 'text',
        placeholder: 'add',
        autocomplete: 'off',
        spellcheck: 'false',
        maxlength: 30,
        value: wordDraft.add[w.action] || '',
        'aria-invalid': errorText ? 'true' : null,
        'aria-describedby': errorText ? 'tx-words-' + w.action + '-error' : null,
        oninput: e => {
          wordDraft.add[w.action] = e.target.value;
        },
      }),
      button({ label: 'Add', size: 'sm', type: 'submit', attrs: { id: 'tx-add-btn-' + w.action } }),
      changed ? button({ label: 'Reset', variant: 'link', attrs: { id: 'tx-wreset-' + w.action }, onclick: e => saveWords(w.action, w.defaults, e.currentTarget) }) : null,
    ),
    errorText ? h('div', { class: 'error', id: 'tx-words-' + w.action + '-error' }, icon('alert', { size: 'sm' }), h('span', {}, errorText)) : null,
  );
}

function wordsPanel() {
  const prefix = textField({
    id: 'tx-prefix',
    label: 'Before the options',
    value: wordDraft.prefix ?? data.prefix,
    maxlength: 20,
    autocomplete: 'off',
    wide: false,
    error: wordDraft.errors.prefix || '',
    oninput: e => {
      wordDraft.prefix = e.target.value;
    },
  });
  return h(
    'section',
    { id: 'tx-words', 'aria-labelledby': 'tx-words-title' },
    h('h2', { id: 'tx-words-title', class: 'tx-cat-head' }, 'Words people can write'),
    h('p', { class: 'small muted tx-words-intro' }, 'A reply with one of these words does that, at any time.'),
    h('ul', { class: 'tx-wlist' }, data.words.map(wordLine)),
    h(
      'form',
      {
        class: 'tx-prefix',
        novalidate: true,
        onsubmit: e => {
          e.preventDefault();
          savePrefix(e.submitter);
        },
      },
      prefix,
      button({ label: 'Save', size: 'sm', type: 'submit', attrs: { id: 'tx-prefix-save' } }),
    ),
  );
}

// ---------- the page ----------

function setFilter(change) {
  Object.assign(view, change);
  // the short list of important texts is where the page starts; choosing anything else shows all that it has
  if ('cat' in change || ('changed' in change && change.changed) || ('q' in change && change.q)) {
    if (!('important' in change)) view.important = false;
  }
  if (view.open) {
    const visible = view.cat !== 'words' && shownRows(allRows(), view.cat, view).some(r => textsOf(r).some(m => m.key === view.open));
    if (!visible) {
      view.open = null;
      edit = null;
    }
  }
  writeHash();
  redrawMe();
}

function catButton(id, name, n) {
  return h(
    'li',
    {},
    h(
      'button',
      { type: 'button', class: 'tx-cat', id: 'tx-cat-' + id, 'aria-pressed': view.cat === id ? 'true' : 'false', onclick: () => setFilter({ cat: id }) },
      h('span', { class: 'tx-cat-name' }, name),
      n === null ? null : h('span', { class: 'tx-cat-count' }, String(n)),
    ),
  );
}

function categoryNav(rows) {
  const opts = { important: false, changed: view.changed, q: view.q };
  return h(
    'nav',
    { class: 'tx-cats', 'aria-label': 'Categories' },
    h(
      'ul',
      {},
      catButton('all', 'All', countTexts(shownRows(rows, 'all', opts))),
      data.categories.map(c => {
        const n = countTexts(shownRows(rows, c.id, { important: false, changed: false, q: '' }));
        return n ? catButton(c.id, c.name, countTexts(shownRows(rows, c.id, opts))) : null;
      }),
      catButton('words', 'Words people can write', null),
    ),
  );
}

function toolbar(rows) {
  const n = countTexts(shownRows(rows, view.cat, view));
  const toggle = (id, label, on, change) =>
    button({ label, size: 'sm', className: 'tx-toggle', icon: on ? 'check' : null, attrs: { id, 'aria-pressed': on ? 'true' : 'false' }, onclick: () => setFilter(change) });
  return h(
    'div',
    { class: 'tx-top' },
    h(
      'div',
      { class: 'tx-search' },
      h('label', { for: 'tx-search', class: 'visually-hidden' }, 'Search the texts'),
      h('input', {
        id: 'tx-search',
        type: 'search',
        placeholder: 'Search',
        autocomplete: 'off',
        value: view.q,
        oninput: e => setFilter({ q: e.target.value }),
      }),
    ),
    toggle('tx-important', 'Important', view.important, { important: !view.important }),
    toggle('tx-changed', 'Changed', view.changed, { changed: !view.changed }),
    h('p', { class: 'small muted', id: 'tx-shown', 'aria-live': 'polite' }, n + ' of ' + data.messages.length),
  );
}

function listing(rows) {
  const shown = shownRows(rows, view.cat, view);
  if (!shown.length) return emptyState({ title: view.changed && !view.q ? 'No text is changed here.' : 'No text matches.' });
  const cats = view.cat === 'all' ? data.categories : data.categories.filter(c => c.id === view.cat);
  return cats.map(c => {
    const inCat = shown.filter(r => r.meta.category === c.id);
    if (!inCat.length) return null;
    const subs = [...new Set(inCat.map(r => r.meta.sub || ''))];
    return h(
      'section',
      { class: 'tx-group', id: 'tx-group-' + c.id, 'aria-labelledby': 'tx-head-' + c.id },
      h('h2', { class: 'tx-cat-head', id: 'tx-head-' + c.id }, c.name),
      subs.map(s => [s ? h('h3', { class: 'tx-sub-head' }, s) : null, h('ul', { class: 'tx-list' }, inCat.filter(r => (r.meta.sub || '') === s).map(rowNode))]),
    );
  });
}

export function textsPage() {
  if (error) return [alert({ kind: 'bad', role: 'alert' }, error), button({ label: 'Try again', onclick: () => loadTexts(true) })];
  readHash();
  if (!data) return [skeleton({ lines: 8 })];
  const rows = allRows();
  if (view.open && !messageOf(view.open)) view.open = null;
  if (scrollToOpen && view.open) {
    scrollToOpen = false;
    const m = messageOf(view.open);
    requestAnimationFrame(() => document.getElementById('tx-' + idOf(m.meta.variantOf || m.key))?.scrollIntoView({ block: 'center' }));
  }
  // on a phone the categories scroll sideways on their own: keep the chosen one in sight
  requestAnimationFrame(() => {
    const b = document.querySelector('.tx-cat[aria-pressed="true"]');
    const ul = b && b.closest('ul');
    if (!ul || ul.scrollWidth <= ul.clientWidth) return;
    if (b.offsetLeft < ul.scrollLeft || b.offsetLeft + b.offsetWidth > ul.scrollLeft + ul.clientWidth) ul.scrollLeft = b.offsetLeft - ul.offsetLeft - 8;
  });
  return h(
    'div',
    { class: 'tx-layout' },
    categoryNav(rows),
    h('div', { class: 'tx-main' }, view.cat === 'words' ? wordsPanel() : [toolbar(rows), listing(rows)]),
  );
}
