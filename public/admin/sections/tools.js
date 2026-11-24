/* Tools: a test text, and links to the public pages and the consent screenshots. */
import { alert, button, card, cardSection, h, icon, setFieldError, textField, toast } from '/app/lib.js';
import { adopt, call, draft, num, render, run, S } from '../state.js';
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
    h('p', { class: 'small muted', id: 'month-total', 'aria-live': 'polite' }, 'Texts sent this month: ' + num(S.usage.textsThisMonth) + ' of at most ' + num(S.config.monthlyMessageLimit) + '.'),
  );
}

function link(href, label, note) {
  return h('li', {}, h('a', { href, target: '_blank', rel: 'noopener' }, label, ' ', icon('chevron-right', { size: 'sm' })), note ? h('span', { class: 'small muted' }, ' ' + note) : null);
}

/** What people text, in short. Every text, with its options, is on the Texts page. */
function whatPeopleText() {
  const rows = [
    ['Options', 'Every text ends with its options, e.g. "Reply: PERIOD, HEFSEK, STATUS, MORE". A reply is the option\'s word, or a few words that contain it. By RCS the options are buttons.'],
    ['PERIOD, HEFSEK', 'Ask when, with options; or with the time in words: "period last night", "hefsek yesterday", "period Nov 22 night".'],
    ['STATUS, MORE', 'Where things stand; and the rest: history, undo, a stain, settings, the account.'],
    ['JOIN', 'Signs up while sign-up is open. By invitation: JOIN and an invitation word. JOIN and a code (from ADD on an account) adds a phone to that account.'],
    ['STOP, START, HELP', 'STOP ends all texts to that phone until START. START and HELP get the replies filed with the toll-free verification, also from a number without an account.'],
  ];
  return h('dl', { class: 'texting-words' }, rows.map(([word, what]) => h('div', {}, h('dt', {}, h('code', {}, word)), h('dd', {}, what))));
}

/** The simulator follows the site's settings: say so when sign-up by text would get no reply. */
function signupOffNote() {
  const c = S.config;
  if (c.textSignup && c.signup !== 'closed') return null;
  return alert(
    { kind: 'info', title: c.signup === 'closed' ? 'Sign-up is closed under Site settings.' : 'Sign-up by text is off under Site settings.' },
    h('p', {}, 'So JOIN from a new number gets no reply here, as on a real phone. HELP and START are still answered, and a phone can still join an account with a code from ADD. ', h('a', { href: '#settings' }, 'Open Site settings')),
  );
}

export function simulatorCards() {
  return h(
    'div',
    { class: 'grid-2 sim-grid' },
    card({ title: 'Try signing up by text', icon: 'phone' }, signupOffNote(), simulator()),
    card({ title: 'What people can text', icon: 'list', intro: 'Capitals and punctuation do not matter. Every text and its options: ' }, whatPeopleText(), h('p', { class: 'help' }, h('a', { href: '#texts' }, 'Texts'))),
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
