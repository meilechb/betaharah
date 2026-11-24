/*
 * The Today tab. On a phone, top to bottom: where things stand with the one
 * thing to do next, the full form when a link opened it, the month calendar
 * (with its legend and the chosen day, where what happened on it is recorded
 * with one click), "Coming up", and texting. On a wide screen the calendar is
 * on the left and the rest on the right.
 *
 * Every sentence that says where things stand or why a day is marked comes
 * from the server; this file writes only button labels, headings and labels.
 */
import { alert, button, card, emptyState, h, icon, linkButton, pretty } from '../lib.js';
import { S, t } from '../store.js';
import { DIGITS } from './settings/texting.js';
import { onboardingCard } from '../onboarding.js';
import { calendarCard, showDate } from './calendar.js';
import { tryTextCard } from './demo.js';
import { assumption, cleanDayNumber, describe, isDone, isNight, mark, plainTitle, stateTag, wasRecorded } from './marks.js';
import { notice, openRecord, recordNow, recordPanel } from './record.js';
import { addDays, alertsBlock, longDate, refresh, region, shortDate, today } from './shared.js';

export function viewToday() {
  if (!S.status) {
    return h(
      'div',
      { class: 'narrow' },
      onboardingCard(),
      card(
        { title: 'Choose your location first', icon: 'map', className: 'status-card empty-status' },
        h('p', { id: 'no-location' }, 'Nothing can be calculated until a location is chosen.'),
        h('p', { class: 'muted' }, t('Sunrise, {sunset} and {nightfall} are worked out for that place. Change it when you travel.')),
        linkButton({ href: '#settings/location', label: 'Choose your location', variant: 'primary', icon: 'map', attrs: { id: 'choose-location' } }),
      ),
      alertsBlock(),
      textCard(),
    );
  }
  // The order in the page is the order on a phone and for the keyboard. On a wide screen the
  // calendar is placed in the left column (dashboard.css), and the rest stays in this order on the right.
  return h(
    'div',
    {},
    onboardingCard(),
    h('div', { class: 'today-layout' }, statusCard(), recordPanel(), S.grid ? calendarCard() : null, upcomingCard(), textCard(), tryTextCard()),
  );
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- texting ----------

/** The digits shown on Today; the rest are under Settings → Texting. */
const TODAY_DIGITS = ['1', '2', '4', '9'];

/**
 * "Text this number": the site's number and the most used digits, when texting
 * works here and the account has a phone to text from. The test account has
 * "Try a text" instead, which already shows the number and the digits.
 */
function textCard() {
  const sms = S.sms;
  if (!sms || !sms.ready || !sms.number || sms.simulated || S.demo) return null;
  if (!S.phones || S.phones.length === 0) return null;
  const list = Array.isArray(sms.commandList) ? sms.commandList : null;
  const rows = DIGITS.filter(([d]) => TODAY_DIGITS.includes(d) && (!list || list.some(x => x && x.text === d)));
  const number = pretty(sms.number);
  return card(
    { title: 'Text this number', icon: 'message', className: 'text-card', attrs: { id: 'text-card' } },
    h(
      'p',
      { class: 'text-number' },
      h('a', { href: 'sms:' + sms.number, id: 'text-number', 'aria-label': 'Text ' + number }, number),
    ),
    h('p', { class: 'help' }, S.phones.length === 1 ? 'From the phone on this account.' : 'From a phone on this account.', ' Send one of these:'),
    h(
      'table',
      { class: 'text-digits' },
      h('caption', { class: 'visually-hidden' }, 'Texts to send'),
      h('thead', { class: 'visually-hidden' }, h('tr', {}, h('th', { scope: 'col' }, 'Text'), h('th', { scope: 'col' }, 'What it does'))),
      h(
        'tbody',
        {},
        rows.map(([code, meaning]) => h('tr', {}, h('th', { scope: 'row' }, h('kbd', {}, code)), h('td', {}, cap(t(meaning))))),
      ),
    ),
    h('p', { class: 'help' }, h('a', { href: '#settings/texting', id: 'text-all' }, 'All the commands are in Settings, under Texting'), '.'),
  );
}

// ---------- where things stand ----------

/** The lines of an event's description after its date line, without blanks. */
function detailLines(e) {
  return describe(e, { dated: true })
    .split('\n')
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

/** A title with its label ("recorded", "not recorded", "expected"). */
function titled(e, cls) {
  const state = stateTag(e, S.today && S.today.civilDate);
  return h('div', { class: cls }, plainTitle(e), state ? ' ' : null, state);
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
                titled(e, 'ti-title'),
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

/** The latest period's projected hefsek taharah: its date is the first day it can still be done. */
function hefsekDay() {
  const list = S.grid ? S.grid.events.filter(e => e.kind === 'hefsek' && e.projected && !isDone(e)) : [];
  return list.length ? list[list.length - 1] : null;
}

/** The mikvah night of the count that is complete, with no immersion recorded (it has not been followed by a period). */
function pastMikvahNight() {
  if (!S.grid) return null;
  const list = S.grid.events.filter(e => e.kind === 'mikvah' && !isDone(e) && !e.projected && !noImmersionEvent(e) && e.startDate <= S.today.civilDate);
  return list.length ? list[list.length - 1] : null;
}

/** The night shown on the calendar as "Mikvah night: no immersion recorded" (the count before a later period). */
const noImmersionEvent = e => e.kind === 'mikvah' && !isDone(e) && !e.projected && /: no .+ recorded$/.test(e.title || '');

/**
 * The one thing to record next, as one button, for the phase the server gives;
 * links to the full form for anything else. A refusal is shown beside the
 * button, the server's confirmation (with Undo) above it.
 */
function nextStep() {
  const phase = S.status.phase;
  const civil = S.today.civilDate;
  const primary = (label, body) =>
    button({ label, variant: 'primary', size: 'lg', block: true, className: 'next-button', attrs: { id: 'next-step' }, onclick: e => recordNow(body, e.currentTarget, 'status') });
  const link = (label, id, preset) => button({ label, variant: 'link', attrs: { id }, onclick: () => openRecord(preset, id) });
  let main = null;
  const links = [];
  if (phase === 'tehorah') {
    main = primary('A period began', { kind: 'flow', when: 'now' });
    links.push(link('It began earlier', 'next-earlier', { kind: 'flow', mode: 'other', date: today() }));
  } else if (phase === 'before_hefsek') {
    const hefsek = hefsekDay();
    if (S.today.part === 'day' && hefsek && hefsek.startDate <= civil) main = primary(cap(t('The {hefsek} was done today')), { kind: 'hefsek', when: 'now' });
  } else if (phase === 'mikvah_tonight') {
    main = primary('She immersed tonight', { kind: 'mikvah', when: 'now' });
  } else if (phase === 'mikvah_not_recorded') {
    const m = pastMikvahNight();
    if (m) main = primary('She immersed on the evening of ' + longDate(m.startDate), { kind: 'mikvah', date: m.startDate });
    links.push(link('On another night', 'next-other-night', { kind: 'mikvah', mode: 'other', date: m ? m.startDate : today() }));
  }
  links.push(link('Record something else', 'next-else', {}));
  return h('div', { class: 'next' + (main ? ' has-main' : '') }, notice('status'), main, h('div', { class: 'next-links' }, links));
}

/** The server's alerts; under the note about a period with no immersion recorded before it, a button to record that immersion. */
function alertsPart() {
  if (!S.alerts.length) return null;
  const missing = t('No {immersion} is recorded for the period before the latest one');
  const night = S.grid ? S.grid.events.filter(noImmersionEvent).pop() : null;
  return h(
    'div',
    { class: 'alerts', id: 'status-alerts' },
    S.alerts.map(a =>
      alert(
        { kind: a.level === 'info' ? 'info' : 'warn' },
        h('span', {}, a.text),
        a.text.startsWith(missing)
          ? h(
              'span',
              { class: 'alert-action' },
              button({
                label: cap(t('Record that {immersion}')),
                size: 'sm',
                attrs: { id: 'record-missing-immersion' },
                onclick: () => openRecord({ kind: 'mikvah', mode: 'other', date: night ? night.startDate : today() }, 'record-missing-immersion'),
              }),
            )
          : null,
      ),
    ),
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
    S.status.detail ? h('p', { class: 'detail', id: 'status-detail' }, S.status.detail) : null,
    nextStep(),
    nowBox(),
    nextOnah
      ? h(
          'p',
          { class: 'next-line' },
          mark(withGrid(nextOnah)),
          h('span', {}, h('strong', {}, cap(t('Next {onat_perishah}: '))), plainTitle(nextOnah) + ', ' + nextOnah.when + '.'),
        )
      : null,
    sunToday && sunToday.sunset ? h('p', { class: 'sun-line' }, icon('moon', { size: 'sm' }), cap(t('{sunset} today: ')) + sunToday.sunset + '.') : null,
    alertsPart(),
  );
}

/** An upcoming item with its calendar event, for the mark (night or day, clean day number). */
function withGrid(u) {
  const g = S.grid ? S.grid.events.find(e => e.key === u.key) : null;
  return g || { kind: u.kind, light: u.light, projected: u.projected, title: u.title, key: u.key, startDate: u.date, endDate: u.endDate };
}

// ---------- coming up ----------

/** How many onot are listed before "Show more". */
const ONOT_SHOWN = 6;
let showAll = false;

/** A row of "Coming up": the mark, the title with its label, when, and the server's lines (its reasons, for an onah). */
function itemRow(it, extra) {
  const e = withGrid(it);
  const desc = describe(it, { dated: true, noAssumption: true });
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
          items.map(x => h('li', {}, h('strong', {}, 'Day ' + cleanDayNumber(x) + ', ' + x.when + '. '), h('span', { class: 'ev-desc' }, describe(x, { dated: true, noAssumption: true }).replace(/\n+/g, ' ')))),
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
      // What the calendar works out, from now on; not what she recorded.
      const items = S.upcoming.filter(u => !wasRecorded(u));
      const hefsek = items.filter(u => u.kind === 'hefsek');
      const clean = items.filter(u => u.kind === 'clean_day');
      const mikvah = items.filter(u => u.kind === 'mikvah');
      const onot = items.filter(u => u.kind === 'onah');
      const steps = [...hefsek, ...clean, ...mikvah];
      if (steps.length === 0 && onot.length === 0) return h('div', {}, emptyState({ icon: 'calendar', title: 'Nothing coming up.', body: t('Dates appear here once a {flow} is recorded.') }));
      const note = steps.map(assumption).find(Boolean) || '';
      const shown = showAll ? onot : onot.slice(0, ONOT_SHOWN);
      return h(
        'div',
        {},
        steps.length
          ? h(
              'section',
              { class: 'up-group', id: 'up-steps', 'aria-labelledby': 'up-steps-title' },
              h('h3', { id: 'up-steps-title' }, cap(t('until the {immersion}'))),
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
