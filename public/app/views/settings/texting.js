/*
 * Settings: Texting. The number to text, this month's usage against the
 * limit, and the commands as a reference (docs/TEXTING.md).
 *
 * The digits come from the server (S.sms.commandList and S.sms.commandNote,
 * in the words the texts use) when it sends them; the words that list does
 * not have (MENU's second level, from docs/TEXTING.md) are listed here, in
 * one place, with the fallbacks.
 */
import { h, icon, pretty } from '../../lib.js';
import { S, t } from '../../store.js';
import { blockRow, group, infoRow } from './ui.js';

export const DIGITS = [
  ['1', '{flow} began'],
  ['2', '{hefsek} done'],
  ['3', 'Count broken'],
  ['4', '{immersion} done'],
  ['5', '{stain}'],
  ['9', 'Status: where you are now'],
  ['0', 'Undo the last entry'],
  ['?', 'The digits, and how to add a day, a time or a date'],
];

const WORDS = [
  ['MENU', 'Every word'],
  ['STATUS', 'Where you are now (same as 9)'],
  ['HISTORY', 'The latest entries, to remove one'],
  ['LOCATION', 'Show or change the place'],
  ['CUSTOMS', 'Show or change a custom'],
  ['REMINDERS', 'This phone’s reminders'],
  ['PHONES', 'The phones on the account'],
  ['ADD', 'A code for another phone to join'],
  ['CALENDAR', 'The calendar link'],
  ['WEB', 'A one-time sign-in link'],
  ['SETUP', 'The first questions again'],
  ['DELETE ACCOUNT', 'Deletes the account, after asking'],
];

const CARRIER = [
  ['STOP', 'Stops all texts to this phone'],
  ['START', 'Receive texts again'],
  ['HELP', 'Where to get help'],
];

/** The digit rows from the server's list, or null. */
function digitsFromServer() {
  const list = S.sms && Array.isArray(S.sms.commandList) ? S.sms.commandList : null;
  if (!list || !list.every(x => x && typeof x.text === 'string' && typeof x.meaning === 'string')) return null;
  const rows = list.filter(x => /^[0-9?]$/.test(x.text)).map(x => [x.text, x.meaning]);
  return rows.length ? rows : null;
}

const DIGITS_NOTE = 'After 1, 3 or 5 you may add day, night, yesterday day, yesterday night, or a time such as 9pm. A date also works: 1 11/22 night, 2 11/26.';

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
  const digits = digitsFromServer() || DIGITS;
  const note = typeof sms.commandNote === 'string' && sms.commandNote ? sms.commandNote : DIGITS_NOTE;
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
      group({ title: 'Record with a digit', id: 'txt-digits', footer: note }, blockRow(commandTable('cmd-digits', 'Digits', digits))),
      group({ title: 'Words', id: 'txt-words', footer: 'Send a word alone to see its options.' }, blockRow(commandTable('cmd-words', 'Words', WORDS, true))),
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
