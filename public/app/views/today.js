/*
 * The Today tab: where things stand and what comes next, recording an
 * event, the month calendar, and a short "Coming up" list.
 */
import { button, card, emptyState, h, icon } from '../lib.js';
import { S, go, t } from '../store.js';
import { onboardingCard } from '../onboarding.js';
import { calendarCard, showDate } from './calendar.js';
import { tryTextCard } from './demo.js';
import { cleanDayNumber, mark } from './marks.js';
import { recordCard } from './record.js';
import { addDays, alertsBlock, refresh, region, shortDate, today, weekdayOf } from './shared.js';

export function viewToday() {
  if (!S.status) {
    return h(
      'div',
      { class: 'narrow' },
      onboardingCard(),
      card(
        { title: 'Choose your location first', icon: 'map', className: 'status-card empty-status' },
        h('p', {}, t('Sunrise and {sunset} decide every date in this calendar, so nothing can be calculated until a location is chosen.')),
        button({ label: 'Choose your location', variant: 'primary', icon: 'map', onclick: () => go('settings') }),
      ),
      alertsBlock(),
    );
  }
  return h(
    'div',
    {},
    onboardingCard(),
    h(
      'div',
      { class: 'today-layout' },
      h('div', { class: 'col-main' }, statusCard(), S.grid ? calendarCard() : null),
      h('div', { class: 'col-side' }, recordCard(), tryTextCard(), upcomingCard()),
    ),
  );
}

// ---------- where things stand ----------

/** The lines of an event's description after its date line, without blanks. */
function detailLines(e) {
  return (e.description || '')
    .split('\n')
    .slice(1)
    .filter(x => x.trim() !== '');
}

