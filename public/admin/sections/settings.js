/* Site settings: the contact for the public pages, who may sign up, the texting switches, the prefixes and the limits. */
import { alert, button, card, cardSection, checkRow, confirmDialog, field, h, icon, selectField, setFieldError, textField } from '/app/lib.js';
import { call, draft, num, render, run, S, saved } from '../state.js';

const SIGNUP_HELP = {
  open: 'Anyone with a mobile number that begins with an allowed prefix can create an account with a texted code.',
  invite: 'Only people you send an invitation link to can create an account. Use this if sign-ups you did not expect appear.',
  closed: 'Nobody can create an account. Existing accounts keep working, and invitations for one phone number still work.',
};

const LIMITS = [
  {
    key: 'dailyCodeLimit',
    label: 'Most sign-in codes in one day, everyone together',
    max: 100000,
    why: 'Protects against someone requesting codes for many numbers to run up the bill. Past it, sign-in by text pauses until the next day; passwords still work.',
  },
  {
    key: 'monthlyMessageLimit',
    label: 'Most texts in one month, everyone together',
    max: 1000000,
    why: 'The ceiling on the whole bill. Past it, nothing is sent until the next month: no codes, no replies, no reminders.',
  },
  {
    key: 'householdMonthlyLimit',
    label: 'Most texts in one month to one account',
    max: 10000,
    why: 'Stops one account (or a fault in it) from using the whole budget. Past it, that account gets no texts until the next month.',
  },
];

/** Server field names, in the words of the form. */
const FIELD_IDS = { contactName: 'cname', contactEmail: 'cemail', allowedPrefixes: 'prefixes', dailyCodeLimit: 'lim-dailyCodeLimit', monthlyMessageLimit: 'lim-monthlyMessageLimit', householdMonthlyLimit: 'lim-householdMonthlyLimit' };

let prefixText = null;

function touch() {
  draft.configDirty = true;
}

/** Checks the draft; returns { field: message }. */
function validate(c) {
  const errors = {};
  if (c.contactName.length > 80) errors.contactName = 'At most 80 characters.';
  if (c.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.contactEmail.trim())) errors.contactEmail = 'This is not an email address. Leave it empty if you do not want one shown.';
  const prefixes = (prefixText ?? c.allowedPrefixes.join(', ')).split(',').map(s => s.trim()).filter(Boolean);
  if (prefixes.length === 0) errors.allowedPrefixes = 'Write at least one prefix, for example +1.';
  else if (prefixes.some(p => !/^\+[1-9]\d{0,5}$/.test(p))) errors.allowedPrefixes = 'Each prefix is a + and the country code, for example +1 or +44, separated by commas.';
  else if (prefixes.length > 20) errors.allowedPrefixes = 'At most 20 prefixes.';
  for (const l of LIMITS) {
    const v = c[l.key];
    if (!Number.isInteger(v) || v < 0 || v > l.max) errors[l.key] = 'A whole number from 0 to ' + num(l.max) + '.';
  }
  return errors;
}

