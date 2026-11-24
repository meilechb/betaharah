/*
 * Setup steps after the dates: the calendar app (optional), phones and text
 * reminders (optional), and the last screen.
 */
import { alert, api, button, checkRow, copyField, h, icon, linkButton, pretty, withBusy } from '../lib.js';
import { P, S, adopt, render, t } from '../store.js';
import { back, finish, flow, goTo, next, onEnter, ownPhone, problem, screen, viaGoogle } from './flow.js';
import { codeField, phoneField, readNumber } from './phone.js';
import { smsConsent } from '../auth.js';

/**
 * The text commands as a table, from S.sms.commandList. They are what is
 * typed and what the replies say, so they stay in English letters whatever
 * the choice of terms; the last line says so.
 */
function commandsTable(sms) {
  return [
    h(
      'table',
      { class: 'commands' },
      h('caption', { class: 'visually-hidden' }, 'Text commands'),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Text'), h('th', { scope: 'col' }, 'What it does'))),
      h(
        'tbody',
        {},
        (sms.commandList || []).map(r => h('tr', {}, h('td', {}, h('kbd', {}, r.text)), h('td', {}, r.meaning))),
      ),
    ),
    sms.commandNote ? h('p', { class: 'help' }, sms.commandNote) : null,
  ];
}

// ===================== the calendar app =====================

let calError = '';
onEnter('calendar', () => (calError = ''));

export function calendarView() {
  const cal = S.calendar;
  const done = cal.google.connected || Boolean(cal.link);
  return screen({
    title: 'Calendar app',
    body: [
      cal.google.available
        ? h(
            'div',
            { class: 'setup-option' },
            h('h3', {}, icon('calendar'), 'Google Calendar'),
            h('p', { class: 'muted' }, 'Adds one calendar. Sees nothing else.'),
            cal.google.connected
              ? alert({ kind: 'ok' }, 'Connected: “' + S.app.calendar.name + '”.')
              : h('div', { class: 'actions' }, linkButton({ href: '/api/google/start', label: 'Connect Google Calendar', attrs: { id: 'sc-google' } })),
          )
        : null,
      h(
        'div',
        { class: 'setup-option' },
        h('h3', {}, icon('link'), 'Subscription link'),
        cal.link
          ? h(
              'div',
              {},
              copyField({ value: cal.link }),
              h('p', { class: 'help' }, 'Anyone with this link can read the calendar.'),
              h('div', { class: 'actions' }, linkButton({ href: cal.link.replace(/^https?:/, 'webcal:'), label: 'Open in calendar', icon: 'calendar' })),
            )
          : h(
              'div',
              {},
              h('p', { class: 'muted' }, 'Apple, Outlook or Google.'),
              h(
                'div',
                { class: 'actions' },
                button({
                  label: 'Create link',
                  attrs: { id: 'sc-link' },
                  onclick: e =>
                    withBusy(e.currentTarget, () => api('POST', '/api/calendar-link')).then(
                      r => {
                        adopt(r.state);
                        calError = '';
                        flow.focus = 'sc-link-ready';
                        render();
                      },
                      err => {
                        calError = problem(err);
                        render();
                      },
                    ),
                }),
              ),
            ),
        cal.link ? h('span', { id: 'sc-link-ready', tabindex: '-1', class: 'visually-hidden' }, 'The link is ready.') : null,
        calError ? h('p', { class: 'setup-error', role: 'alert' }, icon('alert', { size: 'sm' }), h('span', {}, calError)) : null,
      ),
    ],
    back,
    skip: done ? null : { label: 'Skip', onclick: next },
    main: done ? { label: 'Continue', onclick: next } : null,
  });
}

// ===================== phones and reminders =====================

const idle = () => ({ step: 'idle', number: '', sentTo: '', code: '', error: '', demoCode: '' });
let part = 'reminders'; // 'reminders' | 'spouse'
let mine = idle(); // confirming this phone's own number
let own = idle(); // adding a phone to an account signed in with Google
let spouse = idle(); // adding the spouse's phone
let picks = null; // the reminders chosen for this phone
let remError = '';

onEnter('phones', direction => {
  part = direction === 'back' ? 'spouse' : 'reminders';
  mine = idle();
  own = idle();
  spouse = idle();
  picks = null;
  remError = '';
});

const me = ownPhone;

/** Where the focus goes when something about a phone number needs correcting. */
const numberFocus = state => (state === spouse ? 'sp-number' : state === own ? 'sp-own-number' : 'sp-mine-send');

/** Asks for a code to be texted to a number (POST /api/phones/code), then shows the code field. */
function sendCode(state, number, btn, focusId) {
  state.error = '';
  return withBusy(btn, () => api('POST', '/api/phones/code', { number })).then(
    r => {
      Object.assign(state, { step: 'code', sentTo: r.number || number, code: '', demoCode: r.demoCode || '' });
      flow.focus = focusId;
      render();
    },
    err => {
      state.error = problem(err);
      flow.focus = numberFocus(state);
      render();
    },
  );
}

