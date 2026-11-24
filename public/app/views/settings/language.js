/* Settings: Language (English letters or Hebrew script for halachic terms, with an example sentence). */
import { h } from '../../lib.js';
import { S } from '../../store.js';
import { blockRow, choiceCards, group, saveApp } from './ui.js';

function view() {
  const value = S.app.terms;
  return {
    title: 'Language',
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
  summary: () => (S.app.terms === 'he' ? 'Terms in Hebrew script' : 'Terms in English letters'),
  flag: () => null,
  view,
};
