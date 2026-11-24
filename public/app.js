'use strict';
/*
 * The dashboard. One page, no build step, no outside scripts.
 * Everything shown comes from /api/state; every change goes through the API
 * and the page is redrawn from the answer. Text from the server is always
 * inserted as text, never as HTML.
 */

const root = document.getElementById('root');

/** State from the server. */
let S = null;
/** Unsaved edits to the settings forms. */
let draft = { halachic: null, app: null, secrets: {} };
/** The "record an event" form. */
let rec = newRec();
let tab = ['today', 'log', 'halacha', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
let toastTimer = null;

const KINDS = [
  { kind: 'flow', label: 'ראייה' },
  { kind: 'stain', label: 'כתם' },
  { kind: 'hefsek', label: 'הפסק טהרה' },
  { kind: 'broken', label: 'נפסלה הספירה' },
  { kind: 'mikvah', label: 'טבילה' },
];

const REMINDER_LABELS = {
  hefsek: 'Hefsek taharah',
  bedikah_morning: 'Bedikah, morning',
  bedikah_afternoon: 'Bedikah, afternoon',
  mikvah: 'Mikvah night',
  mikvah_confirm: 'Immersion not recorded',
  onah: 'Onah',
};

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

async function api(method, path, body) {
  const headers = { 'x-mikvah': '1' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    json = null;
  }
  if (res.status === 401 && path !== '/api/login') {
    S = null;
    renderLogin('');
    throw new Error('Please sign in again.');
  }
  if (!res.ok) throw new Error((json && json.error) || 'The request failed (' + res.status + ').');
  return json;
}

function toast(message, bad) {
  document.querySelectorAll('.toast').forEach(el => el.remove());
  const el = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status', dir: 'auto' }, message);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), bad ? 9000 : 5000);
}

/** Runs an action; shows its error; redraws. */
async function run(action, done) {
  try {
    const result = await action();
    if (done) done(result);
  } catch (e) {
    toast(e.message || 'Something went wrong.', true);
  }
}

function adopt(state) {
  S = state;
  draft.halachic = clone(S.halachic.settings);
  draft.app = clone(S.app);
  draft.secrets = {};
}

function todayIso() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: S.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

// ---------- sign-in ----------

function renderLogin(message) {
  let password = '';
  const form = h(
    'form',
    {
      class: 'card login',
      dir: 'ltr',
      onsubmit: async e => {
        e.preventDefault();
        try {
          await api('POST', '/api/login', { password });
          await load();
        } catch (err) {
          renderLogin(err.message);
        }
      },
    },
    h('h2', {}, 'Sign in'),
    message ? h('div', { class: 'alert bad' }, message) : null,
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'pw' }, 'Password'),
      h('input', { id: 'pw', type: 'password', autocomplete: 'current-password', required: true, oninput: e => (password = e.target.value) }),
    ),
    h('button', { class: 'primary', type: 'submit' }, 'Sign in'),
  );
  root.replaceChildren(form);
  form.querySelector('input').focus();
}

async function load() {
  const session = await api('GET', '/api/session');
  if (!session.configured) {
    root.replaceChildren(
      h(
        'div',
        { class: 'card login', dir: 'ltr' },
        h('h2', {}, 'Not set up yet'),
        h('p', {}, 'The server needs two secrets before it can be used: DASHBOARD_PASSWORD (10 or more characters) and ENCRYPTION_KEY (32 or more random characters). See the README.'),
      ),
    );
    return;
  }
  if (!session.authenticated) {
    renderLogin('');
    return;
  }
  adopt(await api('GET', '/api/state'));
  const params = new URLSearchParams(location.search);
  if (params.get('google_error')) toast(params.get('google_error'), true);
  if (params.get('google') === 'connected') toast('Google Calendar is connected.');
  if (params.has('google') || params.has('google_error')) history.replaceState(null, '', location.pathname + location.hash);
  render();
}

// ---------- page ----------

