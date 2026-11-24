/*
 * Settings: Phones. A compact row per phone; each phone opens its own view
 * (#settings/phones/<digits>): its name, what it may do, which reminders it
 * receives, a test text, verifying it, removing it. Adding a phone is its own
 * two-step view (#settings/phones/add).
 */
import { alert, api, button, confirmDialog, emptyState, h, icon, pretty, textField } from '../../lib.js';
import { S, signOutLocally, t } from '../../store.js';
import { attempt, refresh, region } from '../shared.js';
import { open, replace } from './route.js';
import { andList, blockRow, group, infoRow, navRow, save, stTag, switchRow } from './ui.js';

/** The two-step flow: adding a phone, or verifying one already on the account. */
const idle = () => ({ step: 'number', number: '', code: '', demoCode: null, error: '', forNumber: null });
let adding = idle();
/** Phones whose consent wording is shown before their reminders are turned on. */
const consenting = new Set();
/** Names being typed, by number. */
const names = {};

export const keyOf = number => number.replace(/\D/g, '');
const phoneByKey = key => S.phones.find(p => keyOf(p.number) === key) || null;
const getsReminders = p => p.texts && !p.optedOut;

function savePhone(p, change, message) {
  const body = { number: p.number, name: p.name, canUpdate: p.canUpdate, reminders: [...p.reminders], texts: p.texts };
  change(body);
  return save('phones', () => api('PUT', '/api/phones', body), { message });
}

/** Why reminders cannot be turned on for this phone, in a sentence; null when they can. */
function reasonOff(p) {
  if (!S.sms.ready) return 'Texting is not available yet.';
  if (!p.verified) return 'Verify this number first.';
  if (p.optedOut) return 'This phone replied STOP. Text START from it first.';
  return null;
}

function tagsOf(p) {
  return [
    p.me ? stTag('this phone', 'info') : null,
    !p.verified ? stTag('not verified', 'warn') : null,
    p.optedOut ? stTag('replied STOP', 'bad') : null,
  ];
}

function phoneSummary(p) {
  const parts = [pretty(p.number)];
  if (p.optedOut) parts.push('nothing is texted');
  else if (p.texts) parts.push(p.reminders.length === S.reminderKinds.length ? 'all reminders' : p.reminders.length === 0 ? 'reminders on, no kinds chosen' : p.reminders.length + ' of ' + S.reminderKinds.length + ' reminders');
  else parts.push('no reminders');
  if (!p.canUpdate) parts.push('does not record by text');
  return parts.join(' · ');
}

// ---------- the list ----------

/** No phone on the account (an account that signs in with Google): what a phone is for, and adding one. */
function emptyListView() {
  const lead = 'For reminders, recording by text and signing in.';
  return {
    title: 'Phones',
    parent: '',
    statusKey: 'phones',
    body: [
      h(
        'div',
        { class: 'st-group st-empty', id: 'phones-list' },
        emptyState({
          icon: 'phone',
          title: 'No phone yet.',
          body: S.sms.ready ? lead + ' Up to ' + S.maxPhones + ' phones can share the account.' : lead + ' Not available until texting is.',
          action: S.sms.ready ? button({ label: 'Add a phone', variant: 'primary', icon: 'plus', attrs: { id: 'phone-add-first' }, onclick: () => open('phones/add') }) : null,
        }),
      ),
    ],
  };
}

