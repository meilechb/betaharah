'use strict';
/*
 * The dashboard. One page, no build step, no outside scripts.
 * Everything shown comes from the server; every change goes through the API
 * and the page is redrawn from the answer. Text from the server is always
 * inserted as text, never as HTML.
 *
 * Sentences are English. Halachic terms come from the server in the form
 * the household chose (English letters or Hebrew) and are filled in where a
 * sentence has {term}.
 */

const root = document.getElementById('root');
const TABS = ['today', 'log', 'customs', 'settings'];

/** What the site allows, from /api/public. */
let P = null;
/** State from the server, once signed in. */
let S = null;
/** Unsaved edits to the settings forms. */
let draft = { halachic: null, app: null, phones: [] };
/** The "record an event" form. */
let rec = newRec();
/** The sign-in form. */
let auth = { mode: 'code', step: 'number', number: '', code: '', password: '', password2: '', invite: null, inviteKind: null, message: '', busy: false };
/** The "add a phone" form. */
let adding = { step: 'idle', number: '', code: '' };
/** The password form under Settings. */
let pw = { a: '', b: '' };
let tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
let toastTimer = null;

function newRec() {
  return { kind: null, mode: 'now', date: '', how: 'day', time: '', veset: true, note: '' };
}

// ---------- small helpers ----------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') el[k] = Boolean(v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const clone = value => JSON.parse(JSON.stringify(value));

/** Fills {term} places with the household's form of each term. */
function t(template) {
  return template.replace(/\{([a-z_]+)\}/g, (whole, key) => (S && S.words && S.words[key]) || whole);
}
const cap = text => text.charAt(0).toUpperCase() + text.slice(1);

/** "+17325550123" as "(732) 555-0123"; other numbers unchanged. */
function pretty(number) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(number || '');
  return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : number || '';
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
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    S = null;
    auth.message = 'Please sign in again.';
    renderAuth();
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

/** Runs an action; shows its error. */
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
  draft.halachic = clone(S.halachic.settings);
  draft.app = clone(S.app);
  draft.phones = clone(S.phones);
}

/** For actions whose answer carries the new state. */
function saved(message) {
  return result => {
    adopt(result.state);
    render();
    if (message) toast(message);
  };
}

function todayIso() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: S.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

function when(ms) {
  try {
    return new Date(ms).toLocaleString('en-US', { timeZone: S.timeZone, dateStyle: 'medium', timeStyle: 'short' });
  } catch (e) {
    return new Date(ms).toLocaleString('en-US');
  }
}

// ---------- sign-in ----------

function field(label, input, help) {
  return h('div', { class: 'field' }, h('label', { for: input.id }, label), input, help ? h('div', { class: 'help' }, help) : null);
}

function renderAuth() {
  const a = auth;
  const set = patch => {
    Object.assign(a, patch);
    renderAuth();
  };
  const fail = err => set({ busy: false, message: err.message || 'Something went wrong.' });
  const signedIn = () => {
    auth = { mode: 'code', step: 'number', number: '', code: '', password: '', password2: '', invite: null, inviteKind: null, message: '', busy: false };
    history.replaceState(null, '', location.pathname + location.hash);
    start().catch(showFatal);
  };

  const numberInput = h('input', {
    id: 'number',
    type: 'tel',
    class: 'wide',
    autocomplete: 'tel',
    inputmode: 'tel',
    required: true,
    placeholder: '(732) 555-0123',
    value: a.number,
    oninput: e => (a.number = e.target.value),
  });
  const notes = [];
  if (a.message) notes.push(h('div', { class: 'alert bad', role: 'alert' }, a.message));
  if (!a.invite && P.signup === 'invite') notes.push(h('div', { class: 'alert info' }, 'New accounts are by invitation. If you already have an account, sign in here.'));
  if (!a.invite && P.signup === 'closed') notes.push(h('div', { class: 'alert info' }, 'New sign-ups are closed. If you already have an account, sign in here.'));

  let form;
  if (a.inviteKind === 'setup') {
    // An invitation made for one phone number: choose a password, no texted code.
    const p1 = h('input', { id: 'pw1', type: 'password', class: 'wide', autocomplete: 'new-password', required: true, minlength: 10, value: a.password, oninput: e => (a.password = e.target.value) });
    const p2 = h('input', { id: 'pw2', type: 'password', class: 'wide', autocomplete: 'new-password', required: true, minlength: 10, value: a.password2, oninput: e => (a.password2 = e.target.value) });
    form = h(
      'form',
      {
        class: 'card login',
        onsubmit: e => {
          e.preventDefault();
          if (a.password !== a.password2) return set({ message: 'The two passwords are not the same.' });
          set({ busy: true, message: '' });
          api('POST', '/api/auth/setup', { invite: a.invite, number: a.number, password: a.password }).then(signedIn, fail);
        },
      },
      h('h2', {}, 'Set up your account'),
      notes,
      h('p', { class: 'muted' }, 'You were invited to Betaharah. Enter the phone number the invitation was made for, and choose a password.'),
      field('Your mobile number', numberInput),
      field('Choose a password', p1, 'At least 10 characters.'),
      field('The same password again', p2),
      h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit', disabled: a.busy }, 'Create account')),
      legal(),
    );
  } else if (a.mode === 'password') {
    const p = h('input', { id: 'pw', type: 'password', class: 'wide', autocomplete: 'current-password', required: true, value: a.password, oninput: e => (a.password = e.target.value) });
    form = h(
      'form',
      {
        class: 'card login',
        onsubmit: e => {
          e.preventDefault();
          set({ busy: true, message: '' });
          api('POST', '/api/auth/password', { number: a.number, password: a.password }).then(signedIn, fail);
        },
      },
      h('h2', {}, 'Sign in'),
      notes,
      !P.sms ? h('p', { class: 'muted' }, 'Sign-in by text message is not available yet. Sign in with your password.') : null,
      field('Your mobile number', numberInput),
      field('Password', p),
      h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit', disabled: a.busy }, 'Sign in')),
      P.sms ? h('p', {}, h('button', { class: 'link', type: 'button', onclick: () => set({ mode: 'code', step: 'number', message: '' }) }, 'Sign in with a texted code instead')) : null,
      legal(),
    );
  } else if (a.step === 'number') {
    form = h(
      'form',
      {
        class: 'card login',
        onsubmit: e => {
          e.preventDefault();
          set({ busy: true, message: '' });
          api('POST', '/api/auth/code', { number: a.number, invite: a.invite || undefined }).then(() => set({ busy: false, step: 'code', code: '' }), fail);
        },
      },
      h('h2', {}, 'Sign in or sign up'),
      notes,
      h('p', { class: 'muted' }, 'Enter your mobile number. We text you a 6-digit code. That is all it takes, the first time and every time.'),
      field('Your mobile number', numberInput),
      h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit', disabled: a.busy }, 'Text me a code')),
      h('p', {}, h('button', { class: 'link', type: 'button', onclick: () => set({ mode: 'password', message: '' }) }, 'Sign in with a password instead')),
      h(
        'p',
        { class: 'muted small' },
        'By asking for a code you agree to receive it by text message at this number. Message and data rates may apply. Reminders are sent only if you turn them on later.',
      ),
      legal(),
    );
  } else {
    const codeInput = h('input', {
      id: 'code',
      type: 'text',
      class: 'code',
      autocomplete: 'one-time-code',
      inputmode: 'numeric',
      maxlength: 6,
      pattern: '[0-9]{6}',
      required: true,
      value: a.code,
      oninput: e => (a.code = e.target.value.replace(/\D/g, '')),
    });
    form = h(
      'form',
      {
        class: 'card login',
        onsubmit: e => {
          e.preventDefault();
          set({ busy: true, message: '' });
          api('POST', '/api/auth/verify', { number: a.number, code: a.code, invite: a.invite || undefined }).then(signedIn, fail);
        },
      },
      h('h2', {}, 'Enter the code'),
      notes,
      h('p', { class: 'muted' }, 'If ' + a.number + ' can sign in here, a 6-digit code was texted to it. It is good for 10 minutes.'),
      field('Code', codeInput),
      h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit', disabled: a.busy }, 'Sign in')),
      h(
        'p',
        { class: 'small' },
        h('button', { class: 'link', type: 'button', onclick: () => set({ step: 'number', message: '' }) }, 'Use a different number, or send a new code'),
        ' (a new code can be sent after one minute)',
      ),
    );
  }
  root.replaceChildren(h('header', { class: 'top' }, h('h1', {}, h('a', { href: '/' }, 'Betaharah'))), form);
  const first = form.querySelector(a.step === 'code' && a.mode === 'code' && !a.inviteKind ? '#code' : '#number');
  if (first && !a.busy) first.focus();
}

