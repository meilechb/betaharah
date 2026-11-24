/**
 * Cloudflare's free plan allows 10 ms of CPU per request. This measures
 * what one request does at most, for a long history, as a guard against it
 * growing. (Node on a test machine is not the Workers runtime, so the limit
 * here is set well below 10 ms.)
 */
import { describe, expect, it } from 'vitest';
import type { Session } from '../src/app/auth';
import { checkPassword, decrypt, encrypt, hashPassword } from '../src/app/crypto';
import { dashboardState } from '../src/app/dashboard';
import { compute } from '../src/app/household';
import { DEFAULT_SITE_CONFIG, newHousehold, type HouseholdData } from '../src/app/model';
import { rebuildQueue } from '../src/app/queue';
import { DEFAULT_APP_SETTINGS, PLACES, REMINDER_KINDS } from '../src/app/settings';
import { planSync, toDesired } from '../src/app/sync';
import { civilToAbs, localToInstant } from '../src/engine/civil';
import type { LogEntry } from '../src/engine/cycle';
import { DEFAULT_HALACHIC_SETTINGS } from '../src/engine/settings';

const KEY = 'k'.repeat(40);

/** Three years of history, the strictest settings, two phones that receive every reminder. */
function longHistory(now: number): HouseholdData {
  const data = newHousehold();
  data.halachic = { ...DEFAULT_HALACHIC_SETTINGS, chodeshLength: 'full' };
  data.app = { ...DEFAULT_APP_SETTINGS, place: PLACES[0]! };
  for (const number of ['+17325550101', '+17325550102']) {
    data.phones.push({ number, name: 'A name', canUpdate: true, reminders: [...REMINDER_KINDS], verifiedAt: 1, consentAt: 1, optedOut: false });
  }
  let abs = civilToAbs({ y: 2026, m: 11, d: 22 }) - 36 * 29;
  const add = (entry: LogEntry): void => {
    data.entries.push({ entry, source: 'test', note: null, createdAt: data.entries.length });
  };
  for (let k = 0; k < 37; k++) {
    add({ id: `f${k}`, kind: 'flow', onah: { abs, part: k % 2 ? 'night' : 'day' }, veset: true });
    if (k < 36) {
      add({ id: `h${k}`, kind: 'hefsek', abs: abs + 5 });
      add({ id: `m${k}`, kind: 'mikvah', abs: abs + 13 });
    }
    abs += 27 + (k % 5);
  }
  for (let i = 0; i < 30; i++) data.messages.push({ direction: i % 2 ? 'in' : 'out', phone: '0101', body: 'Recorded: flow Mon Nov 23 by day. Hefsek from Fri Nov 27. 0 to undo.', at: now, status: 'sent' });
  return data;
}

/** The fastest of several batches: other test files compete for the processor, which only ever makes a batch slower. */
async function best(run: () => unknown | Promise<unknown>, batches = 16, each = 5): Promise<number> {
  await run(); // the first run fills the caches, as the first request does
  let fastest = Number.POSITIVE_INFINITY;
  for (let b = 0; b < batches; b++) {
    const t0 = performance.now();
    for (let i = 0; i < each; i++) await run();
    fastest = Math.min(fastest, (performance.now() - t0) / each);
  }
  return fastest;
}

describe('cost of one request', () => {
  const now = localToInstant({ y: 2026, m: 12, d: 1, hh: 12, mi: 0, ss: 0 }, 'America/New_York');
  const session: Session = { phoneHash: 'x', householdId: 'h', method: 'code', startedAt: now, kind: 'phone', phone: { hash: 'x', household_id: 'h', password: null, session_epoch: 0, created_at: 0 }, google: null };

  it('the whole calculation for three years of history: a few milliseconds', async () => {
    const data = longHistory(now);
    let events = 0;
    // What one request does at most: work the picture out once, rebuild the
    // waiting reminders, prepare the events for Google and compare them with
    // what Google has, and build the dashboard's data.
    const each = await best(() => {
      const c = compute(data, now)!;
      rebuildQueue(data, c.reminders, now);
      const desired = c.events.map(e => toDesired(e, 'America/New_York'));
      planSync(desired, [], now - 400 * 86_400_000);
      JSON.stringify(dashboardState({ data, computed: c, site: { config: DEFAULT_SITE_CONFIG, secrets: {} }, session, myNumber: '+17325550101', now, origin: 'https://x.example' }));
      events = c.events.length;
    });
    console.log(`one request's calculation: ${each.toFixed(2)} ms for ${data.entries.length} entries, ${events} events and ${data.queue.length} waiting reminders`);
    // only the calendar's window (400 days) is worked out in full
    expect(events).toBeGreaterThan(150);
    expect(events).toBeLessThan(260);
    expect(data.queue.length).toBeGreaterThan(0);
    expect(each).toBeLessThan(5);
  });

  it('reading and writing the encrypted document: a fraction of a millisecond', async () => {
    const data = longHistory(now);
    rebuildQueue(data, compute(data, now)!.reminders, now);
    const plain = JSON.stringify(data);
    const stored = await encrypt(KEY, plain, 'household:h');
    const each = await best(async () => {
      JSON.parse(await decrypt(KEY, stored, 'household:h'));
      await encrypt(KEY, JSON.stringify(data), 'household:h');
    });
    console.log(`reading and writing a household: ${each.toFixed(2)} ms for ${(plain.length / 1024).toFixed(1)} KB`);
    expect(plain.length).toBeLessThan(100_000);
    expect(each).toBeLessThan(2);
  });

  it('checking or setting a password fits in a request', async () => {
    const record = await hashPassword(KEY, 'a good long password');
    const each = await best(() => checkPassword(KEY, 'a good long password', record), 4, 3);
    console.log(`checking a password: ${each.toFixed(2)} ms`);
    expect(each).toBeLessThan(8);
  });
});