function listView() {
  if (S.phones.length === 0) return emptyListView();
  const full = S.phones.length >= S.maxPhones;
  let addRow;
  if (!S.sms.ready) addRow = infoRow({ icon: 'plus', title: 'Add a phone', summary: 'Not available until texting is.', className: 'muted-row' });
  else if (full) addRow = infoRow({ icon: 'plus', title: 'Add a phone', summary: 'This account has the most phones it can have (' + S.maxPhones + '). Remove one to add another.', className: 'muted-row' });
  else addRow = navRow({ path: 'phones/add', id: 'phone-add-row', icon: 'plus', leadKind: 'accent', title: 'Add a phone', summary: 'For husband and wife to share this account.' });
  return {
    title: 'Phones',
    parent: '',
    statusKey: 'phones',
    lead: 'Up to ' + S.maxPhones + ' phones share this account.',
    body: [
      group(
        { title: S.phones.length === 1 ? 'The phone on this account' : 'The ' + S.phones.length + ' phones on this account', id: 'phones-list' },
        S.phones.map(p =>
          navRow({
            path: 'phones/' + keyOf(p.number),
            id: 'phone-row-' + keyOf(p.number),
            icon: 'phone',
            leadKind: p.optedOut ? 'bad' : !p.verified ? 'warn' : 'accent',
            title: p.name || 'Phone',
            tags: tagsOf(p),
            summary: phoneSummary(p),
            className: 'st-phone',
          }),
        ),
        addRow,
      ),
    ],
  };
}

// ---------- one phone ----------

function consentBlock(p, key) {
  return h(
    'div',
    { class: 'st-consent', role: 'group', 'aria-labelledby': 'consent-text-' + key },
    h('p', { id: 'consent-text-' + key }, 'By turning this on, the owner of this phone agrees to receive the reminders chosen below by text message from Betaharah. Message frequency varies. Message and data rates may apply. Reply STOP to stop, HELP for help.'),
    h(
      'div',
      { class: 'actions' },
      button({
        label: 'Turn on text reminders',
        variant: 'primary',
        attrs: { id: 'consent-ok-' + key },
        onclick: () => {
          consenting.delete(p.number);
          savePhone(p, b => (b.texts = true), 'Reminders turned on');
        },
      }),
      button({
        label: 'Cancel',
        attrs: { id: 'consent-no-' + key },
        onclick: () => {
          consenting.delete(p.number);
          refresh('phone-detail');
          document.getElementById('texts-' + key)?.focus();
        },
      }),
    ),
  );
}

function verifyPart(p) {
  if (!S.sms.ready || p.verified) return null;
  const busy = adding.forNumber === p.number;
  if (busy && adding.step === 'code') return codeForm();
  return blockRow(
    h('p', { class: 'st-block-title' }, 'This number is not verified'),
    h('p', { class: 'help' }, 'A 6-digit code is texted to it.'),
    busy && adding.error ? alert({ kind: 'bad', role: 'alert' }, h('span', { id: 'phone-add-error', tabindex: '-1' }, adding.error)) : null,
    h('div', { class: 'actions' }, button({ label: 'Text a code to verify', variant: 'primary', icon: 'message', attrs: { id: 'verify-' + keyOf(p.number) }, onclick: e => requestCode(p.number, e.currentTarget, true) })),
  );
}