function legal() {
  return h('p', { class: 'muted small' }, h('a', { href: '/terms' }, 'Terms'), ' · ', h('a', { href: '/privacy' }, 'Privacy'), ' · ', h('a', { href: '/help' }, 'Help'));
}

function showFatal(e) {
  root.replaceChildren(h('div', { class: 'card login' }, h('h2', {}, 'Could not load'), h('p', {}, (e && e.message) || 'Unknown error')));
}

async function start() {
  P = await api('GET', '/api/public');
  if (!P.configured) {
    root.replaceChildren(h('div', { class: 'card login' }, h('h2', {}, 'Not set up yet'), h('p', {}, 'This site is not ready to be used yet.')));
    return;
  }
  const params = new URLSearchParams(location.search);
  if (P.signedIn) {
    adopt((await api('GET', '/api/state')).state);
    if (params.get('google_error')) toast(params.get('google_error'), true);
    if (params.get('google') === 'connected') toast('Google Calendar is connected. It fills in within a minute.');
    if (location.search) history.replaceState(null, '', location.pathname + location.hash);
    render();
    return;
  }
  const invite = params.get('invite');
  if (invite && !auth.invite) {
    try {
      const info = await api('GET', '/api/auth/invite?code=' + encodeURIComponent(invite));
      auth.invite = invite;
      auth.inviteKind = info.kind;
    } catch (e) {
      auth.message = e.message;
    }
  }
  if (!P.sms && auth.inviteKind !== 'setup') auth.mode = 'password';
  renderAuth();
}

// ---------- page ----------

function render() {
  if (!S) return;
  const tabs = [
    ['today', 'Today'],
    ['log', 'Log'],
    ['customs', 'Customs'],
    ['settings', 'Settings'],
  ];
  root.replaceChildren(
    h(
      'header',
      { class: 'top' },
      h('h1', {}, 'Betaharah'),
      S.today ? h('div', { class: 'today' }, S.today.hebrew + ' · ' + S.today.part + ' · ' + S.today.civil) : null,
    ),
    h(
      'nav',
      { class: 'tabs', role: 'tablist' },
      tabs.map(([id, label]) => h('button', { role: 'tab', 'aria-selected': String(tab === id), onclick: () => go(id) }, label)),
    ),
    tab === 'today' ? viewToday() : tab === 'log' ? viewLog() : tab === 'customs' ? viewCustoms() : viewSettings(),
  );
}

function go(id) {
  tab = id;
  history.replaceState(null, '', '#' + id);
  render();
  window.scrollTo(0, 0);
}

function alertsBlock() {
  return S.alerts.map(a => h('div', { class: 'alert' + (a.level === 'info' ? ' info' : '') }, a.text));
}

function termsToggle() {
  const pick = value => {
    if (S.app.terms === value) return;
    run(() => api('PUT', '/api/app', { ...S.app, terms: value }), saved());
  };
  return h(
    'div',
    { class: 'row' },
    h('span', {}, 'Halachic terms in'),
    h(
      'div',
      { class: 'toggle', role: 'group', 'aria-label': 'Language of halachic terms' },
      h('button', { type: 'button', 'aria-pressed': String(S.app.terms === 'en'), onclick: () => pick('en') }, 'English'),
      h('button', { type: 'button', 'aria-pressed': String(S.app.terms === 'he'), onclick: () => pick('he') }, 'עברית'),
    ),
  );
}

