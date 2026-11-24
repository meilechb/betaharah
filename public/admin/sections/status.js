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
  const failText = fail ? 'The last failure to send was ' + ago(fail.at, S.now) + ': ' + (FAILURE_WORDS[fail.kind] || 'the text was not sent') + (fail.code ? ' (Telnyx error ' + fail.code + ')' : '') + '.' : null;
  if (!S.smsReady) {
    const why = !S.config.smsEnabled ? 'The switch "Send text messages" is off under Site settings.' : 'The Telnyx keys are not all saved under Keys and connections.';
    return row(
      'Text messaging',
      'warn',
      'Off',
      'Text messaging is off or not set up. ' + why,
      'Until it works, people can sign in only with a password, and only accounts you create by invitation can exist.',
      failText,
    );
  }
  const sent = o.lastSentAt ? 'The last text went out ' + ago(o.lastSentAt, S.now) + '.' : 'No text has been sent yet. Send a test text under Tools.';
  return row('Text messaging', failNewer ? 'bad' : 'ok', failNewer ? 'Failing' : 'On', 'Text messaging is on. Texts are sent from ' + pretty(S.textingNumber) + '. ' + sent, failText);
}

function job() {
  const at = S.ops.heartbeatAt;
  if (!at) return row('The every-minute job', 'info', 'Not recorded', 'No run of the every-minute job has been recorded yet. This job sends the reminders and keeps the Google calendars current.');
  const minutes = (S.now - at) / 60000;
  if (minutes > 5) return row('The every-minute job', 'bad', 'Late', 'The every-minute job last ran ' + ago(at, S.now) + '. It should run every minute; reminders wait until it runs.', 'In Cloudflare, check Workers & Pages → betaharah → Settings → Trigger events for a schedule of every minute.');
  return row('The every-minute job', 'ok', 'Running', 'The every-minute job last ran ' + ago(at, S.now) + '. It sends reminders and keeps the Google calendars current.', plural(S.totals.waiting, 'account has', 'accounts have') + ' a reminder waiting to be sent.');
}

function inbound() {
  const at = S.ops.lastReceivedAt;
  if (!at) return row('Received texts', 'info', 'None yet', 'No text sent to the number has reached the site yet. If people have texted it, the webhook address in Telnyx is wrong or missing (see Keys and connections).');
  return row('Received texts', 'ok', 'Arriving', 'The last text reached the site ' + ago(at, S.now) + '. ' + plural(S.counts.today.textsReceived, 'text') + ' arrived today.');
}

function google() {
  const c = S.checks.google;
  if (!S.googleReady) return row('Google', null, 'Not set up', 'Google is not set up. This is optional: people sign in with their phone and can still use the calendar subscription link.');
  return row('Google', c && !c.ok ? 'bad' : 'ok', c && !c.ok ? 'Problem' : 'Set up', 'People can sign in with Google and connect their Google Calendar.', c ? 'Last check, ' + ago(c.at, S.now) + ': ' + c.message : 'Use "Check Google" under Keys and connections to test the keys.');
}

function rcs() {
  const c = S.checks.rcs;
  if (S.rcsReady) return row('RCS', c && c.agentStatus === 'LIVE' ? 'ok' : 'info', 'On', 'RCS is switched on. Texts go by RCS where the phone and the agent allow it, and by SMS otherwise.', c ? 'Last check, ' + ago(c.at, S.now) + ': ' + c.message : null);
  return row('RCS', null, 'Off', 'RCS is off. Texts go by SMS. This is optional.');
}

function telnyxCheck() {
  const c = S.checks.telnyx;
  if (!c) return null;
  return row('Telnyx keys', c.ok ? 'ok' : 'bad', c.ok ? 'Checked' : 'Problem', 'Last check, ' + ago(c.at, S.now) + ': ' + c.message);
}

export function statusCard() {
  return card(
    { title: 'Status', icon: 'refresh', intro: 'Whether each part of the site is working. ' + num(S.totals.households) + ' ' + (S.totals.households === 1 ? 'account' : 'accounts') + ' and ' + plural(S.totals.phones, 'phone') + ' in all.' },
    h('ul', { class: 'health' }, texting(), telnyxCheck(), job(), inbound(), google(), rcs()),
  );
}
