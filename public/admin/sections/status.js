/* Status: is each part of the site working, in a sentence each. */
import { card, h, pretty, tag } from '/app/lib.js';
import { ago, num, plural, S } from '../state.js';

/** What each kind of failure to send means. */
export const FAILURE_WORDS = {
  not_set_up: 'texting was not set up at the time',
  site_limit: 'the monthly limit on texts for the whole site was reached',
  blocked: 'the phone had replied STOP',
  auth: 'Telnyx refused the API key',
  refused: 'Telnyx refused the text',
  network: 'Telnyx could not be reached',
};

function row(title, kind, word, ...sentences) {
  return h('li', { class: 'health-row' }, h('div', { class: 'health-head' }, h('span', { class: 'health-title' }, title), tag(word, kind)), sentences.filter(Boolean).map(s => h('p', {}, s)));
}

function texting() {
  const o = S.ops;
  const fail = o.lastFailure;
  const failNewer = fail && (!o.lastSentAt || fail.at > o.lastSentAt);
  const failText = fail ? 'Last failure ' + ago(fail.at, S.now) + ': ' + (FAILURE_WORDS[fail.kind] || 'not sent') + (fail.code ? ' (Telnyx ' + fail.code + ')' : '') + '.' : null;
  if (!S.smsReady) {
    const why = !S.config.smsEnabled ? 'Switched off in Site settings.' : 'Telnyx keys missing.';
    return row('Text messaging', 'warn', 'Off', why + ' Password sign-in and invitations only.', failText);
  }
  const sent = o.lastSentAt ? 'Last sent ' + ago(o.lastSentAt, S.now) + '.' : 'Nothing sent yet.';
  return row('Text messaging', failNewer ? 'bad' : 'ok', failNewer ? 'Failing' : 'On', 'From ' + pretty(S.textingNumber) + '. ' + sent, failText);
}

function job() {
  const at = S.ops.heartbeatAt;
  if (!at) return row('Every-minute job', 'info', 'Not recorded', 'No run yet. It sends reminders and updates Google calendars.');
  const minutes = (S.now - at) / 60000;
  if (minutes > 5) return row('Every-minute job', 'bad', 'Late', 'Last ran ' + ago(at, S.now) + '. Reminders wait for it.', 'Cloudflare: Workers & Pages → betaharah → Settings → Trigger events.');
  return row('Every-minute job', 'ok', 'Running', 'Last ran ' + ago(at, S.now) + '. ' + plural(S.totals.waiting, 'reminder') + ' waiting.');
}

function inbound() {
  const at = S.ops.lastReceivedAt;
  if (!at) return row('Received texts', 'info', 'None yet', 'If people texted, check the webhook in Telnyx.');
  return row('Received texts', 'ok', 'Arriving', 'Last ' + ago(at, S.now) + '. ' + plural(S.counts.today.textsReceived, 'text') + ' today.');
}

function google() {
  const c = S.checks.google;
  if (!S.googleReady) return row('Google', null, 'Not set up', 'Optional.');
  return row('Google', c && !c.ok ? 'bad' : 'ok', c && !c.ok ? 'Problem' : 'Set up', c ? 'Last check ' + ago(c.at, S.now) + ': ' + c.message : 'Not checked yet.');
}

function rcs() {
  const c = S.checks.rcs;
  if (S.rcsReady) return row('RCS', c && c.agentStatus === 'LIVE' ? 'ok' : 'info', 'On', c ? 'Last check ' + ago(c.at, S.now) + ': ' + c.message : 'SMS where RCS is not possible.');
  return row('RCS', null, 'Off', 'Optional. Texts go by SMS.');
}

function telnyxCheck() {
  const c = S.checks.telnyx;
  if (!c) return null;
  return row('Telnyx keys', c.ok ? 'ok' : 'bad', c.ok ? 'Checked' : 'Problem', 'Last check ' + ago(c.at, S.now) + ': ' + c.message);
}

export function statusCard() {
  return card(
    { title: 'Status', icon: 'refresh', intro: num(S.totals.households) + ' ' + (S.totals.households === 1 ? 'account' : 'accounts') + ', ' + plural(S.totals.phones, 'phone') + '.' },
    h('ul', { class: 'health' }, texting(), telnyxCheck(), job(), inbound(), google(), rcs()),
  );
}
