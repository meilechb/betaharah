/**
 * The calculation test (src/app/sandbox.ts): the operator's POST
 * /api/admin/sandbox and the home page's POST /api/try.
 *
 * The heart of it is the first block: for several histories, a real
 * account is made through the API and the same dates are recorded through
 * POST /api/entries at the same moment; the account's GET /api/state must
 * equal the sandbox's answer in every part that comes from the calculation.
 */
import type { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/app/env';
import { addEntries, addEntry, refusalPicture, whereOf, type DraftEntry } from '../src/app/household';
import { createApp } from '../src/app/index';
import { newHousehold } from '../src/app/model';
import { ADMIN_SANDBOX_LIMITS } from '../src/app/admin-routes';
import { instantOf, runSandbox, settleSettings, TRY_LIMITS, TRY_PER_ADDRESS } from '../src/app/sandbox';
import { TABLES } from '../src/app/schema';
import { DEFAULT_APP_SETTINGS, PLACES } from '../src/app/settings';
import { civilToAbs, localAbs, localToInstant } from '../src/engine/civil';
import { DEFAULT_HALACHIC_SETTINGS, type HalachicSettings } from '../src/engine/settings';
import { dayTimes } from '../src/engine/zmanim';
import { BASIC } from './helpers';
import { makeEnv, makeWorld, startDb, TEST_PASSWORD, type TestDb, type World } from './fakes';

const TZ = 'America/New_York';
const START = localToInstant({ y: 2026, m: 11, d: 23, hh: 10, mi: 0, ss: 0 }, TZ);

let testDb: TestDb;
let world: World;
let env: Env;
let app: Hono<any>;

beforeAll(async () => {
  testDb = await startDb();
});
afterAll(async () => {
  await testDb.dispose();
});
beforeEach(async () => {
  await testDb.reset();
  world = await makeWorld(START);
  env = makeEnv(testDb.db);
  app = createApp(world.deps);
});

interface Result {
  status: number;
  json: any;
  text: string;
}

/** One browser: it keeps the cookies it is given, and has its own network address. */
class Client {
  cookies = new Map<string, string>();
  constructor(readonly address = '203.0.113.1') {}

  async call(method: string, path: string, body?: unknown, opts: { header?: boolean; headers?: Record<string, string> } = {}): Promise<Result> {
    const headers: Record<string, string> = { 'cf-connecting-ip': this.address, ...(opts.headers ?? {}) };
    if (opts.header !== false) headers['x-betaharah'] = '1';
    if (this.cookies.size > 0) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let payload: string | undefined;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['content-type'] = 'application/json';
    }
    const res = await app.request(`https://cal.example${path}`, { method, headers, body: payload }, env);
    const set = res.headers.get('set-cookie');
    if (set) {
      const [pair] = set.split(';') as [string];
      const eq = pair.indexOf('=');
      const value = pair.slice(eq + 1);
      if (value === '' || /Max-Age=0/.test(set)) this.cookies.delete(pair.slice(0, eq));
      else this.cookies.set(pair.slice(0, eq), value);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, text };
  }

  get = (path: string) => this.call('GET', path);
  post = (path: string, body: unknown = {}, opts?: { header?: boolean; headers?: Record<string, string> }) => this.call('POST', path, body, opts);
  put = (path: string, body: unknown) => this.call('PUT', path, body);
}

async function operator(): Promise<Client> {
  const c = new Client('198.51.100.9');
  expect((await c.post('/api/admin/login', { password: TEST_PASSWORD })).status).toBe(200);
  return c;
}

/** Texting set up, so that an account can be made with a texted code. */
async function siteWithTexts(): Promise<void> {
  const op = await operator();
  const r = await op.put('/api/admin/secrets', { telnyxApiKey: 'telnyx-key', telnyxPublicKey: world.telnyx.publicKey, telnyxNumber: '+1 (888) 555-0100' });
  expect(r.status).toBe(200);
}

function lastCode(number: string): string {
  const text = world.telnyx.sent
    .filter(s => s.to === number)
    .map(s => s.text)
    .reverse()
    .find(t => t.startsWith('Betaharah code: '));
  if (!text) throw new Error(`no code was texted to ${number}`);
  return /code: (\d{6})\./.exec(text)![1] as string;
}

