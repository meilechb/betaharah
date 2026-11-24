/*
 * Settings: Sign-in and security (how this session signed in, Google sign-in,
 * the password, signing out).
 *
 * A session began either with a phone number (a texted code or the password)
 * or with Google. A password belongs to a phone number, so a session that
 * began with Google shows why it has no password controls.
 */
import { alert, api, button, confirmDialog, h, textField, toast } from '../../lib.js';
import { S, adopt, render, restart, signOutLocally } from '../../store.js';
import { attempt, googleInfo, googleSession, refresh, region, signOut, signedInWith } from '../shared.js';
import { blockRow, group, infoRow } from './ui.js';

/** The password form and its errors. */
let pw = { a: '', b: '', errA: '', errB: '', error: '' };
let pwOpen = false;

/** The server's own sentence for a session that began with Google. */
const GOOGLE_NO_PASSWORD = 'A password belongs to a phone number. Add a phone, sign in with it, and set the password there.';

/** How this account can be signed in to, as short parts: ['A code by text · no password', 'Google']. */
function wayParts() {
  const acc = S.account;
  const parts = [];
  if (googleSession()) {
    parts.push('Google');
    if (S.phones.length && S.sms.ready) parts.push('a code by text');
    return parts;
  }
  if (S.sms.ready) parts.push(acc.hasPassword ? 'A code by text, or the password' : 'A code by text · no password');
  else parts.push(acc.hasPassword ? 'Password' : 'No password set');
  if (acc.googleEmail) parts.push('Google');
  return parts;
}

/** The summary on the Settings home: "A code by text · no password · Google". */
const ways = () => wayParts().join(' · ');

/** The same as a sentence: "Ways to sign in: a code by text; no password; Google." */
function waysSentence() {
  const text = wayParts()
    .map(x => x.replace(' · ', '; '))
    .join('; ');
  return 'Ways to sign in: ' + (text.startsWith('Google') ? text : text.charAt(0).toLowerCase() + text.slice(1)) + '.';
}

function passwordForm() {
  const acc = S.account;
  return region('pw-form', () =>
    h(
      'form',
      {
        class: 'st-form',
        novalidate: true,
        onsubmit: e => {
          e.preventDefault();
          pw.errA = pw.a.length < 10 ? 'Use at least 10 characters.' : '';
          pw.errB = !pw.errA && pw.a !== pw.b ? 'The two passwords are not the same.' : '';
          pw.error = '';
          if (pw.errA || pw.errB) {
            refresh('pw-form');
            document.getElementById(pw.errA ? 'npw1' : 'npw2')?.focus();
            return;
          }
          const had = acc.hasPassword;
          attempt(
            async () => {
              await api('PUT', '/api/password', { password: pw.a });
              return api('GET', '/api/state');
            },
            {
              button: e.submitter || document.getElementById('pw-save'),
              done: r => {
                pw = { a: '', b: '', errA: '', errB: '', error: '' };
                pwOpen = false;
                adopt(r.state);
                render();
                toast((had ? 'The password is changed.' : 'The password is set.') + ' Other devices signed in with this phone were signed out.');
              },
              fail: message => {
                pw.errA = message;
                refresh('pw-form');
                document.getElementById('npw1')?.focus();
              },
            },
          );
        },
      },
      textField({ id: 'npw1', label: acc.hasPassword ? 'New password' : 'Password', type: 'password', autocomplete: 'new-password', value: pw.a, help: 'At least 10 characters.', error: pw.errA, oninput: e => (pw.a = e.target.value) }),
      textField({ id: 'npw2', label: 'The same password again', type: 'password', autocomplete: 'new-password', value: pw.b, error: pw.errB, oninput: e => (pw.b = e.target.value) }),
      pw.error ? alert({ kind: 'bad', role: 'alert' }, pw.error) : null,
      h(
        'div',
        { class: 'actions' },
        button({ label: acc.hasPassword ? 'Change password' : 'Set password', type: 'submit', variant: 'primary', icon: 'lock', attrs: { id: 'pw-save' } }),
        acc.hasPassword
          ? button({
              label: 'Cancel',
              attrs: { id: 'pw-cancel' },
              onclick: () => {
                pw = { a: '', b: '', errA: '', errB: '', error: '' };
                pwOpen = false;
                render();
                document.getElementById('pw-change')?.focus();
              },
            })
          : null,
      ),
    ),
  );
}

function removeButton() {
  return button({
    label: 'Remove password',
    variant: 'danger',
    attrs: { id: 'pw-remove' },
    onclick: async e => {
      const btn = e.currentTarget;
      if (!(await confirmDialog({ title: 'Remove the password?', body: 'You will sign in with a texted code only.', confirmLabel: 'Remove password', danger: true }))) return;
      attempt(
        async () => {
          await api('DELETE', '/api/password');
          return api('GET', '/api/state');
        },
        {
          button: btn,
          done: r => {
            adopt(r.state);
            render();
            toast('The password was removed.');
          },
          fail: message => {
            pw.error = message;
            render();
          },
        },
      );
    },
  });
}

