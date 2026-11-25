/*
 * Settings: Reminders. Each kind is a row with a switch and its timing in
 * a few words; "Change" opens the row to edit the timing (the bedikot: the
 * clean days as seven buttons, and the morning and before-sunset parts, each
 * a switch with its time). The time of the one text before Shabbat and Yom
 * Tov, the wording (with an example of each), the rare options under
 * "Advanced", and the coming reminders as their own view
 * (#settings/reminders/scheduled).
 */
import { emptyState, h, icon, pretty } from '../../lib.js';
import { S, t } from '../../store.js';
import { refresh, region } from '../shared.js';
import { blockRow, choiceCards, clock, duration, errorText, group, more, navRow, saveApp, tn } from './ui.js';

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

/** A time box; `labelledBy` names it by another element instead of a label of its own. */
function timeInput(id, hh, mm, apply, regionId, labelledBy) {
  return h('input', {
    id,
    type: 'time',
    value: String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'),
    'aria-labelledby': labelledBy || null,
    'aria-invalid': errors[id] ? 'true' : null,
    'aria-describedby': errors[id] ? id + '-error' : null,
    onchange: e => {
      const [x, y] = e.target.value.split(':').map(Number);
      if (!e.target.value || !Number.isFinite(x) || !Number.isFinite(y)) {
        errors[id] = 'Enter a time.';
        refresh(regionId || 'rem-kinds');
        return;
      }
      delete errors[id];
      saveApp('reminders', a => apply(a, x, y));
    },
  });
}

function timeField(id, label, hh, mm, apply) {
  return h('div', { class: 'field st-num' }, h('label', { for: id }, label), timeInput(id, hh, mm, apply), errorText(id + '-error', errors[id]));
}

/** A small number box with its unit, named by another element; its range is said only when a number is refused. */
function minutesInput(id, value, min, max, apply, labelledBy) {
  return h(
    'span',
    { class: 'st-inline' },
    h('input', {
      id,
      type: 'number',
      min,
      max,
      step: 1,
      inputmode: 'numeric',
      value: errors[id] && typed[id] !== undefined ? typed[id] : value,
      'aria-labelledby': labelledBy + ' ' + id + '-unit',
      'aria-invalid': errors[id] ? 'true' : null,
      'aria-describedby': errors[id] ? id + '-error' : null,
      onchange: e => {
        const v = Number(e.target.value);
        if (e.target.value === '' || !Number.isInteger(v) || v < min || v > max) {
          errors[id] = 'A whole number from ' + min + ' to ' + max + '.';
          typed[id] = e.target.value;
          refresh('rem-kinds');
          return;
        }
        delete errors[id];
        delete typed[id];
        saveApp('reminders', a => apply(a, v));
      },
    }),
    h('span', { class: 'st-unit', id: id + '-unit' }, 'min'),
  );
}

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const sameDays = (a, b) => a.length === b.length && a.every((d, i) => d === b[i]);

/** The clean days that get bedikah reminders, in a few words: '' for all seven. */
function daysWords(days) {
  if (sameDays(days, ALL_DAYS)) return '';
  if (days.length === 0) return 'No days';
  return (days.length === 1 ? 'Day ' : 'Days ') + (days.length === 2 ? days.join(' and ') : days.join(', '));
}

/** Seven day buttons that toggle, with "All" and "1 and 7". */
function dayPicker(b) {
  const setDays = days => saveApp('reminders', a => (a.reminders.bedikot = { ...a.reminders.bedikot, days }));
  const quick = (id, label, days) =>
    h('button', { type: 'button', class: 'st-day-quick', id, 'aria-pressed': String(sameDays(b.days, days)), onclick: () => setDays(days) }, label);
  return h(
    'div',
    { class: 'st-days', role: 'group', 'aria-labelledby': 'rem-days-label' },
    h('span', { class: 'st-part-name', id: 'rem-days-label' }, 'Days'),
    h(
      'div',
      { class: 'st-days-row' },
      ALL_DAYS.map(d =>
        h(
          'button',
          {
            type: 'button',
            class: 'st-day',
            id: 'rem-day-' + d,
            'aria-pressed': String(b.days.includes(d)),
            'aria-label': 'Day ' + d,
            onclick: () => setDays(b.days.includes(d) ? b.days.filter(x => x !== d) : ALL_DAYS.filter(x => x === d || b.days.includes(x))),
          },
          String(d),
        ),
      ),
      h('span', { class: 'st-days-quick' }, quick('rem-days-all', 'All', ALL_DAYS), quick('rem-days-17', '1 and 7', [1, 7])),
    ),
  );
}

