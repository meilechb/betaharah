/* The operator's sign-in screen. */
import { alert, button, h, mount, setFieldError, textField } from '/app/lib.js';
import { call, run } from './state.js';

/**
 * Shows the sign-in form. `notice` is an optional sentence shown above it
 * (for example after signing out); `onSignedIn` runs after a good password.
 */
export function showSignIn(notice, onSignedIn) {
  let password = '';
  const formAlert = h('div', { class: 'signin-alert' }, notice ? alert({ kind: 'info' }, notice) : null);
  const pw = textField({
    id: 'pw',
    label: 'Operator password',
    type: 'password',
    autocomplete: 'current-password',
    help: 'The DASHBOARD_PASSWORD secret of the Worker. After eight wrong passwords from one network, sign-in is locked for 15 minutes.',
    oninput: e => {
      password = e.target.value;
      setFieldError(pw, '');
    },
  });
  const submit = button({ label: 'Sign in', variant: 'primary', type: 'submit', block: true });
  const form = h(
    'form',
    {
      class: 'card login',
      novalidate: true,
      onsubmit: e => {
        e.preventDefault();
        if (!password) {
          setFieldError(pw, 'Type the operator password.');
          pw.control.focus();
          return;
        }
        run(
          () => call('POST', '/api/admin/login', { password }),
          () => onSignedIn(),
          submit,
          err => {
            const locked = err.status === 429;
            formAlert.replaceChildren(
              alert(
                { kind: 'bad', role: 'alert', title: locked ? 'Sign-in is locked for now' : null },
                err.message,
                locked ? h('p', {}, 'The lock applies to the network you are on. It ends by itself after 15 minutes. Nothing else needs to be done.') : null,
              ),
            );
            pw.control.select();
            pw.control.focus();
            return true;
          },
        );
      },
    },
    h('h1', { class: 'login-title' }, 'Operator console'),
    h('p', { class: 'muted' }, 'For the person who runs this site. To use the calendar, go to the ', h('a', { href: '/app/' }, 'sign-in page'), '.'),
    formAlert,
    pw,
    submit,
    h('p', { class: 'small muted' }, 'A session lasts 12 hours. The console shows totals and the site’s own settings, never an account’s data.'),
  );
  mount([form]);
  pw.control.focus();
}