function detailView(key) {
  const found = phoneByKey(key);
  if (!found) {
    return {
      title: 'Phone not found',
      parent: 'phones',
      backLabel: 'Phones',
      body: [h('p', {}, 'This phone is not on the account (any more).'), button({ label: 'Show the phones', onclick: () => replace('phones') })],
    };
  }
  return {
    title: found.name || pretty(found.number),
    parent: 'phones',
    backLabel: 'Phones',
    statusKey: 'phones',
    body: region('phone-detail', () => {
      const p = phoneByKey(key) || found;
      const off = reasonOff(p);
      const showConsent = consenting.has(p.number) && !p.texts && !off;
      const kinds = S.reminderKinds;
      const verify = verifyPart(p);
      return h(
        'div',
        {},
        h(
          'div',
          { class: 'st-hero compact' },
          h('span', { class: 'st-hero-icon' }, icon('phone')),
          h('div', { class: 'st-hero-main' }, h('p', { class: 'st-hero-title' }, pretty(p.number)), h('p', { class: 'st-tags' }, tagsOf(p), p.verified && !p.optedOut ? stTag(getsReminders(p) ? 'reminders on' : 'reminders off', getsReminders(p) ? 'ok' : null) : null)),
        ),
        p.optedOut ? alert({ kind: 'warn' }, 'This phone replied STOP. Text START to receive texts again.') : null,
        verify ? group({ title: 'Verification', id: 'phone-verify' }, verify) : null,
        group(
          { title: 'What this phone may do', id: 'phone-may' },
          switchRow({
            id: 'can-update-' + key,
            label: 'Record by text message',
            help: S.sms.ready ? 'Texts from this phone, such as 1 or 2, are recorded.' : 'Texting is not available yet.',
            checked: p.canUpdate,
            onchange: e => {
              const on = e.target.checked;
              savePhone(p, b => (b.canUpdate = on));
            },
          }),
          switchRow({
            id: 'texts-' + key,
            label: 'Receive text reminders',
            help: off || (p.texts ? null : 'The terms are shown first.'),
            checked: p.texts || showConsent,
            disabled: Boolean(off) && !p.texts,
            onchange: e => {
              if (e.target.checked) {
                consenting.add(p.number);
                refresh('phone-detail');
                document.getElementById('consent-ok-' + key)?.focus();
              } else {
                consenting.delete(p.number);
                savePhone(p, b => (b.texts = false), 'Reminders turned off');
              }
            },
          }),
          showConsent ? blockRow(consentBlock(p, key)) : null,
        ),
        p.texts
          ? group(
              {
                title: 'Reminders it receives',
                id: 'phone-kinds',
                footer: 'Their times are set under Reminders.',
              },
              kinds.map(k =>
                switchRow({
                  id: 'rem-' + key + '-' + k,
                  label: S.labels.reminders[k] || k,
                  help: k === 'mikvah_book' ? t('The morning after the {hefsek} is recorded.') : null,
                  checked: p.reminders.includes(k),
                  onchange: e => {
                    const on = e.target.checked;
                    savePhone(p, b => (b.reminders = on ? kinds.filter(x => x === k || b.reminders.includes(x)) : b.reminders.filter(x => x !== k)));
                  },
                }),
              ),
            )
          : null,
        group(
          { id: 'phone-name' },
          blockRow(
            h(
              'div',
              { class: 'field' },
              h('label', { for: 'name-' + key }, 'Name shown on this page'),
              h('input', {
                id: 'name-' + key,
                type: 'text',
                class: 'wide',
                maxlength: 40,
                placeholder: 'For example: Sarah',
                value: names[p.number] !== undefined ? names[p.number] : p.name,
                'aria-describedby': 'name-help-' + key,
                oninput: e => (names[p.number] = e.target.value),
                onchange: e => {
                  const v = e.target.value.trim();
                  delete names[p.number];
                  if (v !== p.name) savePhone(p, b => (b.name = v), v ? 'Saved: ' + v : 'Name removed');
                },
              }),
              h('p', { class: 'help', id: 'name-help-' + key }, 'Optional. Saved when you leave the box.'),
            ),
          ),
        ),
        group(
          { title: 'Test', id: 'phone-test' },
          blockRow(
            h('p', { class: 'help' }, S.demo ? 'Simulated in the test account.' : 'One short text, to check that texts arrive.'),
            h(
              'div',
              { class: 'actions' },
              button({
                label: 'Send a test text',
                icon: 'message',
                disabled: !S.sms.ready || !p.verified || p.optedOut,
                attrs: { id: 'test-' + key },
                onclick: () => save('phones', () => api('POST', '/api/phones/test', { number: p.number }), { message: S.demo ? 'A test text was simulated' : 'A test text was sent' }),
              }),
            ),
            !S.sms.ready || !p.verified || p.optedOut ? h('p', { class: 'help' }, !S.sms.ready ? 'Text messaging is not available on this site yet.' : !p.verified ? 'Verify the number first.' : 'This phone replied STOP; nothing can be sent to it.') : null,
          ),
        ),
        group(
          { title: 'Remove', id: 'phone-remove' },
          blockRow(
            S.phones.length > 1 || S.account.googleEmail
              ? [
                  h(
                    'p',
                    { class: 'help' },
                    p.me
                      ? 'This is the phone you are signed in with. Removing it signs you out here.'
                      : S.phones.length > 1
                        ? 'It can no longer sign in or get texts.'
                        : 'It can no longer sign in or get texts. You still sign in with Google.',
                  ),
                  h(
                    'div',
                    { class: 'actions' },
                    button({
                      label: 'Remove this phone',
                      variant: 'danger',
                      icon: 'trash',
                      attrs: { id: 'remove-' + key },
                      onclick: async e => {
                        const btn = e.currentTarget;
                        const ok = await confirmDialog({
                          title: 'Remove ' + pretty(p.number) + ' from this account?',
                          body: p.me ? 'This is the phone you are signed in with. You will be signed out.' : 'It can no longer sign in or get texts.',
                          confirmLabel: 'Remove phone',
                          danger: true,
                        });
                        if (!ok) return;
                        attempt(() => api('POST', '/api/phones/remove', { number: p.number }), {
                          button: btn,
                          done: r => {
                            if (r.signedOut) {
                              signOutLocally();
                              location.replace('/app/?note=left');
                              return;
                            }
                            save('phones', () => Promise.resolve(r), { message: 'Removed ' + pretty(p.number) }).then(() => replace('phones'));
                          },
                        });
                      },
                    }),
                  ),
                ]
              : h('p', { class: 'help' }, 'The only phone cannot be removed.'),
          ),
        ),
      );
    }),
  };
}

