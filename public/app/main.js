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
import { api, button, configureApi, h, alert, mount, pageLoading, toast } from './lib.js';
import { P, S, adopt, connect, setPublic, signOutLocally } from './store.js';
import { renderAuth, setAuthMessage, showSignIn } from './auth.js';
import { guidedSetupView, needsGuidedSetup } from './onboarding.js';
import { viewComing, viewHome, viewTexting, viewTry } from './views/today.js';
import { viewLog } from './views/log.js';
import { viewCustoms } from './views/customs.js';
import { viewSettings } from './views/settings/index.js';
import { recordPage } from './views/record.js';
import { openSheet } from './views/sheet.js';
import { captureFocus, captureOpen, hasUnsavedChanges, mayLeave, restoreFocus, restoreOpen, signOut } from './views/shared.js';

/**
 * The pages. The home ('today', the calendar) has nothing but the month; the
 * others are opened from the menu, each with a way back to the calendar.
 * 'record' (the full form) is opened from the day sheet, not from the menu.
 */
const PAGES = [
  { id: 'today', label: 'Calendar', view: viewHome },
  { id: 'coming', label: 'Coming up', view: viewComing },
  { id: 'log', label: 'Log', view: viewLog },
  { id: 'customs', label: 'Customs', view: viewCustoms },
  { id: 'settings', label: 'Settings', view: viewSettings },
  { id: 'texting', label: 'Texting', view: viewTexting },
  { id: 'try', label: 'Try a text', view: viewTry, demo: true },
  { id: 'record', label: 'Record', view: recordPage, hidden: true },
];
const PAGE_IDS = PAGES.map(x => x.id);

/** The page drawn last: a redraw of the same page keeps its height while it is rebuilt. */
let lastDrawn = null;
/** The page named in the address: the part of the hash before the first "/" ("#settings/phones" is Settings). An empty hash and "#calendar" are the calendar. */
function hashPage() {
  const id = location.hash.slice(1).split('/')[0];
  if (id === '' || id === 'calendar') return 'today';
  return PAGE_IDS.includes(id) ? id : null;
}
let tab = hashPage() || 'today';
/** A page that exists only for the test account falls back to the calendar. */
const usable = id => {
  const p = PAGES.find(x => x.id === id);
  return Boolean(p && (!p.demo || (S && S.demo)));
};

/** The menu icon: three lines (lib.js has none). */
function menuIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M4 6h16M4 12h16M4 18h16');
  svg.append(path);
  return svg;
}

const alertCount = () => (S && S.alerts ? S.alerts.length : 0);
const countLabel = n => n + (n === 1 ? ' alert' : ' alerts');

/** The header: the mark and name (home), a tag on the test account, and Menu. */
function header() {
  const n = alertCount();
  return h(
    'header',
    { class: 'top dash-top' },
    h(
      'div',
      { class: 'brand-row' },
      h('h1', {}, h('a', { class: 'brand', id: 'home-link', href: '#today', onclick: e => (e.preventDefault(), go('today')) }, h('img', { class: 'mark', src: '/favicon.svg', width: '28', height: '28', alt: '' }), 'Betaharah')),
      S.demo ? h('span', { class: 'tag info demo-tag', id: 'demo-tag' }, 'Test account') : null,
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn menu-button',
        id: 'menu-button',
        'aria-haspopup': 'dialog',
        'aria-label': n ? 'Menu, ' + countLabel(n) : 'Menu',
        onclick: openMenu,
      },
      menuIcon(),
      h('span', {}, 'Menu'),
      n ? h('span', { class: 'menu-count', 'aria-hidden': 'true' }, String(n)) : null,
    ),
  );
}

/** The menu: every page, Help and Sign out; a sheet on a phone, a list under the button on a wide screen. */
function openMenu() {
  let after = null;
  const n = alertCount();
  openSheet({
    id: 'menu',
    title: 'Menu',
    className: 'menu-sheet',
    focus: 'menu-' + tab,
    onclose: () => {
      if (after) after();
      else document.getElementById('menu-button')?.focus();
    },
    body: close => {
      const item = p =>
        h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              class: 'menu-item',
              id: 'menu-' + p.id,
              'aria-current': p.id === tab ? 'page' : null,
              onclick: () => {
                after = () => go(p.id, { focusPage: true });
                close();
              },
            },
            h('span', {}, p.label),
            p.id === 'coming' && n ? h('span', { class: 'menu-count' }, h('span', { 'aria-hidden': 'true' }, String(n)), h('span', { class: 'visually-hidden' }, ', ' + countLabel(n))) : null,
          ),
        );
      return h(
        'nav',
        { 'aria-label': 'Pages' },
        h(
          'ul',
          { class: 'menu-list' },
          PAGES.filter(p => !p.hidden && usable(p.id)).map(item),
          h('li', {}, h('a', { class: 'menu-item', id: 'menu-help', href: '/help' }, 'Help')),
          h(
            'li',
            { class: 'menu-out' },
            button({
              label: 'Sign out',
              icon: 'log-out',
              className: 'menu-item',
              attrs: { id: 'menu-sign-out' },
              onclick: () => {
                after = () => signOutFromMenu();
                close();
              },
            }),
          ),
        ),
      );
    },
  });
}

