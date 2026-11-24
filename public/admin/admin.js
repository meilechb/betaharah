'use strict';
/*
 * The operator's console: the site's settings, its keys, invitations and
 * totals. It never shows any account's data. Text from the server is always
 * inserted as text, never as HTML.
 */

const root = document.getElementById('root');

let S = null;
let config = null;
let secrets = {};
let invite = { kind: 'setup', number: '', note: '', maxUses: 1, days: 14, link: '' };
let testTo = '';
let toastTimer = null;

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = Boolean(v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

async function api(method, path, body) {
  const headers = { 'x-betaharah': '1' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    json = null;
  }
  if (res.status === 401 && path !== '/api/admin/login') {
    S = null;
    renderLogin('');
    throw new Error('Please sign in again.');
  }
  if (!res.ok) throw new Error((json && json.error) || 'The request failed (' + res.status + ').');
  return json;
}

function toast(message, bad) {
  document.querySelectorAll('.toast').forEach(el => el.remove());
  const el = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, message);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), bad ? 9000 : 5000);
}

async function run(action, done) {
  try {
    const result = await action();
    if (done) done(result);
  } catch (e) {
    if (S) toast(e.message || 'Something went wrong.', true);
  }
}

function adopt(state) {
  S = state;
  config = JSON.parse(JSON.stringify(S.config));
  secrets = {};
}

function saved(message) {
  return state => {
    adopt(state);
    render();
    if (message) toast(message);
  };
}

const date = ms => new Date(ms).toLocaleDateString('en-US', { dateStyle: 'medium' });

function renderLogin(message) {
  let password = '';
  const form = h(
    'form',
    {
      class: 'card login',
      onsubmit: e => {
        e.preventDefault();
        api('POST', '/api/admin/login', { password }).then(load, err => renderLogin(err.message));
      },
    },
    h('h2', {}, 'Operator console'),
    message ? h('div', { class: 'alert bad', role: 'alert' }, message) : null,
    h('p', { class: 'muted' }, 'For the person who runs this site. To use the calendar, go to the ', h('a', { href: '/app/' }, 'sign-in page'), '.'),
    h('div', { class: 'field' }, h('label', { for: 'pw' }, 'Operator password'), h('input', { id: 'pw', type: 'password', class: 'wide', autocomplete: 'current-password', required: true, oninput: e => (password = e.target.value) })),
    h('button', { class: 'primary', type: 'submit' }, 'Sign in'),
  );
  root.replaceChildren(form);
  form.querySelector('input').focus();
}

async function load() {
  try {
    adopt(await api('GET', '/api/admin/state'));
    render();
  } catch (e) {
    if (!S) renderLogin(e.message === 'Please sign in again.' ? '' : e.message);
  }
}

function render() {
  root.replaceChildren(
    h('header', { class: 'top' }, h('h1', {}, 'Betaharah operator console'), h('div', { class: 'today' }, 'Accounts, phones and recent texts. Cycle entries are not listed.')),
    statusCard(),
    signupCard(),
    keysCard(),
    invitesCard(),
    householdsCard(),
    h('section', { class: 'card' }, h('button', { type: 'button', onclick: () => run(() => api('POST', '/api/admin/logout'), () => ((S = null), renderLogin(''))) }, 'Sign out')),
  );
}

function statusCard() {
  const t = S.totals;
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Status'),
    h('div', { class: 'alert ' + (S.smsReady ? 'ok' : 'info') }, S.smsReady ? 'Text messaging is working: codes, replies and reminders are sent from ' + S.textingNumber + '.' : 'Text messaging is off or not set up. People can sign in only with a password, and only accounts you create by invitation can exist.'),
    h('div', { class: 'alert ' + (S.googleReady ? 'ok' : 'info') }, S.googleReady ? 'Google sign-in and Google Calendar are available.' : 'Google is not set up. Accounts can still use a password and the calendar subscription link.'),
    h('p', { class: 'small muted' }, S.health && S.health.lastTickAt ? 'The minute job last ran ' + new Date(S.health.lastTickAt).toLocaleString('en-US') + (S.health.lastTickError ? ' (last error: ' + S.health.lastTickError + ')' : '.') : 'The minute job has not run yet.'),
    h(
      'table',
      {},
      h('tr', {}, h('td', {}, 'Accounts'), h('td', {}, String(t.households))),
      h('tr', {}, h('td', {}, 'Phones'), h('td', {}, String(t.phones))),
      h('tr', {}, h('td', {}, 'Reminders waiting to be sent'), h('td', {}, String(t.pendingReminders))),
      h('tr', {}, h('td', {}, 'Texts sent this month'), h('td', {}, S.usage.textsThisMonth + ' of at most ' + S.config.monthlyMessageLimit)),
      h('tr', {}, h('td', {}, 'Sign-in codes requested today'), h('td', {}, S.usage.codesToday + ' of at most ' + S.config.dailyCodeLimit)),
    ),
  );
}

