/*
 * The home screen and the pages that used to stand beside it on Today.
 *
 *   viewHome()     the calendar and nothing else: one status line (the
 *                  server's headline and detail) and the month (calendar.js).
 *                  Without a location: the one sentence and a button to
 *                  Settings, Location.
 *   viewComing()   "Coming up": the server's alerts, the "Getting started"
 *                  checklist while it is not done, and what the calendar works
 *                  out from now on.
 *   viewTexting()  "Text this number" (or a short note and a link to the settings).
 *   viewTry()      "Try a text", on the test account.
 *
 * Every sentence that says where things stand or why a day is marked comes
 * from the server; this file writes only button labels, headings and labels.
 */
import { button, card, emptyState, h, linkButton, pretty } from '../lib.js';
import { S, t } from '../store.js';
import { mainRows } from './settings/texting.js';
import { onboardingCard } from '../onboarding.js';
import { homeCalendar, showDate } from './calendar.js';
import { tryTextCard } from './demo.js';
import { assumption, cleanDayNumber, describe, mark, plainTitle, stateTag, wasRecorded } from './marks.js';
import { alertsBlock, refresh, region } from './shared.js';

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- the home screen ----------

export function viewHome() {
  if (!S.status || !S.grid) {
    return h(
      'div',
      { class: 'home home-empty' },
      h('p', { class: 'no-location', id: 'no-location' }, 'Nothing can be calculated until a location is chosen.'),
      linkButton({ href: '#settings/location', label: 'Choose location', variant: 'primary', icon: 'map', attrs: { id: 'choose-location' } }),
    );
  }
  return h(
    'div',
    { class: 'home' },
    h(
      'p',
      { class: 'status-line', id: 'status-line' },
      h('span', { class: 'headline', id: 'status-headline' }, S.status.headline),
      S.status.detail ? h('span', { class: 'detail', id: 'status-detail' }, S.status.detail) : null,
    ),
    homeCalendar(),
  );
}

// ---------- texting ----------

/**
 * "Text this number": the site's number and the main options, when texting
 * works here and the account has a phone to text from. The test account has
 * "Try a text" instead.
 */
function textCard() {
  const sms = S.sms;
  if (!sms || !sms.ready || !sms.number || sms.simulated || S.demo) return null;
  if (!S.phones || S.phones.length === 0) return null;
  const rows = mainRows();
  const number = pretty(sms.number);
  return card(
    { title: 'Text this number', icon: 'message', className: 'text-card', attrs: { id: 'text-card' } },
    h(
      'p',
      { class: 'text-number' },
      h('a', { href: 'sms:' + sms.number, id: 'text-number', 'aria-label': 'Text ' + number }, number),
    ),
    h('p', { class: 'help' }, S.phones.length === 1 ? 'From the phone on this account:' : 'From a phone on this account:'),
    h(
      'table',
      { class: 'text-digits' },
      h('caption', { class: 'visually-hidden' }, 'The main options'),
      h('thead', { class: 'visually-hidden' }, h('tr', {}, h('th', { scope: 'col' }, 'Text'), h('th', { scope: 'col' }, 'What it does'))),
      h(
        'tbody',
        {},
        rows.map(([code, meaning]) => h('tr', {}, h('th', { scope: 'row' }, h('kbd', {}, code)), h('td', {}, cap(t(meaning))))),
      ),
    ),
    h('p', { class: 'help', id: 'text-note' }, 'Every text ends with its options; answer by word. ', h('a', { href: '#settings/texting', id: 'text-all' }, 'More')),
  );
}

/** The Texting page: "Text this number", or where texting is set up. */
export function viewTexting() {
  const c = textCard();
  return h(
    'div',
    { class: 'narrow' },
    c ||
      card(
        { title: 'Texting', icon: 'message', attrs: { id: 'texting-none' } },
        h('p', {}, S.demo ? 'This is the test account: try a text from the menu.' : S.sms && S.sms.ready ? 'Add a phone to text from.' : 'Texting is not available yet.'),
        linkButton({ href: '#settings/texting', label: 'Texting settings', attrs: { id: 'texting-settings' } }),
      ),
  );
}

/** The test account's "Try a text" page. */
export function viewTry() {
  return h('div', { class: 'narrow' }, tryTextCard());
}

// ---------- coming up ----------

/** An upcoming item with its calendar event, for the mark (night or day, clean day number). */
function withGrid(u) {
  const g = S.grid ? S.grid.events.find(e => e.key === u.key) : null;
  return g || { kind: u.kind, light: u.light, projected: u.projected, title: u.title, key: u.key, startDate: u.date, endDate: u.endDate };
}

/** A title with its label ("recorded", "not recorded", "expected"). */
function titled(e, cls) {
  const state = stateTag(e);
  return h('div', { class: cls }, plainTitle(e), state ? ' ' : null, state);
}

