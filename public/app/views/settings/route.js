/*
 * Settings: which section is open, kept in the address (#settings/phones,
 * #settings/phones/17325550199, #settings/reminders/scheduled).
 *
 * main.js picks the tab from the whole hash and does not know "settings/…".
 * Until it reads only the part before the first "/", this module, which is
 * evaluated before main.js runs, turns "#settings/<path>" into "#settings"
 * (so main.js opens the Settings tab after a reload) and keeps the path; the
 * first draw of Settings puts it back in the address. With main.js reading
 * the first part only, this does nothing.
 *
 * Opening a section adds a history entry, so the browser's Back returns to
 * where you were. The back control in the page goes back the same way when
 * it can, and otherwise replaces the address with the parent.
 */
import { S, currentTab, go, render } from '../../store.js';

const PREFIX = '#settings';

/** A path from an address hash: '#settings/phones/123' -> 'phones/123'; '' for the home; null for another tab. */
function pathOf(hash) {
  if (hash === PREFIX) return '';
  if (hash.startsWith(PREFIX + '/')) return hash.slice(PREFIX.length + 1).replace(/\/+$/, '');
  return null;
}

let pending = null;
{
  const p = typeof location !== 'undefined' ? pathOf(location.hash) : null;
  if (p) {
    pending = p;
    history.replaceState(history.state, '', PREFIX);
  }
}

/** The open path ('' is the settings home). */
export function currentPath() {
  if (pending !== null) return pending;
  const p = pathOf(location.hash);
  return p === null ? '' : p;
}

/** Puts the open path in the address without a new history entry (after the first draw). */
export function settle() {
  if (pending === null) return;
  const p = pending;
  pending = null;
  if (currentTab() === 'settings' && location.hash !== PREFIX + (p ? '/' + p : '')) history.replaceState({ st: p, from: '' }, '', PREFIX + '/' + p);
}

/** Opens a path ('' for the home) with a new history entry. */
export function open(path) {
  const from = currentPath();
  if (path === from) return;
  history.pushState({ st: path, from }, '', PREFIX + (path ? '/' + path : ''));
  render();
}

/** Opens a path in place of the current one (no new history entry). */
export function replace(path) {
  history.replaceState({ st: path, from: (history.state && history.state.from) || '' }, '', PREFIX + (path ? '/' + path : ''));
  render();
}

/** The page's back control: the browser's Back when it leads to the parent, otherwise a replacement. */
export function back(parent) {
  const st = history.state;
  if (st && st.st === currentPath() && st.from === parent) {
    history.back();
    return;
  }
  replace(parent);
}

// The browser's Back and Forward, and a hash typed in the address bar.
window.addEventListener('popstate', () => {
  if (!S) return;
  const p = pathOf(location.hash);
  if (p === null) return;
  pending = null;
  if (currentTab() !== 'settings') {
    // The Settings tab is opened by main.js when it knows the address; otherwise from here.
    // The path is put back in the address by the first draw.
    if (p) pending = p;
    setTimeout(() => {
      // Only while the address still names Settings: she may have gone on (Back, then Forward at once).
      if (pathOf(location.hash) !== null && currentTab() !== 'settings') go('settings');
    }, 60);
    return;
  }
  render();
});
