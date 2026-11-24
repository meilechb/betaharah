/*
 * "Try signing up by text": a small chat with the site, from a number
 * reserved for fiction. Every text goes through the real path on the
 * server, and the replies come back here instead of being sent. Only the
 * conversation the operator types is shown.
 */
import { button, h, pretty, setFieldError, textField } from '/app/lib.js';
import { call, run } from '../state.js';
import { loadAccounts } from './accounts.js';

const sim = {
  from: '(732) 555-0150',
  text: '',
  /** The conversation so far: { who: 'me' | 'site', text, suggestions? } */
  log: [],
  error: '',
  fromError: '',
};

const EXAMPLES = ['JOIN', '08701', 'A', '1 11/22 day', 'SKIP', 'MENU', '9', 'REMINDERS ON', 'DELETE ACCOUNT'];

const redrawMe = () => window.dispatchEvent(new CustomEvent('admin:section', { detail: 'simulator' }));

function focusText() {
  const el = document.getElementById('sim-text');
  if (el) el.focus();
}

function send(text, btn) {
  const t = String(text).trim();
  if (!t) {
    sim.error = 'Type a text first.';
    redrawMe();
    focusText();
    return;
  }
  sim.log.push({ who: 'me', text: t });
  sim.text = '';
  sim.error = '';
  sim.fromError = '';
  redrawMe();
  run(
    () => call('POST', '/api/admin/simulate', { from: sim.from, text: t }),
    r => {
      if (r.replies.length === 0) sim.log.push({ who: 'none', text: 'No reply. A real phone would receive nothing.' });
      for (const reply of r.replies) sim.log.push({ who: 'site', text: reply.text, suggestions: reply.suggestions || [] });
      if (r.outcome === 'created' || r.outcome === 'joined' || r.householdId === null) loadAccounts(true);
      redrawMe();
      focusText();
      const log = document.getElementById('sim-log');
      if (log) log.scrollTop = log.scrollHeight;
    },
    btn,
    err => {
      sim.log.pop();
      sim.text = t;
      if (/fiction|number/i.test(err.message) && !/320/.test(err.message)) sim.fromError = err.message;
      else sim.error = err.message;
      redrawMe();
      return true;
    },
  );
}

function nextNumber() {
  const digits = sim.from.replace(/\D/g, '');
  const m = /^1?(\d{3})55501(\d{2})$/.exec(digits);
  const n = m ? (Number(m[2]) + 1) % 100 : 50;
  const area = m ? m[1] : '732';
  sim.from = pretty('+1' + area + '55501' + String(n).padStart(2, '0'));
  sim.log = [];
  sim.error = '';
  sim.fromError = '';
  redrawMe();
}

function bubble(entry, i) {
  if (entry.who === 'none') return h('li', { class: 'sim-note' }, entry.text);
  const last = i === sim.log.length - 1 || sim.log[i + 1].who !== 'site';
  return h(
    'li',
    { class: 'sim-msg ' + entry.who },
    h('span', { class: 'visually-hidden' }, entry.who === 'me' ? 'You texted: ' : 'The site replied: '),
    h('div', { class: 'sim-bubble' }, entry.text),
    entry.suggestions && entry.suggestions.length
      ? h(
          'div',
          { class: 'sim-chips', role: 'group', 'aria-label': 'RCS buttons' },
          entry.suggestions.map((s, n) =>
            button({ label: s.label, size: 'sm', className: 'chip', disabled: !last, attrs: { id: 'sim-chip-' + i + '-' + n, title: 'Sends ' + s.send }, onclick: e => send(s.send, e.currentTarget) }),
          ),
        )
      : null,
  );
}

export function simulator() {
  // Show the newest messages once the page is drawn.
  requestAnimationFrame(() => {
    const log = document.getElementById('sim-log');
    if (log) log.scrollTop = log.scrollHeight;
  });
  const from = textField({
    id: 'sim-from',
    label: 'The made-up number you text from',
    type: 'tel',
    autocomplete: 'off',
    value: sim.from,
    error: sim.fromError,
    help: 'Numbers from 555-0100 to 555-0199 are reserved for fiction: they belong to no real phone, so nothing is sent and nothing is charged.',
    oninput: e => {
      sim.from = e.target.value;
      sim.fromError = '';
      setFieldError(from, '');
    },
  });
  const text = textField({
    id: 'sim-text',
    label: 'What the person texts',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    maxlength: 320,
    value: sim.text,
    error: sim.error,
    oninput: e => {
      sim.text = e.target.value;
      sim.error = '';
    },
  });
  return h(
    'div',
    { class: 'simulator' },
    h(
      'p',
      {},
      'Text the site as a new person would. The texts follow exactly the same rules as real ones, but nothing is sent. Buttons under a reply are the buttons a phone with RCS shows; pressing one sends its text.',
    ),
    from,
    h(
      'ol',
      { class: 'sim-log', id: 'sim-log', 'aria-live': 'polite', 'aria-label': 'The conversation' },
      sim.log.length ? sim.log.map(bubble) : h('li', { class: 'sim-note' }, 'Nothing yet. Start with JOIN, or with any text such as Hi.'),
    ),
    h(
      'form',
      {
        class: 'sim-form',
        novalidate: true,
        onsubmit: e => {
          e.preventDefault();
          send(sim.text, e.submitter);
        },
      },
      text,
      h('div', { class: 'actions' }, button({ label: 'Send', variant: 'primary', type: 'submit', icon: 'message' }), button({ label: 'Start over with another number', onclick: nextNumber })),
    ),
    h(
      'div',
      { class: 'sim-examples' },
      h('span', { class: 'small muted' }, 'Examples, in the order of a sign-up: '),
      EXAMPLES.map((t, n) => button({ label: t, size: 'sm', variant: 'link', attrs: { id: 'sim-ex-' + n }, onclick: e => send(t, e.currentTarget) })),
    ),
    h(
      'p',
      { class: 'help' },
      'An account made here is a test account: it is never texted and costs nothing. It stays until you text DELETE ACCOUNT and then YES from the same number here, or delete it under Accounts.',
    ),
  );
}
