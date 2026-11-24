/*
 * The guided setup's state, its order of steps, and the pieces every step
 * screen is built from (the screen frame with Back / Skip / the main action,
 * and the switch for halachic terms). Owner: the sign-up agent.
 *
 * Each answer is saved through the API as soon as it is given, so leaving
 * midway loses nothing. Which optional steps were passed over is kept in this
 * browser only (no answers, just the step names), so that coming back resumes
 * at the first step that is neither done nor passed.
 */
import { api, button, confirmDialog, h, segmented, toast } from '../lib.js';
import { S, adopt, go, render, run, saved } from '../store.js';

export const STEPS = [
  { key: 'welcome', label: 'Welcome' },
  { key: 'place', label: 'Location' },
  { key: 'customs', label: 'Customs' },
  { key: 'dates', label: 'Dates' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'phones', label: 'Phones' },
  { key: 'done', label: 'Done' },
];
const KEYS = STEPS.map(s => s.key);

const STORE_KEY = 'betaharah.setup';

/** The guided setup's own state. step: the key being shown (null: work it out from what is done). */
export const flow = {
  open: false, // reopened from Settings
  closing: false, // POST /api/welcome is under way
  step: null,
  passed: new Set(),
  loadedFor: null,
  focus: null, // an id to focus after the next draw (instead of the heading)
};

/** Steps are told when they are entered, so that each starts on its first (or, going back, last) screen. */
const enterHooks = {};
export function onEnter(key, fn) {
  enterHooks[key] = fn;
}

/** A short, non-identifying key for this account in this browser. */
const who = () => String((S && S.account && S.account.number) || '').slice(-4);

function loadPassed() {
  if (flow.loadedFor === who()) return;
  flow.loadedFor = who();
  flow.passed = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && saved.who === who() && Array.isArray(saved.passed)) flow.passed = new Set(saved.passed.filter(k => KEYS.includes(k)));
  } catch (e) {
    // private browsing or no storage: the setup still works, it only starts from what the server says is done
  }
}

function storePassed() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ who: who(), passed: [...flow.passed] }));
  } catch (e) {
    // see loadPassed
  }
}

/** Whether a step's work is really done, from the server's state. */
export function isDone(key) {
  if (!S) return false;
  switch (key) {
    case 'welcome':
      return flow.passed.has('welcome') || ['place', 'customs', 'dates'].some(isDone);
    case 'place':
      return S.app.place !== null;
    case 'customs':
      return Boolean(S.halachic.confirmedAt);
    case 'dates':
      return S.entryCount > 0;
    case 'calendar':
      return S.calendar.google.connected || Boolean(S.calendar.link);
    case 'phones':
      return S.phones.length > 1 || S.phones.some(p => p.me && p.texts);
    default:
      return false;
  }
}

/** The first step that is neither done nor passed over. */
function resumeStep() {
  loadPassed();
  for (const key of KEYS) {
    if (key === 'done') return 'done';
    if (!isDone(key) && !flow.passed.has(key)) return key;
  }
  return 'done';
}

/** The key of the step being shown. */
export function currentStep() {
  if (flow.step === null) {
    flow.step = flow.open ? 'welcome' : resumeStep();
    if (enterHooks[flow.step]) enterHooks[flow.step]('forward');
  }
  return flow.step;
}

export function goTo(key, direction) {
  flow.step = key;
  if (enterHooks[key]) enterHooks[key](direction || 'forward');
  render();
}

/** On to the next step; the step being left counts as passed. */
export function next() {
  const at = KEYS.indexOf(currentStep());
  loadPassed();
  flow.passed.add(KEYS[at]);
  storePassed();
  goTo(KEYS[Math.min(at + 1, KEYS.length - 1)], 'forward');
}

export function back() {
  const at = KEYS.indexOf(currentStep());
  if (at > 0) goTo(KEYS[at - 1], 'back');
}