async function signIn(number: string): Promise<Client> {
  const client = new Client('203.0.113.7');
  expect((await client.post('/api/auth/code', { number })).status).toBe(200);
  const verified = await client.post('/api/auth/verify', { number, code: lastCode(number) });
  expect(verified.status, JSON.stringify(verified.json)).toBe(200);
  return client;
}

// ---------- the histories ----------

interface Scenario {
  name: string;
  place: (typeof PLACES)[number];
  terms?: 'en' | 'he';
  halachic: HalachicSettings;
  today: { date: string; part: 'day' | 'night' };
  entries: Array<Record<string, unknown>>;
}

const LAKEWOOD = PLACES[0]!;
const JERUSALEM = PLACES.find(p => p.name === 'Jerusalem')!;
const flow = (date: string, part: 'day' | 'night' = 'day') => ({ kind: 'flow', date, part });
const hefsek = (date: string) => ({ kind: 'hefsek', date });
const mikvah = (date: string) => ({ kind: 'mikvah', date });

/** Four flows 28 days apart, each with its hefsek and immersion. */
function equalIntervals(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const start of ['2026-08-06', '2026-09-03', '2026-10-01', '2026-10-29']) {
    const d = (n: number) => new Date(Date.parse(start + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
    out.push(flow(start), hefsek(d(4)));
    if (start !== '2026-10-29') out.push(mikvah(d(11)));
  }
  return out;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'a plain cycle: flow, hefsek on the first possible day, immersion',
    place: LAKEWOOD,
    halachic: DEFAULT_HALACHIC_SETTINGS,
    today: { date: '2026-11-25', part: 'day' },
    entries: [flow('2026-11-10'), hefsek('2026-11-14'), mikvah('2026-11-21')],
  },
  {
    name: 'a broken count, a second hefsek and the immersion, today at night',
    place: LAKEWOOD,
    halachic: BASIC,
    today: { date: '2026-11-25', part: 'night' },
    entries: [flow('2026-11-05', 'night'), hefsek('2026-11-10'), { kind: 'broken', date: '2026-11-13', part: 'day' }, hefsek('2026-11-14'), mikvah('2026-11-21')],
  },
  {
    name: 'four flows 28 days apart: a possible veset kavua',
    place: LAKEWOOD,
    halachic: DEFAULT_HALACHIC_SETTINGS,
    today: { date: '2026-11-08', part: 'day' },
    entries: equalIntervals(),
  },
  {
    name: 'long cycles, with the exemption chosen',
    place: LAKEWOOD,
    halachic: { ...DEFAULT_HALACHIC_SETTINGS, longCycle: 'exempt' },
    today: { date: '2026-11-10', part: 'day' },
    entries: [flow('2026-06-01'), flow('2026-07-06'), flow('2026-08-10'), flow('2026-09-14'), flow('2026-10-19')],
  },
  {
    name: 'refusals: too early, no period, a repeat, the future, no count, an unreadable form',
    place: LAKEWOOD,
    halachic: DEFAULT_HALACHIC_SETTINGS,
    today: { date: '2026-11-20', part: 'day' },
    entries: [
      hefsek('2026-10-01'),
      flow('2026-11-10'),
      { kind: 'broken', date: '2026-11-11', part: 'day' },
      hefsek('2026-11-12'),
      mikvah('2026-11-15'),
      flow('2026-11-10'),
      flow('2026-12-01'),
      { kind: 'flow', date: '2026-11-10' },
      { kind: 'stain', date: '2026-11-18', part: 'night' },
    ],
  },
  {
    name: 'Jerusalem, Hebrew script, haflagah in onot, a flow at a time of day',
    place: JERUSALEM,
    terms: 'he',
    halachic: { ...BASIC, haflagahMethod: 'onot_from_hefsek', yomTov: 'israel', tzeit: { kind: 'minutes', value: 50 } },
    today: { date: '2026-12-02', part: 'night' },
    entries: [flow('2026-10-05', 'night'), hefsek('2026-10-10'), mikvah('2026-10-17'), { kind: 'flow', date: '2026-11-03', time: '21:30' }, hefsek('2026-11-08')],
  },
];

