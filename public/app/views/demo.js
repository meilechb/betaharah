/*
 * The operator's test account (S.demo): a banner, and "Try a text", a small
 * chat that sends a text as if from this phone (POST /api/demo/text) and
 * shows the reply the real system would send. Nothing is sent to a phone.
 */
import { api, button, card, h, icon, pretty } from '../lib.js';
import { S, adopt, render, t } from '../store.js';
import { attempt, clearOnRedraw, refresh, region } from './shared.js';

/** What is typed in the box, and the error of the last try. */
let draftText = '';
let error = '';
/** Incoming messages (by time) to which the real system sends no reply. */
const noReply = new Set();

/** The quiet banner shown on every tab of the test account. */
export function demoBanner() {
  if (!S.demo) return null;
  return h('div', { class: 'demo-banner', role: 'note' }, icon('info', { size: 'sm' }), h('span', {}, 'This is the test account. Nothing here is sent to a real phone.'));
}

const QUICK = [
  ['1', '{flow} began'],
  ['2', '{hefsek} done'],
  ['3', 'count broken'],
  ['4', '{immersion}'],
  ['5', '{stain}'],
  ['9', 'status'],
  ['0', 'undo'],
  ['?', 'commands'],
  ['STOP', 'stop texts'],
  ['START', 'texts again'],
];

function send(text, btn) {
  const value = (text || '').trim();
  if (!value) {
    error = 'Type a text to send.';
    refresh('demo-chat');
    document.getElementById('demo-text')?.focus();
    return;
  }
  error = '';
  attempt(() => api('POST', '/api/demo/text', { text: value }), {
    button: btn,
    done: r => {
      adopt(r.state);
      if (r.reply === null || r.reply === undefined) {
        const inbound = (S.messages || []).find(m => m.direction === 'in');
        if (inbound) noReply.add(inbound.at);
      }
      draftText = '';
      clearOnRedraw('demo-text');
      render();
    },
    fail: message => {
      error = message;
      refresh('demo-chat');
    },
  });
}

/** The conversation, oldest first, as bubbles. opts.limit: how many of the newest messages. */
export function thread(messages, opts) {
  const o = opts || {};
  const list = [...messages].slice(0, o.limit || messages.length).reverse();
  const phones = new Set(list.map(m => m.phone));
  const time = at => {
    try {
      return new Date(at).toLocaleString('en-US', { timeZone: S.timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return new Date(at).toLocaleString('en-US');
    }
  };
  const nodes = [];
  let lastDay = '';
  for (const m of list) {
    const day = time(m.at).split(',')[0];
    if (day !== lastDay) {
      nodes.push(h('li', { class: 'day-sep' }, h('span', {}, day)));
      lastDay = day;
    }
    const mine = m.direction === 'in';
    const statusTag =
      m.status === 'simulated'
        ? h('span', { class: 'tag info' }, 'simulated')
        : m.status === 'not sent'
          ? h('span', { class: 'tag bad' }, 'not sent')
          : m.status === 'sent'
            ? h('span', { class: 'tag ok' }, 'sent')
            : m.status
              ? h('span', { class: 'tag' }, m.status)
              : null;
    nodes.push(
      h(
        'li',
        { class: 'msg ' + (mine ? 'in' : 'out') + (m.status === 'not sent' ? ' failed' : '') },
        h('span', { class: 'visually-hidden' }, mine ? 'From the phone ending ' + m.phone + ': ' : 'To the phone ending ' + m.phone + ': '),
        h('div', { class: 'bubble ' + (mine ? 'out' : 'in') }, m.body),
        h('div', { class: 'msg-meta' }, phones.size > 1 || o.showPhone ? (mine ? 'From …' : 'To …') + m.phone + ' · ' : '', time(m.at).split(', ').slice(1).join(', '), ' ', statusTag),
      ),
    );
    if (mine && noReply.has(m.at)) nodes.push(h('li', { class: 'msg note' }, h('p', {}, 'The real system sends no reply to this message.')));
  }
  return h('ol', { class: 'thread', id: o.id || null, 'aria-label': o.label || 'Text messages' }, nodes);
}

/** "Try a text": the chat box. */
export function tryTextCard() {
  if (!S.demo) return null;
  return card(
    { title: 'Try a text', icon: 'message', className: 'demo-card' },
    h('p', { class: 'help' }, 'Type what you would text to ' + pretty(S.sms.number) + ' from ' + pretty(S.account.number) + '. It is handled exactly as a real text, and the reply is shown here instead of being sent.'),
    region('demo-chat', () => {
      const recent = (S.messages || []).slice(0, 8);
      // The newest text is at the bottom: show it.
      setTimeout(() => {
        const log = document.getElementById('demo-thread');
        if (log) log.scrollTop = log.scrollHeight;
      }, 0);
      return h(
        'div',
        { class: 'chat' },
        recent.length ? thread(recent, { id: 'demo-thread', label: 'The latest texts' }) : h('p', { class: 'muted chat-empty' }, 'No texts yet. Try 9 for the status.'),
        h(
          'form',
          {
            class: 'chat-form',
            novalidate: true,
            onsubmit: e => {
              e.preventDefault();
              send(draftText, e.submitter || document.getElementById('demo-send'));
            },
          },
          h('label', { for: 'demo-text', class: 'visually-hidden' }, 'Your text'),
          h('input', {
            id: 'demo-text',
            type: 'text',
            autocomplete: 'off',
            maxlength: 320,
            placeholder: 'For example: 2 yesterday',
            value: draftText,
            'aria-invalid': error ? 'true' : null,
            'aria-describedby': error ? 'demo-error' : null,
            oninput: e => {
              draftText = e.target.value;
            },
          }),
          button({ label: 'Send', variant: 'primary', type: 'submit', icon: 'message', attrs: { id: 'demo-send' } }),
        ),
        error ? h('div', { class: 'error', id: 'demo-error', role: 'alert' }, icon('alert', { size: 'sm' }), h('span', {}, error)) : null,
        h(
          'div',
          { class: 'quick', role: 'group', 'aria-label': 'Send a common text' },
          QUICK.map(([text, meaning]) =>
            h(
              'button',
              {
                type: 'button',
                class: 'quick-btn',
                id: 'demo-q-' + text.replace(/\W/g, 'q'),
                'aria-label': 'Send ' + text + ' ' + t(meaning),
                onclick: e => send(text, e.currentTarget),
              },
              h('strong', {}, text),
              h('span', {}, t(meaning)),
            ),
          ),
        ),
      );
    }),
  );
}
