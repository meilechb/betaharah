/*
 * Shared helpers and UI components for the dashboard (and, later, the
 * operator console). Every function builds DOM nodes; nothing here inserts
 * HTML from a string. Styles are in /site.css; docs/UI.md describes each
 * export with an example.
 *
 * This file is frozen: add page-specific helpers to the page's own module.
 * Nothing here knows about the signed-in state (that is store.js).
 */

// ===================== DOM =====================

/**
 * Builds an element.
 *   h('button', { class: 'primary', type: 'submit', onclick: fn }, 'Save')
 * attrs: "class"; "on<event>" functions become listeners; checked, disabled,
 * selected and open are set as properties; value is set as a property; false,
 * null and undefined are skipped (so pass aria-* values as strings); true
 * becomes an empty attribute. Children may be nodes, strings, numbers,
 * nested arrays, or null/false/undefined (skipped). Strings become text.
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') el[k] = Boolean(v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of [children].flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Replaces what #root shows. opts.wide widens the page (1120px) for two-column layouts. */
export function mount(children, opts) {
  const root = document.getElementById('root');
  root.classList.toggle('wide', Boolean(opts && opts.wide));
  root.replaceChildren();
  append(root, children);
  return root;
}

let idCounter = 0;
/** A new unique id with this prefix. Not stable across redraws: give controls a fixed id where focus must survive a redraw. */
export function uid(prefix) {
  idCounter += 1;
  return (prefix || 'id') + '-' + idCounter;
}

/** A string made safe for use inside an id. */
const idPart = value => String(value).replace(/[^A-Za-z0-9_-]/g, '_');

// ===================== small values =====================

export const clone = value => JSON.parse(JSON.stringify(value));
export const cap = text => text.charAt(0).toUpperCase() + text.slice(1);

/** "+17325550123" as "(732) 555-0123"; other numbers unchanged. */
export function pretty(number) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(number || '');
  return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : number || '';
}

// ===================== the API =====================

let apiOptions = { onUnauthorized: null };

/**
 * Sets what happens when the server answers 401.
 * onUnauthorized(path) runs first; if it returns true, api() throws "Please sign in again."
 */
export function configureApi(options) {
  apiOptions = { ...apiOptions, ...options };
}

/** Calls the site's JSON API. Throws an Error with the server's message (and .status) when the answer is not 2xx. */
/** How long a request may take before it is given up. */
export const API_TIMEOUT_MS = 30000;

export async function api(method, path, body) {
  const headers = { 'x-betaharah': '1' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  // A request that has no answer after this long is given up, so that nothing waits for ever.
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), API_TIMEOUT_MS) : null;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', signal: controller ? controller.signal : undefined });
  } catch (e) {
    // No answer at all: the error has no status, so callers can tell it from a refusal.
    const timedOut = controller && controller.signal.aborted;
    throw new Error(
      timedOut
        ? method === 'GET'
          ? 'The site took too long to answer. Check the internet connection and try again.'
          : 'The site took too long to answer, so it is not known whether this was saved. Reload the page to see.'
        : 'The site could not be reached. Check the internet connection and try again.',
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    json = null;
  }
  if (res.status === 401 && apiOptions.onUnauthorized && apiOptions.onUnauthorized(path)) {
    const err = new Error('Please sign in again.');
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const err = new Error((json && json.error) || (res.status >= 500 ? 'The site had a problem (' + res.status + '). Reload the page to see whether anything was saved, then try again.' : 'The request failed (' + res.status + ').'));
    err.status = res.status;
    throw err;
  }
  return json;
}

// ===================== icons =====================

const SVG = 'http://www.w3.org/2000/svg';