// ---------- today ----------

function setupCard() {
  const required = S.setup.filter(s => s.key === 'place' || s.key === 'customs' || s.key === 'entry');
  if (required.every(s => s.done)) return null;
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Getting started'),
    h(
      'ul',
      { class: 'checklist' },
      S.setup.map(s =>
        h(
          'li',
          { class: s.done ? 'done' : '' },
          h('span', { class: 'mark', 'aria-hidden': 'true' }, s.done ? '✓' : '○'),
          h('span', { class: 'text' }, s.done || s.tab === tab ? s.text : h('button', { class: 'link', type: 'button', onclick: () => go(s.tab) }, s.text), s.done ? ' (done)' : ''),
        ),
      ),
    ),
  );
}

function viewToday() {
  return h(
    'div',
    {},
    alertsBlock(),
    setupCard(),
    S.status
      ? h('section', { class: 'card status' }, h('p', { class: 'headline' }, S.status.headline), S.status.detail ? h('p', { class: 'detail' }, S.status.detail) : null)
      : h('section', { class: 'card' }, h('p', {}, 'Nothing can be calculated until a location is chosen.'), h('button', { class: 'primary', type: 'button', onclick: () => go('settings') }, 'Choose your location')),
    S.status ? recordCard() : null,
    S.status ? upcomingCard() : null,
  );
}

function recordCard() {
  const kinds = ['flow', 'stain', 'hefsek', 'broken', 'mikvah'];
  const needsOnah = rec.kind === 'flow' || rec.kind === 'stain' || rec.kind === 'broken';
  const set = (key, value, redraw) => {
    rec[key] = value;
    if (redraw) render();
  };
  const radio = (name, value, label, current, onpick) =>
    h('label', { class: 'choice' }, h('input', { type: 'radio', name, checked: current === value, onchange: () => onpick(value) }), h('span', {}, label));

  let form = null;
  if (rec.kind) {
    const dateLabel = rec.kind === 'mikvah' ? 'The evening of the ' + t('{immersion}') : 'Date';
    form = h(
      'form',
      {
        onsubmit: e => {
          e.preventDefault();
          const body = { kind: rec.kind };
          if (rec.mode === 'now') body.when = 'now';
          else {
            body.date = rec.date;
            if (needsOnah) {
              if (rec.how === 'time') body.time = rec.time;
              else body.part = rec.how;
            }
          }
          if (rec.kind === 'flow') body.veset = rec.veset;
          if (rec.note.trim()) body.note = rec.note.trim();
          run(
            () => api('POST', '/api/entries', body),
            result => {
              adopt(result.state);
              rec = newRec();
              render();
              toast(result.message || 'Recorded.');
            },
          );
        },
      },
      h('hr'),
      h(
        'div',
        { class: 'field' },
        h('div', { class: 'label' }, 'When?'),
        radio('mode', 'now', rec.kind === 'hefsek' ? 'Today' : rec.kind === 'mikvah' ? 'Tonight' : 'Now', rec.mode, v => set('mode', v, true)),
        radio('mode', 'other', 'Another time', rec.mode, v => {
          if (!rec.date) rec.date = todayIso();
          set('mode', v, true);
        }),
      ),
      rec.mode === 'other'
        ? h(
            'div',
            { class: 'field' },
            h('label', { for: 'rec-date' }, dateLabel),
            h('input', { id: 'rec-date', type: 'date', required: true, value: rec.date, max: todayIso(), oninput: e => set('date', e.target.value) }),
            needsOnah
              ? h(
                  'div',
                  {},
                  radio('how', 'day', 'By day', rec.how, v => set('how', v, true)),
                  radio('how', 'night', 'At night (the night that begins on the evening of that date)', rec.how, v => set('how', v, true)),
                  radio('how', 'time', 'At a certain time', rec.how, v => set('how', v, true)),
                  rec.how === 'time' ? h('input', { type: 'time', required: true, value: rec.time, 'aria-label': 'Time', oninput: e => set('time', e.target.value) }) : null,
                )
              : null,
          )
        : null,
      rec.kind === 'flow'
        ? h('label', { class: 'choice' }, h('input', { type: 'checkbox', checked: rec.veset, onchange: e => set('veset', e.target.checked) }), h('span', {}, t('This {flow} counts for the {vesatot}')))
        : null,
      h('div', { class: 'field' }, h('label', { for: 'rec-note' }, 'Note (optional)'), h('input', { id: 'rec-note', type: 'text', class: 'wide', maxlength: 200, value: rec.note, oninput: e => set('note', e.target.value) })),
      h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit' }, 'Record'), h('button', { type: 'button', onclick: () => ((rec = newRec()), render()) }, 'Cancel')),
    );
  }

  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Record'),
    h(
      'div',
      { class: 'actions' },
      kinds.map(kind =>
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(rec.kind === kind),
            onclick: () => {
              rec = { ...newRec(), kind };
              render();
            },
          },
          S.labels.kinds[kind],
        ),
      ),
    ),
    form,
  );
}

function upcomingCard() {
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Coming up'),
    S.upcoming.length === 0
      ? h('p', { class: 'muted' }, 'Nothing coming up.')
      : h(
          'ul',
          { class: 'list' },
          S.upcoming.map(e =>
            h(
              'li',
              { class: e.projected ? 'projected' : '' },
              h('span', { class: 'dot ' + e.kind + (e.light ? ' light' : ''), 'aria-hidden': 'true' }),
              h(
                'div',
                { class: 'main' },
                h('div', { class: 'title' }, e.title),
                h('div', { class: 'when' }, e.when),
                e.description ? h('details', {}, h('summary', {}, 'Details'), h('pre', {}, e.description)) : null,
              ),
            ),
          ),
        ),
  );
}

// ---------- log ----------

