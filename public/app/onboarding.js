/*
 * The "Getting started" checklist, shown on Today and Settings until the
 * required steps (location, customs, a first entry) are done; and the guided
 * setup that new accounts see in place of the dashboard.
 * Owner: the sign-up agent. The setup's steps are in ./setup/.
 * The checklist items come from the server (S.setup: key, done, text, tab).
 */
import { button, card, h, icon, stepper } from './lib.js';
import { S, currentTab, go, render } from './store.js';
import { STEPS, currentStep, finish, flow, isDone, leave, next, screen, signedInWith, termsSwitch } from './setup/flow.js';
import { placeView } from './setup/place.js';
import { customsView } from './setup/customs.js';
import { datesView } from './setup/dates.js';
import { calendarView, doneView, phonesView } from './setup/extras.js';

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

function welcomeView() {
  return screen({
    title: 'Welcome to Betaharah',
    intro: [
      'Betaharah keeps your calendar of family purity: from the dates you record, it works out what comes next, and it can remind you by text message.',
      'The next few minutes cover where you live, your customs, and your most recent dates; then, if you like, your calendar app and text reminders.',
    ],
    body: [
      h('p', { class: 'setup-account small' }, icon('user', { size: 'sm' }), h('span', {}, signedInWith())),
      h('p', { class: 'muted small' }, 'Each answer is saved as soon as you give it. You can stop at any point and continue later from where you left off.'),
      termsSwitch(),
    ],
    back: null,
    main: { label: 'Start', onclick: next, id: 'setup-start' },
  });
}

const VIEWS = {
  welcome: welcomeView,
  place: placeView,
  customs: customsView,
  dates: datesView,
  calendar: calendarView,
  phones: phonesView,
  done: doneView,
};

/** True while the guided setup should be on screen in place of the dashboard. */
export function needsGuidedSetup() {
  if (!S) return false;
  return flow.open || !S.account.welcomed;
}

let lastScreen = null;

/** The guided setup's content, for mount(). Only called while needsGuidedSetup() is true. */
export function guidedSetupView() {
  const active = document.activeElement;
  const keepId = active && active !== document.body && active.id ? active.id : null;
  const step = currentStep();
  const at = STEPS.findIndex(s => s.key === step);
  const content = VIEWS[step]();
  // A new screen is one with a different heading or step: its heading gets the focus, so a screen reader reads it.
  const title = content.querySelector('#setup-title');
  const screenKey = step + '|' + (title ? title.textContent : '') + '|' + ((content.querySelector('.setup-count') || {}).textContent || '');
  const fresh = screenKey !== lastScreen;
  lastScreen = screenKey;
  const wanted = flow.focus;
  flow.focus = null;

  const view = h(
    'div',
    { class: 'setup' },
    h(
      'header',
      { class: 'top setup-top' },
      h('h1', {}, 'Betaharah'),
      button({ label: step === 'done' ? 'Close the setup' : 'Leave the setup', variant: 'link', className: 'setup-leave', onclick: step === 'done' ? e => finish(e.currentTarget) : leave, attrs: { id: 'setup-leave' } }),
    ),
    h(
      'nav',
      { class: 'setup-progress', 'aria-label': 'Setup progress' },
      stepper({ label: 'Setup steps', current: at, steps: STEPS.map(s => ({ label: s.label, done: s.key !== step && isDone(s.key) })) }),
    ),
    h('main', { class: 'setup-main' }, content),
  );

  // main.js mounts what this returns right away; the focus is placed just after.
  queueMicrotask(() => {
    let el = wanted ? document.getElementById(wanted) : null;
    if (!el && fresh) {
      el = document.getElementById('setup-title');
      window.scrollTo(0, 0);
    }
    if (!el && keepId) el = document.getElementById(keepId);
    if (el && el !== document.activeElement) el.focus({ preventScroll: !fresh && !wanted });
  });
  return view;
}

/** Opens the guided setup again (from a link in Settings), then redraws. */
export function openGuidedSetup() {
  flow.open = true;
  flow.step = null;
  lastScreen = null;
  render();
}
