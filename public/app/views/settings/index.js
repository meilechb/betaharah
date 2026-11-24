/*
 * The Settings tab: one card per subject, in two columns on wide screens.
 * Every change is saved as it is made; each card says "Saving…" and then
 * "Saved" beside its title, or what went wrong. Steps that need more than
 * one field (coordinates, adding a phone, a password) have their own button.
 */
import { card, h, icon } from '../../lib.js';
import { onboardingCard } from '../../onboarding.js';
import { alertsBlock, termsToggle } from '../shared.js';
import { locationCard } from './location.js';
import { calendarCard } from './calendar.js';
import { phonesCard } from './phones.js';
import { remindersCard } from './reminders.js';
import { signInCard } from './signin.js';
import { dataCard } from './data.js';
import { textingCard } from './texting.js';

function languageCard() {
  return card({ title: 'Halachic terms', icon: 'info' }, termsToggle(), h('p', { class: 'help' }, 'The site is in English. This chooses how halachic terms are written, here and in your calendar. Text messages always use English letters.'));
}

export function viewSettings() {
  return h(
    'div',
    { class: 'settings' },
    alertsBlock({ only: 'warn' }),
    onboardingCard(),
    h('p', { class: 'settings-intro' }, icon('check', { size: 'sm' }), 'Each change is saved as soon as you make it.'),
    h('div', { class: 'cols' }, h('div', {}, locationCard(), phonesCard(), remindersCard()), h('div', {}, calendarCard(), languageCard(), textingCard(), signInCard(), dataCard())),
  );
}
