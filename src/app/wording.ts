/**
 * Wording for the dashboard. Sentences are English; halachic terms are
 * shown in English letters or in Hebrew script, as the household chooses.
 */
import { civilDate, eveningLabel, fullDate, onahLabel, weekday } from '../engine/calendar';
import type { LogEntry, LogWarningCode } from '../engine/cycle';
import type { PatternAlert } from '../engine/patterns';
import { clock12 } from '../engine/present';
import { capital, dayOfMonth, fill, hebrewDate, term, type TermLanguage } from '../engine/terms';
import type { Timeline } from '../engine/timeline';
import type { VesatotNote } from '../engine/vesatot';

/** An onah after a colon: "the night of Saturday, Nov 21, 2026 (13 Kislev 5787)" or "Sunday, 13 Kislev 5787 (Nov 22, 2026), by day" */
function onahText(onah: { abs: number; part: 'night' | 'day' }, lang: TermLanguage): string {
  if (onah.part === 'day') return onahLabel(onah, lang);
  return eveningLabel(onah.abs, lang);
}

export function entryText(e: LogEntry, lang: TermLanguage): string {
  switch (e.kind) {
    case 'flow':
      return `${capital(term('flow', lang))}: ${onahText(e.onah, lang)}${e.veset ? '' : fill(' (not counted for {vesatot})', lang)}`;
    case 'stain':
      return `${capital(term('stain', lang))}: ${onahText(e.onah, lang)}`;
    case 'broken':
      return `Count broken: ${onahText(e.onah, lang)}`;
    case 'hefsek':
      return `${capital(term('hefsek', lang))}: ${fullDate(e.abs, lang)}`;
    case 'mikvah':
      return `${capital(term('immersion', lang))}: ${onahText({ abs: e.abs, part: 'night' }, lang)}`;
  }
}

export function statusLines(t: Timeline, timeZone: string, lang: TermLanguage): { headline: string; detail: string } {
  if (t.status.state === 'tehorah') return { headline: capital(term('tehorah', lang)), detail: '' };
  const p = t.status.period;
  const phase = t.status.phase;
  const m = p.planMikvah;
  const mikvah = fill(`{mikvah_night}: ${weekday(m.eveningAbs)}, ${civilDate(m.eveningAbs)}, after ${clock12(m.tzeit, timeZone, 'ceil')}`, lang);
  const niddah = capital(term('niddah', lang));
  switch (phase.kind) {
    case 'before_hefsek':
      return {
        headline: fill(`${niddah}, before the {hefsek}`, lang),
        detail: fill(
          `Began: ${onahText(p.start, lang)}. The {hefsek} can be done from ${fullDate(p.earliestHefsekAbs, lang)}. Next possible day: ${weekday(p.planHefsekAbs)}, ${civilDate(p.planHefsekAbs)}, before ${clock12(p.hefsekSunset, timeZone, 'floor')}.`,
          lang,
        ),
      };
    case 'before_first_day':
      return {
        headline: fill(`${niddah}, after the {hefsek}`, lang),
        detail: capital(fill(`The first of the {clean_days} is ${weekday(p.planCleanDays[0]!.abs)}, ${civilDate(p.planCleanDays[0]!.abs)}. ${capital(mikvah)}.`, lang)),
      };
    case 'counting':
      return { headline: `${capital(term('clean_days', lang))}: day ${phase.day}`, detail: `${capital(mikvah)}.` };
    case 'postponed':
      return { headline: fill('The count is complete; no {immersion} tonight', lang), detail: `${capital(mikvah)}.` };
    case 'mikvah_tonight':
      return { headline: capital(term('mikvah_night', lang)), detail: capital(fill(`{immersion} after {nightfall}: ${clock12(m.tzeit, timeZone, 'ceil')}.`, lang)) };
    case 'mikvah_not_recorded':
      return {
        headline: fill('The count is complete; no {immersion} is recorded', lang),
        detail: fill(`The {mikvah_night} was ${weekday(m.eveningAbs)}, ${civilDate(m.eveningAbs)}.`, lang),
      };
  }
}

export function warningText(code: LogWarningCode, lang: TermLanguage): string {
  const f = (s: string): string => fill(s, lang);
  switch (code) {
    case 'hefsek_without_niddah':
      return f('A {hefsek} is recorded at a time when she was not {niddah}; it is not counted.');
    case 'hefsek_before_start':
      return f('A {hefsek} is recorded before the period began; it is not counted.');
    case 'hefsek_early':
      return f('The {hefsek} was done before the days of waiting were over; the {clean_days} begin only after them. Ask a {rav}.');
    case 'broken_without_count':
      return 'A broken count is recorded when there was no count; it is not counted.';
    case 'mikvah_without_niddah':
      return f('An {immersion} is recorded at a time when she was not {niddah}; it is not counted.');
    case 'mikvah_without_hefsek':
      return f('An {immersion} is recorded with no {hefsek}; it is not counted.');
    case 'mikvah_too_early':
      return f('An {immersion} is recorded before the {clean_days} were complete; it is not counted.');
    case 'mikvah_on_fast_night':
      return f('An {immersion} is recorded on the night of {yom_kippur} or {tisha_bav}.');
    case 'count_cancelled_by_flow':
      return f('A {flow} after the {hefsek}: the count is void and a new {hefsek} is needed.');
    case 'period_began_without_immersion':
      return f('No {immersion} is recorded for the period before the latest one, so the calendar counts the latest {flow} as a new period, with the days of waiting. If she immersed, record the {immersion}. If she had not immersed, ask a {rav}.');
  }
}

export function patternText(p: PatternAlert, lang: TermLanguage): string {
  const ask = fill('Ask a {rav}.', lang);
  const step = (n: number): string => `${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'}`;
  switch (p.kind) {
    case 'kavua_chodesh':
      return fill(`Three times in a row the {flow} began on day ${dayOfMonth(p.dayOfMonth, lang)} of the month, by ${p.part}. A {veset_kavua} for the date may have been established. ${ask}`, lang);
    case 'kavua_haflagah':
      return fill(`Three intervals in a row of ${p.days} days, by ${p.part}. A {veset_kavua} for the interval may have been established. ${ask}`, lang);
    case 'dilug_haflagah':
      return fill(`Three intervals in a row changing by the same step (${step(p.step)}). A {veset_hadilug} may have been established. ${ask}`, lang);
    case 'dilug_chodesh':
      return fill(`Three times in a row the date in the month moved by the same step (${step(p.step)}). A {veset_hadilug} may have been established. ${ask}`, lang);
  }
}

export function noteText(n: VesatotNote, lang: TermLanguage): string {
  const f = (s: string): string => capital(fill(s, lang));
  switch (n) {
    case 'paused':
      return f('{vesatot} are not being calculated (see the settings).');
    case 'long_cycle_exempt':
      return f('{onah_beinonit} and {veset_hachodesh} are not observed for now: three times in a row the {flow} began after day 31.');
    case 'haflagah_previous_hefsek_missing':
      return f('The {veset_haflagah} cannot be counted in {onot}: no {hefsek} is recorded for the previous period.');
    case 'haflagah_awaits_hefsek':
      return f('The {veset_haflagah} (counted in {onot}) will be worked out once the {hefsek} is recorded.');
  }
}