/** The entries' ids in a text, replaced by their place in the input, so that two runs can be compared. */
function normalise(value: unknown, ids: Map<string, number>): unknown {
  let text = JSON.stringify(value);
  for (const [id, index] of ids) text = text.split(id).join(`#${index}`);
  return JSON.parse(text);
}

const CALCULATED = ['now', 'timeZone', 'terms', 'words', 'today', 'status', 'alerts', 'upcoming', 'reminders', 'grid'] as const;

describe('the same picture as an account', () => {
  for (const s of SCENARIOS) {
    it(s.name, async () => {
      // The sandbox first: it says which moment "today" is.
      const op = await operator();
      const input = { place: s.place, terms: s.terms ?? 'en', halachic: s.halachic, today: s.today, entries: s.entries };
      const sandbox = await op.post('/api/admin/sandbox', input);
      expect(sandbox.status, JSON.stringify(sandbox.json)).toBe(200);
      const result = sandbox.json;

      // A real account, at that same moment, with the same settings and dates.
      world.clock.now = result.now;
      await siteWithTexts();
      const user = await signIn('+17324440101');
      expect((await user.put('/api/app', { ...DEFAULT_APP_SETTINGS, place: s.place, terms: s.terms ?? 'en' })).status).toBe(200);
      expect((await user.put('/api/halachic', s.halachic)).status).toBe(200);
      const accountIds = new Map<string, number>();
      for (const [index, entry] of s.entries.entries()) {
        const r = await user.post('/api/entries', entry);
        const outcome = result.outcomes[index];
        expect(outcome.index).toBe(index);
        if (r.status === 200) {
          expect(outcome, `entry ${index}`).toMatchObject({ ok: true });
          accountIds.set(r.json.entryId, index);
          if (index === s.entries.length - 1) expect(result.message).toBe(r.json.message);
        } else {
          expect(r.status).toBe(400);
          expect(outcome, `entry ${index}`).toEqual({ index, ok: false, error: r.json.error });
        }
      }
      const sandboxIds = new Map<string, number>(result.outcomes.filter((o: any) => o.ok).map((o: any) => [o.entryId, o.index]));
      const state = (await user.get('/api/state')).json.state;

      for (const key of CALCULATED) {
        expect(normalise(result.state[key], sandboxIds), key).toEqual(normalise(state[key], accountIds));
      }
      // The Log: the same lines in the same order (the sandbox adds where each came from in the input).
      expect(result.state.entries.map(({ id: _i, input: _n, ...rest }: any) => rest)).toEqual(state.entries.map(({ id: _i, ...rest }: any) => rest));
      expect(result.state.entries.map((e: any) => e.input)).toEqual(state.entries.map((e: any) => accountIds.get(e.id)));
      expect(result.state.labels.kinds).toEqual(state.labels.kinds);
    });
  }

  it('a new period after a count with no immersion recorded: its own days of waiting, the earlier hefsek kept, and a note', () => {
    // The owner's dates: a period on Oct 23, the hefsek taharah on Oct 28, no immersion recorded, a new period on Nov 24.
    const entries: Array<Record<string, unknown>> = [
      { kind: 'flow', date: '2026-10-23', part: 'day' },
      { kind: 'hefsek', date: '2026-10-28' },
      { kind: 'flow', date: '2026-11-24', part: 'day' },
    ];
    const run = (list: Array<Record<string, unknown>>) => runSandbox({ place: { name: 'Lakewood, NJ' }, today: { date: '2026-11-24', part: 'day' }, entries: list }, ADMIN_SANDBOX_LIMITS);
    const r = run(entries);
    expect(r.outcomes.every(o => o.ok)).toBe(true);
    expect(r.message).toBe('Recorded: flow Tue Nov 24 by day. No mikvah was recorded before it, so it counts as a new period. Hefsek from Sat Nov 28.');
    expect(r.state.status!.headline).toBe('Niddah, before the hefsek taharah');
    expect(r.state.status!.detail).toBe(
      'Began: Tuesday, 14 Kislev 5787 (Nov 24, 2026), by day. The hefsek taharah can be done from Shabbat, 18 Kislev 5787 (Nov 28, 2026). Next possible day: Shabbat, Nov 28, 2026, before 4:32 PM.',
    );
    expect(r.state.alerts.map(a => a.text)).toEqual([
      'No immersion is recorded for the period before the latest one, so the calendar counts the latest flow as a new period, with the days of waiting. If she immersed, record the immersion. If she had not immersed, ask a rav.',
    ]);
    const events = r.state.grid!.events;
    const on = (date: string) => events.filter(e => e.startDate === date).map(e => e.title);
    expect(on('2026-10-23')).toEqual(['Flow (day)']);
    expect(on('2026-10-28')).toEqual(['Hefsek taharah ✓']); // the earlier hefsek is not lost
    expect(on('2026-10-29')).toEqual(['Seven clean days: day 1']);
    expect(on('2026-11-04')).toEqual(['Seven clean days: day 7', 'Mikvah night: no immersion recorded']);
    expect(on('2026-11-24')).toEqual(['Flow (day)']); // and no hefsek is put on the day of the new period
    expect(on('2026-11-28')).toEqual(['Hefsek taharah (by 4:32 PM)']);
    expect(events.filter(e => e.kind === 'hefsek').map(e => [e.startDate, e.projected])).toEqual([
      ['2026-10-28', false],
      ['2026-11-28', true],
    ]);
    // the veset haflagah is counted from the first period to the second
    expect(events.some(e => e.kind === 'onah' && /Veset haflagah \(33 days\)/.test(e.description))).toBe(true);
    // with the immersion recorded, the picture is the same and nothing is left to say
    const withMikvah = run([...entries, { kind: 'mikvah', date: '2026-11-04' }]);
    expect(withMikvah.outcomes.every(o => o.ok)).toBe(true);
    expect(withMikvah.state.alerts).toEqual([]);
    expect(withMikvah.state.status!.detail).toBe(r.state.status!.detail);
    expect(withMikvah.state.grid!.events.filter(e => e.startDate === '2026-11-04').map(e => e.title)).toEqual(['Seven clean days: day 7', 'Immersion ✓']);
  });

  it('the histories show what they were made for', () => {
    const run = (s: Scenario) => runSandbox({ place: s.place, terms: s.terms, halachic: s.halachic, today: s.today, entries: s.entries }, ADMIN_SANDBOX_LIMITS);
    const [plain, broken, pattern, long, refusals, jerusalem] = SCENARIOS.map(run) as Array<ReturnType<typeof run>>;
    expect(plain!.outcomes.every(o => o.ok)).toBe(true);
    expect(plain!.state.status!.phase).toBe('tehorah');
    expect(broken!.outcomes.every(o => o.ok)).toBe(true);
    expect(pattern!.outcomes.every(o => o.ok)).toBe(true);
    expect(pattern!.state.alerts.some(a => /Three intervals in a row of 29 days/.test(a.text))).toBe(true);
    expect(long!.state.alerts.some(a => /after day 31/.test(a.text))).toBe(true);
    expect(refusals!.outcomes.map(o => (o.ok ? 'ok' : o.error))).toEqual([
      'Not recorded: no period is open. Record when the period began first.',
      'ok',
      'Not recorded: there is no count in progress.',
      'ok',
      expect.stringMatching(/^Not recorded: the count is not complete\. Mikvah night is .+ after .+\.$/),
      'Already recorded.',
      'Not recorded: that time has not come yet.',
      'Choose day, night, or a time.',
      'ok',
    ]);
    // the early hefsek is kept, with the warning the dashboard shows
    expect(refusals!.state.alerts.some(a => /before the days of waiting were over/.test(a.text))).toBe(true);
    expect(jerusalem!.outcomes.every(o => o.ok)).toBe(true);
    expect(jerusalem!.state.terms).toBe('he');
  });
});

