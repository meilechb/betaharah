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
    label: 'Password',
    type: 'password',
    autocomplete: 'current-password',
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
                locked ? h('p', {}, 'It ends after 15 minutes.') : null,
              ),
            );
            pw.control.select();
            pw.control.focus();
            return true;
          },
        );
      },
    },
    h('a', { class: 'login-brand', href: '/' }, h('img', { class: 'mark', src: '/favicon.svg', width: '32', height: '32', alt: '' }), 'Betaharah'),
    h('h1', { class: 'login-title' }, 'Operator console'),
    formAlert,
    pw,
    submit,
    h('p', { class: 'small muted' }, h('a', { href: '/app/' }, 'Calendar sign-in')),
  );
  mount([form]);
  pw.control.focus();
}
