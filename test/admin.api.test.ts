/**
 * The operator's console API (src/app/admin-routes.ts), end to end against a
 * real local database, with stand-ins for Telnyx and Google.
 *
 * The rule that defines the console: the operator never sees any account's
 * data. Every response of every admin route is checked for the phone
 * numbers, names, notes and entries of a populated account.
 */
import type { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recordTick } from '../src/app/admin-data';
import { ADMIN_TABLES, failureOf, noteSmsOutcome, noteTextReceived } from '../src/app/admin-notes';
import { DEMO_NUMBER } from '../src/app/demo';
import type { Deps, Env } from '../src/app/env';
import { createApp } from '../src/app/index';
import { DEFAULT_SITE_CONFIG, type SiteConfig } from '../src/app/model';
import { TABLES } from '../src/app/schema';
import { TEST_TEXT } from '../src/app/service';
import { DEFAULT_APP_SETTINGS, PLACES } from '../src/app/settings';
import { localToInstant } from '../src/engine/civil';
import { BASIC } from './helpers';
import { makeEnv, makeWorld, startDb, TEST_PASSWORD, type TestDb, type World } from './fakes';

const TZ = 'America/New_York';
const at = (m: number, d: number, hh: number, mi = 0): number => localToInstant({ y: 2026, m, d, hh, mi, ss: 0 }, TZ);
const START = at(11, 23, 10); // Monday 23 November 2026, 10:00 (15:00 UTC)
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const HUSBAND = '+17324440101';
const WIFE = '+17324440102';
const OTHER = '+17324440199';
const OUR_NUMBER = '+18885550100';
const PROFILE = 'profile-1234';
const AGENT = 'agent-5678';

let testDb: TestDb;
let world: World;
let env: Env;
let app: Hono<any>;
/** What the stand-in Telnyx answers to the read-only calls the console makes. */
let telnyxNumbers: Array<Record<string, unknown>>;
let agentStatus: string | null;
let networkDown: boolean;
let deps: Deps;

beforeAll(async () => {
  testDb = await startDb();
});
afterAll(async () => {
  await testDb.dispose();
});
beforeEach(async () => {
  await testDb.reset();
  await testDb.db.batch(ADMIN_TABLES.map(t => testDb.db.prepare(`DELETE FROM ${t}`))).catch(() => undefined);
  world = await makeWorld(START);
  telnyxNumbers = [{ phone_number: OUR_NUMBER, status: 'active', messaging_profile_id: PROFILE }];
  agentStatus = 'VERIFYING';
  networkDown = false;
  deps = {
    now: world.deps.now,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.origin === 'https://api.telnyx.com' && url.pathname !== '/v2/messages') {
        if (networkDown) throw new TypeError('fetch failed');
        if ((init?.method ?? 'GET') !== 'GET') return new Response('{}', { status: 405 });
        if (new Headers(init?.headers).get('authorization') !== 'Bearer telnyx-key') return new Response('{"errors":[{"code":"10009"}]}', { status: 401 });
        if (url.pathname === '/v2/phone_numbers') {
          const wanted = url.searchParams.get('filter[phone_number]');
          return Response.json({ data: telnyxNumbers.filter(n => !wanted || n.phone_number === wanted) });
        }
        if (url.pathname === `/v2/rcs/agents/${AGENT}` && agentStatus) return Response.json({ data: { id: AGENT, status: agentStatus } });
        return new Response('{"errors":[{"code":"10005"}]}', { status: 404 });
      }
      return world.deps.fetch(input, init);
    }) as typeof fetch,
  };
  env = makeEnv(testDb.db);
  app = createApp(deps);
});

interface Result {
  status: number;
  json: any;
  text: string;
}

/** Every admin response seen in a test, to check that none of them carries an account's data. */
let seen: string[] = [];
beforeEach(() => {
  seen = [];
});

class Client {
  cookies = new Map<string, string>();
  lastSetCookie = '';
  constructor(readonly address = '203.0.113.1') {}

  async call(method: string, path: string, body?: unknown, opts: { header?: boolean } = {}): Promise<Result> {
    const headers: Record<string, string> = { 'cf-connecting-ip': this.address };
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
      this.lastSetCookie = set;
      const [pair] = set.split(';') as [string];
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === '' || /Max-Age=0/.test(set)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    if (path.startsWith('/api/admin/')) seen.push(text);
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, text };
  }

  get = (path: string) => this.call('GET', path);
  post = (path: string, body: unknown = {}, opts?: { header?: boolean }) => this.call('POST', path, body, opts);
  put = (path: string, body: unknown, opts?: { header?: boolean }) => this.call('PUT', path, body, opts);
  del = (path: string, opts?: { header?: boolean }) => this.call('DELETE', path, undefined, opts);
}

