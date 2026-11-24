/*
 * The operator console: an application with a top bar, a side navigation
 * on wide screens and a compact section switcher on phones. Each section is
 * its own page (#overview, #accounts, ...), built by a module under
 * sections/. Server text is always inserted as text, never as HTML.
 */
import { button, configureApi, h, icon, mount, pageLoading, toast } from '/app/lib.js';
import { showSignIn } from './signin.js';
import { adopt, call, configure, forget, PAGES, run, S, time } from './state.js';
import { overviewPage } from './sections/overview.js';
import { usagePage, loadHistory } from './sections/usage.js';
import { accountsPage, accountsTitle, loadAccountsPage } from './sections/accounts.js';
import { settingsPage } from './sections/settings.js';
import { keysPage } from './sections/keys.js';
import { invitesPage } from './sections/invites.js';
import { testPage } from './sections/test-account.js';
import { simulatorCards as simulatorPage } from './sections/tools.js';
import { toolsPage } from './sections/tools.js';

const BUILDERS = {
  overview: overviewPage,
  usage: usagePage,
  accounts: accountsPage,
  settings: settingsPage,
  keys: keysPage,
  invites: invitesPage,
  simulator: simulatorPage,
  test: testPage,
  tools: toolsPage,
};

/** What each page loads when it is opened; each is called with the part of the address after the page's id. */
const LOADS = { overview: [() => loadHistory()], usage: [() => loadHistory()], accounts: [loadAccountsPage] };

/** Pages with their own heading for a part of the address (#accounts/<id>). */
const TITLES = { accounts: accountsTitle };

let current = 'overview';
/** The part of the address after the page's id, e.g. an account id in #accounts/<id>; '' for none. */
let sub = '';

/** "#accounts/abc" → ['accounts', 'abc']. Only Accounts has a second part. */
function fromHash() {
  const [id, rest] = location.hash.slice(1).split('/');
  if (!BUILDERS[id]) return ['overview', ''];
  return [id, id === 'accounts' && rest ? decodeURIComponent(rest) : ''];
}

function signedOut(notice) {
  forget();
  showSignIn(notice || '', start);
}

configureApi({ onUnauthorized: path => path !== '/api/admin/login' });
configure({ redraw: render, signedOut });

async function start() {
  mount([pageLoading('Loading the console…')]);
  try {
    adopt(await call('GET', '/api/admin/state'));
  } catch (e) {
    if (e.status === 401) return showSignIn('', start);
    mount([h('div', { class: 'alert bad', role: 'alert' }, e.message || 'The console could not be loaded.')]);
    return;
  }
  [current, sub] = fromHash();
  render();
}

function signOut(btn) {
  run(() => call('POST', '/api/admin/logout'), () => signedOut('You are signed out.'), btn);
}

function go(id) {
  if (location.hash.slice(1) !== id) location.hash = id;
  else show([id, '']);
}

function show([id, part], focusHeading) {
  current = id;
  sub = part;
  render();
  window.scrollTo(0, 0);
  if (focusHeading) {
    const heading = document.getElementById('page-title');
    if (heading) heading.focus({ preventScroll: true });
  }
}

function badge(id) {
  if (id !== 'overview') return null;
  const left = S.checklist.filter(i => !i.optional && i.status !== 'done').length;
  return left > 0 ? h('span', { class: 'count', title: left + ' setup steps left' }, String(left), h('span', { class: 'visually-hidden' }, ' setup steps left')) : null;
}

function sideNav() {
  const groups = [];
  for (const p of PAGES) {
    let g = groups.find(x => x.name === p.group);
    if (!g) groups.push((g = { name: p.group, pages: [] }));
    g.pages.push(p);
  }
  return h(
    'nav',
    { class: 'side-nav', 'aria-label': 'Sections' },
    groups.map(g =>
      h(
        'div',
        { class: 'nav-group' },
        g.name ? h('div', { class: 'nav-group-title' }, g.name) : null,
        h(
          'ul',
          {},
          g.pages.map(p =>
            h('li', {}, h('a', { href: '#' + p.id, id: 'nav-' + p.id, 'aria-current': p.id === current ? 'page' : null }, icon(p.icon), h('span', {}, p.label), badge(p.id))),
          ),
        ),
      ),
    ),
  );
}

/** On a phone: a select that switches the page. */
function phoneSwitcher() {
  return h(
    'div',
    { class: 'phone-switcher' },
    h('label', { for: 'section-switch', class: 'visually-hidden' }, 'Section'),
    h(
      'select',
      { id: 'section-switch', onchange: e => go(e.target.value) },
      PAGES.map(p => h('option', { value: p.id, selected: p.id === current }, p.label)),
    ),
  );
}

function topBar() {
  const until = S.session && S.session.until;
  return h(
    'header',
    { class: 'app-bar' },
    h('a', { class: 'brand', href: '#overview' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'B'), h('span', { class: 'brand-name' }, 'Betaharah'), h('span', { class: 'brand-sub' }, 'Operator console')),
    h(
      'div',
      { class: 'app-bar-end' },
      h('span', { class: 'signed-in' }, icon('lock', { size: 'sm' }), h('span', {}, until ? 'Signed in until ' + time(until) : 'Signed in')),
      button({ label: 'Sign out', icon: 'log-out', size: 'sm', onclick: e => signOut(e.currentTarget) }),
    ),
  );
}

function render() {
  if (!S) return;
  const base = PAGES.find(p => p.id === current);
  const page = (TITLES[current] && TITLES[current](sub)) || base;
  const active = document.activeElement;
  const id = active && active.id ? active.id : null;
  const caret = active && 'selectionStart' in active ? active.selectionStart : null;
  const y = window.scrollY;
  mount(
    [
      topBar(),
      h(
        'div',
        { class: 'app-body' },
        sideNav(),
        h(
          'main',
          { class: 'app-main', id: 'main' },
          phoneSwitcher(),
          h('div', { class: 'page-head' }, h('h1', { id: 'page-title', tabindex: '-1' }, page.label), h('p', { class: 'page-desc' }, page.desc)),
          h('div', { class: 'page', id: current }, BUILDERS[current](sub)),
        ),
      ),
    ],
    { wide: true },
  );
  document.title = page.label + ' · Betaharah operator console';
  window.scrollTo(0, y);
  if (id) {
    const el = document.getElementById(id);
    if (el) {
      el.focus({ preventScroll: true });
      if (caret !== null && 'setSelectionRange' in el) {
        try {
          el.setSelectionRange(caret, caret);
        } catch (e) {
          // not a text field
        }
      }
    }
  }
  for (const load of LOADS[current] || []) load(sub);
}

// A page's own data arrived: redraw it (the event names the part that changed).
window.addEventListener('admin:section', () => render());
window.addEventListener('hashchange', () => show(fromHash(), true));
window.addEventListener('unhandledrejection', () => toast('Something went wrong. Reload the page.', true));

start();
