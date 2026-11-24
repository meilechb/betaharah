/*
 * Pieces used by more than one dashboard view: the alerts, the terms toggle,
 * partial redraws (regions), the guard against leaving unsaved changes, the
 * "save each change as it is made" model of Settings, and civil-date helpers.
 */
import { alert, api, cap, clone, h, icon, segmented, setBusy, toast } from '../lib.js';
import { S, adopt, draft, render, run, saved, t } from '../store.js';

// ---------- alerts ----------

/** The warnings and notes the server sends (S.alerts), each as an alert. Warnings first. */
export function alertsBlock(opts) {
  const o = opts || {};
  const list = S.alerts.filter(a => (o.only ? a.level === o.only : true));
  if (list.length === 0) return null;
  return h(
    'div',
    { class: 'alerts' },
    list.map(a => alert({ kind: a.level === 'info' ? 'info' : 'warn' }, a.text)),
  );
}

// ---------- the terms toggle ----------

/**
 * English letters or Hebrew script for halachic terms; saves at once.
 * keep(): called before the new state is adopted and returns a function that
 * puts back any unsaved draft (the Customs tab keeps its unsaved choices).
 */
export function termsToggle(opts) {
  const o = opts || {};
  const pick = value => {
    if (S.app.terms === value) return;
    const btn = document.getElementById('terms-' + value);
    const restore = o.keep ? o.keep() : null;
    run(
      () => api('PUT', '/api/app', { ...S.app, terms: value }),
      r => {
        adopt(r.state);
        if (restore) restore();
        render();
      },
      btn,
    );
  };
  return h(
    'div',
    { class: 'terms-toggle' },
    h('span', { class: 'terms-label', id: 'terms-label' }, 'Halachic terms in'),
    segmented({
      id: 'terms',
      label: 'Language of halachic terms',
      value: S.app.terms,
      options: [
        { value: 'en', label: 'English' },
        { value: 'he', label: 'עברית', lang: 'he' },
      ],
      onchange: pick,
    }),
  );
}

/** Saves the app settings draft and shows the message. Kept for older callers. */
export function saveApp(message, btn) {
  run(() => api('PUT', '/api/app', draft.app), saved(message || 'Saved.'), btn);
}

// ---------- focus and partial redraws ----------

const TEXTLIKE = /^(text|tel|search|password|email|number|url|date|time)$/;
const noRestore = new Set();

/** Remembers the focused control (by id), and its text and caret when it is a text box. */
export function captureFocus() {
  const a = document.activeElement;
  if (!a || a === document.body || !a.id) return null;
  const keep = { id: a.id };
  if ((a.tagName === 'INPUT' && TEXTLIKE.test(a.type)) || a.tagName === 'TEXTAREA') {
    keep.value = a.value;
    try {
      keep.start = a.selectionStart;
      keep.end = a.selectionEnd;
    } catch (e) {
      keep.start = null;
    }
  }
  return keep;
}

/** The ids of the open <details> inside an element (they are put back open after a redraw). */
export function captureOpen(root) {
  return root ? [...root.querySelectorAll('details[id]')].filter(d => d.open).map(d => d.id) : [];
}
export function restoreOpen(ids) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && el.tagName === 'DETAILS') el.open = true;
  }
}

/** Puts the focus back on the control with the same id; a half-typed value is kept. */
export function restoreFocus(keep) {
  if (!keep) return;
  const el = document.getElementById(keep.id);
  if (!el) return;
  if (keep.value !== undefined && !noRestore.has(keep.id) && 'value' in el && el.value !== keep.value) el.value = keep.value;
  noRestore.clear();
  if (el !== document.activeElement) el.focus({ preventScroll: true });
  if (keep.start !== undefined && keep.start !== null) {
    try {
      el.setSelectionRange(keep.start, keep.end);
    } catch (e) {
      /* not a text box */
    }
  }
}

/** The next redraw should not put back what was typed in this box (it was just sent). */
export function clearOnRedraw(id) {
  noRestore.add(id);
}

const builders = new Map();

/** A part of the page that can be redrawn alone with refresh(id). build() returns one element. */
export function region(id, build) {
  builders.set(id, build);
  const el = build();
  el.id = id;
  return el;
}

/** Redraws one region in place, keeping the focus; falls back to the whole page. */
export function refresh(id) {
  const old = document.getElementById(id);
  const build = builders.get(id);
  if (!old || !build) {
    render();
    return;
  }
  const keep = captureFocus();
  const opened = captureOpen(old);
  const el = build();
  el.id = id;
  old.replaceWith(el);
  restoreOpen(opened);
  restoreFocus(keep);
}

