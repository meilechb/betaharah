/*
 * The Settings tab.
 *
 * A short list of sections, each with a one-line summary of how it is set up
 * and a flag when something needs attention; each section opens as its own
 * view (#settings/<section>, see route.js). On a phone the list and a section
 * take the whole width in turn; from 900 px the list stays on the left and
 * the open section is on the right (the first one when none is chosen).
 *
 * Every change is saved as it is made; the section's header says "Saving…",
 * then "Saved" or what went wrong (saveStatus() from shared.js). Steps that
 * need more than one field keep their own button.
 */
import { button, h, icon } from '../../lib.js';
import { S, go } from '../../store.js';
import { saveStatus, signedInWith } from '../shared.js';
import { back, currentPath, settle } from './route.js';
import { navRow } from './ui.js';
import { locationSection } from './location.js';
import { phonesSection } from './phones.js';
import { remindersSection } from './reminders.js';
import { calendarSection } from './calendar.js';
import { languageSection } from './language.js';
import { textingSection } from './texting.js';
import { signInSection } from './signin.js';
import { dataSection } from './data.js';

/**
 * Each section: { id, title, icon, summary(), flag(), view(rest) }.
 * view(rest) returns { title, parent, statusKey, body } for the path after the section's id.
 */
const SECTIONS = [locationSection, phonesSection, remindersSection, calendarSection, languageSection, textingSection, signInSection, dataSection];

let lastPath = null;

/** What needs attention outside the sections: the customs, which are set on their own tab. */
function customsFlag() {
  if (S.halachic.confirmedAt !== null) return null;
  return h(
    'div',
    { class: 'st-attention', role: 'note' },
    icon('alert'),
    h('div', {}, h('strong', {}, 'Your customs are not confirmed yet.'), h('span', {}, ' Until they are, the calendar uses the stricter option of each.')),
    button({ label: 'Review customs', size: 'sm', onclick: () => go('customs'), attrs: { id: 'st-go-customs' } }),
  );
}

function sectionList(currentId, shownId) {
  return h(
    'nav',
    { class: 'st-home', 'aria-labelledby': 'st-home-title' },
    h('h2', { class: 'st-home-title', id: 'st-home-title', tabindex: '-1' }, 'Settings'),
    h('p', { class: 'st-account' }, icon('user', { size: 'sm' }), 'Signed in with ' + signedInWith(), S.demo ? ' · the test account' : ''),
    customsFlag(),
    h(
      'ul',
      { class: 'st-rows st-sections' },
      SECTIONS.map(s =>
        h(
          'li',
          {},
          navRow({
            path: s.id,
            id: 'st-nav-' + s.id,
            icon: s.icon,
            title: s.title,
            summary: s.summary(),
            flag: s.flag(),
            current: currentId === s.id,
            className: !currentId && shownId === s.id ? 'shown' : null,
          }),
        ),
      ),
    ),
  );
}

function sectionView(section, rest) {
  const v = section.view(rest);
  const showBack = v.parent !== undefined && v.parent !== null;
  return h(
    'section',
    { class: 'st-pane' + (v.parent ? ' sub' : ''), 'aria-labelledby': 'st-title', id: 'st-pane-' + section.id },
    h(
      'header',
      { class: 'st-head' },
      showBack
        ? button({
            label: v.backLabel || 'Settings',
            variant: 'link',
            icon: 'chevron-left',
            className: 'st-back' + (v.parent === '' ? ' to-home' : ''),
            attrs: { id: 'st-back', 'aria-label': 'Back to ' + (v.backLabel || 'Settings') },
            onclick: () => back(v.parent),
          })
        : null,
      h('div', { class: 'st-head-row' }, h('h2', { id: 'st-title', tabindex: '-1' }, v.title), v.statusKey ? saveStatus(v.statusKey) : null),
    ),
    v.lead ? h('p', { class: 'st-lead-text' }, v.lead) : null,
    h('div', { class: 'st-body' }, v.body),
  );
}

export function viewSettings() {
  settle();
  const path = currentPath();
  const [id, ...rest] = path ? path.split('/') : [];
  const section = SECTIONS.find(s => s.id === id) || null;
  const shown = section || SECTIONS[0];
  const view = h(
    'div',
    { class: 'settings st' + (section ? ' has-section' : ' at-home') },
    sectionList(section ? section.id : null, shown.id),
    h('div', { class: 'st-main' }, sectionView(shown, section ? rest : [])),
  );

  // A new section or sub-view: its heading gets the focus, and the page starts at its top.
  const key = section ? path : '';
  if (lastPath !== null && key !== lastPath) {
    queueMicrotask(() => {
      const el = document.getElementById(section ? 'st-title' : 'st-home-title');
      if (!el) return;
      el.focus({ preventScroll: true });
      const top = el.closest('.st-pane, .st-home').getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.4) window.scrollTo(0, Math.max(0, window.scrollY + top - 16));
    });
  }
  lastPath = key;
  return view;
}
