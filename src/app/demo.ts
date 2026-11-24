/**
 * The test account: a made-up household the operator opens with one click
 * from the console, to try every feature on the live site, including text
 * commands and reminders, without any text being sent.
 *
 * Its phones have numbers from 555-0100 to 555-0199, which are reserved for
 * fiction and are never real phones. Inside a test account every text is
 * recorded as "simulated" instead of being sent (see service.ts).
 */
import { localAbs } from '../engine/civil';
import { dayTimes, onahWindow } from '../engine/zmanim';
import { recordEntry, whereOf, type Computed, type DraftEntry } from './household';
import { newHousehold, type HouseholdData } from './model';
import { PLACES, REMINDER_KINDS, type PhoneRecord } from './settings';

/** The phone the operator is signed in with when the test account opens. */
export const DEMO_NUMBER = '+17325550100';
/** A second phone on the test account, as a spouse's would be. */
export const DEMO_SPOUSE = '+17325550199';

/** Numbers from 555-0100 to 555-0199 in any North American area code: reserved for fiction, never a real phone. */
export function isFictionalNumber(number: string): boolean {
  return /^\+1\d{3}55501\d{2}$/.test(number);
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** Days from one flow to the next in the made-up history, oldest first. */
const INTERVALS = [29, 27, 30, 28];
/** The current period began this many days before today. */
const CURRENT_FLOW_DAYS_AGO = 9;

function demoPhone(number: string, name: string, at: number): PhoneRecord {
  return { number, name, canUpdate: true, reminders: [...REMINDER_KINDS], verifiedAt: at, consentAt: at, optedOut: false };
}

/**
 * A fully set-up test household, as of `now`:
 * four completed cycles, then a period that began about nine days ago whose
 * hefsek was done on the first day it could be, so that the dashboard opens
 * in the middle of the seven clean days.
 *
 * Every entry goes through `recordEntry`, with the moment it would have been
 * recorded, so the history is one the site itself would have accepted.
 * Throws if any entry is refused.
 */
export function buildDemoData(now: number): HouseholdData {
  const data = newHousehold();
  data.demo = true;
  data.app.place = { ...PLACES[0]! };
  const where = whereOf(data)!;
  const tz = where.place.timeZone;
  const today = localAbs(now, tz);

  // The account was set up before the first entry.
  const flows: number[] = [today - CURRENT_FLOW_DAYS_AGO];
  for (let i = INTERVALS.length - 1; i >= 0; i--) flows.unshift((flows[0] as number) - (INTERVALS[i] as number));
  const setUpAt = onahWindow({ abs: (flows[0] as number) - 1, part: 'day' }, where.place, where.zopts).start;
  data.halachicConfirmedAt = setUpAt;
  data.welcomedAt = setUpAt;
  data.phones.push(demoPhone(DEMO_NUMBER, 'Test phone', setUpAt), demoPhone(DEMO_SPOUSE, 'Spouse (example)', setUpAt));

  // While the history is recorded, only the latest weeks are worked out in full for each entry, which
  // keeps this within a request's processing time; the setting is put back afterwards.
  const historyDays = data.app.calendar.historyDays;
  data.app.calendar.historyDays = 0;
  const record = (draft: DraftEntry, at: number): Computed => {
    if (at > now) throw new Error(`test account: an entry would be recorded after now (${draft.kind})`);
    const result = recordEntry(data, draft, 'dashboard', null, at);
    if (!result.ok) throw new Error(`test account: ${draft.kind} was refused (${result.reason})`);
    return result.computed;
  };
  const niddah = (c: Computed) => {
    const s = c.timeline.status;
    if (s.state !== 'niddah') throw new Error('test account: expected an open period');
    return s.period;
  };

  flows.forEach((abs, i) => {
    // Alternate day and night flows, ending with a day flow for the current period.
    const part: 'day' | 'night' = (flows.length - 1 - i) % 2 === 0 ? 'day' : 'night';
    const onah = { abs, part };
    const afterFlow = record({ kind: 'flow', onah, veset: true }, onahWindow(onah, where.place, where.zopts).start + HOUR);
    const hefsekAbs = niddah(afterFlow).earliestHefsekAbs;
    const afterHefsek = record({ kind: 'hefsek', abs: hefsekAbs }, dayTimes(hefsekAbs, where.place, where.zopts).sunset - 40 * MINUTE);
    if (i === flows.length - 1) return; // the current period is still in its clean days
    const night = niddah(afterHefsek).planMikvah;
    record({ kind: 'mikvah', abs: night.nightAbs }, night.tzeit + 45 * MINUTE);
  });

  data.app.calendar.historyDays = historyDays;
  return data;
}
