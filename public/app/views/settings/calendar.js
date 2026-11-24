/* Settings: the Calendar card (Google Calendar, subscription link, appearance). Next owner: the dashboard agent. */
import { alert, api, button, card, cardSection, confirmDialog, copyField, h, linkButton, numberRow, selectField, textField, toast } from '../../lib.js';
import { S, adopt, draft, render, run, saved, t, when } from '../../store.js';
import { saveApp } from '../shared.js';

/** Asks first, then runs the request; the button that was clicked is busy meanwhile. */
const confirmThen = (dialog, request, done) => async e => {
  const btn = e.currentTarget;
  if (!(await confirmDialog(dialog))) return;
  run(request, done, btn);
};

export function calendarCard() {
  const a = draft.app;
  const cal = S.calendar;
  const sync = cal.sync;
  const google = cal.google;

  const googlePart = !google.available
    ? h('p', { class: 'muted' }, 'Connecting a Google account is not available on this site yet. The subscription link below works with Google Calendar too.')
    : h(
        'div',
        {},
        google.connected
          ? alert({ kind: 'ok' }, 'Connected. The calendar is named “' + S.app.calendar.name + '” in your Google Calendar. To share it with your spouse, share it from there.')
          : h('p', { class: 'muted' }, 'The site creates one calendar in your Google account and keeps it up to date. It can see and change only that one calendar, nothing else in your account.'),
        sync.lastOkAt ? h('p', { class: 'small muted' }, 'Last brought up to date: ' + when(sync.lastOkAt) + (sync.dirty ? ' (changes waiting)' : '')) : null,
        h(
          'div',
          { class: 'actions' },
          linkButton({ href: '/api/google/start', label: google.connected ? 'Connect again' : 'Connect Google Calendar', variant: google.connected ? 'secondary' : 'primary', icon: google.connected ? null : 'calendar' }),
          google.connected
            ? button({
                label: 'Update now',
                icon: 'refresh',
                onclick: e =>
                  run(
                    () => api('POST', '/api/sync'),
                    r => {
                      adopt(r.state);
                      render();
                      const o = r.outcome;
                      toast(
                        o.status === 'ok'
                          ? 'Calendar updated: ' + o.result.inserted + ' added, ' + o.result.updated + ' changed, ' + o.result.deleted + ' removed' + (o.result.remaining ? ', ' + o.result.remaining + ' still to do' : '') + '.'
                          : o.message || 'The calendar could not be updated.',
                        o.status !== 'ok',
                      );
                    },
                    e.currentTarget,
                  ),
              })
            : null,
          google.connected
            ? button({
                label: 'Disconnect',
                variant: 'danger',
                onclick: confirmThen(
                  { title: 'Disconnect Google Calendar?', body: 'The calendar itself stays in your Google account.', confirmLabel: 'Disconnect', danger: true },
                  () => api('POST', '/api/google/disconnect'),
                  saved('Disconnected.'),
                ),
              })
            : null,
        ),
      );

  const linkPart = cal.link
    ? h(
        'div',
        {},
        copyField({ value: cal.link }),
        h('p', { class: 'help' }, 'Add this address in your calendar app as a subscribed calendar (in Google Calendar: Other calendars, +, From URL). Anyone who has it can read the calendar, so share it only with your spouse. Calendar apps look for changes on their own schedule; Google says it can take up to 12 hours.'),
        h(
          'div',
          { class: 'actions' },
          linkButton({ href: cal.link.replace(/^https?:/, 'webcal:'), label: 'Open in my calendar app', icon: 'calendar' }),
          button({
            label: 'Replace link',
            onclick: confirmThen(
              { title: 'Replace the link?', body: 'The old address stops working at once, and calendars subscribed to it stop updating.', confirmLabel: 'Replace link', danger: true },
              () => api('POST', '/api/calendar-link'),
              saved('A new link was made.'),
            ),
          }),
          button({
            label: 'Remove link',
            variant: 'danger',
            onclick: confirmThen(
              { title: 'Remove the link?', body: 'Calendars subscribed to it stop updating.', confirmLabel: 'Remove link', danger: true },
              () => api('DELETE', '/api/calendar-link'),
              saved('The link was removed.'),
            ),
          }),
        ),
      )
    : h(
        'div',
        {},
        h('p', { class: 'muted' }, 'A private address that Apple Calendar, Outlook or Google Calendar can subscribe to. No account needs to be connected.'),
        h('div', { class: 'actions' }, button({ label: 'Create a subscription link', icon: 'link', onclick: e => run(() => api('POST', '/api/calendar-link'), saved('The link is ready.'), e.currentTarget) })),
      );

  return card(
    { title: 'Calendar', intro: 'Optional. Two ways to see the dates in your own calendar.' },
    h('h3', {}, 'Google Calendar'),
    googlePart,
    cardSection({ title: 'Subscription link' }, linkPart),
    cardSection(
      { title: 'Appearance' },
      textField({ id: 'cal-name', label: 'Name of the calendar', maxlength: 40, value: a.calendar.name, help: 'Used when the calendar is first created. Afterwards, rename it in your calendar app.', oninput: e => (a.calendar.name = e.target.value) }),
      selectField({
        id: 'style',
        label: 'Event titles',
        wide: true,
        value: a.calendar.style,
        options: [
          { value: 'words', label: 'Words, with details' },
          { value: 'discreet', label: 'Discreet: symbols only, no details' },
        ],
        help: 'Discreet titles: • start, H ' + t('{hefsek}') + ', 1/7 to 7/7 ' + t('{clean_days}') + ', M ' + t('{mikvah_night}') + ', ◆ ' + t('{veset_onah}') + ', ◇ ' + t('{or_zarua}') + '. “?” marks a projected date.',
        onchange: e => (a.calendar.style = e.target.value),
      }),
      numberRow({ id: 'cal-history', label: 'Days of history kept up to date in the calendar', value: a.calendar.historyDays, onchange: v => (a.calendar.historyDays = v), min: 30, max: 800, step: 1 }),
      h('div', { class: 'actions' }, button({ label: 'Save appearance', onclick: e => saveApp('Saved.', e.currentTarget) })),
    ),
  );
}
