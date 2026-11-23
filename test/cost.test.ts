/**
 * Cloudflare's free plan allows 10 ms of CPU per request. This measures the
 * whole calculation for a long history, as a guard against it growing.
 * (Node on a test machine is not the Workers runtime, so the limit here is
 * set well below 10 ms.)
 */
import { describe, expect, it } from 'vitest';
import { compute } from '../src/app/service';
import { DEFAULT_APP_SETTINGS, PLACES } from '../src/app/settings';
import type { Stored, StoredEntry } from '../src/app/store';
import { dashboardState } from '../src/app/dashboard';
import { planSync, toDesired } from '../src/app/sync';
import { civilToAbs, localToInstant } from '../src/engine/civil';
import type { LogEntry } from '../src/engine/cycle';
import { DEFAULT_HALACHIC_SETTINGS } from '../src/engine/settings';

describe('cost of a full recalculation', () => {
  it('three years of history, strictest settings: a few milliseconds', () => {
    const entries: StoredEntry[] = [];
    let abs = civilToAbs({ y: 2026, m: 11, d: 22 }) - 36 * 29;
    const add = (entry: LogEntry): void => {
      entries.push({ entry, source: 'test', note: null, createdAt: entries.length });
    };
    for (let k = 0; k < 37; k++) {
      add({ id: `f${k}`, kind: 'flow', onah: { abs, part: k % 2 ? 'night' : 'day' }, veset: true });
      if (k < 36) {
        add({ id: `h${k}`, kind: 'hefsek', abs: abs + 5 });
        add({ id: `m${k}`, kind: 'mikvah', abs: abs + 13 });
      }
      abs += 27 + (k % 5);
    }
    const stored: Stored = {
      halachic: { settings: { ...DEFAULT_HALACHIC_SETTINGS, chodeshLength: 'full' }, confirmedAt: 1 },
      app: { ...DEFAULT_APP_SETTINGS, place: PLACES[0]! },
      secrets: {},
      google: null,
      sync: { dirty: false, lastRunAt: null, lastOkAt: null, lastError: null },
    };
    const now = localToInstant({ y: 2026, m: 12, d: 1, hh: 12, mi: 0, ss: 0 }, 'America/New_York');
    // What one request does at most: work the picture out once, prepare the
    // events for Google, compare with what Google has, and build the dashboard's data.
    const once = (): number => {
      const c = compute(stored, entries, now)!;
      const desired = c.events.map(e => toDesired(e, 'America/New_York'));
      planSync(desired, [], now - 400 * 86_400_000);
      JSON.stringify(dashboardState(stored, entries, c, [], now, 'https://x.example'));
      return c.events.length;
    };
    once(); // the first run fills the caches, as the first request does
    // The best of several batches: other test files run at the same time and
    // compete for the processor, which only ever makes a batch slower.
    let each = Number.POSITIVE_INFINITY;
    let events = 0;
    for (let batch = 0; batch < 6; batch++) {
      const t0 = performance.now();
      for (let i = 0; i < 5; i++) events = once();
      each = Math.min(each, (performance.now() - t0) / 5);
    }
    console.log(`one request's calculation: ${each.toFixed(2)} ms for ${entries.length} entries and ${events} events`);
    // only the calendar's window (400 days) is worked out in full
    expect(events).toBeGreaterThan(150);
    expect(events).toBeLessThan(260);
    expect(each).toBeLessThan(5);
  });
});