function numberField(label, key, min, max) {
  return h('label', { class: 'row' }, h('span', {}, label), h('input', { type: 'number', min, max, step: 1, value: config[key], oninput: e => (config[key] = Number(e.target.value)) }));
}

function signupCard() {
  return h(
    'form',
    {
      class: 'card',
      onsubmit: e => {
        e.preventDefault();
        run(() => api('PUT', '/api/admin/config', config), saved('Saved.'));
      },
    },
    h('h2', {}, 'Sign-up and limits'),
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'signup' }, 'Who may create an account'),
      h(
        'select',
        { id: 'signup', onchange: e => (config.signup = e.target.value) },
        h('option', { value: 'open', selected: config.signup === 'open' }, 'Anyone with a phone number'),
        h('option', { value: 'invite', selected: config.signup === 'invite' }, 'Only people with an invitation link'),
        h('option', { value: 'closed', selected: config.signup === 'closed' }, 'Nobody (existing accounts keep working)'),
      ),
    ),
    h('label', { class: 'choice' }, h('input', { type: 'checkbox', checked: config.smsEnabled, onchange: e => (config.smsEnabled = e.target.checked) }), h('span', {}, 'Send text messages (uncheck to stop all sending at once)')),
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'prefixes' }, 'Phone numbers must begin with'),
      h('input', {
        id: 'prefixes',
        type: 'text',
        value: config.allowedPrefixes.join(', '),
        oninput: e => (config.allowedPrefixes = e.target.value.split(',').map(s => s.trim()).filter(Boolean)),
      }),
      h('div', { class: 'help' }, 'Separate with commas, for example +1, +44. Texts to other countries cost more; keeping this to +1 also stops codes being requested for foreign numbers.'),
    ),
    h('p', { class: 'help' }, 'Every text costs you about a cent. These limits cap the bill.'),
    numberField('Most sign-in codes in one day, everyone together', 'dailyCodeLimit', 0, 100000),
    numberField('Most texts in one month, everyone together', 'monthlyMessageLimit', 0, 1000000),
    numberField('Most texts in one month to one account', 'householdMonthlyLimit', 0, 10000),
    h('h3', {}, 'Contact shown on the Help, Privacy and Terms pages'),
    h('div', { class: 'field' }, h('label', { for: 'cname' }, 'Your name, or a name for the site'), h('input', { id: 'cname', type: 'text', class: 'wide', maxlength: 80, value: config.contactName, oninput: e => (config.contactName = e.target.value) })),
    h('div', { class: 'field' }, h('label', { for: 'cemail' }, 'Contact email (public)'), h('input', { id: 'cemail', type: 'email', class: 'wide', maxlength: 120, value: config.contactEmail, oninput: e => (config.contactEmail = e.target.value) })),
    h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit' }, 'Save')),
  );
}

function secretField(key, label, type) {
  return h(
    'div',
    { class: 'field' },
    h('label', { for: 'k-' + key }, label),
    h('input', {
      id: 'k-' + key,
      type: type || 'password',
      class: 'wide',
      autocomplete: 'off',
      placeholder: S.secretsSet[key] ? 'Saved. Type to replace.' : '',
      value: secrets[key] || '',
      oninput: e => {
        if (e.target.value === '') delete secrets[key];
        else secrets[key] = e.target.value;
      },
    }),
  );
}