const textsTo = (number: string): string[] => world.telnyx.sent.filter(s => s.to === number).map(s => s.text);

function lastCode(number: string): string {
  const t = textsTo(number)
    .reverse()
    .find(x => x.startsWith('Betaharah code: '));
  if (!t) throw new Error(`no code was texted to ${number}`);
  return /code: (\d{6})\./.exec(t)![1] as string;
}

async function operator(): Promise<Client> {
  const c = new Client('198.51.100.9');
  expect((await c.post('/api/admin/login', { password: TEST_PASSWORD })).status).toBe(200);
  return c;
}

async function site(options: { sms?: boolean; google?: boolean; config?: Partial<SiteConfig> } = {}): Promise<Client> {
  const op = await operator();
  if (options.sms !== false) expect((await op.put('/api/admin/secrets', { telnyxApiKey: 'telnyx-key', telnyxPublicKey: world.telnyx.publicKey, telnyxNumber: '+1 (888) 555-0100' })).status).toBe(200);
  if (options.google) expect((await op.put('/api/admin/secrets', { googleClientId: 'client-id', googleClientSecret: 'client-secret' })).status).toBe(200);
  if (options.config) expect((await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, ...options.config })).status).toBe(200);
  return op;
}

async function signIn(number: string, client = new Client()): Promise<Client> {
  expect((await client.post('/api/auth/code', { number })).status).toBe(200);
  expect((await client.post('/api/auth/verify', { number, code: lastCode(number) })).status).toBe(200);
  return client;
}