describe('several entries at once, as one at a time', () => {
  /** A small deterministic random sequence. */
  function rng(seed: number): () => number {
    let x = seed >>> 0;
    return () => {
      x = (x * 1664525 + 1013904223) >>> 0;
      return x / 2 ** 32;
    };
  }

  it('addEntries gives each entry the outcome addEntry gives it, for 300 random histories', () => {
    const base = civilToAbs({ y: 2026, m: 6, d: 1 });
    let refused = 0;
    let accepted = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const random = rng(seed);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)] as T;
      const halachic = pick([DEFAULT_HALACHIC_SETTINGS, BASIC, { ...BASIC, minWaitDays: '4' as const, longCycle: 'exempt' as const }]);
      const now = localToInstant({ y: 2026, m: 12, d: 1, hh: 12, mi: 0, ss: 0 }, TZ);
      // mostly in order, as a person adds them, with some out of order, repeated, refused and in the future
      const drafts: DraftEntry[] = [];
      let abs = base + Math.floor(random() * 10);
      const n = 5 + Math.floor(random() * 40);
      for (let k = 0; k < n; k++) {
        const r = random();
        const at = r < 0.15 ? base + Math.floor(random() * 200) : abs;
        const kind = pick(['flow', 'flow', 'hefsek', 'mikvah', 'stain', 'broken'] as const);
        const part = pick(['day', 'night'] as const);
        if (kind === 'hefsek' || kind === 'mikvah') drafts.push({ kind, abs: at });
        else if (kind === 'flow') drafts.push({ kind, onah: { abs: at, part }, veset: random() < 0.9 });
        else drafts.push({ kind, onah: { abs: at, part } });
        if (random() < 0.08 && drafts.length > 1) drafts.push(drafts[drafts.length - 2] as DraftEntry);
        abs += 1 + Math.floor(random() * 9);
      }
      const make = () => {
        const data = newHousehold();
        settleSettings(data, { ...LAKEWOOD }, 'en', halachic);
        return data;
      };
      const one = make();
      const each = drafts.map(d => {
        const r = addEntry(one, d, 'dashboard', null, now);
        return r.ok ? { ok: true, notes: r.notes } : { ok: false, reason: r.reason, picture: refusalPicture(one, r.reason, now)?.timeline.status ?? null };
      });
      const many = make();
      const together = addEntries(many, drafts, 'dashboard', now).map(r => (r.ok ? { ok: true, notes: r.notes } : { ok: false, reason: r.reason, picture: r.computed?.timeline.status ?? null }));
      // The ids are random: each is replaced by its place in the log.
      const ids = (d: typeof one) => new Map(d.entries.map((e, k) => [e.entry.id, k]));
      expect(normalise(together, ids(many)), `seed ${seed}`).toEqual(normalise(each, ids(one)));
      expect(normalise(many.entries, ids(many)), `seed ${seed}`).toEqual(normalise(one.entries, ids(one)));
      refused += each.filter(r => !r.ok).length;
      accepted += each.filter(r => r.ok).length;
    }
    // both outcomes were well exercised
    console.log(`random histories: ${accepted} entries recorded and ${refused} refused, the same both ways`);
    expect(refused).toBeGreaterThan(500);
    expect(accepted).toBeGreaterThan(500);
  });
});

