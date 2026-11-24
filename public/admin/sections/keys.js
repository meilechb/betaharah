/* Keys and connections: Telnyx, RCS and Google. Keys are write-only: the page shows whether each is saved, never what it is. */
import { alert, button, card, cardSection, checkRow, confirmDialog, copyField, h, setFieldError, tag, textField, toast } from '/app/lib.js';
import { ago, call, draft, run, S, saved } from '../state.js';

const LABELS = {
  telnyxApiKey: 'Telnyx API key',
  telnyxPublicKey: 'Telnyx public key',
  telnyxNumber: 'Your Telnyx number',
  telnyxMessagingProfileId: 'Messaging Profile ID',
  rcsAgentId: 'RCS agent ID',
  googleClientId: 'Client ID',
  googleClientSecret: 'Client secret',
};

const HELP = {
  telnyxApiKey: 'Telnyx portal → Keys & Credentials → API Keys.',
  telnyxPublicKey: 'Telnyx portal → Keys & Credentials → Public Key.',
  telnyxNumber: 'Toll-free, like +1 888 555 0100.',
  telnyxMessagingProfileId: 'Telnyx portal → Messaging → your profile. For RCS.',
  rcsAgentId: 'From Telnyx.',
  googleClientId: 'Google Cloud Console → APIs & Services → Credentials → your OAuth client.',
  googleClientSecret: 'Shown next to the client ID.',
};

let fieldErrors = {};

function secretField(key, type) {
  const isSaved = S.secretsSet[key];
  const wrap = textField({
    id: 'k-' + key,
    label: LABELS[key],
    type: type || 'password',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: isSaved ? 'Saved. Type to replace it.' : 'Not saved',
    value: draft.secrets[key] || '',
    help: HELP[key],
    error: fieldErrors[key],
    oninput: e => {
      if (e.target.value === '') delete draft.secrets[key];
      else draft.secrets[key] = e.target.value;
      setFieldError(wrap, '');
    },
  });
  const label = wrap.querySelector('label');
  label.append(' ', tag(isSaved ? 'saved' : 'not saved', isSaved ? 'ok' : null));
  if (isSaved) {
    wrap.append(
      button({
        label: 'Clear the saved value',
        variant: 'link',
        size: 'sm',
        className: 'clear-key',
        attrs: { 'aria-label': 'Clear the saved ' + LABELS[key].replace(/^Your /, '') },
        onclick: async e => {
          const btn = e.currentTarget;
          const ok = await confirmDialog({ title: 'Clear the saved ' + LABELS[key].replace(/^Your /, '') + '?', body: 'What depends on it stops working.', confirmLabel: 'Clear it', danger: true });
          if (ok) run(() => call('PUT', '/api/admin/secrets', { [key]: '' }), saved('Cleared.'), btn);
        },
      }),
    );
  }
  return wrap;
}

function saveKeys(keys, btn) {
  const patch = {};
  for (const k of keys) if (k in draft.secrets) patch[k] = draft.secrets[k];
  if (Object.keys(patch).length === 0) {
    toast('Nothing new to save.');
    return;
  }
  fieldErrors = {};
  run(
    () => call('PUT', '/api/admin/secrets', patch),
    state => {
      for (const k of keys) delete draft.secrets[k];
      saved('Saved, encrypted.')(state);
    },
    btn,
    err => {
      if (err.status === 400) {
        const key = keys.find(k => err.message.startsWith(k)) || (keys.includes('telnyxNumber') && /phone number/.test(err.message) ? 'telnyxNumber' : null);
        if (key) {
          fieldErrors[key] = err.message;
          window.dispatchEvent(new CustomEvent('admin:section', { detail: 'keys' }));
          return true;
        }
      }
      return false;
    },
  );
}

function check(which, btn) {
  run(
    () => call('POST', '/api/admin/check/' + which),
    r => {
      saved()(r.state);
      toast(r.result.message, { bad: !r.result.ok, timeout: 9000 });
    },
    btn,
  );
}

function lastCheck(which) {
  const c = S.checks[which];
  if (!c) return null;
  return alert({ kind: c.ok ? 'ok' : 'warn', title: 'Last check, ' + ago(c.at, S.now) }, c.message);
}

function note(key, label, checked) {
  return checkRow({
    id: 'note-' + key,
    label,
    checked,
    onchange: e => {
      const value = e.target.checked;
      run(() => call('PUT', '/api/admin/notes', { [key]: value }), saved(value ? 'Noted.' : 'Note removed.'));
    },
  });
}