/** Checks the code (POST /api/phones/verify); the phone is then on the account and verified. */
function verifyCode(state, btn, focusId, onDone) {
  if (state.code.length !== 6) {
    state.error = 'Enter all 6 digits.';
    flow.focus = focusId;
    render();
    return;
  }
  const go = () => api('POST', '/api/phones/verify', { number: state.sentTo, code: state.code });
  (btn ? withBusy(btn, go) : go()).then(
    r => {
      adopt(r.state);
      onDone();
    },
    err => {
      Object.assign(state, { error: problem(err), code: '' });
      flow.focus = focusId;
      render();
    },
  );
}

function codeForm(state, idPrefix, onDone) {
  const codeId = idPrefix + '-code';
  const formId = idPrefix + '-form';
  return h(
    'form',
    {
      id: formId,
      novalidate: true,
      onsubmit: e => {
        e.preventDefault();
        verifyCode(state, e.submitter || document.getElementById(idPrefix + '-confirm'), codeId, onDone);
      },
    },
    state.demoCode ? alert({ kind: 'info' }, 'Test account: the code is ' + state.demoCode + '.') : null,
    codeField({
      id: codeId,
      label: '6-digit code',
      help: 'Sent to ' + pretty(state.sentTo) + '.',
      value: state.code,
      error: state.error,
      onvalue: v => (state.code = v),
      oncomplete: () => {
        const f = document.getElementById(formId);
        if (f) f.requestSubmit();
      },
    }),
    h(
      'div',
      { class: 'actions' },
      button({ label: 'Confirm code', variant: 'primary', type: 'submit', attrs: { id: idPrefix + '-confirm' } }),
      button({ label: 'Other number', onclick: () => (Object.assign(state, idle(), { number: state === mine ? '' : state.number }), (flow.focus = numberFocus(state)), render()) }),
    ),
  );
}

/** A form for a mobile number that a code is then texted to, with the consent wording under the field. */
function numberForm(state, ids, label) {
  return h(
    'form',
    {
      novalidate: true,
      onsubmit: e => {
        e.preventDefault();
        const read = readNumber(state.number, P && P.prefixes);
        if (read.error) {
          state.error = read.error;
          flow.focus = ids.number;
          render();
          return;
        }
        sendCode(state, read.number, e.submitter || document.getElementById(ids.send), ids.code);
      },
    },
    phoneField({
      id: ids.number,
      label,
      autocomplete: state === own ? 'tel' : 'off',
      value: state.number,
      error: state.error,
      help: smsConsent(),
      onvalue: v => (state.number = v),
    }),
    h('div', { class: 'actions' }, button({ label: 'Text a code', type: 'submit', icon: 'message', variant: 'primary', attrs: { id: ids.send } })),
  );
}

/** For an account signed in with Google that has no phone yet: adding one is optional. */
function addOwnPhoneView(toSpouse) {
  return screen({
    count: 'Phones, part 1 of 2',
    title: 'Your phone',
    body: [
      own.step === 'code'
        ? codeForm(own, 'sp-own', () => {
            own = idle();
            flow.focus = 'setup-title';
            render();
          })
        : numberForm(own, { number: 'sp-own-number', send: 'sp-own-send', code: 'sp-own-code' }, 'Your mobile number'),
    ],
    back,
    skip: { label: 'Not now', onclick: toSpouse },
  });
}

function turnOnReminders(e) {
  const p = me();
  const btn = e.currentTarget;
  remError = '';
  if (!picks.length) {
    remError = 'Choose at least one reminder.';
    render();
    return;
  }
  withBusy(btn, () => api('PUT', '/api/phones', { number: p.number, name: p.name, canUpdate: p.canUpdate, reminders: picks, texts: true })).then(
    r => {
      adopt(r.state);
      flow.focus = 'sp-on';
      render();
    },
    err => {
      remError = problem(err);
      render();
    },
  );
}

