/*
 * Settings: Texting. The number to text, this month's usage against the
 * limit, and how texting works: every text ends with its options, which
 * can be answered by word. The main options come from the server
 * (S.sms.mainOptions, in the operator's wording); there are no digits.
 */
import { h, icon, pretty } from '../../lib.js';
import { S, t } from '../../store.js';
import { blockRow, group, infoRow } from './ui.js';

/** The main options as shipped, when the server does not send them. */
export const MAIN_OPTIONS = ['PERIOD', 'HEFSEK', 'STATUS', 'MORE'];

/** What each main option does, in order. */
const MAIN_MEANINGS = ['{flow} began: asks when', '{hefsek} done: asks which day', 'Where you are now', 'History, undo, a {stain}, settings'];

/** The main options, from the server when it sends them. */
export function mainOptions() {
  const list = S.sms && Array.isArray(S.sms.mainOptions) ? S.sms.mainOptions.filter(x => typeof x === 'string') : null;
  return list && list.length === MAIN_OPTIONS.length ? list : MAIN_OPTIONS;
}

/** The main options with what they do, as rows. */
export function mainRows() {
  return mainOptions().map((label, i) => [label, MAIN_MEANINGS[i] || '']);
}

const WORDS = [
  ['MENU', 'The main options'],
  ['UNDO', 'Undo the last entry'],
  ['HISTORY', 'The latest entries, to remove one'],
  ['LOCATION', 'Show or change the place'],
  ['CUSTOMS', 'Show or change a custom'],
  ['REMINDERS', 'This phone’s reminders'],
  ['PHONES', 'The phones on the account'],
  ['CALENDAR', 'The calendar link'],
  ['WEB', 'A one-time sign-in link'],
  ['DELETE ACCOUNT', 'Deletes the account, after asking'],
];

const CARRIER = [
  ['STOP', 'Stops all texts to this phone'],
  ['START', 'Receive texts again'],
  ['HELP', 'Where to get help'],
];

function commandTable(id, caption, rows, stack) {
  return h(
    'table',
    { class: 'st-commands' + (stack ? ' stack' : ''), id },
    h('caption', { class: 'visually-hidden' }, caption),
    h('thead', { class: 'visually-hidden' }, h('tr', {}, h('th', { scope: 'col' }, 'Text'), h('th', { scope: 'col' }, 'What it does'))),
    h(
      'tbody',
      {},
      rows.map(([code, meaning]) => h('tr', {}, h('th', { scope: 'row' }, h('kbd', {}, code)), h('td', {}, t(meaning).replace(/^./, c => c.toUpperCase())))),
    ),
  );
}

function usage() {
  const sms = S.sms;
  const used = sms.usedThisMonth;
  const limit = sms.monthlyLimit;
  const share = limit ? Math.min(1, used / limit) : 0;
  const bar = h('span', { class: 'st-meter-fill' + (share >= 0.9 ? ' high' : '') });
  bar.style.width = Math.round(share * 100) + '%';
  return blockRow(
    h('p', { class: 'st-block-title', id: 'usage-label' }, (sms.simulated ? 'Texts simulated this month: ' : 'Texts sent this month: ') + used + ' of ' + limit),
    h('span', { class: 'st-meter', role: 'img', 'aria-labelledby': 'usage-label' }, bar),
    h('p', { class: 'help' }, used >= limit ? 'Limit reached: no texts until the 1st. This website still works.' : 'Starts again on the 1st of each month.'),
  );
}

function view() {
  const sms = S.sms;
  if (!sms.ready) {
    return {
      title: 'Texting',
      parent: '',
      body: [
        group({ title: 'Not available yet' }, infoRow({ icon: 'info', title: 'Text messaging is not available on this site yet.', summary: 'Record everything here on the website.' })),
      ],
    };
  }
  return {
    title: 'Texting',
    parent: '',
    lead: 'Record and check by text, from a phone on this account.',
    body: [
      S.phones.length === 0
        ? h(
            'p',
            { class: 'st-note', id: 'txt-no-phone' },
            icon('info', { size: 'sm' }),
            h('span', {}, 'No phone is on this account yet. ', h('a', { href: '#settings/phones/add' }, 'Add a phone'), ' to text from it.'),
          )
        : null,
      group(
        { title: 'The number to text', id: 'txt-number' },
        infoRow({
          icon: 'message',
          leadKind: 'accent',
          title: h('span', { class: 'st-big' }, pretty(sms.number)),
          summary: sms.simulated ? 'Nothing is sent. Use “Try a text” on Today.' : 'Save it in your contacts as Betaharah.',
          trail: sms.simulated ? null : h('a', { class: 'button sm', href: 'sms:' + sms.number, id: 'txt-open' }, icon('message'), 'Text it'),
        }),
        usage(),
      ),
      group(
        { title: 'Options', id: 'txt-options', footer: 'Every text ends with its options. Answer with an option, or in words, for example: period last night.' },
        blockRow(commandTable('cmd-options', 'The main options', mainRows())),
      ),
      group({ title: 'Words', id: 'txt-words', footer: 'These work at any time.' }, blockRow(commandTable('cmd-words', 'Words', WORDS, true))),
      group({ title: 'For every text service', id: 'txt-carrier' }, blockRow(commandTable('cmd-carrier', 'Carrier words', CARRIER))),
      h('p', { class: 'help st-foot' }, 'More on the ', h('a', { href: '/help' }, 'Help page'), '.'),
    ],
  };
}

export const textingSection = {
  id: 'texting',
  title: 'Texting',
  icon: 'message',
  summary: () => {
    const sms = S.sms;
    if (!sms.ready) return 'Not available on this site yet';
    return pretty(sms.number) + ' · ' + sms.usedThisMonth + ' of ' + sms.monthlyLimit + ' texts this month';
  },
  flag: () => {
    const sms = S.sms;
    if (!sms.ready || !sms.monthlyLimit) return null;
    if (sms.usedThisMonth >= sms.monthlyLimit) return { kind: 'bad', text: 'Monthly limit reached' };
    if (sms.usedThisMonth >= sms.monthlyLimit * 0.9) return { kind: 'warn', text: 'Close to the monthly limit' };
    return null;
  },
  view,
};
