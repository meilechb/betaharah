/*
 * Every sign-in, sign-up and invitation view. Shown when nobody is signed in.
 * Owner: the sign-up agent.
 *
 * The usual way in: a mobile number, then the 6-digit code texted to it.
 * Also: a password (optional), an invitation link (?invite=, kinds "signup"
 * and "setup"), and a one-time sign-in link texted by the site (?k=).
 * The server answers "code sent" in the same way whether or not a number may
 * sign in, so the wording here never claims that a code was sent.
 */
import { alert, api, button, checkRow, h, icon, mount, pageLoading, pretty, setFieldError, textField } from './lib.js';
import { P, restart } from './store.js';
import { codeField, messageOf, phoneField, readNumber } from './setup/phone.js';

const fresh = () => ({
  mode: 'code', // 'code' | 'password'
  step: 'number', // 'number' | 'code' (code mode only)
  number: '',
  sentTo: '', // the number in +1 form a code was asked for
  sentAt: 0,
  code: '',
  password: '',
  password2: '',
  showPassword: false,
  invite: null,
  inviteKind: null,
  inviteProblem: '',
  linkTried: false,
  linkProblem: '',
  message: '', // a note about the whole page ("Please sign in again.")
  errors: {}, // field id -> message
  status: '', // a polite note under the resend button
  busy: false,
  focus: null, // the id to focus after the next draw
});

/** The sign-in form's state. */
let auth = fresh();
let ticker = null;

/** A message shown above the form the next time it is drawn (e.g. "Please sign in again."). */
export function setAuthMessage(message) {
  auth.message = message;
}

/** Takes one parameter out of the address without reloading. */
function dropParam(name) {
  const params = new URLSearchParams(location.search);
  if (!params.has(name)) return;
  params.delete(name);
  const q = params.toString();
  history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
}

function brand() {
  return h('header', { class: 'top auth-brand' }, h('h1', {}, h('a', { href: '/' }, 'Betaharah')));
}

/** Shows the sign-in views; first handles a sign-in link (?k=...) and an invitation (?invite=...). */
export async function showSignIn(params) {
  const token = params.get('k');
  if (token && !auth.linkTried) {
    auth.linkTried = true;
    mount(h('div', { class: 'auth' }, brand(), pageLoading('Signing you in…')));
    try {
      await api('POST', '/api/auth/link', { token });
      auth = fresh();
      dropParam('k');
      restart();
      return;
    } catch (e) {
      dropParam('k');
      auth.linkProblem =
        e && e.status !== undefined
          ? 'This link has expired or was already used. Sign in below instead.'
          : 'The link could not be checked because the site could not be reached. Check the internet connection and open the link again, or sign in below.';
    }
  }
  const invite = params.get('invite');
  if (invite && !auth.invite && !auth.inviteProblem) {
    try {
      const info = await api('GET', '/api/auth/invite?code=' + encodeURIComponent(invite));
      auth.invite = invite;
      auth.inviteKind = info.kind;
    } catch (e) {
      auth.inviteProblem = e && e.status === 404 ? 'This invitation link is not valid any more: it was used already or it has expired. Ask the person who sent it for a new one.' : messageOf(e);
    }
  }
  if (!P.sms && auth.inviteKind !== 'setup') auth.mode = 'password';
  renderAuth();
}

function legal() {
  return h('p', { class: 'legal muted small' }, h('a', { href: '/terms' }, 'Terms'), ' · ', h('a', { href: '/privacy' }, 'Privacy'), ' · ', h('a', { href: '/help' }, 'Help'));
}

function submit(label, busy) {
  return h('div', { class: 'actions' }, button({ label, variant: 'primary', type: 'submit', block: true, busy, size: 'lg' }));
}

function linkRow(label, onclick) {
  return h('p', { class: 'link-row' }, button({ label, variant: 'link', onclick }));
}

const mmss = seconds => Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');

/** Which field a refusal from the server is about, on each screen. */
function fieldForError(screen, message) {
  if (screen === 'code') return 'code';
  if (screen === 'setup') {
    if (/password/i.test(message)) return 'pw1';
    return 'number';
  }
  if (screen === 'password') {
    if (/^(Enter a phone number|Only numbers|That (number|phone number)|The number)/i.test(message)) return 'number';
    return 'pw';
  }
  return 'number';
}