function render() {
  if (!S) return;
  const tabs = [
    ['today', 'היום'],
    ['log', 'רשומות'],
    ['halacha', 'הגדרות הלכה'],
    ['settings', 'Settings'],
  ];
  root.replaceChildren(
    h(
      'header',
      { class: 'top' },
      h('h1', {}, 'בטהרה'),
      S.today ? h('div', { class: 'today' }, S.today.hebrew + ' · ' + (S.today.onah === 'לילה' ? 'לילה' : 'יום') + ' · ' + S.today.civil) : null,
    ),
    h(
      'nav',
      { class: 'tabs', role: 'tablist' },
      tabs.map(([id, label]) =>
        h(
          'button',
          {
            role: 'tab',
            'aria-selected': String(tab === id),
            onclick: () => {
              tab = id;
              history.replaceState(null, '', '#' + id);
              render();
            },
          },
          label,
        ),
      ),
    ),
    tab === 'today' ? viewToday() : tab === 'log' ? viewLog() : tab === 'halacha' ? viewHalacha() : viewSettings(),
  );
}

function alertsBlock() {
  return S.alerts.map(a => h('div', { class: 'alert' + (a.level === 'info' ? ' info' : ''), dir: a.dir }, a.text));
}

// ---------- today ----------

function viewToday() {
  return h(
    'div',
    {},
    alertsBlock(),
    S.status
      ? h('section', { class: 'card status' }, h('p', { class: 'headline' }, S.status.headline), S.status.detail ? h('p', { class: 'detail' }, S.status.detail) : null)
      : null,
    S.status ? recordCard() : null,
    S.status ? upcomingCard() : null,
  );
}

function recordCard() {
  const needsOnah = rec.kind === 'flow' || rec.kind === 'stain' || rec.kind === 'broken';
  const set = (key, value, redraw) => {
    rec[key] = value;
    if (redraw) render();
  };
  const radio = (name, value, label, current, onpick) =>
    h('label', { class: 'choice' }, h('input', { type: 'radio', name, checked: current === value, onchange: () => onpick(value) }), h('span', {}, label));

  let form = null;
  if (rec.kind) {
    const dateLabel = rec.kind === 'mikvah' ? 'הערב שבו טבלה' : 'תאריך';
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
              toast('נרשם');
            },
          );
        },
      },
      h('hr'),
      h(
        'div',
        { class: 'field' },
        h('div', { class: 'label' }, 'מתי?'),
        radio('mode', 'now', 'עכשיו', rec.mode, v => set('mode', v, true)),
        radio('mode', 'other', 'במועד אחר', rec.mode, v => {
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
                  radio('how', 'day', 'ביום', rec.how, v => set('how', v, true)),
                  radio('how', 'night', 'בלילה (הלילה שמתחיל בערב אותו תאריך)', rec.how, v => set('how', v, true)),
                  radio('how', 'time', 'בשעה מסוימת', rec.how, v => set('how', v, true)),
                  rec.how === 'time' ? h('input', { type: 'time', required: true, value: rec.time, 'aria-label': 'שעה', oninput: e => set('time', e.target.value) }) : null,
                )
              : null,
          )
        : null,
      rec.kind === 'flow'
        ? h('label', { class: 'choice' }, h('input', { type: 'checkbox', checked: rec.veset, onchange: e => set('veset', e.target.checked) }), h('span', {}, 'ראייה זו נחשבת לחשבון הוסתות'))
        : null,
      h('div', { class: 'field' }, h('label', { for: 'rec-note' }, 'הערה (רשות)'), h('input', { id: 'rec-note', type: 'text', maxlength: 200, value: rec.note, oninput: e => set('note', e.target.value) })),
      h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit' }, 'רישום'), h('button', { type: 'button', onclick: () => ((rec = newRec()), render()) }, 'ביטול')),
    );
  }

  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'רישום'),
    h(
      'div',
      { class: 'actions' },
      KINDS.map(k =>
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(rec.kind === k.kind),
            onclick: () => {
              rec = { ...newRec(), kind: k.kind };
              render();
            },
          },
          k.label,
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
    h('h2', {}, 'הימים הקרובים'),
    S.upcoming.length === 0
      ? h('p', { class: 'muted' }, 'אין אירועים קרובים.')
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
                e.description ? h('details', {}, h('summary', {}, 'פרטים'), h('pre', {}, e.description)) : null,
              ),
            ),
          ),
        ),
  );
}

