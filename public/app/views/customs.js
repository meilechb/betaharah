/*
 * The Customs tab: the halachic settings, chosen with the household's rav.
 * Each choice shows its current answer and opens in place; a bar at the
 * bottom appears once something changed (Save and confirm / Discard), and
 * leaving the tab with unsaved changes asks first. The titles, help texts
 * and options are the server's, word for word.
 */
import { alert, api, button, clone, confirmDialog, h, icon, radioGroup, radioRow, tag, toast } from '../lib.js';
import { S, adopt, currentTab, draft, render, t, when } from '../store.js';
import { attempt, refresh, region, setLeaveGuard, termsToggle } from './shared.js';

const GROUPS = [
  { id: 'count', title: () => t('The count and the {mikvah_night}'), keys: ['minWaitDays', 'tzeit', 'yomTov'] },
  { id: 'beinonit', title: () => cap(t('{onah_beinonit} and {veset_hachodesh}')), keys: ['beinonitDays', 'beinonitLength', 'chodeshLength', 'chodesh30'] },
  { id: 'haflagah', title: () => cap(t('{veset_haflagah}')), keys: ['haflagahMethod', 'longerHaflagah'] },
  { id: 'more', title: () => cap(t('More about the {vesatot}')), keys: ['orZarua', 'longCycle', 'vesatot'] },
];

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** Which choices are open, and the error of the last save. */
const open = new Set();
let saveError = '';

const sameRule = (a, b) => a && b && a.kind === b.kind && Number(a.value) === Number(b.value);
const isDirty = () => Boolean(S && draft.halachic && JSON.stringify(draft.halachic) !== JSON.stringify(S.halachic.settings));
const changedKeys = () => Object.keys(draft.halachic).filter(k => JSON.stringify(draft.halachic[k]) !== JSON.stringify(S.halachic.settings[k]));

setLeaveGuard({
  dirty: () => currentTab() === 'customs' && isDirty(),
  ask: async () => {
    const ok = await confirmDialog({
      title: 'Leave without saving your customs?',
      body: 'Your changes on this tab will be lost.',
      confirmLabel: 'Leave without saving',
      cancelLabel: 'Stay and save',
      danger: true,
    });
    if (ok) {
      draft.halachic = clone(S.halachic.settings);
      saveError = '';
    }
    return ok;
  },
});

function tzeitLabel(rule) {
  const preset = S.halachic.tzeitPresets.find(p => sameRule(p.rule, rule));
  if (preset) return preset.label;
  return rule.kind === 'minutes' ? rule.value + ' ' + t('minutes after {sunset}') : rule.value + ' degrees below the horizon';
}

function currentLabel(key) {
  if (key === 'tzeit') return tzeitLabel(draft.halachic.tzeit);
  const c = S.halachic.choices.find(x => x.key === key);
  const o = c && c.options.find(x => x.value === draft.halachic[key]);
  return o ? o.label : String(draft.halachic[key]);
}

function update(key) {
  refresh('cu-row-' + key);
  refresh('cu-bar');
  saveError = '';
}

