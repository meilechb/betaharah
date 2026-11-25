import { describe, expect, it } from 'vitest';
import { draftFromForm, entryWhen } from '../src/app/dashboard';
import type { LogEntry } from '../src/engine/cycle';

// The date and part the page is sent for an entry are the ones that record the same entry again.
describe('the date an entry is shown on', () => {
  const where = { place: { timeZone: 'America/New_York' }, zopts: {} } as never;
  const forms = [
    { kind: 'flow', date: '2026-11-24', part: 'day' },
    { kind: 'flow', date: '2026-11-24', part: 'night' },
    { kind: 'stain', date: '2026-12-31', part: 'night' },
    { kind: 'broken', date: '2026-03-01', part: 'day' },
    { kind: 'hefsek', date: '2026-11-28' },
    { kind: 'mikvah', date: '2026-12-05' },
  ];
  for (const form of forms) {
    it(`${form.kind} ${form.date} ${form.part ?? ''}`, () => {
      const draft = draftFromForm(form, where, 0);
      const shown = entryWhen({ id: 'x', ...draft } as LogEntry);
      expect(shown).toEqual({ date: form.date, part: form.part ?? '' });
    });
  }
});