// ---------- leaving with unsaved changes ----------

let leaveGuard = null;

/** guard: { dirty: () => boolean, ask: () => Promise<boolean> } or null. */
export function setLeaveGuard(guard) {
  leaveGuard = guard;
}
export const hasUnsavedChanges = () => Boolean(leaveGuard && leaveGuard.dirty());
/** Asks before leaving when there are unsaved changes. Resolves true when it is all right to leave. */
export async function mayLeave() {
  if (!hasUnsavedChanges()) return true;
  return leaveGuard.ask();
}

// ---------- saving each change as it is made (Settings) ----------

const status = {};
const statusTimers = {};

/** A quiet line beside a card's title: "Saving…", "Saved", or what went wrong. */
export function saveStatus(key) {
  return region('status-' + key, () => {
    const s = status[key] || { state: 'idle' };
    if (s.state === 'saving') return h('span', { class: 'save-status saving', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Saving…');
    if (s.state === 'saved') return h('span', { class: 'save-status saved', role: 'status' }, icon('check', { size: 'sm' }), s.message || 'Saved');
    if (s.state === 'error') return h('span', { class: 'save-status error', role: 'alert' }, icon('alert', { size: 'sm' }), s.message);
    return h('span', { class: 'save-status', role: 'status' });
  });
}

function setStatus(key, state, message) {
  status[key] = { state, message };
  clearTimeout(statusTimers[key]);
  if (state === 'saved') {
    statusTimers[key] = setTimeout(() => {
      status[key] = { state: 'idle' };
      if (document.getElementById('status-' + key)) refresh('status-' + key);
    }, 4000);
  }
}

let queue = Promise.resolve();

/**
 * Runs one save after the ones before it, shows its progress beside the
 * card's title, adopts the answer and redraws. request() returns the API call.
 * Resolves true when it was saved.
 */
export function saveChange(key, request, opts) {
  const o = opts || {};
  setStatus(key, 'saving');
  if (document.getElementById('status-' + key)) refresh('status-' + key);
  const job = queue.then(() => request());
  queue = job.catch(() => undefined);
  return job.then(
    r => {
      if (r && r.state) adopt(r.state);
      setStatus(key, 'saved', o.message);
      if (o.done) o.done(r);
      render();
      return true;
    },
    e => {
      setStatus(key, 'error', (e && e.message) || 'Could not save.');
      render();
      return false;
    },
  );
}

/** Saves a change to the app settings, made on a fresh copy of what the server has. */
export function saveAppChange(key, mutate, opts) {
  return saveChange(
    key,
    () => {
      const next = clone(S.app);
      mutate(next);
      return api('PUT', '/api/app', next);
    },
    opts,
  );
}

// ---------- running an action with its error shown where it happened ----------

/**
 * Runs action() with the button busy. On success calls done(result); on
 * failure calls fail(message) (or shows a toast when there is no fail).
 */
export async function attempt(action, opts) {
  const o = opts || {};
  if (o.button) setBusy(o.button, true);
  try {
    const result = await action();
    if (o.button && o.button.isConnected) setBusy(o.button, false);
    if (o.done) o.done(result);
    return result;
  } catch (e) {
    if (o.button && o.button.isConnected) setBusy(o.button, false);
    const message = (e && e.message) || 'Something went wrong.';
    if (o.fail) o.fail(message, e);
    else toast(message, true);
    return undefined;
  }
}

// ---------- civil dates ('YYYY-MM-DD') ----------

const DAY = 86400000;
export const parseIso = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const isoOf = date => date.toISOString().slice(0, 10);
export const addDays = (iso, n) => isoOf(new Date(parseIso(iso).getTime() + n * DAY));
export const weekdayOf = iso => parseIso(iso).getUTCDay();
export const fmtDate = (iso, opts) => parseIso(iso).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
/** "Monday, November 23" */
export const longDate = iso => fmtDate(iso, { weekday: 'long', month: 'long', day: 'numeric' });
/** "Mon, Nov 23" */
export const shortDate = iso => fmtDate(iso, { weekday: 'short', month: 'short', day: 'numeric' });
export const daysBetween = (a, b) => Math.round((parseIso(b) - parseIso(a)) / DAY);

/** The household's civil date today. */
export function today() {
  if (S.grid) return S.grid.today;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: S.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

/** A term with a capital first letter: term('hefsek') -> 'Hefsek taharah'. */
export const term = key => cap(t('{' + key + '}'));
