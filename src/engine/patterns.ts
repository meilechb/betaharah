/**
 * Detects histories that may have established a veset kavua.
 *
 * The engine never applies a veset kavua by itself: whether one has been
 * established, and what follows from it, is not decided here. These
 * checks only raise the question.
 */
import { hebrewOfAbs, nextHebrewMonth } from './hebrew';
import type { OnahPart } from './onah';
import type { FlowRecord } from './vesatot';

export type PatternAlert =
  /** Three flows in a row on the same day of the Hebrew month, in the same onah. */
  | { kind: 'kavua_chodesh'; dayOfMonth: number; part: OnahPart }
  /** Three equal intervals in a row (four flows), the last three flows in the same onah. */
  | { kind: 'kavua_haflagah'; days: number; part: OnahPart }
  /** Three intervals in a row that grow or shrink by the same number of days. */
  | { kind: 'dilug_haflagah'; step: number; part: OnahPart }
  /** Three flows in consecutive months whose day of the month moves by the same step. */
  | { kind: 'dilug_chodesh'; step: number; part: OnahPart };

function sameParts(flows: readonly FlowRecord[]): OnahPart | null {
  const first = flows[0]?.onah.part;
  if (first === undefined) return null;
  return flows.every(f => f.onah.part === first) ? first : null;
}

function inConsecutiveMonths(flows: readonly FlowRecord[]): boolean {
  for (let k = 1; k < flows.length; k++) {
    const a = hebrewOfAbs(flows[k - 1]!.onah.abs);
    const b = hebrewOfAbs(flows[k]!.onah.abs);
    const n = nextHebrewMonth(a.yy, a.mm);
    if (n.yy !== b.yy || n.mm !== b.mm) return false;
  }
  return true;
}

/** Patterns visible at the end of the history (i.e. that include the latest flow). */
export function detectPatterns(flows: readonly FlowRecord[]): PatternAlert[] {
  const alerts: PatternAlert[] = [];
  const n = flows.length;

  if (n >= 3) {
    const last3 = flows.slice(n - 3);
    const part = sameParts(last3);
    if (part && inConsecutiveMonths(last3)) {
      const days = last3.map(f => hebrewOfAbs(f.onah.abs).dd) as [number, number, number];
      const step1 = days[1] - days[0];
      const step2 = days[2] - days[1];
      if (step1 === 0 && step2 === 0) alerts.push({ kind: 'kavua_chodesh', dayOfMonth: days[0], part });
      else if (step1 === step2) alerts.push({ kind: 'dilug_chodesh', step: step1, part });
    }
  }

  if (n >= 4) {
    const last4 = flows.slice(n - 4);
    const part = sameParts(last4.slice(1));
    if (part) {
      const intervals = [1, 2, 3].map(k => last4[k]!.onah.abs - last4[k - 1]!.onah.abs + 1) as [number, number, number];
      const step1 = intervals[1] - intervals[0];
      const step2 = intervals[2] - intervals[1];
      if (step1 === 0 && step2 === 0) alerts.push({ kind: 'kavua_haflagah', days: intervals[0], part });
      else if (step1 === step2) alerts.push({ kind: 'dilug_haflagah', step: step1, part });
    }
  }
  return alerts;
}
