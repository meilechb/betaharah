/*
 * The dashboard's entry point: loads what the site allows, then shows either
 * the sign-in views (auth.js) or the signed-in page with its tab bar.
 * One page, no build step, no outside scripts. Everything shown comes from
 * the server; every change goes through the API and the page is redrawn from
 * the answer. Text from the server is always inserted as text, never as HTML.
 *
 * A redraw keeps the scroll position, the focused control (by id) and what
 * is half-typed in it. Views redraw only their own part where they can
 * (region() and refresh() in views/shared.js).
 *
 * Sentences are English. Halachic terms come from the server in the form the
 * household chose (English letters or Hebrew) and are filled in by t().
 */
import { api, configureApi, h, alert, icon, mount, pageLoading, tabs, tabPanel, toast } from './lib.js';
import { P, S, adopt, connect, setPublic, signOutLocally, t } from './store.js';
import { renderAuth, setAuthMessage, showSignIn } from './auth.js';
import { guidedSetupView, needsGuidedSetup } from './onboarding.js';
import { viewToday } from './views/today.js';
import { viewLog } from './views/log.js';
import { viewCustoms } from './views/customs.js';
import { viewSettings } from './views/settings/index.js';
import { demoBanner } from './views/demo.js';
import { captureFocus, captureOpen, hasUnsavedChanges, mayLeave, restoreFocus, restoreOpen } from './views/shared.js';

const TABS = [
  { id: 'today', label: 'Today', icon: 'calendar', view: viewToday },
  { id: 'log', label: 'Log', icon: 'list', view: viewLog },
  { id: 'customs', label: 'Customs', icon: 'settings', view: viewCustoms },
  { id: 'settings', label: 'Settings', icon: 'user', view: viewSettings },
];
const TAB_IDS = TABS.map(x => x.id);

/** The tab drawn last: a redraw of the same tab keeps the page's height while it is rebuilt. */
let lastDrawn = null;
let tab = TAB_IDS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';

/** The date line: Hebrew date, day or night, civil date; and today's sunset. */
function dateLine() {
  if (!S.today) return null;
  const day = S.grid ? S.grid.days.find(d => d.date === S.grid.today) : null;
  const night = S.today.part === 'night';
  return h(
    'div',
    { class: 'date-line' },
    h('p', { class: 'hebrew', lang: S.terms === 'he' ? 'he' : null }, S.today.hebrew),
    h(
      'p',
      { class: 'civil' },
      h('span', { class: 'part' }, icon(night ? 'moon' : 'sun', { size: 'sm' }), night ? 'Night' : 'Day'),
      h('span', {}, S.today.civil),
      day && day.sunset ? h('span', { class: 'sunset' }, t('{sunset} ') + day.sunset) : null,
    ),
  );
}

/** Draws the signed-in page. Keeps scroll, focus and half-typed input across the redraw. */
function render() {
  if (!S) return;
  if (needsGuidedSetup()) {
    // The guided setup takes the place of the tabs until it is finished or skipped.
    document.body.classList.remove('has-tabbar');
    mount(guidedSetupView(), { wide: false });
    return;
  }
  const keep = captureFocus();
  const root = document.getElementById('root');
  const y = window.scrollY;
  const opened = captureOpen(root);
  // Hold the page's height while it is rebuilt, so the browser does not jump to the top.
  if (lastDrawn === tab) root.style.minHeight = root.offsetHeight + 'px';
  lastDrawn = tab;
  const current = TABS.find(x => x.id === tab);
  document.body.classList.add('has-tabbar');
  mount(
    [
      h(
        'header',
        { class: 'top dash-top' },
        h('h1', {}, h('a', { href: '#today', onclick: e => (e.preventDefault(), go('today')) }, 'Betaharah')),
        dateLine(),
      ),
      demoBanner(),
      tabs({ label: 'Sections', items: TABS, current: tab, onselect: go }),
      tabPanel({ current: tab, className: 'panel panel-' + tab }, current.view()),
    ],
    { wide: true },
  );
  restoreOpen(opened);
  window.scrollTo(0, y);
  restoreFocus(keep);
  requestAnimationFrame(() => {
    root.style.minHeight = '';
  });
}

async function go(id) {
  if (id === tab) {
    render();
    return;
  }
  if (!(await mayLeave())) return;
  tab = id;
  history.replaceState(null, '', '#' + id);
  render();
  window.scrollTo(0, 0);
  const el = document.getElementById('tab-' + id);
  if (el && document.activeElement && document.activeElement.closest && document.activeElement.closest('.tabs')) el.focus();
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
  document.body.classList.remove('has-tabbar');
  await showSignIn(params);
}

const restart = () => start().catch(showFatal);

connect({ render, go, restart, tab: () => tab });

configureApi({
  onUnauthorized: path => {
    if (path.startsWith('/api/auth/')) return false;
    signOutLocally();
    document.body.classList.remove('has-tabbar');
    setAuthMessage('Please sign in again.');
    renderAuth();
    return true;
  },
});

window.addEventListener('hashchange', async () => {
  const next = location.hash.slice(1);
  if (!S || !TAB_IDS.includes(next) || next === tab) return;
  if (!(await mayLeave())) {
    history.replaceState(null, '', '#' + tab);
    return;
  }
  tab = next;
  render();
});

// A warning from the browser before closing or reloading with unsaved changes.
window.addEventListener('beforeunload', e => {
  if (S && hasUnsavedChanges()) {
    e.preventDefault();
    e.returnValue = '';
  }
});


restart();
