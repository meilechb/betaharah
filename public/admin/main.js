/*
 * The operator console: boot, sign-in or the console, the list of sections,
 * and redrawing with the focus kept. Every section is a module under
 * sections/. Server text is always inserted as text, never as HTML.
 */
import { button, configureApi, h, icon, mount, pageLoading, toast } from '/app/lib.js';
import { showSignIn } from './signin.js';
import { adopt, call, configure, forget, run, S, SECTIONS, time } from './state.js';
import { summarySection, setupSection } from './sections/overview.js';
import { statusSection } from './sections/status.js';
import { usageSection, loadHistory } from './sections/usage.js';
import { accountsSection, loadAccounts } from './sections/accounts.js';
import { settingsSection } from './sections/settings.js';
import { keysSection } from './sections/keys.js';
import { invitesSection } from './sections/invites.js';
import { testSection } from './sections/test-account.js';
import { toolsSection } from './sections/tools.js';

const BUILDERS = {
  summary: summarySection,
  setup: setupSection,
  status: statusSection,
  usage: usageSection,
  accounts: accountsSection,
  settings: settingsSection,
  keys: keysSection,
  invites: invitesSection,
  test: testSection,
  tools: toolsSection,
};

/** Loads that wait until their section is first on screen. */
const LAZY = { usage: loadHistory, accounts: loadAccounts };

let observer = null;
let current = 'summary';

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
  render();
  const target = location.hash.slice(1);
  if (BUILDERS[target]) {
    const el = document.getElementById(target);
    if (el) el.scrollIntoView();
    setCurrent(target);
  }
}

function signOut(btn) {
  run(() => call('POST', '/api/admin/logout'), () => signedOut('You are signed out.'), btn);
}

function nav() {
  const left = S.checklist.filter(i => !i.optional && i.status !== 'done').length;
  return h(
    'nav',
    { class: 'console-nav', 'aria-label': 'Sections' },
    h(
      'ul',
      {},
      SECTIONS.map(s =>
        h(
          'li',
          {},
          h(
            'a',
            { href: '#' + s.id, id: 'nav-' + s.id, 'aria-current': s.id === current ? 'location' : null, onclick: () => setCurrent(s.id) },
            icon(s.icon),
            h('span', {}, s.label),
            s.id === 'setup' && left > 0 ? h('span', { class: 'count', 'aria-label': left + ' left' }, String(left)) : null,
          ),
        ),
      ),
    ),
  );
}

function setCurrent(id) {
  current = id;
  document.querySelectorAll('.console-nav a').forEach(a => {
    if (a.id === 'nav-' + id) a.setAttribute('aria-current', 'location');
    else a.removeAttribute('aria-current');
  });
}

/** One section, wrapped so that it can be replaced on its own. */
export function sectionNode(id) {
  return h('div', { class: 'section-wrap', id: id, 'data-section': id, tabindex: '-1' }, BUILDERS[id]());
}

/** Redraws one section in place (after its own data arrived), keeping the focus. */
export function redrawSection(id) {
  const old = document.getElementById(id);
  if (!old || !S) return;
  keepFocus(() => old.replaceChildren(BUILDERS[id]()));
}
window.addEventListener('admin:section', e => redrawSection(e.detail));

function keepFocus(fn) {
  const active = document.activeElement;
  const id = active && active.id ? active.id : null;
  const start = active && 'selectionStart' in active ? active.selectionStart : null;
  const y = window.scrollY;
  fn();
  window.scrollTo(0, y);
  if (id) {
    const el = document.getElementById(id);
    if (el) {
      el.focus({ preventScroll: true });
      if (start !== null && 'setSelectionRange' in el) {
        try {
          el.setSelectionRange(start, start);
        } catch (e) {
          // not a text field
        }
      }
    }
  }
}

function render() {
  if (!S) return;
  const until = S.session && S.session.until;
  keepFocus(() =>
    mount(
      [
        h(
          'header',
          { class: 'top console-top' },
          h('div', {}, h('h1', {}, 'Operator console'), h('p', { class: 'today' }, 'Totals and the site’s own settings. No account’s data is shown here.')),
          h(
            'div',
            { class: 'session' },
            until ? h('span', { class: 'small muted' }, 'Signed in until ' + time(until)) : null,
            button({ label: 'Sign out', icon: 'log-out', size: 'sm', onclick: e => signOut(e.currentTarget) }),
          ),
        ),
        h('div', { class: 'console' }, nav(), h('div', { class: 'console-main' }, SECTIONS.map(s => sectionNode(s.id)))),
      ],
      { wide: true },
    ),
  );
  watchLazy();
}

function watchLazy() {
  if (observer) observer.disconnect();
  const pending = Object.keys(LAZY);
  if (typeof IntersectionObserver === 'undefined') {
    pending.forEach(id => LAZY[id]());
    return;
  }
  observer = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = entry.target.id;
        observer.unobserve(entry.target);
        if (LAZY[id]) LAZY[id]();
      }
    },
    { rootMargin: '200px 0px' },
  );
  pending.forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });
}

window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (BUILDERS[id]) setCurrent(id);
});
window.addEventListener('unhandledrejection', () => toast('Something went wrong. Reload the page.', true));

start();
