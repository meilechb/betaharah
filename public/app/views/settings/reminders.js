/*
 * Settings: Reminders. Each kind is a row with a switch and its timing in
 * plain words; "Change" opens the row to edit the timing. Shabbat and Yom
 * Tov, the wording (with an example of each), the rare options under
 * "Advanced", and the coming reminders as their own view
 * (#settings/reminders/scheduled).
 */
import { emptyState, h, icon } from '../../lib.js';
import { S, t } from '../../store.js';
import { refresh, region } from '../shared.js';
import { blockRow, choiceCards, clock, duration, errorText, group, more, navRow, saveApp, switchRow, tn } from './ui.js';

/** The row whose timing is open for editing. */
let editing = null;
/** Errors of the number and time boxes, by id, and what was typed in a refused box. */
const errors = {};
const typed = {};


/** A number box with its label; saved when it changes and is within range. */
function numberField(id, label, value, min, max, unit, apply, regionId) {
  return h(
    'div',
    { class: 'field st-num' },
    h('label', { for: id }, label),
    h(
      'div',
      { class: 'st-inline' },
      h('input', {
        id,
        type: 'number',
        min,
        max,
        step: 1,
        inputmode: 'numeric',
        value: errors[id] && typed[id] !== undefined ? typed[id] : value,
        'aria-invalid': errors[id] ? 'true' : null,
        'aria-describedby': id + '-help' + (errors[id] ? ' ' + id + '-error' : ''),
        onchange: e => {
          const v = Number(e.target.value);
          if (e.target.value === '' || !Number.isInteger(v) || v < min || v > max) {
            errors[id] = 'A whole number from ' + min + ' to ' + max + '.';
            typed[id] = e.target.value;
            refresh(regionId || 'rem-kinds');
            return;
          }
          delete errors[id];
          delete typed[id];
          saveApp('reminders', a => apply(a, v));
        },
      }),
      h('span', { class: 'st-unit' }, unit),
    ),
    h('p', { class: 'help', id: id + '-help' }, 'From ' + min + ' to ' + max + '.'),
    errorText(id + '-error', errors[id]),
  );
}

function timeField(id, label, hh, mm, apply) {
  return h(
    'div',
    { class: 'field st-num' },
    h('label', { for: id }, label),
    h('input', {
      id,
      type: 'time',
      value: String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'),
      'aria-invalid': errors[id] ? 'true' : null,
      'aria-describedby': errors[id] ? id + '-error' : null,
      onchange: e => {
        const [x, y] = e.target.value.split(':').map(Number);
        if (!e.target.value || !Number.isFinite(x) || !Number.isFinite(y)) {
          errors[id] = 'Enter a time.';
          refresh('rem-kinds');
          return;
        }
        delete errors[id];
        saveApp('reminders', a => apply(a, x, y));
      },
    }),
    errorText(id + '-error', errors[id]),
  );
}

/** The five kinds of reminder the account sets the time of. */
function kinds() {
  const r = S.app.reminders;
  return [
    {
      id: 'hefsek',
      on: r.hefsek.on,
      title: '{hefsek}',
      when: duration(r.hefsek.minutesBeforeSunset) + ' before {sunset}, on each day it can be done',
      set: (a, on) => (a.reminders.hefsek.on = on),
      edit: () => [numberField('rem-hefsek-min', t('Minutes before {sunset}'), r.hefsek.minutesBeforeSunset, 20, 600, 'minutes', (a, v) => (a.reminders.hefsek.minutesBeforeSunset = v))],
    },
    {
      id: 'bedikot',
      on: r.bedikot.on,
      title: '{bedikot}',
      when: 'On each of the {clean_days}: ' + clock(r.bedikot.morningHour, r.bedikot.morningMinute) + ', and ' + duration(r.bedikot.minutesBeforeSunset) + ' before {sunset}',
      set: (a, on) => (a.reminders.bedikot.on = on),
      edit: () => [
        timeField('rem-bedikot-morning', 'Morning reminder at', r.bedikot.morningHour, r.bedikot.morningMinute, (a, x, y) => Object.assign(a.reminders.bedikot, { morningHour: x, morningMinute: y })),
        numberField('rem-bedikot-min', t('Afternoon reminder: minutes before {sunset}'), r.bedikot.minutesBeforeSunset, 20, 600, 'minutes', (a, v) => (a.reminders.bedikot.minutesBeforeSunset = v)),
      ],
    },
    {
      id: 'mikvah',
      on: r.mikvah.on,
      title: '{mikvah_night}',
      when: duration(r.mikvah.minutesBeforeSunset) + ' before {sunset} on the day',
      set: (a, on) => (a.reminders.mikvah.on = on),
      edit: () => [numberField('rem-mikvah-min', t('Minutes before {sunset}'), r.mikvah.minutesBeforeSunset, 20, 600, 'minutes', (a, v) => (a.reminders.mikvah.minutesBeforeSunset = v))],
    },
    {
      id: 'confirm',
      on: r.mikvahConfirm.on,
      title: '{immersion} not recorded',
      when: 'If no {immersion} was recorded, a question the next morning at ' + clock(r.mikvahConfirm.hour, r.mikvahConfirm.minute),
      set: (a, on) => (a.reminders.mikvahConfirm.on = on),
      edit: () => [timeField('rem-confirm-at', 'Ask the next morning at', r.mikvahConfirm.hour, r.mikvahConfirm.minute, (a, x, y) => Object.assign(a.reminders.mikvahConfirm, { hour: x, minute: y }))],
    },
    {
      id: 'onah',
      on: r.onah.on,
      title: '{onat_perishah}',
      when: duration(r.onah.minutesBefore) + ' before each one begins',
      set: (a, on) => (a.reminders.onah.on = on),
      edit: () => [numberField('rem-onah-min', 'Minutes before it begins', r.onah.minutesBefore, 0, 1440, 'minutes', (a, v) => (a.reminders.onah.minutesBefore = v))],
    },
  ];
}