// ---------- log ----------

function viewLog() {
  const sourceLabel = s => (s === 'dashboard' ? 'נרשם בלוח' : s.startsWith('sms:') ? 'נרשם בהודעה מ־' + s.slice(4) : s);
  return h(
    'div',
    {},
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'רשומות'),
      S.entryCount > S.entries.length ? h('p', { class: 'muted small' }, 'מוצגות ' + S.entries.length + ' הרשומות האחרונות מתוך ' + S.entryCount + '.') : null,
      S.entries.length === 0
        ? h('p', { class: 'muted' }, 'עדיין לא נרשם דבר.')
        : h(
            'ul',
            { class: 'list' },
            S.entries.map(e =>
              h(
                'li',
                {},
                h('span', { class: 'dot ' + (e.kind === 'stain' || e.kind === 'broken' ? 'flow' : e.kind), 'aria-hidden': 'true' }),
                h(
                  'div',
                  { class: 'main' },
                  h('div', { class: 'title' }, e.text),
                  h('div', { class: 'when' }, sourceLabel(e.source) + ' · ' + new Date(e.createdAt).toLocaleString('he-IL', { timeZone: S.timeZone })),
                  e.note ? h('div', { class: 'small' }, e.note) : null,
                ),
                h(
                  'button',
                  {
                    class: 'danger',
                    type: 'button',
                    onclick: () => {
                      if (!confirm('למחוק את הרשומה?\n' + e.text)) return;
                      run(
                        () => api('DELETE', '/api/entries/' + encodeURIComponent(e.id)),
                        state => {
                          adopt(state);
                          render();
                          toast('נמחק');
                        },
                      );
                    },
                  },
                  'מחיקה',
                ),
              ),
            ),
          ),
    ),
    h(
      'section',
      { class: 'card', dir: 'ltr' },
      h('h2', {}, 'Text messages'),
      S.sms.length === 0
        ? h('p', { class: 'muted' }, 'None yet.')
        : h(
            'ul',
            { class: 'list' },
            S.sms.map(m =>
              h(
                'li',
                {},
                h(
                  'div',
                  { class: 'main' },
                  h('div', {}, (m.direction === 'in' ? 'From ' : 'To ') + m.peer + ': ', h('span', { class: 'mono' }, m.body)),
                  h('div', { class: 'when' }, new Date(m.at).toLocaleString('en-US', { timeZone: S.timeZone }) + ' · ' + m.status + (m.detail && m.status !== 'sent' ? ' · ' + m.detail : '')),
                ),
              ),
            ),
          ),
    ),
  );
}

// ---------- halachic settings ----------

