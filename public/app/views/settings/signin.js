/* Settings: the Signing in card (password, sessions). Next owner: the dashboard agent. */
import { api, button, card, cardSection, confirmDialog, h, pretty, textField, toast } from '../../lib.js';
import { S, restart, run, saved, signOutLocally } from '../../store.js';

/** The password form. */
let pw = { a: '', b: '' };

function signOut(e) {
  run(
    () => api('POST', '/api/auth/logout'),
    () => {
      signOutLocally();
      restart();
    },
    e.currentTarget,
  );
}

export function signInCard() {
  const acc = S.account;
  let passwordPart;
  if (!acc.fresh) {
    passwordPart = h(
      'p',
      { class: 'muted' },
      (acc.hasPassword ? 'A password is set. To change or remove it' : 'No password is set; you sign in with a texted code. To set a password') + ', sign out and sign in again, then come back here within 15 minutes. Signing in again confirms it is you.',
    );
  } else {
    passwordPart = h(
      'form',
      {
        onsubmit: e => {
          e.preventDefault();
          if (pw.a !== pw.b) return toast('The two passwords are not the same.', true);
          run(
            async () => {
              await api('PUT', '/api/password', { password: pw.a });
              return api('GET', '/api/state');
            },
            r => {
              pw = { a: '', b: '' };
              saved('The password is set. Other devices signed in with this phone were signed out.')(r);
            },
            e.submitter,
          );
        },
      },
      h('p', { class: 'help' }, acc.hasPassword ? 'A password is set. You can change it here.' : 'Optional. With a password you can sign in without waiting for a text.'),
      textField({ id: 'npw1', label: 'New password', type: 'password', autocomplete: 'new-password', minlength: 10, required: true, value: pw.a, help: 'At least 10 characters.', oninput: e => (pw.a = e.target.value) }),
      textField({ id: 'npw2', label: 'The same password again', type: 'password', autocomplete: 'new-password', minlength: 10, required: true, value: pw.b, oninput: e => (pw.b = e.target.value) }),
      h(
        'div',
        { class: 'actions' },
        button({ label: acc.hasPassword ? 'Change password' : 'Set password', type: 'submit', icon: 'lock' }),
        acc.hasPassword && S.sms.ready
          ? button({
              label: 'Remove password',
              variant: 'danger',
              onclick: async e => {
                const btn = e.currentTarget;
                if (!(await confirmDialog({ title: 'Remove the password?', body: 'You will sign in with a texted code only.', confirmLabel: 'Remove password', danger: true }))) return;
                run(
                  async () => {
                    await api('DELETE', '/api/password');
                    return api('GET', '/api/state');
                  },
                  saved('The password was removed.'),
                  btn,
                );
              },
            })
          : null,
      ),
    );
  }
  return card(
    { title: 'Signing in' },
    h('p', {}, 'Signed in with ' + pretty(acc.number) + '.'),
    cardSection({ title: 'Password' }, passwordPart),
    cardSection(
      { title: 'Sessions' },
      h(
        'div',
        { class: 'actions' },
        button({ label: 'Sign out', icon: 'log-out', onclick: signOut }),
        button({
          label: 'Sign out everywhere',
          onclick: async e => {
            const btn = e.currentTarget;
            if (!(await confirmDialog({ title: 'Sign out everywhere?', body: 'This signs out this phone number on every device, this one included.', confirmLabel: 'Sign out everywhere' }))) return;
            run(
              () => api('POST', '/api/auth/logout-all'),
              () => {
                signOutLocally();
                restart();
              },
              btn,
            );
          },
        }),
      ),
    ),
  );
}
