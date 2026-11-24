/* The top of the console: a short summary, and the setup steps in order. */
import { card, h, icon, tag } from '/app/lib.js';
import { dollars, num, plural, S, sectionLabel } from '../state.js';

const STATUS_TAG = {
  done: ['Done', 'ok'],
  todo: ['Needs you', 'warn'],
  waiting: ['Waiting on someone else', 'info'],
  optional: ['Optional', null],
};

/** Steps that are not done and not optional, in order. */
export const openSteps = () => S.checklist.filter(i => !i.optional && i.status !== 'done');

function tile(label, value, note) {
  return h('div', { class: 'tile' }, h('div', { class: 'tile-label' }, label), h('div', { class: 'tile-value' }, value), note ? h('div', { class: 'tile-note' }, note) : null);
}

export function summarySection() {
  const open = openSteps();
  const needsYou = open.filter(i => i.status === 'todo');
  const next = needsYou[0] || open[0];
  const m = S.counts.month;
  const cost = (m.textsSent + m.textsReceived) * S.notes.centsPerText;
  const lead = open.length === 0
    ? 'Setup is complete. Text messaging, sign-up and the public pages are in place.'
    : 'Setup: ' + plural(open.length, 'step') + ' left' + (needsYou.length < open.length ? ' (' + num(open.length - needsYou.length) + ' waiting on someone else)' : '') + '.';
  return card(
    { title: 'Summary', icon: 'info', className: 'summary' },
    h('p', { class: 'summary-lead' }, lead),
    next
      ? h(
          'p',
          { class: 'summary-next' },
          h('strong', {}, 'Next: '),
          next.title + '. ',
          next.next || next.detail,
          ' ',
          h('a', { href: '#' + next.section }, 'Go to ' + sectionLabel(next.section)),
        )
      : null,
    h(
      'div',
      { class: 'tiles' },
      tile('Accounts', num(S.counts.regularAccounts), S.demo.exists ? 'plus the test account' : null),
      tile('Texts sent this month', num(S.usage.textsThisMonth), 'of at most ' + num(S.config.monthlyMessageLimit)),
      tile('Estimated cost this month', dollars(cost), 'texts only, at ' + S.notes.centsPerText + '¢ each'),
      tile('Text messaging', S.smsReady ? 'On' : 'Off', S.smsReady ? 'codes and reminders are sent' : 'no texts are sent'),
    ),
  );
}

function step(item, index) {
  const [label, kind] = STATUS_TAG[item.status];
  const mark = item.status === 'done' ? icon('check') : item.status === 'waiting' ? icon('clock', { size: 'sm' }) : h('span', { 'aria-hidden': 'true' }, String(index + 1));
  return h(
    'li',
    { class: 'step ' + item.status },
    h('span', { class: 'mark' }, mark),
    h(
      'div',
      { class: 'step-body' },
      h('div', { class: 'step-head' }, h('span', { class: 'step-title' }, item.title), tag(label, kind)),
      h('p', { class: 'step-detail' }, item.detail),
      item.next ? h('p', { class: 'step-next' }, h('strong', {}, 'What to do: '), item.next, ' ', h('a', { href: '#' + item.section }, 'Go to ' + sectionLabel(item.section))) : null,
    ),
  );
}

export function setupSection() {
  const required = S.checklist.filter(i => !i.optional);
  const optional = S.checklist.filter(i => i.optional);
  const done = required.filter(i => i.status === 'done').length;
  return card(
    { title: 'Setup steps', icon: 'list', intro: 'What is left to do, in the order it is best done. ' + num(done) + ' of ' + num(required.length) + ' required steps are done. This list replaces most of docs/OPERATOR.md.' },
    h('ol', { class: 'steps-list' }, required.map((i, n) => step(i, n))),
    h('h3', {}, 'Optional'),
    h('ol', { class: 'steps-list' }, optional.map((i, n) => step(i, required.length + n))),
  );
}