function viewHalacha() {
  const d = draft.halachic;
  const sameRule = (a, b) => a.kind === b.kind && a.value === b.value;
  const presetIndex = S.halachic.tzeitPresets.findIndex(p => sameRule(p.rule, d.tzeit));
  const custom = presetIndex < 0;

  const groups = S.halachic.choices.map(c =>
    h(
      'fieldset',
      {},
      h('legend', {}, c.title),
      c.help ? h('div', { class: 'help muted small' }, c.help) : null,
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
    h('legend', {}, 'צאת הכוכבים (לזמן הטבילה)'),
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
      h('span', {}, 'אחר'),
    ),
    custom
      ? h(
          'div',
          { class: 'row' },
          h('input', {
            type: 'number',
            step: 'any',
            'aria-label': 'ערך',
            value: d.tzeit.value,
            oninput: e => {
              d.tzeit.value = Number(e.target.value);
            },
          }),
          h(
            'select',
            {
              'aria-label': 'יחידה',
              onchange: e => {
                d.tzeit.kind = e.target.value;
              },
            },
            h('option', { value: 'minutes', selected: d.tzeit.kind === 'minutes' }, 'דקות אחר השקיעה'),
            h('option', { value: 'degrees', selected: d.tzeit.kind === 'degrees' }, 'מעלות תחת האופק'),
          ),
        )
      : null,
  );

  const confirmed = S.halachic.confirmedAt
    ? 'נשמר לאחרונה: ' + new Date(S.halachic.confirmedAt).toLocaleDateString('he-IL', { timeZone: S.timeZone })
    : 'ההגדרות טרם אושרו. החישוב נעשה לפי ברירת המחדל, לחומרא.';

  return h(
    'form',
    {
      class: 'card',
      onsubmit: e => {
        e.preventDefault();
        run(
          () => api('PUT', '/api/halachic', draft.halachic),
          state => {
            adopt(state);
            render();
            toast('ההגדרות נשמרו');
          },
        );
      },
    },
    h('h2', {}, 'הגדרות הלכה'),
    h('p', { class: 'muted small' }, 'בכל מקום שיש בו מנהגים חלוקים יש לבחור כאן, על פי הוראת רב. הלוח אינו פוסק: בכתמים, במראות, בבדיקות ובכל ספק יש לשאול רב.'),
    h('p', { class: 'small' }, confirmed),
    groups,
    tzeit,
    h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit' }, 'שמירה ואישור')),
  );
}

// ---------- settings ----------

function saveApp(message) {
  run(
    () => api('PUT', '/api/app', draft.app),
    state => {
      adopt(state);
      render();
      toast(message || 'Saved.');
    },
  );
}

