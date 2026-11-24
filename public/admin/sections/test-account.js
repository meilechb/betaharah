/* The test account: a made-up household that never texts a real phone. */
import { button, card, confirmDialog, h, pretty, tag, toast } from '/app/lib.js';
import { call, run, S, saved } from '../state.js';

export function testPage() {
  const exists = S.demo.exists;
  return card(
    { title: 'Test account', icon: 'phone', headerAction: tag(exists ? 'exists' : 'none', exists ? 'ok' : null) },
    h(
      'p',
      {},
      'A made-up household for trying every feature on the live site, text commands and reminders included, before Telnyx is set up. It is fully set up in Lakewood, NJ, with four past cycles, and opens in the seven clean days. Its phones are ' +
        pretty(S.demo.number) +
        ' and (732) 555-0199, numbers reserved for fiction. No text is ever sent for it: replies, reminders and codes appear in its Log as "simulated", and nothing counts against the limits.',
    ),
    h('p', { class: 'small muted' }, 'Opening it signs this browser in to it in the calendar (/app/). Your operator session stays signed in. Opening or resetting it replaces it with a fresh one.'),
    h(
      'div',
      { class: 'actions' },
      button({
        label: 'Open the test account',
        variant: 'primary',
        icon: 'chevron-right',
        onclick: e => run(() => call('POST', '/api/admin/demo'), () => location.assign('/app/'), e.currentTarget),
      }),
      exists
        ? button({
            label: 'Reset it',
            icon: 'refresh',
            onclick: async e => {
              const btn = e.currentTarget;
              const ok = await confirmDialog({ title: 'Reset the test account?', body: 'It is replaced by a fresh one. Anything you changed in it is lost.', confirmLabel: 'Reset it' });
              if (!ok) return;
              run(
                () => call('POST', '/api/admin/demo'),
                () =>
                  run(() => call('GET', '/api/admin/state'), state => {
                    saved()(state);
                    toast('The test account was reset. This browser is now signed in to it in the calendar.');
                  }),
                btn,
              );
            },
          })
        : null,
      exists
        ? button({
            label: 'Delete it',
            variant: 'danger',
            icon: 'trash',
            onclick: async e => {
              const btn = e.currentTarget;
              const ok = await confirmDialog({ title: 'Delete the test account?', body: 'It is made up; you can open a new one at any time.', confirmLabel: 'Delete it', danger: true });
              if (ok) run(() => call('DELETE', '/api/admin/demo'), saved('The test account was deleted.'), btn);
            },
          })
        : null,
    ),
  );
}
