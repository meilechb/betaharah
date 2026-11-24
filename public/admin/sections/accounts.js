/*
 * Accounts: the list shows ids, dates and counts. Opening one account
 * (#accounts/<id>) shows its phones, the Google email it signs in with and
 * its recent texts; never the dates recorded, the customs or the settings.
 */
import { alert, button, card, emptyState, h, icon, linkButton, list, listRow, pretty, promptDialog, selectField, skeleton, tag, textField, toast } from '/app/lib.js';
import { adopt, call, date, dateTime, num, render, run } from '../state.js';

let data = null;
let error = '';
let query = '';
let sort = 'newest';
let timer = null;
let loading = false;

/** The open account: { id, account, error, loading }. */
let one = { id: '', account: null, error: '', loading: false };

const redrawMe = () => window.dispatchEvent(new CustomEvent('admin:section', { detail: 'accounts' }));

/** Loads the list (once, or again with force, or after the search or the order changed). */
export async function loadAccounts(force) {
  if (loading || ((data || error) && !force)) return;
  loading = true;
  try {
    data = await call('GET', '/api/admin/accounts?sort=' + encodeURIComponent(sort) + '&q=' + encodeURIComponent(query));
    error = '';
  } catch (e) {
    error = e.message || 'The list could not be loaded.';
  } finally {
    loading = false;
    redrawMe();
  }
}

/** Loads one account (once per opening, or again with force). */
async function loadAccount(id, force) {
  if (one.id === id && (one.loading || ((one.account || one.error) && !force))) return;
  one = { id, account: null, error: '', loading: true };
  redrawMe();
  try {
    const r = await call('GET', '/api/admin/accounts/' + encodeURIComponent(id));
    if (one.id === id) one = { id, account: r.account, error: '', loading: false };
  } catch (e) {
    if (one.id === id) one = { id, account: null, error: e.message || 'The account could not be loaded.', loading: false };
  }
  redrawMe();
}

/** What the Accounts page loads: one account when the address names one, otherwise the list. */
export function loadAccountsPage(id) {
  if (id) loadAccount(id);
  else {
    // Opening the same account again later reads it afresh.
    one = { id: '', account: null, error: '', loading: false };
    loadAccounts();
  }
}

/** The heading of the page when one account is open. */
export function accountsTitle(id) {
  if (!id) return null;
  return { label: 'One account', desc: 'Account ' + id + ': its phones, the Google email it signs in with, and its recent texts.' };
}

async function remove(a, btn, done) {
  const typed = await promptDialog({
    title: a.test ? 'Delete the test account?' : 'Delete this account and all of its data?',
    body: a.test
      ? 'The test account is made up. You can open a new one at any time.'
      : 'Account ' + a.id + ' will be removed: its settings, entries, phones, messages and calendar link. Its Google Calendar connection is revoked. People on it can no longer sign in. This cannot be undone. Do this only when the person asked for it and cannot do it themselves.',
    label: 'Type DELETE to confirm',
    expect: 'DELETE',
    mismatchMessage: 'Type DELETE in capital letters. Nothing has been deleted.',
    confirmLabel: 'Delete the account',
    danger: true,
  });
  if (typed === null) return;
  run(
    () => call('DELETE', '/api/admin/households/' + encodeURIComponent(a.id)),
    state => {
      adopt(state);
      toast('The account was deleted.');
      loadAccounts(true);
      if (done) done();
      else render();
    },
    btn,
  );
}

const href = id => '#accounts/' + encodeURIComponent(id);

function row(a) {
  return h(
    'tr',
    {},
    h('th', { scope: 'row', 'data-label': 'Account id' }, h('a', { class: 'mono', href: href(a.id), 'aria-label': 'Open account ' + a.id }, a.id), a.test ? tag('test account', 'info') : null),
    h('td', { 'data-label': 'Created' }, date(a.createdAt)),
    h('td', { 'data-label': 'Last changed' }, date(a.updatedAt)),
    h('td', { class: 'n', 'data-label': 'Phones' }, num(a.phones)),
    h('td', { 'data-label': 'Reminder' }, a.reminderWaiting ? tag('waiting', 'ok') : h('span', { class: 'muted' }, 'none')),
    h(
      'td',
      { class: 'actions-cell' },
      linkButton({ label: 'Open', size: 'sm', icon: 'chevron-right', href: href(a.id), attrs: { 'aria-label': 'Open account ' + a.id } }),
      ' ',
      button({ label: 'Delete', variant: 'danger', size: 'sm', icon: 'trash', attrs: { 'aria-label': 'Delete account ' + a.id }, onclick: e => remove(a, e.currentTarget) }),
    ),
  );
}