describe('the moment used as today', () => {
  it('by day is between sunrise and sunset; at night it is after nightfall, on the same civil date', () => {
    for (const place of [LAKEWOOD, PLACES.find(p => p.name === 'Manchester')!, JERUSALEM, PLACES.find(p => p.name === 'Melbourne')!]) {
      const data = newHousehold();
      settleSettings(data, { ...place }, 'en', DEFAULT_HALACHIC_SETTINGS);
      const where = whereOf(data)!;
      for (const date of ['2026-06-21', '2026-12-21', '2027-03-15']) {
        const [y, m, d] = date.split('-').map(Number) as [number, number, number];
        const abs = civilToAbs({ y, m, d });
        const t = dayTimes(abs, where.place, where.zopts);
        const day = instantOf({ date, part: 'day' }, where);
        expect(day).toBeGreaterThan(t.sunrise);
        expect(day).toBeLessThan(t.sunset);
        const night = instantOf({ date, part: 'night' }, where);
        expect(night).toBeGreaterThan(t.sunset);
        expect(localAbs(night, place.timeZone)).toBe(abs);
      }
    }
  });
});

describe('the operator route', () => {
  it('needs the operator session, and stores nothing', async () => {
    const input = { place: { name: 'Lakewood, NJ' }, today: { date: '2026-11-25', part: 'day' }, entries: [flow('2026-11-10')] };
    expect((await new Client().post('/api/admin/sandbox', input)).status).toBe(401);
    expect((await new Client().get('/api/admin/sandbox')).status).toBe(401);
    const op = await operator();
    const choices = await op.get('/api/admin/sandbox?terms=he');
    expect(choices.status).toBe(200);
    expect(choices.json.places).toContain('Lakewood, NJ');
    expect(choices.json.choices).toHaveLength(11);
    expect(choices.json.defaults).toEqual(DEFAULT_HALACHIC_SETTINGS);
    const before = await counts();
    const r = await op.post('/api/admin/sandbox', input);
    expect(r.status).toBe(200);
    expect(r.json.outcomes).toEqual([{ index: 0, ok: true, entryId: expect.any(String) }]);
    expect(await counts()).toEqual(before);
  });

  it('takes a ZIP code, refuses settings a settings route refuses, and at most 200 dates', async () => {
    const op = await operator();
    const today = { date: '2026-11-25', part: 'day' };
    const zip = await op.post('/api/admin/sandbox', { place: { postal: '11219' }, today, entries: [] });
    expect(zip.status).toBe(200);
    expect(zip.json.place.timeZone).toBe('America/New_York');
    expect((await op.post('/api/admin/sandbox', { place: { postal: '00000' }, today })).json.error).toMatch(/No place was found/);
    expect((await op.post('/api/admin/sandbox', { place: LAKEWOOD, today, halachic: { ...DEFAULT_HALACHIC_SETTINGS, minWaitDays: '3' } })).status).toBe(400);
    expect((await op.post('/api/admin/sandbox', { place: { ...LAKEWOOD, timeZone: 'Nowhere/Here' }, today })).status).toBe(400);
    expect((await op.post('/api/admin/sandbox', { place: LAKEWOOD, today: { date: '2026-02-30', part: 'day' } })).status).toBe(400);
    const many = Array.from({ length: 201 }, () => flow('2026-11-10'));
    const tooMany = await op.post('/api/admin/sandbox', { place: LAKEWOOD, today, entries: many });
    expect(tooMany.status).toBe(400);
    expect(tooMany.json.error).toBe('At most 200 dates can be added here.');
    expect((await op.post('/api/admin/sandbox', { place: LAKEWOOD, today, entries: many.slice(0, 200) })).status).toBe(200);
  });
});