/** Draws the signed-in page. Keeps scroll, focus and half-typed input across the redraw. */
function render() {
  if (!S) return;
  if (needsGuidedSetup()) {
    // The guided setup takes the place of the pages until it is finished or skipped.
    mount(guidedSetupView(), { wide: false });
    return;
  }
  if (!usable(tab)) tab = 'today';
  const keep = captureFocus();
  const root = document.getElementById('root');
  const y = window.scrollY;
  const opened = captureOpen(root);
  // Hold the page's height while it is rebuilt, so the browser does not jump to the top.
  if (lastDrawn === tab) root.style.minHeight = root.offsetHeight + 'px';
  lastDrawn = tab;
  const current = PAGES.find(x => x.id === tab);
  mount(
    [
      header(),
      h(
        'main',
        { class: 'panel page page-' + tab, id: 'page', tabindex: '-1', 'aria-label': current.label },
        tab === 'today'
          ? null
          : h('p', { class: 'back-home' }, h('a', { href: '#today', id: 'back-home', onclick: e => (e.preventDefault(), go('today')) }, h('span', { 'aria-hidden': 'true' }, '‹ '), 'Calendar')),
        current.view(),
      ),
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

/** "Sign out" in the menu: the same as in Settings, after asking about unsaved changes. */
async function signOutFromMenu() {
  if (!(await mayLeave())) {
    document.getElementById('menu-button')?.focus();
    return;
  }
  signOut({ currentTarget: document.getElementById('menu-button') });
}

/** Shows a page. opts.focusPage: the focus goes to the top of the new page (after the menu). */
async function go(id, opts) {
  const o = opts || {};
  if (!usable(id)) id = 'today';
  if (id === tab) {
    render();
    if (o.focusPage) document.getElementById('page')?.focus({ preventScroll: true });
    return;
  }
  if (!(await mayLeave())) return;
  tab = id;
  // Each page is a step in the browser's history, so that Back returns to the page before.
  history.pushState(null, '', '#' + id);
  render();
  window.scrollTo(0, 0);
  if (o.focusPage) document.getElementById(id === 'today' ? 'page' : 'back-home')?.focus({ preventScroll: true });
}

/** The way out of a page that cannot be used. */
const homeLink = () => h('p', { class: 'fatal-home' }, h('a', { href: '/', id: 'fatal-home' }, 'Back to the home page'));

/** Why the page could not be loaded: api() already words it (the server's sentence, or no answer). */
const fatalReason = e => (e && e.message) || 'Something went wrong.';

function showFatal(e) {
  mount(
    h(
      'div',
      { class: 'card login fatal' },
      h('h2', {}, 'Could not load'),
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
      mount(h('div', { class: 'card login fatal' }, h('h2', {}, 'Not set up yet'), h('p', {}, 'This site is not ready to be used yet.'), homeLink()));
    return;
  }
  const params = new URLSearchParams(location.search);
  if (P.signedIn) {
    adopt((await api('GET', '/api/state')).state);
    wasSignedIn = true;
    if (params.get('google_error')) toast(params.get('google_error'), true);
    if (params.get('google') === 'connected') toast('Google Calendar connected.');
    if (params.get('google') === 'signed-in') toast('Google sign-in added.');
    if (location.search) history.replaceState(null, '', location.pathname + location.hash);
    render();
    return;
  }
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
  deleted: 'The account was deleted.',
  left: 'This phone left the account.',
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
    for (const d of document.querySelectorAll('dialog.sheet-dialog')) d.remove();
      setAuthMessage('Please sign in again.');
    renderAuth();
    return true;
  },
});

window.addEventListener('hashchange', async () => {
  const next = hashPage();
  if (!S || !next || next === tab) return;
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
