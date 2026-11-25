/**
 * The spellings the owner chose for the words a person reads (Shabbos, onos,
 * bedikos, vestos, vest, onas havest, Teves, Shvat, ...), and that the
 * earlier spellings are still understood wherever a word is typed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HDate, months } from '@hebcal/hdate';
import { parseDated } from '../src/app/chat';
import type { DatedKind } from '../src/app/chat/dated';
import { generalWords, matchGeneral, matchOption, NO_TEXTS, parseSiteTexts, wordKey } from '../src/app/chat/site-texts';
import { allTerms, hebrewDate } from '../src/engine/terms';
import { household, Phone } from './chat-fixtures';

/** The earlier spellings, as whole words (any letter case). */
const OLD = /\b(shabbat|onot|bedikot|vesatot|veset|onat|beinonit|tevet|shevat)\b|\bhefsek tahara\b/i;

describe('the terms and the month names', () => {
  it('the English column of the terms has none of the earlier spellings', () => {
    const en = allTerms('en');
    for (const [key, text] of Object.entries(en)) expect(text, key).not.toMatch(OLD);
    expect(en).toMatchObject({
      shabbat: 'Shabbos',
      onot: 'onos',
      bedikot: 'bedikos',
      vesatot: 'vestos',
      veset: 'vest',
      veset_onah: 'onas havest',
      veset_hachodesh: 'vest hachodesh',
      veset_haflagah: 'vest haflagah',
      veset_kavua: 'vest kavua',
      veset_hadilug: 'vest hadilug',
      onat_perishah: 'onas perishah',
      onah_beinonit: 'onah beinonis',
      hefsek: 'hefsek taharah',
    });
  });

  it('every month of a leap year and of a plain year is named without the earlier spellings: Teves, Shvat', () => {
    const names = new Set<string>();
    for (const year of [5784, 5787]) {
      const last = new HDate(1, months.NISAN, year).isLeapYear() ? 13 : 12;
      for (let m = 1; m <= last; m++) names.add(hebrewDate(new HDate(1, m, year).abs(), 'en', false).replace(/^1 /, ''));
    }
    for (const name of names) expect(name).not.toMatch(OLD);
    expect(names).toContain('Teves');
    expect(names).toContain('Shvat');
    expect(hebrewDate(new HDate(22, months.TEVET, 5787).abs(), 'en')).toBe('22 Teves 5787');
    expect(hebrewDate(new HDate(10, months.SHVAT, 5787).abs(), 'en')).toBe('10 Shvat 5787');
  });
});

describe('both spellings are understood when typed', () => {
  it('a word is compared by its current spelling, in any letter case', () => {
    expect(['shabbat', 'SHABBAT', 'Shabbos', 'shabbos'].map(wordKey)).toEqual(['SHABBOS', 'SHABBOS', 'SHABBOS', 'SHABBOS']);
    expect(['bedikot', 'Bedikos'].map(wordKey)).toEqual(['BEDIKOS', 'BEDIKOS']);
    expect(['vesatot', 'VESTOS'].map(wordKey)).toEqual(['VESTOS', 'VESTOS']);
    expect(['onot', 'onos', 'beinonit', 'beinonis', 'tevet', 'teves', 'shevat', 'shvat'].map(wordKey)).toEqual(['ONOS', 'ONOS', 'BEINONIS', 'BEINONIS', 'TEVES', 'TEVES', 'SHVAT', 'SHVAT']);
    expect(wordKey('niddah')).toBe('NIDDAH');
  });

  it('an option labelled with either spelling is chosen by either spelling', () => {
    for (const label of ['IN ONOS', 'IN ONOT']) {
      const options = [
        ['v0', 'IN DAYS'],
        ['v1', label],
        ['keep', 'KEEP'],
      ] as const;
      for (const typed of ['in onot', 'IN ONOS', 'In Onos', 'onot', 'onos']) expect(matchOption(typed, options), `${label} / ${typed}`).toEqual({ id: 'v1', rest: [] });
    }
  });

  it('the general words: VESTOS and VESATOT both pause or resume, also with the operator list of the earlier spelling only', () => {
    expect(generalWords(NO_TEXTS).vesatot).toEqual(['vestos', 'vesatot']);
    for (const typed of ['pause vesatot', 'PAUSE VESTOS', 'Vestos pause']) expect(matchGeneral(typed, generalWords(NO_TEXTS))).toEqual({ id: 'vesatot', rest: ['pause'] });
    const old = parseSiteTexts({ words: { vesatot: ['vesatot'] } });
    expect(matchGeneral('resume vestos', generalWords(old))).toEqual({ id: 'vesatot', rest: ['resume'] });
  });

  it('REMINDERS offers BEDIKOS and SHABBOS; bedikot, bedikos, shabbat and shabbos are each understood', () => {
    for (const typed of ['bedikot', 'BEDIKOS', 'Bedikot', 'bedikos']) {
      const p = new Phone(household());
      p.send('reminders');
      expect(p.options()).toEqual(['TURN ON', 'KINDS', 'WORDING', 'BEDIKOS', 'SHABBOS']);
      expect(p.say(typed), typed).toMatch(/^Bedikah reminders are on:/);
    }
    for (const typed of ['shabbat', 'SHABBOS', 'Shabbat', 'shabbos']) {
      const p = new Phone(household());
      p.send('reminders');
      expect(p.say(typed), typed).toMatch(/^Before Shabbos and Yom Tov: one text that morning at/);
    }
    for (const typed of ['reminders bedikot', 'reminders bedikos']) expect(new Phone(household()).say(typed)).toMatch(/^Bedikah reminders are on:/);
    for (const typed of ['reminders shabbat', 'reminders shabbos']) expect(new Phone(household()).say(typed)).toMatch(/^Before Shabbos and Yom Tov:/);
  });

  it('an operator label kept in the earlier spelling is still chosen by the new one', () => {
    const p = new Phone(household());
    p.texts = parseSiteTexts({ messages: { 'reminders.show': { labels: { bedikot: 'BEDIKOT' } } } });
    p.send('reminders');
    expect(p.options()).toContain('BEDIKOT');
    expect(p.say('bedikos')).toMatch(/^Bedikah reminders are on:/);
  });

  it('the customs: VESTOS, BEINONIS DAY and IN ONOS are shown; the earlier spellings choose them too', () => {
    for (const typed of ['vesatot', 'vestos']) {
      const p = new Phone(household());
      p.send('customs');
      p.send('next');
      p.send('next');
      expect(p.options()).toContain('VESTOS');
      expect(p.say(typed), typed).toMatch(/^Vestos: calculated, or paused\. Now: calculated\./);
    }
    for (const typed of ['beinonit day', 'BEINONIS DAY']) {
      const p = new Phone(household());
      p.send('customs');
      expect(p.options()).toContain('BEINONIS DAY');
      expect(p.say(typed), typed).toMatch(/^Onah beinonis \(the flow is day 1\)/);
    }
    for (const typed of ['in onot', 'IN ONOS']) {
      const data = household();
      const p = new Phone(data);
      p.send('customs');
      p.send('next');
      p.send('haflagah');
      expect(p.options()).toEqual(['IN DAYS', 'IN ONOS', 'KEEP']);
      expect(p.say(typed), typed).toBe('Changed: haflagah count: in onos.');
      expect(data.halachic.haflagahMethod).toBe('onot_from_hefsek');
    }
  });

  it('a Hebrew date: Tevet or Teves, Shevat or Shvat', () => {
    const parse = (kind: DatedKind, text: string) => parseDated(kind, text.split(/\s+/));
    for (const month of ['tevet', 'teves', 'Teves', 'TEVET']) expect(parse('flow', `3 ${month} night`), month).toMatchObject({ kind: 'ok', date: { m: 10, d: 3 } });
    for (const month of ['shevat', 'shvat', 'Shvat', "sh'vat"]) expect(parse('hefsek', `12 ${month}`), month).toMatchObject({ kind: 'ok', date: { m: 11, d: 12 } });
  });
});