/** Choices that would keep people out, each as a sentence. */
function lockouts(c) {
  const saved = S.config;
  const out = [];
  if (c.signup === 'closed' && saved.signup !== 'closed') out.push('Nobody will be able to create an account.');
  if (c.signup === 'invite' && saved.signup === 'open') out.push('People without an invitation link will not be able to create an account.');
  if (!c.smsEnabled && saved.smsEnabled) out.push('No text will be sent: no sign-in codes, replies or reminders. People who have not set a password cannot sign in until texting is on again.');
  const removed = saved.allowedPrefixes.filter(p => !c.allowedPrefixes.includes(p));
  if (removed.length) out.push('Numbers beginning with ' + removed.join(' or ') + ' will not get sign-in codes, including people who already have an account with such a number.');
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
  const errors = validate(c);
  draft.errors = errors;
  if (Object.keys(errors).length) {
    render();
    const firstId = FIELD_IDS[Object.keys(errors)[0]];
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
          draft.errors = { [(err.message.match(/^(\w+):/) || [])[1] || '_form']: err.message };
          render();
          return true;
        }
        return false;
      },
    );
  if (warnings.length === 0) return go();
  confirmDialog({
    title: 'Save settings that keep people out?',
    body: h('div', {}, h('ul', {}, warnings.map(w => h('li', {}, w))), h('p', {}, 'You can change this back at any time.')),
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
    h('p', { class: 'help' }, 'Fixed limits on texts with numbers that have no account. They keep wrong numbers and strangers from costing much:'),
    h(
      'ul',
      { class: 'small' },
      h('li', {}, 'At most ' + num(t.strangerRepliesPerNumber) + ' reply in 24 hours to one number without an account.'),
      h('li', {}, 'At most ' + num(t.strangerRepliesPerDay) + ' such replies a day for the whole site. Today: ' + num(t.strangerRepliesToday) + '.'),
      h('li', {}, 'At most ' + num(t.textSignupsPerDay) + ' accounts created by text a day. Today: ' + num(t.textSignupsToday) + '.'),
    ),
    h(
      'p',
      { class: 'help' },
      'While sign-up is closed, or sign-up by text is off, a number without an account gets no reply, except to HELP and START. Those two always get the fixed replies filed with the toll-free verification, within their own daily limits.',
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
      { title: 'Contact on the public pages', icon: 'user', intro: 'Shown on the Help, Privacy and Terms pages.' },
      textField({ id: 'cname', label: 'Your name, or a name for the site', maxlength: 80, value: c.contactName, error: e.contactName, help: 'Shown as the person who runs the site. The toll-free verification reviewers read these pages.', oninput: ev => ((c.contactName = ev.target.value), touch()) }),
      textField({ id: 'cemail', label: 'Contact email (public, optional)', type: 'email', maxlength: 120, value: c.contactEmail, error: e.contactEmail, help: 'Anyone can read it on those pages. Leave it empty to show none.', oninput: ev => ((c.contactEmail = ev.target.value), touch()) }),
    ),
    card(
      { title: 'Who may create an account', icon: 'link' },
      selectField({
        id: 'signup',
        label: 'Sign-up',
        value: c.signup,
        options: [
          { value: 'open', label: 'Anyone with a phone number' },
          { value: 'invite', label: 'Only people with an invitation link' },
          { value: 'closed', label: 'Nobody (existing accounts keep working)' },
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
        label: 'People can create an account by texting JOIN to the number',
        help: 'The account is made by text and set up by text (ZIP code, customs, recent dates); no website is needed. It follows the sign-up rule above: with "Nobody" it does nothing, and with invitations only the person texts JOIN and an invitation word (see Invitations). While it is on, the number is shown on the sign-in page.',
        checked: c.textSignup,
        onchange: ev => ((c.textSignup = ev.target.checked), touch()),
      }),
      h(
        'p',
        { class: 'help text-signup-note', id: 'textSignup-note' },
        icon('info', { size: 'sm' }),
        ' Off at first. Leave it off until the toll-free verification covers signing up by text: the verification filed with Telnyx describes signing up on the website only. What to add to it is in the operator guide (docs/OPERATOR.md), in the table after “Suggested answers for the toll-free verification form”.',
      ),
      textCaps(),
    ),
    card(
      { title: 'Text messages', icon: 'message' },
      checkRow({
        id: 'smsEnabled',
        label: 'Send text messages',
        help: 'One switch that stops all sending at once. Reminders that come due while it is off wait a few hours and are then dropped.',
        checked: c.smsEnabled,
        onchange: ev => {
          c.smsEnabled = ev.target.checked;
          touch();
          render();
        },
      }),
      textField({
        id: 'prefixes',
        label: 'Phone numbers must begin with',
        value: prefixText ?? c.allowedPrefixes.join(', '),
        error: e.allowedPrefixes,
        help: 'Separate with commas, for example +1, +44. Texts to other countries cost more; keeping this to +1 also stops codes being requested for foreign numbers.',
        oninput: ev => {
          prefixText = ev.target.value;
          c.allowedPrefixes = prefixText.split(',').map(s => s.trim()).filter(Boolean);
          touch();
        },
      }),
    ),
    card({ title: 'Limits that cap the bill', icon: 'alert', intro: 'Every text costs you about a cent. Past a limit, nothing is sent.' }, LIMITS.map(l => limitRow(l, e[l.key]))),
    warnings.length
      ? alert({ kind: 'warn', title: 'These changes keep people out' }, h('ul', {}, warnings.map(w => h('li', {}, w))))
      : null,
    h('div', { class: 'save-bar' }, h('span', { class: 'small muted' }, draft.configDirty ? 'You have changes that are not saved.' : 'Nothing here is saved until you press Save settings.'), button({ label: 'Save settings', variant: 'primary', type: 'submit' })),
  );
}
