/* Settings: the Phones card (each phone, what it may do, its reminders; adding a phone). */
import { alert, api, button, card, cardSection, checkRow, confirmDialog, h, icon, pretty, tag, textField } from '../../lib.js';
import { S, restart, signOutLocally } from '../../store.js';
import { attempt, refresh, region, saveChange, saveStatus } from '../shared.js';

/** The two-step "add a phone" (or "verify this number") flow. */
const idle = () => ({ step: 'number', number: '', code: '', demoCode: null, error: '', forExisting: false });
let adding = idle();
/** Phones whose consent to text reminders is being shown before turning them on. */
const consenting = new Set();
/** Names being typed. */
const names = {};

const keyOf = number => number.replace(/\D/g, '');

function savePhone(p, change, message) {
  const body = { number: p.number, name: p.name, canUpdate: p.canUpdate, reminders: [...p.reminders], texts: p.texts };
  change(body);
  return saveChange('phones', () => api('PUT', '/api/phones', body), { message });
}

function reasonOff(p) {
  if (!S.sms.ready) return 'Text messaging is not available on this site yet.';
  if (!p.verified) return 'Verify this number with a texted code first; then reminders can be sent to it.';
  return null;
}

function requestCode(number, btn, forExisting) {
  adding.error = '';
  attempt(() => api('POST', '/api/phones/code', { number }), {
    button: btn,
    done: r => {
      adding = { ...idle(), step: 'code', number: r.number, demoCode: r.demoCode || null, forExisting: Boolean(forExisting) };
      refresh('phone-add');
      document.getElementById('phone-add')?.scrollIntoView({ block: 'nearest' });
      document.getElementById('add-code')?.focus();
    },
    fail: message => {
      adding.error = message;
      if (forExisting) adding = { ...idle(), error: message, forExisting: true, number };
      refresh('phone-add');
      document.getElementById(forExisting ? 'phone-add-error' : 'add-number')?.focus();
    },
  });
}

