/* Accounts: counts and dates only, never anything inside an account. */
import { alert, button, card, h, icon, list, listRow, promptDialog, selectField, skeleton, tag, textField, toast } from '/app/lib.js';
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
  if (loading || (data && !force)) return;
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
  const meta = ['Created ' + date(a.createdAt), 'last changed ' + date(a.updatedAt), plural(a.phones, 'phone')].join(' · ');
  return listRow({
    lead: icon(a.test ? 'phone' : 'user'),
    title: h('span', { class: 'mono' }, a.id),
    meta,
    body: a.test || a.reminderWaiting ? h('div', { class: 'tags' }, a.test ? tag('test account', 'info') : null, a.reminderWaiting ? tag('reminder waiting') : null) : null,
    trail: button({ label: 'Delete', variant: 'danger', size: 'sm', icon: 'trash', attrs: { 'aria-label': 'Delete account ' + a.id }, onclick: e => remove(a, e.currentTarget) }),
  });
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

export function accountsSection() {
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
  if (error) body = h('div', {}, h('p', { class: 'muted' }, error), button({ label: 'Try again', size: 'sm', onclick: () => loadAccounts(true) }));
  else if (!data) body = skeleton({ lines: 4, label: 'Loading the accounts' });
  else if (data.accounts.length === 0) body = h('p', { class: 'muted' }, query ? 'No account id contains "' + query + '".' : 'There are no accounts yet.');
  else
    body = h(
      'div',
      {},
      h('p', { class: 'small muted', 'aria-live': 'polite' }, 'Showing ' + num(data.shown) + (query ? ' matching' : '') + (data.shown >= data.limit ? ' (the first ' + num(data.limit) + '; search by id to find others)' : '') + '.'),
      list(data.accounts.map(row), { className: 'accounts' }),
    );
  return card(
    { title: 'Accounts', icon: 'user' },
    alert(
      { kind: 'info', title: 'Account data is encrypted. Nobody, including you in this console, can read it here.' },
      h('p', {}, 'Each account is shown only by an internal id, its dates, how many phones it has, and whether a reminder is waiting. Names, phone numbers, dates recorded and messages are never shown. To help someone, ask them; to remove an account they cannot delete themselves, use Delete.'),
    ),
    data ? h('div', {}, h('h3', {}, 'New accounts (not counting the test account)'), periods(data.created)) : null,
    controls,
    body,
  );
}
