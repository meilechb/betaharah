/*
 * The Log tab: the entries recorded, grouped by period, and the text
 * messages sent and received, as a conversation.
 */
import { api, button, card, confirmDialog, emptyState, h, icon } from '../lib.js';
import { S, t, when } from '../store.js';
import { thread, tryTextCard } from './demo.js';
import { entryMark } from './marks.js';
import { recordCard } from './record.js';
import { refresh, region, saveChange, saveStatus } from './shared.js';

const sourceLabel = s => (s === 'dashboard' ? 'Recorded on the website' : s === 'sms' ? 'Recorded by text message' : s);

/** The entry whose options are open, and how many messages are shown. */
let openEntry = null;
let messageLimit = 30;

export function viewLog() {
  return h('div', { class: 'cols' }, h('div', {}, recordCard({ past: true }), entriesCard()), h('div', {}, messagesCard()));
}

const CIVIL = /([A-Z][a-z]{2} \d{1,2}, \d{4})/;

/** Periods, newest first; the entries of each in the order they happened. */
function periods() {
  const groups = [];
  let current = null;
  for (const e of [...S.entries].reverse()) {
    const starts = e.kind === 'flow' || e.kind === 'stain';
    if (starts && (!current || current.closed || !current.started)) {
      current = { started: true, closed: false, entries: [] };
      groups.push(current);
    } else if (!current) {
      current = { started: false, closed: false, entries: [] };
      groups.push(current);
    }
    current.entries.push(e);
    if (e.kind === 'mikvah') current.closed = true;
  }
  return groups.reverse();
}

function entryRow(e) {
  const at = e.text.indexOf(': ');
  const kindText = at > 0 ? e.text.slice(0, at) : e.text;
  const rest = at > 0 ? e.text.slice(at + 2) : '';
  const open = openEntry === e.id;
  return h(
    'li',
    { class: 'entry' + (open ? ' open' : '') },
    entryMark(e.kind),
    h(
      'div',
      { class: 'entry-main' },
      // The kind and the date on one line (a <b>, not the <strong> the stylesheet sets on a line of its own).
      h('div', { class: 'title' }, h('b', {}, kindText), rest ? [' · ', h('span', { class: 'entry-date' }, rest)] : null),
      e.note ? h('p', { class: 'entry-note' }, icon('message', { size: 'sm' }), h('span', {}, e.note)) : null,
      open
        ? h(
            'div',
            { class: 'entry-options', id: 'entry-options-' + e.id },
            h('p', { class: 'help when' }, sourceLabel(e.source) + ' · ' + when(e.createdAt)),
            button({
              label: 'Remove this entry',
              variant: 'danger',
              size: 'sm',
              icon: 'trash',
              attrs: { id: 'entry-remove-' + e.id },
              onclick: async ev => {
                const btn = ev.currentTarget;
                if (!(await confirmDialog({ title: 'Remove this entry?', body: e.text, confirmLabel: 'Remove entry', danger: true }))) return;
                openEntry = null;
                saveChange('entries', () => api('DELETE', '/api/entries/' + encodeURIComponent(e.id)), { message: 'Removed' }).then(ok => {
                  if (!ok && btn.isConnected) btn.focus();
                });
              },
            }),
          )
        : null,
    ),
    h(
      'div',
      { class: 'trail' },
      button({
        label: (open ? 'Close the options for ' : 'Options for ') + e.text,
        iconOnly: true,
        size: 'sm',
        variant: 'link',
        icon: open ? 'chevron-up' : 'chevron-down',
        attrs: { id: 'entry-more-' + e.id, 'aria-expanded': String(open), 'aria-controls': open ? 'entry-options-' + e.id : null },
        onclick: () => {
          openEntry = open ? null : e.id;
          refresh('entries');
        },
      }),
    ),
  );
}

function entriesCard() {
  return card(
    { title: 'Entries', icon: 'list', headerAction: saveStatus('entries') },
    region('entries', () => {
      if (S.entries.length === 0) return h('div', {}, emptyState({ icon: 'list', title: 'Nothing recorded yet.', body: t('Record a {flow} on Today, or add a past entry above.') }));
      const groups = periods();
      return h(
        'div',
        {},
        S.entryCount > S.entries.length ? h('p', { class: 'muted small' }, 'Showing the latest ' + S.entries.length + ' of ' + S.entryCount + '.') : null,
        groups.map((g, i) => {
          const first = g.entries[0];
          const m = CIVIL.exec(first.text);
          const title = g.started ? 'Began ' + (m ? m[1] : '') : 'Other entries';
          return h(
            'section',
            { class: 'period' },
            h('h3', {}, title, i === 0 && g.started && !g.closed ? h('span', { class: 'tag info' }, 'Current') : null),
            h('ul', { class: 'list entries' }, g.entries.map(entryRow)),
          );
        }),
      );
    }),
  );
}

function messagesCard() {
  const msgs = S.messages || [];
  return h(
    'div',
    {},
    S.demo ? tryTextCard() : null,
    card(
      { title: 'Text messages', icon: 'message', className: 'messages-card' },
      region('messages', () =>
        msgs.length === 0
          ? h('div', {}, emptyState({ icon: 'message', title: 'No text messages yet.', body: S.sms.ready ? null : 'Text messaging is not available on this site yet.' }))
          : h(
              'div',
              {},
              thread(msgs, { limit: messageLimit, label: 'Text messages, oldest first', showPhone: true }),
              msgs.length > messageLimit
                ? button({
                    label: 'Show older messages',
                    variant: 'link',
                    attrs: { id: 'msg-more' },
                    onclick: () => {
                      messageLimit += 30;
                      refresh('messages');
                    },
                  })
                : null,
            ),
      ),
    ),
  );
}
