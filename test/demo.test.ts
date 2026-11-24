/**
 * The test account's made-up history: it must be accepted by the site's own
 * rules on every day of the year, whatever falls nearby (Shabbat, Yom Tov,
 * Yom Kippur, Tisha B'Av, the change of clocks).
 */
import { describe, expect, it } from 'vitest';
import { buildDemoData, DEMO_NUMBER, DEMO_SPOUSE, isFictionalNumber } from '../src/app/demo';
import { compute } from '../src/app/household';
import { PLACES } from '../src/app/settings';
import { DEFAULT_HALACHIC_SETTINGS } from '../src/engine/settings';
import { localToInstant } from '../src/engine/civil';

const TZ = 'America/New_York';
const DAY = 86_400_000;

describe('fictional numbers', () => {
  it('are exactly 555-0100 to 555-0199, in any area code', () => {
    for (const n of [DEMO_NUMBER, DEMO_SPOUSE, '+12125550150', '+19175550100', '+18885550199']) expect(isFictionalNumber(n), n).toBe(true);
    for (const n of ['+17325550200', '+17325550099', '+17325551100', '+17325550', '+173255501000', '+447325550100', '17325550100', '+1732555010a']) {
      expect(isFictionalNumber(n), n).toBe(false);
    }
  });
});

describe('the test account', () => {
  it('is set up and in the clean days', () => {
    const now = localToInstant({ y: 2026, m: 11, d: 23, hh: 10, mi: 0, ss: 0 }, TZ);
    const data = buildDemoData(now);
    expect(data.demo).toBe(true);
    expect(data.app.place).toEqual(PLACES[0]);
    expect(data.halachic).toEqual(DEFAULT_HALACHIC_SETTINGS);
    expect(data.halachicConfirmedAt).not.toBeNull();
    expect(data.welcomedAt).not.toBeNull();
    expect(data.phones.map(p => [p.number, p.name, p.verifiedAt !== null, p.consentAt !== null, p.canUpdate, p.optedOut, p.reminders.length])).toEqual([
      [DEMO_NUMBER, 'Test phone', true, true, true, false, 6],
      [DEMO_SPOUSE, 'Spouse (example)', true, true, true, false, 6],
    ]);
    expect(data.entries.map(e => e.entry.kind)).toEqual([...Array(4).fill(['flow', 'hefsek', 'mikvah']).flat(), 'flow', 'hefsek']);
    const flows = data.entries.filter(e => e.entry.kind === 'flow').map(e => (e.entry as { onah: { part: string } }).onah.part);
    expect(flows).toEqual(['day', 'night', 'day', 'night', 'day']);
    // each entry was recorded after the one before it, and before now
    const times = data.entries.map(e => e.createdAt);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(times.at(-1)!).toBeLessThan(now);
    const c = compute(data, now)!;
    expect(c.timeline.status).toMatchObject({ state: 'niddah', phase: { kind: 'counting', day: 5 } });
    expect(c.reminders.filter(r => r.at > now).length).toBeGreaterThan(5);
    expect(c.timeline.onot.some(o => o.start > now)).toBe(true);
  });

  /**
   * Every day of two years, in the morning and at night. A history that
   * the rules would refuse throws inside the builder.
   */
  const first = localToInstant({ y: 2026, m: 1, d: 1, hh: 0, mi: 0, ss: 0 }, TZ);
  const months = Array.from({ length: 25 }, (_, i) => i);
  it.each(months)('works on every day of month %i from January 2026', i => {
    const start = localToInstant({ y: 2026 + Math.floor(i / 12), m: (i % 12) + 1, d: 1, hh: 0, mi: 0, ss: 0 }, TZ);
    expect(start).toBeGreaterThanOrEqual(first);
    const end = localToInstant({ y: 2026 + Math.floor((i + 1) / 12), m: ((i + 1) % 12) + 1, d: 1, hh: 0, mi: 0, ss: 0 }, TZ);
    for (let day = start; day < end; day += DAY) {
      const d = new Date(day + 12 * 3_600_000);
      const ymd = { y: Number(d.toLocaleString('en-US', { timeZone: TZ, year: 'numeric' })), m: Number(d.toLocaleString('en-US', { timeZone: TZ, month: 'numeric' })), d: Number(d.toLocaleString('en-US', { timeZone: TZ, day: 'numeric' })) };
      for (const hh of [10, 22]) {
        const now = localToInstant({ ...ymd, hh, mi: 0, ss: 0 }, TZ);
        const label = `${ymd.y}-${ymd.m}-${ymd.d} ${hh}:00`;
        const data = buildDemoData(now);
        expect(data.entries, label).toHaveLength(14);
        const c = compute(data, now)!;
        expect(c.timeline.warnings, label).toEqual([]);
        const s = c.timeline.status;
        expect(s.state, label).toBe('niddah');
        if (s.state !== 'niddah') continue;
        expect(['counting', 'before_first_day'], label).toContain(s.phase.kind);
        if (s.phase.kind === 'counting') expect(s.phase.day, label).toBeGreaterThanOrEqual(3);
        // the night of immersion is still ahead
        expect(s.period.planMikvah.tzeit, label).toBeGreaterThan(now);
        expect(s.period.projected, label).toBe(false);
      }
    }
  });
});
