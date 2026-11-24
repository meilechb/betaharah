/* Settings: Sign-in and security (how this phone signs in, the password, signing out). */
import { alert, api, button, confirmDialog, h, pretty, textField, toast } from '../../lib.js';
import { S, adopt, render, restart, signOutLocally } from '../../store.js';
import { attempt, refresh, region } from '../shared.js';
import { blockRow, group, infoRow } from './ui.js';

/** The password form and its errors. */
let pw = { a: '', b: '', errA: '', errB: '', error: '' };
let pwOpen = false;

function signOut(e) {
  attempt(() => api('POST', '/api/auth/logout'), {
    button: e.currentTarget,
    done: () => {
      signOutLocally();
      restart();
    },
  });
}

/** How this phone can sign in, in words. */
function ways() {
  const acc = S.account;
  if (S.sms.ready) return acc.hasPassword ? 'A code by text, or the password' : 'A code by text · no password';
  return acc.hasPassword ? 'Password' : 'No password set';
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
      textField({ id: 'npw1', label: acc.hasPassword ? 'New password' : 'Password', type: 'password', autocomplete: 'new-password', value: pw.a, help: 'At least 10 characters. A few words in a row are easy to remember.', error: pw.errA, oninput: e => (pw.a = e.target.value) }),
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
  const state = infoRow({ icon: 'lock', leadKind: acc.hasPassword ? 'ok' : null, title: acc.hasPassword ? 'A password is set' : 'No password', summary: acc.hasPassword ? 'You can sign in with it instead of waiting for a text.' : 'Optional. With a password you can sign in without waiting for a text.' });
  if (!acc.fresh) {
    return group(
      { title: 'Password', id: 'sec-password' },
      state,
      blockRow(
        alert(
          { kind: 'info', title: 'Sign in again first' },
          'To ' + (acc.hasPassword ? 'change or remove the password' : 'set a password') + ', sign out and sign in again, then come back here within 15 minutes. Signing in again confirms that it is you, and not someone using a device you left signed in.',
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
          !S.sms.ready ? h('p', { class: 'help' }, 'Sign-in by text message is not available on this site yet, so the password is the only way in and cannot be removed.') : null,
          pw.error ? alert({ kind: 'bad', role: 'alert' }, pw.error) : null,
        ),
  );
}

function view() {
  return {
    title: 'Sign-in and security',
    parent: '',
    body: [
      group(
        { title: 'This phone', id: 'sec-phone' },
        infoRow({ icon: 'phone', title: 'Signed in with ' + pretty(S.account.number), summary: 'Ways to sign in: ' + ways().replace(' · ', '; ').replace(/^./, c => c.toLowerCase()) + '.' }),
      ),
      passwordGroup(),
      group(
        { title: 'Sessions', id: 'sec-sessions' },
        blockRow(
          h('p', { class: 'help' }, 'Sign out here, or on every device where this phone number is signed in, for example after using a shared computer.'),
          h(
            'div',
            { class: 'actions' },
            button({ label: 'Sign out', icon: 'log-out', attrs: { id: 'sign-out' }, onclick: signOut }),
            button({
              label: 'Sign out everywhere',
              attrs: { id: 'sign-out-all' },
              onclick: async e => {
                const btn = e.currentTarget;
                if (!(await confirmDialog({ title: 'Sign out everywhere?', body: 'This signs out this phone number on every device, this one included. Other phones on the account stay signed in.', confirmLabel: 'Sign out everywhere' }))) return;
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