function tzeitBody() {
  const d = draft.halachic;
  const presetIndex = S.halachic.tzeitPresets.findIndex(p => sameRule(p.rule, d.tzeit));
  const custom = presetIndex < 0;
  return h(
    'fieldset',
    { class: 'plain' },
    h('legend', { class: 'visually-hidden' }, S.halachic.tzeitTitle),
    S.halachic.tzeitPresets.map((p, i) =>
      radioRow({
        name: 'h-tzeit',
        value: i,
        label: p.label,
        checked: presetIndex === i,
        onchange: () => {
          d.tzeit = clone(p.rule);
          update('tzeit');
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
        update('tzeit');
        document.getElementById('h-tzeit-value')?.focus();
      },
    }),
    custom
      ? h(
          'div',
          { class: 'row indent tzeit-other' },
          h('label', { class: 'visually-hidden', for: 'h-tzeit-value' }, 'Value'),
          h('input', {
            id: 'h-tzeit-value',
            type: 'number',
            step: 'any',
            min: 0,
            value: d.tzeit.value,
            oninput: e => {
              const v = Number(e.target.value);
              if (e.target.value !== '' && Number.isFinite(v)) {
                d.tzeit.value = v;
                refresh('cu-bar');
                const head = document.getElementById('cu-' + 'tzeit' + '-value');
                if (head) head.textContent = tzeitLabel(d.tzeit);
              }
            },
          }),
          h('label', { class: 'visually-hidden', for: 'h-tzeit-unit' }, 'Unit'),
          h(
            'select',
            {
              id: 'h-tzeit-unit',
              onchange: e => {
                d.tzeit.kind = e.target.value;
                update('tzeit');
              },
            },
            h('option', { value: 'minutes', selected: d.tzeit.kind === 'minutes' }, t('minutes after {sunset}')),
            h('option', { value: 'degrees', selected: d.tzeit.kind === 'degrees' }, 'degrees below the horizon'),
          ),
        )
      : null,
  );
}

function choiceRow(key) {
  return region('cu-row-' + key, () => {
    const isTzeit = key === 'tzeit';
    const c = isTzeit ? { key, title: S.halachic.tzeitTitle, help: '' } : S.halachic.choices.find(x => x.key === key);
    if (!c) return h('div', { class: 'choice-row missing' });
    const isOpen = open.has(key);
    const changed = JSON.stringify(draft.halachic[key]) !== JSON.stringify(S.halachic.settings[key]);
    const body = isTzeit
      ? tzeitBody()
      : radioGroup({
          legend: c.title,
          help: c.help,
          name: 'h-' + key,
          value: draft.halachic[key],
          className: 'plain legend-hidden',
          options: c.options.map(o => ({ value: o.value, label: o.label })),
          onchange: value => {
            draft.halachic[key] = value;
            update(key);
          },
        });
    return h(
      'div',
      { class: 'choice-row' + (isOpen ? ' open' : '') + (changed ? ' changed' : '') },
      h(
        'button',
        {
          type: 'button',
          class: 'choice-head',
          id: 'cu-' + key,
          'aria-expanded': String(isOpen),
          'aria-controls': 'cu-' + key + '-body',
          onclick: () => {
            if (isOpen) open.delete(key);
            else open.add(key);
            refresh('cu-row-' + key);
          },
        },
        h('span', { class: 'choice-text' }, h('span', { class: 'choice-title' }, c.title), h('span', { class: 'choice-value', id: 'cu-' + key + '-value' }, currentLabel(key))),
        changed ? tag('Changed', 'warn') : null,
        icon(isOpen ? 'chevron-up' : 'chevron-down'),
      ),
      h('div', { class: 'choice-body', id: 'cu-' + key + '-body', hidden: !isOpen }, isOpen ? body : null),
    );
  });
}

function save(btn) {
  attempt(() => api('PUT', '/api/halachic', draft.halachic), {
    button: btn,
    done: r => {
      adopt(r.state);
      saveError = '';
      render();
      toast('Your customs are saved.');
    },
    fail: message => {
      saveError = message;
      refresh('cu-bar');
      document.getElementById('cu-save-error')?.focus();
    },
  });
}

function saveBar() {
  return region('cu-bar', () => {
    const dirty = isDirty();
    const confirmed = S.halachic.confirmedAt !== null;
    if (!dirty && confirmed) return h('div', { class: 'save-bar-slot' });
    const n = dirty ? changedKeys().length : 0;
    return h(
      'div',
      { class: 'save-bar-slot' },
      h(
        'div',
        { class: 'save-bar' + (dirty ? ' dirty' : ''), role: 'region', 'aria-label': 'Save your customs' },
        h(
          'div',
          { class: 'save-bar-text' },
          h('strong', {}, dirty ? 'Unsaved changes' + (n > 1 ? ' (' + n + ')' : '') : 'Not confirmed yet'),
          dirty ? null : h('span', {}, 'The stricter options are in use until you save.'),
          saveError ? h('span', { class: 'error', role: 'alert', id: 'cu-save-error', tabindex: '-1' }, icon('alert', { size: 'sm' }), saveError) : null,
        ),
        h(
          'div',
          { class: 'actions' },
          dirty
            ? button({
                label: 'Discard',
                attrs: { id: 'cu-discard' },
                onclick: () => {
                  draft.halachic = clone(S.halachic.settings);
                  saveError = '';
                  render();
                  toast('Your changes were discarded.');
                },
              })
            : null,
          button({ label: 'Save and confirm', variant: 'primary', attrs: { id: 'cu-save' }, onclick: e => save(e.currentTarget) }),
        ),
      ),
    );
  });
}

export function viewCustoms() {
  const known = new Set(GROUPS.flatMap(g => g.keys));
  const extra = S.halachic.choices.map(c => c.key).filter(k => !known.has(k));
  const groups = extra.length ? [...GROUPS, { id: 'other', title: () => 'Other choices', keys: extra }] : GROUPS;
  const allOpen = [...known, ...extra].every(k => open.has(k));
  return h(
    'div',
    { class: 'narrow customs' },
    h(
      'section',
      { class: 'card customs-intro' },
      h('h2', {}, 'Customs'),
      h('p', {}, t('Choose as your {rav} instructs. For a {stain}, a {bedikah} or any doubt, ask your {rav}.')),
      termsToggle({
        keep: () => {
          const kept = clone(draft.halachic);
          const was = isDirty();
          return () => {
            if (was) draft.halachic = kept;
          };
        },
      }),
      S.halachic.confirmedAt
        ? h('p', { class: 'small muted last-saved' }, icon('check', { size: 'sm' }), 'Last saved: ' + when(S.halachic.confirmedAt))
        : alert({ kind: 'warn', title: 'Not confirmed yet: the stricter options are in use' }, t('Review them with your {rav}, then choose Save and confirm.')),
    ),
    h(
      'div',
      { class: 'customs-tools' },
      button({
        label: allOpen ? 'Close all' : 'Open all',
        variant: 'link',
        icon: allOpen ? 'chevron-up' : 'chevron-down',
        attrs: { id: 'cu-all' },
        onclick: () => {
          if (allOpen) open.clear();
          else [...known, ...extra].forEach(k => open.add(k));
          render();
        },
      }),
    ),
    groups.map(g => h('section', { class: 'card customs-group', 'aria-labelledby': 'cu-g-' + g.id }, h('h2', { id: 'cu-g-' + g.id }, g.title()), h('div', { class: 'choice-list' }, g.keys.map(choiceRow)))),
    saveBar(),
  );
}