/** A fully used account: two phones (one with a name), a location, customs, an entry with a note, reminders on. */
async function populated(): Promise<Client> {
  const member = await signIn(HUSBAND);
  expect((await member.put('/api/app', { ...DEFAULT_APP_SETTINGS, place: PLACES[0] })).status).toBe(200);
  expect((await member.put('/api/halachic', BASIC)).status).toBe(200);
  world.clock.now += 2 * MINUTE;
  expect((await member.post('/api/phones/code', { number: WIFE })).status).toBe(200);
  expect((await member.post('/api/phones/verify', { number: WIFE, code: lastCode(WIFE) })).status).toBe(200);
  expect((await member.put('/api/phones', { number: WIFE, name: 'Private name', canUpdate: true, reminders: ['mikvah'], texts: true })).status).toBe(200);
  expect((await member.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day', note: 'a private note' })).status).toBe(200);
  return member;
}

/** Nothing of the populated account appears in any admin response of the test. */
function assertNothingPrivate(): void {
  expect(seen.length).toBeGreaterThan(0);
  const all = seen.join('\n');
  for (const hidden of ['7324440101', '7324440102', '732) 444', 'Private name', 'a private note', 'Lakewood', 'telnyx-key', 'client-secret', world.telnyx.publicKey, PROFILE, AGENT, 'Tehorah']) {
    expect(all.includes(hidden), hidden).toBe(false);
  }
}

describe('the console state', () => {
  it('says when the session ends, and adds counts, notes and the checklist without changing the old fields', async () => {
    const c = new Client('198.51.100.9');
    const login = await c.post('/api/admin/login', { password: TEST_PASSWORD });
    expect(login.json).toEqual({ ok: true, until: START + 12 * HOUR });
    const r = await c.get('/api/admin/state');
    expect(r.status).toBe(200);
    expect(r.json.session).toEqual({ until: START + 12 * HOUR });
    expect(r.json.rcsReady).toBe(false);
    expect(r.json.notes).toEqual({ tollFreeSubmittedAt: null, tollFreeVerifiedAt: null, centsPerText: 1 });
    expect(r.json.ops).toEqual({ heartbeatAt: null, lastSentAt: null, lastSentConfirmed: false, lastFailure: null, lastReceivedAt: null, configSavedAt: null });
    expect(r.json.links).toEqual({ app: 'https://cal.example/app/', help: 'https://cal.example/help', optIn1: 'https://cal.example/sms-opt-in-1.png', optIn2: 'https://cal.example/sms-opt-in-2.png' });
    expect(r.json.checklist.map((i: any) => [i.key, i.status])).toEqual([
      ['contact', 'done'], // the standing mailboxes are named by default
      ['account', 'todo'],
      ['telnyx_keys', 'todo'],
      ['test_text', 'todo'],
      ['verification', 'todo'],
      ['webhook', 'todo'],
      ['signup', 'todo'],
      ['rcs', 'optional'],
      ['google', 'optional'],
    ]);
    for (const item of r.json.checklist) {
      expect(typeof item.title).toBe('string');
      expect(typeof item.detail).toBe('string');
      if (item.next !== null) expect(item.next, item.key).toMatch(/\.$/);
      if (item.status === 'done' || item.status === 'optional') expect(item.next, item.key).toBeNull();
    }
    // Before texting works, the step for your own account points to an invitation.
    expect(r.json.checklist[1].next).toContain('For one phone number');
  });

  it('the checklist follows the setup step by step', async () => {
    const status = async (op: Client) => Object.fromEntries((await op.get('/api/admin/state')).json.checklist.map((i: any) => [i.key, i.status]));
    const op = await site({ sms: false });
    expect((await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, contactName: 'The Operator' })).status).toBe(200);
    let s = await status(op);
    expect([s.contact, s.signup, s.telnyx_keys]).toEqual(['done', 'done', 'todo']);

    await op.put('/api/admin/secrets', { telnyxApiKey: 'telnyx-key', telnyxPublicKey: world.telnyx.publicKey, telnyxNumber: OUR_NUMBER });
    s = await status(op);
    expect([s.telnyx_keys, s.test_text]).toEqual(['done', 'todo']);
    expect((await op.post('/api/admin/test-text', { to: '(732) 444-0101' })).status).toBe(200);
    s = await status(op);
    expect(s.test_text).toBe('done');

    expect((await op.put('/api/admin/notes', { tollFreeSubmitted: true })).status).toBe(200);
    expect((await status(op)).verification).toBe('waiting');
    expect((await op.put('/api/admin/notes', { tollFreeVerified: true })).status).toBe(200);
    expect((await status(op)).verification).toBe('done');
    expect((await op.put('/api/admin/notes', { tollFreeVerified: false, tollFreeSubmitted: false })).status).toBe(200);
    expect((await status(op)).verification).toBe('todo');

    await noteTextReceived(testDb.db, world.clock.now);
    const state = (await op.get('/api/admin/state')).json;
    expect(state.ops.lastReceivedAt).toBe(world.clock.now);
    expect(state.checklist.find((i: any) => i.key === 'webhook').status).toBe('done');

    // The test account is not "your own account"; a regular account is.
    expect((await op.post('/api/admin/demo')).status).toBe(200);
    expect((await status(op)).account).toBe('todo');
    await signIn(OTHER);
    expect((await status(op)).account).toBe('done');
  });

  it('RCS: optional until its keys are saved, then off, then waiting on the agent, then done when Telnyx says it is live', async () => {
    const op = await site();
    const rcs = async () => (await op.get('/api/admin/state')).json.checklist.find((i: any) => i.key === 'rcs');
    expect((await rcs()).status).toBe('optional');
    await op.put('/api/admin/secrets', { rcsAgentId: AGENT, telnyxMessagingProfileId: PROFILE });
    expect((await rcs()).status).toBe('todo');
    const on = await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, rcsEnabled: true });
    expect(on.json.rcsReady).toBe(true);
    expect((await rcs()).status).toBe('waiting');
    const checked = await op.post('/api/admin/check/rcs');
    expect(checked.json.result).toMatchObject({ ok: false, agentStatus: 'VERIFYING' });
    expect((await rcs()).detail).toContain('VERIFYING');
    agentStatus = 'LIVE';
    expect((await op.post('/api/admin/check/rcs')).json.result).toMatchObject({ ok: true, agentStatus: 'LIVE' });
    expect((await rcs()).status).toBe('done');
    assertNothingPrivate();
  });
});

