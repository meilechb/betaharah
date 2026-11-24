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
import { api, button, configureApi, h, alert, icon, mount, pageLoading, tabs, tabPanel, toast } from './lib.js';
import { P, S, adopt, connect, setPublic, signOutLocally, t } from './store.js';
import { renderAuth, setAuthMessage, showSignIn } from './auth.js';
import { guidedSetupView, needsGuidedSetup } from './onboarding.js';
import { viewToday } from './views/today.js';
import { viewLog } from './views/log.js';
import { viewCustoms } from './views/customs.js';
import { viewSettings } from './views/settings/index.js';
import { demoBanner } from './views/demo.js';
import { captureFocus, captureOpen, fmtDate, hasUnsavedChanges, mayLeave, restoreFocus, restoreOpen, signOut } from './views/shared.js';

const TABS = [
  { id: 'today', label: 'Today', icon: 'calendar', view: viewToday },
  { id: 'log', label: 'Log', icon: 'list', view: viewLog },
  { id: 'customs', label: 'Customs', icon: 'settings', view: viewCustoms },
  { id: 'settings', label: 'Settings', icon: 'user', view: viewSettings },
];
const TAB_IDS = TABS.map(x => x.id);

/** The tab drawn last: a redraw of the same tab keeps the page's height while it is rebuilt. */
let lastDrawn = null;
/** The tab named in the address: the part of the hash before the first "/" ("#settings/phones" is the Settings tab). */
const hashTab = () => location.hash.slice(1).split('/')[0];
let tab = TAB_IDS.includes(hashTab()) ? hashTab() : 'today';

/**
 * The date line: the Hebrew date, day or night, the civil date, and today's sunset.
 * After sunset the Hebrew date is already the next one while the civil date is not:
 * the line then says "The night of ..." and "... evening", so the two do not seem to disagree.
 */
function dateLine() {
  if (!S.today) return null;
  const day = S.grid ? S.grid.days.find(d => d.date === S.grid.today) : null;
  const night = S.today.part === 'night';
  const evening = night && S.today.civilDate && S.today.civilDate !== S.today.date;
  const civil = S.today.civilDate ? fmtDate(S.today.civilDate, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }) : S.today.civil;
  return h(
    'div',
    { class: 'date-line' },
    h('p', { class: 'hebrew', lang: S.terms === 'he' ? 'he' : null }, night ? 'The night of ' + S.today.hebrew : S.today.hebrew),
    h(
      'p',
      { class: 'civil' },
      h('span', { class: 'part' }, icon(night ? 'moon' : 'sun', { size: 'sm' }), night ? 'Night' : 'Day'),
      h('span', {}, evening ? civil + ', evening' : civil),
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
        button({ label: 'Sign out', icon: 'log-out', size: 'sm', className: 'top-signout', attrs: { id: 'top-sign-out' }, onclick: signOutFromHeader }),
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

/** The header's "Sign out": the same as in Settings, after asking about unsaved changes. */
async function signOutFromHeader(e) {
  const btn = e.currentTarget;
  if (!(await mayLeave())) return;
  signOut({ currentTarget: btn });
}

async function go(id) {
  if (id === tab) {
    render();
    return;
  }
  if (!(await mayLeave())) return;
  tab = id;
  // Each tab is a step in the browser's history, so that Back returns to the tab before.
  history.pushState(null, '', '#' + id);
  render();
  window.scrollTo(0, 0);
  const el = document.getElementById('tab-' + id);
  if (el && document.activeElement && document.activeElement.closest && document.activeElement.closest('.tabs')) el.focus();
}

/** The way out of a page that cannot be used. */
const homeLink = () => h('p', { class: 'fatal-home' }, h('a', { href: '/', id: 'fatal-home' }, 'Back to the home page'));

/** Why the page could not be loaded: api() already words it (the server's sentence, or no answer). */
const fatalReason = e => (e && e.message) || 'Something went wrong.';

function showFatal(e) {
  document.body.classList.remove('has-tabbar');
  mount(
    h(
      'div',
      { class: 'card login fatal' },
      h('h2', {}, 'The page could not be loaded'),
      alert({ kind: 'bad', role: 'alert' }, fatalReason(e)),
      h('div', { class: 'actions' }, button({ label: 'Try again', variant: 'primary', icon: 'refresh', attrs: { id: 'fatal-retry' }, onclick: () => restart() })),
      homeLink(),
    ),
  );
}

async function start() {
  mount(pageLoading('Loading…'));
  setPublic(await api('GET', '/api/public'));
  if (!P.configured) {
    document.body.classList.remove('has-tabbar');
    mount(h('div', { class: 'card login fatal' }, h('h2', {}, 'Not set up yet'), h('p', {}, 'This site is not ready to be used yet.'), homeLink()));
    return;
  }
  const params = new URLSearchParams(location.search);
  if (P.signedIn) {
    adopt((await api('GET', '/api/state')).state);
    wasSignedIn = true;
    if (params.get('google_error')) toast(params.get('google_error'), true);
    if (params.get('google') === 'connected') toast('Google Calendar is connected. It fills in within a minute.');
    if (params.get('google') === 'signed-in') toast('You can sign in with Google from now on.');
    if (location.search) history.replaceState(null, '', location.pathname + location.hash);
    render();
    return;
  }
  document.body.classList.remove('has-tabbar');
  const note = NOTES[params.get('note')];
  if (note) {
    setAuthMessage(note);
    params.delete('note');
    history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
  }
  await showSignIn(params);
}

/** Notes the sign-in page can be opened with (/app/?note=...), after a full reload. */
const NOTES = {
  deleted: 'The account was deleted: all dates, settings and phones. You are signed out.',
  left: 'This phone is no longer on the account. You are signed out.',
};

/** Whether this page has shown an account. After signing out, the page is loaded afresh, so that nothing of it stays in memory or on screen. */
let wasSignedIn = false;

const restart = () => {
  if (wasSignedIn && !S) {
    location.replace('/app/');
    return;
  }
  start().catch(showFatal);
};

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
  const next = hashTab() || 'today';
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