/** 24x24 line icons, drawn with stroke. Each is a list of [element, attributes]. */
const ICONS = {
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  close: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
  'chevron-down': [['path', { d: 'm6 9 6 6 6-6' }]],
  'chevron-up': [['path', { d: 'm18 15-6-6-6 6' }]],
  'chevron-left': [['path', { d: 'm15 18-6-6 6-6' }]],
  'chevron-right': [['path', { d: 'm9 18 6-6-6-6' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  calendar: [
    ['rect', { x: 3, y: 4, width: 18, height: 18, rx: 2 }],
    ['path', { d: 'M16 2v4M8 2v4M3 10h18' }],
  ],
  clock: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['path', { d: 'M12 6v6l4 2' }],
  ],
  phone: [
    ['rect', { x: 5, y: 2, width: 14, height: 20, rx: 2 }],
    ['path', { d: 'M11 18h2' }],
  ],
  message: [['path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }]],
  bell: [['path', { d: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0' }]],
  moon: [['path', { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z' }]],
  sun: [
    ['circle', { cx: 12, cy: 12, r: 4 }],
    ['path', { d: 'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41' }],
  ],
  droplet: [['path', { d: 'M12 2.7 17.7 8.4a8 8 0 1 1-11.3 0z' }]],
  settings: [['path', { d: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' }]],
  user: [
    ['path', { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: 12, cy: 7, r: 4 }],
  ],
  lock: [
    ['rect', { x: 3, y: 11, width: 18, height: 11, rx: 2 }],
    ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }],
  ],
  link: [['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }]],
  copy: [
    ['rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }],
    ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }],
  ],
  download: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3' }]],
  trash: [['path', { d: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6' }]],
  info: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['path', { d: 'M12 16v-4M12 8h.01' }],
  ],
  alert: [['path', { d: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01' }]],
  list: [['path', { d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' }]],
  'log-out': [['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9' }]],
  refresh: [['path', { d: 'M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5' }]],
  map: [
    ['path', { d: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z' }],
    ['circle', { cx: 12, cy: 10, r: 3 }],
  ],
};

/** The names icon() accepts. */
export const ICON_NAMES = Object.keys(ICONS);

/**
 * An inline SVG icon. icon('check'), icon('trash', { size: 'sm' }).
 * Decorative (aria-hidden) unless opts.label is given, which makes it an image with that name.
 * size: 'sm' (1em), default (1.25em), 'lg' (2em).
 */
export function icon(name, opts) {
  const o = opts || {};
  const shapes = ICONS[name];
  if (!shapes) throw new Error('no icon named ' + name);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon' + (o.size ? ' ' + o.size : ''));
  svg.setAttribute('focusable', 'false');
  if (o.label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', o.label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  for (const [tag, attrs] of shapes) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}

// ===================== buttons =====================

const VARIANTS = { primary: 'primary', secondary: '', danger: 'danger', 'danger-solid': 'danger-solid', link: 'link' };

function buttonClass(variant, size, block, extra) {
  return [VARIANTS[variant || 'secondary'] || '', size && size !== 'md' ? size : '', block ? 'block' : '', extra || ''].filter(Boolean).join(' ') || null;
}

/**
 * A button.
 *   button({ label: 'Save', variant: 'primary', onclick: e => ... })
 * variant: 'primary' | 'secondary' (default) | 'danger' | 'danger-solid' | 'link'
 * size: 'sm' | 'md' (default) | 'lg'.  icon: an icon name shown before the label.
 * iconOnly: show only the icon (label becomes aria-label).  type: 'button' (default) or 'submit'.
 * busy: start in the busy state.  attrs: any other attributes (id, aria-pressed, ...).
 */
export function button(opts) {
  const o = opts || {};
  const el = h(
    'button',
    {
      type: o.type || 'button',
      class: buttonClass(o.variant, o.size, o.block, (o.iconOnly ? 'icon-only ' : '') + (o.className || '')),
      disabled: o.disabled,
      onclick: o.onclick,
      'aria-label': o.iconOnly ? o.label : null,
      title: o.iconOnly ? o.label : null,
      ...(o.attrs || {}),
    },
    o.icon ? icon(o.icon) : null,
    o.iconOnly ? null : o.label,
  );
  if (o.busy) setBusy(el, true);
  return el;
}

/** A link that looks like a button. linkButton({ href: '/api/export', label: 'Download my data', icon: 'download', download: 'x.json' }) */
export function linkButton(opts) {
  const o = opts || {};
  return h(
    'a',
    { class: 'button' + (buttonClass(o.variant, o.size, o.block, o.className) ? ' ' + buttonClass(o.variant, o.size, o.block, o.className) : ''), href: o.href, download: o.download, ...(o.attrs || {}) },
    o.icon ? icon(o.icon) : null,
    o.label,
  );
}

/**
 * Puts a button in the busy state (disabled, aria-busy, a spinner before the label) or takes it out.
 * The label stays, so screen readers still know which button it is.
 */
export function setBusy(btn, busy) {
  if (!btn) return;
  if (busy) {
    if (btn.getAttribute('aria-busy') === 'true') return;
    btn.dataset.wasDisabled = btn.disabled ? '1' : '';
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.prepend(h('span', { class: 'spinner', 'aria-hidden': 'true' }));
  } else {
    if (btn.getAttribute('aria-busy') !== 'true') return;
    btn.removeAttribute('aria-busy');
    btn.disabled = btn.dataset.wasDisabled === '1';
    const s = btn.querySelector(':scope > .spinner');
    if (s) s.remove();
  }
}

/** Runs fn() with the button busy; the button comes back when fn settles (if it is still on the page). Returns fn's result. */
export async function withBusy(btn, fn) {
  setBusy(btn, true);
  try {
    return await fn();
  } finally {
    if (btn && btn.isConnected) setBusy(btn, false);
  }
}

/** A row of buttons. actions([a, b]) or actions([a, b], { end: true, stack: true }) */
export function actions(children, opts) {
  const o = opts || {};
  return h('div', { class: 'actions' + (o.end ? ' end' : '') + (o.stack ? ' stack' : '') + (o.className ? ' ' + o.className : '') }, children);
}

// ===================== form fields =====================

/**
 * Wraps a control with its label, help and error, and wires them:
 * label[for], aria-describedby (help and error), aria-invalid (when there is an error).
 *   field({ label: 'Name', control: inputEl, help: 'Optional.', error: '' })
 * Returns the .field div; the control is also at .control.
 */
export function field(opts) {
  const o = opts || {};
  const control = o.control;
  if (!control.id) control.id = o.id || uid('f');
  const id = control.id;
  const described = [];
  let helpEl = null;
  let errorEl = null;
  if (o.help) {
    helpEl = h('div', { class: 'help', id: id + '-help' }, o.help);
    described.push(helpEl.id);
  }
  if (o.error) {
    errorEl = h('div', { class: 'error', id: id + '-error' }, icon('alert', { size: 'sm' }), h('span', {}, o.error));
    described.push(errorEl.id);
    control.setAttribute('aria-invalid', 'true');
  }
  if (described.length) control.setAttribute('aria-describedby', described.join(' '));
  const wrap = h('div', { class: 'field' + (o.className ? ' ' + o.className : '') }, h('label', { for: id }, o.label), control, helpEl, errorEl);
  wrap.control = control;
  return wrap;
}

/**
 * Sets or clears the error message of a field built by field()/textField() without redrawing.
 * setFieldError(wrap, 'Type DELETE to confirm.')  setFieldError(wrap, '')
 */
export function setFieldError(wrap, message) {
  const control = wrap.control;
  const id = control.id;
  let errorEl = wrap.querySelector(':scope > .error');
  const ids = (control.getAttribute('aria-describedby') || '').split(' ').filter(x => x && x !== id + '-error');
  if (message) {
    if (!errorEl) {
      errorEl = h('div', { class: 'error', id: id + '-error' }, icon('alert', { size: 'sm' }), h('span'));
      wrap.append(errorEl);
    }
    errorEl.querySelector('span').textContent = message;
    ids.push(errorEl.id);
    control.setAttribute('aria-invalid', 'true');
  } else {
    if (errorEl) errorEl.remove();
    control.removeAttribute('aria-invalid');
  }
  if (ids.length) control.setAttribute('aria-describedby', ids.join(' '));
  else control.removeAttribute('aria-describedby');
}

const WIDE_TYPES = ['text', 'tel', 'password', 'email', 'search'];

/**
 * A labelled text input.
 *   textField({ id: 'number', label: 'Your mobile number', type: 'tel', value, oninput: e => ..., help, error, autocomplete: 'tel' })
 * Any other key is set on the <input>. Text, tel, password and email inputs fill the width unless wide: false.
 */
export function textField(opts) {
  const { label, help, error, wide, className, ...attrs } = opts || {};
  const type = attrs.type || 'text';
  const isWide = wide === undefined ? WIDE_TYPES.includes(type) : wide;
  const input = h('input', { type, ...attrs, class: [attrs.class, isWide ? 'wide' : ''].filter(Boolean).join(' ') || null });
  return field({ label, help, error, control: input, className });
}

/**
 * A labelled select.
 *   selectField({ id: 'style', label: 'Event titles', value: 'words', options: [{ value: 'words', label: 'Words' }], onchange: e => ... })
 */
export function selectField(opts) {
  const { label, help, error, options, value, wide, className, ...attrs } = opts || {};
  const select = h(
    'select',
    { ...attrs, class: wide ? 'wide' : null },
    (options || []).map(op => h('option', { value: op.value, selected: op.selected !== undefined ? op.selected : String(op.value) === String(value) }, op.label)),
  );
  return field({ label, help, error, control: select, className });
}

/** A short control on the same line as its label (number and time inputs). inlineField({ label: 'Minutes before sunset', control: inputEl }) */
export function inlineField(opts) {
  const o = opts || {};
  return h('label', { class: 'row' + (o.className ? ' ' + o.className : '') }, h('span', {}, o.label), o.control);
}

/** A number input on the same line as its label. numberRow({ label, value, onchange: n => ..., min, max, step }) */
export function numberRow(opts) {
  const { label, value, onchange, ...attrs } = opts || {};
  return inlineField({ label, control: h('input', { type: 'number', value, oninput: e => onchange(Number(e.target.value)), ...attrs }) });
}

/**
 * A checkbox with its label; the whole row is the tap target (at least 44px high).
 *   checkRow({ label: 'May record by text message', checked: true, onchange: e => ..., help, disabled, id })
 */
export function checkRow(opts) {
  const o = opts || {};
  return h(
    'label',
    { class: 'choice' + (o.className ? ' ' + o.className : '') },
    h('input', { type: 'checkbox', id: o.id, name: o.name, checked: o.checked, disabled: o.disabled, onchange: o.onchange }),
    h('span', {}, o.label, o.help ? h('span', { class: 'choice-help' }, o.help) : null),
  );
}

/**
 * A radio button with its label. Gets the stable id "r-<name>-<value>" so focus survives a redraw.
 *   radioRow({ name: 'mode', value: 'now', label: 'Now', checked: true, onchange: () => ... })
 */
export function radioRow(opts) {
  const o = opts || {};
  return h(
    'label',
    { class: 'choice' + (o.className ? ' ' + o.className : '') },
    h('input', { type: 'radio', id: o.id || 'r-' + idPart(o.name) + '-' + idPart(o.value), name: o.name, value: String(o.value), checked: o.checked, disabled: o.disabled, onchange: o.onchange }),
    h('span', {}, o.label, o.help ? h('span', { class: 'choice-help' }, o.help) : null),
  );
}

/**
 * A group of radio rows in a fieldset with a legend.
 *   radioGroup({ legend: 'Nightfall', help, name: 'tzeit', value, options: [{ value, label, help }], onchange: value => ... }, ...extra nodes after the options)
 */
export function radioGroup(opts, ...extra) {
  const o = opts || {};
  return h(
    'fieldset',
    { class: o.className || null },
    h('legend', {}, o.legend),
    o.help ? h('div', { class: 'help' }, o.help) : null,
    (o.options || []).map(op => radioRow({ name: o.name, value: op.value, label: op.label, help: op.help, checked: op.checked !== undefined ? op.checked : op.value === o.value, onchange: () => o.onchange(op.value) })),
    extra,
  );
}

/**
 * A segmented toggle: one of a few options, as pressed buttons.
 *   segmented({ label: 'Language of halachic terms', value: 'en', options: [{ value: 'en', label: 'English' }, { value: 'he', label: 'עברית' }], onchange: v => ... })
 */
export function segmented(opts) {
  const o = opts || {};
  return h(
    'div',
    { class: 'toggle segmented', role: 'group', 'aria-label': o.label, id: o.id },
    (o.options || []).map(op => h('button', { type: 'button', id: o.id ? o.id + '-' + idPart(op.value) : null, lang: op.lang, 'aria-pressed': String(op.value === o.value), onclick: () => o.onchange(op.value) }, op.label)),
  );
}

// ===================== cards =====================

/**
 * A card.
 *   card({ title: 'Location', icon: 'map', intro: 'Sunrise ... for this place.' }, ...children)
 *   card({ tag: 'form', title: 'Customs', attrs: { onsubmit: fn } }, ...)
 * headerAction: a node shown at the right of the title.  className: extra classes.
 */
export function card(opts, ...children) {
  const o = opts || {};
  const head = o.title
    ? o.headerAction || o.icon
      ? h('div', { class: 'card-header' }, h('h2', {}, o.icon ? icon(o.icon) : null, o.title), o.headerAction || null)
      : h('h2', {}, o.title)
    : null;
  return h(o.tag || 'section', { class: 'card' + (o.className ? ' ' + o.className : ''), ...(o.attrs || {}) }, head, o.intro ? h('p', { class: 'card-intro' }, o.intro) : null, children);
}

/** A titled part of a card, separated by a line. cardSection({ title: 'Password' }, ...children) */
export function cardSection(opts, ...children) {
  const o = opts || {};
  return h('div', { class: 'card-section' + (o.className ? ' ' + o.className : '') }, o.title ? h('h3', {}, o.title) : null, children);
}

// ===================== alerts and tags =====================

const ALERT_ICONS = { info: 'info', warn: 'alert', ok: 'check', bad: 'alert' };

/**
 * A message box with an icon; colour is never the only signal.
 *   alert({ kind: 'info' }, 'New sign-ups are closed.')
 *   alert({ kind: 'bad', role: 'alert', title: 'Could not save' }, err.message)
 * kind: 'info' | 'warn' (default) | 'ok' | 'bad'.  role: 'alert' for errors that just appeared.
 */
export function alert(opts, ...children) {
  const o = opts || {};
  const kind = o.kind || 'warn';
  return h(
    'div',
    { class: 'alert has-icon' + (kind === 'warn' ? ' warn' : ' ' + kind) + (o.className ? ' ' + o.className : ''), role: o.role || null },
    icon(ALERT_ICONS[kind] || 'info'),
    h('div', { class: 'alert-body' }, o.title ? h('strong', { class: 'alert-title' }, o.title) : null, children),
  );
}

/** A small label. tag('this phone'), tag('not verified', 'warn'). kind: 'info' | 'warn' | 'ok' | 'bad' | none */
export function tag(text, kind) {
  return h('span', { class: 'tag' + (kind ? ' ' + kind : '') }, text);
}

// ===================== tabs =====================

/**
 * A tab bar with arrow-key navigation (Left/Right/Home/End), roving tabindex and aria-selected.
 *   tabs({ label: 'Sections', items: [{ id: 'today', label: 'Today', icon: 'sun' }], current: 'today', onselect: id => ... })
 * Each tab gets the id "<idPrefix>-<id>" (idPrefix defaults to "tab") and controls "<idPrefix>panel".
 * Wrap the content in tabPanel() with the same idPrefix. onselect is expected to redraw.
 */
export function tabs(opts) {
  const o = opts || {};
  const prefix = o.idPrefix || 'tab';
  const ids = o.items.map(i => i.id);
  const nav = h(
    'nav',
    {
      class: 'tabs',
      role: 'tablist',
      'aria-label': o.label,
      onkeydown: e => {
        const at = ids.indexOf(o.current);
        let next = null;
        if (e.key === 'ArrowRight') next = ids[(at + 1) % ids.length];
        else if (e.key === 'ArrowLeft') next = ids[(at - 1 + ids.length) % ids.length];
        else if (e.key === 'Home') next = ids[0];
        else if (e.key === 'End') next = ids[ids.length - 1];
        if (next === null) return;
        e.preventDefault();
        o.onselect(next);
        const el = document.getElementById(prefix + '-' + next);
        if (el) el.focus();
      },
    },
    o.items.map(item => {
      const selected = item.id === o.current;
      return h(
        'button',
        {
          type: 'button',
          role: 'tab',
          id: prefix + '-' + item.id,
          'aria-selected': String(selected),
          'aria-controls': selected ? prefix + 'panel' : null,
          tabindex: selected ? '0' : '-1',
          onclick: () => o.onselect(item.id),
        },
        item.icon ? icon(item.icon) : null,
        item.label,
      );
    }),
  );
  return nav;
}

/** The content under a tab bar. tabPanel({ current: 'today' }, ...children) */
export function tabPanel(opts, ...children) {
  const o = opts || {};
  const prefix = o.idPrefix || 'tab';
  return h('div', { role: 'tabpanel', id: prefix + 'panel', 'aria-labelledby': prefix + '-' + o.current, class: o.className || null }, children);
}

// ===================== toasts =====================

let toastTimer = null;

function toastRegion() {
  let region = document.querySelector('.toasts');
  if (!region) {
    region = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(region);
  }
  return region;
}
// The live region must exist before a message is put in it, or screen readers miss the first one.
if (typeof document !== 'undefined' && document.body) toastRegion();

/**
 * A short message at the bottom of the screen; one at a time; read out politely; dismissible.
 *   toast('Saved.')   toast('Could not save.', true)   toast('Saved.', { timeout: 8000 })
 * Bad messages stay 9 seconds, others 5. Hovering or focusing it keeps it open.
 */
export function toast(message, opts) {
  const o = typeof opts === 'object' && opts !== null ? opts : { bad: Boolean(opts) };
  const timeout = o.timeout || (o.bad ? 9000 : 5000);
  const region = toastRegion();
  region.querySelectorAll('.toast').forEach(el => el.remove());
  document.querySelectorAll('body > .toast').forEach(el => el.remove());
  clearTimeout(toastTimer);
  const remove = () => {
    clearTimeout(toastTimer);
    el.remove();
  };
  const el = h(
    'div',
    { class: 'toast' + (o.bad ? ' bad' : ''), role: o.bad ? 'alert' : null },
    icon(o.bad ? 'alert' : 'check'),
    h('div', { class: 'toast-text' }, message),
    h('button', { type: 'button', 'aria-label': 'Dismiss', title: 'Dismiss', onclick: remove }, icon('close')),
  );
  const arm = () => {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(remove, timeout);
  };
  el.addEventListener('mouseenter', () => clearTimeout(toastTimer));
  el.addEventListener('focusin', () => clearTimeout(toastTimer));
  el.addEventListener('mouseleave', arm);
  el.addEventListener('focusout', arm);
  region.append(el);
  arm();
  return el;
}

// ===================== dialogs =====================

function paragraphs(body) {
  if (body === null || body === undefined) return null;
  if (typeof body !== 'string') return body;
  return body.split(/\n\s*\n|\n/).map(p => h('p', {}, p));
}

/**
 * Opens a modal <dialog>. build(close) returns { content, initialFocus }; close(value) closes it.
 * Escape and a click outside close it with cancelValue. Focus returns to where it was.
 */
function openDialog(opts, build) {
  return new Promise(resolve => {
    const previous = document.activeElement;
    const titleId = uid('dlg-title');
    const bodyId = uid('dlg-body');
    let result = opts.cancelValue;
    const dlg = h('dialog', { class: 'dialog' + (opts.danger ? ' danger' : ''), 'aria-labelledby': titleId, 'aria-describedby': opts.body ? bodyId : null });
    const close = value => {
      result = value;
      if (dlg.open) dlg.close();
    };
    const built = build(close, { titleId, bodyId });
    dlg.append(built.content);
    dlg.addEventListener('cancel', () => {
      result = opts.cancelValue;
    });
    dlg.addEventListener('click', e => {
      if (e.target === dlg) close(opts.cancelValue);
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus();
      resolve(result);
    });
    document.body.append(dlg);
    dlg.showModal();
    if (built.initialFocus) built.initialFocus.focus();
  });
}

function dialogTitle(text, danger, id) {
  return h('h2', { id }, danger ? icon('alert') : null, h('span', {}, text));
}

/**
 * Asks to confirm an action. Replaces confirm().
 *   if (!(await confirmDialog({ title: 'Remove this entry?', body: e.text, confirmLabel: 'Remove', danger: true }))) return;
 * body: a string (lines become paragraphs) or nodes.  Resolves true for confirm, false for cancel, Escape or a click outside.
 * With danger, the confirm button is red and Cancel has the focus.
 */
export function confirmDialog(opts) {
  const o = opts || {};
  if (typeof HTMLDialogElement === 'undefined') return Promise.resolve(window.confirm([o.title, typeof o.body === 'string' ? o.body : ''].filter(Boolean).join('\n\n')));
  return openDialog({ danger: o.danger, body: o.body, cancelValue: false }, (close, ids) => {
    const cancel = button({ label: o.cancelLabel || 'Cancel', onclick: () => close(false) });
    const ok = button({ label: o.confirmLabel || 'Confirm', variant: o.danger ? 'danger-solid' : 'primary', type: 'submit' });
    const form = h(
      'form',
      {
        onsubmit: e => {
          e.preventDefault();
          close(true);
        },
      },
      dialogTitle(o.title, o.danger, ids.titleId),
      o.body ? h('div', { class: 'dialog-body', id: ids.bodyId }, paragraphs(o.body)) : null,
      actions([cancel, ok]),
    );
    return { content: form, initialFocus: o.danger ? cancel : ok };
  });
}

/**
 * Asks for a typed answer. Replaces prompt().
 *   const typed = await promptDialog({ title: 'Delete the account?', body: '...', label: 'Type DELETE to confirm', expect: 'DELETE', confirmLabel: 'Delete my account', danger: true });
 *   if (typed === null) return;   // cancelled
 * With expect, the dialog stays open and shows mismatchMessage until the answer (trimmed) is exactly expect.
 * Resolves the trimmed text, or null when cancelled.
 */
export function promptDialog(opts) {
  const o = opts || {};
  if (typeof HTMLDialogElement === 'undefined') {
    const typed = window.prompt([o.title, typeof o.body === 'string' ? o.body : '', o.label].filter(Boolean).join('\n\n'));
    if (typed === null) return Promise.resolve(null);
    return Promise.resolve(o.expect && typed.trim() !== o.expect ? null : typed.trim());
  }
  return openDialog({ danger: o.danger, body: o.body, cancelValue: null }, (close, ids) => {
    const input = h('input', { type: 'text', autocomplete: 'off', autocapitalize: o.expect ? 'characters' : null, spellcheck: 'false', placeholder: o.placeholder || null, class: 'wide', value: o.value || '' });
    const wrap = field({ label: o.label, control: input, help: o.help, id: uid('dlg-input') });
    input.addEventListener('input', () => setFieldError(wrap, ''));
    const cancel = button({ label: o.cancelLabel || 'Cancel', onclick: () => close(null) });
    const ok = button({ label: o.confirmLabel || 'Confirm', variant: o.danger ? 'danger-solid' : 'primary', type: 'submit' });
    const form = h(
      'form',
      {
        novalidate: true,
        onsubmit: e => {
          e.preventDefault();
          const value = input.value.trim();
          if (o.expect !== undefined && value !== o.expect) {
            setFieldError(wrap, o.mismatchMessage || 'Type ' + o.expect + ' exactly.');
            input.focus();
            return;
          }
          close(value);
        },
      },
      dialogTitle(o.title, o.danger, ids.titleId),
      o.body ? h('div', { class: 'dialog-body', id: ids.bodyId }, paragraphs(o.body)) : null,
      wrap,
      actions([cancel, ok]),
    );
    return { content: form, initialFocus: input };
  });
}

// ===================== copy field =====================

/**
 * A value shown in full with a Copy button beside it.
 *   copyField({ value: link, label: 'Copy' })
 * The value is in a code.copy element (selectable with one click). Copying shows a toast.
 */
export function copyField(opts) {
  const o = opts || {};
  const code = h('code', { class: 'copy' }, o.value);
  const copy = button({
    label: o.label || 'Copy',
    icon: 'copy',
    onclick: () => {
      const fail = () => {
        const range = document.createRange();
        range.selectNodeContents(code);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        toast(o.failMessage || 'Could not copy. Select the address and copy it.', true);
      };
      if (!navigator.clipboard) return fail();
      navigator.clipboard.writeText(o.value).then(() => toast(o.copiedMessage || 'Copied.'), fail);
    },
  });
  return h('div', { class: 'copy-field' }, code, copy);
}

// ===================== loading, empty, progress =====================

/** Grey placeholder lines while something loads. skeleton({ lines: 3, label: 'Loading the calendar' }) */
export function skeleton(opts) {
  const o = opts || {};
  const lines = [];
  for (let i = 0; i < (o.lines || 3); i += 1) lines.push(h('span', { 'aria-hidden': 'true' }));
  return h('div', { class: 'skeleton', role: 'status' }, lines, h('span', { class: 'visually-hidden' }, o.label || 'Loading'));
}

/** A centred spinner with a sentence, for the whole page. pageLoading('Loading…') */
export function pageLoading(message) {
  return h('div', { class: 'page-loading', role: 'status' }, h('span', { class: 'spinner lg', 'aria-hidden': 'true' }), h('p', {}, message || 'Loading…'));
}

/** What a list shows when it has nothing. emptyState({ icon: 'calendar', title: 'Nothing recorded yet.', body, action: buttonEl }) */
export function emptyState(opts) {
  const o = opts || {};
  return h(
    'div',
    { class: 'empty' },
    o.icon ? icon(o.icon, { size: 'lg' }) : null,
    o.title ? h('p', { class: 'empty-title' }, o.title) : null,
    o.body ? h('p', {}, o.body) : null,
    o.action ? actions([o.action]) : null,
  );
}

/**
 * Progress through numbered steps (for the guided setup).
 *   stepper({ label: 'Setup', current: 1, steps: [{ label: 'Location', done: true }, { label: 'Customs' }, { label: 'Dates' }] })
 * current: the index of the step being shown. Shows "Step 2 of 3" above the bar.
 */
export function stepper(opts) {
  const o = opts || {};
  const steps = o.steps || [];
  return h(
    'div',
    { class: 'stepper-wrap' },
    h('p', { class: 'stepper-count' }, 'Step ' + (o.current + 1) + ' of ' + steps.length),
    h(
      'ol',
      { class: 'stepper', 'aria-label': o.label || 'Progress' },
      steps.map((s, i) => {
        const state = i === o.current ? 'current' : s.done ? 'done' : 'todo';
        return h(
          'li',
          { class: state, 'aria-current': state === 'current' ? 'step' : null },
          h('span', { class: 'step-label' }, state === 'done' ? icon('check', { size: 'sm' }) : null, h('span', { class: 'step-name' }, s.label), state === 'done' ? h('span', { class: 'visually-hidden' }, ' (done)') : null),
        );
      }),
    ),
  );
}

// ===================== lists =====================

/** A plain list with dividers. list(rows) where rows are listRow() items. */
export function list(rows, opts) {
  return h('ul', { class: 'list' + (opts && opts.className ? ' ' + opts.className : '') }, rows);
}

/**
 * One row of a list.
 *   listRow({ lead: dotEl, title: 'Flow: ...', meta: 'Recorded on the website · Nov 23', body: noteEl, trail: removeButton })
 * lead: a node at the left (a dot or icon).  trail: nodes at the right (buttons).  className: e.g. 'projected'.
 */
export function listRow(opts) {
  const o = opts || {};
  return h(
    'li',
    { class: o.className || null },
    o.lead || null,
    h('div', { class: 'main' }, o.title !== undefined && o.title !== null ? h('div', { class: 'title' }, o.title) : null, o.meta ? h('div', { class: 'when' }, o.meta) : null, o.body || null),
    o.trail ? h('div', { class: 'trail' }, o.trail) : null,
  );
}