/** One part of the bedikot (morning, before sunset): a switch, its name, and its time beside it. */
function partRow(id, name, on, set, control, errorId) {
  return h(
    'div',
    { class: 'st-part' + (on ? '' : ' off') },
    h(
      'span',
      { class: 'st-switch' },
      h('input', { type: 'checkbox', role: 'switch', id, checked: on, 'aria-labelledby': id + '-name', onchange: e => saveApp('reminders', a => set(a, e.target.checked)) }),
      h('span', { class: 'st-track', 'aria-hidden': 'true' }, h('span', { class: 'st-thumb' })),
    ),
    h('label', { class: 'st-part-name', id: id + '-name', for: id }, name),
    control,
    errorText(errorId + '-error', errors[errorId]),
  );
}

function bedikotEdit(r) {
  const b = r.bedikot;
  return [
    dayPicker(b),
    partRow(
      'rem-bedikot-am',
      'Morning',
      b.morning,
      (a, on) => (a.reminders.bedikot = { ...a.reminders.bedikot, morning: on }),
      timeInput('rem-bedikot-morning', b.morningHour, b.morningMinute, (a, x, y) => (a.reminders.bedikot = { ...a.reminders.bedikot, morningHour: x, morningMinute: y }), 'rem-kinds', 'rem-bedikot-am-name'),
      'rem-bedikot-morning',
    ),
    partRow(
      'rem-bedikot-pm',
      tn('Before {sunset}', true),
      b.beforeSunset,
      (a, on) => (a.reminders.bedikot = { ...a.reminders.bedikot, beforeSunset: on }),
      minutesInput('rem-bedikot-min', b.minutesBeforeSunset, 20, 600, (a, v) => (a.reminders.bedikot = { ...a.reminders.bedikot, minutesBeforeSunset: v }), 'rem-bedikot-pm-name'),
      'rem-bedikot-min',
    ),
  ];
}

/** The bedikot row's summary: the days (when not all seven), then the times of the parts that are on. */
function bedikotWhen(b) {
  const parts = [];
  if (b.morning) parts.push(clock(b.morningHour, b.morningMinute));
  if (b.beforeSunset) parts.push(duration(b.minutesBeforeSunset) + ' before {sunset}');
  const times = parts.length ? parts.join(' and ') : 'No times';
  const days = daysWords(b.days);
  return days ? days + ' · ' + times : times;
}

