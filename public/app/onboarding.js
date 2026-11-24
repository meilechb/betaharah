/*
 * The "Getting started" checklist, shown on Today and Settings until the
 * required steps (location, customs, a first entry) are done.
 * Next owner: the sign-up agent, who will turn it into a guided setup.
 * The checklist items come from the server (S.setup: key, done, text, tab).
 */
import { button, card, h, icon } from './lib.js';
import { S, currentTab, go } from './store.js';

/** The checklist card, or null when the required steps are done. */
export function onboardingCard() {
  const required = S.setup.filter(s => s.key === 'place' || s.key === 'customs' || s.key === 'entry');
  if (required.every(s => s.done)) return null;
  return card(
    { title: 'Getting started', className: 'onboarding' },
    h(
      'ul',
      { class: 'checklist' },
      S.setup.map(s =>
        h(
          'li',
          { class: s.done ? 'done' : '' },
          h('span', { class: 'mark', 'aria-hidden': 'true' }, s.done ? icon('check') : null),
          h(
            'span',
            { class: 'text' },
            s.done || s.tab === currentTab() ? s.text : button({ label: s.text, variant: 'link', onclick: () => go(s.tab) }),
            s.done ? ' (done)' : '',
          ),
        ),
      ),
    ),
  );
}

/*
 * The guided setup. main.js asks needsGuidedSetup() on every draw; while it
 * is true the guided setup is shown in place of the tabs. These three
 * functions are the whole contract with main.js and the dashboard views.
 */

/** True while the guided setup should be on screen in place of the dashboard. */
export function needsGuidedSetup() {
  return false;
}

/** The guided setup's content, for mount(). Only called while needsGuidedSetup() is true. */
export function guidedSetupView() {
  return null;
}

/** Opens the guided setup again (from a link in Settings), then redraws. */
export function openGuidedSetup() {}
