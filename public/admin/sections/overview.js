/* The Overview page: stat tiles with trends, setup progress, status, and the last 30 days. */
import { card, emptyState, h, icon, skeleton, tag } from '/app/lib.js';
import { dollars, num, plural, S, sectionLabel } from '../state.js';
import { statusCard } from './status.js';
import { chart, historyState, loadHistory, SERIES } from './usage.js';

const STATUS_TAG = {
  done: ['Done', 'ok'],
  todo: ['Needs you', 'warn'],
  waiting: ['Waiting on someone else', 'info'],
  optional: ['Optional', null],
};

/** Sum of one count over days [from, to) counted back from the newest day. */
function sum(days, key, from, to) {
  return days.slice(days.length - to, days.length - from).reduce((n, d) => n + d[key], 0);
}

/** "Up 3 on the 7 days before" style trend line, or null without history. */
function trend(key, noun) {
  const { history } = historyState();
  if (!history) return null;
  const last = sum(history.days, key, 0, 7);
  const before = sum(history.days, key, 7, 14);
  const diff = last - before;
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
  const text = num(last) + ' ' + noun + ' in 7 days' + (diff === 0 ? ' (same as the week before)' : ' (' + num(Math.abs(diff)) + (diff > 0 ? ' more' : ' fewer') + ' than the week before)');
  return h('div', { class: 'trend ' + dir }, icon(dir === 'up' ? 'chevron-up' : dir === 'down' ? 'chevron-down' : 'chevron-right', { size: 'sm' }), h('span', {}, text));
}

function meter(value, max) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 100;
  const bar = h('div', { class: 'meter' + (pct >= 90 ? ' high' : '') }, h('span', {}));
  bar.firstChild.style.width = pct + '%';
  return h('div', { class: 'meter-wrap' }, bar, h('span', { class: 'meter-text' }, pct + '% of the limit'));
}

function tile(o) {
  return h(
    'div',
    { class: 'stat' },
    h('div', { class: 'stat-label' }, icon(o.icon, { size: 'sm' }), h('span', {}, o.label)),
    h('div', { class: 'stat-value' }, o.value),
    o.note ? h('div', { class: 'stat-note' }, o.note) : null,
    o.extra || null,
  );
}

function tiles() {
  const m = S.counts.month;
  const cost = (m.textsSent + m.textsReceived) * S.notes.centsPerText;
  return h(
    'div',
    { class: 'stats' },
    tile({ icon: 'user', label: 'Accounts', value: num(S.counts.regularAccounts), note: S.demo.exists ? 'not counting the test account' : null, extra: trend('signups', 'new') }),
    tile({ icon: 'message', label: 'Texts sent this month', value: num(S.usage.textsThisMonth), note: 'of at most ' + num(S.config.monthlyMessageLimit), extra: meter(S.usage.textsThisMonth, S.config.monthlyMessageLimit) }),
    tile({ icon: 'lock', label: 'Sign-in codes today', value: num(S.usage.codesToday), note: 'of at most ' + num(S.config.dailyCodeLimit), extra: meter(S.usage.codesToday, S.config.dailyCodeLimit) }),
    tile({ icon: 'download', label: 'Estimated cost this month', value: dollars(cost), note: num(m.textsSent + m.textsReceived) + ' texts at ' + S.notes.centsPerText + '¢ each', extra: trend('textsSent', 'texts sent') }),
  );
}

function stepRow(item, n, brief) {
  const [label, kind] = STATUS_TAG[item.status];
  const mark = item.status === 'done' ? icon('check') : item.status === 'waiting' ? icon('clock', { size: 'sm' }) : h('span', { 'aria-hidden': 'true' }, String(n));
  return h(
    'li',
    { class: 'step ' + item.status },
    h('span', { class: 'mark' }, mark),
    h(
      'div',
      { class: 'step-body' },
      h('div', { class: 'step-head' }, h('span', { class: 'step-title' }, item.title), tag(label, kind)),
      brief ? null : h('p', { class: 'step-detail' }, item.detail),
      !brief && item.next ? h('p', { class: 'step-next' }, h('strong', {}, 'Next: '), item.next, ' ', h('a', { href: '#' + item.section }, 'Open ' + sectionLabel(item.section))) : null,
    ),
  );
}

function setupCard() {
  const required = S.checklist.filter(i => !i.optional);
  const optional = S.checklist.filter(i => i.optional);
  const done = required.filter(i => i.status === 'done');
  const open = required.filter(i => i.status !== 'done');
  const pct = Math.round((done.length / required.length) * 100);
  const bar = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(required.length), 'aria-valuenow': String(done.length), 'aria-label': 'Setup' }, h('span', {}));
  bar.firstChild.style.width = pct + '%';
  return card(
    { title: 'Setup', icon: 'list', className: 'setup-card', headerAction: h('span', { class: 'setup-count' }, num(done.length) + ' of ' + num(required.length) + ' done') },
    bar,
    open.length
      ? h('ol', { class: 'steps-list' }, open.map((i, k) => stepRow(i, required.indexOf(i) + 1, k > 0)))
      : h('p', { class: 'all-done' }, icon('check'), ' Setup is complete. Text messaging, sign-up and the public pages are in place.'),
    open.length > 1 ? h('p', { class: 'small muted' }, 'Each step says what to do when it is next.') : null,
    h(
      'details',
      { class: 'more-steps' },
      h('summary', {}, 'Done and optional steps (' + num(done.length + optional.length) + ')'),
      h('ol', { class: 'steps-list' }, done.map(i => stepRow(i, required.indexOf(i) + 1)), optional.map((i, k) => stepRow(i, required.length + k + 1))),
    ),
  );
}

function chartCard() {
  const { history, error } = historyState();
  const s = SERIES[0];
  let body;
  if (error) body = h('p', { class: 'muted' }, error);
  else if (!history) body = skeleton({ lines: 4, label: 'Loading the last 30 days' });
  else {
    const total = history.days.reduce((n, d) => n + d.textsSent, 0);
    body = total === 0
      ? emptyState({ icon: 'message', title: 'No texts were sent in the last 30 days.', body: S.smsReady ? 'Texts appear here as they are sent.' : 'Texts are counted here once text messaging is set up.' })
      : h('div', {}, h('p', { class: 'small muted' }, num(total) + ' ' + (total === 1 ? s.unit[0] : s.unit[1]) + ' in the last 30 days.'), chart(history.days, 'textsSent', s.unit));
  }
  return card({ title: 'Texts sent, last 30 days', icon: 'message', headerAction: h('a', { href: '#usage', class: 'small' }, 'All usage') }, body);
}

export function overviewPage() {
  loadHistory();
  const open = S.checklist.filter(i => !i.optional && i.status !== 'done');
  return [
    open.length
      ? h('p', { class: 'lead' }, plural(open.length, 'setup step') + ' left. ', open[0].status === 'todo' ? 'Next: ' + open[0].title + '.' : 'Waiting on someone else.')
      : null,
    tiles(),
    h('div', { class: 'grid-2' }, setupCard(), statusCard()),
    chartCard(),
  ];
}