/** The five kinds of reminder the account sets the time of. */
function kinds() {
  const r = S.app.reminders;
  return [
    {
      id: 'hefsek',
      on: r.hefsek.on,
      title: '{hefsek}',
      when: duration(r.hefsek.minutesBeforeSunset) + ' before {sunset}',
      set: (a, on) => (a.reminders.hefsek.on = on),
      edit: () => [numberField('rem-hefsek-min', t('Minutes before {sunset}'), r.hefsek.minutesBeforeSunset, 20, 600, 'minutes', (a, v) => (a.reminders.hefsek.minutesBeforeSunset = v))],
    },
    {
      id: 'bedikot',
      on: r.bedikot.on,
      title: '{bedikot}',
      when: bedikotWhen(r.bedikot),
      set: (a, on) => (a.reminders.bedikot.on = on),
      edit: () => bedikotEdit(r),
    },
    {
      id: 'mikvah',
      on: r.mikvah.on,
      title: '{mikvah_night}',
      when: duration(r.mikvah.minutesBeforeSunset) + ' before {sunset}',
      set: (a, on) => (a.reminders.mikvah.on = on),
      edit: () => [numberField('rem-mikvah-min', t('Minutes before {sunset}'), r.mikvah.minutesBeforeSunset, 20, 600, 'minutes', (a, v) => (a.reminders.mikvah.minutesBeforeSunset = v))],
    },
    {
      id: 'book',
      on: r.mikvahBook.on,
      title: 'Book the mikvah',
      when: clock(r.mikvahBook.hour, r.mikvahBook.minute) + ', the day after the {hefsek}',
      set: (a, on) => (a.reminders.mikvahBook.on = on),
      edit: () => [timeField('rem-book-at', 'Send at', r.mikvahBook.hour, r.mikvahBook.minute, (a, x, y) => Object.assign(a.reminders.mikvahBook, { hour: x, minute: y }))],
    },
    {
      id: 'onah',
      on: r.onah.on,
      title: '{onat_perishah}',
      when: duration(r.onah.minutesBefore) + ' before it begins',
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
  plain: 'Mikvah night: Thu night, after 5:18 PM.',
  discreet: 'M night: Thu night after 5:18 PM.',
};

function mainView() {
  const r = S.app.reminders;
  const anyPhone = S.phones.some(p => p.texts && !p.optedOut);
  const count = S.reminders.length;
  return {
    title: 'Reminders',
    parent: '',
    statusKey: 'reminders',
    body: [
      !S.sms.ready
        ? h('p', { class: 'st-note' }, icon('info', { size: 'sm' }), h('span', {}, 'Texting is not available yet.'))
        : S.phones.length === 0
          ? h('p', { class: 'st-note' }, icon('info', { size: 'sm' }), h('span', {}, 'No phone yet. ', h('a', { href: '#settings/phones/add' }, 'Add a phone'), '.'))
          : !anyPhone
            ? h('p', { class: 'st-note' }, icon('info', { size: 'sm' }), h('span', {}, 'No phone gets them. ', h('a', { href: '#settings/phones' }, 'Phones'), '.'))
            : null,
      group({ title: 'Kinds', id: 'rem-kinds-group' }, region('rem-kinds', () => h('div', { class: 'st-rows-inner' }, kinds().map(kindRow)))),
      group(
        { id: 'rem-rest-group' },
        region('rem-rest', () =>
          h(
            'div',
            { class: 'st-row st-rest' },
            h('label', { class: 'st-title', for: 'rem-rest-eve' }, tn('Before {shabbat} and {yom_tov}')),
            timeInput('rem-rest-eve', r.restEve.hour, r.restEve.minute, (a, x, y) => (a.reminders.restEve = { hour: x, minute: y }), 'rem-rest'),
            errorText('rem-rest-eve-error', errors['rem-rest-eve']),
          ),
        ),
      ),
      group(
        { title: 'Wording', id: 'rem-style-group', footer: 'For every phone.' },
        blockRow(
          choiceCards({
            name: 'sms-style',
            legend: 'Wording of the texts',
            value: r.style,
            options: [
              { value: 'plain', label: 'Plain words', help: null, example: h('span', { class: 'st-example' }, h('span', { class: 'visually-hidden' }, 'Example: '), EXAMPLES.plain) },
              { value: 'discreet', label: 'Discreet', help: null, example: h('span', { class: 'st-example' }, h('span', { class: 'visually-hidden' }, 'Example: '), EXAMPLES.discreet) },
            ],
            onchange: v => saveApp('reminders', a => (a.reminders.style = v)),
          }),
        ),
      ),
      group(
        { title: 'Scheduled', id: 'rem-coming-group' },
        navRow({ path: 'reminders/scheduled', id: 'rem-scheduled', icon: 'clock', title: count ? (count === 1 ? '1 reminder' : count + ' reminders') : 'None', summary: count ? 'Next: ' + nextWhen() : null }),
      ),
      more(
        { id: 'rem-adv', summary: 'Advanced' },
        group(
          { title: tn('{hefsek} reminders', true), intro: null },
          region('rem-adv-days', () => blockRow(numberField('rem-hefsek-days', 'Stop after', r.hefsekMaxDays, 1, 30, 'days', (a, v) => (a.reminders.hefsekMaxDays = v), 'rem-adv-days'))),
        ),
        group(
          { title: tn('Texts close to sunrise or {sunset}'), intro: 'The reply asks: day or night?' },
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
        title: 'None scheduled.',
        body: S.app.place ? null : 'Choose a location first.',
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
      h('p', { class: 'st-lead-text' }, who.length ? 'Sent to the phones that receive that kind: ' + who.map(p => p.name || pretty(p.number)).join(', ') + '.' : S.phones.length === 0 ? 'No phone yet; nothing is sent.' : 'No phone gets reminders; nothing is sent.'),
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
      S.reminders.length >= 30 ? h('p', { class: 'help' }, 'The first 30 are shown.') : null,
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
    return on === 0 ? 'All off' : on + ' of 5 kinds on';
  },
  flag: () => {
    if (!S.sms.ready) return null;
    if (S.phones.length === 0) return { kind: 'info', text: 'No phone yet' };
    if (!S.phones.some(p => p.texts && !p.optedOut)) return { kind: 'info', text: 'No phone receives them yet' };
    return null;
  },
  view: rest => (rest[0] === 'scheduled' ? scheduledView() : mainView()),
};