/** How many onot are listed before "Show more". */
const ONOT_SHOWN = 6;
let showAll = false;

/** A row of "Coming up": the mark, the title with its label, when, and the server's lines (its reasons, for an onah). */
function itemRow(it, extra) {
  const e = withGrid(it);
  const desc = describe(it, { noAssumption: true, brief: true });
  return h(
    'li',
    { class: 'up-row up-' + it.kind },
    mark(e),
    h('div', { class: 'up-main' }, titled(it, 'up-title'), h('div', { class: 'up-when' }, it.when), desc ? h('div', { class: 'ev-desc up-desc' }, desc) : null, extra || null),
    it.date && S.grid ? button({ label: 'Show ' + plainTitle(it) + ', ' + it.when + ', on the calendar', icon: 'calendar', iconOnly: true, size: 'sm', variant: 'link', className: 'up-show', onclick: () => showDate(it.date) }) : null,
  );
}

/** The clean days as one row; "Each day" shows them one by one. */
function cleanRow(items) {
  if (items.length === 1) return itemRow(items[0]);
  const first = items[0];
  const last = items[items.length - 1];
  const a = cleanDayNumber(first);
  const b = cleanDayNumber(last);
  const state = stateTag(first);
  return h(
    'li',
    { class: 'up-row up-clean_day group' },
    mark(withGrid(first)),
    h(
      'div',
      { class: 'up-main' },
      h('div', { class: 'up-title' }, cap(t('{clean_days}')) + ': day ' + a + ' to day ' + b, state ? ' ' : null, state),
      h('div', { class: 'up-when' }, first.when + ' to ' + last.when),
      h(
        'details',
        { class: 'up-details', id: 'up-each' },
        h('summary', {}, 'Each day'),
        h(
          'ul',
          { class: 'sub-days' },
          items.map(x => h('li', {}, h('strong', {}, 'Day ' + cleanDayNumber(x) + ', ' + x.when + '. '), h('span', { class: 'ev-desc' }, describe(x, { noAssumption: true }).replace(/\n+/g, ' ')))),
        ),
      ),
    ),
    first.date && S.grid ? button({ label: 'Show these days on the calendar', icon: 'calendar', iconOnly: true, size: 'sm', variant: 'link', className: 'up-show', onclick: () => showDate(first.date) }) : null,
  );
}

function upcomingCard() {
  return card(
    { title: 'Coming up', icon: 'clock', className: 'upcoming-card', attrs: { id: 'upcoming-card' } },
    region('upcoming', () => {
      // What the calendar works out, from now on; not what she recorded.
      const items = (S.upcoming || []).filter(u => !wasRecorded(u));
      const hefsek = items.filter(u => u.kind === 'hefsek');
      const clean = items.filter(u => u.kind === 'clean_day');
      const mikvah = items.filter(u => u.kind === 'mikvah');
      const onot = items.filter(u => u.kind === 'onah');
      const steps = [...hefsek, ...clean, ...mikvah];
      if (steps.length === 0 && onot.length === 0) return h('div', {}, emptyState({ icon: 'calendar', title: 'Nothing coming up.' }));
      const note = steps.map(assumption).find(Boolean) || '';
      const shown = showAll ? onot : onot.slice(0, ONOT_SHOWN);
      return h(
        'div',
        {},
        steps.length
          ? h(
              'section',
              { class: 'up-group', id: 'up-steps', 'aria-labelledby': 'up-steps-title' },
              h('h3', { id: 'up-steps-title' }, cap(t('until {mikvah_night}'))),
              note ? h('p', { class: 'up-assume small', id: 'up-assume' }, note) : null,
              h('ul', { class: 'up-list' }, hefsek.map(x => itemRow(x)), clean.length ? cleanRow(clean) : null, mikvah.map(x => itemRow(x))),
            )
          : null,
        onot.length
          ? h(
              'section',
              { class: 'up-group', id: 'up-onot', 'aria-labelledby': 'up-onot-title' },
              h('h3', { id: 'up-onot-title' }, cap(t('{onot} of separation'))),
              h('ul', { class: 'up-list' }, shown.map(x => itemRow(x))),
              onot.length > ONOT_SHOWN
                ? button({
                    label: showAll ? 'Show fewer' : 'Show ' + (onot.length - ONOT_SHOWN) + ' more',
                    variant: 'link',
                    attrs: { id: 'up-more', 'aria-expanded': String(showAll) },
                    onclick: () => {
                      showAll = !showAll;
                      refresh('upcoming');
                    },
                  })
                : null,
            )
          : null,
      );
    }),
  );
}

/** The "Coming up" page: the alerts first, then the checklist while it is not done, then the list. */
export function viewComing() {
  const alerts = alertsBlock();
  return h('div', { class: 'narrow coming' }, alerts ? h('div', { id: 'coming-alerts' }, alerts) : null, onboardingCard(), S.status ? upcomingCard() : null);
}
