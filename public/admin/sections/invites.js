/* Invitations: for one phone number (before texting works), and sign-up links (while sign-up is by invitation). */
import { alert, button, card, cardSection, confirmDialog, copyField, h, list, listRow, pretty, radioGroup, tag, textField } from '/app/lib.js';
import { adopt, call, date, draft, num, render, run, S, saved } from '../state.js';

let numberError = '';

let wordError = '';

function create(btn) {
  const i = draft.invite;
  if (i.kind === 'word') return createWord(btn);
  if (i.kind === 'setup' && i.number.replace(/\D/g, '').length < 10) {
    numberError = 'Type the person’s mobile number, with the area code.';
    render();
    const el = document.getElementById('inum');
    if (el) el.focus();
    return;
  }
  const body = i.kind === 'setup' ? { kind: 'setup', number: i.number, note: i.note, days: i.days } : { kind: 'signup', note: i.note, maxUses: i.maxUses, days: i.days };
  run(
    () => call('POST', '/api/admin/invites', body),
    r => {
      adopt(r.state);
      i.link = r.link;
      i.linkKind = i.kind;
      i.number = '';
      i.note = '';
      numberError = '';
      render();
      const el = document.getElementById('invite-link');
      if (el) el.focus();
    },
    btn,
    err => {
      if (err.status === 400 && i.kind === 'setup') {
        numberError = err.message;
        render();
        const el = document.getElementById('inum');
        if (el) el.focus();
        return true;
      }
      return false;
    },
  );
}

function createWord(btn) {
  const i = draft.invite;
  const word = (i.word || '').trim();
  if (!/^(?=.*[A-Za-z])[A-Za-z0-9]{6,24}$/.test(word)) {
    wordError = 'Use 6 to 24 letters and digits, with at least one letter, and no spaces. For example SPRING26.';
    render();
    const el = document.getElementById('iword');
    if (el) el.focus();
    return;
  }
  run(
    () => call('POST', '/api/admin/invite-words', { word, days: i.days, maxUses: i.maxUses, note: i.note }),
    r => {
      adopt(r.state);
      i.link = r.word;
      i.linkKind = 'word';
      i.word = '';
      i.note = '';
      wordError = '';
      render();
      const el = document.getElementById('invite-link');
      if (el) el.focus();
    },
    btn,
    err => {
      if (err.status === 400) {
        wordError = err.message.replace(/^word: /, 'The word must have ');
        render();
        return true;
      }
      return false;
    },
  );
}

function openList() {
  if (S.invites.length === 0) return h('p', { class: 'muted' }, 'No open invitations.');
  return list(
    S.invites.map(inv =>
      listRow({
        title: (inv.kind === 'setup' ? 'For one number' : 'Sign-up link or word') + (inv.note ? ': ' + inv.note : ''),
        meta: 'Used ' + num(inv.uses) + ' of ' + num(inv.maxUses) + ' · made ' + date(inv.createdAt) + ' · expires ' + date(inv.expiresAt),
        body: h('div', { class: 'tags' }, tag(inv.kind === 'setup' ? 'password, no code' : 'website or JOIN by text', 'info')),
        trail: button({
          label: 'Cancel',
          variant: 'danger',
          size: 'sm',
          attrs: { 'aria-label': 'Cancel this invitation' },
          onclick: async e => {
            const btn = e.currentTarget;
            const ok = await confirmDialog({ title: 'Cancel this invitation?', body: 'The link stops working at once. Accounts already made with it are not affected.', confirmLabel: 'Cancel the invitation', cancelLabel: 'Keep it', danger: true });
            if (ok) run(() => call('DELETE', '/api/admin/invites/' + encodeURIComponent(inv.id)), saved('The invitation was cancelled.'), btn);
          },
        }),
      }),
    ),
  );
}

