/* Site settings: the contact for the public pages, who may sign up, the texting switches, the prefixes, the limits and the ways to give (/donate). */
import { alert, button, card, cardSection, checkRow, confirmDialog, field, h, icon, selectField, setFieldError, textField } from '/app/lib.js';
import { call, draft, num, render, run, S, saved } from '../state.js';

const SIGNUP_HELP = {
  open: 'Any number with an allowed prefix.',
  invite: 'Only with an invitation.',
  closed: 'One-number invitations still work.',
};

const LIMITS = [
  {
    key: 'dailyCodeLimit',
    label: 'Sign-in codes a day, all',
    max: 100000,
    why: 'Past it, code sign-in pauses until tomorrow.',
  },
  {
    key: 'monthlyMessageLimit',
    label: 'Texts a month, all',
    max: 1000000,
    why: 'Past it, nothing is sent until next month.',
  },
  {
    key: 'householdMonthlyLimit',
    label: 'Texts a month, one account',
    max: 10000,
    why: 'Past it, that account gets nothing until next month.',
  },
];

/** Server field names, in the words of the form. */
const FIELD_IDS = { contactName: 'cname', contactEmail: 'cemail', allowedPrefixes: 'prefixes', dailyCodeLimit: 'lim-dailyCodeLimit', monthlyMessageLimit: 'lim-monthlyMessageLimit', householdMonthlyLimit: 'lim-householdMonthlyLimit', 'donate.note': 'don-note' };

/** The id of the control a server field name belongs to: 'donate.links.2.url' -> 'don-url-2'. */
function fieldId(key) {
  const m = /^donate\.links\.(\d+)\.(label|url)$/.exec(key);
  return m ? 'don-' + m[2] + '-' + m[1] : FIELD_IDS[key];
}

let prefixText = null;

function touch() {
  draft.configDirty = true;
}

/** Checks the draft; returns { field: message }. */
function validate(c) {
  const errors = {};
  if (c.contactName.length > 80) errors.contactName = 'At most 80 characters.';
  if (c.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.contactEmail.trim())) errors.contactEmail = 'Not an email address.';
  const prefixes = (prefixText ?? c.allowedPrefixes.join(', ')).split(',').map(s => s.trim()).filter(Boolean);
  if (prefixes.length === 0) errors.allowedPrefixes = 'At least one prefix, like +1.';
  else if (prefixes.some(p => !/^\+[1-9]\d{0,5}$/.test(p))) errors.allowedPrefixes = 'Each prefix is a + and a country code, separated by commas.';
  else if (prefixes.length > 20) errors.allowedPrefixes = 'At most 20 prefixes.';
  for (const l of LIMITS) {
    const v = c[l.key];
    if (!Number.isInteger(v) || v < 0 || v > l.max) errors[l.key] = 'A whole number from 0 to ' + num(l.max) + '.';
  }
  validateDonate(c.donate, errors);
  return errors;
}

// ---------- donations ----------

const MAX_DONATE_LINKS = 4;
/** Control characters, and those that reverse the direction of text (as on the server). */
const NOT_PLAIN = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

/** The same rules, and the same words, as the server (parseDonate in src/app/store.ts). */
function urlProblem(url, n) {
  if (!url) return 'Link ' + n + ' needs the address of the page that takes the payment.';
  if (url.length > 300) return 'The address of link ' + n + ' has more than 300 characters.';
  if (/\s/.test(url)) return 'The address of link ' + n + ' must not contain spaces.';
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return 'The address of link ' + n + ' is not a web address. Copy it from the payment service; it begins with https://.';
  }
  if (parsed.protocol !== 'https:') return 'The address of link ' + n + ' must begin with https://.';
  if (parsed.username || parsed.password) return 'The address of link ' + n + ' must not contain a user name or password.';
  if (!parsed.hostname.includes('.')) return 'The address of link ' + n + ' has no domain name (such as example.com) after https://.';
  return '';
}

