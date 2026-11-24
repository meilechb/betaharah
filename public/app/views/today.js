/*
 * The Today tab: where things stand and what comes next, the month
 * calendar, recording an event, and a short "Coming up" list.
 */
import { button, card, emptyState, h, icon } from '../lib.js';
import { S, go, t } from '../store.js';
import { onboardingCard } from '../onboarding.js';
import { calendarCard, showDate } from './calendar.js';
import { tryTextCard } from './demo.js';
import { cleanDayNumber, isNight, mark } from './marks.js';
import { recordCard } from './record.js';
import { addDays, alertsBlock, longDate, refresh, region, shortDate, today, weekdayOf } from './shared.js';

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
  // The order in the page is the order on a phone and for the keyboard: where things stand, the
  // calendar, then recording (also one tap away from anywhere, by the button that stays on screen).
  watchRecordCard();
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
    button({ label: 'Record', icon: 'plus', variant: 'primary', className: 'record-jump', attrs: { id: 'record-jump' }, onclick: jumpToRecord }),
  );
}

// ---------- recording, one tap away on a phone ----------

let recordObserver = null;

/** Hides the "Record" button while the record card is on screen. */
function watchRecordCard() {
  if (recordObserver) recordObserver.disconnect();
  if (typeof IntersectionObserver === 'undefined') return;
  recordObserver = new IntersectionObserver(entries => {
    const jump = document.getElementById('record-jump');
    // Shown only while the record card is still further down the page; hidden once it is on screen or passed.
    if (jump) jump.classList.toggle('hidden-by-card', entries.some(x => x.isIntersecting || x.boundingClientRect.top < 0));
  });
  setTimeout(() => {
    const el = document.getElementById('record-card');
    if (el && recordObserver) recordObserver.observe(el);
  }, 0);
}

function jumpToRecord() {
  const el = document.getElementById('record-card');
  if (!el) return;
  el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const first = document.getElementById('rec-suggested') || document.getElementById('rec-kind-flow');
  if (first) first.focus({ preventScroll: true });
}

// ---------- where things stand ----------

/** The lines of an event's description after its date line, without blanks. */
function detailLines(e) {
  return (e.description || '')
    .split('\n')
    .slice(1)
    .filter(x => x.trim() !== '');
}

/**
 * The events that belong to now. By day: those of today's date (without a
 * night that ended at sunrise). At night: the Hebrew date has already moved
 * on, so the night's events (from this evening) and the all-day events of
 * the new Hebrew date; they then agree with the headline above.
 */
function nowEvents() {
  const g = S.grid;
  const civil = S.today.civilDate;
  if (S.today.part === 'day') {
    return g.events.filter(e => e.startDate <= civil && e.endDate >= civil && !(e.kind === 'flow' && e.startDate < civil) && !(!e.allDay && e.startDate < civil && e.endDate === civil));
  }
  const hebrew = S.today.date;
  const evening = addDays(hebrew, -1);
  return g.events.filter(e => (e.allDay ? e.startDate <= hebrew && e.endDate >= hebrew : e.startDate === evening && isNight(e)));
}

function eventWhen(e) {
  if (e.allDay) return null;
  if (e.kind === 'mikvah') return 'After ' + e.start;
  if (e.start === e.end) return e.start;
  return e.start + ' to ' + e.end + (e.startDate !== e.endDate ? ' the next morning' : '');
}

/** A sentence that says what has begun, at night only. */
function nightLine() {
  const phase = S.status.phase;
  if (phase === 'counting') return t('Day ' + S.status.day + ' of the {clean_days} has begun.');
  if (phase === 'mikvah_tonight') return t('Tonight is the {mikvah_night}.');
  return null;
}

function nowBox() {
  if (!S.grid || !S.today) return null;
  const night = S.today.part === 'night';
  const items = nowEvents();
  if (!night && items.length === 0) return null;
  const sunsetDay = S.grid.days.find(d => d.date === S.today.civilDate);
  const evening = night && S.today.civilDate !== S.today.date;
  return h(
    'div',
    { class: 'today-box' + (night ? ' night' : '') },
    h(
      'h3',
      {},
      night ? icon('moon', { size: 'sm' }) : null,
      night ? 'Tonight: the night of ' + S.today.hebrew.replace(/ \d{4}$/, '') : 'Today, ' + shortDate(S.today.civilDate),
    ),
    night
      ? h(
          'p',
          { class: 'night-note' },
          evening
            ? t('The Hebrew date changed at {sunset}' + (sunsetDay && sunsetDay.sunset ? ' (' + sunsetDay.sunset + ')' : '') + '. The civil date is still ' + longDate(S.today.civilDate) + '.')
            : t('This night began at {sunset} yesterday evening. It belongs to the Hebrew date of ' + longDate(S.today.date) + '.'),
          nightLine() ? ' ' + nightLine() : '',
        )
      : null,
    items.length
      ? h(
          'ul',
          { class: 'today-items' },
          items.map(e =>
            h(
              'li',
              {},
              mark(e),
              h(
                'div',
                {},
                h('div', { class: 'ti-title' }, e.title + (e.projected && !/projected/.test(e.title) ? ' (projected)' : '')),
                eventWhen(e) ? h('div', { class: 'ti-when' }, eventWhen(e)) : null,
                detailLines(e)
                  .slice(0, e.kind === 'onah' ? 0 : 3)
                  .map(line => h('div', { class: 'ti-line' }, line)),
              ),
            ),
          ),
        )
      : h('p', { class: 'muted small' }, 'Nothing is marked for tonight.'),
  );
}

function statusCard() {
  // The next onat perishah is shown here only while she is tehorah; during a niddah period it is
  // in "Coming up", so that it does not stand next to the task of the day.
  const nextOnah = S.status.phase === 'tehorah' ? S.upcoming.find(x => x.kind === 'onah') : null;
  const sunToday = S.grid ? S.grid.days.find(d => d.date === today()) : null;
  return h(
    'section',
    { class: 'card status status-card', 'aria-labelledby': 'status-headline' },
    h('p', { class: 'eyebrow' }, 'Where things stand'),
    h('p', { class: 'headline', id: 'status-headline' }, S.status.headline),
    S.status.detail ? h('p', { class: 'detail' }, S.status.detail) : null,
    nowBox(),
    nextOnah
      ? h(
          'p',
          { class: 'next-line' },
          mark(withGrid(nextOnah)),
          h('span', {}, h('strong', {}, cap(t('Next {onat_perishah}: '))), nextOnah.title + ', ' + nextOnah.when + '.'),
        )
      : null,
    sunToday && sunToday.sunset ? h('p', { class: 'sun-line' }, icon('moon', { size: 'sm' }), cap(t('{sunset} today: ')) + sunToday.sunset + '.') : null,
    alertsBlock(),
  );
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** An upcoming item with its calendar event, for the mark (night or day, clean day number). */
function withGrid(u) {
  const g = S.grid ? S.grid.events.find(e => e.key === u.key) : null;
  return g || { kind: u.kind, light: u.light, projected: u.projected, title: u.title, key: u.key, startDate: u.date, endDate: u.endDate };
}

// ---------- coming up ----------

let showAll = false;

/** S.upcoming, each with its calendar event (for its mark). */
function upcomingJoined() {
  const byKey = new Map((S.grid ? S.grid.events : []).map(e => [e.key, e]));
  return S.upcoming.map(u => ({ ...u, grid: byKey.get(u.key) || null }));
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
  const m = mark(it.grid || withGrid(it));
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