function viewSettings() {
  return h('div', { dir: 'ltr' }, alertsBlock(), locationCard(), googleCard(), smsCard(), remindersCard(), accountCard());
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
    h('p', { class: 'muted small' }, 'Sunrise, sunset and nightfall are calculated for this place. Change it when you travel.'),
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
          h('div', { class: 'field' }, h('label', {}, 'Name'), h('input', { type: 'text', value: place.name, maxlength: 80, oninput: e => (place.name = e.target.value) })),
          h(
            'div',
            { class: 'row' },
            numberField('Latitude', place.latitude, v => (place.latitude = v), { step: 'any' }),
            numberField('Longitude', place.longitude, v => (place.longitude = v), { step: 'any' }),
            numberField('Elevation (m)', place.elevation, v => (place.elevation = v), { step: '1' }),
          ),
          h('div', { class: 'field' }, h('label', {}, 'Time zone'), h('input', { type: 'text', value: place.timeZone, placeholder: 'America/New_York', oninput: e => (place.timeZone = e.target.value) })),
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

function secretField(key, label, type) {
  const isSet = S.connections.secretsSet[key];
  return h(
    'div',
    { class: 'field' },
    h('label', {}, label),
    h('input', {
      type: type || 'password',
      autocomplete: 'off',
      placeholder: isSet ? 'Saved. Type to replace.' : '',
      value: draft.secrets[key] || '',
      oninput: e => {
        if (e.target.value === '') delete draft.secrets[key];
        else draft.secrets[key] = e.target.value;
      },
    }),
  );
}

function saveSecrets(keys, message) {
  const patch = {};
  for (const k of keys) if (k in draft.secrets) patch[k] = draft.secrets[k];
  if (Object.keys(patch).length === 0) return toast('Nothing new to save.');
  run(
    () => api('PUT', '/api/secrets', patch),
    state => {
      adopt(state);
      render();
      toast(message);
    },
  );
}

function googleCard() {
  const g = S.connections.google;
  const a = draft.app;
  const hasClient = S.connections.secretsSet.googleClientId && S.connections.secretsSet.googleClientSecret;
  const sync = S.sync;
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Google Calendar'),
    g.connected
      ? h('div', { class: 'alert ok' }, 'Connected. The calendar is named “בטהרה” in your Google Calendar; share it from there.')
      : h('div', { class: 'alert info' }, 'Not connected.'),
    sync.lastOkAt ? h('p', { class: 'small muted' }, 'Last brought up to date: ' + new Date(sync.lastOkAt).toLocaleString('en-US', { timeZone: S.timeZone }) + (sync.dirty ? ' (changes waiting)' : '')) : null,
    h('h3', {}, 'Calendar appearance'),
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'style' }, 'Event titles'),
      h(
        'select',
        { id: 'style', onchange: e => (a.calendar.style = e.target.value) },
        h('option', { value: 'hebrew', selected: a.calendar.style === 'hebrew' }, 'Hebrew, with details'),
        h('option', { value: 'discreet', selected: a.calendar.style === 'discreet' }, 'Discreet: symbols only, no details'),
      ),
      h('div', { class: 'help' }, 'Discreet titles: • start, H hefsek, 1/7–7/7 clean days, M mikvah, ◆ onah, ◇ Or Zarua. “?” marks a projected date.'),
    ),
    h(
      'div',
      { class: 'field' },
      numberField('Keep this many days of history up to date in Google Calendar', a.calendar.historyDays, v => (a.calendar.historyDays = v), { min: 30, max: 800, step: 1 }),
    ),
    h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => saveApp('Saved.') }, 'Save appearance')),
    h('h3', {}, 'Connection'),
    h(
      'ol',
      { class: 'small' },
      h('li', {}, 'In Google Cloud Console, create a project and enable the Google Calendar API.'),
      h(
        'li',
        {},
        'Set up the OAuth consent screen (External). Google will not leave Testing without a public privacy policy. Use this page:',
        h('code', { class: 'copy' }, location.origin + '/privacy'),
        ' If it asks for terms of service, use:',
        h('code', { class: 'copy' }, location.origin + '/terms'),
        ' Then create an OAuth client of type “Web application”.',
      ),
      h('li', {}, 'Add this as an authorized redirect URI:', h('code', { class: 'copy' }, S.connections.redirectUri)),
      h('li', {}, 'Paste the client ID and client secret below, save, then press Connect and sign in with the Google account that should own the calendar.'),
    ),
    secretField('googleClientId', 'Client ID', 'text'),
    secretField('googleClientSecret', 'Client secret'),
    h(
      'div',
      { class: 'actions' },
      h('button', { type: 'button', onclick: () => saveSecrets(['googleClientId', 'googleClientSecret'], 'Google client saved.') }, 'Save client'),
      hasClient ? h('a', { class: 'button primary', href: '/api/google/start' }, g.connected ? 'Connect again' : 'Connect') : null,
      g.connected
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
                    toast(o.status === 'ok' ? 'Calendar updated: ' + o.result.inserted + ' added, ' + o.result.updated + ' changed, ' + o.result.deleted + ' removed' + (o.result.remaining ? ', ' + o.result.remaining + ' still to do' : '') + '.' : o.message || o.status, o.status !== 'ok');
                  },
                ),
            },
            'Update calendar now',
          )
        : null,
      g.connected
        ? h(
            'button',
            {
              class: 'danger',
              type: 'button',
              onclick: () => {
                if (!confirm('Disconnect Google Calendar? The calendar itself stays in your Google account.')) return;
                run(
                  () => api('POST', '/api/google/disconnect'),
                  state => {
                    adopt(state);
                    render();
                  },
                );
              },
            },
            'Disconnect',
          )
        : null,
    ),
  );
}