// ---------- adding a phone, and verifying one ----------

function requestCode(number, btn, existing) {
  adding.error = '';
  attempt(() => api('POST', '/api/phones/code', { number }), {
    button: btn,
    done: r => {
      adding = { ...idle(), step: 'code', number: r.number, demoCode: r.demoCode || null, forNumber: existing ? number : null };
      refresh(existing ? 'phone-detail' : 'phone-add');
      document.getElementById('add-code')?.focus();
    },
    fail: message => {
      if (existing) adding = { ...idle(), error: message, forNumber: number };
      else adding.error = message;
      refresh(existing ? 'phone-detail' : 'phone-add');
      document.getElementById(existing ? 'phone-add-error' : 'add-number')?.focus();
    },
  });
}

function codeForm() {
  const existing = adding.forNumber !== null;
  return h(
    'form',
    {
      class: 'st-form st-add st-row st-block',
      novalidate: true,
      onsubmit: e => {
        e.preventDefault();
        if (!/^\d{6}$/.test(adding.code)) {
          adding.error = 'Enter the 6 digits of the code.';
          refresh(existing ? 'phone-detail' : 'phone-add');
          document.getElementById('add-code')?.focus();
          return;
        }
        attempt(() => api('POST', '/api/phones/verify', { number: adding.number, code: adding.code }), {
          button: e.submitter || document.getElementById('add-confirm'),
          done: r => {
            const number = adding.number;
            adding = idle();
            save('phones', () => Promise.resolve(r), { message: existing ? 'The number is verified' : 'The phone is on your account' }).then(() => {
              if (!existing) replace('phones/' + keyOf(number));
            });
          },
          fail: message => {
            adding.error = message;
            refresh(existing ? 'phone-detail' : 'phone-add');
            document.getElementById('add-code')?.focus();
          },
        });
      },
    },
    existing ? null : h('p', { class: 'st-step' }, 'Step 2 of 2'),
    h('p', { class: 'st-block-title' }, 'Enter the code'),
    adding.demoCode
      ? alert({ kind: 'info', title: 'The code is ' + adding.demoCode }, 'In the test account the code is shown here instead of being texted.')
      : h('p', { class: 'help' }, 'A 6-digit code was texted to ' + pretty(adding.number) + '. It is valid for a few minutes.'),
    textField({
      id: 'add-code',
      label: 'Code',
      class: 'code',
      wide: false,
      autocomplete: 'one-time-code',
      inputmode: 'numeric',
      maxlength: 6,
      value: adding.code,
      error: adding.error,
      oninput: e => (adding.code = e.target.value.replace(/\D/g, '')),
    }),
    h(
      'div',
      { class: 'actions' },
      button({ label: existing ? 'Verify' : 'Add this phone', variant: 'primary', type: 'submit', attrs: { id: 'add-confirm' } }),
      button({
        label: existing ? 'Cancel' : 'Use another number',
        attrs: { id: 'add-cancel' },
        onclick: () => {
          const keep = existing ? '' : adding.number;
          adding = idle();
          adding.number = keep;
          refresh(existing ? 'phone-detail' : 'phone-add');
          document.getElementById(existing ? 'verify-' + keyOf(keep || '') : 'add-number')?.focus();
        },
      }),
    ),
  );
}

