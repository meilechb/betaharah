/* Settings: recording by text message (the commands as a table, the site's number). */
import { card, h, pretty } from '../../lib.js';
import { S } from '../../store.js';

/**
 * S.sms.commands is one sentence from the server, like
 * "1 flow began, 2 hefsek done, ... 0 undo. After 1/3/5 you may add: day, night, ...".
 * It is split into rows where it has that shape, and shown as it is otherwise.
 */
function parse(text) {
  const at = text.indexOf('. ');
  const first = at > 0 ? text.slice(0, at) : text;
  const rest = at > 0 ? text.slice(at + 2) : '';
  const rows = first.split(', ').map(part => /^(\S+) (.+)$/.exec(part.trim()));
  if (rows.some(r => !r)) return null;
  return { rows: rows.map(r => [r[1], r[2]]), note: rest };
}

export function textingCard() {
  const sms = S.sms;
  if (!sms.ready) {
    return card({ title: 'Recording by text', icon: 'message' }, h('p', { class: 'help' }, 'Text messaging is not available on this site yet. Everything can be recorded here on the website.'));
  }
  const parsed = parse(sms.commands || '');
  return card(
    { title: 'Recording by text', icon: 'message', className: 'texting-card' },
    h('p', {}, 'Send a text to ', h('strong', { class: 'nowrap' }, pretty(sms.number)), ' from a phone on this account that may record by text.'),
    parsed
      ? h(
          'table',
          { class: 'commands' },
          h('caption', { class: 'visually-hidden' }, 'Text commands'),
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Text'), h('th', { scope: 'col' }, 'What it does'))),
          h(
            'tbody',
            {},
            parsed.rows.map(([code, meaning]) => h('tr', {}, h('td', {}, h('kbd', {}, code)), h('td', {}, meaning))),
            h('tr', {}, h('td', {}, h('kbd', {}, '?')), h('td', {}, 'the list of commands')),
            h('tr', {}, h('td', {}, h('kbd', {}, 'STOP')), h('td', {}, 'stop all texts to this phone')),
            h('tr', {}, h('td', {}, h('kbd', {}, 'START')), h('td', {}, 'receive texts again')),
          ),
        )
      : h('p', {}, sms.commands),
    parsed && parsed.note ? h('p', { class: 'help' }, parsed.note) : null,
    h('p', { class: 'small muted' }, (sms.simulated ? 'Texts simulated for this account this month: ' : 'Texts sent to this account this month: ') + sms.usedThisMonth + ' of at most ' + sms.monthlyLimit + '.'),
  );
}
