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
      'Lakewood, NJ, 4 past cycles. Phones ' + pretty(S.demo.number) + ' and (732) 555-0199. Nothing is sent or counted.',
    ),
    h('p', { class: 'small muted' }, 'Opening or resetting it makes a fresh one.'),
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
              const ok = await confirmDialog({ title: 'Reset the test account?', body: 'Changes made in it are lost.', confirmLabel: 'Reset it' });
              if (!ok) return;
              run(
                () => call('POST', '/api/admin/demo'),
                () =>
                  run(() => call('GET', '/api/admin/state'), state => {
                    saved()(state);
                    toast('The test account was reset.');
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
              const ok = await confirmDialog({ title: 'Delete the test account?', body: 'A new one can be opened any time.', confirmLabel: 'Delete it', danger: true });
              if (ok) run(() => call('DELETE', '/api/admin/demo'), saved('The test account was deleted.'), btn);
            },
          })
        : null,
    ),
  );
}
