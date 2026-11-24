/* Settings: the Calendar card (Google Calendar, subscription link, appearance). */
import { alert, api, button, card, cardSection, confirmDialog, copyField, h, icon, linkButton, toast } from '../../lib.js';
import { S, t, when } from '../../store.js';
import { refresh, region, saveAppChange, saveChange, saveStatus } from '../shared.js';

let nameDraft = null;
let nameError = '';
let historyError = '';

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** Asks first, then saves; the result is shown beside the card's title. */
const confirmThen = (dialog, request, message) => async () => {
  if (!(await confirmDialog(dialog))) return;
  saveChange('calendar', request, { message });
};

function whatApplies() {
  const cal = S.calendar;
  const ways = [];
  if (cal.google.connected) ways.push('Google Calendar');
  if (cal.link) ways.push('a subscription link');
  return ways.length
    ? h('p', { class: 'applies on' }, icon('check', { size: 'sm' }), h('span', {}, 'Your dates are shown through ' + ways.join(' and ') + '.'))
    : h('p', { class: 'applies' }, icon('info', { size: 'sm' }), h('span', {}, 'Your dates are not shown in any calendar app yet. This is optional.'));
}

function googlePart() {
  const cal = S.calendar;
  const g = cal.google;
  const sync = cal.sync;
  if (!g.available) return null;
  return cardSection(
    { title: 'Google Calendar' },
    g.connected
      ? alert({ kind: 'ok' }, 'Connected. The calendar is named “' + S.app.calendar.name + '” in your Google Calendar. To share it with your spouse, share it from there.')
      : h('p', { class: 'help' }, 'The site creates one calendar in your Google account and keeps it up to date. It can see and change only that one calendar, nothing else in your account.'),
    g.connected && sync.lastOkAt ? h('p', { class: 'small muted' }, 'Last brought up to date: ' + when(sync.lastOkAt) + (sync.dirty ? ' (changes waiting)' : '')) : null,
    h(
      'div',
      { class: 'actions' },
      g.connected
        ? button({
            label: 'Update now',
            icon: 'refresh',
            attrs: { id: 'google-sync' },
            onclick: () => {
              saveChange('calendar', () => api('POST', '/api/sync'), {
                done: r => {
                  const o = r.outcome;
                  if (o.status !== 'ok') toast(o.message || 'The calendar could not be updated.', true);
                  else toast('Calendar updated: ' + o.result.inserted + ' added, ' + o.result.updated + ' changed, ' + o.result.deleted + ' removed' + (o.result.remaining ? ', ' + o.result.remaining + ' still to do' : '') + '.');
                },
              });
            },
          })
        : linkButton({ href: '/api/google/start', label: 'Connect Google Calendar', variant: 'primary', icon: 'calendar' }),
    ),
    g.connected
      ? h(
          'details',
          { class: 'more', id: 'google-more' },
          h('summary', {}, 'More'),
          h(
            'div',
            { class: 'actions' },
            linkButton({ href: '/api/google/start', label: 'Connect again' }),
            button({
              label: 'Disconnect Google Calendar',
              variant: 'danger',
              onclick: confirmThen({ title: 'Disconnect Google Calendar?', body: 'The calendar itself stays in your Google account, but it is no longer updated.', confirmLabel: 'Disconnect', danger: true }, () => api('POST', '/api/google/disconnect'), 'Disconnected'),
            }),
          ),
        )
      : null,
  );
}

function linkPart() {
  const cal = S.calendar;
  if (!cal.link) {
    return cardSection(
      { title: 'Subscription link' },
      h('p', { class: 'help' }, 'A private address that Apple Calendar, Outlook or Google Calendar can subscribe to. No account needs to be connected.'),
      button({ label: 'Create a subscription link', icon: 'link', attrs: { id: 'link-create' }, onclick: () => saveChange('calendar', () => api('POST', '/api/calendar-link'), { message: 'The link is ready', done: () => toast('The link is ready.') }) }),
    );
  }
  return cardSection(
    { title: 'Subscription link' },
    copyField({ value: cal.link, label: 'Copy link', copiedMessage: 'The link is copied.' }),
    h('div', { class: 'actions' }, linkButton({ href: cal.link.replace(/^https?:/, 'webcal:'), label: 'Open in my calendar app', icon: 'calendar', variant: 'primary' })),
    h('p', { class: 'help' }, 'Or add the address in your calendar app as a subscribed calendar (in Google Calendar: Other calendars, +, From URL). Anyone who has it can read the calendar, so share it only with your spouse. Calendar apps look for changes on their own schedule; Google says it can take up to 12 hours.'),
    h(
      'details',
      { class: 'more', id: 'link-more' },
      h('summary', {}, 'More'),
      h(
        'div',
        { class: 'actions' },
        button({
          label: 'Replace link',
          onclick: confirmThen({ title: 'Replace the link?', body: 'The old address stops working at once, and calendars subscribed to it stop updating. You then add the new one.', confirmLabel: 'Replace link', danger: true }, () => api('POST', '/api/calendar-link'), 'A new link was made'),
        }),
        button({
          label: 'Remove link',
          variant: 'danger',
          onclick: confirmThen({ title: 'Remove the link?', body: 'Calendars subscribed to it stop updating.', confirmLabel: 'Remove link', danger: true }, () => api('DELETE', '/api/calendar-link'), 'The link was removed'),
        }),
      ),
    ),
  );
}