function phoneRow(p) {
  const key = keyOf(p.number);
  const off = reasonOff(p);
  const showConsent = consenting.has(p.number) && !p.texts;
  return h(
    'li',
    { class: 'phone-row' },
    h(
      'div',
      { class: 'phone-head' },
      icon('phone'),
      h('div', { class: 'phone-id' }, h('strong', {}, p.name || 'Phone'), h('span', { class: 'phone-number' }, pretty(p.number))),
      h(
        'div',
        { class: 'phone-tags' },
        p.me ? tag('this phone', 'info') : null,
        !p.verified ? tag('not verified', 'warn') : null,
        p.optedOut ? tag('replied STOP', 'bad') : null,
        p.texts && !p.optedOut ? tag('gets reminders', 'ok') : null,
      ),
    ),
    p.optedOut ? alert({ kind: 'warn' }, 'This phone replied STOP, so nothing is sent to it. Text START from it to receive texts again.') : null,
    h(
      'div',
      { class: 'phone-body' },
      h('p', { class: 'sub-title' }, 'What it may do'),
      checkRow({
        id: 'can-update-' + key,
        label: 'Record by text message',
        help: 'Texts from this phone, such as 1 or 2, are recorded.',
        checked: p.canUpdate,
        onchange: e => {
          const on = e.target.checked;
          savePhone(p, b => (b.canUpdate = on));
        },
      }),
      checkRow({
        id: 'texts-' + key,
        label: 'Receive text reminders',
        help: off || (p.texts ? 'The reminders chosen below are texted to this phone.' : 'Nothing is texted to this phone.'),
        checked: p.texts || showConsent,
        disabled: Boolean(off),
        onchange: e => {
          if (e.target.checked) {
            consenting.add(p.number);
            refresh('phones-list');
            document.getElementById('consent-ok-' + key)?.focus();
          } else {
            consenting.delete(p.number);
            savePhone(p, b => (b.texts = false), 'Reminders turned off');
          }
        },
      }),
      showConsent
        ? h(
            'div',
            { class: 'consent', role: 'group', 'aria-labelledby': 'consent-text-' + key },
            h('p', { id: 'consent-text-' + key }, 'By turning this on, the owner of this phone agrees to receive the reminders chosen below by text message from Betaharah. Message frequency varies. Message and data rates may apply. Reply STOP to stop, HELP for help.'),
            h(
              'div',
              { class: 'actions' },
              button({
                label: 'Turn on text reminders',
                variant: 'primary',
                size: 'sm',
                attrs: { id: 'consent-ok-' + key },
                onclick: () => {
                  consenting.delete(p.number);
                  savePhone(p, b => (b.texts = true), 'Reminders turned on');
                },
              }),
              button({
                label: 'Cancel',
                size: 'sm',
                attrs: { id: 'consent-no-' + key },
                onclick: () => {
                  consenting.delete(p.number);
                  refresh('phones-list');
                },
              }),
            ),
          )
        : null,
      p.texts
        ? h(
            'fieldset',
            { class: 'plain phone-reminders' },
            h('legend', { class: 'sub-title' }, 'Reminders it receives'),
            h(
              'div',
              { class: 'checks' },
              S.reminderKinds.map(k =>
                checkRow({
                  id: 'rem-' + key + '-' + k,
                  label: S.labels.reminders[k] || k,
                  checked: p.reminders.includes(k),
                  onchange: e => {
                    const on = e.target.checked;
                    savePhone(p, b => (b.reminders = on ? [...new Set([...b.reminders, k])] : b.reminders.filter(x => x !== k)));
                  },
                }),
              ),
            ),
          )
        : null,
      h(
        'div',
        { class: 'actions' },
        S.sms.ready && p.verified && !p.optedOut
          ? button({
              label: 'Send a test text',
              icon: 'message',
              size: 'sm',
              attrs: { id: 'test-' + key },
              onclick: () => saveChange('phones', () => api('POST', '/api/phones/test', { number: p.number }), { message: S.demo ? 'A test text was simulated' : 'A test text was sent' }),
            })
          : null,
        S.sms.ready && !p.verified ? button({ label: 'Verify this number', size: 'sm', variant: 'primary', attrs: { id: 'verify-' + key }, onclick: e => requestCode(p.number, e.currentTarget, true) }) : null,
      ),
      h(
        'details',
        { class: 'more', id: 'phone-more-' + key },
        h('summary', {}, 'More'),
        h(
          'div',
          { class: 'field' },
          h('label', { for: 'name-' + key }, 'Name shown here (optional)'),
          h('input', {
            id: 'name-' + key,
            type: 'text',
            class: 'wide',
            maxlength: 40,
            value: names[p.number] !== undefined ? names[p.number] : p.name,
            oninput: e => (names[p.number] = e.target.value),
            onchange: e => {
              const v = e.target.value.trim();
              delete names[p.number];
              if (v !== p.name) savePhone(p, b => (b.name = v));
            },
          }),
        ),
        S.phones.length > 1
          ? button({
              label: 'Remove this phone',
              variant: 'danger',
              size: 'sm',
              icon: 'trash',
              attrs: { id: 'remove-' + key },
              onclick: async e => {
                const btn = e.currentTarget;
                const ok = await confirmDialog({
                  title: 'Remove ' + pretty(p.number) + ' from this account?',
                  body: p.me ? 'This is the phone you are signed in with. You will be signed out.' : 'It can no longer sign in to this account, record by text, or receive reminders.',
                  confirmLabel: 'Remove phone',
                  danger: true,
                });
                if (!ok) return;
                attempt(() => api('POST', '/api/phones/remove', { number: p.number }), {
                  button: btn,
                  done: r => {
                    if (r.signedOut) {
                      signOutLocally();
                      restart();
                      return;
                    }
                    saveChange('phones', () => Promise.resolve(r), { message: 'Removed' });
                  },
                });
              },
            })
          : h('p', { class: 'help' }, 'This is the only phone on the account, so it cannot be removed. To leave, delete the account under Your data.'),
      ),
    ),
  );
}

