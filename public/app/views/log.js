/*
 * The Log tab: the entries recorded, and the text messages sent and received.
 * Next owner: the dashboard agent.
 */
import { api, button, card, confirmDialog, emptyState, h, list, listRow } from '../lib.js';
import { S, run, saved, when } from '../store.js';

const sourceLabel = s => (s === 'dashboard' ? 'Recorded on the website' : s === 'sms' ? 'Recorded by text message' : s);

export function viewLog() {
  return h('div', { class: 'cols' }, entriesCard(), messagesCard());
}

function entriesCard() {
  return card(
    { title: 'Entries' },
    S.entryCount > S.entries.length ? h('p', { class: 'muted small' }, 'Showing the latest ' + S.entries.length + ' of ' + S.entryCount + '.') : null,
    S.entries.length === 0
      ? emptyState({ icon: 'list', title: 'Nothing recorded yet.' })
      : list(
          S.entries.map(e =>
            listRow({
              lead: h('span', { class: 'dot ' + (e.kind === 'stain' || e.kind === 'broken' ? 'flow' : e.kind), 'aria-hidden': 'true' }),
              title: e.text,
              meta: sourceLabel(e.source) + ' · ' + when(e.createdAt),
              body: e.note ? h('div', { class: 'small' }, e.note) : null,
              trail: button({
                label: 'Remove',
                variant: 'danger',
                size: 'sm',
                attrs: { 'aria-label': 'Remove ' + e.text },
                onclick: async ev => {
                  const btn = ev.currentTarget;
                  if (!(await confirmDialog({ title: 'Remove this entry?', body: e.text, confirmLabel: 'Remove', danger: true }))) return;
                  run(() => api('DELETE', '/api/entries/' + encodeURIComponent(e.id)), saved('Removed.'), btn);
                },
              }),
            }),
          ),
        ),
  );
}

function messagesCard() {
  return card(
    { title: 'Text messages' },
    S.messages.length === 0
      ? emptyState({ icon: 'message', title: 'None yet.' })
      : list(
          S.messages.map(m =>
            listRow({
              body: [h('div', {}, (m.direction === 'in' ? 'From' : 'To') + ' the phone ending ' + m.phone + ': ', h('span', { class: 'mono' }, m.body)), h('div', { class: 'when' }, when(m.at) + ' · ' + m.status)],
            }),
          ),
        ),
  );
}
