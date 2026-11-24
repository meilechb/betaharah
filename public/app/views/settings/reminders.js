/* Settings: the Reminders card (plain sentences, advanced options, and the coming reminders). */
import { button, card, cardSection, emptyState, h, icon, selectField } from '../../lib.js';
import { S, t } from '../../store.js';
import { refresh, region, saveAppChange, saveStatus } from '../shared.js';

/** Errors of the number and time boxes, by id. */
const errors = {};
/** What was typed in a box whose value was refused (shown again with its error). */
const typed = {};
let showAllComing = false;

/** A number box inside a sentence; saved when it changes and is within range. */
function num(id, label, value, min, max, apply) {
  return h('input', {
    id,
    type: 'number',
    class: 'inline-num',
    min,
    max,
    step: 1,
    inputmode: 'numeric',
    value: errors[id] && typed[id] !== undefined ? typed[id] : value,
    'aria-label': label,
    'aria-invalid': errors[id] ? 'true' : null,
    'aria-describedby': errors[id] ? id + '-error' : null,
    onchange: e => {
      const v = Number(e.target.value);
      if (e.target.value === '' || !Number.isInteger(v) || v < min || v > max) {
        errors[id] = 'A whole number from ' + min + ' to ' + max + '.';
        typed[id] = e.target.value;
        refresh('rem-sentences');
        return;
      }
      delete errors[id];
      delete typed[id];
      saveAppChange('reminders', a => apply(a, v));
    },
  });
}

const timeValue = (hh, mm) => String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');

function time(id, label, hh, mm, apply) {
  return h('input', {
    id,
    type: 'time',
    class: 'inline-time',
    value: timeValue(hh, mm),
    'aria-label': label,
    onchange: e => {
      const [x, y] = e.target.value.split(':').map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        errors[id] = 'Enter a time.';
        refresh('rem-sentences');
        return;
      }
      delete errors[id];
      saveAppChange('reminders', a => apply(a, x, y));
    },
  });
}

/** One reminder: a checkbox, its sentence with boxes in it, and the errors of those boxes. */
function sentence(id, on, label, rest, ids, toggle) {
  const errs = ids.filter(x => errors[x]);
  return h(
    'div',
    { class: 'rem-row' + (on ? '' : ' off') },
    h('input', { type: 'checkbox', id, checked: on, onchange: e => saveAppChange('reminders', a => toggle(a, e.target.checked)) }),
    h('div', { class: 'rem-text' }, h('label', { for: id }, label), ' ', rest),
    errs.map(x => h('div', { class: 'error', id: x + '-error' }, icon('alert', { size: 'sm' }), h('span', {}, errors[x]))),
  );
}