function viewLog() {
  const sourceLabel = s => (s === 'dashboard' ? 'Recorded on the website' : s === 'sms' ? 'Recorded by text message' : s);
  return h(
    'div',
    {},
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Entries'),
      S.entryCount > S.entries.length ? h('p', { class: 'muted small' }, 'Showing the latest ' + S.entries.length + ' of ' + S.entryCount + '.') : null,
      S.entries.length === 0
        ? h('p', { class: 'muted' }, 'Nothing recorded yet.')
        : h(
            'ul',
            { class: 'list' },
            S.entries.map(e =>
              h(
                'li',
                {},
                h('span', { class: 'dot ' + (e.kind === 'stain' || e.kind === 'broken' ? 'flow' : e.kind), 'aria-hidden': 'true' }),
                h('div', { class: 'main' }, h('div', { class: 'title' }, e.text), h('div', { class: 'when' }, sourceLabel(e.source) + ' · ' + when(e.createdAt)), e.note ? h('div', { class: 'small' }, e.note) : null),
                h(
                  'button',
                  {
                    class: 'danger',
                    type: 'button',
                    onclick: () => {
                      if (!confirm('Remove this entry?\n' + e.text)) return;
                      run(() => api('DELETE', '/api/entries/' + encodeURIComponent(e.id)), saved('Removed.'));
                    },
                  },
                  'Remove',
                ),
              ),
            ),
          ),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Text messages'),
      S.messages.length === 0
        ? h('p', { class: 'muted' }, 'None yet.')
        : h(
            'ul',
            { class: 'list' },
            S.messages.map(m =>
              h(
                'li',
                {},
                h(
                  'div',
                  { class: 'main' },
                  h('div', {}, (m.direction === 'in' ? 'From' : 'To') + ' the phone ending ' + m.phone + ': ', h('span', { class: 'mono' }, m.body)),
                  h('div', { class: 'when' }, when(m.at) + ' · ' + m.status),
                ),
              ),
            ),
          ),
    ),
  );
}

// ---------- customs (halachic settings) ----------

function viewCustoms() {
  const d = draft.halachic;
  const sameRule = (a, b) => a.kind === b.kind && a.value === b.value;
  const presetIndex = S.halachic.tzeitPresets.findIndex(p => sameRule(p.rule, d.tzeit));
  const custom = presetIndex < 0;

  const groups = S.halachic.choices.map(c =>
    h(
      'fieldset',
      {},
      h('legend', {}, c.title),
      c.help ? h('div', { class: 'help' }, c.help) : null,
      c.options.map(o =>
        h(
          'label',
          { class: 'choice' },
          h('input', {
            type: 'radio',
            name: 'h-' + c.key,
            checked: d[c.key] === o.value,
            onchange: () => {
              d[c.key] = o.value;
            },
          }),
          h('span', {}, o.label),
        ),
      ),
    ),
  );

  const tzeit = h(
    'fieldset',
    {},
    h('legend', {}, S.halachic.tzeitTitle),
    S.halachic.tzeitPresets.map((p, i) =>
      h(
        'label',
        { class: 'choice' },
        h('input', {
          type: 'radio',
          name: 'h-tzeit',
          checked: presetIndex === i,
          onchange: () => {
            d.tzeit = clone(p.rule);
            render();
          },
        }),
        h('span', {}, p.label),
      ),
    ),
    h(
      'label',
      { class: 'choice' },
      h('input', {
        type: 'radio',
        name: 'h-tzeit',
        checked: custom,
        onchange: () => {
          d.tzeit = { kind: 'minutes', value: 60 };
          render();
        },
      }),
      h('span', {}, 'Other'),
    ),
    custom
      ? h(
          'div',
          { class: 'row' },
          h('input', {
            type: 'number',
            step: 'any',
            'aria-label': 'Value',
            value: d.tzeit.value,
            oninput: e => {
              d.tzeit.value = Number(e.target.value);
            },
          }),
          h(
            'select',
            {
              'aria-label': 'Unit',
              onchange: e => {
                d.tzeit.kind = e.target.value;
              },
            },
            h('option', { value: 'minutes', selected: d.tzeit.kind === 'minutes' }, t('minutes after {sunset}')),
            h('option', { value: 'degrees', selected: d.tzeit.kind === 'degrees' }, 'degrees below the horizon'),
          ),
        )
      : null,
  );

  const confirmed = S.halachic.confirmedAt
    ? 'Last saved: ' + when(S.halachic.confirmedAt)
    : 'These settings have not been saved yet. Until they are, the stricter option of each is used.';

  return h(
    'div',
    {},
    h('section', { class: 'card' }, termsToggle()),
    h(
      'form',
      {
        class: 'card',
        onsubmit: e => {
          e.preventDefault();
          run(() => api('PUT', '/api/halachic', draft.halachic), saved('Your customs are saved.'));
        },
      },
      h('h2', {}, 'Customs'),
      h('p', { class: 'muted small' }, t('Wherever customs differ, choose here as your {rav} instructs. This calendar does not rule: for a {stain}, for a {bedikah}, and for every doubt, ask your {rav}.')),
      h('p', { class: S.halachic.confirmedAt ? 'small muted' : 'alert' }, confirmed),
      groups,
      tzeit,
      h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit' }, 'Save and confirm')),
    ),
  );
}

// ---------- settings ----------

function saveApp(message) {
  run(() => api('PUT', '/api/app', draft.app), saved(message || 'Saved.'));
}

function viewSettings() {
  return h('div', {}, alertsBlock(), setupCard(), h('section', { class: 'card' }, h('h2', {}, 'Language'), termsToggle(), h('p', { class: 'help' }, 'The site is in English. This chooses how halachic terms are written, here and in your calendar.')), locationCard(), calendarCard(), phonesCard(), remindersCard(), signInCard(), dataCard());
}

function numberField(label, value, onchange, attrs) {
  return h('label', { class: 'row' }, h('span', {}, label), h('input', { type: 'number', value, oninput: e => onchange(Number(e.target.value)), ...(attrs || {}) }));
}

