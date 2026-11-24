/* Settings: the Phones and text messages card. Next owner: the dashboard agent. */
import { alert, api, button, card, cardSection, checkRow, confirmDialog, h, pretty, tag, textField, toast } from '../../lib.js';
import { S, draft, render, restart, run, saved, signOutLocally } from '../../store.js';

/** The "add a phone" form. */
let adding = { step: 'idle', number: '', code: '' };

function phoneRow(p) {
  const sms = S.sms;
  const current = S.phones.find(x => x.number === p.number) || p;
  const key = p.number.replace(/\D/g, '');
  return h(
    'div',
    { class: 'phone' },
    h(
      'div',
      { class: 'number' },
      pretty(p.number),
      current.me ? tag('this phone', 'info') : null,
      !current.verified ? tag('not verified', 'warn') : null,
      current.optedOut ? tag('replied STOP', 'bad') : null,
    ),
    current.optedOut ? h('p', { class: 'help' }, 'This phone replied STOP, so nothing is sent to it. Text START from it to receive texts again.') : null,
    textField({ id: 'name-' + key, label: 'Name (optional)', value: p.name, maxlength: 40, oninput: e => (p.name = e.target.value) }),
    checkRow({ id: 'can-update-' + key, label: 'May record by text message', checked: p.canUpdate, onchange: e => (p.canUpdate = e.target.checked) }),
    checkRow({
      id: 'texts-' + key,
      label: 'Send text reminders to this phone',
      checked: p.texts,
      disabled: !current.verified,
      onchange: e => {
        p.texts = e.target.checked;
        render();
      },
    }),
    p.texts && !current.texts
      ? h('p', { class: 'help' }, 'By saving, the owner of this phone agrees to receive the reminders chosen below by text message from Betaharah. Message frequency varies. Message and data rates may apply. Reply STOP to stop, HELP for help.')
      : null,
    p.texts
      ? h(
          'fieldset',
          { class: 'plain' },
          h('legend', { class: 'small muted' }, 'Reminders this phone receives'),
          h(
            'div',
            { class: 'checks' },
            S.reminderKinds.map(k =>
              checkRow({
                id: 'rem-' + key + '-' + k,
                label: S.labels.reminders[k] || k,
                checked: p.reminders.includes(k),
                onchange: e => {
                  p.reminders = e.target.checked ? [...new Set([...p.reminders, k])] : p.reminders.filter(x => x !== k);
                },
              }),
            ),
          ),
        )
      : null,
    h(
      'div',
      { class: 'actions' },
      button({
        label: 'Save',
        variant: 'primary',
        onclick: e => run(() => api('PUT', '/api/phones', { number: p.number, name: p.name, canUpdate: p.canUpdate, reminders: p.reminders, texts: p.texts }), saved('Saved.'), e.currentTarget),
      }),
      sms.ready && current.verified && !current.optedOut
        ? button({ label: 'Send a test text', icon: 'message', onclick: e => run(() => api('POST', '/api/phones/test', { number: p.number }), saved('A test text was sent.'), e.currentTarget) })
        : null,
      sms.ready && !current.verified
        ? button({
            label: 'Verify this number',
            onclick: e =>
              run(
                () => api('POST', '/api/phones/code', { number: p.number }),
                r => {
                  adding = { step: 'code', number: r.number, code: '' };
                  render();
                  toast('A code was texted to ' + pretty(r.number) + '.');
                },
                e.currentTarget,
              ),
          })
        : null,
      S.phones.length > 1
        ? button({
            label: 'Remove',
            variant: 'danger',
            attrs: { 'aria-label': 'Remove ' + pretty(p.number) },
            onclick: async e => {
              const btn = e.currentTarget;
              const ok = await confirmDialog({
                title: 'Remove ' + pretty(p.number) + ' from this account?',
                body: current.me ? 'This is the phone you are signed in with; you will be signed out.' : null,
                confirmLabel: 'Remove',
                danger: true,
              });
              if (!ok) return;
              run(
                () => api('POST', '/api/phones/remove', { number: p.number }),
                r => {
                  if (r.signedOut) {
                    signOutLocally();
                    restart();
                    return;
                  }
                  saved('Removed.')(r);
                },
                btn,
              );
            },
          })
        : null,
    ),
  );
}

function addPart() {
  const sms = S.sms;
  if (!sms.ready) return h('p', { class: 'muted' }, 'A second phone can be added once text messaging is available on this site.');
  if (adding.step === 'code') {
    return h(
      'form',
      {
        onsubmit: e => {
          e.preventDefault();
          run(
            () => api('POST', '/api/phones/verify', { number: adding.number, code: adding.code }),
            r => {
              adding = { step: 'idle', number: '', code: '' };
              saved('The phone is on your account.')(r);
            },
            e.submitter,
          );
        },
      },
      textField({
        id: 'add-code',
        label: 'Code',
        help: 'A 6-digit code was texted to ' + pretty(adding.number) + '. Enter it here.',
        class: 'code',
        wide: false,
        autocomplete: 'one-time-code',
        inputmode: 'numeric',
        maxlength: 6,
        required: true,
        value: adding.code,
        oninput: e => (adding.code = e.target.value.replace(/\D/g, '')),
      }),
      h('div', { class: 'actions' }, button({ label: 'Confirm', variant: 'primary', type: 'submit' }), button({ label: 'Cancel', onclick: () => ((adding = { step: 'idle', number: '', code: '' }), render()) })),
    );
  }
  if (S.phones.length >= S.maxPhones) return h('p', { class: 'muted' }, 'This account has the most phones it can have (' + S.maxPhones + ').');
  return h(
    'form',
    {
      onsubmit: e => {
        e.preventDefault();
        run(
          () => api('POST', '/api/phones/code', { number: adding.number }),
          r => {
            adding = { step: 'code', number: r.number, code: '' };
            render();
          },
          e.submitter,
        );
      },
    },
    h('p', { class: 'help' }, 'For husband and wife to share this account. A code is texted to the phone; once it is entered here, that phone can sign in, record by text, and receive its own reminders. Add only a phone whose owner has agreed.'),
    textField({ id: 'add-number', label: 'Mobile number to add', type: 'tel', autocomplete: 'off', inputmode: 'tel', required: true, placeholder: '(732) 555-0123', value: adding.number, oninput: e => (adding.number = e.target.value) }),
    h('div', { class: 'actions' }, button({ label: 'Text a code to it', type: 'submit', icon: 'message' })),
  );
}

export function phonesCard() {
  const sms = S.sms;
  return card(
    { title: 'Phones and text messages' },
    sms.ready
      ? alert({ kind: 'ok' }, 'To record by text, send a text to ' + pretty(sms.number) + '. ' + sms.commands)
      : alert({ kind: 'info' }, 'Text messaging is not available on this site yet. Everything can be recorded here on the website.'),
    sms.ready ? h('p', { class: 'small muted' }, 'Texts sent to this account this month: ' + sms.usedThisMonth + ' of at most ' + sms.monthlyLimit + '.') : null,
    h('div', {}, draft.phones.map(phoneRow)),
    cardSection({ title: 'Add a phone' }, addPart()),
  );
}