function addView() {
  return {
    title: 'Add a phone',
    parent: 'phones',
    backLabel: 'Phones',
    body: region('phone-add', () => {
      if (!S.sms.ready) return h('div', {}, h('p', {}, (S.phones.length ? 'A second phone' : 'A phone') + ' can be added once text messaging is available on this site.'));
      if (adding.forNumber !== null) adding = idle();
      if (adding.step !== 'code' && S.phones.length >= S.maxPhones) return h('div', {}, h('p', {}, 'This account has the most phones it can have (' + S.maxPhones + '). Remove one first.'));
      if (adding.step === 'code') return h('div', { class: 'st-group' }, h('div', { class: 'st-rows' }, codeForm()));
      return h(
        'div',
        {},
        h(
          'ol',
          { class: 'st-steps-intro' },
          h('li', {}, (S.phones.length ? 'Enter the other phone’s number.' : 'Enter the phone’s number.') + ' A 6-digit code is texted to it.'),
          h('li', {}, 'Enter that code here.'),
        ),
        h(
          'div',
          { class: 'st-group' },
          h(
            'div',
            { class: 'st-rows' },
            h(
              'form',
              {
                class: 'st-form st-add st-row st-block',
                novalidate: true,
                onsubmit: e => {
                  e.preventDefault();
                  const digits = adding.number.replace(/\D/g, '');
                  if (digits.length < 10) {
                    adding.error = 'Enter the full mobile number, with its area code.';
                    refresh('phone-add');
                    document.getElementById('add-number')?.focus();
                    return;
                  }
                  requestCode(adding.number, e.submitter || document.getElementById('add-send'), false);
                },
              },
              h('p', { class: 'st-step' }, 'Step 1 of 2'),
              textField({
                id: 'add-number',
                label: 'Mobile number to add',
                type: 'tel',
                autocomplete: 'off',
                inputmode: 'tel',
                placeholder: S.demo ? '(732) 555-0150' : '(732) 555-0123',
                help: S.demo ? 'The test account takes only made-up numbers, from 555-0100 to 555-0199.' : 'Add only a phone whose owner has agreed.',
                value: adding.number,
                error: adding.error,
                oninput: e => (adding.number = e.target.value),
              }),
              h('div', { class: 'actions' }, button({ label: 'Text a code to it', type: 'submit', variant: 'primary', icon: 'message', attrs: { id: 'add-send' } })),
            ),
          ),
        ),
      );
    }),
  };
}

function view(rest) {
  if (rest[0] === 'add') return addView();
  if (rest[0]) return detailView(rest[0]);
  return listView();
}

export const phonesSection = {
  id: 'phones',
  title: 'Phones',
  icon: 'phone',
  summary: () => {
    const n = S.phones.length;
    if (n === 0) return S.sms.ready ? 'No phone yet · add one for reminders by text' : 'No phone yet · texting not available here';
    const on = S.phones.filter(getsReminders).length;
    const head = n === 1 ? '1 phone' : n + ' phones';
    let rem;
    if (!S.sms.ready) rem = 'texting not available here';
    else if (on === 0) rem = 'reminders off';
    else if (on === n) rem = n === 1 ? 'reminders on' : n === 2 ? 'reminders on for both' : 'reminders on for all';
    else rem = 'reminders on for ' + on + ' of ' + n;
    return head + ' · ' + rem;
  },
  flag: () => {
    const stop = S.phones.filter(p => p.optedOut);
    if (stop.length) return { kind: 'bad', text: andList(stop.map(p => p.name || pretty(p.number))) + ' replied STOP' };
    const unverified = S.phones.filter(p => !p.verified);
    if (unverified.length && S.sms.ready) return { kind: 'warn', text: unverified.length === 1 ? (unverified[0].name || pretty(unverified[0].number)) + ' is not verified' : unverified.length + ' phones are not verified' };
    return null;
  },
  view,
};
