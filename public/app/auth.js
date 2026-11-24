/*
 * Every sign-in, sign-up and invitation view. Shown when nobody is signed in.
 * Next owner: the sign-up agent.
 */
import { alert, api, button, h, mount, textField } from './lib.js';
import { P, restart } from './store.js';

const fresh = () => ({ mode: 'code', step: 'number', number: '', code: '', password: '', password2: '', invite: null, inviteKind: null, message: '', busy: false });

/** The sign-in form's state. */
let auth = fresh();

/** A message shown above the form the next time it is drawn (e.g. "Please sign in again."). */
export function setAuthMessage(message) {
  auth.message = message;
}

/** Shows the sign-in views; reads an invitation from the address (?invite=...) first. */
export async function showSignIn(params) {
  const invite = params.get('invite');
  if (invite && !auth.invite) {
    try {
      const info = await api('GET', '/api/auth/invite?code=' + encodeURIComponent(invite));
      auth.invite = invite;
      auth.inviteKind = info.kind;
    } catch (e) {
      auth.message = e.message;
    }
  }
  if (!P.sms && auth.inviteKind !== 'setup') auth.mode = 'password';
  renderAuth();
}

function legal() {
  return h('p', { class: 'muted small' }, h('a', { href: '/terms' }, 'Terms'), ' · ', h('a', { href: '/privacy' }, 'Privacy'), ' · ', h('a', { href: '/help' }, 'Help'));
}

function submit(label, busy) {
  return h('div', { class: 'actions' }, button({ label, variant: 'primary', type: 'submit', block: true, busy, size: 'lg' }));
}

export function renderAuth() {
  const a = auth;
  const set = patch => {
    Object.assign(a, patch);
    renderAuth();
  };
  const fail = err => set({ busy: false, message: err.message || 'Something went wrong.' });
  const signedIn = () => {
    auth = fresh();
    history.replaceState(null, '', location.pathname + location.hash);
    restart();
  };

  const numberField = textField({
    id: 'number',
    label: 'Your mobile number',
    type: 'tel',
    autocomplete: 'tel',
    inputmode: 'tel',
    required: true,
    placeholder: '(732) 555-0123',
    value: a.number,
    oninput: e => (a.number = e.target.value),
  });
  const notes = [];
  if (a.message) notes.push(alert({ kind: 'bad', role: 'alert' }, a.message));
  if (!a.invite && P.signup === 'invite') notes.push(alert({ kind: 'info' }, 'New accounts are by invitation. If you already have an account, sign in here.'));
  if (!a.invite && P.signup === 'closed') notes.push(alert({ kind: 'info' }, 'New sign-ups are closed. If you already have an account, sign in here.'));

  const form = (onsubmit, ...children) =>
    h(
      'form',
      {
        class: 'card login',
        onsubmit: e => {
          e.preventDefault();
          if (!a.busy) onsubmit();
        },
      },
      children,
    );

  let view;
  if (a.inviteKind === 'setup') {
    // An invitation made for one phone number: choose a password, no texted code.
    view = form(
      () => {
        if (a.password !== a.password2) return set({ message: 'The two passwords are not the same.' });
        set({ busy: true, message: '' });
        api('POST', '/api/auth/setup', { invite: a.invite, number: a.number, password: a.password }).then(signedIn, fail);
      },
      h('h2', {}, 'Set up your account'),
      notes,
      h('p', { class: 'muted' }, 'You were invited to Betaharah. Enter the phone number the invitation was made for, and choose a password.'),
      numberField,
      textField({ id: 'pw1', label: 'Choose a password', type: 'password', autocomplete: 'new-password', required: true, minlength: 10, value: a.password, help: 'At least 10 characters.', oninput: e => (a.password = e.target.value) }),
      textField({ id: 'pw2', label: 'The same password again', type: 'password', autocomplete: 'new-password', required: true, minlength: 10, value: a.password2, oninput: e => (a.password2 = e.target.value) }),
      submit('Create account', a.busy),
      legal(),
    );
  } else if (a.mode === 'password') {
    view = form(
      () => {
        set({ busy: true, message: '' });
        api('POST', '/api/auth/password', { number: a.number, password: a.password }).then(signedIn, fail);
      },
      h('h2', {}, 'Sign in'),
      notes,
      !P.sms ? h('p', { class: 'muted' }, 'Sign-in by text message is not available yet. Sign in with your password.') : null,
      numberField,
      textField({ id: 'pw', label: 'Password', type: 'password', autocomplete: 'current-password', required: true, value: a.password, oninput: e => (a.password = e.target.value) }),
      submit('Sign in', a.busy),
      P.sms ? h('p', {}, button({ label: 'Sign in with a texted code instead', variant: 'link', onclick: () => set({ mode: 'code', step: 'number', message: '' }) })) : null,
      legal(),
    );
  } else if (a.step === 'number') {
    view = form(
      () => {
        set({ busy: true, message: '' });
        api('POST', '/api/auth/code', { number: a.number, invite: a.invite || undefined }).then(() => set({ busy: false, step: 'code', code: '' }), fail);
      },
      h('h2', {}, 'Sign in or sign up'),
      notes,
      h('p', { class: 'muted' }, 'Enter your mobile number. We text you a 6-digit code. That is all it takes, the first time and every time.'),
      numberField,
      submit('Text me a code', a.busy),
      h('p', {}, button({ label: 'Sign in with a password instead', variant: 'link', onclick: () => set({ mode: 'password', message: '' }) })),
      h('p', { class: 'muted small' }, 'By asking for a code you agree to receive it by text message at this number. Message and data rates may apply. Reminders are sent only if you turn them on later.'),
      legal(),
    );
  } else {
    view = form(
      () => {
        set({ busy: true, message: '' });
        api('POST', '/api/auth/verify', { number: a.number, code: a.code, invite: a.invite || undefined }).then(signedIn, fail);
      },
      h('h2', {}, 'Enter the code'),
      notes,
      h('p', { class: 'muted' }, 'If ' + a.number + ' can sign in here, a 6-digit code was texted to it. It is good for 10 minutes.'),
      textField({
        id: 'code',
        label: 'Code',
        type: 'text',
        class: 'code',
        wide: false,
        autocomplete: 'one-time-code',
        inputmode: 'numeric',
        maxlength: 6,
        pattern: '[0-9]{6}',
        required: true,
        value: a.code,
        oninput: e => (a.code = e.target.value.replace(/\D/g, '')),
      }),
      submit('Sign in', a.busy),
      h('p', { class: 'small' }, button({ label: 'Use a different number, or send a new code', variant: 'link', onclick: () => set({ step: 'number', message: '' }) }), ' (a new code can be sent after one minute)'),
    );
  }
  mount([h('header', { class: 'top' }, h('h1', {}, h('a', { href: '/' }, 'Betaharah'))), view]);
  const first = view.querySelector(a.step === 'code' && a.mode === 'code' && !a.inviteKind ? '#code' : '#number');
  if (first && !a.busy) first.focus();
}
