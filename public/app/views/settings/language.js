/* Settings: Language (English letters or Hebrew script for halachic terms, with an example sentence). */
import { h } from '../../lib.js';
import { S } from '../../store.js';
import { blockRow, choiceCards, group, saveApp, tn } from './ui.js';

const EXAMPLE = 'After the {hefsek}, the {clean_days} begin. The {mikvah_night} is after {nightfall}.';

function view() {
  const value = S.app.terms;
  return {
    title: 'Language',
    parent: '',
    statusKey: 'language',
    lead: 'The site is in English. This chooses how the halachic terms are written, on this site and in your calendar.',
    body: [
      group(
        { title: 'Halachic terms', id: 'lang-terms', footer: 'Text messages always use English letters, so that every phone can show them.' },
        blockRow(
          choiceCards({
            name: 'terms',
            legend: 'Halachic terms',
            value,
            options: [
              { value: 'en', label: 'English letters', help: 'For example: hefsek taharah, mikvah night.' },
              { value: 'he', label: 'Hebrew script', help: h('span', {}, 'For example: ', h('bdi', { lang: 'he' }, 'הפסק טהרה'), ', ', h('bdi', { lang: 'he' }, 'ליל טבילה'), '.') },
            ],
            onchange: v => saveTerms(v),
          }),
        ),
      ),
      group(
        { title: 'How it reads now', id: 'lang-example' },
        blockRow(h('p', { class: 'st-sample' }, tn(EXAMPLE, true))),
      ),
    ],
  };
}

function saveTerms(v) {
  if (S.app.terms === v) return;
  saveApp('language', a => (a.terms = v), { message: v === 'he' ? 'Saved: Hebrew script' : 'Saved: English letters' });
}

export const languageSection = {
  id: 'language',
  title: 'Language',
  icon: 'info',
  summary: () => (S.app.terms === 'he' ? 'Halachic terms in Hebrew script' : 'Halachic terms in English letters'),
  flag: () => null,
  view,
};
