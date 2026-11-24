/* Tools: a test text, and links to the public pages and the consent screenshots. */
import { button, card, cardSection, h, icon, setFieldError, textField, toast } from '/app/lib.js';
import { adopt, call, draft, render, run, S } from '../state.js';
import { simulator } from './simulator.js';

let error = '';

function testText() {
  const f = textField({
    id: 'test-to',
    label: 'Your own mobile number',
    type: 'tel',
    autocomplete: 'tel',
    placeholder: '(732) 444-0123',
    value: draft.testTo,
    error,
    help: S.smsReady ? 'Sends one text: "Betaharah: test message…". It costs about a cent and counts against the monthly limit.' : 'Texting is not set up yet, so this cannot send. See Keys and connections.',
    oninput: e => {
      draft.testTo = e.target.value;
      error = '';
      setFieldError(f, '');
    },
  });
  return h(
    'form',
    {
      class: 'test-text',
      novalidate: true,
      onsubmit: e => {
        e.preventDefault();
        if (draft.testTo.replace(/\D/g, '').length < 10) {
          setFieldError(f, 'Type your mobile number, with the area code.');
          f.control.focus();
          return;
        }
        run(
          () => call('POST', '/api/admin/test-text', { to: draft.testTo }),
          r => {
            adopt(r.state);
            render();
            toast('A test text was sent. It should arrive within a minute.');
          },
          e.submitter,
          err => {
            error = err.message;
            render();
            return true;
          },
        );
      },
    },
    f,
    h('div', { class: 'actions' }, button({ label: 'Send a test text', type: 'submit', icon: 'message', disabled: !S.smsReady })),
  );
}

function link(href, label, note) {
  return h('li', {}, h('a', { href, target: '_blank', rel: 'noopener' }, label, ' ', icon('chevron-right', { size: 'sm' })), note ? h('span', { class: 'small muted' }, ' ' + note) : null);
}

/** The words people text, in short. The full reference is docs/TEXTING.md in the repository. */
function whatPeopleText() {
  const rows = [
    ['JOIN', 'Signs up while sign-up is open. While it is by invitation: JOIN and an invitation word. JOIN and a code (from ADD on an account) adds a phone to that account.'],
    ['MENU', 'Lists the words. Each word sent alone shows its own options: STATUS, HISTORY, UNDO, LOCATION, CUSTOMS, NIGHTFALL, REMINDERS, PHONES, CALENDAR, TERMS, WEB, SETUP, DELETE ACCOUNT.'],
    ['1 2 3 4 5', 'Record: 1 flow began, 2 hefsek done, 3 count broken, 4 immersed, 5 stain. After 1, 3 or 5 add day, night, yesterday night or a time (9pm). A date also works: 1 11/22 night.'],
    ['9, 0, ?', '9 status, 0 undo the last entry, ? the short list of digits.'],
    ['REMINDERS ON', 'Turns reminders on for that phone. That text is the consent; reminders are off until then.'],
    ['WEB', 'Texts back a one-time link that signs in on the website.'],
    ['STOP, START, HELP', 'STOP ends all texts to that phone until it texts START. HELP gets a short help text.'],
  ];
  return h('dl', { class: 'texting-words' }, rows.map(([word, what]) => h('div', {}, h('dt', {}, h('code', {}, word)), h('dd', {}, what))));
}

export function simulatorCards() {
  return h(
    'div',
    { class: 'grid-2 sim-grid' },
    card({ title: 'Try signing up by text', icon: 'phone' }, simulator()),
    card({ title: 'What people can text', icon: 'list', intro: 'Capitals or not does not matter. The full list, with every reply, is docs/TEXTING.md in the repository.' }, whatPeopleText()),
  );
}

export function toolsPage() {
  return [
    card({ title: 'Send a test text', icon: 'message' }, testText()),
    card(
      { title: 'Public pages', icon: 'link' },
      h(
        'ul',
        { class: 'links' },
        link(S.urls.home, 'What users see: the public page'),
        link(S.links.app, 'The sign-in page'),
        link(S.links.help, 'Help'),
        link(S.urls.privacy, 'Privacy'),
        link(S.urls.terms, 'Terms'),
      ),
      h('p', { class: 'help' }, 'The toll-free verification form asks for the website, privacy and terms addresses, and for the two screenshots below.'),
      h('ul', { class: 'links' }, link(S.links.optIn1, 'Consent screenshot 1: sign-in'), link(S.links.optIn2, 'Consent screenshot 2: reminders')),
    ),
  ];
}