function periods(c) {
  return h(
    'dl',
    { class: 'periods' },
    [
      ['Today', c.today],
      ['Last 7 days', c.week],
      ['Last 30 days', c.month],
      ['Last 12 months', c.year],
      ['All', c.all],
    ].map(([label, n]) => h('div', {}, h('dt', {}, label), h('dd', {}, num(n)))),
  );
}

// ---------- one account ----------

/** A yes-or-no fact about a phone, in words with an icon. */
function flag(yes, yesText, noText, kindIfYes, kindIfNo) {
  const kind = yes ? kindIfYes : kindIfNo;
  return h('li', { class: 'flag' + (kind ? ' ' + kind : '') }, icon(yes ? 'check' : 'close', { size: 'sm' }), h('span', {}, yes ? yesText : noText));
}

function phoneRow(p) {
  return listRow({
    lead: icon('phone'),
    title: pretty(p.number),
    body: h(
      'ul',
      { class: 'flags', 'aria-label': 'About ' + pretty(p.number) },
      flag(p.verified, 'Verified by a code', 'Not verified', 'ok', 'warn'),
      flag(p.texts, 'Agreed to reminder texts', 'Has not agreed to reminder texts', 'ok', null),
      flag(p.optedOut, 'Replied STOP: nothing is sent to it', 'Has not replied STOP', 'bad', null),
    ),
  });
}

function messageRow(m) {
  const received = m.direction === 'in';
  return listRow({
    lead: icon(received ? 'chevron-left' : 'chevron-right'),
    title: (received ? 'Received from' : 'Sent to') + ' the phone ending ' + m.phone,
    meta: dateTime(m.at) + ' · Status: ' + m.status,
    body: h('p', { class: 'message-body' }, m.body),
    className: received ? 'message in' : 'message out',
  });
}

function backLink() {
  return h('p', { class: 'back' }, h('a', { href: '#accounts' }, icon('chevron-left', { size: 'sm' }), h('span', {}, 'All accounts')));
}

function accountPage(id) {
  if (one.id !== id || one.loading) return [backLink(), skeleton({ lines: 6, label: 'Loading the account' })];
  if (one.error)
    return [
      backLink(),
      alert({ kind: 'bad', title: 'The account could not be opened.', role: 'alert' }, h('p', {}, one.error)),
      h('div', { class: 'actions' }, button({ label: 'Try again', size: 'sm', icon: 'refresh', onclick: () => loadAccount(id, true) })),
    ];
  const a = one.account;
  const msgs = a.messages || [];
  return [
    backLink(),
    alert(
      { kind: 'info', title: 'This shows the account’s phones, the Google email it signs in with, and its last 15 texts.' },
      h('p', {}, 'It does not show the dates recorded, the customs or the settings. Those stay in the encrypted record and are not sent to this console.'),
    ),
    card(
      { title: 'Account', icon: 'user', headerAction: a.test ? tag('test account', 'info') : null },
      h('p', { class: 'mono account-id' }, a.id),
    ),
    card(
      { title: 'Phones', icon: 'phone' },
      a.phones.length ? list(a.phones.map(phoneRow), { className: 'phones' }) : h('p', { class: 'muted' }, 'This account has no phone.'),
    ),
    card(
      { title: 'Sign in with Google', icon: 'lock' },
      a.googleEmail
        ? h(
            'dl',
            { class: 'facts' },
            h('div', {}, h('dt', {}, 'Email'), h('dd', {}, a.googleEmail)),
            h('div', {}, h('dt', {}, 'Name'), h('dd', {}, a.googleName || 'Google did not give a name.')),
          )
        : h('p', { class: 'muted google-none' }, 'This account does not sign in with Google.'),
    ),
    card(
      { title: 'Recent texts', icon: 'message', intro: msgs.length ? 'Newest first. Texts the site received from the account’s phones and texts it sent to them.' : null },
      msgs.length ? list(msgs.map(messageRow), { className: 'messages' }) : h('p', { class: 'muted' }, 'No texts to or from this account’s phones.'),
    ),
    card(
      { title: 'Delete this account', icon: 'trash' },
      h('p', {}, a.test ? 'The test account is made up. Deleting it removes it; you can open a new one under Test account.' : 'Do this only when the person asked for it and cannot do it themselves. It cannot be undone.'),
      h(
        'div',
        { class: 'actions' },
        button({
          label: 'Delete this account',
          variant: 'danger',
          icon: 'trash',
          onclick: e =>
            remove(a, e.currentTarget, () => {
              one = { id: '', account: null, error: '', loading: false };
              location.hash = 'accounts';
            }),
        }),
      ),
    ),
  ];
}