function smsCard() {
  const a = draft.app;
  const sms = S.connections.sms;
  const phoneRow = (p, i) =>
    h(
      'div',
      { class: 'phone' },
      h(
        'div',
        { class: 'row' },
        h('input', { type: 'tel', value: p.number, placeholder: '+17325550123', 'aria-label': 'Phone number', oninput: e => (p.number = e.target.value) }),
        h('input', { type: 'text', value: p.name, placeholder: 'Name', maxlength: 40, 'aria-label': 'Name', oninput: e => (p.name = e.target.value) }),
      ),
      h('label', { class: 'choice' }, h('input', { type: 'checkbox', checked: p.canUpdate, onchange: e => (p.canUpdate = e.target.checked) }), h('span', {}, 'May record by text')),
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
            h('span', {}, REMINDER_LABELS[k] || k),
          ),
        ),
      ),
      h(
        'div',
        { class: 'actions' },
        sms.configured && S.app.phones.some(x => x.number === p.number)
          ? h(
              'button',
              {
                type: 'button',
                onclick: () =>
                  run(
                    () => api('POST', '/api/sms/test', { to: p.number }),
                    r => {
                      adopt(r.state);
                      render();
                      toast('Test message sent.');
                    },
                  ),
              },
              'Send test',
            )
          : null,
        h(
          'button',
          {
            class: 'danger',
            type: 'button',
            onclick: () => {
              a.phones.splice(i, 1);
              render();
            },
          },
          'Remove this phone',
        ),
      ),
    );

  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Text messages'),
    sms.configured ? h('div', { class: 'alert ok' }, 'Set up. Text ' + sms.number + ': 1 flow, 2 hefsek, 3 count broken, 4 mikvah, 5 stain, 9 status, 0 undo, ? help.') : h('div', { class: 'alert info' }, 'Not set up.'),
    h(
      'ol',
      { class: 'small' },
      h('li', {}, 'In Telnyx, buy a number, create a Messaging Profile, and assign the number to it. Complete the number’s verification.'),
      h('li', {}, 'Set the profile’s inbound webhook URL to:', h('code', { class: 'copy' }, S.connections.webhookUrl)),
      h('li', {}, 'Paste the API key, the public key and the number below.'),
    ),
    secretField('telnyxApiKey', 'Telnyx API key'),
    secretField('telnyxPublicKey', 'Telnyx public key', 'text'),
    secretField('telnyxNumber', 'Your Telnyx number (with country code)', 'text'),
    h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => saveSecrets(['telnyxApiKey', 'telnyxPublicKey', 'telnyxNumber'], 'Saved.') }, 'Save keys')),
    h('h3', {}, 'Phones'),
    a.phones.length === 0 ? h('p', { class: 'muted' }, 'No phones yet.') : h('div', {}, a.phones.map(phoneRow)),
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          type: 'button',
          onclick: () => {
            a.phones.push({ number: '', name: '', canUpdate: true, reminders: [...S.reminderKinds] });
            render();
          },
        },
        'Add a phone',
      ),
      h('button', { class: 'primary', type: 'button', onclick: () => saveApp('Phones saved.') }, 'Save phones'),
    ),
  );
}