function validateDonate(d, errors) {
  d.links.forEach((l, i) => {
    const n = i + 1;
    if (!l.label) errors['donate.links.' + n + '.label'] = 'Link ' + n + ' needs a label, for example "PayPal".';
    else if (l.label.length > 40) errors['donate.links.' + n + '.label'] = 'The label of link ' + n + ' has more than 40 characters.';
    else if (NOT_PLAIN.test(l.label) || l.label.includes('\n')) errors['donate.links.' + n + '.label'] = 'The label of link ' + n + ' must be plain text on one line.';
    const problem = urlProblem(l.url, n);
    if (problem) errors['donate.links.' + n + '.url'] = problem;
  });
  if (d.note.length > 400) errors['donate.note'] = 'The note has more than 400 characters.';
  else if (NOT_PLAIN.test(d.note)) errors['donate.note'] = 'The note must be plain text.';
}

/** Trims the draft and leaves out rows with neither a label nor an address. */
function tidyDonate(c) {
  const d = c.donate || { links: [], note: '' };
  c.donate = {
    links: d.links.map(l => ({ label: l.label.trim(), url: l.url.trim() })).filter(l => l.label || l.url),
    note: d.note.replace(/\r\n?/g, '\n').trim(),
  };
}

/** Forgets the messages about donation fields (their rows have moved). */
function clearDonateErrors() {
  if (!draft.errors) return;
  for (const k of Object.keys(draft.errors)) if (k.startsWith('donate')) delete draft.errors[k];
}

/** A server message without the field name it starts with: 'donate.note: The note ...' -> 'The note ...'. */
const plain = message => (message ? message.replace(/^[\w.]+:\s*/, '') : message);

function donateCard(e) {
  const c = draft.config;
  if (!c.donate) c.donate = { links: [], note: '' };
  const d = c.donate;
  const savedDonate = S.config.donate;
  const published = savedDonate && (savedDonate.links.length > 0 || savedDonate.note !== '');
  const general = plain(e.donate || e['donate.links'] || Object.keys(e).filter(k => /^donate\.links\.\d+$/.test(k)).map(k => e[k])[0]);
  const rows = d.links.map((l, i) => {
    const n = i + 1;
    return h(
      'fieldset',
      { class: 'give-row', id: 'don-row-' + n },
      h('legend', {}, 'Link ' + n),
      textField({
        id: 'don-label-' + n,
        label: 'Words on the button',
        maxlength: 40,
        value: l.label,
        error: plain(e['donate.links.' + n + '.label']),
        help: n === 1 ? 'Like "PayPal".' : null,
        oninput: ev => ((l.label = ev.target.value), touch()),
      }),
      textField({
        id: 'don-url-' + n,
        label: 'Payment page address',
        inputmode: 'url',
        autocomplete: 'off',
        spellcheck: 'false',
        maxlength: 300,
        placeholder: 'https://',
        value: l.url,
        error: plain(e['donate.links.' + n + '.url']),
        help: n === 1 ? 'Begins with https://.' : null,
        oninput: ev => ((l.url = ev.target.value), touch()),
      }),
      button({
        label: 'Remove link ' + n,
        icon: 'trash',
        size: 'sm',
        attrs: { id: 'don-remove-' + n },
        onclick: () => {
          d.links.splice(i, 1);
          clearDonateErrors();
          touch();
          render();
          const add = document.getElementById('don-add');
          if (add) add.focus();
        },
      }),
    );
  });
  const note = h('textarea', {
    id: 'don-note',
    rows: 4,
    maxlength: 400,
    value: d.note,
    oninput: ev => ((d.note = ev.target.value), touch()),
  });
  return card(
    {
      title: 'Donations',
      icon: 'link',
      intro: 'The Donate page appears once a link or note is saved. Payment is handled by the linked service.',
      attrs: { id: 'donate-card' },
    },
    general ? alert({ kind: 'bad', role: 'alert' }, general) : null,
    rows,
    h(
      'div',
      { class: 'actions' },
      button({
        label: 'Add a link',
        icon: 'plus',
        disabled: d.links.length >= MAX_DONATE_LINKS,
        attrs: { id: 'don-add' },
        onclick: () => {
          d.links.push({ label: '', url: '' });
          touch();
          render();
          const label = document.getElementById('don-label-' + d.links.length);
          if (label) label.focus();
        },
      }),
      d.links.length >= MAX_DONATE_LINKS ? h('span', { class: 'small muted' }, 'At most ' + MAX_DONATE_LINKS + ' links.') : null,
    ),
    field({
      label: 'Note (optional)',
      control: note,
      className: 'give-note-field',
      error: plain(e['donate.note']),
      help: 'Ways with no link, like Zelle or cheques.',
    }),
    h(
      'p',
      { class: 'help', id: 'don-status' },
      published
        ? ['Published. ', h('a', { href: '/donate', target: '_blank', rel: 'noopener', id: 'don-preview' }, 'Open the Donate page'), '.']
        : 'No Donate page yet.',
    ),
  );
}