describe('never any account\'s data', () => {
  it('no admin response carries a phone number, a name, a note or an entry of an account', async () => {
    const op = await site({ google: true });
    await populated();
    await signIn(OTHER, new Client('203.0.113.2'));
    await op.put('/api/admin/secrets', { rcsAgentId: AGENT, telnyxMessagingProfileId: PROFILE });
    await noteTextReceived(testDb.db, world.clock.now);

    await op.get('/api/admin/state');
    await op.get('/api/admin/accounts');
    await op.get('/api/admin/accounts?sort=phones&q=a');
    await op.get('/api/admin/history');
    await op.put('/api/admin/notes', { centsPerText: 0.8, tollFreeSubmitted: true });
    await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, contactName: 'Op' });
    await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, dailyCodeLimit: -1 });
    await op.put('/api/admin/secrets', { telnyxNumber: 'not a number' });
    await op.post('/api/admin/invites', { kind: 'signup', maxUses: 3, note: 'friends' });
    await op.post('/api/admin/invites', { kind: 'setup', number: HUSBAND });
    await op.post('/api/admin/check/telnyx');
    await op.post('/api/admin/check/rcs');
    await op.post('/api/admin/check/google');
    await op.post('/api/admin/test-text', { to: '+17324440150' });
    world.telnyx.failNext = 1;
    await op.post('/api/admin/test-text', { to: '+17324440150' });
    await op.post('/api/admin/demo');
    await op.del('/api/admin/demo');
    const list = (await op.get('/api/admin/accounts')).json.accounts;
    await op.del(`/api/admin/households/${list[0].id}`);
    assertNothingPrivate();
    // and the history and accounts list are counts, dates and ids only
    const history = (await op.get('/api/admin/history')).json.days;
    for (const d of history) expect(Object.keys(d).sort()).toEqual(['codesSent', 'day', 'deletions', 'signups', 'textsReceived', 'textsSent']);
    const accounts = (await op.get('/api/admin/accounts')).json.accounts;
    for (const a of accounts) expect(Object.keys(a).sort()).toEqual(['createdAt', 'id', 'phones', 'reminderWaiting', 'test', 'updatedAt']);
    assertNothingPrivate();
  });

  it('the console\'s own table holds counts only', async () => {
    const op = await site();
    await populated();
    await op.get('/api/admin/history');
    await noteTextReceived(testDb.db, world.clock.now);
    await recordTick(env, world.clock.now);
    const { results } = await testDb.db.prepare('SELECT * FROM usage_daily').all();
    const ops = await testDb.db.prepare("SELECT * FROM site WHERE key LIKE 'ops:%'").all();
    const dump = JSON.stringify(results) + JSON.stringify(ops.results);
    for (const hidden of ['7324440101', '7324440102', 'Private name', 'a private note', 'telnyx-key']) expect(dump.includes(hidden), hidden).toBe(false);
    for (const row of results as Array<Record<string, unknown>>) {
      for (const [k, v] of Object.entries(row)) if (k !== 'day') expect(typeof v, k).toBe('number');
    }
  });
});

describe('every admin route needs the operator', () => {
  it('without the operator session: 401; without the header on a write: 400', async () => {
    const member = await (async () => {
      await site();
      return signIn(HUSBAND);
    })();
    const stranger = new Client('203.0.113.77');
    const routes: Array<[string, string, unknown?]> = [
      ['GET', '/api/admin/state'],
      ['GET', '/api/admin/accounts'],
      ['GET', '/api/admin/history'],
      ['PUT', '/api/admin/notes', { tollFreeVerified: true }],
      ['POST', '/api/admin/check/telnyx', {}],
      ['POST', '/api/admin/check/google', {}],
      ['POST', '/api/admin/test-text', { to: HUSBAND }],
    ];
    for (const [method, path, body] of routes) {
      expect((await stranger.call(method, path, body)).status, path).toBe(401);
      expect((await member.call(method, path, body)).status, path).toBe(401);
    }
    const op = await operator();
    for (const [method, path, body] of routes.filter(r => r[0] !== 'GET')) expect((await op.call(method, path, body, { header: false })).status, path).toBe(400);
    expect(world.telnyx.sent.filter(s => s.text === TEST_TEXT)).toEqual([]);
    expect((await op.post('/api/admin/check/everything')).status).toBe(404);
  });
});