function remindersCard() {
  const r = draft.app.reminders;
  const a = draft.app;
  const toggle = (obj, label) => h('label', { class: 'choice' }, h('input', { type: 'checkbox', checked: obj.on, onchange: e => (obj.on = e.target.checked) }), h('span', {}, label));
  const timeValue = (hh, mm) => String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Reminders'),
    h(
      'fieldset',
      {},
      toggle(r.hefsek, 'Hefsek taharah, on each day it can be done'),
      numberField('Minutes before sunset', r.hefsek.minutesBeforeSunset, v => (r.hefsek.minutesBeforeSunset = v), { min: 20, max: 600 }),
      numberField('Stop after this many days', r.hefsekMaxDays, v => (r.hefsekMaxDays = v), { min: 1, max: 30 }),
    ),
    h(
      'fieldset',
      {},
      toggle(r.bedikot, 'Bedikot, on each of the seven clean days'),
      h(
        'label',
        { class: 'row' },
        h('span', {}, 'Morning reminder at'),
        h('input', {
          type: 'time',
          value: timeValue(r.bedikot.morningHour, r.bedikot.morningMinute),
          oninput: e => {
            const [hh, mm] = e.target.value.split(':').map(Number);
            if (Number.isFinite(hh) && Number.isFinite(mm)) {
              r.bedikot.morningHour = hh;
              r.bedikot.morningMinute = mm;
            }
          },
        }),
      ),
      numberField('Afternoon reminder, minutes before sunset', r.bedikot.minutesBeforeSunset, v => (r.bedikot.minutesBeforeSunset = v), { min: 20, max: 600 }),
    ),
    h('fieldset', {}, toggle(r.mikvah, 'Mikvah night'), numberField('Minutes before sunset', r.mikvah.minutesBeforeSunset, v => (r.mikvah.minutesBeforeSunset = v), { min: 20, max: 600 })),
    h(
      'fieldset',
      {},
      toggle(r.mikvahConfirm, 'Ask the next morning if no immersion was recorded'),
      h(
        'label',
        { class: 'row' },
        h('span', {}, 'At'),
        h('input', {
          type: 'time',
          value: timeValue(r.mikvahConfirm.hour, r.mikvahConfirm.minute),
          oninput: e => {
            const [hh, mm] = e.target.value.split(':').map(Number);
            if (Number.isFinite(hh) && Number.isFinite(mm)) {
              r.mikvahConfirm.hour = hh;
              r.mikvahConfirm.minute = mm;
            }
          },
        }),
      ),
    ),
    h('fieldset', {}, toggle(r.onah, 'Onot perishah'), numberField('Minutes before the onah begins', r.onah.minutesBefore, v => (r.onah.minutesBefore = v), { min: 0, max: 1440 })),
    h(
      'fieldset',
      {},
      h(
        'label',
        { class: 'choice' },
        h('input', { type: 'checkbox', checked: r.beforeRestDays, onchange: e => (r.beforeRestDays = e.target.checked) }),
        h('span', {}, 'Send nothing on Shabbat and Yom Tov; send beforehand what falls on them'),
      ),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'sms-style' }, 'Wording'),
        h(
          'select',
          { id: 'sms-style', onchange: e => (r.style = e.target.value) },
          h('option', { value: 'plain', selected: r.style === 'plain' }, 'Plain words'),
          h('option', { value: 'discreet', selected: r.style === 'discreet' }, 'Discreet: letters and times only'),
        ),
      ),
      numberField('When a text arrives within this many minutes after sunrise or sunset, ask which side it was', a.boundaryMarginMinutes, v => (a.boundaryMarginMinutes = v), { min: 0, max: 120 }),
    ),
    h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', onclick: () => saveApp('Reminders saved.') }, 'Save reminders')),
    h('h3', {}, 'Coming reminders'),
    S.reminders.length === 0
      ? h('p', { class: 'muted' }, 'None scheduled.')
      : h(
          'ul',
          { class: 'list' },
          S.reminders.map(x => h('li', {}, h('div', { class: 'main' }, h('div', { class: 'when' }, x.when + ' · ' + (REMINDER_LABELS[x.kind] || x.kind)), h('div', { class: 'mono' }, x.text)))),
        ),
  );
}

function accountCard() {
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Session'),
    h(
      'button',
      {
        type: 'button',
        onclick: () =>
          run(
            () => api('POST', '/api/logout'),
            () => {
              S = null;
              renderLogin('');
            },
          ),
      },
      'Sign out',
    ),
  );
}

window.addEventListener('hashchange', () => {
  const next = location.hash.slice(1);
  if (['today', 'log', 'halacha', 'settings'].includes(next) && next !== tab) {
    tab = next;
    render();
  }
});

load().catch(e => {
  root.replaceChildren(h('div', { class: 'card login', dir: 'ltr' }, h('h2', {}, 'Could not load'), h('p', {}, e.message || 'Unknown error')));
});