function addPart() {
  return region('phone-add', () => {
    if (!S.sms.ready) return h('div', {}, h('p', { class: 'help' }, 'A second phone can be added once text messaging is available on this site.'));
    if (adding.step === 'code') {
      return h(
        'form',
        {
          class: 'add-phone',
          novalidate: true,
          onsubmit: e => {
            e.preventDefault();
            if (!/^\d{6}$/.test(adding.code)) {
              adding.error = 'Enter the 6 digits of the code.';
              refresh('phone-add');
              document.getElementById('add-code')?.focus();
              return;
            }
            attempt(() => api('POST', '/api/phones/verify', { number: adding.number, code: adding.code }), {
              button: e.submitter || document.getElementById('add-confirm'),
              done: r => {
                const existing = adding.forExisting;
                adding = idle();
                saveChange('phones', () => Promise.resolve(r), { message: existing ? 'The number is verified' : 'The phone is on your account' });
              },
              fail: message => {
                adding.error = message;
                refresh('phone-add');
                document.getElementById('add-code')?.focus();
              },
            });
          },
        },
        h('p', { class: 'step' }, adding.forExisting ? 'Verify ' + pretty(adding.number) : 'Step 2 of 2: the code'),
        adding.demoCode
          ? alert({ kind: 'info', title: 'The code is ' + adding.demoCode }, 'In the test account the code is shown here instead of being texted.')
          : h('p', { class: 'help' }, 'A 6-digit code was texted to ' + pretty(adding.number) + '. It is valid for a few minutes.'),
        textField({
          id: 'add-code',
          label: 'Code',
          class: 'code',
          wide: false,
          autocomplete: 'one-time-code',
          inputmode: 'numeric',
          maxlength: 6,
          value: adding.code,
          error: adding.error,
          oninput: e => (adding.code = e.target.value.replace(/\D/g, '')),
        }),
        h(
          'div',
          { class: 'actions' },
          button({ label: adding.forExisting ? 'Verify' : 'Add this phone', variant: 'primary', type: 'submit', attrs: { id: 'add-confirm' } }),
          button({
            label: 'Cancel',
            attrs: { id: 'add-cancel' },
            onclick: () => {
              adding = idle();
              refresh('phone-add');
            },
          }),
        ),
      );
    }
    if (adding.forExisting && adding.error) {
      return h(
        'div',
        {},
        alert({ kind: 'bad', role: 'alert' }, h('span', { id: 'phone-add-error', tabindex: '-1' }, adding.error)),
        button({ label: 'Close', size: 'sm', onclick: () => ((adding = idle()), refresh('phone-add')) }),
      );
    }
    if (S.phones.length >= S.maxPhones) return h('div', {}, h('p', { class: 'help' }, 'This account has the most phones it can have (' + S.maxPhones + ').'));
    return h(
      'form',
      {
        class: 'add-phone',
        novalidate: true,
        onsubmit: e => {
          e.preventDefault();
          const digits = adding.number.replace(/\D/g, '');
          if (digits.length < 10) {
            adding.error = 'Enter the full mobile number, with its area code.';
            refresh('phone-add');
            document.getElementById('add-number')?.focus();
            return;
          }
          requestCode(adding.number, e.submitter || document.getElementById('add-send'), false);
        },
      },
      h('p', { class: 'help' }, 'For husband and wife to share this account. Once the code texted to it is entered here, that phone can sign in, record by text, and receive its own reminders. Add only a phone whose owner has agreed.'),
      h('p', { class: 'step' }, 'Step 1 of 2: the number'),
      textField({
        id: 'add-number',
        label: 'Mobile number to add',
        type: 'tel',
        autocomplete: 'off',
        inputmode: 'tel',
        placeholder: S.demo ? '(732) 555-0150' : '(732) 555-0123',
        help: S.demo ? 'The test account takes only made-up numbers, from 555-0100 to 555-0199.' : null,
        value: adding.number,
        error: adding.error,
        oninput: e => (adding.number = e.target.value),
      }),
      button({ label: 'Text a code to it', type: 'submit', icon: 'message', attrs: { id: 'add-send' } }),
    );
  });
}

export function phonesCard() {
  return card(
    { title: 'Phones', icon: 'phone', headerAction: saveStatus('phones'), className: 'phones-card' },
    h('p', { class: 'card-intro' }, 'Up to ' + S.maxPhones + ' phones share this account. Each one chooses what it may do and which reminders it receives.'),
    region('phones-list', () => h('ul', { class: 'phones' }, S.phones.map(phoneRow))),
    cardSection({ title: 'Add a phone' }, addPart()),
  );
}