function saveSecrets(keys) {
  const patch = {};
  for (const k of keys) if (k in secrets) patch[k] = secrets[k];
  if (Object.keys(patch).length === 0) return toast('Nothing new to save.');
  run(() => api('PUT', '/api/admin/secrets', patch), saved('Saved.'));
}

function keysCard() {
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Keys'),
    h('p', { class: 'help' }, 'Keys are stored encrypted and are never shown again after saving.'),
    h('h3', {}, 'Text messages (Telnyx)'),
    h(
      'ol',
      { class: 'small' },
      h('li', {}, 'In Telnyx, buy a toll-free number, create a Messaging Profile, and assign the number to it.'),
      h('li', {}, 'Submit the toll-free verification. It asks for these addresses: website ', h('code', {}, S.urls.home), ', privacy ', h('code', {}, S.urls.privacy), ', terms ', h('code', {}, S.urls.terms), '.'),
      h('li', {}, 'Set the profile’s inbound webhook address to:', h('code', { class: 'copy' }, S.urls.webhook)),
      h('li', {}, 'Paste the API key, the public key and the number here.'),
    ),
    secretField('telnyxApiKey', 'Telnyx API key'),
    secretField('telnyxPublicKey', 'Telnyx public key', 'text'),
    secretField('telnyxNumber', 'Your Telnyx number', 'text'),
    h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => saveSecrets(['telnyxApiKey', 'telnyxPublicKey', 'telnyxNumber']) }, 'Save Telnyx keys')),
    h(
      'form',
      {
        class: 'row',
        onsubmit: e => {
          e.preventDefault();
          run(() => api('POST', '/api/admin/test-text', { to: testTo }), () => toast('A test text was sent.'));
        },
      },
      h('input', { type: 'tel', 'aria-label': 'Number for a test text', placeholder: 'Your own mobile number', required: true, value: testTo, oninput: e => (testTo = e.target.value) }),
      h('button', { type: 'submit', disabled: !S.smsReady }, 'Send a test text'),
    ),
    h('h3', {}, 'Google Calendar (optional)'),
    h(
      'ol',
      { class: 'small' },
      h('li', {}, 'In Google Cloud Console, create a project and enable the Google Calendar API.'),
      h('li', {}, 'Set up the consent screen (audience: External; publish it to production) with the website, privacy and terms addresses above.'),
      h('li', {}, 'Add two scopes: openid, email and profile for sign-in, and calendar.app.created for the calendar.'),
      h('li', {}, 'Create an OAuth client of type “Web application” with both redirect URIs:', h('code', { class: 'copy' }, S.urls.signInRedirect), h('code', { class: 'copy' }, S.urls.redirect)),
      h('li', {}, 'Paste the client ID and client secret here.'),
    ),
    secretField('googleClientId', 'Client ID', 'text'),
    secretField('googleClientSecret', 'Client secret'),
    h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => saveSecrets(['googleClientId', 'googleClientSecret']) }, 'Save Google keys')),
  );
}

