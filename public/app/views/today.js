/*
 * The Today tab: status, recording an event, and what is coming up.
 * Next owner: the dashboard agent.
 */
import { api, button, card, checkRow, emptyState, h, list, listRow, radioRow, textField, toast } from '../lib.js';
import { S, adopt, go, render, run, t, todayIso } from '../store.js';
import { onboardingCard } from '../onboarding.js';
import { alertsBlock } from './shared.js';

const newRec = () => ({ kind: null, mode: 'now', date: '', how: 'day', time: '', veset: true, note: '' });

/** The "record an event" form. */
let rec = newRec();

export function viewToday() {
  const main = h(
    'div',
    {},
    alertsBlock(),
    onboardingCard(),
    S.status
      ? h('section', { class: 'card status' }, h('p', { class: 'headline' }, S.status.headline), S.status.detail ? h('p', { class: 'detail' }, S.status.detail) : null)
      : card({}, h('p', {}, 'Nothing can be calculated until a location is chosen.'), button({ label: 'Choose your location', variant: 'primary', icon: 'map', onclick: () => go('settings') })),
    S.status ? recordCard() : null,
  );
  return h('div', { class: 'cols' }, main, S.status ? h('div', {}, upcomingCard()) : null);
}

function recordCard() {
  const kinds = ['flow', 'stain', 'hefsek', 'broken', 'mikvah'];
  const needsOnah = rec.kind === 'flow' || rec.kind === 'stain' || rec.kind === 'broken';
  const set = (key, value, redraw) => {
    rec[key] = value;
    if (redraw) render();
  };
  const radio = (name, value, label, current, onpick) => radioRow({ name: 'rec-' + name, value, label, checked: current === value, onchange: () => onpick(value) });

  let form = null;
  if (rec.kind) {
    const dateLabel = rec.kind === 'mikvah' ? 'The evening of the ' + t('{immersion}') : 'Date';
    form = h(
      'form',
      {
        class: 'record-form',
        onsubmit: e => {
          e.preventDefault();
          const body = { kind: rec.kind };
          if (rec.mode === 'now') body.when = 'now';
          else {
            body.date = rec.date;
            if (needsOnah) {
              if (rec.how === 'time') body.time = rec.time;
              else body.part = rec.how;
            }
          }
          if (rec.kind === 'flow') body.veset = rec.veset;
          if (rec.note.trim()) body.note = rec.note.trim();
          run(
            () => api('POST', '/api/entries', body),
            result => {
              adopt(result.state);
              rec = newRec();
              render();
              toast(result.message || 'Recorded.');
            },
            e.submitter,
          );
        },
      },
      h('hr'),
      h(
        'fieldset',
        { class: 'plain' },
        h('legend', {}, 'When?'),
        radio('mode', 'now', rec.kind === 'hefsek' ? 'Today' : rec.kind === 'mikvah' ? 'Tonight' : 'Now', rec.mode, v => set('mode', v, true)),
        radio('mode', 'other', 'Another time', rec.mode, v => {
          if (!rec.date) rec.date = todayIso();
          set('mode', v, true);
        }),
      ),
      rec.mode === 'other' ? textField({ id: 'rec-date', label: dateLabel, type: 'date', required: true, value: rec.date, max: todayIso(), oninput: e => set('date', e.target.value) }) : null,
      rec.mode === 'other' && needsOnah
        ? h(
            'div',
            { class: 'field' },
            radio('how', 'day', 'By day', rec.how, v => set('how', v, true)),
            radio('how', 'night', 'At night (the night that begins on the evening of that date)', rec.how, v => set('how', v, true)),
            radio('how', 'time', 'At a certain time', rec.how, v => set('how', v, true)),
            rec.how === 'time' ? h('input', { id: 'rec-time', type: 'time', required: true, value: rec.time, 'aria-label': 'Time', oninput: e => set('time', e.target.value) }) : null,
          )
        : null,
      rec.kind === 'flow' ? checkRow({ id: 'rec-veset', label: t('This {flow} counts for the {vesatot}'), checked: rec.veset, onchange: e => set('veset', e.target.checked) }) : null,
      textField({ id: 'rec-note', label: 'Note (optional)', maxlength: 200, value: rec.note, oninput: e => set('note', e.target.value) }),
      h('div', { class: 'actions' }, button({ label: 'Record', variant: 'primary', type: 'submit' }), button({ label: 'Cancel', onclick: () => ((rec = newRec()), render()) })),
    );
  }

  return card(
    { title: 'Record' },
    h(
      'div',
      { class: 'actions pick' },
      kinds.map(kind =>
        button({
          label: S.labels.kinds[kind],
          attrs: {
            id: 'rec-kind-' + kind,
            'aria-pressed': String(rec.kind === kind),
          },
          onclick: () => {
            rec = { ...newRec(), kind };
            render();
          },
        }),
      ),
    ),
    form,
  );
}

function upcomingCard() {
  return card(
    { title: 'Coming up' },
    S.upcoming.length === 0
      ? emptyState({ icon: 'calendar', title: 'Nothing coming up.' })
      : list(
          S.upcoming.map(e =>
            listRow({
              className: e.projected ? 'projected' : '',
              lead: h('span', { class: 'dot ' + e.kind + (e.light ? ' light' : ''), 'aria-hidden': 'true' }),
              title: e.title,
              meta: e.when,
              body: e.description ? h('details', {}, h('summary', {}, 'Details'), h('pre', {}, e.description)) : null,
            }),
          ),
        ),
  );
}