function passwordGroup() {
  const acc = S.account;
  if (googleSession()) {
    // The server refuses to set or remove a password here; say why instead of offering it.
    return group({ title: 'Password', id: 'sec-password' }, infoRow({ icon: 'lock', title: 'No password in this session', summary: GOOGLE_NO_PASSWORD }));
  }
  const state = infoRow({ icon: 'lock', leadKind: acc.hasPassword ? 'ok' : null, title: acc.hasPassword ? 'A password is set' : 'No password', summary: acc.hasPassword ? null : 'Optional: sign in without waiting for a text.' });
  if (!acc.fresh) {
    return group(
      { title: 'Password', id: 'sec-password' },
      state,
      blockRow(
        alert(
          { kind: 'info', title: 'Sign in again first' },
          'To ' + (acc.hasPassword ? 'change or remove the password' : 'set a password') + ', sign out, sign in again and come back within 15 minutes.',
        ),
        h('div', { class: 'actions' }, button({ label: 'Sign out to sign in again', icon: 'log-out', attrs: { id: 'pw-relogin' }, onclick: signOut })),
      ),
    );
  }
  const showForm = !acc.hasPassword || pwOpen;
  return group(
    { title: 'Password', id: 'sec-password' },
    state,
    showForm
      ? blockRow(passwordForm())
      : blockRow(
          h(
            'div',
            { class: 'actions' },
            button({
              label: 'Change password',
              icon: 'lock',
              attrs: { id: 'pw-change' },
              onclick: () => {
                pwOpen = true;
                render();
                document.getElementById('npw1')?.focus();
              },
            }),
            S.sms.ready ? removeButton() : null,
          ),
          !S.sms.ready ? h('p', { class: 'help' }, 'Texting is not available here yet, so the password cannot be removed.') : null,
          pw.error ? alert({ kind: 'bad', role: 'alert' }, pw.error) : null,
        ),
  );
}

// ---------- Google sign-in ----------

const SVG = 'http://www.w3.org/2000/svg';

/** Google's standard four-colour "G" (18 × 18), as its branding guidelines require on a Google button. */
function googleG() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 18 18');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'gsi-logo');
  const paths = [
    ['#EA4335', 'M9 3.48c1.69 0 2.83.73 3.48 1.34l2.54-2.48C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.91 2.26C4.6 5.05 6.62 3.48 9 3.48z'],
    ['#4285F4', 'M17.64 9.2c0-.74-.06-1.28-.19-1.84H9v3.34h4.96c-.1.83-.64 2.08-1.84 2.92l2.84 2.2c1.7-1.57 2.68-3.88 2.68-6.62z'],
    ['#FBBC05', 'M3.88 10.78A5.54 5.54 0 0 1 3.58 9c0-.62.11-1.22.29-1.78L.96 4.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l2.92-2.26z'],
    ['#34A853', 'M9 18c2.43 0 4.47-.8 5.96-2.18l-2.84-2.2c-.76.53-1.78.9-3.12.9-2.38 0-4.4-1.57-5.12-3.74L.97 13.04C2.45 15.98 5.48 18 9 18z'],
  ];
  for (const [fill, d] of paths) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('fill', fill);
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

/**
 * The button that adds Google sign-in, drawn as Google's branding guidelines
 * ask for a custom button: the standard "G", one of the approved calls to
 * action ("Continue with Google"), Google's light or dark colours. A plain
 * link, so the browser goes to Google and comes back here.
 */
function googleButton() {
  return h('a', { class: 'gsi-button', href: '/api/auth/google/start', id: 'google-signin-add' }, h('span', { class: 'gsi-icon' }, googleG()), h('span', { class: 'gsi-text' }, 'Continue with Google'));
}

/** Google sign-in: the connected account, or the way to add one when the site offers Google. Nothing when neither. */
function googleGroup() {
  const email = S.account.googleEmail;
  if (email) {
    return group(
      { title: 'Google', id: 'sec-google' },
      infoRow({ icon: 'user', leadKind: 'ok', title: 'Google sign-in is on', summary: h('strong', { class: 'st-email' }, email) }),
    );
  }
  if (!googleInfo().available) return null;
  return group(
    { title: 'Google', id: 'sec-google' },
    infoRow({ icon: 'user', title: 'Add Google sign-in', summary: 'Sign in with a Google account as well as your phone.' }),
    blockRow(h('div', { class: 'actions' }, googleButton())),
  );
}

// ---------- the view ----------

function view() {
  const google = googleSession();
  return {
    title: 'Sign-in and security',
    parent: '',
    body: [
      group({ title: google ? 'This session' : 'This phone', id: 'sec-phone' }, infoRow({ icon: google ? 'user' : 'phone', title: 'Signed in with ' + signedInWith(), summary: waysSentence() })),
      googleGroup(),
      passwordGroup(),
      group(
        { title: 'Sessions', id: 'sec-sessions' },
        blockRow(
          h('p', { class: 'help' }, 'After using a shared computer, sign out everywhere.'),
          h(
            'div',
            { class: 'actions' },
            button({ label: 'Sign out', icon: 'log-out', attrs: { id: 'sign-out' }, onclick: signOut }),
            button({
              label: 'Sign out everywhere',
              attrs: { id: 'sign-out-all' },
              onclick: async e => {
                const btn = e.currentTarget;
                const body = google
                  ? 'This signs out the Google sign-in on every device, this one included. Phones on the account stay signed in.'
                  : 'This signs out this phone number on every device, this one included. Other phones on the account stay signed in.';
                if (!(await confirmDialog({ title: 'Sign out everywhere?', body, confirmLabel: 'Sign out everywhere' }))) return;
                attempt(() => api('POST', '/api/auth/logout-all'), {
                  button: btn,
                  done: () => {
                    signOutLocally();
                    restart();
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

export const signInSection = {
  id: 'security',
  title: 'Sign-in and security',
  icon: 'lock',
  summary: ways,
  flag: () => null,
  view,
};