describe('the accounts list', () => {
  it('counts and dates only, sorted, searchable by id, with totals by period', async () => {
    let op = await site();
    await populated();
    world.clock.now += 3 * DAY;
    await signIn(OTHER, new Client('203.0.113.2'));
    world.clock.now += 40 * DAY;
    const third = await signIn('+17324440133', new Client('203.0.113.3'));
    op = await operator(); // the operator's session lasts 12 hours
    world.clock.now += MINUTE;
    await op.post('/api/admin/demo');

    const r = await op.get('/api/admin/accounts');
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(3);
    expect(r.json.shown).toBe(4);
    expect(r.json.testShown).toBe(true);
    expect(r.json.created).toEqual({ today: 1, week: 1, month: 1, year: 3, all: 3 });
    const [demo, newest, middle, oldest] = r.json.accounts;
    expect(demo.test).toBe(true);
    expect(demo.phones).toBe(2);
    expect(demo.reminderWaiting).toBe(true);
    expect([newest.test, newest.phones, newest.createdAt]).toEqual([false, 1, START + 2 * MINUTE + 43 * DAY]);
    expect(oldest).toMatchObject({ phones: 2, createdAt: START, test: false });
    expect(middle.phones).toBe(1);

    expect((await op.get('/api/admin/accounts?sort=oldest')).json.accounts[0].id).toBe(oldest.id);
    expect((await op.get('/api/admin/accounts?sort=phones')).json.accounts.map((a: any) => a.phones)).toEqual([2, 2, 1, 1]);
    // the account changed most recently comes first
    await third.put('/api/app', { ...DEFAULT_APP_SETTINGS, place: PLACES[0] });
    world.clock.now += MINUTE;
    expect((await op.get('/api/admin/accounts?sort=changed')).json.accounts[0].id).toBe(newest.id);

    const part = middle.id.slice(3, 9);
    const found = await op.get(`/api/admin/accounts?q=${encodeURIComponent(part)}`);
    expect(found.json.accounts.map((a: any) => a.id)).toContain(middle.id);
    expect(found.json.matched).toBeGreaterThanOrEqual(1);
    // anything that cannot be part of an id is ignored, so the query cannot be used to inject SQL
    expect((await op.get(`/api/admin/accounts?q=${encodeURIComponent("' OR 1=1 --")}`)).status).toBe(200);
    expect((await op.get('/api/admin/accounts?q=zzzzzzzzzzzzzzzzzzzz')).json.accounts).toEqual([]);
    assertNothingPrivate();
  });
});

describe('usage history', () => {
  it('counts texts, codes, received texts, sign-ups and deletions per day, for 30 days', async () => {
    let op = await site();
    // the first snapshot sets the starting point
    const before = await op.get('/api/admin/history');
    expect(before.json.days).toHaveLength(30);
    expect(before.json.days.at(-1).day).toBe('2026-11-23');
    expect(before.json.days[0].day).toBe('2026-10-25');

    await populated(); // two codes, one confirmation text ("reminders are on")
    await signIn(OTHER, new Client('203.0.113.2')); // one code
    await noteTextReceived(testDb.db, world.clock.now);
    await noteTextReceived(testDb.db, world.clock.now);
    await op.post('/api/admin/test-text', { to: '+17324440150' }); // one text
    let today = (await op.get('/api/admin/history')).json.days.at(-1);
    expect(today).toEqual({ day: '2026-11-23', textsSent: 5, codesSent: 3, textsReceived: 2, signups: 2, deletions: 0 });

    // the state shows the same for today, and for the month
    const state = (await op.get('/api/admin/state')).json;
    expect(state.counts.today).toEqual(today);
    expect(state.counts.month).toMatchObject({ month: '2026-11', textsSent: 5, codesSent: 3, textsReceived: 2, signups: 2 });

    // a deletion the next day, and a failed send counts as nothing
    world.clock.now += DAY;
    op = await operator();
    const list = (await op.get('/api/admin/accounts')).json.accounts;
    await op.del(`/api/admin/households/${list[0].id}`);
    world.telnyx.failNext = 1;
    expect((await op.post('/api/admin/test-text', { to: '+17324440150' })).status).toBe(502);
    const days = (await op.get('/api/admin/history')).json.days;
    today = days.at(-1);
    expect(today).toMatchObject({ day: '2026-11-24', textsSent: 0, signups: 0, deletions: 1 });
    expect(days.at(-2)).toMatchObject({ day: '2026-11-23', textsSent: 5 });

    // the test account is never counted as a sign-up or a deletion
    await op.post('/api/admin/demo');
    await op.del('/api/admin/demo');
    expect((await op.get('/api/admin/history')).json.days.at(-1)).toMatchObject({ signups: 0, deletions: 1 });

    expect((await op.get('/api/admin/history?days=7')).json.days).toHaveLength(7);
    expect((await op.get('/api/admin/history?days=5000')).json.days).toHaveLength(30);
  });

  it('accounts that existed before the first snapshot are counted on the days they were made', async () => {
    await site();
    await signIn(HUSBAND);
    world.clock.now += 2 * DAY;
    await signIn(OTHER, new Client('203.0.113.2'));
    // as if the console had never taken a snapshot
    await testDb.db.batch([testDb.db.prepare('DELETE FROM usage_daily'), testDb.db.prepare("DELETE FROM site WHERE key LIKE 'ops:%'")]);
    const op = await operator();
    const days = (await op.get('/api/admin/history')).json.days;
    expect(days.at(-1)).toMatchObject({ day: '2026-11-25', signups: 1 });
    expect(days.at(-3)).toMatchObject({ day: '2026-11-23', signups: 1 });
  });

  it('the every-minute job records its heartbeat and keeps the counts current', async () => {
    const op = await site();
    await recordTick(env, world.clock.now);
    await signIn(HUSBAND);
    world.clock.now += MINUTE;
    await recordTick(env, world.clock.now);
    const state = (await op.get('/api/admin/state')).json;
    expect(state.ops.heartbeatAt).toBe(world.clock.now);
    expect(state.ops.lastSentAt).not.toBeNull();
    const row = await testDb.db.prepare('SELECT * FROM usage_daily WHERE day = ?').bind('2026-11-23').first<any>();
    expect(row).toMatchObject({ texts_sent: 1, codes_sent: 1, signups: 1 });
  });
});