function telnyx() {
  const keys = ['telnyxApiKey', 'telnyxPublicKey', 'telnyxNumber', 'telnyxMessagingProfileId'];
  const received = S.ops.lastReceivedAt;
  return h(
    'form',
    {
      class: 'keys-form card',
      novalidate: true,
      onsubmit: e => {
        e.preventDefault();
        saveKeys(keys, e.submitter);
      },
    },
    h(
      'div',
      { class: 'card-body' },
      h('h2', {}, 'Text messages (Telnyx)'),
      h('p', {}, S.smsReady ? 'Working.' : 'Not working yet. About $1 a month plus 1¢ a text.'),
      h(
        'ol',
        { class: 'small how' },
        h('li', {}, 'Buy a toll-free number with SMS.'),
        h('li', {}, 'Put it in a Messaging Profile (opt-out settings as they are).'),
        h('li', {}, 'Set its inbound webhook to the address below.'),
        h('li', {}, 'Paste the keys, save, Check Telnyx.'),
        h('li', {}, 'Submit the toll-free verification.'),
      ),
      secretField('telnyxApiKey'),
      secretField('telnyxPublicKey', 'text'),
      secretField('telnyxNumber', 'text'),
      secretField('telnyxMessagingProfileId', 'text'),
      h('div', { class: 'actions' }, button({ label: 'Save Telnyx keys', variant: 'primary', type: 'submit' }), button({ label: 'Check Telnyx', icon: 'refresh', onclick: e => check('telnyx', e.currentTarget) })),
            lastCheck('telnyx'),
      h('h4', {}, 'Webhook address'),
            copyField({ value: S.urls.webhook, label: 'Copy', copiedMessage: 'Copied.' }),
      h('p', { class: 'small' }, received ? 'Last text received: ' + ago(received, S.now) + '.' : 'No text received yet.'),
      h('h4', {}, 'Toll-free verification'),
      h('p', { class: 'help' }, 'Unverified toll-free texts are not delivered.'),
      note('tollFreeSubmitted', 'I submitted the toll-free verification', S.notes.tollFreeSubmittedAt !== null),
      note('tollFreeVerified', 'Telnyx says the number is verified', S.notes.tollFreeVerifiedAt !== null),
    ),
  );
}

function rcs() {
  return h(
    'form',
    {
      class: 'keys-form card',
      novalidate: true,
      onsubmit: e => {
        e.preventDefault();
        saveKeys(['rcsAgentId'], e.submitter);
      },
    },
    h(
      'div',
      { class: 'card-body' },
      h('h2', {}, 'RCS (optional)'),
      h(
        'p',
        {},
        'Needs an approved agent (brand, EIN). Has fees. SMS is enough.',
      ),
      h(
        'p',
        { class: 'help' },
        'Once approved: same Messaging Profile, and the agent’s own webhook set to the address above.',
      ),
      alert({ kind: S.rcsReady ? 'ok' : 'info' }, S.rcsReady ? 'RCS is in use.' : 'Not in use. Needs texting, the agent ID, the profile ID and the switch.'),
      secretField('rcsAgentId', 'text'),
      checkRow({
        id: 'rcsEnabled',
        label: 'Send by RCS',
        help: 'Only once Check RCS agent says live.',
        checked: S.config.rcsEnabled,
        onchange: e => {
          const value = e.target.checked;
          run(() => call('PUT', '/api/admin/config', { ...S.config, rcsEnabled: value }), saved(value ? 'RCS is switched on.' : 'RCS is switched off.'));
        },
      }),
      h('div', { class: 'actions' }, button({ label: 'Save RCS agent ID', type: 'submit' }), button({ label: 'Check RCS agent', icon: 'refresh', onclick: e => check('rcs', e.currentTarget) })),
      lastCheck('rcs'),
    ),
  );
}

/** One redirect address with its label and a Copy button named for it. */
function redirectField(label, value, id) {
  const f = copyField({ value, label: 'Copy', copiedMessage: 'The ' + label + ' redirect address was copied.' });
  const code = f.querySelector('code');
  code.id = id;
  const copy = f.querySelector('button');
  if (copy) copy.setAttribute('aria-label', 'Copy the ' + label + ' redirect address');
  return h('div', { class: 'redirect' }, h('p', { class: 'redirect-label' }, h('strong', {}, label)), f);
}

function google() {
  const keys = ['googleClientId', 'googleClientSecret'];
  return h(
    'form',
    {
      class: 'keys-form card',
      novalidate: true,
      onsubmit: e => {
        e.preventDefault();
        saveKeys(keys, e.submitter);
      },
    },
    h(
      'div',
      { class: 'card-body' },
      h('h2', {}, 'Google (optional)'),
      h('p', {}, 'Sign-in with Google and Google Calendar. Free.'),
      h(
        'ol',
        { class: 'small how' },
        h('li', {}, 'Create a project; enable the Google Calendar API.'),
        h('li', {}, 'Consent screen: External, in production, site addresses; scopes openid, email, profile, calendar.app.created.'),
        h('li', {}, 'One “Web application” OAuth client with both redirects below.'),
        h('li', {}, 'Paste ID and secret, save, Check Google.'),
      ),
      h('h4', {}, 'Redirect addresses'),
      h('p', { class: 'help' }, 'Both go on the same OAuth client, as authorized redirect URIs.'),
      redirectField('Sign in with Google', S.urls.signInRedirect, 'redirect-signin'),
      redirectField('Google Calendar', S.urls.redirect, 'redirect-calendar'),
      secretField('googleClientId', 'text'),
      secretField('googleClientSecret'),
      h('div', { class: 'actions' }, button({ label: 'Save Google keys', variant: 'primary', type: 'submit' }), button({ label: 'Check Google', icon: 'refresh', onclick: e => check('google', e.currentTarget) })),
      lastCheck('google'),
    ),
  );
}

export function keysPage() {
  return [telnyx(), rcs(), google()];
}
