/*
 * The dashboard's entry point: loads what the site allows, then shows either
 * the sign-in views (auth.js) or the signed-in page with its tab bar.
 * One page, no build step, no outside scripts. Everything shown comes from
 * the server; every change goes through the API and the page is redrawn from
 * the answer. Text from the server is always inserted as text, never as HTML.
 *
 * Sentences are English. Halachic terms come from the server in the form the
 * household chose (English letters or Hebrew) and are filled in by t().
 */
import { api, configureApi, h, alert, mount, pageLoading, tabs, tabPanel, toast } from './lib.js';
import { P, S, adopt, connect, setPublic, signOutLocally } from './store.js';
import { renderAuth, setAuthMessage, showSignIn } from './auth.js';
import { viewToday } from './views/today.js';
import { viewLog } from './views/log.js';
import { viewCustoms } from './views/customs.js';
import { viewSettings } from './views/settings/index.js';

const TABS = [
  { id: 'today', label: 'Today', icon: 'calendar', view: viewToday },
  { id: 'log', label: 'Log', icon: 'list', view: viewLog },
  { id: 'customs', label: 'Customs', icon: 'settings', view: viewCustoms },
  { id: 'settings', label: 'Settings', icon: 'user', view: viewSettings },
];
const TAB_IDS = TABS.map(x => x.id);

let tab = TAB_IDS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';

/** Draws the signed-in page. Keeps the focus on the same control (by id) across the redraw. */
function render() {
  if (!S) return;
  const active = document.activeElement;
  const focusId = active && active !== document.body && active.id ? active.id : null;
  const current = TABS.find(x => x.id === tab);
  mount(
    [
      h('header', { class: 'top' }, h('h1', {}, 'Betaharah'), S.today ? h('div', { class: 'today' }, S.today.hebrew + ' · ' + S.today.part + ' · ' + S.today.civil) : null),
      tabs({ label: 'Sections', items: TABS, current: tab, onselect: go }),
      tabPanel({ current: tab }, current.view()),
    ],
    { wide: true },
  );
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el && el !== document.activeElement) el.focus({ preventScroll: true });
  }
}

function go(id) {
  const changed = id !== tab;
  tab = id;
  history.replaceState(null, '', '#' + id);
  render();
  if (changed) window.scrollTo(0, 0);
}

function showFatal(e) {
  mount(h('div', { class: 'card login' }, h('h2', {}, 'Could not load'), alert({ kind: 'bad' }, (e && e.message) || 'Unknown error')));
}

async function start() {
  mount(pageLoading('Loading…'));
  setPublic(await api('GET', '/api/public'));
  if (!P.configured) {
    mount(h('div', { class: 'card login' }, h('h2', {}, 'Not set up yet'), h('p', {}, 'This site is not ready to be used yet.')));
    return;
  }
  const params = new URLSearchParams(location.search);
  if (P.signedIn) {
    adopt((await api('GET', '/api/state')).state);
    if (params.get('google_error')) toast(params.get('google_error'), true);
    if (params.get('google') === 'connected') toast('Google Calendar is connected. It fills in within a minute.');
    if (location.search) history.replaceState(null, '', location.pathname + location.hash);
    render();
    return;
  }
  await showSignIn(params);
}

const restart = () => start().catch(showFatal);

connect({ render, go, restart, tab: () => tab });

configureApi({
  onUnauthorized: path => {
    if (path.startsWith('/api/auth/')) return false;
    signOutLocally();
    setAuthMessage('Please sign in again.');
    renderAuth();
    return true;
  },
});

window.addEventListener('hashchange', () => {
  const next = location.hash.slice(1);
  if (S && TAB_IDS.includes(next) && next !== tab) {
    tab = next;
    render();
  }
});

restart();
