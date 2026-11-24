/* Settings: Your data (download, the guided setup, help and policies, deleting the account). */
import { api, button, h, icon, linkButton, promptDialog } from '../../lib.js';
import { S, signOutLocally } from '../../store.js';
import { openGuidedSetup } from '../../onboarding.js';
import { attempt } from '../shared.js';
import { blockRow, group } from './ui.js';

function linkRow(href, title, summary) {
  return h('a', { class: 'st-row st-nav', href }, h('span', { class: 'st-text' }, h('span', { class: 'st-title' }, title), h('span', { class: 'st-summary' }, summary)), h('span', { class: 'st-chev' }, icon('chevron-right')));
}

function view() {
  return {
    title: 'Your data',
    parent: '',
    lead: 'Everything kept about this account is encrypted before it is stored.',
    body: [
      group(
        { title: 'Download', id: 'data-download' },
        blockRow(
          h('p', { class: 'help' }, 'A file with your dates, settings, phones and messages, to keep or to read.'),
          h('div', { class: 'actions' }, linkButton({ href: '/api/export', download: 'betaharah-export.json', label: 'Download my data', icon: 'download', attrs: { id: 'data-export' } })),
        ),
      ),
      group(
        { title: 'Guided setup', id: 'data-setup' },
        blockRow(
          h('p', { class: 'help' }, 'The steps shown when the account was new: location, customs and the first dates. Nothing is lost by opening them again.'),
          h('div', { class: 'actions' }, button({ label: 'Open the guided setup again', attrs: { id: 'open-setup' }, onclick: () => openGuidedSetup() })),
        ),
      ),
      group({ title: 'Help and policies', id: 'data-links' }, linkRow('/help', 'Help', 'How the site and the texts work'), linkRow('/privacy', 'Privacy', 'What is kept, and who can see it'), linkRow('/terms', 'Terms', 'The terms of use')),
      group(
        { title: 'Delete the account', id: 'data-delete', className: 'danger' },
        blockRow(
          h('p', { class: 'help' }, 'Deletes the account for every phone on it (' + S.phones.length + '): all dates, settings and messages. It cannot be undone. Download your data first if you want a copy.'),
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
                  body: 'This deletes the account for every phone on it (' + S.phones.length + '): all entries, settings and messages. It cannot be undone.',
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
  summary: () => 'Download, guided setup, or delete the account',
  flag: () => null,
  view,
};