/** Closes the guided setup for good (until reopened) and shows the dashboard. */
export function finish(btn, message) {
  if (flow.closing) return;
  flow.closing = true;
  run(
    () => api('POST', '/api/welcome'),
    r => {
      flow.closing = false;
      flow.open = false;
      flow.step = null;
      // The steps passed over are needed only until the setup is closed.
      try {
        localStorage.removeItem(STORE_KEY);
      } catch (e) {
        // no storage: nothing to remove
      }
      adopt(r.state);
      go('today');
      window.scrollTo(0, 0);
      if (message) toast(message);
    },
    btn,
  ).finally(() => {
    flow.closing = false;
  });
}

/** "Leave the setup" from any screen: asks first, then closes it. */
export async function leave(e) {
  const btn = e && e.currentTarget;
  const ok = await confirmDialog({
    title: 'Leave the setup?',
    body: 'Everything you entered so far is saved. You can open the setup again from Settings, and the Today tab lists what is still to do.',
    confirmLabel: 'Leave the setup',
    cancelLabel: 'Stay',
  });
  if (ok) finish(btn);
}

/** English letters or Hebrew script for the halachic terms; saves at once, like the switch on the Customs tab. */
export function termsSwitch() {
  return h(
    'div',
    { class: 'row setup-terms' },
    h('span', { class: 'small muted' }, 'Halachic terms in'),
    segmented({
      id: 'setup-terms',
      label: 'Language of halachic terms',
      value: S.app.terms,
      options: [
        { value: 'en', label: 'English' },
        { value: 'he', label: 'עברית', lang: 'he' },
      ],
      onchange: value => {
        if (S.app.terms === value) return;
        flow.focus = 'setup-terms-' + value;
        run(() => api('PUT', '/api/app', { ...S.app, terms: value }), saved());
      },
    }),
  );
}

/**
 * One screen of the setup.
 *   screen({ title, count, intro, body, back, skip, main })
 * count: a short line above the title ("Question 2 of 3").
 * back: a function, or null for no Back button.  skip: { label, onclick } or null.
 * main: { label, onclick, icon, id, type } — the one main action, shown as the primary button.
 *       Leave it out when the main action sits in the body (a form's own button).
 */
export function screen(o) {
  const backBtn = o.back ? button({ label: 'Back', icon: 'chevron-left', className: 'setup-back', onclick: o.back, attrs: { id: 'setup-back' } }) : null;
  const skipBtn = o.skip ? button({ label: o.skip.label, variant: o.main ? 'secondary' : o.skip.primary ? 'primary' : 'secondary', className: 'setup-skip', onclick: o.skip.onclick, attrs: { id: 'setup-skip' } }) : null;
  const mainBtn = o.main
    ? button({ label: o.main.label, variant: 'primary', size: 'lg', icon: o.main.icon, className: 'setup-main', onclick: o.main.onclick, busy: o.main.busy, attrs: { id: o.main.id || 'setup-main' } })
    : null;
  return h(
    'section',
    { class: 'card setup-card', 'aria-labelledby': 'setup-title' },
    o.count ? h('p', { class: 'setup-count' }, o.count) : null,
    h('h2', { id: 'setup-title', tabindex: '-1' }, o.title),
    o.intro ? [o.intro].flat().map(p => (typeof p === 'string' ? h('p', { class: 'setup-intro' }, p) : p)) : null,
    h('div', { class: 'setup-body' }, o.body),
    h('div', { class: 'setup-nav' + (mainBtn ? ' has-main' : '') }, backBtn, h('div', { class: 'setup-forward' }, skipBtn, mainBtn)),
  );
}

/** Shows a server refusal next to the thing it is about, by keeping it in the step's state; returns the message. */
export function problem(err) {
  if (!err) return '';
  if (err.status === undefined) return err.message || 'The site could not be reached. Check the internet connection and try again.';
  return err.message || 'Something went wrong. Try again.';
}