describe('notes, price and validation', () => {
  it('keeps the notes to self and the price per text, and refuses nonsense', async () => {
    const op = await site();
    const r = await op.put('/api/admin/notes', { centsPerText: 0.79 });
    expect(r.status).toBe(200);
    expect(r.json.notes.centsPerText).toBe(0.79);
    const bad = await op.put('/api/admin/notes', { centsPerText: -1 });
    expect(bad.status).toBe(400);
    expect(bad.json.field).toBe('centsPerText');
    expect((await op.put('/api/admin/notes', { tollFreeVerified: 'yes' })).status).toBe(400);
    const verified = await op.put('/api/admin/notes', { tollFreeVerified: true });
    expect(verified.json.notes).toMatchObject({ tollFreeVerifiedAt: START, tollFreeSubmittedAt: START, centsPerText: 0.79 });
  });

  it('says which setting is wrong', async () => {
    const op = await site();
    const r = await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, monthlyMessageLimit: 1.5 });
    expect(r.status).toBe(400);
    expect(r.json.field).toBe('monthlyMessageLimit');
    const p = await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, allowedPrefixes: ['1'] });
    expect(p.json.field).toBe('allowedPrefixes');
    const n = await op.put('/api/admin/secrets', { telnyxNumber: '12' });
    expect(n.status).toBe(400);
    expect(n.json.field).toBe('telnyxNumber');
    const i = await op.post('/api/admin/invites', { kind: 'setup', number: '(732) 555-0142' });
    expect(i.json.field).toBe('number');
    const saved = await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, textSignup: false });
    expect(saved.json.config.textSignup).toBe(false);
    expect(saved.json.ops.configSavedAt).toBe(START);
  });

  it('names the donation field that is wrong, down to the link', async () => {
    const op = await site();
    const donate = (d: unknown) => op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, donate: d });
    const link = { label: 'PayPal', url: 'https://www.paypal.com/donate?id=1' };
    const url = await donate({ links: [link, { label: 'Card', url: 'http://pay.example.com/x' }], note: '' });
    expect(url.status).toBe(400);
    expect(url.json).toEqual({ error: 'donate.links.2.url: The address of link 2 must begin with https://.', field: 'donate.links.2.url' });
    expect((await donate({ links: [{ label: ' ', url: link.url }], note: '' })).json.field).toBe('donate.links.1.label');
    expect((await donate({ links: [link], note: 'x'.repeat(401) })).json.field).toBe('donate.note');
    expect((await donate({ links: [link, link, link, link, link], note: '' })).json.field).toBe('donate.links');
    const ok = await donate({ links: [link], note: ' Zelle: give@example.org ' });
    expect(ok.status).toBe(200);
    expect(ok.json.config.donate).toEqual({ links: [link], note: 'Zelle: give@example.org' });
  });
});

