/*
 * Settings: the building blocks every section uses, styled in /app/settings.css.
 *
 *   group({ title, intro, footer, id }, ...rows)   a titled list of rows on one surface
 *   navRow({ path, icon, title, summary, flag })   a row that opens a section or sub-view
 *   switchRow({ id, label, help, checked, ... })   an on/off setting (a checkbox with role="switch")
 *   infoRow({ title, value, lead, trail })         a row that only shows something
 *   blockRow(...children)                          a row that holds a form or text
 *   more({ id, summary }, ...children)             a disclosure for the less common options
 *   choiceCards({ name, legend, value, options })  a few large radio choices with examples
 *   errorText(id, message)                         a field's error line
 *   save(key, request, opts)                       saveChange() that also hands back the error message
 */
import { api, h, icon, tag } from '../../lib.js';
import { S } from '../../store.js';
import { saveChange } from '../shared.js';
import { open } from './route.js';

export function group(opts, ...rows) {
  const o = opts || {};
  const titleId = o.id ? o.id + '-title' : null;
  return h(
    'section',
    { class: 'st-group' + (o.className ? ' ' + o.className : ''), id: o.id || null, 'aria-labelledby': o.title && titleId ? titleId : null },
    o.title ? h('h3', { class: 'st-group-title', id: titleId }, o.title) : null,
    o.intro ? h('p', { class: 'st-group-intro' }, o.intro) : null,
    h('div', { class: 'st-rows' }, rows),
    o.footer ? h('p', { class: 'st-group-foot' }, o.footer) : null,
  );
}

/** A flag on a row: { kind: 'warn' | 'bad' | 'info' | 'ok', text }. Colour is never the only signal: it carries a word and an icon. */
export function flagTag(flag) {
  if (!flag) return null;
  return h('span', { class: 'st-flag ' + flag.kind }, icon(flag.kind === 'ok' ? 'check' : flag.kind === 'info' ? 'info' : 'alert', { size: 'sm' }), flag.text);
}

/** A row that opens a section or sub-view; a real link, so its address shows where it leads. */
export function navRow(o) {
  return h(
    'a',
    {
      class: 'st-row st-nav' + (o.current ? ' current' : '') + (o.className ? ' ' + o.className : ''),
      href: '#settings/' + o.path,
      id: o.id || null,
      'aria-current': o.current ? 'page' : null,
      onclick: e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        open(o.path);
      },
    },
    o.icon ? h('span', { class: 'st-lead' + (o.leadKind ? ' ' + o.leadKind : '') }, icon(o.icon)) : null,
    h(
      'span',
      { class: 'st-text' },
      h('span', { class: 'st-title' }, o.title, o.tags ? h('span', { class: 'st-tags' }, o.tags) : null),
      o.summary ? h('span', { class: 'st-summary' }, o.summary) : null,
      o.flag ? flagTag(o.flag) : null,
    ),
    o.value ? h('span', { class: 'st-value' }, o.value) : null,
    h('span', { class: 'st-chev' }, icon('chevron-right')),
  );
}

/** An on/off setting. The whole row is the tap target; the help says what it does or why it cannot be changed. */
export function switchRow(o) {
  const helpId = o.help ? o.id + '-help' : null;
  return h(
    'label',
    { class: 'st-row st-switch-row' + (o.disabled ? ' disabled' : '') + (o.className ? ' ' + o.className : ''), for: o.id },
    o.icon ? h('span', { class: 'st-lead' }, icon(o.icon)) : null,
    h('span', { class: 'st-text' }, h('span', { class: 'st-title' }, o.label), o.help ? h('span', { class: 'st-summary', id: helpId }, o.help) : null, o.extra || null),
    h(
      'span',
      { class: 'st-switch' },
      h('input', {
        type: 'checkbox',
        role: 'switch',
        id: o.id,
        checked: o.checked,
        disabled: o.disabled,
        'aria-describedby': [helpId, o.describedBy].filter(Boolean).join(' ') || null,
        onchange: o.onchange,
      }),
      h('span', { class: 'st-track', 'aria-hidden': 'true' }, h('span', { class: 'st-thumb' })),
    ),
  );
}