export function invitesPage() {
  const i = draft.invite;
  const days = h('input', { type: 'number', id: 'idays', min: 1, max: 90, step: 1, value: i.days, oninput: e => (i.days = Number(e.target.value) || 14) });
  const form = h(
    'form',
    {
      class: 'invite-form',
      novalidate: true,
      onsubmit: e => {
        e.preventDefault();
        create(e.submitter);
      },
    },
    radioGroup({
      legend: 'Which kind',
      name: 'ikind',
      value: i.kind,
      options: [
        { value: 'signup', label: 'A link for sign-up on the website', help: 'People open the link and sign up on the website with a texted code. For when sign-up is by invitation only. It can be used by several people. It needs texting to work.' },
        { value: 'word', label: 'A word for sign-up by text', help: 'People text JOIN and the word (for example JOIN SPRING26) to the number, and set up their account by text. For when sign-up is by invitation only. Easier to pass on by voice than a link. It needs texting to work.' },
        { value: 'setup', label: 'An account for one number, with a password', help: 'The person sets up the account on the website with that number and a password, without a texted code. Use this before texting works, or for someone whose texts do not arrive.' },
      ],
      onchange: v => {
        i.kind = v;
        numberError = '';
        wordError = '';
        render();
      },
    }),
    i.kind === 'setup'
      ? textField({
          id: 'inum',
          label: 'The person’s mobile number',
          type: 'tel',
          autocomplete: 'off',
          placeholder: '(732) 444-0123',
          value: i.number,
          error: numberError,
          help: 'The invitation works only with this number. The number is not stored readably.',
          oninput: e => {
            i.number = e.target.value;
            numberError = '';
          },
        })
      : i.kind === 'word'
        ? textField({
            id: 'iword',
            label: 'The word',
            autocomplete: 'off',
            autocapitalize: 'characters',
            spellcheck: 'false',
            maxlength: 24,
            placeholder: 'SPRING26',
            value: i.word || '',
            error: wordError,
            help: '6 to 24 letters and digits. Capitals or not does not matter. Choose something hard to guess: anyone who has the word can sign up.',
            oninput: e => {
              i.word = e.target.value;
              wordError = '';
            },
          })
        : null,
    i.kind === 'setup'
      ? null
      : h('label', { class: 'row' }, h('span', {}, 'How many people may use it'), h('input', { type: 'number', id: 'iuses', min: 1, max: 100, step: 1, value: i.maxUses, oninput: e => (i.maxUses = Math.min(100, Math.max(1, Number(e.target.value) || 1))) })),
    h('label', { class: 'row' }, h('span', {}, 'Days until it expires (1 to 90)'), days),
    textField({ id: 'inote', label: 'Note for yourself (optional)', maxlength: 80, value: i.note, help: 'For example "cousins". Do not write a phone number or a name: notes are not encrypted.', oninput: e => (i.note = e.target.value) }),
    h('div', { class: 'actions' }, button({ label: 'Create invitation', variant: 'primary', type: 'submit' })),
  );
  return [
    i.link
      ? alert(
          { kind: 'ok', title: 'Invitation created' },
          h(
            'p',
            {},
            (i.linkKind === 'setup'
              ? 'Send this link to the person. They open it, enter the same number and choose a password.'
              : i.linkKind === 'word'
                ? 'Tell the people you invite to text JOIN ' + i.link + ' to ' + (S.textingNumber ? pretty(S.textingNumber) : 'the number') + '.'
                : 'Send this link to the people you invite.') + ' It is shown only now; only a fingerprint of it is kept.',
          ),
          h('div', { id: 'invite-link', tabindex: '-1' }, copyField({ value: i.linkKind === 'word' ? 'JOIN ' + i.link : i.link, label: 'Copy', copiedMessage: 'Copied.' })),
        )
      : null,
    h(
      'div',
      { class: 'grid-2 invites-grid' },
      card(
    { title: 'New invitation', icon: 'plus', intro: 'You pass the link or word on yourself, by email, message or voice. The site does not send it.' },
    S.config.signup === 'open' ? alert({ kind: 'info' }, 'Sign-up is open to anyone, so sign-up links and words are not needed now. Accounts for one number still work.') : null,
    S.config.signup === 'closed' ? alert({ kind: 'info' }, 'Sign-up is closed: links and words do not work. Accounts for one number still work.') : null,
    form,
      ),
      card({ title: 'Open invitations', icon: 'list' }, openList()),
    ),
  ];
}