describe('texting status', () => {
  it('a test text records the last success, a failure records its kind and never its text', async () => {
    const op = await site();
    const ok = await op.post('/api/admin/test-text', { to: '(732) 444-0150' });
    expect(ok.status).toBe(200);
    expect(ok.json.state.ops).toMatchObject({ lastSentAt: START, lastSentConfirmed: true });
    world.clock.now += MINUTE;
    world.telnyx.failNext = 1;
    const failed = await op.post('/api/admin/test-text', { to: '(732) 444-0150' });
    expect(failed.status).toBe(502);
    expect(failed.json.error).toBe('Telnyx refused the text. Telnyx error 40008.');
    const s = (await op.get('/api/admin/state')).json;
    expect(s.ops.lastFailure).toEqual({ at: START + MINUTE, kind: 'refused', code: '40008' });
    expect(JSON.stringify(s)).not.toContain('Message filtered');
    expect((await op.post('/api/admin/test-text', { to: DEMO_NUMBER })).json.field).toBe('to');

    // with the key cleared, texting is "not set up"
    await op.put('/api/admin/secrets', { telnyxApiKey: '' });
    const off = await op.post('/api/admin/test-text', { to: '(732) 444-0150' });
    expect(off.json.error).toContain('not set up');
  });

  it('failureOf sorts failures into kinds, and noteSmsOutcome keeps only the kind and the code', async () => {
    expect(failureOf({ ok: false, reason: 'failed', detail: 'Telnyx 401: 10009 Authentication failed' })).toEqual({ kind: 'auth', code: '10009' });
    expect(failureOf({ ok: false, reason: 'failed', detail: 'Telnyx 422: 40008 Message filtered +17324440101' })).toEqual({ kind: 'refused', code: '40008' });
    expect(failureOf({ ok: false, reason: 'failed', detail: 'fetch failed' })).toEqual({ kind: 'network', code: null });
    expect(failureOf({ ok: false, reason: 'blocked', detail: 'Telnyx 400: 40300 Blocked' })).toEqual({ kind: 'blocked', code: '40300' });
    expect(failureOf({ ok: false, reason: 'site_limit', detail: 'x' })).toEqual({ kind: 'site_limit', code: null });
    await noteSmsOutcome(testDb.db, { ok: false, reason: 'failed', detail: 'Telnyx 422: 40008 to +17324440101' }, 5);
    const row = await testDb.db.prepare("SELECT value FROM site WHERE key = 'ops:failed'").first<{ value: string }>();
    expect(row?.value).not.toContain('7324440101');
  });
});

describe('the Check buttons', () => {
  it('Telnyx: a read-only call that tells a good key, a bad key, a missing number and a missing profile apart', async () => {
    const op = await site();
    const check = async () => (await op.post('/api/admin/check/telnyx')).json.result;
    expect(await check()).toMatchObject({ ok: true });
    expect((await check()).message).toContain('lists the number as active');
    await op.put('/api/admin/secrets', { telnyxMessagingProfileId: 'other-profile' });
    expect((await check()).message).toContain('different Messaging Profile');
    await op.put('/api/admin/secrets', { telnyxMessagingProfileId: PROFILE });
    expect(await check()).toMatchObject({ ok: true });
    telnyxNumbers = [{ phone_number: OUR_NUMBER, status: 'active', messaging_profile_id: null }];
    expect((await check()).message).toContain('not in a Messaging Profile');
    telnyxNumbers = [];
    expect((await check()).message).toContain('not on that Telnyx account');
    networkDown = true;
    expect((await check()).message).toContain('could not be reached');
    networkDown = false;
    await op.put('/api/admin/secrets', { telnyxApiKey: 'wrong-key' });
    const refused = await check();
    expect(refused).toMatchObject({ ok: false });
    expect(refused.message).toContain('refused the API key');
    // the last result is kept for the status page
    expect((await op.get('/api/admin/state')).json.checks.telnyx).toMatchObject({ ok: false, at: START });
    // nothing was sent
    expect(world.telnyx.sent).toEqual([]);
    await op.put('/api/admin/secrets', { telnyxApiKey: '' });
    expect((await check()).message).toBe('Save the API key and the number first.');
    expect(world.unexpected).toEqual([]);
    assertNothingPrivate();
  });

  it('Google: a made-up code tells whether the client id and secret are right, without signing anyone in', async () => {
    const op = await site({ google: true });
    expect((await op.post('/api/admin/check/google')).json.result).toMatchObject({ ok: true, message: 'Google accepted the client ID and secret.' });
    await op.put('/api/admin/secrets', { googleClientSecret: 'wrong' });
    expect((await op.post('/api/admin/check/google')).json.result).toMatchObject({ ok: false });
    expect(world.google.calls).toEqual(['token:authorization_code', 'token:authorization_code']);
    assertNothingPrivate();
  });

  it('RCS: says the agent\'s status, or that there is no such agent', async () => {
    const op = await site();
    expect((await op.post('/api/admin/check/rcs')).json.result.message).toContain('Save the Telnyx API key and the RCS agent id first');
    await op.put('/api/admin/secrets', { rcsAgentId: 'no-such-agent' });
    expect((await op.post('/api/admin/check/rcs')).json.result.message).toContain('no RCS agent');
    await op.put('/api/admin/secrets', { rcsAgentId: AGENT });
    agentStatus = 'REJECTED';
    expect((await op.post('/api/admin/check/rcs')).json.result).toMatchObject({ ok: false, agentStatus: 'REJECTED' });
  });
});

