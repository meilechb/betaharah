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
        ? '“' + S.app.calendar.name + '”' + (sync.lastOkAt ? ' · updated ' + when(sync.lastOkAt) + (sync.dirty ? '; changes waiting' : '') : '')
        : 'Adds one calendar to your Google account. The site can change only that calendar.',
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
      g.connected ? h('p', { class: 'help' }, 'To share it, use Google Calendar.') : null,
    ),
  );
}

function linkGroup() {
  const cal = S.calendar;
  if (!cal.link) {
    return group(
      { title: 'Subscription link', id: 'cal-link' },
      infoRow({ icon: 'link', title: 'No link yet', summary: 'A private address for Apple Calendar, Outlook or Google Calendar.' }),
      blockRow(h('div', { class: 'actions' }, button({ label: 'Create a subscription link', icon: 'link', variant: S.calendar.google.connected ? 'secondary' : 'primary', attrs: { id: 'link-create' }, onclick: () => save('calendar', () => api('POST', '/api/calendar-link'), { message: 'The link is ready' }) }))),
    );
  }
  return group(
    { title: 'Subscription link', id: 'cal-link', footer: 'Anyone with the link can read the calendar: share it only with your spouse. Changes can take up to 12 hours to show.' },
    infoRow({ icon: 'link', leadKind: 'ok', title: 'The link is on' }),
    blockRow(
      copyField({ value: cal.link, label: 'Copy link', copiedMessage: 'The link is copied.' }),
      h('div', { class: 'actions' }, linkButton({ href: cal.link.replace(/^https?:/, 'webcal:'), label: 'Open in my calendar app', icon: 'calendar', variant: 'primary', attrs: { id: 'link-open' } })),
      h('p', { class: 'help' }, 'In Google Calendar: Other calendars, +, From URL.'),
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
      h('p', { class: 'help', id: 'cal-name-help' }, 'Used when the calendar is first made.'),
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
      h('p', { class: 'help', id: 'cal-history-help' }, 'From 30 to 800.'),
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
          onclick: confirmThen({ title: 'Replace the link?', body: 'The old address stops working at once, and calendars subscribed to it stop updating.', confirmLabel: 'Replace link', danger: true }, () => api('POST', '/api/calendar-link'), 'A new link was made'),
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
    linkActions ? group({ title: 'Subscription link' }, blockRow(h('p', { class: 'help' }, 'Replace it if it was shared by mistake.'), h('div', { class: 'actions' }, linkActions))) : null,
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
    lead: 'Optional: see your dates in your calendar app.',
    body: [
      googleGroup(),
      linkGroup(),
      group(
        { title: 'Event titles', id: 'cal-style' },
        blockRow(
          choiceCards({
            name: 'cal-style',
            legend: 'Event titles in the calendar app',
            value: style,
            options: [
              { value: 'words', label: 'In words', help: 'Anyone who sees your calendar can read them.', example: preview('words') },
              { value: 'discreet', label: 'Discreet', help: tn('Symbols: • start, H {hefsek}, 1/7–7/7 {clean_days}, M {mikvah_night}, ◆ {veset_onah}, ◇ {or_zarua}, ? projected.'), example: preview('discreet') },
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
    if (!ways.length) return 'Not connected';
    return ways.join(' and ') + ' · ' + (S.app.calendar.style === 'words' ? 'in words' : 'discreet');
  },
  flag: () => (S.calendar.google.connected && googleError() ? { kind: 'warn', text: 'Google Calendar could not be updated' } : null),
  view,
};
