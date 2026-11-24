/*
 * The Settings tab: one card per subject, in two columns on wide screens.
 * Next owner: the dashboard agent.
 */
import { card, h } from '../../lib.js';
import { onboardingCard } from '../../onboarding.js';
import { alertsBlock, termsToggle } from '../shared.js';
import { locationCard } from './location.js';
import { calendarCard } from './calendar.js';
import { phonesCard } from './phones.js';
import { remindersCard } from './reminders.js';
import { signInCard } from './signin.js';
import { dataCard } from './data.js';

function languageCard() {
  return card({ title: 'Language' }, termsToggle(), h('p', { class: 'help' }, 'The site is in English. This chooses how halachic terms are written, here and in your calendar.'));
}

export function viewSettings() {
  return h(
    'div',
    {},
    alertsBlock(),
    onboardingCard(),
    h('div', { class: 'cols' }, h('div', {}, languageCard(), locationCard(), calendarCard(), signInCard()), h('div', {}, phonesCard(), remindersCard(), dataCard())),
  );
}