/** Choices that would keep people out, each as a sentence. */
function lockouts(c) {
  const saved = S.config;
  const out = [];
  if (c.signup === 'closed' && saved.signup !== 'closed') out.push('Nobody will be able to create an account.');
  if (c.signup === 'invite' && saved.signup === 'open') out.push('People without an invitation link will not be able to create an account.');
  if (!c.smsEnabled && saved.smsEnabled) out.push('No text will be sent. People without a password cannot sign in.');
  const removed = saved.allowedPrefixes.filter(p => !c.allowedPrefixes.includes(p));
  if (removed.length) out.push('Numbers beginning with ' + removed.join(' or ') + ' will get no sign-in codes, existing accounts included.');
  if (c.dailyCodeLimit === 0 && saved.dailyCodeLimit !== 0) out.push('With 0 sign-in codes a day, nobody can sign in by text.');
  if (c.monthlyMessageLimit === 0 && saved.monthlyMessageLimit !== 0) out.push('With 0 texts a month, nothing will be sent at all.');
  return out;
}

function limitRow(l, error) {
  const input = h('input', {
    type: 'number',
    id: 'lim-' + l.key,
    min: 0,
    max: l.max,
    step: 1,
    inputmode: 'numeric',
    value: draft.config[l.key],
    oninput: e => {
      draft.config[l.key] = e.target.value === '' ? NaN : Number(e.target.value);
      touch();
      setFieldError(wrap, '');
    },
  });
  const wrap = field({ label: l.label, control: input, help: l.why, error, className: 'limit' });
  return wrap;
}

function save(form, btn) {
  const c = draft.config;
  c.contactName = c.contactName.trim();
  c.contactEmail = c.contactEmail.trim();
  if (prefixText !== null) c.allowedPrefixes = [...new Set(prefixText.split(',').map(s => s.trim()).filter(Boolean))];
  tidyDonate(c);
  const errors = validate(c);
  draft.errors = errors;
  if (Object.keys(errors).length) {
    render();
    const firstId = fieldId(Object.keys(errors)[0]);
    const el = document.getElementById(firstId);
    if (el) el.focus();
    return;
  }
  const warnings = lockouts(c);
  const go = () =>
    run(
      () => call('PUT', '/api/admin/config', c),
      state => {
        prefixText = null;
        draft.errors = {};
        saved('Settings saved.', { configSaved: true })(state);
      },
      btn,
      err => {
        if (err.status === 400) {
          const key = (err.message.match(/^([\w.]+):/) || [])[1] || '_form';
          draft.errors = { [key]: err.message };
          render();
          const el = document.getElementById(fieldId(key));
          if (el) el.focus();
          return true;
        }
        return false;
      },
    );
  if (warnings.length === 0) return go();
  confirmDialog({
    title: 'Save settings that keep people out?',
    body: h('div', {}, h('ul', {}, warnings.map(w => h('li', {}, w)))),
    confirmLabel: 'Save settings',
    danger: true,
  }).then(ok => {
    if (ok) go();
  });
}

