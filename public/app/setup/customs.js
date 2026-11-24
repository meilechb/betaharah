/*
 * Setup step: the household's customs. The options are the server's texts,
 * shown exactly as sent (never reworded), in four short screens instead of
 * one long form. Saving with PUT /api/halachic marks them confirmed, so it
 * happens only when the person confirms; "keep the stricter defaults for now"
 * saves nothing and leaves them unconfirmed.
 */
import { alert, api, cap, clone, h, icon, radioGroup, radioRow, tag, withBusy } from '../lib.js';
import { S, adopt, render, t, when } from '../store.js';
import { back, flow, next, onEnter, problem, screen, termsSwitch } from './flow.js';

/** The four screens, by the keys of the server's choices. Choices not named here go on the last screen. */
const GROUPS = [
  { title: () => cap(t('{hefsek} and {immersion}')), keys: ['minWaitDays', 'tzeit'] },
  { title: () => cap(t('{onah_beinonit} and {veset_hachodesh}')), keys: ['beinonitDays', 'beinonitLength', 'chodeshLength', 'chodesh30'] },
  { title: () => cap(t('{veset_haflagah} and {or_zarua}')), keys: ['haflagahMethod', 'longerHaflagah', 'orZarua'] },
  { title: () => 'Special cases', keys: ['longCycle', 'vesatot', 'yomTov'] },
];

let part = 0; // 0: the explanation; 1..4: the screens of choices
let d = null; // the choices being made, saved only on confirm
let error = '';

onEnter('customs', () => {
  d = clone(S.halachic.settings);
  error = '';
  part = 0;
});

function groupsWithChoices() {
  const known = new Set(GROUPS.flatMap(g => g.keys));
  const extra = S.halachic.choices.filter(c => !known.has(c.key)).map(c => c.key);
  return GROUPS.map((g, i) => ({ ...g, keys: i === GROUPS.length - 1 ? [...g.keys, ...extra] : g.keys }));
}

const sameRule = (a, b) => a.kind === b.kind && Number(a.value) === Number(b.value);

/** "Used now" marks the option the calendar uses until the customs are confirmed. */
function usedNow(value) {
  return !S.halachic.confirmedAt && value ? h('span', { class: 'used-now' }, ' ', tag('used now', 'info')) : null;
}

function choiceGroup(c) {
  const current = S.halachic.settings[c.key];
  return radioGroup({
    legend: c.title,
    help: c.help || null,
    name: 'sc-' + c.key,
    value: d[c.key],
    className: 'setup-choice-group',
    options: c.options.map(o => ({ value: o.value, label: [o.label, usedNow(o.value === current)] })),
    onchange: value => {
      d[c.key] = value;
    },
  });
}

function tzeitGroup() {
  const presets = S.halachic.tzeitPresets;
  const at = presets.findIndex(p => sameRule(p.rule, d.tzeit));
  const currentAt = presets.findIndex(p => sameRule(p.rule, S.halachic.settings.tzeit));
  const custom = at < 0;
  return h(
    'fieldset',
    { class: 'setup-choice-group' },
    h('legend', {}, S.halachic.tzeitTitle),
    presets.map((p, i) =>
      radioRow({
        name: 'sc-tzeit',
        value: i,
        label: [p.label, usedNow(i === currentAt)],
        checked: at === i,
        onchange: () => {
          d.tzeit = clone(p.rule);
          flow.focus = 'r-sc-tzeit-' + i;
          render();
        },
      }),
    ),
    radioRow({
      name: 'sc-tzeit',
      value: 'other',
      label: ['Other', usedNow(currentAt < 0)],
      checked: custom,
      onchange: () => {
        d.tzeit = { kind: 'minutes', value: 60 };
        flow.focus = 'r-sc-tzeit-other';
        render();
      },
    }),
    custom
      ? h(
          'div',
          { class: 'row indent' },
          h('input', { id: 'sc-tzeit-value', type: 'number', step: 'any', 'aria-label': 'Value', value: d.tzeit.value, oninput: e => (d.tzeit.value = Number(e.target.value)) }),
          h(
            'select',
            { id: 'sc-tzeit-unit', 'aria-label': 'Unit', onchange: e => (d.tzeit.kind = e.target.value) },
            h('option', { value: 'minutes', selected: d.tzeit.kind === 'minutes' }, t('minutes after {sunset}')),
            h('option', { value: 'degrees', selected: d.tzeit.kind === 'degrees' }, 'degrees below the horizon'),
          ),
        )
      : null,
  );
}

function confirmAndSave(e) {
  const btn = e.currentTarget;
  error = '';
  withBusy(btn, () => api('PUT', '/api/halachic', d)).then(
    r => {
      adopt(r.state);
      part = 0;
      next();
    },
    err => {
      error = problem(err);
      flow.focus = 'setup-customs-error';
      render();
    },
  );
}

function keepDefaults() {
  part = 0;
  next();
}

function introView() {
  const confirmed = S.halachic.confirmedAt;
  return screen({
    title: 'Your customs',
    body: [
      h(
        'ul',
        { class: 'setup-points' },
        h('li', {}, t('Customs differ on several points, such as how many days to wait before the {hefsek}. The calendar follows the customs chosen here.')),
        h('li', {}, 'Until they are confirmed, it uses the stricter option of each.'),
        h('li', {}, 'They can be changed at any time, in the Customs tab.'),
        h('li', {}, t('Go over them with your {rav}.')),
      ),
      confirmed ? alert({ kind: 'ok' }, 'Your customs were confirmed on ' + when(confirmed) + '.') : null,
      termsSwitch(),
    ],
    back,
    skip: confirmed ? { label: 'Go over them again', onclick: () => ((part = 1), render()) } : { label: 'Keep the stricter defaults for now', onclick: keepDefaults },
    main: confirmed ? { label: 'Continue', onclick: next } : { label: 'Go through the customs', onclick: () => ((part = 1), render()) },
  });
}

export function customsView() {
  if (!d) d = clone(S.halachic.settings);
  const groups = groupsWithChoices();
  if (part === 0) return introView();
  const g = groups[part - 1];
  const last = part === groups.length;
  const byKey = Object.fromEntries(S.halachic.choices.map(c => [c.key, c]));
  return screen({
    count: 'Customs, part ' + part + ' of ' + groups.length,
    title: g.title(),
    intro: S.halachic.confirmedAt ? null : h('p', { class: 'muted small' }, '“Used now” marks the option the calendar uses until the customs are confirmed.'),
    body: [
      g.keys.map(k => (k === 'tzeit' ? tzeitGroup() : byKey[k] ? choiceGroup(byKey[k]) : null)),
      last ? h('p', { class: 'muted small setup-confirm-note' }, 'Saving marks these customs as confirmed. They can still be changed at any time, in the Customs tab.') : null,
      error ? h('p', { class: 'setup-error', role: 'alert', id: 'setup-customs-error', tabindex: '-1' }, icon('alert', { size: 'sm' }), h('span', {}, error)) : null,
    ],
    back: () => {
      part -= 1;
      render();
    },
    skip: S.halachic.confirmedAt ? { label: 'Leave them as they are', onclick: keepDefaults } : { label: 'Keep the stricter defaults for now', onclick: keepDefaults },
    main: last ? { label: 'Save and confirm my customs', onclick: confirmAndSave, id: 'setup-confirm-customs' } : { label: 'Next', onclick: () => ((part += 1), render()), id: 'setup-customs-next' },
  });
}
