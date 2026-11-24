/*
 * Settings: Calendar. The two ways to see the dates in a calendar app
 * (Google Calendar, when this site offers it; a subscription link), how the
 * events look, the calendar's name; "More" for replacing or removing and for
 * the length of history.
 */
import { alert, api, button, confirmDialog, copyField, h, linkButton, toast } from '../../lib.js';
import { S, t, when } from '../../store.js';
import { refresh, region } from '../shared.js';
import { blockRow, choiceCards, errorText, group, infoRow, more, save, saveApp, tn } from './ui.js';

let nameDraft = null;
let nameError = '';
let historyError = '';

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** Asks first, then saves; the result is shown in the section's header. */
const confirmThen = (dialog, request, message) => async () => {
  if (!(await confirmDialog(dialog))) return;
  save('calendar', request, { message });
};

function googleError() {
  const a = S.alerts.find(x => x.text.startsWith('Google Calendar:'));
  return a ? a.text.replace(/^Google Calendar:\s*/, '') : S.calendar.sync.lastError || null;
}

function googleGroup() {
  const cal = S.calendar;
  const g = cal.google;
  if (!g.available) return null;
  const sync = cal.sync;
  const err = g.connected ? googleError() : null;
  return group(
    { title: 'Google Calendar', id: 'cal-google' },
    infoRow({
      icon: 'calendar',
      leadKind: g.connected ? (err ? 'warn' : 'ok') : null,
      title: g.connected ? 'Connected' : 'Not connected',
      summary: g.connected
        ? 'The calendar “' + S.app.calendar.name + '” in your Google account is kept up to date.' + (sync.lastOkAt ? ' Last updated ' + when(sync.lastOkAt) + (sync.dirty ? '; changes waiting.' : '.') : '')
        : 'The site creates one calendar in your Google account and keeps it up to date. It can see and change only that calendar.',
    }),
    err ? blockRow(alert({ kind: 'warn', title: 'The last update failed' }, err)) : null,
    blockRow(
      h(
        'div',
        { class: 'actions' },
        g.connected
          ? button({
              label: 'Update now',
              icon: 'refresh',
              attrs: { id: 'google-sync' },
              onclick: () =>
                save('calendar', () => api('POST', '/api/sync'), {
                  done: r => {
                    const o = r.outcome;
                    if (o.status !== 'ok') toast(o.message || 'The calendar could not be updated.', true);
                    else toast('Calendar updated: ' + o.result.inserted + ' added, ' + o.result.updated + ' changed, ' + o.result.deleted + ' removed' + (o.result.remaining ? ', ' + o.result.remaining + ' still to do' : '') + '.');
                  },
                }),
            })
          : linkButton({ href: '/api/google/start', label: 'Connect Google Calendar', variant: 'primary', icon: 'calendar', attrs: { id: 'google-connect' } }),
      ),
      g.connected ? h('p', { class: 'help' }, 'To share it with your spouse, share the calendar from Google Calendar.') : null,
    ),
  );
}

function linkGroup() {
  const cal = S.calendar;
  if (!cal.link) {
    return group(
      { title: 'Subscription link', id: 'cal-link' },
      infoRow({ icon: 'link', title: 'No link yet', summary: 'A private address that Apple Calendar, Outlook or Google Calendar can subscribe to. No account needs to be connected.' }),
      blockRow(h('div', { class: 'actions' }, button({ label: 'Create a subscription link', icon: 'link', variant: S.calendar.google.connected ? 'secondary' : 'primary', attrs: { id: 'link-create' }, onclick: () => save('calendar', () => api('POST', '/api/calendar-link'), { message: 'The link is ready' }) }))),
    );
  }
  return group(
    { title: 'Subscription link', id: 'cal-link', footer: 'Anyone who has the address can read the calendar, so share it only with your spouse. Calendar apps look for changes on their own schedule; Google says it can take up to 12 hours.' },
    infoRow({ icon: 'link', leadKind: 'ok', title: 'The link is on', summary: 'Add it once in your calendar app; it stays up to date from then on.' }),
    blockRow(
      copyField({ value: cal.link, label: 'Copy link', copiedMessage: 'The link is copied.' }),
      h('div', { class: 'actions' }, linkButton({ href: cal.link.replace(/^https?:/, 'webcal:'), label: 'Open in my calendar app', icon: 'calendar', variant: 'primary', attrs: { id: 'link-open' } })),
      h('p', { class: 'help' }, 'Or add the address in your calendar app as a subscribed calendar. In Google Calendar: Other calendars, then +, then From URL.'),
    ),
  );
}

function preview(style) {
  const rows =
    style === 'words'
      ? [
          ['hefsek', cap(t('{hefsek}')) + ' (by 4:37 PM)'],
          ['clean', cap(t('{clean_days}')) + ': day 1'],
          ['mikvah', cap(t('{mikvah_night}')) + ' (after 5:18 PM)'],
        ]
      : [
          ['hefsek', 'H < 4:37 PM'],
          ['clean', '1/7'],
          ['mikvah', 'M > 5:18 PM'],
        ];
  return h('span', { class: 'st-preview', 'aria-hidden': 'true' }, rows.map(([k, text]) => h('span', { class: 'chip ' + k }, text)));
}

