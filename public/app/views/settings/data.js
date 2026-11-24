/* Settings: the Your data card (download, delete). Next owner: the dashboard agent. */
import { api, button, card, h, linkButton, promptDialog } from '../../lib.js';
import { run, signOutLocally } from '../../store.js';

export function dataCard() {
  return card(
    { title: 'Your data' },
    h('p', { class: 'help' }, 'Everything kept about this account is encrypted before it is stored. You can take a copy, and you can delete it all. See the ', h('a', { href: '/privacy' }, 'Privacy page'), '.'),
    h(
      'div',
      { class: 'actions' },
      linkButton({ href: '/api/export', download: 'betaharah-export.json', label: 'Download my data', icon: 'download' }),
      button({
        label: 'Delete my account',
        variant: 'danger',
        icon: 'trash',
        onclick: async e => {
          const btn = e.currentTarget;
          const typed = await promptDialog({
            title: 'Delete the account?',
            body: 'This deletes the account for every phone on it: all entries, settings and messages. It cannot be undone.',
            label: 'Type DELETE to confirm',
            expect: 'DELETE',
            mismatchMessage: 'Type DELETE in capital letters. Nothing has been deleted.',
            confirmLabel: 'Delete my account',
            danger: true,
          });
          if (typed === null) return;
          run(
            () => api('POST', '/api/account/delete', { confirm: 'DELETE' }),
            () => {
              signOutLocally();
              location.href = '/';
            },
            btn,
          );
        },
      }),
    ),
    h('p', { class: 'small muted' }, h('a', { href: '/help' }, 'Help'), ' · ', h('a', { href: '/privacy' }, 'Privacy'), ' · ', h('a', { href: '/terms' }, 'Terms')),
  );
}