function locationCard() {
  const a = draft.app;
  const place = a.place;
  const listed = place ? S.places.findIndex(p => p.name === place.name && p.latitude === place.latitude && p.longitude === place.longitude) : -1;
  const custom = place !== null && listed < 0;
  const setPlace = p => {
    a.place = p ? clone(p) : null;
    render();
  };
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Location'),
    h('p', { class: 'help' }, 'Sunrise, sunset and nightfall are calculated for this place. Change it when you travel.'),
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'place' }, 'Place'),
      h(
        'select',
        {
          id: 'place',
          onchange: e => {
            const v = e.target.value;
            if (v === '') setPlace(null);
            else if (v === 'custom') setPlace({ name: 'My location', latitude: 0, longitude: 0, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, elevation: 0 });
            else setPlace(S.places[Number(v)]);
          },
        },
        h('option', { value: '', selected: place === null }, 'Choose…'),
        S.places.map((p, i) => h('option', { value: String(i), selected: listed === i }, p.name)),
        h('option', { value: 'custom', selected: custom }, 'Other (enter coordinates)'),
      ),
    ),
    custom
      ? h(
          'div',
          {},
          h('div', { class: 'field' }, h('label', { for: 'place-name' }, 'Name'), h('input', { id: 'place-name', type: 'text', value: place.name, maxlength: 80, oninput: e => (place.name = e.target.value) })),
          h(
            'div',
            { class: 'row' },
            numberField('Latitude', place.latitude, v => (place.latitude = v), { step: 'any' }),
            numberField('Longitude', place.longitude, v => (place.longitude = v), { step: 'any' }),
            numberField('Elevation (m)', place.elevation, v => (place.elevation = v), { step: '1' }),
          ),
          h('div', { class: 'field' }, h('label', { for: 'place-tz' }, 'Time zone'), h('input', { id: 'place-tz', type: 'text', value: place.timeZone, placeholder: 'America/New_York', oninput: e => (place.timeZone = e.target.value) })),
          h(
            'button',
            {
              type: 'button',
              onclick: () => {
                if (!navigator.geolocation) return toast('This browser cannot give its location.', true);
                navigator.geolocation.getCurrentPosition(
                  pos => {
                    place.latitude = Math.round(pos.coords.latitude * 10000) / 10000;
                    place.longitude = Math.round(pos.coords.longitude * 10000) / 10000;
                    if (typeof pos.coords.altitude === 'number') place.elevation = Math.max(0, Math.round(pos.coords.altitude));
                    place.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                    render();
                  },
                  () => toast('The location could not be read.', true),
                );
              },
            },
            'Use this device’s location',
          ),
        )
      : null,
    h(
      'label',
      { class: 'choice' },
      h('input', { type: 'checkbox', checked: a.useElevation, onchange: e => (a.useElevation = e.target.checked) }),
      h('span', {}, 'Adjust sunrise and sunset for elevation (off: sea-level times)'),
    ),
    h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', onclick: () => saveApp('Location saved.') }, 'Save location')),
  );
}

function calendarCard() {
  const a = draft.app;
  const cal = S.calendar;
  const sync = cal.sync;
  const google = cal.google;

  const googlePart = !google.available
    ? h('p', { class: 'muted' }, 'Connecting a Google account is not available on this site yet. The subscription link below works with Google Calendar too.')
    : h(
        'div',
        {},
        google.connected
          ? h('div', { class: 'alert ok' }, 'Connected. The calendar is named “' + S.app.calendar.name + '” in your Google Calendar. To share it with your spouse, share it from there.')
          : h('p', { class: 'muted' }, 'The site creates one calendar in your Google account and keeps it up to date. It can see and change only that one calendar, nothing else in your account.'),
        sync.lastOkAt ? h('p', { class: 'small muted' }, 'Last brought up to date: ' + when(sync.lastOkAt) + (sync.dirty ? ' (changes waiting)' : '')) : null,
        h(
          'div',
          { class: 'actions' },
          h('a', { class: 'button' + (google.connected ? '' : ' primary'), href: '/api/google/start' }, google.connected ? 'Connect again' : 'Connect Google Calendar'),
          google.connected
            ? h(
                'button',
                {
                  type: 'button',
                  onclick: () =>
                    run(
                      () => api('POST', '/api/sync'),
                      r => {
                        adopt(r.state);
                        render();
                        const o = r.outcome;
                        toast(
                          o.status === 'ok'
                            ? 'Calendar updated: ' + o.result.inserted + ' added, ' + o.result.updated + ' changed, ' + o.result.deleted + ' removed' + (o.result.remaining ? ', ' + o.result.remaining + ' still to do' : '') + '.'
                            : o.message || 'The calendar could not be updated.',
                          o.status !== 'ok',
                        );
                      },
                    ),
                },
                'Update now',
              )
            : null,
          google.connected
            ? h(
                'button',
                {
                  class: 'danger',
                  type: 'button',
                  onclick: () => {
                    if (!confirm('Disconnect Google Calendar? The calendar itself stays in your Google account.')) return;
                    run(() => api('POST', '/api/google/disconnect'), saved('Disconnected.'));
                  },
                },
                'Disconnect',
              )
            : null,
        ),
      );

  const linkPart = cal.link
    ? h(
        'div',
        {},
        h('code', { class: 'copy' }, cal.link),
        h('p', { class: 'help' }, 'Add this address in your calendar app as a subscribed calendar (in Google Calendar: Other calendars, +, From URL). Anyone who has it can read the calendar, so share it only with your spouse. Calendar apps look for changes on their own schedule; Google says it can take up to 12 hours.'),
        h(
          'div',
          { class: 'actions' },
          h(
            'button',
            {
              type: 'button',
              onclick: () => navigator.clipboard.writeText(cal.link).then(() => toast('Copied.'), () => toast('Could not copy. Select the address and copy it.', true)),
            },
            'Copy',
          ),
          h('a', { class: 'button', href: cal.link.replace(/^https?:/, 'webcal:') }, 'Open in my calendar app'),
          h(
            'button',
            {
              type: 'button',
              onclick: () => {
                if (!confirm('Replace the link? The old address stops working at once, and calendars subscribed to it stop updating.')) return;
                run(() => api('POST', '/api/calendar-link'), saved('A new link was made.'));
              },
            },
            'Replace link',
          ),
          h(
            'button',
            {
              class: 'danger',
              type: 'button',
              onclick: () => {
                if (!confirm('Remove the link? Calendars subscribed to it stop updating.')) return;
                run(() => api('DELETE', '/api/calendar-link'), saved('The link was removed.'));
              },
            },
            'Remove link',
          ),
        ),
      )
    : h(
        'div',
        {},
        h('p', { class: 'muted' }, 'A private address that Apple Calendar, Outlook or Google Calendar can subscribe to. No account needs to be connected.'),
        h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => run(() => api('POST', '/api/calendar-link'), saved('The link is ready.')) }, 'Create a subscription link')),
      );

  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Calendar'),
    h('p', { class: 'help' }, 'Optional. Two ways to see the dates in your own calendar.'),
    h('h3', {}, 'Google Calendar'),
    googlePart,
    h('h3', {}, 'Subscription link'),
    linkPart,
    h('h3', {}, 'Appearance'),
    h('div', { class: 'field' }, h('label', { for: 'cal-name' }, 'Name of the calendar'), h('input', { id: 'cal-name', type: 'text', maxlength: 40, value: a.calendar.name, oninput: e => (a.calendar.name = e.target.value) }), h('div', { class: 'help' }, 'Used when the calendar is first created. Afterwards, rename it in your calendar app.')),
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'style' }, 'Event titles'),
      h(
        'select',
        { id: 'style', onchange: e => (a.calendar.style = e.target.value) },
        h('option', { value: 'words', selected: a.calendar.style === 'words' }, 'Words, with details'),
        h('option', { value: 'discreet', selected: a.calendar.style === 'discreet' }, 'Discreet: symbols only, no details'),
      ),
      h('div', { class: 'help' }, 'Discreet titles: • start, H ' + t('{hefsek}') + ', 1/7 to 7/7 ' + t('{clean_days}') + ', M ' + t('{mikvah_night}') + ', ◆ ' + t('{veset_onah}') + ', ◇ ' + t('{or_zarua}') + '. “?” marks a projected date.'),
    ),
    h('div', { class: 'field' }, numberField('Days of history kept up to date in the calendar', a.calendar.historyDays, v => (a.calendar.historyDays = v), { min: 30, max: 800, step: 1 })),
    h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => saveApp('Saved.') }, 'Save appearance')),
  );
}

