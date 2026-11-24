import { describe, expect, it } from 'vitest';
import { SMS_CUSTOMS, sameValue } from '../src/app/chat/customs';
import { isGsmBasic, MAX_TEXT_CHARS, repairs } from '../src/app/chat/gsm';
import { CUSTOM_LABELS, shortWords } from '../src/app/chat/messages';
import { DEFAULT_HALACHIC_SETTINGS, HALACHIC_CHOICES, TZEIT_PRESETS, type HalachicSettings } from '../src/engine/settings';
import { household, Phone } from './chat-fixtures';

/** The option to tap for a custom, as the customs pages show it. */
const PAGE: Record<string, [page: number, label: string]> = {
  minWaitDays: [1, 'WAIT DAYS'],
  beinonitDays: [1, 'BEINONIT DAY'],
  beinonitLength: [1, 'BEINONIT LENGTH'],
  chodeshLength: [1, 'CHODESH LENGTH'],
  orZarua: [2, 'OR ZARUA'],
  haflagahMethod: [2, 'HAFLAGAH'],
  longerHaflagah: [2, 'LONGER HAFLAGAH'],
  chodesh30: [2, 'THE 30TH'],
  longCycle: [2, 'LONG CYCLES'],
  vesatot: [3, 'VESATOT'],
  yomTov: [3, 'YOM TOV'],
  tzeit: [3, 'NIGHTFALL'],
};

/** Opens one custom by the options: CUSTOMS, NEXT as needed, its label. */
function open(p: Phone, key: string): void {
  const [page, label] = PAGE[key]!;
  p.send('CUSTOMS');
  for (let n = 1; n < page; n++) p.send('NEXT');
  p.send(label);
}

