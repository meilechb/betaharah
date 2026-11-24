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
  telnyxPublicKey: 'Telnyx portal → Keys & Credentials → Public Key. It proves that received texts come from Telnyx.',
  telnyxNumber: 'The toll-free number, with the country code, for example +1 888 555 0100.',
  telnyxMessagingProfileId: 'Telnyx portal → Messaging → your profile. Needed for RCS; the Check button also compares it with the number’s profile.',
  rcsAgentId: 'The id Telnyx gave the RCS agent when it was created.',
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
          const ok = await confirmDialog({ title: 'Clear the saved ' + LABELS[key].replace(/^Your /, '') + '?', body: 'It is removed from the site. What depends on it stops working until a new one is saved.', confirmLabel: 'Clear it', danger: true });
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
    toast('Nothing new to save. Type a key first.');
    return;
  }
  fieldErrors = {};
  run(
    () => call('PUT', '/api/admin/secrets', patch),
    state => {
      for (const k of keys) delete draft.secrets[k];
      saved('Saved. The keys are stored encrypted and are not shown again.')(state);
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
      h('p', {}, S.smsReady ? 'Texting is working from this account’s number.' : 'Texting is not working yet. Cost: about $1 a month for a toll-free number and about 1 cent per text, in each direction.'),
      h(
        'ol',
        { class: 'small how' },
        h('li', {}, 'In Telnyx, add a payment method and buy a toll-free number with SMS.'),
        h('li', {}, 'Create a Messaging Profile and assign the number to it. Leave its opt-out settings as they are.'),
        h('li', {}, 'Set the profile’s inbound webhook URL to the address below.'),
        h('li', {}, 'Paste the keys and the number here, save, and press Check Telnyx.'),
        h('li', {}, 'Submit the toll-free verification in Telnyx, and tick the boxes below as it goes.'),
      ),
      secretField('telnyxApiKey'),
      secretField('telnyxPublicKey', 'text'),
      secretField('telnyxNumber', 'text'),
      secretField('telnyxMessagingProfileId', 'text'),
      h('div', { class: 'actions' }, button({ label: 'Save Telnyx keys', variant: 'primary', type: 'submit' }), button({ label: 'Check Telnyx', icon: 'refresh', onclick: e => check('telnyx', e.currentTarget) })),
      h('p', { class: 'help' }, 'Check Telnyx reads the number’s record from Telnyx. It sends nothing and changes nothing.'),
      lastCheck('telnyx'),
      h('h4', {}, 'Webhook address'),
      h('p', { class: 'help' }, 'Telnyx sends received texts here. Paste it as the Messaging Profile’s inbound webhook URL.'),
      copyField({ value: S.urls.webhook, label: 'Copy', copiedMessage: 'The webhook address was copied.' }),
      h('p', { class: 'small' }, received ? 'Last text received: ' + ago(received, S.now) + '.' : 'No text has reached the site yet. After setting the address, text 9 to the number from your phone.'),
      h('h4', {}, 'Toll-free verification'),
      h('p', { class: 'help' }, 'US carriers do not deliver texts from an unverified toll-free number. Telnyx says the review takes one to two weeks. The site cannot see it, so note it here for yourself.'),
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
        'RCS sends the same messages through the phone’s own messaging app with the site’s name and logo, where the phone and carrier support it; other phones still get SMS. It needs an RCS agent approved by Telnyx and the carriers. To get one, you register a brand in Telnyx with a legal business name and a tax ID (EIN), an address, a website, a logo and the privacy and terms pages, then submit the agent for review. Telnyx charges a one-time fee when the agent is submitted, a launch fee, and a monthly fee for the agent, on top of the price per message. SMS alone is enough for this site.',
      ),
      h(
        'p',
        { class: 'help' },
        'When Telnyx approves the agent: link it to the same Messaging Profile as the number, and set the RCS agent’s own inbound webhook to the same address as the number’s (shown under Telnyx above). Telnyx sends received RCS messages to the address on the agent, not the one on the profile. Every RCS text also carries an SMS copy with the same words, so phones without RCS still get it.',
      ),
      alert({ kind: S.rcsReady ? 'ok' : 'info' }, S.rcsReady ? 'RCS is in use: it is switched on, texting works, and the agent ID and Messaging Profile ID are saved.' : 'RCS is not in use. It needs texting to work, the agent ID and the Messaging Profile ID (under Telnyx) saved, and the switch below on.'),
      secretField('rcsAgentId', 'text'),
      checkRow({
        id: 'rcsEnabled',
        label: 'Send by RCS (with SMS for phones without it)',
        help: 'Switch this on only when Check RCS agent says the agent is live.',
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
      h('h2', {}, 'Google: sign-in and Calendar (optional)'),
      h('p', {}, 'One Google OAuth client does two things: people can sign in with Google, and they can connect a Google calendar. Without it, people sign in with their phone and can still use the calendar subscription link, which Google refreshes on its own schedule (up to about 12 hours). With it, a connected Google calendar is updated within about a minute. Free.'),
      h(
        'ol',
        { class: 'small how' },
        h('li', {}, 'In Google Cloud Console, create a project and enable the Google Calendar API.'),
        h('li', {}, 'Set up the consent screen: audience External, published to production, with the home page, privacy and terms addresses of this site. Add the scopes openid, email and profile (for sign-in) and calendar.app.created (for the calendar).'),
        h('li', {}, 'Create one OAuth client of type “Web application” and add both redirect addresses below as authorized redirect URIs.'),
        h('li', {}, 'Paste the client ID and secret here, save, and press Check Google.'),
      ),
      h('h4', {}, 'Redirect addresses'),
      h('p', { class: 'help' }, 'Both go on the same OAuth client, as authorized redirect URIs. Sign-in or the calendar fails with a “redirect_uri_mismatch” error from Google if one is missing.'),
      redirectField('Sign in with Google', S.urls.signInRedirect, 'redirect-signin'),
      redirectField('Google Calendar', S.urls.redirect, 'redirect-calendar'),
      secretField('googleClientId', 'text'),
      secretField('googleClientSecret'),
      h('div', { class: 'actions' }, button({ label: 'Save Google keys', variant: 'primary', type: 'submit' }), button({ label: 'Check Google', icon: 'refresh', onclick: e => check('google', e.currentTarget) })),
      h('p', { class: 'help' }, 'Check Google asks Google whether it knows this client. Nobody is signed in and nothing is changed.'),
      lastCheck('google'),
    ),
  );
}

export function keysPage() {
  return [telnyx(), rcs(), google()];
}
