/* Settings: Your data (download, the guided setup, help and policies, deleting the account). */
import { api, button, h, icon, linkButton, promptDialog } from '../../lib.js';
import { S, signOutLocally } from '../../store.js';
import { openGuidedSetup } from '../../onboarding.js';
import { attempt } from '../shared.js';
import { blockRow, group } from './ui.js';

function linkRow(href, title, summary) {
  return h('a', { class: 'st-row st-nav', href }, h('span', { class: 'st-text' }, h('span', { class: 'st-title' }, title), summary ? h('span', { class: 'st-summary' }, summary) : null), h('span', { class: 'st-chev' }, icon('chevron-right')));
}

/** " for every phone on it (2)", or nothing when the account has no phone. */
const forPhones = () => (S.phones.length ? ' for every phone on it (' + S.phones.length + ')' : '');

function view() {
  return {
    title: 'Your data',
    parent: '',
    body: [
      group(
        { title: 'Download', id: 'data-download' },
        blockRow(
          h('div', { class: 'actions' }, linkButton({ href: '/api/export', download: 'betaharah-export.json', label: 'Download my data', icon: 'download', attrs: { id: 'data-export' } })),
        ),
      ),
      group(
        { title: 'Guided setup', id: 'data-setup' },
        blockRow(
          h('p', { class: 'help' }, 'Nothing is lost.'),
          h('div', { class: 'actions' }, button({ label: 'Open setup again', attrs: { id: 'open-setup' }, onclick: () => openGuidedSetup() })),
        ),
      ),
      group(
        { title: 'Help and policies', id: 'data-links' },
        linkRow('/help', 'Help'),
        linkRow('/privacy', 'Privacy'),
        linkRow('/terms', 'Terms'),
        // only when the operator has set up the page
        S.donate ? linkRow('/donate', 'Donate') : null,
      ),
      group(
        { title: 'Delete the account', id: 'data-delete', className: 'danger' },
        blockRow(
          h(
            'div',
            { class: 'actions' },
            button({
              label: 'Delete my account',
              variant: 'danger',
              icon: 'trash',
              attrs: { id: 'delete-account' },
              onclick: async e => {
                const btn = e.currentTarget;
                const typed = await promptDialog({
                  title: 'Delete the account?',
                  body: 'This deletes the account' + forPhones() + ': all entries, settings and messages. It cannot be undone.',
                  label: 'Type DELETE to confirm',
                  expect: 'DELETE',
                  mismatchMessage: 'Type DELETE in capital letters. Nothing has been deleted.',
                  confirmLabel: 'Delete my account',
                  danger: true,
                });
                if (typed === null) return;
                attempt(() => api('POST', '/api/account/delete', { confirm: 'DELETE' }), {
                  button: btn,
                  done: () => {
                    signOutLocally();
                    location.href = '/';
                  },
                });
              },
            }),
          ),
        ),
      ),
    ],
  };
}

export const dataSection = {
  id: 'data',
  title: 'Your data',
  icon: 'download',
  summary: () => 'Download, setup again, delete',
  flag: () => null,
  view,
};
