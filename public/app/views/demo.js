/*
 * The operator's test account (S.demo): a banner, and "Try a text", a small
 * chat that sends a text as if from this phone (POST /api/demo/text) and
 * shows the reply the real system would send. Nothing is sent to a phone.
 */
import { api, button, card, h, icon, pretty } from '../lib.js';
import { S, adopt, render, signOutLocally, t } from '../store.js';
import { attempt, clearOnRedraw, refresh, region } from './shared.js';

/** What is typed in the box, and the error of the last try. */
let draftText = '';
let error = '';
/** The replies to the last text sent from the box, as the server returned them ({ text, suggestions? }). */
let lastReplies = [];
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
  ['MENU', 'every word'],
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
      const replies = Array.isArray(r.replies) ? r.replies : r.reply ? [{ text: r.reply }] : [];
      if (r.signedOut || !r.state) {
        // DELETE ACCOUNT and YES, or this phone left the account: nothing is signed in any more.
        // The page is loaded afresh, so that nothing of the account stays in memory or on screen.
        signOutLocally();
        location.replace('/app/?note=' + (replies.some(x => /deleted/i.test(x.text)) ? 'deleted' : 'left'));
        return;
      }
      adopt(r.state);
      lastReplies = replies;
      if (replies.length === 0) {
        const inbound = (S.messages || []).find(m => m.direction === 'in');
        if (inbound) noReply.add(inbound.at);
      }
      draftText = '';
      clearOnRedraw('demo-text');
      render();
      document.getElementById('demo-text')?.focus({ preventScroll: true });
    },
    fail: message => {
      error = message;
      refresh('demo-chat');
      document.getElementById('demo-text')?.focus({ preventScroll: true });
    },
  });
}

/** A link in a reply (a sign-in link from WEB, a calendar link): shown so that it can be opened or copied. */
function linksIn(text) {
  return (text.match(/https?:\/\/\S+/g) || []).map(u => u.replace(/[.,]$/, ''));
}

/** What the last reply offers: its tap-to-reply buttons (as an RCS phone shows them) and any link in it. */
function lastReplyExtras() {
  const chips = lastReplies.flatMap(r => r.suggestions || []);
  const links = lastReplies.flatMap(r => linksIn(r.text));
  if (chips.length === 0 && links.length === 0) return null;
  return h(
    'div',
    { class: 'reply-extras' },
    chips.length
      ? h(
          'div',
          { class: 'quick chips', role: 'group', 'aria-label': 'Buttons under the last reply' },
          h('p', { class: 'small muted chips-title' }, 'Buttons under the last reply, as a phone with RCS shows them:'),
          chips.map((c, k) =>
            h(
              'button',
              { type: 'button', class: 'quick-btn chip', id: 'demo-chip-' + k, 'aria-label': 'Send ' + c.send, onclick: e => send(c.send, e.currentTarget) },
              h('span', {}, c.label),
            ),
          ),
        )
      : null,
    links.map(u =>
      /\/app\/\?k=/.test(u)
        ? h('p', { class: 'small demo-link' }, icon('link', { size: 'sm' }), h('span', {}, 'The sign-in link in the reply works once, within 10 minutes. To try it, copy it, sign out, and open it: ', h('code', { class: 'copy' }, u)))
        : h('p', { class: 'small demo-link' }, icon('link', { size: 'sm' }), h('span', {}, 'The link in the reply: ', h('code', { class: 'copy' }, u))),
    ),
  );
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
    h('p', { class: 'help' }, 'Type what you would text to ' + pretty(S.sms.number) + (S.account.number ? ' from ' + pretty(S.account.number) : '') + '. It is handled exactly as a real text, and the reply is shown here instead of being sent.'),
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
        recent.length ? thread(recent, { id: 'demo-thread', label: 'The latest texts' }) : h('p', { class: 'muted chat-empty' }, 'No texts yet. Try 9 for the status, or MENU.'),
        lastReplyExtras(),
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