function stylePreview(style) {
  const words = [
    ['hefsek', cap(t('{hefsek}')) + ' (by 4:37 PM)'],
    ['clean', cap(t('{clean_days}')) + ': day 1'],
    ['mikvah', cap(t('{mikvah_night}')) + ' (after 5:18 PM)'],
  ];
  const discreet = [
    ['hefsek', 'H < 4:37 PM'],
    ['clean', '1/7'],
    ['mikvah', 'M > 5:18 PM'],
  ];
  return h('span', { class: 'preview', 'aria-hidden': 'true' }, (style === 'words' ? words : discreet).map(([k, text]) => h('span', { class: 'chip ' + k }, text)));
}

function appearancePart() {
  const style = S.app.calendar.style;
  const option = (value, title, help) =>
    h(
      'label',
      { class: 'style-option' + (style === value ? ' chosen' : '') },
      h('input', {
        type: 'radio',
        name: 'cal-style',
        id: 'style-' + value,
        value,
        checked: style === value,
        onchange: () => saveAppChange('calendar', a => (a.calendar.style = value)),
      }),
      h('span', { class: 'style-text' }, h('strong', {}, title), h('span', { class: 'choice-help' }, help), stylePreview(value)),
    );
  return cardSection(
    { title: 'How events look' },
    h(
      'fieldset',
      { class: 'plain style-pick' },
      h('legend', { class: 'visually-hidden' }, 'Event titles'),
      option('words', 'In words, with details', 'Anyone who sees your calendar can read what each event is.'),
      option('discreet', 'Discreet: symbols only', t('No details. • a start, H {hefsek}, 1/7 to 7/7 {clean_days}, M {mikvah_night}, ◆ {veset_onah}, ◇ {or_zarua}. “?” marks a projected date.')),
    ),
    h('p', { class: 'help' }, 'This page always shows everything in words.'),
    region('cal-name-wrap', () =>
      h(
        'div',
        {},
        h(
          'div',
          { class: 'field' + (nameError ? ' has-error' : '') },
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
              if (v !== S.app.calendar.name) saveAppChange('calendar', a => (a.calendar.name = v));
              else refresh('cal-name-wrap');
            },
          }),
          h('div', { class: 'help', id: 'cal-name-help' }, 'Used when the calendar is first created. Afterwards, rename it in your calendar app.'),
          nameError ? h('div', { class: 'error', id: 'cal-name-error' }, icon('alert', { size: 'sm' }), h('span', {}, nameError)) : null,
        ),
      ),
    ),
    h(
      'details',
      { class: 'advanced', id: 'cal-adv' },
      h('summary', {}, 'Advanced'),
      region('cal-history-wrap', () =>
        h(
          'div',
          { class: 'field' },
          h('label', { for: 'cal-history' }, 'Days of history kept up to date in Google Calendar'),
          h('input', {
            id: 'cal-history',
            type: 'number',
            min: 30,
            max: 800,
            step: 1,
            value: S.app.calendar.historyDays,
            'aria-invalid': historyError ? 'true' : null,
            'aria-describedby': historyError ? 'cal-history-error' : null,
            onchange: e => {
              const v = Number(e.target.value);
              if (!Number.isInteger(v) || v < 30 || v > 800) {
                historyError = 'A whole number from 30 to 800.';
                refresh('cal-history-wrap');
                return;
              }
              historyError = '';
              saveAppChange('calendar', a => (a.calendar.historyDays = v));
            },
          }),
          historyError ? h('div', { class: 'error', id: 'cal-history-error' }, icon('alert', { size: 'sm' }), h('span', {}, historyError)) : null,
        ),
      ),
    ),
  );
}

export function calendarCard() {
  return card(
    { title: 'Calendar', icon: 'calendar', headerAction: saveStatus('calendar'), className: 'calendar-settings' },
    h('p', { class: 'card-intro' }, 'Optional. See your dates in your own calendar app.'),
    whatApplies(),
    googlePart(),
    linkPart(),
    appearancePart(),
  );
}