export function renderAuth() {
  clearInterval(ticker);
  ticker = null;
  const a = auth;
  const set = patch => {
    Object.assign(a, patch);
    renderAuth();
  };
  const fail = screen => err => {
    const message = messageOf(err);
    const id = fieldForError(screen, message);
    const patch = { busy: false, errors: { [id]: message }, focus: id };
    if (id === 'code') patch.code = '';
    set(patch);
  };
  const signedIn = () => {
    auth = fresh();
    dropParam('invite');
    restart();
  };
  /** Checks the typed number; on a mistake shows it under the field and returns null. */
  const checkedNumber = () => {
    const read = readNumber(a.number, P.prefixes);
    if (read.error) {
      set({ errors: { number: read.error }, focus: 'number' });
      return null;
    }
    return read.number;
  };
  const err = id => a.errors[id] || '';
  const clearError = id => {
    if (!a.errors[id]) return;
    delete a.errors[id];
    const input = document.getElementById(id);
    const wrap = input && input.closest('.field');
    if (wrap) setFieldError(wrap, '');
  };

  const numberField = () =>
    phoneField({
      id: 'number',
      label: 'Your mobile number',
      value: a.number,
      error: err('number'),
      onvalue: v => {
        a.number = v;
        clearError('number');
      },
    });

  const passwordToggle = () =>
    checkRow({
      id: 'show-pw',
      label: 'Show the password',
      checked: a.showPassword,
      onchange: e => {
        a.showPassword = e.target.checked;
        document.querySelectorAll('input.pw').forEach(el => (el.type = a.showPassword ? 'text' : 'password'));
      },
    });
  const pwType = () => (a.showPassword ? 'text' : 'password');

  // Notes about the whole page, one sentence each.
  const notes = [];
  if (a.message) notes.push(alert({ kind: 'info' }, a.message));
  if (a.linkProblem) notes.push(alert({ kind: 'bad', role: 'alert' }, a.linkProblem));
  if (a.inviteProblem) notes.push(alert({ kind: 'bad', role: 'alert' }, a.inviteProblem));
  if (!a.invite && P.signup === 'invite') notes.push(alert({ kind: 'info' }, 'New accounts are by invitation only. If you already have an account, sign in here.'));
  if (!a.invite && P.signup === 'closed') notes.push(alert({ kind: 'info' }, 'New accounts cannot be opened at the moment. If you already have an account, sign in here.'));

  const form = (screen, onsubmit, ...children) =>
    h(
      'form',
      {
        class: 'card login auth-card',
        novalidate: true,
        'data-screen': screen,
        onsubmit: e => {
          e.preventDefault();
          if (!a.busy) onsubmit();
        },
      },
      children,
    );

  let view;
  let aside = null;
  if (a.inviteKind === 'setup') {
    // An invitation made for one phone number: choose a password, no texted code.
    view = form(
      'setup',
      () => {
        const number = checkedNumber();
        if (!number) return;
        if (a.password.length < 10) return set({ errors: { pw1: 'A password needs at least 10 characters.' }, focus: 'pw1' });
        if (a.password !== a.password2) return set({ errors: { pw2: 'The two passwords are not the same. Type the same password in both boxes.' }, focus: 'pw2' });
        set({ busy: true, errors: {}, message: '' });
        api('POST', '/api/auth/setup', { invite: a.invite, number, password: a.password }).then(signedIn, fail('setup'));
      },
      h('h2', {}, 'Set up your account'),
      notes,
      h('p', { class: 'muted' }, 'You were invited to Betaharah. Enter the mobile number the invitation was made for, and choose a password.'),
      numberField(),
      textField({
        id: 'pw1',
        label: 'Choose a password',
        type: pwType(),
        class: 'pw',
        autocomplete: 'new-password',
        required: true,
        minlength: 10,
        value: a.password,
        help: 'At least 10 characters. A few ordinary words in a row work well.',
        error: err('pw1'),
        oninput: e => {
          a.password = e.target.value;
          clearError('pw1');
        },
      }),
      textField({
        id: 'pw2',
        label: 'The same password again',
        type: pwType(),
        class: 'pw',
        autocomplete: 'new-password',
        required: true,
        minlength: 10,
        value: a.password2,
        error: err('pw2'),
        oninput: e => {
          a.password2 = e.target.value;
          clearError('pw2');
        },
      }),
      passwordToggle(),
      submit('Create account', a.busy),
      linkRow('I already have an account', () => {
        auth = { ...fresh(), number: a.number, mode: P.sms ? 'code' : 'password', focus: 'number' };
        dropParam('invite');
        renderAuth();
      }),
      legal(),
    );
  } else if (a.mode === 'password') {
    const signupInviteWithoutTexts = a.inviteKind === 'signup' && !P.sms;
    view = form(
      'password',
      () => {
        const number = checkedNumber();
        if (!number) return;
        if (!a.password) return set({ errors: { pw: 'Enter your password.' }, focus: 'pw' });
        set({ busy: true, errors: {}, message: '' });
        api('POST', '/api/auth/password', { number, password: a.password }).then(signedIn, fail('password'));
      },
      h('h2', {}, 'Sign in with a password'),
      notes,
      signupInviteWithoutTexts
        ? alert({ kind: 'info' }, 'This invitation is used with a code sent by text message, which this site cannot send yet; open the link again later.')
        : !P.sms
          ? alert({ kind: 'info' }, 'Sign-in by text message is not available yet, so sign in with your password.')
          : null,
      numberField(),
      textField({
        id: 'pw',
        label: 'Password',
        type: pwType(),
        class: 'pw',
        autocomplete: 'current-password',
        required: true,
        value: a.password,
        error: err('pw'),
        oninput: e => {
          a.password = e.target.value;
          clearError('pw');
        },
      }),
      passwordToggle(),
      submit('Sign in', a.busy),
      P.sms ? linkRow('Sign in with a texted code instead', () => set({ mode: 'code', step: 'number', errors: {}, message: '', focus: 'number' })) : null,
      P.sms ? h('p', { class: 'muted small' }, 'A password is optional. Without one, sign in with a code texted to your phone.') : null,
      legal(),
    );
  } else if (a.step === 'number') {
    const signup = a.inviteKind === 'signup';
    view = form(
      'number',
      () => {
        const number = checkedNumber();
        if (!number) return;
        set({ busy: true, errors: {}, message: '' });
        api('POST', '/api/auth/code', { number, invite: a.invite || undefined }).then(
          () => set({ busy: false, step: 'code', sentTo: number, sentAt: Date.now(), code: '', status: '', focus: 'code' }),
          fail('number'),
        );
      },
      h('h2', {}, signup ? 'Create your account' : P.signup === 'open' ? 'Sign in or sign up' : 'Sign in'),
      notes,
      h(
        'p',
        { class: 'muted' },
        signup
          ? 'You were invited to Betaharah. Enter your mobile number, and we text you a 6-digit code to open your account.'
          : 'Enter your mobile number. We text you a 6-digit code. That is all it takes, the first time and every time.',
      ),
      numberField(),
      submit('Text me a code', a.busy),
      h('p', { class: 'consent muted small' }, 'By asking for a code you agree to receive it by text message at this number. Message and data rates may apply. Reminders are sent only if you turn them on later.'),
      linkRow('Sign in with a password instead', () => set({ mode: 'password', errors: {}, message: '', focus: 'number' })),
      legal(),
    );
    if (P.textingNumber && !a.invite) {
      aside = h(
        'p',
        { class: 'auth-aside muted' },
        icon('message'),
        h('span', {}, 'No internet at home? Text ', h('strong', {}, 'JOIN'), ' to ', h('a', { href: 'sms:' + P.textingNumber, class: 'nowrap' }, pretty(P.textingNumber)), ' and set everything up by text.'),
      );
    }
  } else {
    const minutes = P.codeMinutes || 10;
    view = form(
      'code',
      () => {
        if (a.code.length !== 6) return set({ errors: { code: 'Type all 6 digits of the code.' }, focus: 'code' });
        set({ busy: true, errors: {}, message: '', status: '' });
        api('POST', '/api/auth/verify', { number: a.sentTo, code: a.code, invite: a.invite || undefined }).then(signedIn, fail('code'));
      },
      h('h2', {}, 'Enter the code'),
      notes,
      h('p', {}, 'If this number can sign in here, a 6-digit code is on its way to ', h('strong', { class: 'nowrap' }, pretty(a.sentTo)), '.'),
      h('p', { class: 'muted small' }, 'The code works for ' + minutes + ' minutes. It can take a minute to arrive.'),
      codeField({
        id: 'code',
        label: 'The 6-digit code',
        value: a.code,
        error: err('code'),
        onvalue: v => {
          a.code = v;
          clearError('code');
        },
        oncomplete: code => {
          if (a.busy) return;
          a.code = code;
          const formEl = document.querySelector('form[data-screen="code"]');
          if (formEl) formEl.requestSubmit();
        },
      }),
      submit('Sign in', a.busy),
      h('div', { class: 'resend', id: 'resend' }),
      h('p', { class: 'muted small', id: 'resend-status', role: 'status' }, a.status),
      linkRow('Use a different number', () => set({ step: 'number', errors: {}, message: '', status: '', focus: 'number' })),
      h(
        'details',
        { class: 'auth-help' },
        h('summary', {}, icon('chevron-right', { size: 'sm' }), 'I did not get a code'),
        h(
          'ul',
          {},
          h('li', {}, 'Wait a minute. Text messages sometimes arrive late.'),
          h('li', {}, 'Check the number above. If it is not right, choose “Use a different number”.'),
          h(
            'li',
            {},
            P.signup === 'open'
              ? 'A code is sent only to a number that can sign in here.'
              : 'A code is sent only to a number that already has an account here' + (a.invite ? ', or that uses a valid invitation.' : '. New accounts are by invitation.'),
          ),
          h('li', {}, 'If you set a password, you can sign in with it instead.'),
          P.contactEmail ? h('li', {}, 'Still nothing? Write to ' + (P.contactName || 'us') + ' at ', h('a', { href: 'mailto:' + P.contactEmail }, P.contactEmail), '.') : null,
        ),
      ),
    );
  }

  mount(h('div', { class: 'auth' }, brand(), view, aside));

  if (a.step === 'code' && a.mode === 'code' && !a.inviteKind) startResendTicker();

  const focusId = a.focus || (a.busy ? null : a.inviteKind === 'setup' || a.mode === 'password' || a.step === 'number' ? 'number' : 'code');
  a.focus = null;
  const el = focusId ? document.getElementById(focusId) : null;
  if (el && !a.busy) {
    el.focus();
    if (el.select && a.errors[focusId] && focusId !== 'code') el.select();
  }
}