function phonesCard() {
  const sms = S.sms;
  const phoneRow = p => {
    const current = S.phones.find(x => x.number === p.number) || p;
    return h(
      'div',
      { class: 'phone' },
      h(
        'div',
        { class: 'number' },
        pretty(p.number),
        current.me ? h('span', { class: 'tag' }, 'this phone') : null,
        !current.verified ? h('span', { class: 'tag' }, 'not verified') : null,
        current.optedOut ? h('span', { class: 'tag' }, 'replied STOP') : null,
      ),
      current.optedOut ? h('p', { class: 'help' }, 'This phone replied STOP, so nothing is sent to it. Text START from it to receive texts again.') : null,
      h('div', { class: 'field' }, h('label', { for: 'name-' + p.number }, 'Name (optional)'), h('input', { id: 'name-' + p.number, type: 'text', value: p.name, maxlength: 40, oninput: e => (p.name = e.target.value) })),
      h('label', { class: 'choice' }, h('input', { type: 'checkbox', checked: p.canUpdate, onchange: e => (p.canUpdate = e.target.checked) }), h('span', {}, 'May record by text message')),
      h(
        'label',
        { class: 'choice' },
        h('input', {
          type: 'checkbox',
          checked: p.texts,
          disabled: !current.verified,
          onchange: e => {
            p.texts = e.target.checked;
            render();
          },
        }),
        h('span', {}, 'Send text reminders to this phone'),
      ),
      p.texts && !current.texts
        ? h('p', { class: 'help' }, 'By saving, the owner of this phone agrees to receive the reminders chosen below by text message from Betaharah. Message frequency varies. Message and data rates may apply. Reply STOP to stop, HELP for help.')
        : null,
      p.texts
        ? h(
            'div',
            {},
            h('div', { class: 'small muted' }, 'Reminders this phone receives'),
            h(
              'div',
              { class: 'checks' },
              S.reminderKinds.map(k =>
                h(
                  'label',
                  { class: 'choice' },
                  h('input', {
                    type: 'checkbox',
                    checked: p.reminders.includes(k),
                    onchange: e => {
                      p.reminders = e.target.checked ? [...new Set([...p.reminders, k])] : p.reminders.filter(x => x !== k);
                    },
                  }),
                  h('span', {}, S.labels.reminders[k] || k),
                ),
              ),
            ),
          )
        : null,
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            class: 'primary',
            type: 'button',
            onclick: () => run(() => api('PUT', '/api/phones', { number: p.number, name: p.name, canUpdate: p.canUpdate, reminders: p.reminders, texts: p.texts }), saved('Saved.')),
          },
          'Save',
        ),
        sms.ready && current.verified && !current.optedOut
          ? h('button', { type: 'button', onclick: () => run(() => api('POST', '/api/phones/test', { number: p.number }), saved('A test text was sent.')) }, 'Send a test text')
          : null,
        sms.ready && !current.verified
          ? h(
              'button',
              {
                type: 'button',
                onclick: () =>
                  run(
                    () => api('POST', '/api/phones/code', { number: p.number }),
                    r => {
                      adding = { step: 'code', number: r.number, code: '' };
                      render();
                      toast('A code was texted to ' + pretty(r.number) + '.');
                    },
                  ),
              },
              'Verify this number',
            )
          : null,
        S.phones.length > 1
          ? h(
              'button',
              {
                class: 'danger',
                type: 'button',
                onclick: () => {
                  if (!confirm('Remove ' + pretty(p.number) + ' from this account?' + (current.me ? '\nThis is the phone you are signed in with; you will be signed out.' : ''))) return;
                  run(
                    () => api('POST', '/api/phones/remove', { number: p.number }),
                    r => {
                      if (r.signedOut) {
                        S = null;
                        start().catch(showFatal);
                        return;
                      }
                      saved('Removed.')(r);
                    },
                  );
                },
              },
              'Remove',
            )
          : null,
      ),
    );
  };

  let addPart;
  if (!sms.ready) {
    addPart = h('p', { class: 'muted' }, 'A second phone can be added once text messaging is available on this site.');
  } else if (adding.step === 'code') {
    addPart = h(
      'form',
      {
        onsubmit: e => {
          e.preventDefault();
          run(
            () => api('POST', '/api/phones/verify', { number: adding.number, code: adding.code }),
            r => {
              adding = { step: 'idle', number: '', code: '' };
              saved('The phone is on your account.')(r);
            },
          );
        },
      },
      h('p', {}, 'A 6-digit code was texted to ' + pretty(adding.number) + '. Enter it here.'),
      h('input', { type: 'text', class: 'code', 'aria-label': 'Code', autocomplete: 'one-time-code', inputmode: 'numeric', maxlength: 6, required: true, value: adding.code, oninput: e => (adding.code = e.target.value.replace(/\D/g, '')) }),
      h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit' }, 'Confirm'), h('button', { type: 'button', onclick: () => ((adding = { step: 'idle', number: '', code: '' }), render()) }, 'Cancel')),
    );
  } else if (S.phones.length >= S.maxPhones) {
    addPart = h('p', { class: 'muted' }, 'This account has the most phones it can have (' + S.maxPhones + ').');
  } else {
    addPart = h(
      'form',
      {
        onsubmit: e => {
          e.preventDefault();
          run(
            () => api('POST', '/api/phones/code', { number: adding.number }),
            r => {
              adding = { step: 'code', number: r.number, code: '' };
              render();
            },
          );
        },
      },
      h('p', { class: 'help' }, 'For husband and wife to share this account. A code is texted to the phone; once it is entered here, that phone can sign in, record by text, and receive its own reminders. Add only a phone whose owner has agreed.'),
      h(
        'div',
        { class: 'row' },
        h('input', { type: 'tel', 'aria-label': 'Mobile number to add', autocomplete: 'off', inputmode: 'tel', required: true, placeholder: '(732) 555-0123', value: adding.number, oninput: e => (adding.number = e.target.value) }),
        h('button', { type: 'submit' }, 'Text a code to it'),
      ),
    );
  }

  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Phones and text messages'),
    sms.ready
      ? h('div', { class: 'alert ok' }, 'To record by text, send a text to ' + pretty(sms.number) + '. ' + sms.commands)
      : h('div', { class: 'alert info' }, 'Text messaging is not available on this site yet. Everything can be recorded here on the website.'),
    sms.ready ? h('p', { class: 'small muted' }, 'Texts sent to this account this month: ' + sms.usedThisMonth + ' of at most ' + sms.monthlyLimit + '.') : null,
    h('div', {}, draft.phones.map(phoneRow)),
    h('h3', {}, 'Add a phone'),
    addPart,
  );
}