function invitesCard() {
  const setKind = kind => {
    invite.kind = kind;
    render();
  };
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Invitations'),
    h(
      'form',
      {
        onsubmit: e => {
          e.preventDefault();
          const body = invite.kind === 'setup' ? { kind: 'setup', number: invite.number, note: invite.note, days: invite.days } : { kind: 'signup', note: invite.note, maxUses: invite.maxUses, days: invite.days };
          run(
            () => api('POST', '/api/admin/invites', body),
            r => {
              adopt(r.state);
              invite.link = r.link;
              invite.number = '';
              render();
            },
          );
        },
      },
      h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'ikind', checked: invite.kind === 'setup', onchange: () => setKind('setup') }), h('span', {}, 'For one phone number, with a password and no texted code. Use this before text messaging works.')),
      h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'ikind', checked: invite.kind === 'signup', onchange: () => setKind('signup') }), h('span', {}, 'A link that lets people sign up with a texted code while sign-up is by invitation.')),
      invite.kind === 'setup'
        ? h('div', { class: 'field' }, h('label', { for: 'inum' }, 'The person’s mobile number'), h('input', { id: 'inum', type: 'tel', required: true, placeholder: '(732) 555-0123', value: invite.number, oninput: e => (invite.number = e.target.value) }))
        : h('label', { class: 'row' }, h('span', {}, 'How many people may use it'), h('input', { type: 'number', min: 1, max: 100, value: invite.maxUses, oninput: e => (invite.maxUses = Number(e.target.value)) })),
      h('label', { class: 'row' }, h('span', {}, 'Days until it expires'), h('input', { type: 'number', min: 1, max: 90, value: invite.days, oninput: e => (invite.days = Number(e.target.value)) })),
      h('div', { class: 'field' }, h('label', { for: 'inote' }, 'Note for yourself (optional; do not write a phone number, notes are not encrypted)'), h('input', { id: 'inote', type: 'text', class: 'wide', maxlength: 80, value: invite.note, oninput: e => (invite.note = e.target.value) })),
      h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit' }, 'Create invitation')),
    ),
    invite.link ? h('div', { class: 'alert ok' }, 'Send this link to the person. It is shown only now.', h('code', { class: 'copy' }, invite.link)) : null,
    h('h3', {}, 'Open invitations'),
    S.invites.length === 0
      ? h('p', { class: 'muted' }, 'None.')
      : h(
          'ul',
          { class: 'list' },
          S.invites.map(i =>
            h(
              'li',
              {},
              h('div', { class: 'main' }, h('div', { class: 'title' }, (i.kind === 'setup' ? 'For one number' : 'Sign-up link') + (i.note ? ': ' + i.note : '')), h('div', { class: 'when' }, 'Used ' + i.uses + ' of ' + i.maxUses + ' · made ' + date(i.createdAt) + ' · expires ' + date(i.expiresAt))),
              h('button', { class: 'danger', type: 'button', onclick: () => run(() => api('DELETE', '/api/admin/invites/' + encodeURIComponent(i.id)), saved('Cancelled.')) }, 'Cancel'),
            ),
          ),
        ),
  );
}

function householdsCard() {
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Accounts'),
    h('p', { class: 'help' }, 'Phone numbers, the Google email used to sign in, and the recent texts. The stored dates themselves are not listed. Deleting an account removes all of its data; it cannot be undone.'),
    !S.accounts || S.accounts.length === 0
      ? h('p', { class: 'muted' }, 'None yet.')
      : h(
          'ul',
          { class: 'list' },
          S.accounts.map(a =>
            h(
              'li',
              {},
              h(
                'div',
                { class: 'main' },
                h('div', { class: 'mono' }, a.id),
                h('div', { class: 'when' }, 'Created ' + date(a.createdAt) + ' · last changed ' + date(a.updatedAt)),
                a.unreadable
                  ? h('div', { class: 'alert bad' }, 'This account could not be read.')
                  : h(
                      'div',
                      {},
                      a.googleEmail ? h('div', {}, 'Google: ' + a.googleEmail + (a.googleName ? ' (' + a.googleName + ')' : '')) : null,
                      a.phones.length === 0 ? h('div', { class: 'muted' }, 'No phone yet.') : a.phones.map(p => h('div', {}, p.number + (p.optedOut ? ' · STOP' : p.texts ? ' · reminders on' : '') + (p.verified ? '' : ' · not verified'))),
                      a.messages.length === 0
                        ? null
                        : h(
                            'ul',
                            { class: 'list' },
                            a.messages.map(m => h('li', {}, h('div', { class: 'main' }, h('div', { class: 'when' }, (m.direction === 'in' ? 'In' : 'Out') + ' ···' + m.phone + ' · ' + m.status + ' · ' + new Date(m.at).toLocaleString('en-US')), h('div', {}, m.body)))),
                          ),
                    ),
              ),
              h(
                'button',
                {
                  class: 'danger',
                  type: 'button',
                  onclick: () => {
                    const typed = prompt('Delete account ' + a.id + ' and all of its data? This cannot be undone.\n\nType DELETE to confirm.');
                    if (typed === null || typed.trim() !== 'DELETE') return;
                    run(() => api('DELETE', '/api/admin/households/' + encodeURIComponent(a.id)), saved('Deleted.'));
                  },
                },
                'Delete',
              ),
            ),
          ),
        ),
  );
}

load();