export function infoRow(o) {
  return h(
    'div',
    { class: 'st-row st-info' + (o.className ? ' ' + o.className : '') },
    o.icon ? h('span', { class: 'st-lead' + (o.leadKind ? ' ' + o.leadKind : '') }, icon(o.icon)) : null,
    h('span', { class: 'st-text' }, h('span', { class: 'st-title' }, o.title), o.summary ? h('span', { class: 'st-summary' }, o.summary) : null),
    o.value ? h('span', { class: 'st-value' }, o.value) : null,
    o.trail ? h('span', { class: 'st-trail' }, o.trail) : null,
  );
}

export function blockRow(...children) {
  return h('div', { class: 'st-row st-block' }, children);
}

/** A disclosure for options that are rarely needed. Give it an id: it stays open across redraws. */
export function more(o, ...children) {
  return h('details', { class: 'st-more', id: o.id }, h('summary', {}, h('span', {}, o.summary), icon('chevron-down')), h('div', { class: 'st-more-body' }, children));
}

/** A few large radio choices, each with a short explanation and an example. */
export function choiceCards(o) {
  return h(
    'fieldset',
    { class: 'st-choices' },
    h('legend', { class: 'visually-hidden' }, o.legend),
    o.options.map(op =>
      h(
        'label',
        { class: 'st-choice' + (o.value === op.value ? ' chosen' : ''), for: 'r-' + o.name + '-' + op.value },
        h('input', { type: 'radio', name: o.name, id: 'r-' + o.name + '-' + op.value, value: op.value, checked: o.value === op.value, onchange: () => o.onchange(op.value) }),
        h('span', { class: 'st-choice-text' }, h('span', { class: 'st-title' }, op.label), op.help ? h('span', { class: 'st-summary' }, op.help) : null, op.example || null),
      ),
    ),
  );
}

export function errorText(id, message) {
  if (!message) return null;
  return h('div', { class: 'error', id }, icon('alert', { size: 'sm' }), h('span', {}, message));
}

/** A small tag for a phone or a state. */
export const stTag = (text, kind) => tag(text, kind);

/** The last error of each saving key, for an inline message beside the control. */
export const lastError = {};

/**
 * saveChange() from shared.js (one save after another, "Saving…" and "Saved"
 * in the section's header), and the error kept in lastError[key].
 */
export function save(key, request, opts) {
  lastError[key] = '';
  return saveChange(
    key,
    () =>
      request().catch(e => {
        lastError[key] = (e && e.message) || 'Could not save.';
        throw e;
      }),
    opts,
  );
}

/** Saves a change to the app settings, made on a copy of what the server has. */
export function saveApp(key, mutate, opts) {
  return save(
    key,
    () => {
      const next = JSON.parse(JSON.stringify(S.app));
      mutate(next);
      return api('PUT', '/api/app', next);
    },
    opts,
  );
}

/** "2 hours", "1 hour 30 minutes", "45 minutes". */
export function duration(minutes) {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const parts = [];
  if (hh) parts.push(hh + (hh === 1 ? ' hour' : ' hours'));
  if (mm || !hh) parts.push(mm + (mm === 1 ? ' minute' : ' minutes'));
  return parts.join(' ');
}

/** "8:00 AM" from 8 and 0. */
export function clock(hh, mm) {
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return h12 + ':' + String(mm).padStart(2, '0') + ' ' + (hh < 12 ? 'AM' : 'PM');
}

/** Today's sunrise and sunset from the month grid, or null. */
export function sunToday() {
  if (!S.grid) return null;
  const d = S.grid.days.find(x => x.date === S.grid.today);
  return d && (d.sunrise || d.sunset) ? d : null;
}

/**
 * t() as nodes: each halachic term in its own <bdi>, so that a term in Hebrew
 * script keeps its place in an English sentence (next to a colon or a time).
 * capFirst: a capital first letter when the sentence starts with a term in English.
 */
export function tn(template, capFirst) {
  const words = (S && S.words) || {};
  const parts = [];
  let last = 0;
  template.replace(/\{([a-z_]+)\}/g, (whole, key, at) => {
    if (at > last) parts.push(template.slice(last, at));
    let word = words[key] || whole;
    if (capFirst && at === 0) word = word.charAt(0).toUpperCase() + word.slice(1);
    parts.push(S && S.terms === 'he' ? h('bdi', { lang: 'he' }, word) : word);
    last = at + whole.length;
    return whole;
  });
  if (last < template.length) parts.push(template.slice(last));
  if (capFirst && typeof parts[0] === 'string') parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  return parts;
}

/** Joins words as "a, b and c". */
export function andList(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}