function nameField() {
  return region('cal-name-wrap', () =>
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'cal-name' }, 'Name of the calendar'),
      h('input', {
        id: 'cal-name',
        type: 'text',
        class: 'wide',
        maxlength: 40,
        value: nameDraft !== null ? nameDraft : S.app.calendar.name,
        'aria-describedby': 'cal-name-help' + (nameError ? ' cal-name-error' : ''),
        'aria-invalid': nameError ? 'true' : null,
        oninput: e => (nameDraft = e.target.value),
        onchange: e => {
          const v = e.target.value.trim();
          if (!v) {
            nameError = 'Give the calendar a name.';
            refresh('cal-name-wrap');
            return;
          }
          nameError = '';
          nameDraft = null;
          if (v !== S.app.calendar.name) saveApp('calendar', a => (a.calendar.name = v));
          else refresh('cal-name-wrap');
        },
      }),
      h('p', { class: 'help', id: 'cal-name-help' }, 'Used when the calendar is first created. Afterwards, rename it in your calendar app. Saved when you leave the box.'),
      errorText('cal-name-error', nameError),
    ),
  );
}

function historyField() {
  return region('cal-history-wrap', () =>
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'cal-history' }, 'Days of history kept in Google Calendar'),
      h('input', {
        id: 'cal-history',
        type: 'number',
        min: 30,
        max: 800,
        step: 1,
        value: S.app.calendar.historyDays,
        'aria-invalid': historyError ? 'true' : null,
        'aria-describedby': 'cal-history-help' + (historyError ? ' cal-history-error' : ''),
        onchange: e => {
          const v = Number(e.target.value);
          if (!Number.isInteger(v) || v < 30 || v > 800) {
            historyError = 'A whole number from 30 to 800.';
            refresh('cal-history-wrap');
            return;
          }
          historyError = '';
          saveApp('calendar', a => (a.calendar.historyDays = v));
        },
      }),
      h('p', { class: 'help', id: 'cal-history-help' }, 'From 30 to 800. Older events are left as they are.'),
      errorText('cal-history-error', historyError),
    ),
  );
}

function moreGroup() {
  const cal = S.calendar;
  const g = cal.google;
  const linkActions = cal.link
    ? [
        button({
          label: 'Replace link',
          attrs: { id: 'link-replace' },
          onclick: confirmThen({ title: 'Replace the link?', body: 'The old address stops working at once, and calendars subscribed to it stop updating. You then add the new one.', confirmLabel: 'Replace link', danger: true }, () => api('POST', '/api/calendar-link'), 'A new link was made'),
        }),
        button({
          label: 'Remove link',
          variant: 'danger',
          attrs: { id: 'link-remove' },
          onclick: confirmThen({ title: 'Remove the link?', body: 'Calendars subscribed to it stop updating.', confirmLabel: 'Remove link', danger: true }, () => api('DELETE', '/api/calendar-link'), 'The link was removed'),
        }),
      ]
    : null;
  const googleActions =
    g.available && g.connected
      ? [
          linkButton({ href: '/api/google/start', label: 'Connect again', attrs: { id: 'google-again' } }),
          button({
            label: 'Disconnect Google Calendar',
            variant: 'danger',
            attrs: { id: 'google-disconnect' },
            onclick: confirmThen({ title: 'Disconnect Google Calendar?', body: 'The calendar itself stays in your Google account, but it is no longer updated.', confirmLabel: 'Disconnect', danger: true }, () => api('POST', '/api/google/disconnect'), 'Disconnected'),
          }),
        ]
      : null;
  return more(
    { id: 'cal-more', summary: 'More' },
    linkActions ? group({ title: 'Subscription link' }, blockRow(h('p', { class: 'help' }, 'Replacing makes a new address and stops the old one, for example after it was shared by mistake.'), h('div', { class: 'actions' }, linkActions))) : null,
    googleActions ? group({ title: 'Google Calendar' }, blockRow(h('div', { class: 'actions' }, googleActions))) : null,
    g.available ? group({ title: 'History' }, blockRow(historyField())) : null,
    !linkActions && !googleActions && !g.available ? h('p', { class: 'help' }, 'Nothing more to set until a link is created.') : null,
  );
}

function view() {
  const style = S.app.calendar.style;
  return {
    title: 'Calendar',
    parent: '',
    statusKey: 'calendar',
    lead: 'Optional. See your dates in your own calendar app. This page always shows everything in words.',
    body: [
      googleGroup(),
      linkGroup(),
      group(
        { title: 'How events look in the calendar app', id: 'cal-style' },
        blockRow(
          choiceCards({
            name: 'cal-style',
            legend: 'How events look in the calendar app',
            value: style,
            options: [
              { value: 'words', label: 'In words', help: 'Anyone who sees your calendar can read what each event is.', example: preview('words') },
              { value: 'discreet', label: 'Discreet', help: tn('Symbols only: • a start, H {hefsek}, 1/7 to 7/7 {clean_days}, M {mikvah_night}, ◆ {veset_onah}, ◇ {or_zarua}. “?” marks a projected date.'), example: preview('discreet') },
            ],
            onchange: v => saveApp('calendar', a => (a.calendar.style = v)),
          }),
        ),
        blockRow(nameField()),
      ),
      moreGroup(),
    ],
  };
}

export const calendarSection = {
  id: 'calendar',
  title: 'Calendar',
  icon: 'calendar',
  summary: () => {
    const cal = S.calendar;
    const ways = [];
    if (cal.google.connected) ways.push('Google Calendar');
    if (cal.link) ways.push('Subscription link');
    const head = ways.length ? ways.join(' and ') : 'Not in a calendar app';
    return head + ' · ' + (S.app.calendar.style === 'words' ? 'titles in words' : 'discreet titles');
  },
  flag: () => (S.calendar.google.connected && googleError() ? { kind: 'warn', text: 'Google Calendar could not be updated' } : null),
  view,
};