/** Rows in each table. */
async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of TABLES) out[table] = ((await testDb.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0) as number;
  return out;
}

describe('Try it, on the home page', () => {
  const today = { date: '2026-11-25', part: 'day' };

  it('works out a period, hefsek and immersion with no account, and stores only a counter', async () => {
    const before = await counts();
    const visitor = new Client('192.0.2.50');
    const r = await visitor.post('/api/try', { place: { name: 'Lakewood, NJ' }, today, entries: [flow('2026-11-10'), hefsek('2026-11-14'), mikvah('2026-11-21')] });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.outcomes.every((o: any) => o.ok)).toBe(true);
    expect(r.json.state.status.phase).toBe('tehorah');
    expect(r.json.state.grid.days[0].date).toBe('2026-10-01');
    expect(r.json.state.grid.days.at(-1).date).toBe('2027-01-31');
    expect(r.json.state.upcoming.length).toBeGreaterThan(0);
    const after = await counts();
    expect(after).toEqual({ ...before, counters: before.counters! + 1 });
    const row = await testDb.db.prepare('SELECT key FROM counters').first<{ key: string }>();
    expect(row!.key).toMatch(/^try-ip:[0-9a-f]{24}$/);
    expect(JSON.stringify(row)).not.toContain('192.0.2.50');
  });

  it('is the same picture as the full tool for the same dates', async () => {
    const entries = [flow('2026-11-10', 'night'), hefsek('2026-11-15')];
    const visitor = await new Client('192.0.2.51').post('/api/try', { place: { name: 'Brooklyn, NY' }, today, entries, customs: { minWaitDays: '4', orZarua: 'no' } });
    const full = runSandbox({ place: { name: 'Brooklyn, NY' }, today, entries, halachic: { ...DEFAULT_HALACHIC_SETTINGS, minWaitDays: '4', orZarua: 'no' } }, ADMIN_SANDBOX_LIMITS);
    expect(visitor.json.state.status).toEqual(full.state.status);
    expect(visitor.json.state.alerts).toEqual(full.state.alerts);
    expect(normalise(visitor.json.state.upcoming, new Map())).toHaveLength(full.state.upcoming.length);
  });

  it('only a place of the list or a ZIP code, three customs, three kinds, twelve dates', async () => {
    const v = new Client('192.0.2.52');
    expect((await v.post('/api/try', { place: { postal: '08701' }, today, entries: [] })).status).toBe(200);
    expect((await v.post('/api/try', { place: { name: 'Atlantis' }, today })).status).toBe(400);
    expect((await v.post('/api/try', { place: { latitude: 40, longitude: -74, timeZone: TZ }, today })).status).toBe(400);
    const custom = await v.post('/api/try', { place: { name: 'Lakewood, NJ' }, today, customs: { longCycle: 'exempt' } });
    expect(custom.status).toBe(400);
    expect(custom.json.error).toBe('customs: longCycle cannot be changed here');
    const stain = await v.post('/api/try', { place: { name: 'Lakewood, NJ' }, today, entries: [{ kind: 'stain', date: '2026-11-10', part: 'day' }] });
    expect(stain.json.outcomes).toEqual([{ index: 0, ok: false, error: 'That kind of entry cannot be added here.' }]);
    const thirteen = Array.from({ length: 13 }, (_, k) => flow(`2026-0${1 + (k % 9)}-10`));
    const tooMany = await v.post('/api/try', { place: { name: 'Lakewood, NJ' }, today, entries: thirteen });
    expect(tooMany.status).toBe(400);
    expect(tooMany.json.error).toBe('At most 12 dates can be added here.');
    const choices = await v.get('/api/try');
    expect(choices.json.customs.map((c: any) => c.key)).toEqual(['minWaitDays', 'beinonitDays', 'orZarua']);
    expect(choices.json.kinds).toEqual(['flow', 'hefsek', 'mikvah']);
    expect(choices.json.maxEntries).toBe(TRY_LIMITS.maxEntries);
  });

  it(`answers 429 after ${TRY_PER_ADDRESS} tries in ten minutes from one address`, async () => {
    const v = new Client('192.0.2.53');
    const body = { place: { name: 'Lakewood, NJ' }, today, entries: [] };
    for (let k = 0; k < TRY_PER_ADDRESS; k++) expect((await v.post('/api/try', body)).status).toBe(200);
    const refused = await v.post('/api/try', body);
    expect(refused.status).toBe(429);
    expect(refused.json.error).toBe('Too many tries in the last few minutes. Please wait ten minutes and try again.');
    expect((await new Client('192.0.2.54').post('/api/try', body)).status).toBe(200);
    world.clock.now += 10 * 60_000 + 1;
    expect((await v.post('/api/try', body)).status).toBe(200);
  });

  it('needs the header and the same origin, like every other change, and says nothing about any account', async () => {
    const body = { place: { name: 'Lakewood, NJ' }, today, entries: [flow('2026-11-10')] };
    expect((await new Client().post('/api/try', body, { header: false })).status).toBe(400);
    expect((await new Client().post('/api/try', body, { headers: { origin: 'https://elsewhere.example' } })).status).toBe(403);

    // An account with a date and a note; a visitor's answer carries nothing of it.
    world.clock.now = localToInstant({ y: 2026, m: 11, d: 25, hh: 12, mi: 0, ss: 0 }, TZ);
    await siteWithTexts();
    const user = await signIn('+17324440102');
    await user.put('/api/app', { ...DEFAULT_APP_SETTINGS, place: LAKEWOOD });
    const recorded = await user.post('/api/entries', { kind: 'flow', date: '2026-11-11', part: 'night', note: 'a private note' });
    expect(recorded.status).toBe(200);
    const signedIn = await user.post('/api/try', body);
    const visitor = await new Client('192.0.2.60').post('/api/try', body);
    for (const r of [signedIn, visitor]) {
      expect(r.status).toBe(200);
      expect(r.text).not.toContain(recorded.json.entryId);
      expect(r.text).not.toContain('a private note');
      expect(Object.keys(r.json).sort()).toEqual(['message', 'outcomes', 'place', 'state', 'today']);
      expect(r.json.state.entries).toHaveLength(1);
      expect(r.json.state.entries[0].text).toContain('Nov 10, 2026');
    }
    // the session's account is unchanged
    expect((await user.get('/api/state')).json.state.entries).toHaveLength(1);
  });
});