function statusCard() {
  const day = today();
  const todays = S.grid ? S.grid.events.filter(e => e.startDate <= day && e.endDate >= day && !(e.kind === 'flow' && e.startDate < day)) : [];
  const nextOnah = upcomingJoined().find(x => x.kind === 'onah' && x.date > day);
  const sunToday = S.grid ? S.grid.days.find(d => d.date === day) : null;
  return h(
    'section',
    { class: 'card status status-card', 'aria-labelledby': 'status-headline' },
    h('p', { class: 'eyebrow' }, 'Where things stand'),
    h('p', { class: 'headline', id: 'status-headline' }, S.status.headline),
    S.status.detail ? h('p', { class: 'detail' }, S.status.detail) : null,
    todays.length
      ? h(
          'div',
          { class: 'today-box' },
          h('h3', {}, 'Today, ' + shortDate(day)),
          h(
            'ul',
            { class: 'today-items' },
            todays.map(e =>
              h(
                'li',
                {},
                mark(e),
                h(
                  'div',
                  {},
                  h('div', { class: 'ti-title' }, e.title + (e.projected && !/projected/.test(e.title) ? ' (projected)' : '')),
                  e.allDay ? null : h('div', { class: 'ti-when' }, e.start === e.end ? e.start : e.start + ' to ' + e.end + (e.startDate !== e.endDate ? ' the next morning' : '')),
                  detailLines(e)
                    .slice(0, e.kind === 'onah' ? 0 : 3)
                    .map(line => h('div', { class: 'ti-line' }, line)),
                ),
              ),
            ),
          ),
        )
      : null,
    nextOnah
      ? h(
          'p',
          { class: 'next-line' },
          mark(nextOnah),
          h('span', {}, h('strong', {}, cap(t('Next {onat_perishah}: '))), nextOnah.title + ', ' + nextOnah.when + '.'),
        )
      : null,
    sunToday && sunToday.sunset ? h('p', { class: 'sun-line' }, icon('moon', { size: 'sm' }), cap(t('{sunset} today: ')) + sunToday.sunset + '.') : null,
    alertsBlock(),
  );
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- coming up ----------

let showAll = false;

/** S.upcoming, each with its civil date taken from the calendar's events. */
function upcomingJoined() {
  const byKey = new Map((S.grid ? S.grid.events : []).map(e => [e.key, e]));
  return S.upcoming.map(u => {
    const g = byKey.get(u.key);
    return { ...u, date: g ? g.startDate : null, endDate: g ? g.endDate : null, grid: g || null };
  });
}

function weekLabel(start, thisWeek) {
  if (start === thisWeek) return 'This week';
  if (start === addDays(thisWeek, 7)) return 'Next week';
  return 'Week of ' + shortDate(start);
}

/** Rows of a week: the clean days in a row become one row. */
function rowsOf(items) {
  const rows = [];
  for (const it of items) {
    const prev = rows[rows.length - 1];
    if (it.kind === 'clean_day' && prev && prev.group) prev.items.push(it);
    else if (it.kind === 'clean_day') rows.push({ group: true, items: [it] });
    else rows.push({ group: false, item: it });
  }
  return rows;
}

function itemRow(it) {
  const m = it.grid ? mark(it.grid) : mark({ kind: it.kind, light: it.light, projected: it.projected, title: it.title }, { night: /night|לילה/.test(it.title) });
  return h(
    'li',
    { class: 'up-row' + (it.projected ? ' projected' : '') },
    m,
    h(
      'div',
      { class: 'up-main' },
      h('div', { class: 'up-title' }, it.title),
      h('div', { class: 'up-when' }, it.when),
      it.description ? h('details', { class: 'up-details' }, h('summary', {}, 'Details'), h('div', { class: 'ev-desc' }, it.description)) : null,
    ),
    it.date && S.grid
      ? button({ label: 'Show ' + it.title + ' on the calendar', icon: 'calendar', iconOnly: true, size: 'sm', variant: 'link', className: 'up-show', onclick: () => showDate(it.date) })
      : null,
  );
}

function cleanGroupRow(items) {
  if (items.length === 1) return itemRow(items[0]);
  const first = items[0];
  const last = items[items.length - 1];
  const a = cleanDayNumber(first);
  const b = cleanDayNumber(last);
  const projected = items.some(x => x.projected);
  return h(
    'li',
    { class: 'up-row group' + (projected ? ' projected' : '') },
    first.grid ? mark(first.grid) : mark({ kind: 'clean_day', projected }, { number: a }),
    h(
      'div',
      { class: 'up-main' },
      h('div', { class: 'up-title' }, cap(t('{clean_days}')) + ': days ' + a + ' to ' + b + (projected ? ' (projected)' : '')),
      h('div', { class: 'up-when' }, first.when + ' to ' + last.when),
      h(
        'details',
        { class: 'up-details' },
        h('summary', {}, 'Each day'),
        h(
          'ul',
          { class: 'sub-days' },
          items.map(x => h('li', {}, h('strong', {}, 'Day ' + cleanDayNumber(x) + ', ' + x.when + '. '), h('span', { class: 'ev-desc' }, x.description.split('\n').slice(1).join(' ')))),
        ),
      ),
    ),
    first.date && S.grid ? button({ label: 'Show these days on the calendar', icon: 'calendar', iconOnly: true, size: 'sm', variant: 'link', className: 'up-show', onclick: () => showDate(first.date) }) : null,
  );
}

function upcomingCard() {
  return card(
    { title: 'Coming up', icon: 'clock', className: 'upcoming-card' },
    region('upcoming', () => {
      const items = upcomingJoined();
      if (items.length === 0) return h('div', {}, emptyState({ icon: 'calendar', title: 'Nothing coming up.', body: t('Dates appear here once a {flow} is recorded.') }));
      const day = today();
      const thisWeek = addDays(day, -weekdayOf(day));
      const groups = [];
      for (const it of items) {
        const start = it.date ? addDays(it.date, -weekdayOf(it.date)) : 'later';
        let g = groups[groups.length - 1];
        if (!g || g.start !== start) {
          g = { start, items: [] };
          groups.push(g);
        }
        g.items.push(it);
      }
      const limit = 3;
      const shown = showAll ? groups : groups.slice(0, limit);
      return h(
        'div',
        {},
        shown.map(g =>
          h('section', { class: 'week' }, h('h3', {}, g.start === 'later' ? 'Later' : weekLabel(g.start, thisWeek)), h('ul', { class: 'up-list' }, rowsOf(g.items).map(r => (r.group ? cleanGroupRow(r.items) : itemRow(r.item))))),
        ),
        groups.length > limit
          ? button({
              label: showAll ? 'Show less' : 'Show ' + (groups.length - limit) + ' more weeks',
              variant: 'link',
              attrs: { id: 'up-more', 'aria-expanded': String(showAll) },
              onclick: () => {
                showAll = !showAll;
                refresh('upcoming');
              },
            })
          : null,
      );
    }),
  );
}

