/**
 * Wording for the dashboard. Sentences are English; halachic terms are
 * shown in English letters or in Hebrew script, as the household chooses.
 */
import { localAbs } from '../engine/civil';
import type { LogEntry, LogWarningCode } from '../engine/cycle';
import { dayWords, nightWords, onahWords, type DateStyle, type DateWords } from '../engine/dates';
import type { PatternAlert } from '../engine/patterns';
import { clock12 } from '../engine/present';
import { capital, dayOfMonth, fill, term, type TermLanguage } from '../engine/terms';
import type { Timeline } from '../engine/timeline';
import type { VesatotNote } from '../engine/vesatot';

/**
 * A Log entry. The Log is read on any day, so each date is written in full,
 * with its year: "Flow: Saturday night, Nov 21, 2026", "Hefsek taharah:
 * Thursday, 16 Kislev 5787", "Stain: Sunday, Nov 22, 2026 (12 Kislev 5787),
 * by day".
 */
export function entryText(e: LogEntry, lang: TermLanguage, dates: DateStyle): string {
  const w: DateWords = { dates, lang, long: true, year: true };
  const onah = (o: { abs: number; part: 'night' | 'day' }): string => onahWords(o, w, ', by day');
  switch (e.kind) {
    case 'flow':
      return `${capital(term('flow', lang))}: ${onah(e.onah)}${e.veset ? '' : fill(' (not counted for {vesatot})', lang)}`;
    case 'stain':
      return `${capital(term('stain', lang))}: ${onah(e.onah)}`;
    case 'broken':
      return `Count broken: ${onah(e.onah)}`;
    case 'hefsek':
      return `${capital(term('hefsek', lang))}: ${dayWords(e.abs, w)}`;
    case 'mikvah':
      return `${capital(term('immersion', lang))}: ${nightWords(e.abs, w)}`;
  }
}

/** Where things stand: a headline, and one short line with the next date and its time. */
export function statusLines(t: Timeline, timeZone: string, lang: TermLanguage, dates: DateStyle): { headline: string; detail: string } {
  if (t.status.state === 'tehorah') return { headline: capital(term('tehorah', lang)), detail: '' };
  const w: DateWords = { dates, lang, long: true, today: localAbs(t.now, timeZone) };
  const p = t.status.period;
  const phase = t.status.phase;
  const m = p.planMikvah;
  const mikvah = capital(fill(`{mikvah_night}: ${nightWords(m.nightAbs, w)}, after ${clock12(m.tzeit, timeZone, 'ceil')}.`, lang));
  const niddah = capital(term('niddah', lang));
  switch (phase.kind) {
    case 'before_hefsek':
      return {
        headline: fill(`${niddah}, before the {hefsek}`, lang),
        detail: capital(fill(`{hefsek} from ${dayWords(p.planHefsekAbs, w)}, before ${clock12(p.hefsekSunset, timeZone, 'floor')}.`, lang)),
      };
    case 'before_first_day':
      return {
        headline: fill(`${niddah}, after the {hefsek}`, lang),
        detail: capital(fill(`The {clean_days} begin ${dayWords(p.planCleanDays[0]!.abs, w)}. `, lang)) + mikvah,
      };
    case 'counting':
      return { headline: `${capital(term('clean_days', lang))}: day ${phase.day}`, detail: mikvah };
    case 'postponed':
      return { headline: fill('The count is complete; no {immersion} tonight', lang), detail: mikvah };
    case 'mikvah_tonight':
      return { headline: capital(term('mikvah_night', lang)), detail: capital(fill(`{immersion} after ${clock12(m.tzeit, timeZone, 'ceil')}.`, lang)) };
  }
}

export function warningText(code: LogWarningCode, lang: TermLanguage): string {
  const f = (s: string): string => fill(s, lang);
  switch (code) {
    case 'hefsek_without_niddah':
      return f('A {hefsek} when she was not {niddah} is not counted.');
    case 'hefsek_before_start':
      return f('A {hefsek} before the period began is not counted.');
    case 'hefsek_early':
      return f('The {hefsek} was before the days of waiting ended; the {clean_days} begin after them.');
    case 'broken_without_count':
      return 'A broken count with no count is not counted.';
    case 'mikvah_without_niddah':
      return f('An {immersion} when she was not {niddah} is not counted.');
    case 'mikvah_without_hefsek':
      return f('An {immersion} with no {hefsek} is not counted.');
    case 'mikvah_too_early':
      return f('An {immersion} before the {clean_days} ended is not counted.');
    case 'mikvah_on_fast_night':
      return f('An {immersion} on the night of {yom_kippur} or {tisha_bav}.');
    case 'count_cancelled_by_flow':
      return f('A {flow} after the {hefsek}: the count is void and a new {hefsek} is needed.');
    case 'period_began_without_hefsek':
      return f('No {hefsek} was recorded for the period before; this is counted as a new period.');
  }
}

export function patternText(p: PatternAlert, lang: TermLanguage): string {
  const step = (n: number): string => `${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'}`;
  switch (p.kind) {
    case 'kavua_chodesh':
      return fill(`Three times in a row the {flow} began on day ${dayOfMonth(p.dayOfMonth, lang)} of the month, by ${p.part}. A {veset_kavua} for the date may have been established.`, lang);
    case 'kavua_haflagah':
      return fill(`Three intervals in a row of ${p.days} days, by ${p.part}. A {veset_kavua} for the interval may have been established.`, lang);
    case 'dilug_haflagah':
      return fill(`Three intervals in a row changing by the same step (${step(p.step)}). A {veset_hadilug} may have been established.`, lang);
    case 'dilug_chodesh':
      return fill(`Three times in a row the date in the month moved by the same step (${step(p.step)}). A {veset_hadilug} may have been established.`, lang);
  }
}

export function noteText(n: VesatotNote, lang: TermLanguage): string {
  const f = (s: string): string => capital(fill(s, lang));
  switch (n) {
    case 'paused':
      return f('{vesatot} are paused.');
    case 'long_cycle_exempt':
      return f('{onah_beinonit} and {veset_hachodesh} are not observed: three cycles in a row past day 31.');
    case 'haflagah_previous_hefsek_missing':
      return f('The {veset_haflagah} cannot be counted in {onot}: no {hefsek} is recorded for the previous period.');
    case 'haflagah_awaits_hefsek':
      return f('The {veset_haflagah} (counted in {onot}) will be worked out once the {hefsek} is recorded.');
  }
}