/** Every file under a directory. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** The string literals of a script and the text of a page: what a person may read. */
function readable(path: string, source: string): string[] {
  if (path.endsWith('.html') || path.endsWith('.svg')) {
    return [source.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ')];
  }
  if (path.endsWith('.js')) {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    return [...code.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map(m => m[0].slice(1, -1));
  }
  return [];
}

/**
 * A string literal that is a key, not a word: 'onot', 'reminders.bedikot',
 * 'rem-bedikot-am', '{bedikot}' (a term key, filled in with the new
 * spelling), or one of the Hebrew month names the calendar compares.
 */
const KEY = /^[a-z_]+$|^[a-z]+[.\-_][\w.\-]+$|^#?[a-z]+(-[a-z]+)+$/;

describe('no earlier spelling where a person reads it', () => {
  it('in public/: the pages, the images drawn as SVG, and the strings of the scripts', () => {
    const found: string[] = [];
    for (const path of filesUnder('public').filter(p => /\.(html|js|svg)$/.test(p))) {
      for (const text of readable(path, readFileSync(path, 'utf8'))) {
        if (KEY.test(text)) continue;
        const words = text.replace(/\{[a-z_]+\}/g, ''); // a term key is filled in with the current spelling
        const m = OLD.exec(words);
        if (m) found.push(`${path}: ${m[0]} in "${text.slice(0, 80)}"`);
      }
    }
    expect(found).toEqual([]);
  });

  it('in src/app/pages.ts: Help, Privacy and Terms', () => {
    const code = readFileSync('src/app/pages.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const strings = [...code.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map(m => m[0].slice(1, -1));
    expect(strings.length).toBeGreaterThan(20);
    const found = strings.filter(s => !KEY.test(s) && OLD.test(s.replace(/\{[a-z_]+\}/g, '')));
    expect(found).toEqual([]);
  });

  it('the check itself finds an earlier spelling in a string, and not in a key', () => {
    expect(readable('x.js', "const a = t.onot; const b = 'Over Shabbat.'; // Shabbat").filter(s => !KEY.test(s) && OLD.test(s))).toEqual(['Over Shabbat.']);
    expect(readable('x.js', "a.reminders.bedikot = 1; f('reminders.bedikot', 'rem-bedikot-am', 'onot', '{bedikot}')").filter(s => !KEY.test(s) && OLD.test(s.replace(/\{[a-z_]+\}/g, '')))).toEqual([]);
    expect(readable('x.html', '<p class="shabbat-note">Kislev – Tevet</p>').some(s => OLD.test(s))).toBe(true);
  });
});