/** The fixed caps on texting with numbers that have no account, with today's counts. */
function textCaps() {
  const t = S.textCaps;
  return h(
    'div',
    { class: 'caps' },
    h('p', { class: 'help' }, 'Fixed caps for numbers without an account:'),
    h(
      'ul',
      { class: 'small' },
      h('li', {}, num(t.strangerRepliesPerNumber) + ' reply per number per 24 hours.'),
      h('li', {}, num(t.strangerRepliesPerDay) + ' replies a day in all. Today: ' + num(t.strangerRepliesToday) + '.'),
      h('li', {}, num(t.textSignupsPerDay) + ' sign-ups by text a day. Today: ' + num(t.textSignupsToday) + '.'),
    ),
    h(
      'p',
      { class: 'help' },
      'With sign-up by text off, no reply except to HELP and START.',
    ),
  );
}

export function settingsPage() {
  const c = draft.config;
  const e = draft.errors || {};
  const warnings = lockouts(c);
  return h(
    'form',
    {
      class: 'settings-form',
      novalidate: true,
      onsubmit: ev => {
        ev.preventDefault();
        save(ev.currentTarget, ev.submitter || ev.currentTarget.querySelector('button[type=submit]'));
      },
    },
    e._form ? alert({ kind: 'bad', role: 'alert' }, e._form) : null,
    card(
      { title: 'Contact on the public pages', icon: 'user', intro: 'On Help, Privacy and Terms.' },
      textField({ id: 'cname', label: 'Name', maxlength: 80, value: c.contactName, error: e.contactName, help: 'Toll-free reviewers read these pages.', oninput: ev => ((c.contactName = ev.target.value), touch()) }),
      textField({ id: 'cemail', label: 'Email (public, optional)', type: 'email', maxlength: 120, value: c.contactEmail, error: e.contactEmail, help: null, oninput: ev => ((c.contactEmail = ev.target.value), touch()) }),
    ),
    card(
      { title: 'Sign-up', icon: 'link' },
      selectField({
        id: 'signup',
        label: 'Sign-up',
        value: c.signup,
        options: [
          { value: 'open', label: 'Open' },
          { value: 'invite', label: 'By invitation' },
          { value: 'closed', label: 'Closed' },
        ],
        help: SIGNUP_HELP[c.signup],
        onchange: ev => {
          c.signup = ev.target.value;
          touch();
          render();
        },
      }),
      checkRow({
        id: 'textSignup',
        label: 'Sign-up by texting JOIN',
        help: 'Follows the sign-up rule above.',
        checked: c.textSignup,
        onchange: ev => ((c.textSignup = ev.target.checked), touch()),
      }),
      h(
        'p',
        { class: 'help text-signup-note', id: 'textSignup-note' },
        icon('info', { size: 'sm' }),
        ' Leave it off until the toll-free verification covers signing up by text (docs/OPERATOR.md, after “Suggested answers for the toll-free verification form”).',
      ),
      textCaps(),
    ),
    card(
      { title: 'Text messages', icon: 'message' },
      checkRow({
        id: 'smsEnabled',
        label: 'Send text messages',
        help: 'Off stops all sending. Reminders due meanwhile are dropped.',
        checked: c.smsEnabled,
        onchange: ev => {
          c.smsEnabled = ev.target.checked;
          touch();
          render();
        },
      }),
      textField({
        id: 'prefixes',
        label: 'Allowed prefixes',
        value: prefixText ?? c.allowedPrefixes.join(', '),
        error: e.allowedPrefixes,
        help: 'Like +1, +44. Abroad costs more.',
        oninput: ev => {
          prefixText = ev.target.value;
          c.allowedPrefixes = prefixText.split(',').map(s => s.trim()).filter(Boolean);
          touch();
        },
      }),
    ),
    card({ title: 'Limits', icon: 'alert' }, LIMITS.map(l => limitRow(l, e[l.key]))),
    donateCard(e),
    warnings.length
      ? alert({ kind: 'warn', title: 'These changes keep people out' }, h('ul', {}, warnings.map(w => h('li', {}, w))))
      : null,
    h('div', { class: 'save-bar' }, h('span', { class: 'small muted' }, draft.configDirty ? 'Not saved.' : ''), button({ label: 'Save settings', variant: 'primary', type: 'submit' })),
  );
}
