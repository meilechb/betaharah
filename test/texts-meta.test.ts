/**
 * The Texts page's listing of the registry (src/app/chat/messages-meta.ts):
 * every text has a short name, a "sent when" line and a category.
 */
import { describe, expect, it } from 'vitest';
import { MESSAGES, MESSAGE_BY_KEY } from '../src/app/chat/messages';
import { CATEGORIES, hasMeta, TEXT_SETS, textMeta } from '../src/app/chat/messages-meta';
import { NO_TEXTS, textsForConsole } from '../src/app/chat/site-texts';

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe('the listing of the texts', () => {
  it('has an entry for every text of the registry (add one in messages-meta.ts for a new text)', () => {
    const missing = MESSAGES.map(m => m.key).filter(k => !hasMeta(k));
    expect(missing, `no name or category for: ${missing.join(', ')}`).toEqual([]);
  });

  it('names each text in 2 to 5 words and says when it is sent in one sentence', () => {
    for (const m of MESSAGES) {
      const meta = textMeta(m.key, m.when);
      expect(words(meta.name), `${m.key}: "${meta.name}"`).toBeGreaterThanOrEqual(m.key.endsWith('.discreet') ? 1 : 2);
      expect(words(meta.name), `${m.key}: "${meta.name}"`).toBeLessThanOrEqual(5);
      expect(meta.sent, m.key).toMatch(/^[A-Z?].*\.$/);
      expect(meta.sent.length, m.key).toBeLessThanOrEqual(110);
    }
  });

  it('puts each text in a known category, part and set; variants point at a main text of the same category', () => {
    const ids = new Set<string>(CATEGORIES.map(c => c.id));
    for (const m of MESSAGES) {
      const meta = textMeta(m.key, m.when);
      expect(ids.has(meta.category), m.key).toBe(true);
      if (meta.sub) expect((CATEGORIES.find(c => c.id === meta.category) as { subs?: readonly string[] }).subs, m.key).toContain(meta.sub);
      if (meta.set) expect(TEXT_SETS[meta.set], m.key).toBeDefined();
      if (meta.variantOf) {
        expect(MESSAGE_BY_KEY.has(meta.variantOf), m.key).toBe(true);
        const main = textMeta(meta.variantOf, '');
        expect(main.category, m.key).toBe(meta.category);
        expect(main.variantOf, m.key).toBeUndefined();
      }
    }
  });

  it('lists the categories in the order the operator thinks in, every one of them used', () => {
    expect(CATEGORIES.map(c => c.name)).toEqual([
      'Reminders',
      'Recording',
      'Status',
      'Sign-up and setup',
      'Menu and not understood',
      'Settings by text',
      'Phones and account',
      'Carrier words and sign-in',
      'Other',
    ]);
    for (const c of CATEGORIES.filter(x => x.id !== 'other')) expect(MESSAGES.some(m => textMeta(m.key, m.when).category === c.id), c.id).toBe(true);
  });

  it('shows each reminder with its discreet wording, and the twelve customs questions as one set', () => {
    for (const m of MESSAGES.filter(x => x.key.endsWith('.discreet'))) expect(textMeta(m.key, m.when)).toMatchObject({ variantOf: m.key.replace(/\.discreet$/, ''), variant: 'Discreet' });
    expect(MESSAGES.filter(m => textMeta(m.key, m.when).set === 'customs.questions')).toHaveLength(12);
  });

  it('marks 15 to 25 rows as important: the ones most people will ever get', () => {
    const rows = MESSAGES.filter(m => { const meta = textMeta(m.key, m.when); return meta.important && !meta.variantOf; });
    expect(rows.length).toBeGreaterThanOrEqual(15);
    expect(rows.length).toBeLessThanOrEqual(25);
    for (const k of ['reminder.hefsek', 'reminder.mikvah', 'menu.main', 'record.flow', 'record.hefsek', 'status.counting', 'signup.welcome']) expect(rows.map(m => m.key)).toContain(k);
  });

  it('lists a key with no entry under "Other", by its key and its "when" line', () => {
    expect(textMeta('new.thing', 'When something new happens.')).toMatchObject({ name: 'new.thing', sent: 'When something new happens.', category: 'other' });
    expect(hasMeta('new.thing')).toBe(false);
  });

  it('the texts route answers with the listing of each text and the categories', () => {
    const r = textsForConsole(NO_TEXTS);
    expect(r.categories.length).toBe(CATEGORIES.length);
    expect(r.messages.find(m => m.key === 'reminder.hefsek')!.meta).toMatchObject({ name: 'Hefsek taharah day', category: 'reminders', important: true });
    expect(r.sets['customs.questions']!.name).toBe('Customs questions');
  });
});
