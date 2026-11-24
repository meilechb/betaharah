/* Tools: a test text, and links to the public pages and the consent screenshots. */
import { button, card, cardSection, h, icon, setFieldError, textField, toast } from '/app/lib.js';
import { adopt, call, draft, render, run, S } from '../state.js';

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

export function toolsSection() {
  return card(
    { title: 'Tools', icon: 'bell' },
    cardSection({ title: 'Send a test text' }, testText()),
    cardSection(
      { title: 'Pages' },
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
  );
}