/** The countdown until another code may be asked for, then the button. Updated in place, so the focus stays where it is. */
function startResendTicker() {
  const a = auth;
  const wait = P.resendSeconds || 60;
  const box = document.getElementById('resend');
  if (!box) return;
  const draw = () => {
    const left = Math.max(0, Math.ceil((a.sentAt + wait * 1000 - Date.now()) / 1000));
    if (left > 0) {
      box.replaceChildren(h('p', { class: 'muted small countdown' }, icon('clock', { size: 'sm' }), h('span', {}, 'You can ask for a new code in ' + mmss(left) + '.')));
      return;
    }
    clearInterval(ticker);
    ticker = null;
    box.replaceChildren(
      h(
        'p',
        { class: 'link-row' },
        button({
          label: 'Text me a new code',
          variant: 'link',
          attrs: { id: 'resend-button' },
          onclick: e => {
            const btn = e.currentTarget;
            btn.disabled = true;
            api('POST', '/api/auth/code', { number: a.sentTo, invite: a.invite || undefined }).then(
              () => {
                Object.assign(a, { sentAt: Date.now(), code: '', errors: {}, status: 'A new code was asked for. If this number can sign in here, it is on its way. Use the newest code.', focus: 'code' });
                renderAuth();
              },
              err => {
                Object.assign(a, { errors: { code: messageOf(err) }, status: '', focus: 'code' });
                renderAuth();
              },
            );
          },
        }),
      ),
    );
  };
  draw();
  if (!ticker && Date.now() < a.sentAt + wait * 1000) ticker = setInterval(draw, 1000);
}