// ---------- the page ----------

export function accountsPage(id) {
  if (id) return accountPage(id);
  const controls = h(
    'div',
    { class: 'filters' },
    textField({
      id: 'acc-q',
      label: 'Find by account id',
      type: 'search',
      value: query,
      autocomplete: 'off',
      spellcheck: 'false',
      help: 'Part of the id is enough. Accounts cannot be found by phone number: the numbers are not stored readably.',
      oninput: e => {
        query = e.target.value.replace(/[^A-Za-z0-9_-]/g, '');
        clearTimeout(timer);
        timer = setTimeout(() => loadAccounts(true), 250);
      },
    }),
    selectField({
      id: 'acc-sort',
      label: 'Order',
      value: sort,
      options: [
        { value: 'newest', label: 'Newest first' },
        { value: 'oldest', label: 'Oldest first' },
        { value: 'changed', label: 'Changed most recently' },
        { value: 'phones', label: 'Most phones' },
      ],
      onchange: e => {
        sort = e.target.value;
        loadAccounts(true);
      },
    }),
  );
  let body;
  if (error) body = h('div', { class: 'empty' }, h('p', {}, error), button({ label: 'Try again', size: 'sm', onclick: () => loadAccounts(true) }));
  else if (!data) body = skeleton({ lines: 5, label: 'Loading the accounts' });
  else if (data.accounts.length === 0)
    body = emptyState({ icon: 'user', title: query ? 'No account id contains "' + query + '".' : 'There are no accounts yet.', body: query ? 'Check the id, or clear the search.' : 'Accounts appear here when people sign up, or when you make an invitation for one number.' });
  else
    body = h(
      'div',
      {},
      h(
        'table',
        { class: 'data-table accounts' },
        h(
          'thead',
          {},
          h('tr', {}, ['Account id', 'Created', 'Last changed', 'Phones', 'Reminder'].map(t => h('th', { scope: 'col', class: t === 'Phones' ? 'n' : null }, t)), h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Actions'))),
        ),
        h('tbody', {}, data.accounts.map(row)),
      ),
      h('p', { class: 'table-foot', 'aria-live': 'polite' }, 'Showing ' + num(data.shown) + (query ? ' matching' : '') + (data.shown >= data.limit ? ', the first ' + num(data.limit) + '. Search by id to find others.' : '.')),
    );
  return [
    alert(
      { kind: 'info', title: 'The dates people record are encrypted. This console does not show them.' },
      h('p', {}, 'The list shows each account by an internal id, its dates, how many phones it has, and whether a reminder is waiting. Open an account to see its phone numbers, the Google email it signs in with, and its recent texts. The dates recorded, the customs and the settings are not shown. To remove an account the person cannot delete themselves, use Delete. Accounts made in the text simulator are test accounts too.'),
    ),
    data ? card({ title: 'New accounts', icon: 'plus', intro: 'Not counting the test account.' }, periods(data.created)) : null,
    card({ title: 'All accounts', icon: 'user' }, controls, body),
  ];
}
