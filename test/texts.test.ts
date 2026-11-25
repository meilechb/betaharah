/**
 * The registry of every text the service sends (src/app/chat/messages.ts),
 * and the operator's changes to it (src/app/chat/site-texts.ts).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isGsmBasic, MAX_TEXT_CHARS, SEGMENT_CHARS } from '../src/app/chat/gsm';
import { dateExamples, DEFAULT_WORDS, GENERAL_ACTIONS, MESSAGES, MESSAGE_BY_KEY } from '../src/app/chat/messages';
import { DATE_STYLES } from '../src/engine/dates';
import { checkMessage, checkWords, compose, exampleLength, exampleVars, NO_TEXTS, optionsOf, parseSiteTexts, renderBody, TextsError } from '../src/app/chat/site-texts';
import { REMINDER_TEXTS, STATUS_TEXTS } from '../src/engine/present';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });
}
const SOURCES = walk(join(__dirname, '..', 'src')).map(path => ({ path, text: readFileSync(path, 'utf8') }));

const fails = (fn: () => void): TextsError => {
  try {
    fn();
  } catch (e) {
    if (e instanceof TextsError) return e;
    throw e;
  }
  throw new Error('did not fail');
};

describe('the registry', () => {
  it('has unique keys, a known group, a "when" line, and at most six options with unique ids', () => {
    expect(new Set(MESSAGES.map(m => m.key)).size).toBe(MESSAGES.length);
    for (const m of MESSAGES) {
      expect(m.when.length, m.key).toBeGreaterThan(5);
      expect(m.options.length, m.key).toBeLessThanOrEqual(6);
      expect(new Set(m.options.map(o => o.id)).size, m.key).toBe(m.options.length);
      if (!m.filed) expect(m.options.length, `${m.key} has no options`).toBeGreaterThan(0);
    }
  });

  it('every default text is GSM-7 and fits two segments with its example values and all its options', () => {
    const report: string[] = [];
    for (const m of MESSAGES) {
      const length = exampleLength(NO_TEXTS, m.key);
      const rendered = compose(NO_TEXTS, [{ key: m.key, vars: exampleVars(m) }]);
      expect(rendered, m.key).toHaveLength(1);
      expect(isGsmBasic(rendered[0]!.text), m.key).toBe(true);
      expect(length, m.key).toBeLessThanOrEqual(MAX_TEXT_CHARS);
      if (length > SEGMENT_CHARS) report.push(`${m.key} ${length}`);
    }
    // Most fit one segment; the longer ones are known.
    expect(report.length).toBeLessThan(MESSAGES.length / 4);
  });

  it('in each setting of the dates, every default text with dates is GSM-7, fits as before, and has no Hebrew script', () => {
    const hebrew = dateExamples('hebrew');
    const lengths: Record<string, Record<string, number>> = {};
    for (const style of DATE_STYLES) {
      const mine = dateExamples(style);
      for (const m of MESSAGES) {
        const vars = exampleVars(m);
        let dated = false;
        for (const [name, value] of Object.entries(vars)) {
          const field = (Object.keys(hebrew) as Array<keyof typeof hebrew>).find(f => hebrew[f] === value);
          if (field) {
            vars[name] = mine[field];
            dated = true;
          }
        }
        if (!dated && !['dates.changed'].includes(m.key)) continue;
        const rendered = compose(NO_TEXTS, [{ key: m.key, vars }]);
        expect(rendered, `${m.key} ${style}`).toHaveLength(1);
        const text = rendered[0]!.text;
        expect(isGsmBasic(text), `${m.key} ${style}`).toBe(true);
        expect(text, `${m.key} ${style}`).not.toMatch(/[\u0590-\u05FF]/);
        (lengths[m.key] ??= {})[style] = text.length;
      }
    }
    // A text that fits one segment in the default setting fits one in each; none is over two.
    const over: string[] = [];
    for (const [key, byStyle] of Object.entries(lengths)) {
      for (const [style, n] of Object.entries(byStyle)) {
        expect(n, `${key} ${style}`).toBeLessThanOrEqual(MAX_TEXT_CHARS);
        if ((byStyle.hebrew as number) <= SEGMENT_CHARS && n > SEGMENT_CHARS) over.push(`${key} ${style} ${n}`);
      }
    }
    expect(over).toEqual([]);
    expect(Object.keys(lengths).length).toBeGreaterThan(20);
  });

  it('each default passes the checks the Texts page applies', () => {
    for (const m of MESSAGES) expect(() => checkMessage(NO_TEXTS, m.key, m.body, {}), m.key).not.toThrow();
    expect(() => checkWords(NO_TEXTS, DEFAULT_WORDS, 'Reply:')).not.toThrow();
  });

  it('no default text mentions a digit command, a rav, or asks about the immersion; no exclamation marks', () => {
    for (const m of MESSAGES) {
      const text = `${m.body} ${m.options.map(o => o.label).join(' ')}`;
      expect(text, m.key).not.toMatch(/\b(text|send|reply|reply with|press)\s+\d\b/i);
      expect(text, m.key).not.toMatch(/\b\d\s+(to|for)\s+(undo|status|record)/i);
      expect(text, m.key).not.toMatch(/\brav\b|\brabbi\b/i);
      expect(text, m.key).not.toMatch(/immers\w*\?|did (she|you) immerse|have you immersed|confirm.*immers/i);
      expect(text, m.key).not.toMatch(/!/);
      for (const o of m.options) expect(o.label, m.key).not.toMatch(/^\d+$/);
    }
  });

  it('the three texts filed with the carrier are word for word as filed, and carry no options', () => {
    expect(MESSAGE_BY_KEY.get('carrier.code')!.body).toBe('Betaharah code: {code}. It expires in {minutes} minutes. Do not share it.');
    expect(MESSAGE_BY_KEY.get('carrier.help')!.body).toBe('Betaharah: text ? for commands. Help: admin@betaharah.com. Reply STOP to opt out.');
    expect(MESSAGE_BY_KEY.get('carrier.start')!.body).toBe(
      "Betaharah: you're subscribed to reminder texts. Message frequency varies. Msg&data rates may apply. Reply ? for help, STOP to opt out.",
    );
    for (const key of ['carrier.code', 'carrier.help', 'carrier.start']) {
      expect(MESSAGE_BY_KEY.get(key)!.filed).toBe(true);
      expect(MESSAGE_BY_KEY.get(key)!.options).toEqual([]);
      expect(compose(NO_TEXTS, [{ key, vars: { code: '123456', minutes: '10' } }])[0]!.text).not.toMatch(/\n/);
    }
  });

  it('the reminders and the status in each phase are in it, with the engine’s own defaults', () => {
    for (const [key, body] of Object.entries({ ...REMINDER_TEXTS, ...STATUS_TEXTS })) expect(MESSAGE_BY_KEY.get(key)?.body, key).toBe(body);
    expect(optionsOf(NO_TEXTS, 'reminder.hefsek').map(([, l]) => l)).toEqual(['DONE', 'STATUS']);
    expect(optionsOf(NO_TEXTS, 'reminder.mikvah').map(([, l]) => l)).toEqual(['STATUS']);
    expect(optionsOf(NO_TEXTS, 'menu.main').map(([, l]) => l)).toEqual(['PERIOD', 'HEFSEK', 'STATUS', 'MORE']);
  });

  it('every message the code says is in the registry, and nothing is sent that is not', () => {
    const said = new Set<string>();
    for (const { path, text } of SOURCES) {
      for (const m of text.matchAll(/\b(?:say|failed|serverText\([^,]+,|messageOut\([^,]+,)\s*\(?\s*'([a-z_]+\.[a-z0-9_.]+)'/g)) said.add(m[1] as string);
      for (const m of text.matchAll(/'((?:record|refuse|date|setup|location|calendar|phones|reminders|custom|customs|vesatot|terms|dates|web|history|undo|delete|signup|join|menu|status|carrier|other)\.[a-z0-9_.]+)'/g)) {
        // keys written in the code (not regular expressions or paths)
        if (/chat\/(engine|site-texts)\.ts$|conversation\.ts$|service\.ts$|dashboard\.ts$|pages\.ts$/.test(path)) said.add(m[1] as string);
      }
      // No send call is given words written in the code.
      expect(text, path).not.toMatch(/send(?:Text|HouseholdText|Sms|Telnyx|TelnyxRcs)\([^;]*?\btext:\s*['"`]/s);
      expect(text, path).not.toMatch(/addMessage\([^;]*?\bbody:\s*['"`]/s);
    }
    for (const key of said) {
      if (MESSAGES.some(m => m.key.startsWith(`${key}`) && m.key !== key) && !MESSAGE_BY_KEY.has(key)) continue; // a prefix, e.g. 'customs.page'
      expect(MESSAGE_BY_KEY.has(key), `${key} is said but not in the registry`).toBe(true);
    }
    expect(said.size).toBeGreaterThan(80);
    // The words of replies live in the registry only: no other file writes them.
    for (const { path, text } of SOURCES) {
      if (/chat\/messages\.ts$|engine\/present\.ts$|chat\/customs\.ts$/.test(path)) continue;
      for (const phrase of ['Not understood; nothing was changed', 'Reply STOP to stop', 'Msg&data rates', 'Have that phone text JOIN', 'Recorded: {']) {
        expect(text.includes(phrase), `${path} writes "${phrase}"`).toBe(false);
      }
    }
  });
});

describe("checking the operator's changes", () => {
  const ok = (key: string, body: string, labels: Record<string, string> = {}) => checkMessage(NO_TEXTS, key, body, labels);

  it('a required placeholder must stay; an unknown one is refused; an optional one may go', () => {
    expect(fails(() => ok('record.flow', 'Recorded.'))).toMatchObject({ field: 'body', message: '{entry} must stay in the text.' });
    expect(fails(() => ok('record.flow', 'Recorded: {entry} on {date}.'))).toMatchObject({ field: 'body', message: expect.stringMatching(/^\{date\} is not a placeholder of this text\. It has: \{entry\}, \{details\}\.$/) });
    expect(() => ok('record.flow', 'Saved: {entry}.')).not.toThrow();
    expect(fails(() => ok('record.flow', 'Saved: {entry. {details}'))).toMatchObject({ field: 'body' });
  });

  it('names a character that is not GSM-7', () => {
    expect(fails(() => ok('menu.main', 'Betaharah’s menu.'))).toMatchObject({ field: 'body', message: expect.stringMatching(/^a curly apostrophe is not in the basic SMS alphabet/) });
    expect(fails(() => ok('menu.main', 'Menu — choose'))).toMatchObject({ message: expect.stringMatching(/^a long dash /) });
    expect(fails(() => ok('menu.main', 'Menu ✓'))).toMatchObject({ message: expect.stringMatching(/^"✓" is not in the basic SMS alphabet/) });
  });

  it('the whole text with examples and options is at most two segments', () => {
    expect(fails(() => ok('menu.main', 'x'.repeat(290)))).toMatchObject({ field: 'body', message: expect.stringMatching(/has 3\d\d characters; at most 306/) });
    expect(() => ok('menu.main', 'x'.repeat(250))).not.toThrow();
  });

  it('labels: 1 to 20 letters, digits and spaces, unique, no carrier word, no general word of another action', () => {
    expect(fails(() => ok('menu.main', 'Menu.', { status: '' }))).toMatchObject({ field: 'label.status', message: 'The label is empty.' });
    expect(fails(() => ok('menu.main', 'Menu.', { status: 'A VERY LONG LABEL TEXT' }))).toMatchObject({ field: 'label.status' });
    expect(fails(() => ok('menu.main', 'Menu.', { status: 'WHERE?' }))).toMatchObject({ field: 'label.status', message: 'A label has only letters, digits and spaces.' });
    expect(fails(() => ok('menu.main', 'Menu.', { status: 'PERIOD' }))).toMatchObject({ field: 'label.status', message: expect.stringMatching(/PERIOD is a general word for "Period began"/) });
    expect(fails(() => ok('menu.main', 'Menu.', { status: 'HEFSEK', hefsek: 'HEFSEK' }))).toMatchObject({ field: 'label.status' });
    expect(fails(() => ok('menu.main', 'Menu.', { status: 'STOP' }))).toMatchObject({ field: 'label.status', message: expect.stringMatching(/^STOP is a word the carrier acts on/) });
    expect(fails(() => ok('menu.main', 'Menu.', { status: 'QUIT NOW' }))).toMatchObject({ field: 'label.status', message: expect.stringMatching(/^QUIT is a word the carrier acts on/) });
    expect(fails(() => ok('history.erase_ask', 'Erase {entry}?', { yes: 'OK', no: 'OK' }))).toMatchObject({ field: 'label.no', message: 'Two options are labelled OK.' });
    expect(fails(() => ok('menu.main', 'Menu.', { status: '7' }))).toMatchObject({ field: 'label.status', message: 'A digit alone cannot be a label.' });
    expect(() => ok('menu.main', 'Menu.', { status: 'WHERE AM I', more: 'MENU MORE' })).not.toThrow();
  });

  it('general words: one word each, no digits only, no carrier word, not in two lists, not the word of another option', () => {
    const words = (patch: Record<string, string[]>) => ({ ...DEFAULT_WORDS, ...patch });
    expect(fails(() => checkWords(NO_TEXTS, words({ status: [] }), 'Reply:'))).toMatchObject({ field: 'words.status' });
    expect(fails(() => checkWords(NO_TEXTS, words({ status: ['two words'] }), 'Reply:'))).toMatchObject({ field: 'words.status' });
    expect(fails(() => checkWords(NO_TEXTS, words({ status: ['9'] }), 'Reply:'))).toMatchObject({ field: 'words.status', message: expect.stringMatching(/only digits/) });
    expect(fails(() => checkWords(NO_TEXTS, words({ status: ['stop'] }), 'Reply:'))).toMatchObject({ field: 'words.status', message: expect.stringMatching(/carrier/) });
    expect(fails(() => checkWords(NO_TEXTS, words({ status: ['status', 'hefsek'] }), 'Reply:'))).toMatchObject({ field: 'words.status', message: '"hefsek" is already a word for "Hefsek done".' });
    expect(fails(() => checkWords(NO_TEXTS, words({ status: ['status', 'now'] }), 'Reply:'))).toMatchObject({ field: 'words.status', message: expect.stringMatching(/^"now" is a word of the option KEEP FOR NOW of "setup.customs"/) });
    expect(fails(() => checkWords(NO_TEXTS, DEFAULT_WORDS, ''))).toMatchObject({ field: 'prefix' });
    expect(fails(() => checkWords(NO_TEXTS, DEFAULT_WORDS, 'Antworte bitte mit diesem Wort:'))).toMatchObject({ field: 'prefix' });
    expect(() => checkWords(NO_TEXTS, words({ status: ['status', 'where', 'situation'] }), 'Options:')).not.toThrow();
  });

  it('stored changes are read leniently: anything no longer valid falls back to the default', () => {
    const t = parseSiteTexts({
      messages: { 'menu.main': { body: 'Hi.', labels: { status: 'WHERE', bogus: 'X' } }, 'no.such': { body: 'x' }, 'record.flow': { body: 'missing the entry' } },
      words: { status: ['status', 'Bad Word'], nonsense: ['x'] },
      prefix: 'Options:',
    });
    expect(t.messages).toEqual({ 'menu.main': { body: 'Hi.', labels: { status: 'WHERE' } } });
    expect(t.words).toEqual({ status: ['status'] });
    expect(t.prefix).toBe('Options:');
    expect(renderBody(t, 'record.flow', { entry: 'x', details: '' })).toBe('Recorded: x.');
    expect(parseSiteTexts('garbage')).toEqual(NO_TEXTS);
    expect(GENERAL_ACTIONS.slice(0, 5).map(a => a.action)).toEqual(['period', 'hefsek', 'status', 'undo', 'menu']);
  });
});