function kindRow(k) {
  const open = editing === k.id;
  const hasError = Object.keys(errors).some(id => id.startsWith('rem-' + k.id));
  return h(
    'div',
    { class: 'st-row st-kind' + (k.on ? '' : ' off') + (open ? ' open' : '') },
    h(
      'div',
      { class: 'st-kind-line' },
      h(
        'button',
        {
          type: 'button',
          class: 'st-kind-open',
          id: 'rem-open-' + k.id,
          'aria-expanded': String(open),
          'aria-controls': 'rem-edit-' + k.id,
          onclick: () => {
            editing = open ? null : k.id;
            refresh('rem-kinds');
          },
        },
        h('span', { class: 'st-text' }, h('span', { class: 'st-title', id: 'rem-title-' + k.id }, tn(k.title, true)), h('span', { class: 'st-summary', id: 'rem-when-' + k.id }, k.on ? [tn(k.when, true), '.'] : 'Off.'), hasError && !open ? h('span', { class: 'st-flag bad' }, icon('alert', { size: 'sm' }), 'Not saved') : null),
        h('span', { class: 'st-edit-word' }, open ? 'Close' : 'Change', icon(open ? 'chevron-up' : 'chevron-down', { size: 'sm' })),
      ),
      h(
        'span',
        { class: 'st-switch' },
        h('input', {
          type: 'checkbox',
          role: 'switch',
          id: 'rem-' + k.id,
          checked: k.on,
          'aria-labelledby': 'rem-title-' + k.id,
          'aria-describedby': 'rem-when-' + k.id,
          onchange: e => {
            const on = e.target.checked;
            saveApp('reminders', a => k.set(a, on));
          },
        }),
        h('span', { class: 'st-track', 'aria-hidden': 'true' }, h('span', { class: 'st-thumb' })),
      ),
    ),
    open ? h('div', { class: 'st-kind-edit', id: 'rem-edit-' + k.id }, k.edit(), h('p', { class: 'help' }, 'Saved when you leave a box.')) : null,
  );
}

const EXAMPLES = {
  plain: 'Mikvah night: Thu Nov 26, after 5:18 PM. Reply 4 after immersing.',
  discreet: 'M night: Thu Nov 26 after 5:18 PM. Reply 4 after.',
};