function remindersView() {
  const p = me();
  const sms = S.sms;
  const toSpouse = () => {
    part = 'spouse';
    render();
  };
  if (sms.ready && !p && viaGoogle()) return addOwnPhoneView(toSpouse);
  if (!sms.ready || !p) {
    return screen({
      count: 'Phones, part 1 of 2',
      title: 'Text reminders',
      body: [alert({ kind: 'info' }, 'Texting is not available yet.')],
      back,
      main: { label: 'Continue', onclick: toSpouse },
    });
  }
  if (p.texts) {
    return screen({
      count: 'Phones, part 1 of 2',
      title: 'Text reminders',
      body: [
        h('div', { id: 'sp-on', tabindex: '-1' }, alert({ kind: 'ok', role: 'status' }, 'Reminders are on for ' + pretty(p.number) + '.')),
        p.optedOut ? alert({ kind: 'warn' }, 'This phone replied STOP. Text START to resume.') : null,
      ],
      back,
      main: { label: 'Continue', onclick: toSpouse },
    });
  }
  if (!p.verified) {
    return screen({
      count: 'Phones, part 1 of 2',
      title: 'Text reminders',
      intro: 'First confirm ' + pretty(p.number) + '.',
      body: [
        mine.step === 'code'
          ? codeForm(mine, 'sp-mine', () => {
              mine = idle();
              flow.focus = 'setup-title';
              render();
            })
          : h(
              'div',
              {},
              h(
                'div',
                { class: 'actions' },
                button({ label: 'Text me a code', variant: 'primary', icon: 'message', attrs: { id: 'sp-mine-send' }, onclick: e => sendCode(mine, p.number, e.currentTarget, 'sp-mine-code') }),
              ),
              mine.error ? h('p', { class: 'setup-error', role: 'alert' }, icon('alert', { size: 'sm' }), h('span', {}, mine.error)) : null,
            ),
      ],
      back,
      skip: { label: 'Not now', onclick: toSpouse },
    });
  }
  if (!picks) picks = [...p.reminders];
  return screen({
    count: 'Phones, part 1 of 2',
    title: 'Text reminders',
    intro: 'Sent to ' + pretty(p.number) + '.',
    body: [
      h('p', { class: 'help consent' }, 'By saving, the owner of this phone agrees to receive the reminders chosen below by text message from Betaharah. Message frequency varies. Message and data rates may apply. Reply STOP to stop, HELP for help.'),
      h(
        'fieldset',
        { class: 'plain' },
        h('legend', {}, 'Reminders'),
        h(
          'div',
          { class: 'checks' },
          S.reminderKinds.map(k =>
            checkRow({
              id: 'sp-rem-' + k,
              label: S.labels.reminders[k] || k,
              checked: picks.includes(k),
              onchange: e => {
                picks = e.target.checked ? [...new Set([...picks, k])] : picks.filter(x => x !== k);
              },
            }),
          ),
        ),
      ),
      remError ? h('p', { class: 'setup-error', role: 'alert' }, icon('alert', { size: 'sm' }), h('span', {}, remError)) : null,
    ],
    back,
    skip: { label: 'Not now', onclick: toSpouse },
    main: { label: 'Turn on reminders', icon: 'bell', onclick: turnOnReminders, id: 'sp-turn-on' },
  });
}

function spouseView() {
  const sms = S.sms;
  const mineNow = ownPhone();
  const others = S.phones.filter(p => p !== mineNow);
  const backToReminders = () => {
    part = 'reminders';
    render();
  };
  const head = { count: 'Phones, part 2 of 2', title: 'Spouse’s phone' };
  if (!sms.ready) {
    return screen({
      ...head,
      body: [alert({ kind: 'info' }, 'Texting is not available yet.')],
      back: backToReminders,
      main: { label: 'Continue', onclick: next },
    });
  }
  const list = others.length
    ? h('div', { id: 'sp-added', tabindex: '-1' }, alert({ kind: 'ok', role: 'status' }, 'On this account: ' + others.map(p => pretty(p.number)).join(', ') + '.'))
    : null;
  if (S.phones.length >= S.maxPhones) {
    return screen({ ...head, body: [list, h('p', { class: 'muted' }, 'Phone limit reached (' + S.maxPhones + ').')], back: backToReminders, main: { label: 'Continue', onclick: next } });
  }
  let body;
  if (spouse.step === 'code') {
    body = codeForm(spouse, 'sp', () => {
      spouse = idle();
      flow.focus = 'sp-added';
      render();
    });
  } else {
    body = numberForm(spouse, { number: 'sp-number', send: 'sp-send', code: 'sp-code' }, 'Spouse’s number');
  }
  return screen({
    ...head,
    body: [list, others.length ? h('h3', {}, 'Add another phone') : null, body],
    back: backToReminders,
    skip: others.length ? null : { label: 'Skip', onclick: next },
    main: others.length ? { label: 'Continue', onclick: next } : null,
  });
}

export function phonesView() {
  return part === 'spouse' ? spouseView() : remindersView();
}

// ===================== the last screen =====================

export function doneView() {
  const todo = [];
  if (!S.app.place) todo.push({ text: 'Choose the location', step: 'place' });
  if (!S.halachic.confirmedAt) todo.push({ text: 'Save your customs', step: 'customs' });
  if (S.app.place && S.entryCount === 0) todo.push({ text: t('Record the last {flow}'), step: 'dates' });

  const sms = S.sms;
  let texting = null;
  if (sms.ready && sms.number) {
    texting = h(
      'div',
      { class: 'setup-texting' },
      h('h3', {}, icon('message'), 'Record by text'),
      viaGoogle() && !S.phones.length ? h('p', { class: 'muted' }, 'Add your phone in Settings first.') : null,
      h('p', {}, 'Text to ', h('strong', { class: 'nowrap' }, pretty(sms.number)), ':'),
      commandsTable(sms),
    );
  }

  return screen({
    title: todo.length ? 'Setup done for now' : 'Setup done',
    body: [
      todo.length
        ? alert(
            { kind: 'warn', title: 'Still to do' },
            h(
              'ul',
              { class: 'setup-todo' },
              todo.map(x => h('li', {}, button({ label: x.text, variant: 'link', onclick: () => goTo(x.step, 'back') }))),
            ),
          )
        : null,
      texting,
    ],
    back,
    main: { label: 'Open my calendar', icon: 'calendar', onclick: e => finish(e.currentTarget), id: 'setup-finish' },
  });
}
