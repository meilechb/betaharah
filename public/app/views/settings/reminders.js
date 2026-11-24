/* Settings: the Reminders card. Next owner: the dashboard agent. */
import { cap, card, cardSection, checkRow, emptyState, h, inlineField, list, listRow, numberRow, selectField, button } from '../../lib.js';
import { S, draft, t } from '../../store.js';
import { saveApp } from '../shared.js';

export function remindersCard() {
  const r = draft.app.reminders;
  const a = draft.app;
  const toggle = (id, obj, label) => checkRow({ id, label, checked: obj.on, onchange: e => (obj.on = e.target.checked) });
  const timeValue = (hh, mm) => String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  const timeInput = (id, label, hh, mm, onchange) =>
    inlineField({
      label,
      control: h('input', {
        id,
        type: 'time',
        value: timeValue(hh, mm),
        oninput: e => {
          const [x, y] = e.target.value.split(':').map(Number);
          if (Number.isFinite(x) && Number.isFinite(y)) onchange(x, y);
        },
      }),
    });
  const sunset = t('{sunset}');
  return card(
    { title: 'Reminders', intro: 'These choose which reminders exist and when. Each phone chooses which of them it receives, above. Nothing is sent to a phone until reminders are turned on for it.' },
    h(
      'fieldset',
      {},
      toggle('rem-hefsek', r.hefsek, cap(t('{hefsek}, on each day it can be done'))),
      h('div', { class: 'indent' }, numberRow({ id: 'rem-hefsek-min', label: 'Minutes before ' + sunset, value: r.hefsek.minutesBeforeSunset, onchange: v => (r.hefsek.minutesBeforeSunset = v), min: 20, max: 600 }),
      numberRow({ id: 'rem-hefsek-days', label: 'Stop after this many days', value: r.hefsekMaxDays, onchange: v => (r.hefsekMaxDays = v), min: 1, max: 30 })),
    ),
    h(
      'fieldset',
      {},
      toggle('rem-bedikot', r.bedikot, cap(t('{bedikot}, on each of the {clean_days}'))),
      h('div', { class: 'indent' }, timeInput('rem-bedikot-morning', 'Morning reminder at', r.bedikot.morningHour, r.bedikot.morningMinute, (x, y) => {
        r.bedikot.morningHour = x;
        r.bedikot.morningMinute = y;
      }),
      numberRow({ id: 'rem-bedikot-min', label: 'Afternoon reminder, minutes before ' + sunset, value: r.bedikot.minutesBeforeSunset, onchange: v => (r.bedikot.minutesBeforeSunset = v), min: 20, max: 600 })),
    ),
    h(
      'fieldset',
      {},
      toggle('rem-mikvah', r.mikvah, cap(t('{mikvah_night}'))),
      h('div', { class: 'indent' }, numberRow({ id: 'rem-mikvah-min', label: 'Minutes before ' + sunset, value: r.mikvah.minutesBeforeSunset, onchange: v => (r.mikvah.minutesBeforeSunset = v), min: 20, max: 600 })),
    ),
    h(
      'fieldset',
      {},
      toggle('rem-confirm', r.mikvahConfirm, t('Ask the next morning if no {immersion} was recorded')),
      h('div', { class: 'indent' }, timeInput('rem-confirm-at', 'At', r.mikvahConfirm.hour, r.mikvahConfirm.minute, (x, y) => {
        r.mikvahConfirm.hour = x;
        r.mikvahConfirm.minute = y;
      })),
    ),
    h(
      'fieldset',
      {},
      toggle('rem-onah', r.onah, cap(t('each {onat_perishah}'))),
      h('div', { class: 'indent' }, numberRow({ id: 'rem-onah-min', label: t('Minutes before the {onah} begins'), value: r.onah.minutesBefore, onchange: v => (r.onah.minutesBefore = v), min: 0, max: 1440 })),
    ),
    h(
      'fieldset',
      {},
      checkRow({ id: 'rem-rest', label: t('Send nothing on {shabbat} and {yom_tov}; send beforehand what falls on them'), checked: r.beforeRestDays, onchange: e => (r.beforeRestDays = e.target.checked) }),
      selectField({
        id: 'sms-style',
        label: 'Wording of the texts',
        value: r.style,
        options: [
          { value: 'plain', label: 'Plain words' },
          { value: 'discreet', label: 'Discreet: letters and times only' },
        ],
        help: 'Texts are always in English letters, so that every phone can show them.',
        onchange: e => (r.style = e.target.value),
      }),
      numberRow({ id: 'boundary', label: 'When a text arrives within this many minutes after sunrise or sunset, the reply asks which side it was', value: a.boundaryMarginMinutes, onchange: v => (a.boundaryMarginMinutes = v), min: 0, max: 120 }),
    ),
    h('div', { class: 'actions' }, button({ label: 'Save reminders', variant: 'primary', onclick: e => saveApp('Reminders saved.', e.currentTarget) })),
    cardSection(
      { title: 'Coming reminders' },
      S.reminders.length === 0
        ? emptyState({ icon: 'bell', title: 'None scheduled.' })
        : list(S.reminders.map(x => listRow({ meta: x.when + ' · ' + (S.labels.reminders[x.kind] || x.kind), body: h('div', { class: 'mono' }, x.text) }))),
    ),
  );
}