function mainView() {
  const r = S.app.reminders;
  const anyPhone = S.phones.some(p => p.texts && !p.optedOut);
  const count = S.reminders.length;
  return {
    title: 'Reminders',
    parent: '',
    statusKey: 'reminders',
    lead: 'Which reminders exist, and when they are sent. Each phone chooses which of them it receives, under Phones.',
    body: [
      !S.sms.ready
        ? h('p', { class: 'st-note' }, icon('info', { size: 'sm' }), h('span', {}, 'Text messaging is not available on this site yet, so no reminder is sent. What you set here applies once it is.'))
        : !anyPhone
          ? h('p', { class: 'st-note' }, icon('info', { size: 'sm' }), h('span', {}, 'No phone receives text reminders yet. ', h('a', { href: '#settings/phones' }, 'Turn them on for a phone under Phones'), '.'))
          : null,
      group({ title: 'Kinds of reminder', id: 'rem-kinds-group', footer: 'Times are for the place under Location.' }, region('rem-kinds', () => h('div', { class: 'st-rows-inner' }, kinds().map(kindRow)))),
      group(
        { title: tn('{shabbat} and {yom_tov}'), id: 'rem-rest-group' },
        switchRow({
          id: 'rem-rest',
          label: tn('Send nothing on {shabbat} or {yom_tov}'),
          help: r.beforeRestDays
            ? tn('On. A reminder that falls on {shabbat} or {yom_tov} is sent before it begins, or after it ends when that is when it is useful.')
            : tn('Off. Reminders are sent at their time, also on {shabbat} and {yom_tov}.'),
          checked: r.beforeRestDays,
          onchange: e => {
            const on = e.target.checked;
            saveApp('reminders', a => (a.reminders.beforeRestDays = on));
          },
        }),
      ),
      group(
        { title: 'Wording of the texts', id: 'rem-style-group', footer: 'One setting for every phone. Texts are always in English letters, so that every phone can show them.' },
        blockRow(
          choiceCards({
            name: 'sms-style',
            legend: 'Wording of the texts',
            value: r.style,
            options: [
              { value: 'plain', label: 'Plain words', help: 'Says what each reminder is about.', example: h('span', { class: 'st-example' }, h('span', { class: 'visually-hidden' }, 'Example: '), EXAMPLES.plain) },
              { value: 'discreet', label: 'Discreet', help: 'Letters and times only, for a phone others may see.', example: h('span', { class: 'st-example' }, h('span', { class: 'visually-hidden' }, 'Example: '), EXAMPLES.discreet) },
            ],
            onchange: v => saveApp('reminders', a => (a.reminders.style = v)),
          }),
        ),
      ),
      group(
        { title: 'Coming reminders', id: 'rem-coming-group' },
        navRow({ path: 'reminders/scheduled', id: 'rem-scheduled', icon: 'clock', title: 'See what is scheduled', summary: count ? (count === 1 ? '1 reminder' : count + ' reminders') + ', the next ' + nextWhen() : 'Nothing is scheduled now' }),
      ),
      more(
        { id: 'rem-adv', summary: 'Advanced' },
        group(
          { title: tn('{hefsek} reminders', true), intro: tn('When the {hefsek} keeps being put off, its reminders stop after this many days.') },
          region('rem-adv-days', () => blockRow(numberField('rem-hefsek-days', 'Stop after', r.hefsekMaxDays, 1, 30, 'days', (a, v) => (a.reminders.hefsekMaxDays = v), 'rem-adv-days'))),
        ),
        group(
          { title: tn('Texts close to sunrise or {sunset}'), intro: tn('When a text arrives within this many minutes after sunrise or {sunset}, the reply asks which side of it was meant.') },
          region('rem-adv-margin', () => blockRow(numberField('boundary', 'Ask within', S.app.boundaryMarginMinutes, 0, 120, 'minutes', (a, v) => (a.boundaryMarginMinutes = v), 'rem-adv-margin'))),
        ),
      ),
    ],
  };
}

function nextWhen() {
  const first = S.reminders[0];
  return first ? first.when.replace(/^(\w{3}) (\w{3}) (\d+) /, '$1, $2 $3, ') : '';
}

function scheduledView() {
  const body = () => {
    if (S.reminders.length === 0) {
      return emptyState({
        icon: 'bell',
        title: 'No reminders are scheduled.',
        body: S.app.place ? 'They appear here once there is something to remind about, for example after a new start is recorded.' : 'Choose a location first. Nothing can be scheduled without it.',
      });
    }
    const days = [];
    for (const r of S.reminders) {
      const m = /^(.*) (\d{1,2}:\d{2} [AP]M)$/.exec(r.when);
      const day = m ? m[1] : r.when;
      let d = days[days.length - 1];
      if (!d || d.day !== day) {
        d = { day, items: [] };
        days.push(d);
      }
      d.items.push({ ...r, clock: m ? m[2] : '' });
    }
    const who = S.phones.filter(p => p.texts && !p.optedOut);
    return h(
      'div',
      {},
      h('p', { class: 'st-lead-text' }, who.length ? 'Sent to the phones that receive that kind: ' + who.map(p => p.name || p.number).join(', ') + '.' : 'No phone receives reminders now, so these are not sent.'),
      h(
        'ol',
        { class: 'st-timeline' },
        days.map(d =>
          h(
            'li',
            { class: 'st-tl-day' },
            h('h3', {}, d.day.replace(/^(\w{3}) (\w{3}) (\d+)$/, '$1, $2 $3')),
            h(
              'ul',
              {},
              d.items.map(x =>
                h(
                  'li',
                  { class: 'st-tl-item' },
                  h('span', { class: 'st-tl-time' }, x.clock),
                  h('div', { class: 'st-tl-body' }, h('p', { class: 'st-title' }, S.labels.reminders[x.kind] || x.kind), h('p', { class: 'st-tl-text' }, x.text)),
                ),
              ),
            ),
          ),
        ),
      ),
      h('p', { class: 'help' }, S.reminders.length >= 30 ? 'The first 30 are shown. ' : '', 'This list changes when a date is recorded or a setting is changed.'),
    );
  };
  return { title: 'Scheduled reminders', parent: 'reminders', backLabel: 'Reminders', body: body() };
}

export const remindersSection = {
  id: 'reminders',
  title: 'Reminders',
  icon: 'bell',
  summary: () => {
    const on = kinds().filter(k => k.on).length;
    const r = S.app.reminders;
    return [on === 0 ? 'All off' : on + ' of 5 kinds on', ' · ', tn(r.beforeRestDays ? 'nothing sent on {shabbat} or {yom_tov}' : 'also sent on {shabbat} and {yom_tov}')];
  },
  flag: () => {
    if (!S.sms.ready) return null;
    if (!S.phones.some(p => p.texts && !p.optedOut)) return { kind: 'info', text: 'No phone receives them yet' };
    return null;
  },
  view: rest => (rest[0] === 'scheduled' ? scheduledView() : mainView()),
};
