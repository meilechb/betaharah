/*
 * The Customs tab: the halachic settings, chosen with the household's rav.
 * Next owner: the dashboard agent.
 */
import { alert, api, button, card, clone, h, radioGroup, radioRow } from '../lib.js';
import { S, draft, render, run, saved, t, when } from '../store.js';
import { termsToggle } from './shared.js';

export function viewCustoms() {
  const d = draft.halachic;
  const sameRule = (a, b) => a.kind === b.kind && a.value === b.value;
  const presetIndex = S.halachic.tzeitPresets.findIndex(p => sameRule(p.rule, d.tzeit));
  const custom = presetIndex < 0;

  const groups = S.halachic.choices.map(c =>
    radioGroup({
      legend: c.title,
      help: c.help,
      name: 'h-' + c.key,
      value: d[c.key],
      options: c.options.map(o => ({ value: o.value, label: o.label })),
      onchange: value => {
        d[c.key] = value;
      },
    }),
  );

  const tzeit = h(
    'fieldset',
    {},
    h('legend', {}, S.halachic.tzeitTitle),
    S.halachic.tzeitPresets.map((p, i) =>
      radioRow({
        name: 'h-tzeit',
        value: i,
        label: p.label,
        checked: presetIndex === i,
        onchange: () => {
          d.tzeit = clone(p.rule);
          render();
        },
      }),
    ),
    radioRow({
      name: 'h-tzeit',
      value: 'other',
      label: 'Other',
      checked: custom,
      onchange: () => {
        d.tzeit = { kind: 'minutes', value: 60 };
        render();
      },
    }),
    custom
      ? h(
          'div',
          { class: 'row' },
          h('input', {
            id: 'h-tzeit-value',
            type: 'number',
            step: 'any',
            'aria-label': 'Value',
            value: d.tzeit.value,
            oninput: e => {
              d.tzeit.value = Number(e.target.value);
            },
          }),
          h(
            'select',
            {
              id: 'h-tzeit-unit',
              'aria-label': 'Unit',
              onchange: e => {
                d.tzeit.kind = e.target.value;
              },
            },
            h('option', { value: 'minutes', selected: d.tzeit.kind === 'minutes' }, t('minutes after {sunset}')),
            h('option', { value: 'degrees', selected: d.tzeit.kind === 'degrees' }, 'degrees below the horizon'),
          ),
        )
      : null,
  );

  return h(
    'div',
    { class: 'narrow' },
    card({}, termsToggle()),
    card(
      {
        tag: 'form',
        title: 'Customs',
        attrs: {
          onsubmit: e => {
            e.preventDefault();
            run(() => api('PUT', '/api/halachic', draft.halachic), saved('Your customs are saved.'), e.submitter);
          },
        },
      },
      h('p', { class: 'muted small' }, t('Wherever customs differ, choose here as your {rav} instructs. This calendar does not rule: for a {stain}, for a {bedikah}, and for every doubt, ask your {rav}.')),
      S.halachic.confirmedAt
        ? h('p', { class: 'small muted' }, 'Last saved: ' + when(S.halachic.confirmedAt))
        : alert({ kind: 'warn' }, 'These settings have not been saved yet. Until they are, the stricter option of each is used.'),
      groups,
      tzeit,
      h('div', { class: 'actions' }, button({ label: 'Save and confirm', variant: 'primary', type: 'submit' })),
    ),
  );
}
