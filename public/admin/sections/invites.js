/* Invitations: for one phone number (before texting works), and sign-up links (while sign-up is by invitation). */
import { alert, button, card, cardSection, confirmDialog, copyField, h, list, listRow, radioGroup, setFieldError, tag, textField } from '/app/lib.js';
import { adopt, call, date, draft, num, render, run, S, saved } from '../state.js';

let numberError = '';

function create(btn) {
  const i = draft.invite;
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

function openList() {
  if (S.invites.length === 0) return h('p', { class: 'muted' }, 'No open invitations.');
  return list(
    S.invites.map(inv =>
      listRow({
        title: (inv.kind === 'setup' ? 'For one number' : 'Sign-up link') + (inv.note ? ': ' + inv.note : ''),
        meta: 'Used ' + num(inv.uses) + ' of ' + num(inv.maxUses) + ' · made ' + date(inv.createdAt) + ' · expires ' + date(inv.expiresAt),
        body: h('div', { class: 'tags' }, tag(inv.kind === 'setup' ? 'password, no code' : 'texted code', 'info')),
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

export function invitesSection() {
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
        { value: 'setup', label: 'For one phone number', help: 'The person sets up the account with that number and a password, without a texted code. Use this before texting works, or for someone whose texts do not arrive.' },
        { value: 'signup', label: 'A sign-up link', help: 'Lets people sign up with a texted code while sign-up is "Only people with an invitation link". It can be used by several people. It needs texting to work.' },
      ],
      onchange: v => {
        i.kind = v;
        numberError = '';
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
      : h('label', { class: 'row' }, h('span', {}, 'How many people may use it'), h('input', { type: 'number', id: 'iuses', min: 1, max: 100, step: 1, value: i.maxUses, oninput: e => (i.maxUses = Math.min(100, Math.max(1, Number(e.target.value) || 1))) })),
    h('label', { class: 'row' }, h('span', {}, 'Days until it expires (1 to 90)'), days),
    textField({ id: 'inote', label: 'Note for yourself (optional)', maxlength: 80, value: i.note, help: 'For example "cousins". Do not write a phone number or a name: notes are not encrypted.', oninput: e => (i.note = e.target.value) }),
    h('div', { class: 'actions' }, button({ label: 'Create invitation', variant: 'primary', type: 'submit' })),
  );
  return card(
    { title: 'Invitations', icon: 'link', intro: 'An invitation is a link you send to someone yourself, by email or message. The site does not send it.' },
    S.config.signup === 'open' ? alert({ kind: 'info' }, 'Sign-up is open to anyone, so sign-up links are not needed now. Invitations for one phone number still work.') : null,
    form,
    i.link
      ? alert(
          { kind: 'ok', title: 'Invitation created' },
          h('p', {}, (i.linkKind === 'setup' ? 'Send this link to the person. They open it, enter the same number and choose a password.' : 'Send this link to the people you invite.') + ' It is shown only now; only a fingerprint of it is kept.'),
          h('div', { id: 'invite-link', tabindex: '-1' }, copyField({ value: i.link, label: 'Copy link', copiedMessage: 'The link was copied.' })),
        )
      : null,
    cardSection({ title: 'Open invitations' }, openList()),
  );
}
