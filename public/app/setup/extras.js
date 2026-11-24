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
    title: 'See the dates in your calendar app',
    intro: 'Optional. Show the dates in your own calendar app.',
    body: [
      cal.google.available
        ? h(
            'div',
            { class: 'setup-option' },
            h('h3', {}, icon('calendar'), 'Google Calendar'),
            h('p', { class: 'muted' }, 'One new calendar in your Google account; nothing else there is seen.'),
            cal.google.connected
              ? alert({ kind: 'ok' }, 'Connected. The calendar is named “' + S.app.calendar.name + '” in your Google Calendar.')
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
              h('p', { class: 'help' }, 'Add it in your calendar app as a subscribed calendar. Keep it private.'),
              h('div', { class: 'actions' }, linkButton({ href: cal.link.replace(/^https?:/, 'webcal:'), label: 'Open in my calendar app', icon: 'calendar' })),
            )
          : h(
              'div',
              {},
              h('p', { class: 'muted' }, 'For Apple Calendar, Outlook or Google Calendar.'),
              h(
                'div',
                { class: 'actions' },
                button({
                  label: 'Create a subscription link',
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
    skip: done ? null : { label: 'Skip this step', onclick: next },
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
    state.error = 'Type all 6 digits of the code.';
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
    state.demoCode ? alert({ kind: 'info' }, 'Test account: nothing is sent. The code is ' + state.demoCode + '.') : null,
    codeField({
      id: codeId,
      label: 'The 6-digit code',
      help: 'A code was texted to ' + pretty(state.sentTo) + '. It works for a few minutes.',
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
      button({ label: 'Confirm the code', variant: 'primary', type: 'submit', attrs: { id: idPrefix + '-confirm' } }),
      button({ label: 'Use a different number', onclick: () => (Object.assign(state, idle(), { number: state === mine ? '' : state.number }), (flow.focus = numberFocus(state)), render()) }),
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
    h('div', { class: 'actions' }, button({ label: 'Text a code to it', type: 'submit', icon: 'message', variant: 'primary', attrs: { id: ids.send } })),
  );
}

/** For an account signed in with Google that has no phone yet: adding one is optional. */
function addOwnPhoneView(toSpouse) {
  return screen({
    count: 'Phones, part 1 of 2',
    title: 'Your phone',
    intro: 'Optional. For reminders and recording by text.',
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
    remError = 'Choose at least one reminder, or choose “Not now”.';
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
      body: [alert({ kind: 'info' }, 'Text messages are not available on this site yet. Reminders by text can be turned on in Settings once they are. Everything can be recorded here on the website meanwhile.')],
      back,
      main: { label: 'Continue', onclick: toSpouse },
    });
  }
  if (p.texts) {
    return screen({
      count: 'Phones, part 1 of 2',
      title: 'Text reminders',
      body: [
        h('div', { id: 'sp-on', tabindex: '-1' }, alert({ kind: 'ok', role: 'status' }, 'Text reminders are on for ' + (p.me ? 'this phone, ' : '') + pretty(p.number) + '. Which reminders it receives can be changed in Settings.')),
        p.optedOut ? alert({ kind: 'warn' }, 'This phone replied STOP, so nothing is sent to it. Text START from it to receive texts again.') : null,
      ],
      back,
      main: { label: 'Continue', onclick: toSpouse },
    });
  }
  if (!p.verified) {
    return screen({
      count: 'Phones, part 1 of 2',
      title: 'Text reminders to this phone',
      intro: 'Confirm ' + pretty(p.number) + ' with a code texted to it.',
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
                button({ label: 'Text a code to this phone', variant: 'primary', icon: 'message', attrs: { id: 'sp-mine-send' }, onclick: e => sendCode(mine, p.number, e.currentTarget, 'sp-mine-code') }),
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
    title: p.me ? 'Text reminders to this phone' : 'Text reminders to your phone',
    intro: 'Sent to ' + pretty(p.number) + '.',
    body: [
      h('p', { class: 'help consent' }, 'By saving, the owner of this phone agrees to receive the reminders chosen below by text message from Betaharah. Message frequency varies. Message and data rates may apply. Reply STOP to stop, HELP for help.'),
      h(
        'fieldset',
        { class: 'plain' },
        h('legend', {}, 'Reminders this phone receives'),
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
    main: { label: 'Save and turn on reminders', icon: 'bell', onclick: turnOnReminders, id: 'sp-turn-on' },
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
  const head = { count: 'Phones, part 2 of 2', title: 'Your spouse’s phone' };
  if (!sms.ready) {
    return screen({
      ...head,
      body: [alert({ kind: 'info' }, 'A second phone can be added once text messaging is available on this site. It can be added in Settings then.')],
      back: backToReminders,
      main: { label: 'Continue', onclick: next },
    });
  }
  const list = others.length
    ? h('div', { id: 'sp-added', tabindex: '-1' }, alert({ kind: 'ok', role: 'status' }, 'Also on this account: ' + others.map(p => pretty(p.number)).join(', ') + '. Its reminders can be turned on from that phone, or in Settings.'))
    : null;
  if (S.phones.length >= S.maxPhones) {
    return screen({ ...head, body: [list, h('p', { class: 'muted' }, 'This account has the most phones it can have (' + S.maxPhones + ').')], back: backToReminders, main: { label: 'Continue', onclick: next } });
  }
  let body;
  if (spouse.step === 'code') {
    body = codeForm(spouse, 'sp', () => {
      spouse = idle();
      flow.focus = 'sp-added';
      render();
    });
  } else {
    body = numberForm(spouse, { number: 'sp-number', send: 'sp-send', code: 'sp-code' }, 'Mobile number to add');
  }
  return screen({
    ...head,
    intro: others.length
      ? null
      : 'For husband and wife to share this account. Add only a phone whose owner has agreed.',
    body: [list, others.length ? h('h3', {}, 'Add another phone') : null, body],
    back: backToReminders,
    skip: others.length ? null : { label: 'Skip this step', onclick: next },
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
  if (!S.halachic.confirmedAt) todo.push({ text: t('Confirm your customs, ideally with your {rav}'), step: 'customs' });
  if (S.app.place && S.entryCount === 0) todo.push({ text: t('Record the most recent {flow}'), step: 'dates' });

  const sms = S.sms;
  let texting = null;
  if (sms.ready && sms.number) {
    texting = h(
      'div',
      { class: 'setup-texting' },
      h('h3', {}, icon('message'), 'Recording by text message'),
      viaGoogle() && !S.phones.length ? h('p', { class: 'muted' }, 'Texts are accepted from a phone on this account. Add your phone in Settings to record by text.') : null,
      h('p', {}, 'Text one of these to ', h('strong', { class: 'nowrap' }, pretty(sms.number)), ':'),
      commandsTable(sms),
    );
  }

  return screen({
    title: todo.length ? 'The setup is finished for now' : 'The setup is finished',
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
      h(
        'ul',
        { class: 'setup-tour' },
        h('li', {}, h('strong', {}, 'Today: '), 'where things stand, and buttons to record.'),
        h('li', {}, h('strong', {}, 'Log: '), 'everything recorded.'),
        h('li', {}, h('strong', {}, 'Customs: '), S.halachic.confirmedAt ? 'the customs chosen here.' : 'the stricter defaults, until confirmed.'),
        h('li', {}, h('strong', {}, 'Settings: '), 'location, calendar, phones and reminders.'),
      ),
      texting,
    ],
    back,
    main: { label: 'Go to my calendar', icon: 'calendar', onclick: e => finish(e.currentTarget), id: 'setup-finish' },
  });
}
