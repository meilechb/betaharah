/* Settings: the Signing in card (password, sessions, the guided setup). */
import { alert, api, button, card, cardSection, confirmDialog, h, pretty, textField, toast } from '../../lib.js';
import { S, adopt, render, restart, signOutLocally } from '../../store.js';
import { openGuidedSetup } from '../../onboarding.js';
import { attempt, refresh, region } from '../shared.js';

/** The password form and its errors. */
let pw = { a: '', b: '', errA: '', errB: '', error: '' };

function signOut(e) {
  attempt(() => api('POST', '/api/auth/logout'), {
    button: e.currentTarget,
    done: () => {
      signOutLocally();
      restart();
    },
  });
}

function passwordPart() {
  const acc = S.account;
  if (!acc.fresh) {
    return h(
      'p',
      { class: 'help' },
      (acc.hasPassword ? 'A password is set. To change or remove it' : 'No password is set; you sign in with a texted code. To set a password') +
        ', sign out and sign in again, then come back here within 15 minutes. Signing in again confirms it is you.',
    );
  }
  return region('pw-form', () =>
    h(
      'form',
      {
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
      h('p', { class: 'help' }, acc.hasPassword ? 'A password is set. You can change it here.' : 'Optional. With a password you can sign in without waiting for a text.'),
      textField({ id: 'npw1', label: 'New password', type: 'password', autocomplete: 'new-password', value: pw.a, help: 'At least 10 characters.', error: pw.errA, oninput: e => (pw.a = e.target.value) }),
      textField({ id: 'npw2', label: 'The same password again', type: 'password', autocomplete: 'new-password', value: pw.b, error: pw.errB, oninput: e => (pw.b = e.target.value) }),
      pw.error ? alert({ kind: 'bad', role: 'alert' }, pw.error) : null,
      h(
        'div',
        { class: 'actions' },
        button({ label: acc.hasPassword ? 'Change password' : 'Set password', type: 'submit', icon: 'lock', attrs: { id: 'pw-save' } }),
        acc.hasPassword && S.sms.ready
          ? button({
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
                      refresh('pw-form');
                    },
                  },
                );
              },
            })
          : null,
      ),
    ),
  );
}

export function signInCard() {
  return card(
    { title: 'Signing in', icon: 'lock' },
    h('p', {}, 'Signed in with ' + pretty(S.account.number) + '.'),
    cardSection({ title: 'Password' }, passwordPart()),
    cardSection(
      { title: 'Sessions' },
      h(
        'div',
        { class: 'actions' },
        button({ label: 'Sign out', icon: 'log-out', attrs: { id: 'sign-out' }, onclick: signOut }),
        button({
          label: 'Sign out everywhere',
          attrs: { id: 'sign-out-all' },
          onclick: async e => {
            const btn = e.currentTarget;
            if (!(await confirmDialog({ title: 'Sign out everywhere?', body: 'This signs out this phone number on every device, this one included.', confirmLabel: 'Sign out everywhere' }))) return;
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
    cardSection(
      { title: 'Guided setup' },
      h('p', { class: 'help' }, 'The steps shown when the account was new: location, customs and the first dates.'),
      button({ label: 'Open the guided setup again', variant: 'link', attrs: { id: 'open-setup' }, onclick: () => openGuidedSetup() }),
    ),
  );
}
