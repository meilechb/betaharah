/* Settings: Language and dates (English letters or Hebrew script for halachic terms; Hebrew, civil or both dates). */
import { h } from '../../lib.js';
import { S } from '../../store.js';
import { blockRow, choiceCards, group, saveApp } from './ui.js';

const DATE_NAMES = { hebrew: 'Hebrew', civil: 'Civil', both: 'Both' };

function view() {
  const value = S.app.terms;
  return {
    title: 'Language and dates',
    parent: '',
    statusKey: 'language',
    body: [
      group(
        { title: 'Halachic terms', id: 'lang-terms', footer: 'Texts always use English letters.' },
        blockRow(
          choiceCards({
            name: 'terms',
            legend: 'Halachic terms',
            value,
            options: [
              { value: 'en', label: 'English letters', help: 'hefsek taharah, mikvah night' },
              { value: 'he', label: 'Hebrew script', help: h('span', {}, h('bdi', { lang: 'he' }, 'הפסק טהרה'), ', ', h('bdi', { lang: 'he' }, 'ליל טבילה')) },
            ],
            onchange: v => saveTerms(v),
          }),
        ),
      ),
      group(
        { title: 'Dates', id: 'lang-dates' },
        blockRow(
          choiceCards({
            name: 'dates',
            legend: 'Dates',
            value: S.app.dates || 'hebrew',
            options: ['hebrew', 'civil', 'both'].map(v => ({ value: v, label: DATE_NAMES[v] })),
            onchange: v => saveDates(v),
          }),
        ),
      ),
    ],
  };
}

function saveTerms(v) {
  if (S.app.terms === v) return;
  saveApp('language', a => (a.terms = v), { message: v === 'he' ? 'Saved: Hebrew script' : 'Saved: English letters' });
}

function saveDates(v) {
  if ((S.app.dates || 'hebrew') === v) return;
  saveApp('language', a => (a.dates = v), { message: 'Saved: ' + (v === 'both' ? 'both dates' : DATE_NAMES[v] + ' dates') });
}

const datesWord = () => ({ hebrew: 'Hebrew dates', civil: 'civil dates', both: 'both dates' })[S.app.dates || 'hebrew'];

export const languageSection = {
  id: 'language',
  title: 'Language and dates',
  icon: 'info',
  summary: () => (S.app.terms === 'he' ? 'Terms in Hebrew script' : 'Terms in English letters') + ' · ' + datesWord(),
  flag: () => null,
  view,
};