describe('cost of one request at the limits', () => {
  /** The fastest of several batches (other test files compete for the processor). */
  function best(run: () => unknown, batches = 12, each = 4): number {
    run();
    let fastest = Number.POSITIVE_INFINITY;
    for (let b = 0; b < batches; b++) {
      const t0 = performance.now();
      for (let i = 0; i < each; i++) run();
      fastest = Math.min(fastest, (performance.now() - t0) / each);
    }
    return fastest;
  }

  /** Cycles of flow, hefsek and immersion, ending before 2026-11-25. */
  function history(n: number): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    let abs = civilToAbs({ y: 2026, m: 11, d: 1 }) - 68 * 29;
    const iso = (a: number) => new Date((a - civilToAbs({ y: 1970, m: 1, d: 1 })) * 86_400_000).toISOString().slice(0, 10);
    for (let k = 0; out.length < n; k++) {
      out.push(flow(iso(abs), k % 2 ? 'night' : 'day'), hefsek(iso(abs + 5)), mikvah(iso(abs + 12)));
      abs += 27 + (k % 5);
    }
    return out.slice(0, n);
  }

  it('the operator, 200 dates; a visitor, 12: a few milliseconds', () => {
    const today = { date: '2026-11-25', part: 'day' };
    const admin = { place: { name: 'Lakewood, NJ' }, today, entries: history(200) };
    const first = runSandbox(admin, ADMIN_SANDBOX_LIMITS);
    expect(first.outcomes.filter(o => o.ok)).toHaveLength(200);
    const adminMs = best(() => JSON.stringify(runSandbox(admin, ADMIN_SANDBOX_LIMITS)));
    // 180 of those dates, with 20 more a tester might add among them: repeats and future dates (refused
    // before the log is read), immersions too early and an earlier flow out of order (each starts a new run)
    const base = history(180);
    const extra = (k: number): Record<string, unknown> =>
      k % 4 === 0 ? base[k]! : k % 4 === 1 ? flow('2026-12-20') : k % 4 === 2 && k < 150 ? { kind: 'mikvah', date: base[k + 1]!.date as string } : flow(base[Math.max(0, k - 40)]!.date as string, 'night');
    const mixed = base.flatMap((e, k) => (k % 9 === 8 ? [e, extra(k)] : [e]));
    expect(mixed).toHaveLength(200);
    const mixedResult = runSandbox({ ...admin, entries: mixed }, ADMIN_SANDBOX_LIMITS);
    const refusedCount = mixedResult.outcomes.filter(o => !o.ok).length;
    const mixedMs = best(() => JSON.stringify(runSandbox({ ...admin, entries: mixed }, ADMIN_SANDBOX_LIMITS)));
    const visitor = { place: { name: 'Lakewood, NJ' }, today, entries: history(200).slice(-12), months: ['2026-10', '2026-11', '2026-12', '2027-01'] };
    const tryMs = best(() => JSON.stringify(runSandbox(visitor, TRY_LIMITS)));
    console.log(
      `calculation test: 200 dates ${adminMs.toFixed(2)} ms; 200 dates of which ${refusedCount} refused or out of order ${mixedMs.toFixed(2)} ms; Try it: 12 dates ${tryMs.toFixed(2)} ms`,
    );
    expect(adminMs).toBeLessThan(8);
    expect(mixedMs).toBeLessThan(15);
    expect(tryMs).toBeLessThan(4);
  });
});