describe('invitation words and the text simulator', () => {
  it('makes a word for JOIN, lists it with the other invitations, and cancels it the same way', async () => {
    const op = await site({ config: { signup: 'invite' } });
    const made = await op.post('/api/admin/invite-words', { word: 'Spring26', days: 3, maxUses: 2, note: 'shul' });
    expect(made.status).toBe(200);
    expect(made.json.word).toBe('SPRING26');
    const inv = made.json.state.invites;
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ kind: 'signup', note: 'shul', maxUses: 2, uses: 0, expiresAt: START + 3 * DAY });
    // only a fingerprint is kept: the word itself is not in the state
    expect(JSON.stringify(made.json.state)).not.toContain('SPRING26');
    const again = await op.post('/api/admin/invite-words', { word: 'spring26' });
    expect(again.status).toBe(400);
    expect(again.json.error).toContain('already in use');
    const bad = await op.post('/api/admin/invite-words', { word: 'ab' });
    expect(bad.status).toBe(400);
    expect(bad.json.field).toBe('word');
    expect((await op.post('/api/admin/invite-words', { word: 'Winter27', days: 91 })).json.field).toBe('days');
    expect((await op.del(`/api/admin/invites/${inv[0].id}`)).json.invites).toEqual([]);
    expect((await new Client().post('/api/admin/invite-words', { word: 'Summer26' })).status).toBe(401);
    expect((await op.post('/api/admin/invite-words', { word: 'Summer26' }, { header: false })).status).toBe(400);
  });

  it('runs a complete sign-up by text from a made-up number, and sends nothing', async () => {
    const op = await site({ sms: false, config: { textSignup: true } });
    const say = async (text: string, from = '+17325550150') => {
      const r = await op.post('/api/admin/simulate', { from, text });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      return r.json;
    };
    const hello = await say('Hi');
    expect(hello.outcome).toBe('replied');
    expect(hello.replies[0].suggestions).toEqual([{ label: 'Join', send: 'JOIN' }]);
    const joined = await say('JOIN');
    expect(joined.outcome).toBe('created');
    expect(typeof joined.householdId).toBe('string');
    expect((await say('08701')).replies.map((r: any) => r.text)[0]).toContain('Lakewood, NJ 08701');
    expect((await say('A')).outcome).toBe('conversed');
    expect((await say('1 11/19 day')).replies[0].text).toMatch(/^Recorded: flow/);
    const menu = await say('MENU');
    expect(menu.replies[0].text).toMatch(/^Words:/);
    expect(world.telnyx.sent).toEqual([]);
    // the account it made is a test account, listed among the accounts
    const list = (await op.get('/api/admin/accounts')).json.accounts;
    expect(list.map((a: any) => a.id)).toContain(joined.householdId);
    // deleted by texting DELETE ACCOUNT
    await say('DELETE ACCOUNT');
    const gone = await say('YES');
    expect(gone.householdId).toBeNull();
    expect((await op.get('/api/admin/accounts')).json.accounts.map((a: any) => a.id)).not.toContain(joined.householdId);
  });

  it('refuses a real number, and needs the operator', async () => {
    const op = await site();
    const real = await op.post('/api/admin/simulate', { from: '+17324440101', text: 'JOIN' });
    expect(real.status).toBe(400);
    expect(real.json.error).toContain('reserved for fiction');
    expect((await op.post('/api/admin/simulate', { from: 'abc', text: 'JOIN' })).json.field).toBe('from');
    expect((await op.post('/api/admin/simulate', { from: '+17325550150', text: '' })).json.field).toBe('text');
    expect((await op.post('/api/admin/simulate', { from: '+17325550150', text: 'x'.repeat(321) })).status).toBe(400);
    expect((await new Client().post('/api/admin/simulate', { from: '+17325550150', text: 'JOIN' })).status).toBe(401);
    expect(world.telnyx.sent).toEqual([]);
  });

  it('the state shows the caps for texting with numbers that have no account', async () => {
    const op = await site();
    const caps = (await op.get('/api/admin/state')).json.textCaps;
    expect(caps).toEqual({ strangerRepliesPerNumber: 1, strangerRepliesPerDay: 50, textSignupsPerDay: 25, strangerRepliesToday: 0, textSignupsToday: 0 });
  });
});