function sentences() {
  return region('rem-sentences', () => {
    const r = S.app.reminders;
    const sunset = t('{sunset}');
    return h(
      'div',
      { class: 'rem-sentences' },
      sentence(
        'rem-hefsek',
        r.hefsek.on,
        t('Remind about the {hefsek}'),
        [num('rem-hefsek-min', t('Minutes before {sunset}, for the {hefsek}'), r.hefsek.minutesBeforeSunset, 20, 600, (a, v) => (a.reminders.hefsek.minutesBeforeSunset = v)), ' minutes before ' + sunset + ', on each day it can be done.'],
        ['rem-hefsek-min'],
        (a, on) => (a.reminders.hefsek.on = on),
      ),
      sentence(
        'rem-bedikot',
        r.bedikot.on,
        t('Remind about the {bedikot}'),
        [
          t('on each of the {clean_days}: in the morning at '),
          time('rem-bedikot-morning', 'Time of the morning reminder', r.bedikot.morningHour, r.bedikot.morningMinute, (a, x, y) => Object.assign(a.reminders.bedikot, { morningHour: x, morningMinute: y })),
          ', and ',
          num('rem-bedikot-min', t('Minutes before {sunset}, for the afternoon {bedikah}'), r.bedikot.minutesBeforeSunset, 20, 600, (a, v) => (a.reminders.bedikot.minutesBeforeSunset = v)),
          ' minutes before ' + sunset + '.',
        ],
        ['rem-bedikot-morning', 'rem-bedikot-min'],
        (a, on) => (a.reminders.bedikot.on = on),
      ),
      sentence(
        'rem-mikvah',
        r.mikvah.on,
        t('Remind about the {mikvah_night}'),
        [num('rem-mikvah-min', t('Minutes before {sunset}, for the {mikvah_night}'), r.mikvah.minutesBeforeSunset, 20, 600, (a, v) => (a.reminders.mikvah.minutesBeforeSunset = v)), ' minutes before ' + sunset + '.'],
        ['rem-mikvah-min'],
        (a, on) => (a.reminders.mikvah.on = on),
      ),
      sentence(
        'rem-confirm',
        r.mikvahConfirm.on,
        t('If no {immersion} was recorded, ask'),
        ['the next morning at ', h('span', { class: 'nowrap' }, time('rem-confirm-at', 'Time to ask', r.mikvahConfirm.hour, r.mikvahConfirm.minute, (a, x, y) => Object.assign(a.reminders.mikvahConfirm, { hour: x, minute: y })), '.')],
        ['rem-confirm-at'],
        (a, on) => (a.reminders.mikvahConfirm.on = on),
      ),
      sentence(
        'rem-onah',
        r.onah.on,
        t('Remind about each {onat_perishah}'),
        [num('rem-onah-min', t('Minutes before the {onah} begins'), r.onah.minutesBefore, 0, 1440, (a, v) => (a.reminders.onah.minutesBefore = v)), ' minutes before it begins.'],
        ['rem-onah-min'],
        (a, on) => (a.reminders.onah.on = on),
      ),
      selectField({
        id: 'sms-style',
        label: 'Wording of the texts',
        value: r.style,
        options: [
          { value: 'plain', label: 'Plain words' },
          { value: 'discreet', label: 'Discreet: letters and times only' },
        ],
        help: 'Texts are always in English letters, so that every phone can show them.',
        onchange: e => {
          const v = e.target.value;
          saveAppChange('reminders', a => (a.reminders.style = v));
        },
      }),
      h(
        'details',
        { class: 'advanced', id: 'rem-adv' },
        h('summary', {}, 'Advanced'),
        h(
          'div',
          { class: 'rem-row' },
          h('input', { type: 'checkbox', id: 'rem-rest', checked: r.beforeRestDays, onchange: e => saveAppChange('reminders', a => (a.reminders.beforeRestDays = e.target.checked)) }),
          h('div', { class: 'rem-text' }, h('label', { for: 'rem-rest' }, t('Send nothing on {shabbat} and {yom_tov}; send beforehand what falls on them.'))),
        ),
        h(
          'div',
          { class: 'rem-row plain-row' },
          h('div', { class: 'rem-text' }, t('Stop the {hefsek} reminders after '), num('rem-hefsek-days', t('Days of {hefsek} reminders'), r.hefsekMaxDays, 1, 30, (a, v) => (a.reminders.hefsekMaxDays = v)), ' days.'),
          errors['rem-hefsek-days'] ? h('div', { class: 'error', id: 'rem-hefsek-days-error' }, icon('alert', { size: 'sm' }), h('span', {}, errors['rem-hefsek-days'])) : null,
        ),
        h(
          'div',
          { class: 'rem-row plain-row' },
          h(
            'div',
            { class: 'rem-text' },
            'When a text arrives within ',
            num('boundary', t('Minutes after sunrise or {sunset}'), S.app.boundaryMarginMinutes, 0, 120, (a, v) => (a.boundaryMarginMinutes = v)),
            ' minutes after sunrise or ' + sunset + ', the reply asks which side of it was meant.',
          ),
          errors.boundary ? h('div', { class: 'error', id: 'boundary-error' }, icon('alert', { size: 'sm' }), h('span', {}, errors.boundary)) : null,
        ),
      ),
    );
  });
}

function coming() {
  return region('rem-coming', () => {
    if (S.reminders.length === 0) return h('div', {}, emptyState({ icon: 'bell', title: 'No reminders are scheduled.', body: 'They appear here once there is something to remind about.' }));
    const days = [];
    for (const r of S.reminders) {
      const m = /^(.*) (\d{1,2}:\d{2} [AP]M)$/.exec(r.when);
      const day = m ? m[1] : r.when;
      const clock = m ? m[2] : '';
      let d = days[days.length - 1];
      if (!d || d.day !== day) {
        d = { day, items: [] };
        days.push(d);
      }
      d.items.push({ ...r, clock });
    }
    const limit = 4;
    const shown = showAllComing ? days : days.slice(0, limit);
    return h(
      'div',
      {},
      h(
        'ol',
        { class: 'timeline' },
        shown.map(d =>
          h(
            'li',
            { class: 'tl-day' },
            h('h4', {}, d.day),
            h(
              'ul',
              {},
              d.items.map(x => h('li', { class: 'tl-item' }, h('span', { class: 'tl-time' }, x.clock), h('div', { class: 'tl-body' }, h('strong', {}, S.labels.reminders[x.kind] || x.kind), h('p', {}, x.text)))),
            ),
          ),
        ),
      ),
      days.length > limit
        ? button({
            label: showAllComing ? 'Show fewer' : 'Show all ' + S.reminders.length,
            variant: 'link',
            attrs: { id: 'rem-more', 'aria-expanded': String(showAllComing) },
            onclick: () => {
              showAllComing = !showAllComing;
              refresh('rem-coming');
            },
          })
        : null,
    );
  });
}

export function remindersCard() {
  const anyPhone = S.phones.some(p => p.texts && !p.optedOut);
  return card(
    { title: 'Reminders', icon: 'bell', headerAction: saveStatus('reminders'), className: 'reminders-card' },
    h('p', { class: 'card-intro' }, 'Which reminders exist, and when. Each phone chooses which of them it receives, under Phones.'),
    anyPhone ? null : h('p', { class: 'notice' }, icon('info', { size: 'sm' }), h('span', {}, 'No phone receives text reminders yet. Turn them on for a phone under Phones.')),
    sentences(),
    cardSection({ title: 'Coming reminders' }, coming()),
  );
}

