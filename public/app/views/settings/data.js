/* Settings: the Your data card (download, delete). */
import { api, button, card, h, linkButton, promptDialog } from '../../lib.js';
import { S, signOutLocally } from '../../store.js';
import { attempt } from '../shared.js';

export function dataCard() {
  return card(
    { title: 'Your data', icon: 'download' },
    h('p', { class: 'help' }, 'Everything kept about this account is encrypted before it is stored. You can take a copy, and you can delete it all. See the ', h('a', { href: '/privacy' }, 'Privacy page'), '.'),
    h(
      'div',
      { class: 'actions' },
      linkButton({ href: '/api/export', download: 'betaharah-export.json', label: 'Download my data', icon: 'download' }),
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
    h('p', { class: 'small muted links' }, h('a', { href: '/help' }, 'Help'), ' · ', h('a', { href: '/privacy' }, 'Privacy'), ' · ', h('a', { href: '/terms' }, 'Terms')),
  );
}
