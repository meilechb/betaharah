/*
 * Pieces used by more than one dashboard view.
 * Next owner: the dashboard agent.
 */
import { alert, api, h, segmented } from '../lib.js';
import { S, draft, run, saved } from '../store.js';

/** The warnings and notes the server sends (S.alerts), each as an alert. */
export function alertsBlock() {
  return S.alerts.map(a => alert({ kind: a.level === 'info' ? 'info' : 'warn' }, a.text));
}

/** English letters or Hebrew script for halachic terms; saves at once. */
export function termsToggle() {
  const pick = value => {
    if (S.app.terms === value) return;
    run(() => api('PUT', '/api/app', { ...S.app, terms: value }), saved());
  };
  return h(
    'div',
    { class: 'row' },
    h('span', { id: 'terms-label' }, 'Halachic terms in'),
    segmented({
      id: 'terms',
      label: 'Language of halachic terms',
      value: S.app.terms,
      options: [
        { value: 'en', label: 'English' },
        { value: 'he', label: 'עברית', lang: 'he' },
      ],
      onchange: pick,
    }),
  );
}

/** Saves the app settings draft (location, calendar, reminders) and shows the message. btn: the button to mark busy. */
export function saveApp(message, btn) {
  run(() => api('PUT', '/api/app', draft.app), saved(message || 'Saved.'), btn);
}