describe('the customs as texted', () => {
  it('cover every setting key exactly once, in the dashboard order, with nightfall last', () => {
    const keys = SMS_CUSTOMS.map(c => c.key);
    expect(keys).toEqual([...HALACHIC_CHOICES.map(c => c.key), 'tzeit']);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(Object.keys(DEFAULT_HALACHIC_SETTINGS).sort());
  });

  it('cover every option value exactly once, in the same order as the dashboard, each with a label', () => {
    for (const choice of HALACHIC_CHOICES) {
      const sms = SMS_CUSTOMS.find(c => c.key === choice.key)!;
      expect(sms.options.map(o => o.value), choice.key).toEqual(choice.options.map(o => o.value));
    }
    const tzeit = SMS_CUSTOMS.find(c => c.key === 'tzeit')!;
    expect(tzeit.options.map(o => o.value)).toEqual(TZEIT_PRESETS.map(p => p.rule));
    for (const c of SMS_CUSTOMS) {
      expect(CUSTOM_LABELS[c.key]!.length, c.key).toBe(c.options.length);
      for (let i = 0; i < c.options.length; i++) {
        for (let j = i + 1; j < c.options.length; j++) expect(sameValue(c.options[i]!.value, c.options[j]!.value)).toBe(false);
      }
    }
  });

  it('keep the meaning words of each dashboard option (spot checks of what must not be lost)', () => {
    const q = (key: string): string => SMS_CUSTOMS.find(c => c.key === key)!.question;
    expect(q('minWaitDays')).toMatch(/five \(Ashkenazi, some Sephardi\) or four \(some Sephardi\)/);
    expect(q('beinonitDays')).toMatch(/day 30, day 31, or both/);
    expect(q('beinonitLength')).toMatch(/the onah of the flow, or the full day/);
    expect(q('haflagahMethod')).toMatch(/onot, hefsek to flow \(Chabad\)/);
    expect(q('chodesh30')).toMatch(/the 1st of the month after, the 29th, both, or none/);
    expect(q('longCycle')).toMatch(/not until a shorter cycle/);
    expect(q('tzeit')).toMatch(/72 minutes \(Rabbeinu Tam\)/);
    // nothing tells anyone to ask anyone
    for (const c of SMS_CUSTOMS) expect(c.question + c.note + c.options.map(o => o.text).join()).not.toMatch(/\brav\b/i);
    for (const c of SMS_CUSTOMS) expect(isGsmBasic(c.name + c.question + c.options.map(o => o.short).join())).toBe(true);
  });

  // Every question, opened by the options, and every option: maps to the right stored value.
  for (const [index, c] of SMS_CUSTOMS.entries()) {
    describe(`custom ${index + 1}: ${c.key}`, () => {
      it('the question fits two segments, says the current option, and offers every option and KEEP', () => {
        const p = new Phone(household());
        open(p, c.key);
        const out = p.last!;
        expect(out.out).toHaveLength(1);
        const text = out.out[0]!.text;
        expect(text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
        expect(isGsmBasic(text)).toBe(true);
        const current = c.options.find(o => sameValue(o.value, (DEFAULT_HALACHIC_SETTINGS as unknown as Record<string, typeof o.value>)[c.key]!))!;
        expect(out.out[0]!.body).toBe(`${c.question} Now: ${shortWords(current.short)}.`);
        expect(p.options()).toEqual([...CUSTOM_LABELS[c.key]!, 'KEEP']);
        expect(out.chat?.ctx).toEqual({ index, walk: false });
      });
      for (const [j, o] of c.options.entries()) {
        it(`${CUSTOM_LABELS[c.key]![j]} stores ${JSON.stringify(o.value)}`, () => {
          const data = household();
          const p = new Phone(data);
          open(p, c.key);
          const before = structuredClone(data.halachic);
          const out = p.send(CUSTOM_LABELS[c.key]![j]!);
          const was = (before as unknown as Record<string, unknown>)[c.key];
          const pausing = c.key === 'vesatot' && o.value === 'paused';
          if (pausing) {
            // Pausing vesatot asks first.
            expect(out.out[0]!.body).toMatch(/^Pause vesatot\?/);
            expect(p.options()).toEqual(['YES', 'NO']);
            p.send('YES');
          }
          const stored = (data.halachic as unknown as Record<string, unknown>)[c.key];
          expect(stored).toEqual(o.value);
          // nothing else moved
          for (const k of Object.keys(before) as Array<keyof HalachicSettings>) if (k !== c.key) expect(data.halachic[k]).toEqual(before[k]);
          if (JSON.stringify(was) === JSON.stringify(o.value)) {
            expect(out.changed).toBe(false);
            expect(out.out[0]!.body).toBe('That is already the setting. Nothing was changed.');
          } else if (!pausing) {
            expect(out.changed).toBe(true);
            expect(out.out[0]!.body).toMatch(new RegExp(`^Changed: ${c.name}: `));
          }
          // a single change does not count as reviewing all of them
          expect(data.halachicConfirmedAt).toBeNull();
        });
      }
      it('junk, a digit or an empty text changes nothing', () => {
        const data = household();
        const p = new Phone(data);
        open(p, c.key);
        const before = structuredClone(data.halachic);
        for (const bad of ['Z', '7', 'maybe', '']) {
          const out = p.send(bad);
          expect(out.changed, bad).toBe(false);
          expect(out.out[0]!.body, bad).toBe('Not understood; nothing was changed.');
          expect(p.options()).toEqual(['PERIOD', 'HEFSEK', 'STATUS', 'MORE']);
          open(p, c.key);
        }
        expect(data.halachic).toEqual(before);
        expect(p.say('KEEP')).toBe('Nothing was changed.');
        expect(data.halachic).toEqual(before);
      });
    });
  }

  it('a nightfall typed in on the website is shown, and KEEP keeps it', () => {
    const data = household();
    data.halachic.tzeit = { kind: 'minutes', value: 60 };
    const p = new Phone(data);
    expect(p.say('NIGHTFALL')).toContain('Now: 60 minutes after sunset (set on the website).');
    p.say('KEEP');
    expect(data.halachic.tzeit).toEqual({ kind: 'minutes', value: 60 });
  });

  it('going through all 12 (ALL 12) saves each answer, confirms it, and sets halachicConfirmedAt at the end', () => {
    const data = household();
    const p = new Phone(data);
    p.send('CUSTOMS');
    let out = p.send('ALL 12');
    expect(out.out[0]!.body.startsWith('Custom 1 of 12:')).toBe(true);
    const answers = ['FOUR DAYS', 'DAY 30', 'ONE ONAH', 'FULL DAY', 'NOT OBSERVED', 'IN ONOT', 'LATEST ONLY', 'NONE', 'NOT OBSERVED', 'KEEP', 'ISRAEL', '72 MINUTES'];
    for (const [i, a] of answers.entries()) {
      expect(data.halachicConfirmedAt).toBeNull();
      out = p.send(a);
      expect(out.out.map(m => m.body).join(' ')).toMatch(new RegExp(`^(Saved|Kept): ${SMS_CUSTOMS[i]!.name}: `));
      if (i < 11) expect(out.chat?.ctx).toEqual({ index: i + 1, walk: true });
    }
    expect(out.out.map(m => m.body).join(' ')).toContain('All 12 customs are saved.');
    expect(data.halachicConfirmedAt).toBe(p.now);
    expect(data.halachic).toEqual({
      minWaitDays: '4',
      beinonitDays: '30',
      beinonitLength: 'onah',
      chodeshLength: 'full',
      orZarua: 'no',
      haflagahMethod: 'onot_from_hefsek',
      longerHaflagah: 'latest_only',
      chodesh30: 'none',
      longCycle: 'exempt',
      vesatot: 'active',
      yomTov: 'israel',
      tzeit: { kind: 'minutes', value: 72 },
    });
    expect(repairs).toEqual({ folded: 0, shortened: 0 });
  });

  it('answers are read by words too: "8.5 degrees", "both of them", "the 29th"', () => {
    const data = household();
    const p = new Phone(data);
    data.halachic.tzeit = { kind: 'minutes', value: 72 };
    p.send('NIGHTFALL');
    expect(p.say('8.5 degrees')).toBe('Changed: nightfall: 8.5 degrees.');
    expect(data.halachic.tzeit).toEqual({ kind: 'degrees', value: 8.5 });
    open(p, 'chodesh30');
    expect(p.say('the 29th please')).toBe('Changed: flow on the 30th: the 29th.');
    open(p, 'beinonitDays');
    p.say('day 30');
    open(p, 'beinonitDays');
    expect(p.say('both of them')).toBe('Changed: onah beinonit day: both.');
  });

  it('VESATOT PAUSE needs YES; VESATOT RESUME turns them back on', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('pause vesatot')).toBe('Pause vesatot? No onot perishah are shown while they are paused.');
    expect(p.options()).toEqual(['YES', 'NO']);
    expect(data.halachic.vesatot).toBe('active');
    expect(p.say('NO')).toBe('Nothing was changed.');
    expect(data.halachic.vesatot).toBe('active');
    p.say('PAUSE VESATOT');
    expect(p.say('YES')).toBe('Changed: vesatot are paused.');
    expect(data.halachic.vesatot).toBe('paused');
    expect(p.say('PAUSE VESATOT')).toBe('Vesatot are already paused.');
    expect(p.say('resume vesatot')).toBe('Changed: vesatot are calculated again.');
    expect(data.halachic.vesatot).toBe('active');
    expect(p.say('RESUME VESATOT')).toMatch(/already calculated/);
  });
});