function remindersCard() {
  const r = draft.app.reminders;
  const a = draft.app;
  const toggle = (obj, label) => h('label', { class: 'choice' }, h('input', { type: 'checkbox', checked: obj.on, onchange: e => (obj.on = e.target.checked) }), h('span', {}, label));
  const timeValue = (hh, mm) => String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  const timeInput = (label, hh, mm, onchange) =>
    h(
      'label',
      { class: 'row' },
      h('span', {}, label),
      h('input', {
        type: 'time',
        value: timeValue(hh, mm),
        oninput: e => {
          const [x, y] = e.target.value.split(':').map(Number);
          if (Number.isFinite(x) && Number.isFinite(y)) onchange(x, y);
        },
      }),
    );
  const sunset = t('{sunset}');
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Reminders'),
    h('p', { class: 'help' }, 'These choose which reminders exist and when. Each phone chooses which of them it receives, above. Nothing is sent to a phone until reminders are turned on for it.'),
    h(
      'fieldset',
      {},
      toggle(r.hefsek, cap(t('{hefsek}, on each day it can be done'))),
      numberField('Minutes before ' + sunset, r.hefsek.minutesBeforeSunset, v => (r.hefsek.minutesBeforeSunset = v), { min: 20, max: 600 }),
      numberField('Stop after this many days', r.hefsekMaxDays, v => (r.hefsekMaxDays = v), { min: 1, max: 30 }),
    ),
    h(
      'fieldset',
      {},
      toggle(r.bedikot, cap(t('{bedikot}, on each of the {clean_days}'))),
      timeInput('Morning reminder at', r.bedikot.morningHour, r.bedikot.morningMinute, (x, y) => {
        r.bedikot.morningHour = x;
        r.bedikot.morningMinute = y;
      }),
      numberField('Afternoon reminder, minutes before ' + sunset, r.bedikot.minutesBeforeSunset, v => (r.bedikot.minutesBeforeSunset = v), { min: 20, max: 600 }),
    ),
    h('fieldset', {}, toggle(r.mikvah, cap(t('{mikvah_night}'))), numberField('Minutes before ' + sunset, r.mikvah.minutesBeforeSunset, v => (r.mikvah.minutesBeforeSunset = v), { min: 20, max: 600 })),
    h(
      'fieldset',
      {},
      toggle(r.mikvahConfirm, t('Ask the next morning if no {immersion} was recorded')),
      timeInput('At', r.mikvahConfirm.hour, r.mikvahConfirm.minute, (x, y) => {
        r.mikvahConfirm.hour = x;
        r.mikvahConfirm.minute = y;
      }),
    ),
    h('fieldset', {}, toggle(r.onah, cap(t('each {onat_perishah}'))), numberField(t('Minutes before the {onah} begins'), r.onah.minutesBefore, v => (r.onah.minutesBefore = v), { min: 0, max: 1440 })),
    h(
      'fieldset',
      {},
      h(
        'label',
        { class: 'choice' },
        h('input', { type: 'checkbox', checked: r.beforeRestDays, onchange: e => (r.beforeRestDays = e.target.checked) }),
        h('span', {}, t('Send nothing on {shabbat} and {yom_tov}; send beforehand what falls on them')),
      ),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'sms-style' }, 'Wording of the texts'),
        h(
          'select',
          { id: 'sms-style', onchange: e => (r.style = e.target.value) },
          h('option', { value: 'plain', selected: r.style === 'plain' }, 'Plain words'),
          h('option', { value: 'discreet', selected: r.style === 'discreet' }, 'Discreet: letters and times only'),
        ),
        h('div', { class: 'help' }, 'Texts are always in English letters, so that every phone can show them.'),
      ),
      numberField('When a text arrives within this many minutes after sunrise or sunset, the reply asks which side it was', a.boundaryMarginMinutes, v => (a.boundaryMarginMinutes = v), { min: 0, max: 120 }),
    ),
    h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', onclick: () => saveApp('Reminders saved.') }, 'Save reminders')),
    h('h3', {}, 'Coming reminders'),
    S.reminders.length === 0
      ? h('p', { class: 'muted' }, 'None scheduled.')
      : h(
          'ul',
          { class: 'list' },
          S.reminders.map(x => h('li', {}, h('div', { class: 'main' }, h('div', { class: 'when' }, x.when + ' · ' + (S.labels.reminders[x.kind] || x.kind)), h('div', { class: 'mono' }, x.text)))),
        ),
  );
}

