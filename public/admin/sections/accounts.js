/* Accounts: counts and dates only, never anything inside an account. */
import { alert, button, card, emptyState, h, promptDialog, selectField, skeleton, tag, textField, toast } from '/app/lib.js';
import { adopt, call, date, num, plural, render, run } from '../state.js';

let data = null;
let error = '';
let query = '';
let sort = 'newest';
let timer = null;
let loading = false;

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

async function remove(a, btn) {
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
      render();
      toast('The account was deleted.');
      loadAccounts(true);
    },
    btn,
  );
}

function row(a) {
  return h(
    'tr',
    {},
    h('th', { scope: 'row', 'data-label': 'Account id' }, h('span', { class: 'mono' }, a.id), a.test ? tag('test account', 'info') : null),
    h('td', { 'data-label': 'Created' }, date(a.createdAt)),
    h('td', { 'data-label': 'Last changed' }, date(a.updatedAt)),
    h('td', { class: 'n', 'data-label': 'Phones' }, num(a.phones)),
    h('td', { 'data-label': 'Reminder' }, a.reminderWaiting ? tag('waiting', 'ok') : h('span', { class: 'muted' }, 'none')),
    h('td', { class: 'actions-cell' }, button({ label: 'Delete', variant: 'danger', size: 'sm', icon: 'trash', attrs: { 'aria-label': 'Delete account ' + a.id }, onclick: e => remove(a, e.currentTarget) })),
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

export function accountsPage() {
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
      { kind: 'info', title: 'Account data is encrypted. Nobody, including you in this console, can read it here.' },
      h('p', {}, 'Each account is shown only by an internal id, its dates, how many phones it has, and whether a reminder is waiting. Names, phone numbers, dates recorded and messages are never shown. To help someone, ask them; to remove an account they cannot delete themselves, use Delete. Accounts made in the text simulator are test accounts too.'),
    ),
    data ? card({ title: 'New accounts', icon: 'plus', intro: 'Not counting the test account.' }, periods(data.created)) : null,
    card({ title: 'All accounts', icon: 'user' }, controls, body),
  ];
}
