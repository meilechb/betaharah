/*
 * The shared state of the signed-in page, and the few actions every view
 * uses. Owned by main.js; views read from here and never keep their own
 * copy of the server state.
 *
 *   P      what the site allows, from /api/public (null until loaded)
 *   S      the server state once signed in (null when signed out); shape: src/app/dashboard.ts
 *   draft  unsaved edits to the settings forms: { halachic, app, phones }
 *
 * These are live bindings: import { S } and read S.x; change them only with
 * setPublic(), adopt() and signOutLocally().
 */
import { clone, toast, withBusy } from './lib.js';

export let P = null;
export let S = null;
export const draft = { halachic: null, app: null, phones: [] };

export function setPublic(value) {
  P = value;
}

/** Takes a new server state; the settings drafts start again from it. */
export function adopt(state) {
  S = state;
  draft.halachic = clone(S.halachic.settings);
  draft.app = clone(S.app);
  draft.phones = clone(S.phones);
}

/** Forgets the signed-in state (after signing out or a 401). */
export function signOutLocally() {
  S = null;
}

// ---------- links to main.js ----------

const hooks = { render: () => undefined, go: () => undefined, restart: () => undefined, tab: () => 'today' };

/** main.js connects its functions here, so views can ask for a redraw without importing main.js. */
export function connect(fns) {
  Object.assign(hooks, fns);
}
/** Redraws the dashboard from S and the drafts. */
export const render = () => hooks.render();
/** Shows another tab: go('settings'). */
export const go = id => hooks.go(id);
/** Starts again from /api/public (after signing out). */
export const restart = () => hooks.restart();
/** The tab being shown. */
export const currentTab = () => hooks.tab();

// ---------- wording ----------

/**
 * Fills {term} places with the household's form of each halachic term.
 * t('The {hefsek} can be done today.') -> 'The hefsek taharah can be done today.' or 'The הפסק טהרה can be done today.'
 */
export function t(template) {
  return template.replace(/\{([a-z_]+)\}/g, (whole, key) => (S && S.words && S.words[key]) || whole);
}

// ---------- running actions ----------

/**
 * Runs an action and shows its error as a toast.
 *   run(() => api('PUT', '/api/app', draft.app), saved('Saved.'), e.currentTarget)
 * The optional button is busy (disabled, with a spinner) while the action runs.
 */
export async function run(action, done, busyButton) {
  try {
    const result = busyButton ? await withBusy(busyButton, action) : await action();
    if (done) done(result);
  } catch (e) {
    if (S) toast(e.message || 'Something went wrong.', true);
  }
}

/** For actions whose answer carries the new state: adopts it, redraws, and shows the message. */
export function saved(message) {
  return result => {
    adopt(result.state);
    render();
    if (message) toast(message);
  };
}

// ---------- dates in the household's time zone ----------

export function todayIso() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: S.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

export function when(ms) {
  try {
    return new Date(ms).toLocaleString('en-US', { timeZone: S.timeZone, dateStyle: 'medium', timeStyle: 'short' });
  } catch (e) {
    return new Date(ms).toLocaleString('en-US');
  }
}
