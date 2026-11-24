import { describe, expect, it } from 'vitest';
import { LETTERS, SMS_CUSTOMS, sameValue } from '../src/app/chat/customs';
import { isGsmBasic, MAX_TEXT_CHARS, repairs } from '../src/app/chat/gsm';
import { DEFAULT_HALACHIC_SETTINGS, HALACHIC_CHOICES, TZEIT_PRESETS, type HalachicSettings } from '../src/engine/settings';
import { household, Phone } from './chat-fixtures';

describe('the customs as texted', () => {
  it('cover every setting key exactly once, in the dashboard order, with nightfall last', () => {
    const keys = SMS_CUSTOMS.map(c => c.key);
    expect(keys).toEqual([...HALACHIC_CHOICES.map(c => c.key), 'tzeit']);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(Object.keys(DEFAULT_HALACHIC_SETTINGS).sort());
  });

  it('cover every option value exactly once, in the same order as the dashboard', () => {
    for (const choice of HALACHIC_CHOICES) {
      const sms = SMS_CUSTOMS.find(c => c.key === choice.key)!;
      expect(sms.options.map(o => o.value), choice.key).toEqual(choice.options.map(o => o.value));
    }
    const tzeit = SMS_CUSTOMS.find(c => c.key === 'tzeit')!;
    expect(tzeit.options.map(o => o.value)).toEqual(TZEIT_PRESETS.map(p => p.rule));
    for (const c of SMS_CUSTOMS) {
      for (let i = 0; i < c.options.length; i++) {
        for (let j = i + 1; j < c.options.length; j++) expect(sameValue(c.options[i]!.value, c.options[j]!.value)).toBe(false);
      }
    }
  });

  it('keep the meaning words of each dashboard option (spot checks of what must not be lost)', () => {
    const text = (key: string, i: number): string => SMS_CUSTOMS.find(c => c.key === key)!.options[i]!.text;
    expect(text('minWaitDays', 0)).toMatch(/five days.*Ashkenazi.*Sephardi/);
    expect(text('minWaitDays', 1)).toMatch(/four days.*Sephardi/);
    expect(text('beinonitDays', 2)).toBe('day 30 and day 31');
    expect(text('beinonitLength', 1)).toMatch(/night and the day of that date/);
    expect(text('haflagahMethod', 1)).toMatch(/onot.*hefsek.*Shulchan Aruch HaRav.*Chabad/);
    expect(text('longerHaflagah', 1)).toMatch(/every longer haflagah not yet passed without a flow/);
    expect(text('chodesh30', 2)).toMatch(/both the 29th and the 1st/);
    expect(text('longCycle', 1)).toMatch(/not observed, as long as a flow does not come earlier again/);
    expect(text('vesatot', 1)).toMatch(/no vesatot are calculated for now/);
    expect(text('tzeit', 3)).toMatch(/72 minutes after sunset \(Rabbeinu Tam\)/);
    expect(SMS_CUSTOMS[0]!.note).toMatch(/last relations, ask a rav/);
  });

  it('labels: letter and short words fit an RCS button (20 characters); all GSM-7', () => {
    for (const c of SMS_CUSTOMS) {
      expect(isGsmBasic(c.name + c.question + c.note)).toBe(true);
      for (const [j, o] of c.options.entries()) {
        expect(`${LETTERS[j]}: ${o.short}`.length, o.short).toBeLessThanOrEqual(20);
        expect(isGsmBasic(o.text + o.short)).toBe(true);
      }
    }
  });

  // Every question, asked by itself, and every letter answer: maps to the right stored value.
  for (const [index, c] of SMS_CUSTOMS.entries()) {
    describe(`custom ${index + 1}: ${c.key}`, () => {
      it('the question fits two segments, lists every option by letter, and says the current one', () => {
        const p = new Phone(household());
        p.send('CUSTOMS');
        const out = p.send(LETTERS[index]!);
        expect(out.out).toHaveLength(1);
        const text = out.out[0]!.text;
        expect(text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
        expect(isGsmBasic(text)).toBe(true);
        expect(text.startsWith(`Custom ${index + 1} of 12: `)).toBe(true);
        for (const [j, o] of c.options.entries()) expect(text).toContain(`${LETTERS[j]}: ${o.text}.`);
        expect(text).toMatch(/Now: [A-D]\. Reply .*, or KEEP\.$/);
        expect(out.chat?.q).toEqual({ kind: 'custom', index, walk: false });
        expect(out.out[0]!.suggestions!.length).toBeLessThanOrEqual(4);
      });
      for (const [j, o] of c.options.entries()) {
        it(`letter ${LETTERS[j]} stores ${JSON.stringify(o.value)}`, () => {
          const data = household();
          const p = new Phone(data);
          p.send('CUSTOMS');
          p.send(LETTERS[index]!);
          const before = structuredClone(data.halachic);
          const out = p.send(LETTERS[j]!);
          const stored = (data.halachic as unknown as Record<string, unknown>)[c.key];
          expect(stored).toEqual(o.value);
          // nothing else moved
          for (const k of Object.keys(before) as Array<keyof HalachicSettings>) if (k !== c.key) expect(data.halachic[k]).toEqual(before[k]);
          const was = (before as unknown as Record<string, unknown>)[c.key];
          if (JSON.stringify(was) === JSON.stringify(o.value)) {
            expect(out.changed).toBe(false);
            expect(out.out[0]!.text).toMatch(/already the setting.*nothing was changed/);
          } else {
            expect(out.changed).toBe(true);
            expect(out.out[0]!.text).toBe(`Changed: ${c.name}: ${o.text}. The calendar follows what you selected.`);
          }
          expect(out.chat).toBeNull();
          // a single change does not count as reviewing all of them
          expect(data.halachicConfirmedAt).toBeNull();
        });
      }
      it('a letter past the options, a digit, or junk changes nothing and keeps the question', () => {
        const data = household();
        const p = new Phone(data);
        p.send('CUSTOMS');
        p.send(LETTERS[index]!);
        const before = structuredClone(data.halachic);
        for (const bad of [LETTERS[c.options.length]!, 'Z', 'AB', 'A B', 'yes', 'maybe', '']) {
          const out = p.send(bad);
          expect(out.changed, bad).toBe(false);
          expect(out.out[0]!.text, bad).toMatch(/^Not understood; nothing was changed\./);
          expect(p.chat?.q, bad).toEqual({ kind: 'custom', index, walk: false });
        }
        expect(data.halachic).toEqual(before);
        p.send('KEEP');
        expect(p.last!.out[0]!.text).toBe('Kept as it was; nothing was changed.');
        expect(data.halachic).toEqual(before);
      });
    });
  }

  it('a nightfall typed in on the website is shown, and KEEP keeps it', () => {
    const data = household();
    data.halachic.tzeit = { kind: 'minutes', value: 60 };
    const p = new Phone(data);
    const text = p.say('NIGHTFALL');
    expect(text).toContain('Now: 60 minutes after sunset (set on the website).');
    p.say('KEEP');
    expect(data.halachic.tzeit).toEqual({ kind: 'minutes', value: 60 });
  });

  it('going through all 12 (CUSTOMS ALL) saves each answer, confirms it, and sets halachicConfirmedAt at the end', () => {
    const data = household();
    const p = new Phone(data);
    let out = p.send('CUSTOMS ALL');
    expect(out.out[0]!.text.startsWith('Custom 1 of 12:')).toBe(true);
    const answers = ['B', 'A', 'A', 'B', 'B', 'B', 'A', 'D', 'B', 'KEEP', 'B', 'D'];
    for (const [i, a] of answers.entries()) {
      expect(data.halachicConfirmedAt).toBeNull();
      out = p.send(a);
      const all = out.out.map(m => m.text).join(' ');
      expect(all).toMatch(new RegExp(`^(Saved|Kept): ${SMS_CUSTOMS[i]!.name}: `));
      if (i < 11) expect(out.chat?.q).toEqual({ kind: 'custom', index: i + 1, walk: true });
    }
    expect(out.chat).toBeNull();
    expect(out.out.map(m => m.text).join(' ')).toContain('All 12 customs are saved.');
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

  it('PAUSE VESATOT needs YES; RESUME VESATOT turns them back on', () => {
    const data = household();
    const p = new Phone(data);
    expect(p.say('PAUSE VESATOT')).toMatch(/Reply YES to pause them, NO to keep them\.$/);
    expect(data.halachic.vesatot).toBe('active');
    expect(p.say('NO')).toBe('Nothing was changed.');
    expect(data.halachic.vesatot).toBe('active');
    p.say('PAUSE VESATOT');
    expect(p.say('YES')).toMatch(/^Changed: no vesatot are calculated for now, as you selected\./);
    expect(data.halachic.vesatot).toBe('paused');
    expect(p.say('PAUSE VESATOT')).toMatch(/already paused/);
    expect(p.say('RESUME VESATOT')).toBe('Changed: vesatot are calculated again, as you selected.');
    expect(data.halachic.vesatot).toBe('active');
    expect(p.say('RESUME VESATOT')).toMatch(/already calculated/);
    expect(p.say('PAUSE')).toMatch(/^Not understood; nothing was changed\. Write PAUSE VESATOT\.$/);
  });
});