function signOut() {
  run(
    () => api('POST', '/api/auth/logout'),
    () => {
      S = null;
      start().catch(showFatal);
    },
  );
}

function signInCard() {
  const acc = S.account;
  let passwordPart;
  if (!acc.fresh) {
    passwordPart = h(
      'p',
      { class: 'muted' },
      (acc.hasPassword ? 'A password is set. To change or remove it' : 'No password is set; you sign in with a texted code. To set a password') + ', sign out and sign in again, then come back here within 15 minutes. Signing in again confirms it is you.',
    );
  } else {
    passwordPart = h(
      'form',
      {
        onsubmit: e => {
          e.preventDefault();
          if (pw.a !== pw.b) return toast('The two passwords are not the same.', true);
          run(
            async () => {
              await api('PUT', '/api/password', { password: pw.a });
              return api('GET', '/api/state');
            },
            r => {
              pw = { a: '', b: '' };
              saved('The password is set. Other devices signed in with this phone were signed out.')(r);
            },
          );
        },
      },
      h('p', { class: 'help' }, acc.hasPassword ? 'A password is set. You can change it here.' : 'Optional. With a password you can sign in without waiting for a text.'),
      h('div', { class: 'field' }, h('label', { for: 'npw1' }, 'New password'), h('input', { id: 'npw1', type: 'password', autocomplete: 'new-password', minlength: 10, required: true, value: pw.a, oninput: e => (pw.a = e.target.value) }), h('div', { class: 'help' }, 'At least 10 characters.')),
      h('div', { class: 'field' }, h('label', { for: 'npw2' }, 'The same password again'), h('input', { id: 'npw2', type: 'password', autocomplete: 'new-password', minlength: 10, required: true, value: pw.b, oninput: e => (pw.b = e.target.value) })),
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'submit' }, acc.hasPassword ? 'Change password' : 'Set password'),
        acc.hasPassword && S.sms.ready
          ? h(
              'button',
              {
                class: 'danger',
                type: 'button',
                onclick: () => {
                  if (!confirm('Remove the password? You will sign in with a texted code only.')) return;
                  run(async () => {
                    await api('DELETE', '/api/password');
                    return api('GET', '/api/state');
                  }, saved('The password was removed.'));
                },
              },
              'Remove password',
            )
          : null,
      ),
    );
  }
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Signing in'),
    h('p', {}, 'Signed in with ' + pretty(acc.number) + '.'),
    h('h3', {}, 'Password'),
    passwordPart,
    h('h3', {}, 'Sessions'),
    h(
      'div',
      { class: 'actions' },
      h('button', { type: 'button', onclick: signOut }, 'Sign out'),
      h(
        'button',
        {
          type: 'button',
          onclick: () => {
            if (!confirm('Sign out this phone number everywhere, on every device?')) return;
            run(
              () => api('POST', '/api/auth/logout-all'),
              () => {
                S = null;
                start().catch(showFatal);
              },
            );
          },
        },
        'Sign out everywhere',
      ),
    ),
  );
}

function dataCard() {
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Your data'),
    h('p', { class: 'help' }, 'Everything kept about this account is encrypted before it is stored. You can take a copy, and you can delete it all. See the ', h('a', { href: '/privacy' }, 'Privacy page'), '.'),
    h(
      'div',
      { class: 'actions' },
      h('a', { class: 'button', href: '/api/export', download: 'betaharah-export.json' }, 'Download my data'),
      h(
        'button',
        {
          class: 'danger',
          type: 'button',
          onclick: () => {
            const typed = prompt('This deletes the account for every phone on it: all entries, settings and messages. It cannot be undone.\n\nType DELETE to confirm.');
            if (typed === null) return;
            if (typed.trim() !== 'DELETE') return toast('Nothing was deleted.', true);
            run(
              () => api('POST', '/api/account/delete', { confirm: 'DELETE' }),
              () => {
                S = null;
                location.href = '/';
              },
            );
          },
        },
        'Delete my account',
      ),
    ),
    h('p', { class: 'small muted' }, h('a', { href: '/help' }, 'Help'), ' · ', h('a', { href: '/privacy' }, 'Privacy'), ' · ', h('a', { href: '/terms' }, 'Terms')),
  );
}

window.addEventListener('hashchange', () => {
  const next = location.hash.slice(1);
  if (S && TABS.includes(next) && next !== tab) {
    tab = next;
    render();
  }
});

start().catch(showFatal);
