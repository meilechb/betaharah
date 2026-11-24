/**
 * The server end to end, against a real local database, with stand-ins
 * for Google and Telnyx.
 */
import type { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_MAX_FAILURES_ALL } from '../src/app/auth';
import type { Env } from '../src/app/env';
import { createApp } from '../src/app/index';
import { DEMO_NUMBER, DEMO_SPOUSE } from '../src/app/demo';
import { DEFAULT_SITE_CONFIG, type SiteConfig } from '../src/app/model';
import type { QueuedReminder } from '../src/app/model';
import { TABLES } from '../src/app/schema';
import { codeText, HELP_REPLY, REMINDERS_ON_TEXT, START_REPLY, TEST_TEXT, tick } from '../src/app/service';
import { DEFAULT_APP_SETTINGS, PLACES } from '../src/app/settings';
import { loadHousehold } from '../src/app/store';
import { civilToAbs, localToInstant } from '../src/engine/civil';
import { clock12 } from '../src/engine/present';
import { sunriseMs, sunsetMs } from '../src/engine/sun';
import { BASIC } from './helpers';
import { makeEnv, makeWorld, startDb, TEST_KEY, TEST_PASSWORD, type TestDb, type World } from './fakes';

const TZ = 'America/New_York';
const LAKEWOOD = PLACES[0]!;
const at = (m: number, d: number, hh: number, mi = 0): number => localToInstant({ y: 2026, m, d, hh, mi, ss: 0 }, TZ);
const START = at(11, 23, 10); // Monday 23 November 2026, 10:00
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Real-looking numbers: 555-0100 to 555-0199 are reserved for fiction and the site refuses to text them (see the test account).
const HUSBAND = '+17324440101';
const WIFE = '+17324440102';
const OTHER = '+17324440199';
const OUR_NUMBER = '+18885550100';

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

interface CallOptions {
  header?: boolean;
  cookies?: boolean;
  env?: Env;
  headers?: Record<string, string>;
  raw?: string;
}
interface Result {
  status: number;
  json: any;
  text: string;
  res: Response;
}

/** One browser: it keeps the cookies it is given, and has its own network address. */
class Client {
  cookies = new Map<string, string>();
  lastSetCookie = '';
  constructor(readonly address = '203.0.113.1') {}

  async call(method: string, path: string, body?: unknown, opts: CallOptions = {}): Promise<Result> {
    const headers: Record<string, string> = { 'cf-connecting-ip': this.address, ...(opts.headers ?? {}) };
    if (opts.header !== false) headers['x-betaharah'] = '1';
    if (opts.cookies !== false && this.cookies.size > 0) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let payload: string | undefined;
    if (opts.raw !== undefined) payload = opts.raw;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['content-type'] = 'application/json';
    }
    const res = await app.request(`https://cal.example${path}`, { method, headers, body: payload }, opts.env ?? env);
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
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, text, res };
  }

  get = (path: string, opts?: CallOptions) => this.call('GET', path, undefined, opts);
  post = (path: string, body: unknown = {}, opts?: CallOptions) => this.call('POST', path, body, opts);
  put = (path: string, body: unknown, opts?: CallOptions) => this.call('PUT', path, body, opts);
  del = (path: string, opts?: CallOptions) => this.call('DELETE', path, undefined, opts);

  async state(): Promise<any> {
    const r = await this.get('/api/state');
    expect(r.status).toBe(200);
    return r.json.state;
  }
}

/** The texts sent to a number, oldest first. */
const textsTo = (number: string): string[] => world.telnyx.sent.filter(s => s.to === number).map(s => s.text);

/** The most recent sign-in code texted to a number. */
function lastCode(number: string): string {
  const text = textsTo(number)
    .reverse()
    .find(t => t.startsWith('Betaharah code: '));
  if (!text) throw new Error(`no code was texted to ${number}`);
  return /code: (\d{6})\./.exec(text)![1] as string;
}

async function operator(): Promise<Client> {
  const c = new Client('198.51.100.9');
  expect((await c.post('/api/admin/login', { password: TEST_PASSWORD })).status).toBe(200);
  return c;
}

/** Sets the site up as the operator would. */
async function site(options: { sms?: boolean; google?: boolean; config?: Partial<SiteConfig> } = {}): Promise<Client> {
  const op = await operator();
  if (options.sms !== false) {
    const r = await op.put('/api/admin/secrets', { telnyxApiKey: 'telnyx-key', telnyxPublicKey: world.telnyx.publicKey, telnyxNumber: '+1 (888) 555-0100' });
    expect(r.status).toBe(200);
  }
  if (options.google) expect((await op.put('/api/admin/secrets', { googleClientId: 'client-id', googleClientSecret: 'client-secret' })).status).toBe(200);
  if (options.config) expect((await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, ...options.config })).status).toBe(200);
  return op;
}

/** Signs a number in (creating its account the first time) with a texted code. */
async function signIn(number: string, client = new Client(), invite?: string): Promise<Client> {
  const asked = await client.post('/api/auth/code', { number, invite });
  expect(asked.status, JSON.stringify(asked.json)).toBe(200);
  const verified = await client.post('/api/auth/verify', { number, code: lastCode(number), invite });
  expect(verified.status, JSON.stringify(verified.json)).toBe(200);
  expect(client.cookies.has('bt_session')).toBe(true);
  return client;
}

const appSettings = (patch: Record<string, unknown> = {}) => ({ ...DEFAULT_APP_SETTINGS, place: LAKEWOOD, ...patch });

/** A signed-in account with a location and customs saved. */
async function account(number: string, client = new Client()): Promise<Client> {
  await signIn(number, client);
  expect((await client.put('/api/app', appSettings())).status).toBe(200);
  expect((await client.put('/api/halachic', BASIC)).status).toBe(200);
  return client;
}

/** Adds a second phone to the account `owner` is signed in to. */
async function addPhone(owner: Client, number: string): Promise<void> {
  world.clock.now += 2 * MINUTE;
  expect((await owner.post('/api/phones/code', { number })).status).toBe(200);
  const r = await owner.post('/api/phones/verify', { number, code: lastCode(number) });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
}

async function textsOn(owner: Client, number: string, reminders = ['hefsek', 'bedikah_morning', 'bedikah_afternoon', 'mikvah', 'mikvah_confirm', 'onah']): Promise<void> {
  const r = await owner.put('/api/phones', { number, name: '', canUpdate: true, reminders, texts: true });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
}

/** A text arriving from a phone, as Telnyx delivers it. */
async function text(from: string, body: string, eventId: string, extra: { to?: string; autoresponseType?: string } = {}): Promise<number> {
  const req = await world.telnyx.inbound({ from, to: extra.to ?? OUR_NUMBER, text: body, eventId, nowMs: world.clock.now, autoresponseType: extra.autoresponseType });
  const r = await new Client().call('POST', '/webhooks/telnyx', undefined, { raw: req.body, headers: req.headers, header: false });
  return r.status;
}

/** Everything in the database, as text, to check what can be read there. */
async function dump(): Promise<string> {
  let out = '';
  for (const table of TABLES) {
    const { results } = await testDb.db.prepare(`SELECT * FROM ${table}`).all();
    out += `${table}: ${JSON.stringify(results)}\n`;
  }
  return out;
}

/** The waiting reminders of the only account there is (they are kept inside its encrypted data). */
async function queue(): Promise<QueuedReminder[]> {
  const row = await testDb.db.prepare('SELECT id FROM households').first<{ id: string }>();
  return (await loadHousehold(env, row!.id))!.data.queue;
}
const waiting = async (): Promise<number> => (await queue()).filter(q => q.status === 'pending').length;

const count = async (table: string, where = '1=1'): Promise<number> =>
  ((await testDb.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).first<{ n: number }>()) as { n: number }).n;

// ---------------------------------------------------------------------------

describe('before the site is set up', () => {
  it('says so, and nothing else works', async () => {
    const bare = { DB: testDb.db } as unknown as Env;
    const c = new Client();
    expect((await c.get('/api/public', { env: bare })).json).toEqual({ configured: false });
    expect((await c.post('/api/auth/code', { number: HUSBAND }, { env: bare })).status).toBe(503);
    expect((await c.post('/api/admin/login', { password: 'x' }, { env: bare })).status).toBe(503);
    expect((await c.get('/api/state', { env: bare })).status).toBe(503);
    expect((await c.get('/cal/' + 'a'.repeat(32) + '.ics', { env: bare })).status).toBe(404);
    // a key that is too short does not count as set up
    expect((await c.get('/api/public', { env: makeEnv(testDb.db, { ENCRYPTION_KEY: 'short' }) })).json).toEqual({ configured: false });
    expect(world.telnyx.sent).toEqual([]);
  });

  it('the pages for visitors still open', async () => {
    const bare = { DB: testDb.db } as unknown as Env;
    for (const path of ['/help', '/privacy', '/terms']) expect((await new Client().get(path, { env: bare })).status).toBe(200);
  });
});

describe('pages and request rules', () => {
  it('serves Help, Privacy and Terms with the contact the operator set, safely escaped', async () => {
    await site({ config: { contactName: 'Mr. <b>Test</b>', contactEmail: 'help@example.org' } });
    for (const path of ['/help', '/privacy', '/terms']) {
      const r = await new Client().get(path);
      expect(r.status).toBe(200);
      expect(r.res.headers.get('content-type')).toContain('text/html');
      expect(r.text).toContain('<!doctype html>');
      expect(r.text).not.toContain('<b>Test</b>');
      expect(r.text).toContain('help@example.org');
      expect(r.res.headers.get('x-frame-options')).toBe('DENY');
      expect(r.res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(r.res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(r.res.headers.get('x-robots-tag')).toBe(path === '/help' ? 'noindex' : null);
      expect(r.res.headers.get('content-security-policy')).toContain("default-src 'none'");
    }
    const privacy = (await new Client().get('/privacy')).text;
    expect(privacy).toContain('Mr. &lt;b&gt;Test&lt;/b&gt;');
    expect(privacy).toContain('privacy@betaharah.com');
    expect(privacy).toContain('Limited Use');
    expect(privacy).toContain('https://www.googleapis.com/auth/calendar.app.created');
    expect(privacy).toContain('No mobile information is shared with third parties or affiliates for marketing or promotional purposes.');
    const terms = (await new Client().get('/terms')).text;
    for (const phrase of ['STOP', 'HELP', 'Message and data rates may apply', 'frequency varies']) expect(terms).toContain(phrase);
    const help = (await new Client().get('/help')).text;
    expect(help).toContain(OUR_NUMBER);
  });

  it('the help page does not show a texting number while texting is off', async () => {
    await site({ sms: false });
    const help = (await new Client().get('/help')).text;
    expect(help).not.toContain('+1888');
    expect(help).toContain('Text messaging is not available on this site yet.');
  });

  it('a change must carry the site\'s own header and come from the site itself', async () => {
    await site();
    const c = new Client();
    expect((await c.post('/api/auth/code', { number: HUSBAND }, { header: false })).status).toBe(400);
    expect((await c.post('/api/auth/code', { number: HUSBAND }, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect(world.telnyx.sent).toEqual([]);
    expect((await c.post('/api/auth/code', { number: HUSBAND }, { headers: { origin: 'https://cal.example' } })).status).toBe(200);
  });

  it('answers 404 for what does not exist, and 401 for the dashboard\'s data without a session', async () => {
    await site();
    const c = new Client();
    expect((await c.get('/nothing-here')).status).toBe(404);
    expect((await c.get('/api/state')).status).toBe(401);
    expect((await c.get('/api/export')).status).toBe(401);
    expect((await c.get('/api/nothing')).status).toBe(401);
    const signed = await signIn(HUSBAND);
    expect((await signed.get('/api/nothing')).status).toBe(404);
    const r = await signed.get('/api/state');
    expect(r.res.headers.get('cache-control')).toBe('no-store');
  });

  it('says what the site allows, and nothing about anyone', async () => {
    await site({ config: { signup: 'invite', contactName: 'M', contactEmail: '', textSignup: true } });
    expect((await new Client().get('/api/public')).json).toEqual({
      configured: true,
      signedIn: false,
      signup: 'invite',
      sms: true,
      google: false,
      textingNumber: OUR_NUMBER,
      prefixes: ['+1'],
      contactName: 'M',
      contactEmail: '',
      codeMinutes: 10,
      resendSeconds: 60,
    });
    // the number to text is not shown when people cannot sign up by texting it
    const op = await operator();
    await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, textSignup: false });
    expect((await new Client().get('/api/public')).json.textingNumber).toBeNull();
    await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, textSignup: true, signup: 'closed' });
    expect((await new Client().get('/api/public')).json.textingNumber).toBeNull();
    // a configuration saved before these settings existed still loads, with their defaults
    const { textSignup: _a, rcsEnabled: _b, ...older } = DEFAULT_SITE_CONFIG;
    const saved = await op.put('/api/admin/config', older);
    expect(saved.status).toBe(200);
    expect(saved.json.config).toMatchObject({ textSignup: false, rcsEnabled: false });
  });
});

describe('signing up and signing in with a phone number', () => {
  beforeEach(async () => {
    await site();
  });

  it('a number and a texted code are all it takes', async () => {
    const c = new Client();
    const asked = await c.post('/api/auth/code', { number: '(732) 444-0101' });
    expect(asked.status).toBe(200);
    expect(asked.json).toEqual({ ok: true });
    expect(world.telnyx.sent).toHaveLength(1);
    expect(world.telnyx.sent[0]).toMatchObject({ from: OUR_NUMBER, to: HUSBAND });
    expect(world.telnyx.sent[0]!.text).toMatch(/^Betaharah code: \d{6}\. It expires in 10 minutes\. Do not share it\.$/);

    const verified = await c.post('/api/auth/verify', { number: '732-444-0101', code: lastCode(HUSBAND) });
    expect(verified.status).toBe(200);
    expect(verified.json).toEqual({ ok: true, created: true });
    expect(c.lastSetCookie).toMatch(/^bt_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=5184000; Secure$/);

    const s = await c.state();
    expect(s.phones).toEqual([{ number: HUSBAND, name: '', canUpdate: true, reminders: expect.any(Array), verified: true, texts: false, optedOut: false, me: true }]);
    expect(s.account).toEqual({ number: HUSBAND, method: 'code', hasPassword: false, googleEmail: null, fresh: true, welcomed: false });
    expect(s.demo).toBe(false);
    expect(s.sms.simulated).toBe(false);
    expect(s.terms).toBe('en');
    expect(s.status).toBeNull(); // no location yet
    expect(s.setup.map((x: any) => [x.key, x.done])).toEqual([['place', false], ['customs', false], ['entry', false], ['calendar', false], ['texts', false]]);
    expect((await c.get('/api/public')).json.signedIn).toBe(true);
  });

  it('signing in again reaches the same account, and a second number gets its own', async () => {
    const first = await account(HUSBAND);
    expect((await first.post('/api/entries', { kind: 'flow', when: 'now' })).status).toBe(200);
    world.clock.now += 5 * MINUTE;
    const again = new Client('203.0.113.50');
    await again.post('/api/auth/code', { number: HUSBAND });
    const verified = await again.post('/api/auth/verify', { number: HUSBAND, code: lastCode(HUSBAND) });
    expect(verified.json).toEqual({ ok: true, created: false });
    expect((await again.state()).entries).toHaveLength(1);
    const other = await signIn(OTHER);
    expect((await other.state()).entries).toEqual([]);
    expect(await count('households')).toBe(2);
    expect(await count('phones')).toBe(2);
  });

  it('a wrong code does not sign in, and five wrong guesses use the code up', async () => {
    const c = new Client();
    await c.post('/api/auth/code', { number: HUSBAND });
    const code = lastCode(HUSBAND);
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await c.post('/api/auth/verify', { number: HUSBAND, code: wrong });
      expect(r.status).toBe(400);
      expect(r.json.error).toBe('That code is not right, or it has expired.');
    }
    const locked = await c.post('/api/auth/verify', { number: HUSBAND, code });
    expect(locked.status).toBe(400);
    expect(locked.json.error).toBe('Too many wrong codes. Ask for a new one.');
    expect(c.cookies.size).toBe(0);
    expect(await count('households')).toBe(0);
    for (const bad of ['12345', '1234567', 'abcdef', '', null, 123456]) expect((await c.post('/api/auth/verify', { number: HUSBAND, code: bad })).status).toBe(400);
  });

  it('a code works once, only for its own number, and for ten minutes', async () => {
    const c = new Client();
    await c.post('/api/auth/code', { number: HUSBAND });
    const code = lastCode(HUSBAND);
    expect((await new Client().post('/api/auth/verify', { number: OTHER, code })).status).toBe(400);
    expect((await c.post('/api/auth/verify', { number: HUSBAND, code })).status).toBe(200);
    expect((await new Client().post('/api/auth/verify', { number: HUSBAND, code })).status).toBe(400); // used

    world.clock.now += 2 * MINUTE;
    const late = new Client();
    await late.post('/api/auth/code', { number: HUSBAND });
    const second = lastCode(HUSBAND);
    expect(second).not.toBe(code);
    world.clock.now += 10 * MINUTE + 1000;
    expect((await late.post('/api/auth/verify', { number: HUSBAND, code: second })).status).toBe(400);
  });

  it('a new code replaces the one before it', async () => {
    const c = new Client();
    await c.post('/api/auth/code', { number: HUSBAND });
    const first = lastCode(HUSBAND);
    world.clock.now += 61_000;
    await c.post('/api/auth/code', { number: HUSBAND });
    const second = lastCode(HUSBAND);
    if (first !== second) expect((await c.post('/api/auth/verify', { number: HUSBAND, code: first })).status).toBe(400);
    expect((await c.post('/api/auth/verify', { number: HUSBAND, code: second })).status).toBe(200);
  });

  it('refuses numbers it cannot use, without texting anything', async () => {
    const c = new Client();
    for (const number of ['444-0101', 'hello', '', null, '+44 20 7946 0958']) {
      const r = await c.post('/api/auth/code', { number });
      expect(r.status, String(number)).toBe(400);
    }
    expect((await c.post('/api/auth/code', { number: '+44 20 7946 0958' })).json.error).toBe('Only numbers beginning with +1 can be used here.');
    expect(world.telnyx.sent).toEqual([]);
  });

  it('when a text cannot be sent, the answer is the same and no account appears', async () => {
    world.telnyx.failNext = 1;
    const c = new Client();
    expect((await c.post('/api/auth/code', { number: HUSBAND })).json).toEqual({ ok: true });
    expect(world.telnyx.sent).toEqual([]);
    expect(await count('households')).toBe(0);
    // the failed text does not count against the month's limit
    expect(await count('counters', "key LIKE 'sms:%' AND value > 0")).toBe(0);
  });
});

describe('limits on sign-in codes', () => {
  it('one a minute and five a day to a number', async () => {
    await site();
    const c = new Client();
    expect((await c.post('/api/auth/code', { number: HUSBAND })).status).toBe(200);
    const soon = await c.post('/api/auth/code', { number: HUSBAND });
    expect(soon.status).toBe(429);
    expect(soon.json.error).toBe('A code was just sent. Wait a minute before asking for another.');
    for (let i = 0; i < 4; i++) {
      world.clock.now += 61_000;
      // from different addresses, so that only the per-number limit is in play
      expect((await new Client(`203.0.113.${10 + i}`).post('/api/auth/code', { number: HUSBAND })).status).toBe(200);
    }
    world.clock.now += 61_000;
    const sixth = await new Client('203.0.113.99').post('/api/auth/code', { number: HUSBAND });
    expect(sixth.status).toBe(429);
    expect(sixth.json.error).toContain('Too many codes were sent to this number today');
    expect(textsTo(HUSBAND)).toHaveLength(5);
    world.clock.now += DAY;
    expect((await new Client('203.0.113.99').post('/api/auth/code', { number: HUSBAND })).status).toBe(200);
  });

  it('eight an hour from one network address, whatever the numbers', async () => {
    await site();
    const c = new Client('203.0.113.77');
    for (let i = 0; i < 8; i++) expect((await c.post('/api/auth/code', { number: `+1732444020${i}` })).status).toBe(200);
    const ninth = await c.post('/api/auth/code', { number: '+17324440209' });
    expect(ninth.status).toBe(429);
    expect(world.telnyx.sent).toHaveLength(8);
    // someone else is not affected
    expect((await new Client('203.0.113.78').post('/api/auth/code', { number: '+17324440210' })).status).toBe(200);
    world.clock.now += HOUR + 1000;
    expect((await c.post('/api/auth/code', { number: '+17324440211' })).status).toBe(200);
  });

  it('a daily total for the whole site, which the operator sets', async () => {
    await site({ config: { dailyCodeLimit: 2 } });
    expect((await new Client('203.0.113.1').post('/api/auth/code', { number: '+17324440201' })).status).toBe(200);
    expect((await new Client('203.0.113.2').post('/api/auth/code', { number: '+17324440202' })).status).toBe(200);
    const third = await new Client('203.0.113.3').post('/api/auth/code', { number: '+17324440203' });
    expect(third.status).toBe(429);
    expect(third.json.error).toContain('paused for today');
    expect(world.telnyx.sent).toHaveLength(2);
    // the count lasts the day, not the hour
    world.clock.now += 3 * HOUR;
    expect((await new Client('203.0.113.4').post('/api/auth/code', { number: '+17324440204' })).status).toBe(429);
  });

  for (const signup of ['invite', 'closed'] as const) {
    it(`${signup === 'invite' ? 'by invitation' : 'closed'}: numbers that may not sign up do not use up the daily total, and get the same answer once it is reached`, async () => {
      const op = await site({ config: { dailyCodeLimit: 3 } });
      await signIn(HUSBAND, new Client('203.0.113.20')); // one code today
      await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, dailyCodeLimit: 3, signup });
      // strangers, many more than the daily total, from several addresses
      for (let i = 0; i < 6; i++) {
        const r = await new Client(`203.0.113.${30 + i}`).post('/api/auth/code', { number: `+1732444030${i}` });
        expect(r.status).toBe(200);
        expect(r.json).toEqual({ ok: true });
      }
      expect(world.telnyx.sent).toHaveLength(1);
      // the account that exists still gets its codes, up to the total
      for (let i = 0; i < 2; i++) {
        world.clock.now += 2 * MINUTE;
        expect((await new Client(`203.0.113.${40 + i}`).post('/api/auth/code', { number: HUSBAND })).status).toBe(200);
      }
      expect(textsTo(HUSBAND)).toHaveLength(3);
      // now the total is reached: the member and a stranger get the same answer
      world.clock.now += 2 * MINUTE;
      const member = await new Client('203.0.113.50').post('/api/auth/code', { number: HUSBAND });
      const stranger = await new Client('203.0.113.51').post('/api/auth/code', { number: '+17324440309' });
      expect(member.status).toBe(429);
      expect(stranger.status).toBe(429);
      expect(stranger.json).toEqual(member.json);
      expect(member.json.error).toContain('paused for today');
      expect(world.telnyx.sent).toHaveLength(3);
    });
  }

  it('a number that may not sign up is still held to the limits per number and per address', async () => {
    await site({ config: { signup: 'closed' } });
    const c = new Client('203.0.113.77');
    expect((await c.post('/api/auth/code', { number: OTHER })).status).toBe(200);
    expect((await c.post('/api/auth/code', { number: OTHER })).status).toBe(429); // a minute between codes
    for (let i = 0; i < 7; i++) expect((await c.post('/api/auth/code', { number: `+1732444020${i}` })).status).toBe(200);
    expect((await c.post('/api/auth/code', { number: '+17324440209' })).status).toBe(429); // eight an hour from one address
    expect(world.telnyx.sent).toEqual([]);
  });

  it('a monthly total of texts for the whole site', async () => {
    await site({ config: { monthlyMessageLimit: 1 } });
    await signIn(HUSBAND);
    const second = new Client('203.0.113.2');
    expect((await second.post('/api/auth/code', { number: OTHER })).json).toEqual({ ok: true });
    expect(textsTo(OTHER)).toEqual([]); // the limit was reached; nothing was sent
  });

  it('with texting switched off by the operator, no code is sent', async () => {
    await site({ config: { smsEnabled: false } });
    const r = await new Client().post('/api/auth/code', { number: HUSBAND });
    expect(r.status).toBe(503);
    expect(r.json.error).toBe('Sign-in by text message is not available yet.');
    expect(world.telnyx.sent).toEqual([]);
    expect((await new Client().get('/api/public')).json.sms).toBe(false);
  });
});

describe('who may sign up', () => {
  it('by invitation: a number without one gets the same answer and no text', async () => {
    const op = await site();
    await signIn(HUSBAND); // an account from before
    await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, signup: 'invite' });
    world.clock.now += 2 * MINUTE;

    const stranger = new Client('203.0.113.5');
    const asked = await stranger.post('/api/auth/code', { number: OTHER });
    expect(asked.status).toBe(200);
    expect(asked.json).toEqual({ ok: true });
    expect(textsTo(OTHER)).toEqual([]);
    // the limits answer the same way too
    expect((await stranger.post('/api/auth/code', { number: OTHER })).status).toBe(429);
    for (const code of ['000000', '123456']) expect((await stranger.post('/api/auth/verify', { number: OTHER, code })).status).toBe(400);
    expect(await count('households')).toBe(1);

    // the account that exists still signs in
    const member = new Client('203.0.113.6');
    expect((await member.post('/api/auth/code', { number: HUSBAND })).json).toEqual({ ok: true });
    expect((await member.post('/api/auth/verify', { number: HUSBAND, code: lastCode(HUSBAND) })).json).toEqual({ ok: true, created: false });
  });

  it('by invitation: a link from the operator lets as many people in as it says', async () => {
    const op = await site({ config: { signup: 'invite' } });
    const made = await op.post('/api/admin/invites', { kind: 'signup', maxUses: 2, days: 7, note: 'cousins' });
    expect(made.status).toBe(200);
    const link = new URL(made.json.link);
    expect(link.pathname).toBe('/app/');
    const invite = link.searchParams.get('invite') as string;
    expect(invite).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect((await new Client().get(`/api/auth/invite?code=${invite}`)).json).toEqual({ kind: 'signup' });
    expect((await new Client().get('/api/auth/invite?code=wrong')).status).toBe(404);
    // the link itself is not kept, only a fingerprint
    expect(await dump()).not.toContain(invite);
    expect(made.json.state.invites).toEqual([expect.objectContaining({ kind: 'signup', note: 'cousins', maxUses: 2, uses: 0 })]);

    await signIn('+17324440201', new Client('203.0.113.1'), invite);
    await signIn('+17324440202', new Client('203.0.113.2'), invite);
    expect(await count('households')).toBe(2);
    // used up: a third number gets the usual answer and no text
    const third = new Client('203.0.113.3');
    expect((await third.post('/api/auth/code', { number: '+17324440203', invite })).json).toEqual({ ok: true });
    expect(textsTo('+17324440203')).toEqual([]);
    expect((await op.get('/api/admin/state')).json.invites).toEqual([]);
  });

  it('an invitation that expired or was cancelled lets nobody in', async () => {
    const op = await site({ config: { signup: 'invite' } });
    const invite = new URL((await op.post('/api/admin/invites', { kind: 'signup', maxUses: 5, days: 1 })).json.link).searchParams.get('invite') as string;
    const c = new Client();
    expect((await c.post('/api/auth/code', { number: OTHER, invite })).status).toBe(200);
    const code = lastCode(OTHER);
    const id = (await op.get('/api/admin/state')).json.invites[0].id;
    expect((await op.del(`/api/admin/invites/${id}`)).status).toBe(200);
    const r = await c.post('/api/auth/verify', { number: OTHER, code, invite });
    expect(r.status).toBe(403);
    expect(await count('households')).toBe(0);

    const second = new URL((await op.post('/api/admin/invites', { kind: 'signup', maxUses: 5, days: 1 })).json.link).searchParams.get('invite') as string;
    world.clock.now += DAY + MINUTE;
    expect((await new Client().get(`/api/auth/invite?code=${second}`)).status).toBe(404);
    await new Client('203.0.113.9').post('/api/auth/code', { number: '+17324440203', invite: second });
    expect(textsTo('+17324440203')).toEqual([]);
  });

  it('closed: nobody new, and existing accounts carry on', async () => {
    const op = await site();
    const member = await account(HUSBAND);
    await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, signup: 'closed' });
    expect((await new Client('203.0.113.5').post('/api/auth/code', { number: OTHER })).json).toEqual({ ok: true });
    expect(textsTo(OTHER)).toEqual([]);
    expect((await member.post('/api/entries', { kind: 'flow', when: 'now' })).status).toBe(200);
  });
});

describe('an account made by the operator for one number, with a password and no texted code', () => {
  let op: Client;
  let invite: string;
  beforeEach(async () => {
    op = await site({ sms: false, config: { signup: 'invite' } });
    const made = await op.post('/api/admin/invites', { kind: 'setup', number: '(732) 444-0101', days: 7 });
    expect(made.status).toBe(200);
    invite = new URL(made.json.link).searchParams.get('invite') as string;
  });

  it('the invited number chooses a password and is in', async () => {
    expect((await new Client().get(`/api/auth/invite?code=${invite}`)).json).toEqual({ kind: 'setup' });
    const c = new Client();
    expect((await c.post('/api/auth/setup', { invite, number: OTHER, password: 'a good long password' })).status).toBe(400); // not the number it was made for
    expect((await c.post('/api/auth/setup', { invite, number: HUSBAND, password: 'short' })).status).toBe(400);
    expect((await c.post('/api/auth/setup', { invite: 'wrong', number: HUSBAND, password: 'a good long password' })).status).toBe(400);
    expect(await count('households')).toBe(0);

    const r = await c.post('/api/auth/setup', { invite, number: HUSBAND, password: 'a good long password' });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, created: true });
    const s = await c.state();
    expect(s.phones[0]).toMatchObject({ number: HUSBAND, verified: false, me: true });
    expect(s.account).toMatchObject({ number: HUSBAND, hasPassword: true });
    expect(world.telnyx.sent).toEqual([]);

    // the invitation cannot be used again
    expect((await new Client().post('/api/auth/setup', { invite, number: HUSBAND, password: 'another long password' })).status).toBe(400);
    expect(await count('households')).toBe(1);
    // the password is not kept as written
    expect(await dump()).not.toContain('a good long password');
  });

  it('signs in with number and password; wrong ones are refused alike', async () => {
    await new Client().post('/api/auth/setup', { invite, number: HUSBAND, password: 'a good long password' });
    const c = new Client('203.0.113.20');
    const wrong = await c.post('/api/auth/password', { number: HUSBAND, password: 'not the password' });
    expect(wrong.status).toBe(401);
    expect(wrong.json.error).toBe('Wrong number or password.');
    const unknown = await c.post('/api/auth/password', { number: OTHER, password: 'a good long password' });
    expect(unknown.status).toBe(401);
    expect(unknown.json).toEqual(wrong.json);
    expect(c.cookies.size).toBe(0);
    const ok = await c.post('/api/auth/password', { number: '732-444-0101', password: 'a good long password' });
    expect(ok.status).toBe(200);
    expect((await c.state()).account).toMatchObject({ number: HUSBAND, hasPassword: true });
    expect(c.lastSetCookie).toContain('HttpOnly');
  });

  it('locks a number after eight wrong passwords, for fifteen minutes', async () => {
    await new Client().post('/api/auth/setup', { invite, number: HUSBAND, password: 'a good long password' });
    for (let i = 0; i < 8; i++) expect((await new Client(`203.0.113.${i}`).post('/api/auth/password', { number: HUSBAND, password: `wrong guess ${i}` })).status).toBe(401);
    const locked = await new Client('203.0.113.200').post('/api/auth/password', { number: HUSBAND, password: 'a good long password' });
    expect(locked.status).toBe(429);
    world.clock.now += 15 * MINUTE + 1000;
    expect((await new Client('203.0.113.200').post('/api/auth/password', { number: HUSBAND, password: 'a good long password' })).status).toBe(200);
  });

  it('an invitation cannot be made for a number that already has an account', async () => {
    await new Client().post('/api/auth/setup', { invite, number: HUSBAND, password: 'a good long password' });
    const again = await op.post('/api/admin/invites', { kind: 'setup', number: HUSBAND });
    expect(again.status).toBe(400);
    expect(again.json.error).toBe('That number already has an account.');
  });

  it('once texting works, a texted code proves the number', async () => {
    const c = new Client();
    await c.post('/api/auth/setup', { invite, number: HUSBAND, password: 'a good long password' });
    // without proof of the number, texts from it are not acted on and reminders cannot be turned on
    expect((await c.put('/api/phones', { number: HUSBAND, name: '', canUpdate: true, reminders: [], texts: true })).status).toBe(400);
    await op.put('/api/admin/secrets', { telnyxApiKey: 'telnyx-key', telnyxPublicKey: world.telnyx.publicKey, telnyxNumber: OUR_NUMBER });
    await c.put('/api/app', appSettings());
    await text(HUSBAND, '1', 'ev-unverified');
    expect((await c.state()).entries).toEqual([]);
    expect(world.telnyx.sent).toEqual([]);

    const fresh = new Client('203.0.113.30');
    await fresh.post('/api/auth/code', { number: HUSBAND });
    expect((await fresh.post('/api/auth/verify', { number: HUSBAND, code: lastCode(HUSBAND) })).json).toEqual({ ok: true, created: false });
    expect((await fresh.state()).phones[0]).toMatchObject({ number: HUSBAND, verified: true });
    await text(HUSBAND, '1', 'ev-verified');
    expect((await c.state()).entries).toHaveLength(1);
  });
});

describe('sessions and passwords', () => {
  beforeEach(async () => {
    await site();
  });

  it('a cookie that was changed, or made with another key, is refused', async () => {
    const c = await signIn(HUSBAND);
    const good = c.cookies.get('bt_session') as string;
    const i = 12;
    c.cookies.set('bt_session', good.slice(0, i) + (good[i] === 'A' ? 'B' : 'A') + good.slice(i + 1));
    expect((await c.get('/api/state')).status).toBe(401);
    c.cookies.set('bt_session', good);
    expect((await c.get('/api/state')).status).toBe(200);
    expect((await c.get('/api/state', { env: makeEnv(testDb.db, { ENCRYPTION_KEY: 'z'.repeat(40) }) })).status).toBe(401);
  });

  it('a session lasts sixty days', async () => {
    const c = await signIn(HUSBAND);
    world.clock.now += 59 * DAY;
    expect((await c.get('/api/state')).status).toBe(200);
    world.clock.now += 2 * DAY;
    expect((await c.get('/api/state')).status).toBe(401);
  });

  it('signing out removes the cookie; signing out everywhere ends the other devices too', async () => {
    const laptop = await signIn(HUSBAND);
    world.clock.now += 2 * MINUTE;
    const phone = await signIn(HUSBAND, new Client('203.0.113.9'));
    const stolen = laptop.cookies.get('bt_session') as string;

    expect((await laptop.post('/api/auth/logout')).status).toBe(200);
    expect(laptop.cookies.has('bt_session')).toBe(false);
    expect((await laptop.get('/api/state')).status).toBe(401);
    // signing out one browser does not, on its own, end a copy of its cookie
    laptop.cookies.set('bt_session', stolen);
    expect((await laptop.get('/api/state')).status).toBe(200);

    expect((await phone.post('/api/auth/logout-all')).status).toBe(200);
    expect((await phone.get('/api/state')).status).toBe(401);
    expect((await laptop.get('/api/state')).status).toBe(401);
  });

  it('a password can be set only by a session that began in the last fifteen minutes', async () => {
    const c = await signIn(HUSBAND);
    expect((await c.put('/api/password', { password: 'short' })).status).toBe(400);
    const before = c.cookies.get('bt_session');
    const set = await c.put('/api/password', { password: 'a good long password' });
    expect(set.status).toBe(200);
    expect((await c.state()).account).toMatchObject({ hasPassword: true });
    // this browser stays signed in with a new cookie; a copy of the old cookie no longer works
    expect(c.cookies.get('bt_session')).not.toBe(before);
    expect((await c.get('/api/state')).status).toBe(200);
    const old = new Client();
    old.cookies.set('bt_session', before as string);
    expect((await old.get('/api/state')).status).toBe(401);

    // now both ways in work
    const byPassword = new Client('203.0.113.40');
    expect((await byPassword.post('/api/auth/password', { number: HUSBAND, password: 'a good long password' })).status).toBe(200);

    world.clock.now += 16 * MINUTE;
    const late = await c.put('/api/password', { password: 'another long password' });
    expect(late.status).toBe(403);
    expect(late.json.error).toContain('sign out and sign in again');
    expect((await c.del('/api/password')).status).toBe(403);
    expect((await c.state()).account.fresh).toBe(false);

    // signing in again makes it possible; the old password stops working once changed
    const again = new Client('203.0.113.41');
    expect((await again.post('/api/auth/password', { number: HUSBAND, password: 'a good long password' })).status).toBe(200);
    expect((await again.put('/api/password', { password: 'another long password' })).status).toBe(200);
    expect((await new Client('203.0.113.42').post('/api/auth/password', { number: HUSBAND, password: 'a good long password' })).status).toBe(401);
    expect((await new Client('203.0.113.43').post('/api/auth/password', { number: HUSBAND, password: 'another long password' })).status).toBe(200);
    // changing it signed the other browsers of this phone out
    expect((await c.get('/api/state')).status).toBe(401);
    expect((await byPassword.get('/api/state')).status).toBe(401);

    expect((await again.del('/api/password')).status).toBe(200);
    expect((await again.state()).account.hasPassword).toBe(false);
    expect((await new Client('203.0.113.44').post('/api/auth/password', { number: HUSBAND, password: 'another long password' })).status).toBe(401);
  });

  it('each phone of an account has its own password', async () => {
    const husband = await account(HUSBAND);
    await addPhone(husband, WIFE);
    await husband.post('/api/auth/logout');
    world.clock.now += 2 * MINUTE;
    const h = await signIn(HUSBAND, new Client('203.0.113.1'));
    expect((await h.put('/api/password', { password: 'the husband password' })).status).toBe(200);
    expect((await new Client('203.0.113.2').post('/api/auth/password', { number: WIFE, password: 'the husband password' })).status).toBe(401);
  });
});

describe('one account never sees another', () => {
  let a: Client;
  let b: Client;
  beforeEach(async () => {
    await site();
    a = await account(HUSBAND, new Client('203.0.113.1'));
    b = await account(OTHER, new Client('203.0.113.2'));
    expect((await a.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day', note: 'note of A' })).status).toBe(200);
    expect((await b.post('/api/entries', { kind: 'flow', date: '2026-11-10', part: 'night', note: 'note of B' })).status).toBe(200);
  });

  it('each sees only its own entries, phones and messages', async () => {
    const sa = await a.state();
    const sb = await b.state();
    expect(sa.entries.map((e: any) => e.note)).toEqual(['note of A']);
    expect(sb.entries.map((e: any) => e.note)).toEqual(['note of B']);
    expect(JSON.stringify(sa)).not.toContain(OTHER);
    expect(JSON.stringify(sa)).not.toContain('note of B');
    expect(JSON.stringify(sb)).not.toContain(HUSBAND);
    expect((await a.get('/api/export')).text).not.toContain('note of B');
    expect((await a.get('/api/export')).text).toContain('note of A');
  });

  it('one cannot remove or change what belongs to the other', async () => {
    const idOfB = (await b.state()).entries[0].id;
    expect((await a.del(`/api/entries/${idOfB}`)).status).toBe(404);
    expect((await b.state()).entries).toHaveLength(1);
    expect((await a.put('/api/phones', { number: OTHER, name: 'mine now', canUpdate: true, reminders: [], texts: false })).status).toBe(404);
    expect((await a.post('/api/phones/remove', { number: OTHER })).status).toBe(404);
    expect((await a.post('/api/phones/test', { number: OTHER })).status).toBe(404);
    expect((await b.state()).phones).toHaveLength(1);
    expect((await b.state()).phones[0].name).toBe('');
  });

  it('a number that has an account cannot be added to another, even with its code', async () => {
    world.clock.now += 2 * MINUTE;
    expect((await a.post('/api/phones/code', { number: OTHER })).status).toBe(200);
    const r = await a.post('/api/phones/verify', { number: OTHER, code: lastCode(OTHER) });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain('already belongs to another account');
    expect((await a.state()).phones.map((p: any) => p.number)).toEqual([HUSBAND]);
    expect((await b.state()).entries.map((e: any) => e.note)).toEqual(['note of B']); // B is untouched and still signed in
  });

  it('a code asked for by one account cannot add the phone to another', async () => {
    world.clock.now += 2 * MINUTE;
    expect((await a.post('/api/phones/code', { number: WIFE })).status).toBe(200);
    const r = await b.post('/api/phones/verify', { number: WIFE, code: lastCode(WIFE) });
    expect(r.status).toBe(400);
    expect((await b.state()).phones).toHaveLength(1);
    // and a sign-in code is not an add-a-phone code, nor the other way round
    world.clock.now += 2 * MINUTE;
    await new Client('203.0.113.60').post('/api/auth/code', { number: '+17324440150' });
    expect((await a.post('/api/phones/verify', { number: '+17324440150', code: lastCode('+17324440150') })).status).toBe(400);
    world.clock.now += 2 * MINUTE;
    await a.post('/api/phones/code', { number: '+17324440151' });
    expect((await new Client('203.0.113.61').post('/api/auth/verify', { number: '+17324440151', code: lastCode('+17324440151') })).status).toBe(400);
    expect(await count('households')).toBe(2);
  });

  it('the right code entered by another account does not use it up; the account that asked for it can still use it', async () => {
    world.clock.now += 2 * MINUTE;
    expect((await a.post('/api/phones/code', { number: WIFE })).status).toBe(200);
    const code = lastCode(WIFE);
    const wrongAccount = await b.post('/api/phones/verify', { number: WIFE, code });
    expect(wrongAccount.status).toBe(400);
    expect(wrongAccount.json.error).toBe('That code is not right, or it has expired.');
    const r = await a.post('/api/phones/verify', { number: WIFE, code });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect((await a.state()).phones.map((p: any) => p.number)).toEqual([HUSBAND, WIFE]);
    expect((await b.state()).phones.map((p: any) => p.number)).toEqual([OTHER]);
  });

  it('wrong guesses still count against the five allowed, whichever account makes them', async () => {
    world.clock.now += 2 * MINUTE;
    expect((await a.post('/api/phones/code', { number: WIFE })).status).toBe(200);
    const code = lastCode(WIFE);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i++) expect((await b.post('/api/phones/verify', { number: WIFE, code: wrong })).status).toBe(400);
    for (let i = 0; i < 2; i++) expect((await a.post('/api/phones/verify', { number: WIFE, code: wrong })).status).toBe(400);
    const r = await a.post('/api/phones/verify', { number: WIFE, code });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('Too many wrong codes. Ask for a new one.');
  });

  it('a text changes only the account its phone belongs to', async () => {
    await text(OTHER, '2 yesterday', 'ev-b'); // B is niddah since the 10th; a hefsek on the 22nd is in order
    expect((await a.state()).entries).toHaveLength(1);
    expect((await b.state()).entries).toHaveLength(2);
    expect((await a.state()).messages).toEqual([]);
    expect((await b.state()).messages).toHaveLength(2);
  });

  it('each calendar link shows only its own account', async () => {
    const linkA = (await a.post('/api/calendar-link')).json.state.calendar.link as string;
    const linkB = (await b.post('/api/calendar-link')).json.state.calendar.link as string;
    expect(linkA).not.toBe(linkB);
    const feedA = (await new Client().get(new URL(linkA).pathname)).text.replace(/\r\n /g, '');
    const feedB = (await new Client().get(new URL(linkB).pathname)).text.replace(/\r\n /g, '');
    expect(feedA).toContain('Nov 22\\, 2026');
    expect(feedA).not.toContain('Nov 10\\, 2026');
    expect(feedB).toContain('Tuesday evening\\, Nov 10\\, 2026');
    expect(feedB).not.toContain('Nov 22\\, 2026');
  });

  it('one account\'s stored data cannot be read in place of another\'s, even by someone who can write to the database', async () => {
    const rows = await testDb.db.prepare('SELECT id, data FROM households ORDER BY created_at').all<{ id: string; data: string }>();
    const [rowA, rowB] = rows.results as [{ id: string; data: string }, { id: string; data: string }];
    // put A's encrypted document where B's is
    await testDb.db.prepare('UPDATE households SET data = ? WHERE id = ?').bind(rowA.data, rowB.id).run();
    const r = await b.get('/api/state');
    expect(r.status).toBe(500);
    expect(r.text).not.toContain('note of A');
  });

  it('deleting one account leaves the other whole', async () => {
    expect((await a.post('/api/account/delete', { confirm: 'DELETE' })).status).toBe(200);
    expect((await b.state()).entries.map((e: any) => e.note)).toEqual(['note of B']);
    expect(await count('households')).toBe(1);
    expect(await count('phones')).toBe(1);
  });
});

describe('settings', () => {
  let c: Client;
  beforeEach(async () => {
    await site();
    c = await signIn(HUSBAND);
  });

  it('saving a location makes the calendar work; saving customs confirms them', async () => {
    const withPlace = await c.put('/api/app', appSettings());
    expect(withPlace.status).toBe(200);
    const s = withPlace.json.state;
    expect(s.status).toEqual({ headline: 'Tehorah', detail: '', phase: 'tehorah', day: null });
    expect(s.today).toEqual({ hebrew: 'Monday, 13 Kislev 5787', civil: 'Nov 23, 2026', part: 'day', date: '2026-11-23', civilDate: '2026-11-23' });
    expect(s.halachic.confirmedAt).toBeNull();
    const customs = await c.put('/api/halachic', BASIC);
    expect(customs.json.state.halachic.confirmedAt).toBe(START);
    expect(customs.json.state.halachic.settings).toEqual(BASIC);
    expect(customs.json.state.setup.filter((x: any) => x.done).map((x: any) => x.key)).toEqual(['place', 'customs']);
  });

  it('refuses a place or customs that cannot work, and keeps what was there', async () => {
    await c.put('/api/app', appSettings());
    const tromso = await c.put('/api/app', appSettings({ place: { name: 'Tromso', latitude: 69.65, longitude: 18.96, timeZone: 'Europe/Oslo', elevation: 0 } }));
    expect(tromso.status).toBe(400);
    expect(tromso.json.error).toContain('cannot be calculated for every day of the year');
    expect((await c.put('/api/app', { ...appSettings(), terms: 'french' })).status).toBe(400);
    expect((await c.put('/api/app', { place: LAKEWOOD })).status).toBe(400);
    expect((await c.put('/api/halachic', { ...BASIC, minWaitDays: '3' })).status).toBe(400);
    expect((await c.put('/api/halachic', { ...BASIC, extra: true })).status).toBe(400);
    // nightfall 18 degrees below the horizon does not happen in June in Manchester
    const manchester = PLACES.find(p => p.name === 'Manchester')!;
    expect((await c.put('/api/app', appSettings({ place: manchester }))).status).toBe(200);
    expect((await c.put('/api/halachic', { ...BASIC, tzeit: { kind: 'degrees', value: 18 } })).status).toBe(400);
    const s = await c.state();
    expect(s.app.place.name).toBe('Manchester');
    expect(s.halachic.confirmedAt).toBeNull();
  });

  it('halachic terms switch between English letters and Hebrew; the sentences stay English', async () => {
    await c.put('/api/app', appSettings());
    await c.put('/api/halachic', BASIC);
    await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day' });
    const en = await c.state();
    expect(en.terms).toBe('en');
    expect(en.words.hefsek).toBe('hefsek taharah');
    expect(en.status.headline).toBe('Niddah, before the hefsek taharah');
    expect(en.labels.kinds).toEqual({ flow: 'Flow', stain: 'Stain', hefsek: 'Hefsek taharah', broken: 'Count broken', mikvah: 'Immersion' });
    expect(en.halachic.choices[0].title).toBe('Days to wait before the hefsek taharah');
    expect(en.halachic.tzeitTitle).toBe('Nightfall, for the time of immersion');
    expect(en.entries[0].text).toBe('Flow: Sunday, 12 Kislev 5787 (Nov 22, 2026), by day');
    expect(en.upcoming.map((e: any) => e.title)).toContain('Hefsek taharah (by 4:33 PM)');
    expect(JSON.stringify(en)).not.toMatch(/[֐-׿]/);

    const he = (await c.put('/api/app', appSettings({ terms: 'he' }))).json.state;
    expect(he.terms).toBe('he');
    expect(he.words.hefsek).toBe('הפסק טהרה');
    expect(he.status.headline).toBe('נדה, before the הפסק טהרה');
    expect(he.labels.kinds).toEqual({ flow: 'ראייה', stain: 'כתם', hefsek: 'הפסק טהרה', broken: 'Count broken', mikvah: 'טבילה' });
    expect(he.labels.reminders.onah).toBe('עונת פרישה');
    expect(he.halachic.choices[0].title).toBe('Days to wait before the הפסק טהרה');
    expect(he.entries[0].text).toBe('ראייה: Sunday, י״ב כסלו תשפ״ז (Nov 22, 2026), by day');
    expect(he.today.hebrew).toBe('Monday, י״ג כסלו תשפ״ז');
    expect(he.upcoming.map((e: any) => e.title)).toContain('הפסק טהרה (by 4:33 PM)');
    // the choice changes wording only: the same events at the same times
    expect(he.upcoming.map((e: any) => [e.key, e.when])).toEqual(en.upcoming.map((e: any) => [e.key, e.when]));
    expect(JSON.stringify(he)).not.toMatch(/[{}]\w+[{}]|\{[a-z_]+\}/);
    // text messages stay in English letters whichever is chosen
    for (const r of he.reminders) expect(r.text).not.toMatch(/[֐-׿]/);

    const back = (await c.put('/api/app', appSettings({ terms: 'en' }))).json.state;
    expect(back.status.headline).toBe(en.status.headline);
  });
});

describe('recording on the website', () => {
  let c: Client;
  beforeEach(async () => {
    await site();
    c = await account(HUSBAND);
  });

  it('needs a location first', async () => {
    const fresh = await signIn(OTHER, new Client('203.0.113.3'));
    const r = await fresh.post('/api/entries', { kind: 'flow', when: 'now' });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('Not recorded: no location is set yet. Text LOCATION and your ZIP code, e.g. LOCATION 08701, or choose it on the website.');
  });

  it('records a period from start to immersion, and says what follows each step', async () => {
    const flow = await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day' });
    expect(flow.status).toBe(200);
    expect(flow.json.message).toBe('Recorded: flow Sun Nov 22 by day. Hefsek from Thu Nov 26.');
    expect(flow.json.state.status.headline).toBe('Niddah, before the hefsek taharah');
    expect(flow.json.state.entries[0]).toMatchObject({ kind: 'flow', source: 'dashboard' });

    // too early for an immersion, and no hefsek yet
    expect((await c.post('/api/entries', { kind: 'mikvah', when: 'now' })).json.error).toBe('Not recorded: no hefsek is recorded. Send 2 first.');

    world.clock.now = at(11, 26, 16);
    const hefsek = await c.post('/api/entries', { kind: 'hefsek', when: 'now' });
    expect(hefsek.json.message).toBe('Recorded: hefsek Thu Nov 26. Clean days Fri Nov 27 - Thu Dec 3. Mikvah Thu Dec 3 after 5:16 PM.');
    expect(hefsek.json.state.status.headline).toBe('Niddah, after the hefsek taharah');

    world.clock.now = at(11, 30, 10);
    const early = await c.post('/api/entries', { kind: 'mikvah', when: 'now' });
    expect(early.status).toBe(400);
    expect(early.json.error).toBe('Not recorded: the count is not complete. Mikvah night is Thu Dec 3 after 5:16 PM.');

    world.clock.now = at(12, 3, 20);
    const mikvah = await c.post('/api/entries', { kind: 'mikvah', when: 'now' });
    expect(mikvah.json.message).toBe('Recorded: mikvah Thu Dec 3 night.');
    expect(mikvah.json.state.status.headline).toBe('Tehorah');
    expect(mikvah.json.state.entries).toHaveLength(3);
    expect(mikvah.json.state.setup.find((x: any) => x.key === 'entry').done).toBe(true);
  });

  it('refuses a repeat, a time that has not come, and a form that makes no sense', async () => {
    expect((await c.post('/api/entries', { kind: 'flow', when: 'now' })).status).toBe(200);
    expect((await c.post('/api/entries', { kind: 'flow', when: 'now' })).json.error).toBe('Already recorded.');
    expect((await c.post('/api/entries', { kind: 'stain', date: '2026-11-25', part: 'day' })).json.error).toBe('Not recorded: that time has not come yet.');
    for (const bad of [{ kind: 'party', when: 'now' }, { kind: 'flow', date: '2026-13-40', part: 'day' }, { kind: 'flow', date: '2026-11-22' }, { kind: 'flow', date: '2026-11-22', time: '25:00' }, {}]) {
      expect((await c.post('/api/entries', bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await c.call('POST', '/api/entries', undefined, { raw: 'not json' })).status).toBe(400);
    expect((await c.state()).entries).toHaveLength(1);
  });

  it('says the phase as a key, dates each coming item, and returns the new entry\'s id', async () => {
    const tehorah = await c.state();
    expect(tehorah.status).toMatchObject({ phase: 'tehorah', day: null });
    expect(tehorah.today).toMatchObject({ date: '2026-11-23', civilDate: '2026-11-23', part: 'day' });

    const flow = await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day' });
    expect(flow.json.entryId).toBe(flow.json.state.entries[0].id);
    expect(flow.json.state.status).toMatchObject({ phase: 'before_hefsek', day: null });
    const hefsek = flow.json.state.upcoming.find((u: any) => u.kind === 'hefsek');
    expect(hefsek).toMatchObject({ date: '2026-11-26', endDate: '2026-11-26' });

    world.clock.now = at(11, 26, 16);
    const h = await c.post('/api/entries', { kind: 'hefsek', when: 'now' });
    expect(h.json.state.status).toMatchObject({ phase: 'before_first_day', day: null });
    // After sunset the Hebrew date is the next one: the first clean day has begun, on the same civil date.
    world.clock.now = at(11, 26, 19);
    const evening = await c.state();
    expect(evening.status).toMatchObject({ phase: 'counting', day: 1 });
    expect(evening.today).toMatchObject({ date: '2026-11-27', civilDate: '2026-11-26', part: 'night' });
    const clean = evening.upcoming.filter((u: any) => u.kind === 'clean_day').map((u: any) => u.date);
    expect(clean).toEqual(['2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03']);
    const mikvah = evening.upcoming.find((u: any) => u.kind === 'mikvah');
    expect(mikvah).toMatchObject({ date: '2026-12-03', endDate: '2026-12-03', when: 'Thu Dec 3, after 5:16 PM' });
    const night = evening.upcoming.find((u: any) => u.kind === 'onah' && u.date !== u.endDate);
    if (night) expect(night.endDate > night.date).toBe(true);

    world.clock.now = at(12, 3, 20);
    expect((await c.state()).status).toMatchObject({ phase: 'mikvah_tonight', day: null });
    world.clock.now = at(12, 4, 10);
    expect((await c.state()).status).toMatchObject({ phase: 'mikvah_not_recorded', day: null });
  });

  it('lists the text commands as rows, in the words the texts use', async () => {
    const s = await c.state();
    expect(s.sms.commandList.map((r: any) => r.text)).toEqual(['1', '2', '3', '4', '5', '9', '0', '?', 'MENU', 'STOP', 'START']);
    expect(s.sms.commandNote).toContain('After 2 or 4: yesterday.');
    await c.put('/api/app', { ...s.app, terms: 'he' });
    expect((await c.state()).sms.commandList[1].meaning).toBe('the hefsek is done');
  });

  it('removes an entry, and the picture follows', async () => {
    const flow = await c.post('/api/entries', { kind: 'flow', when: 'now' });
    const id = flow.json.state.entries[0].id;
    const removed = await c.del(`/api/entries/${id}`);
    expect(removed.status).toBe(200);
    expect(removed.json.state.entries).toEqual([]);
    expect(removed.json.state.status.headline).toBe('Tehorah');
    expect((await c.del(`/api/entries/${id}`)).status).toBe(404);
  });
});

describe('husband and wife on one account', () => {
  let husband: Client;
  beforeEach(async () => {
    await site();
    husband = await account(HUSBAND);
  });

  it('a second phone is added with a code texted to it, and then shares everything', async () => {
    world.clock.now += 2 * MINUTE;
    const asked = await husband.post('/api/phones/code', { number: '(732) 444-0102' });
    expect(asked.json).toEqual({ ok: true, number: WIFE });
    expect(textsTo(WIFE)).toHaveLength(1);
    expect((await husband.post('/api/phones/verify', { number: WIFE, code: '000000' })).status).toBe(400);
    const added = await husband.post('/api/phones/verify', { number: WIFE, code: lastCode(WIFE) });
    expect(added.status).toBe(200);
    expect(added.json.state.phones.map((p: any) => [p.number, p.verified, p.me, p.texts])).toEqual([
      [HUSBAND, true, true, false],
      [WIFE, true, false, false],
    ]);
    expect(await count('households')).toBe(1);
    expect(await count('phones')).toBe(2);

    // she signs in with her own number and sees the same account
    world.clock.now += 2 * MINUTE;
    const wife = await signIn(WIFE, new Client('203.0.113.8'));
    expect((await wife.post('/api/entries', { kind: 'flow', when: 'now' })).status).toBe(200);
    expect((await husband.state()).entries).toHaveLength(1);
    const hers = await wife.state();
    expect(hers.account.number).toBe(WIFE);
    expect(hers.phones.map((p: any) => [p.number, p.me])).toEqual([[HUSBAND, false], [WIFE, true]]);
    expect(await count('households')).toBe(1);

    // and either can record by text
    world.clock.now = at(11, 27, 15);
    await text(WIFE, '2', 'ev-w1');
    expect((await husband.state()).entries).toHaveLength(2);
    expect(textsTo(WIFE).at(-1)).toMatch(/^Recorded: hefsek Fri Nov 27\./);
  });

  it('a phone that is already on the account is not added twice, and an account holds four at most', async () => {
    await addPhone(husband, WIFE);
    world.clock.now += 2 * MINUTE;
    const again = await husband.post('/api/phones/code', { number: WIFE });
    expect(again.status).toBe(400);
    expect(again.json.error).toBe('That phone is already on this account.');
    await addPhone(husband, '+17324440103');
    await addPhone(husband, '+17324440104');
    world.clock.now += 2 * MINUTE;
    const fifth = await husband.post('/api/phones/code', { number: '+17324440105' });
    expect(fifth.status).toBe(400);
    expect(fifth.json.error).toBe('An account can have at most 4 phones.');
    expect(textsTo('+17324440105')).toEqual([]);
  });

  it('each phone has its own name, permission and reminders', async () => {
    await addPhone(husband, WIFE);
    const r = await husband.put('/api/phones', { number: WIFE, name: ' Rivka ', canUpdate: false, reminders: ['mikvah', 'mikvah'], texts: false });
    expect(r.status).toBe(200);
    expect(r.json.state.phones[1]).toMatchObject({ number: WIFE, name: 'Rivka', canUpdate: false, reminders: ['mikvah'], texts: false });
    expect(r.json.state.phones[0]).toMatchObject({ number: HUSBAND, name: '', canUpdate: true });
    expect((await husband.put('/api/phones', { number: WIFE, name: 'R', canUpdate: true, reminders: ['everything'], texts: false })).status).toBe(400);
    // a phone that may not record by text is told so, and nothing changes (it can still use the words that do not record)
    await text(WIFE, '1', 'ev-w');
    expect((await husband.state()).entries).toEqual([]);
    expect(textsTo(WIFE).filter(t => !t.startsWith('Betaharah code'))).toEqual(['This phone may not record entries. That is changed on the website, under Settings.']);
  });

  it('turning reminders on for a phone records the consent and sends one confirmation', async () => {
    await addPhone(husband, WIFE);
    const before = world.telnyx.sent.length;
    await textsOn(husband, WIFE, ['mikvah']);
    expect(world.telnyx.sent.slice(before)).toEqual([{ from: OUR_NUMBER, to: WIFE, text: REMINDERS_ON_TEXT, endpoint: 'sms', delivered: 'sms' }]);
    const s = await husband.state();
    expect(s.phones[1]).toMatchObject({ number: WIFE, texts: true, reminders: ['mikvah'] });
    expect(s.setup.find((x: any) => x.key === 'texts').done).toBe(true);
    expect(s.messages[0]).toMatchObject({ direction: 'out', phone: '0102', body: REMINDERS_ON_TEXT, status: 'sent' });
    // saving again sends nothing more
    await textsOn(husband, WIFE, ['mikvah', 'onah']);
    expect(world.telnyx.sent).toHaveLength(before + 1);
    expect(s.sms).toMatchObject({ ready: true, number: OUR_NUMBER, monthlyLimit: 200 });
    expect((await husband.state()).sms.usedThisMonth).toBe(1); // sign-in codes are not counted against the account
  });

  it('a phone can be removed; its sessions end and its number is free again', async () => {
    await addPhone(husband, WIFE);
    world.clock.now += 2 * MINUTE;
    const wife = await signIn(WIFE, new Client('203.0.113.8'));
    const removed = await husband.post('/api/phones/remove', { number: WIFE });
    expect(removed.status).toBe(200);
    expect(removed.json.state.phones.map((p: any) => p.number)).toEqual([HUSBAND]);
    expect((await wife.get('/api/state')).status).toBe(401);
    await text(WIFE, '1', 'ev-gone');
    expect((await husband.state()).entries).toEqual([]);
    // her number now starts an account of its own
    world.clock.now += 2 * MINUTE;
    const fresh = new Client('203.0.113.9');
    await fresh.post('/api/auth/code', { number: WIFE });
    expect((await fresh.post('/api/auth/verify', { number: WIFE, code: lastCode(WIFE) })).json).toEqual({ ok: true, created: true });
    expect(await count('households')).toBe(2);
  });

  it('the last phone cannot be removed; a phone that removes itself is signed out', async () => {
    const only = await husband.post('/api/phones/remove', { number: HUSBAND });
    expect(only.status).toBe(400);
    expect(only.json.error).toContain('only phone on the account');
    await addPhone(husband, WIFE);
    const self = await husband.post('/api/phones/remove', { number: HUSBAND });
    expect(self.json).toEqual({ signedOut: true });
    expect((await husband.get('/api/state')).status).toBe(401);
    world.clock.now += 2 * MINUTE;
    const wife = await signIn(WIFE, new Client('203.0.113.8'));
    expect((await wife.state()).phones.map((p: any) => p.number)).toEqual([WIFE]);
  });

  it('sends a test text to a phone on the account', async () => {
    const r = await husband.post('/api/phones/test', { number: HUSBAND });
    expect(r.status).toBe(200);
    expect(textsTo(HUSBAND).at(-1)).toBe(TEST_TEXT);
    expect(r.json.state.messages[0]).toMatchObject({ direction: 'out', body: TEST_TEXT, status: 'sent' });
    world.telnyx.failNext = 1;
    const failed = await husband.post('/api/phones/test', { number: HUSBAND });
    expect(failed.status).toBe(502);
    expect((await husband.state()).messages[0]).toMatchObject({ body: TEST_TEXT, status: 'not sent' });
  });
});

describe('text messages', () => {
  let c: Client;
  beforeEach(async () => {
    await site();
    c = await account(HUSBAND);
  });
  const replies = (): string[] => textsTo(HUSBAND).filter(t => !t.startsWith('Betaharah code'));

  it('records a command and replies', async () => {
    expect(await text(HUSBAND, '1', 'ev1')).toBe(200);
    expect(replies()).toEqual(['Recorded: flow Mon Nov 23 by day. Hefsek from Fri Nov 27. 0 to undo.']);
    const s = await c.state();
    expect(s.entries[0]).toMatchObject({ kind: 'flow', source: 'sms' });
    expect(s.messages.map((m: any) => [m.direction, m.phone, m.body, m.status])).toEqual([
      ['out', '0101', 'Recorded: flow Mon Nov 23 by day. Hefsek from Fri Nov 27. 0 to undo.', 'sent'],
      ['in', '0101', '1', 'received'],
    ]);
    await text(HUSBAND, '9', 'ev2');
    expect(replies().at(-1)).toMatch(/^Niddah since Mon Nov 23\./);
    await text(HUSBAND, '0', 'ev3');
    expect(replies().at(-1)).toMatch(/^Removed: flow Mon Nov 23 by day\. Tehorah\./);
    expect((await c.state()).entries).toEqual([]);
    await text(HUSBAND, 'what?', 'ev4');
    expect(replies().at(-1)).toMatch(/^Not understood; nothing was changed\./);
  });

  it('acts once on a message that is delivered twice', async () => {
    await text(HUSBAND, '1', 'same');
    await text(HUSBAND, '1', 'same');
    expect(replies()).toHaveLength(1);
    expect((await c.state()).entries).toHaveLength(1);
  });

  it('ignores a number it does not know while sign-up by text is off, and a message for another number', async () => {
    const op = await operator();
    await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, textSignup: false });
    expect(await text(OTHER, '1', 'ev1')).toBe(200);
    expect(await text(OTHER, 'JOIN', 'ev1b')).toBe(200);
    expect(await text(HUSBAND, '1', 'ev2', { to: '+18885550999' })).toBe(200);
    expect(await text(OTHER, 'JOIN', 'ev3', { to: '+18885550999' })).toBe(200);
    expect(world.telnyx.sent.filter(s => !s.text.startsWith('Betaharah code'))).toEqual([]);
    expect((await c.state()).entries).toEqual([]);
    expect(await count('households')).toBe(1);
  });

  it('refuses a webhook that Telnyx did not sign', async () => {
    const req = await world.telnyx.inbound({ from: HUSBAND, to: OUR_NUMBER, text: '1', eventId: 'ev1', nowMs: world.clock.now });
    const forged = await new Client().call('POST', '/webhooks/telnyx', undefined, { raw: req.body.replace('"1"', '"4"'), headers: req.headers, header: false });
    expect(forged.status).toBe(401);
    const unsigned = await new Client().call('POST', '/webhooks/telnyx', undefined, { raw: req.body, header: false });
    expect(unsigned.status).toBe(401);
    world.clock.now += 6 * MINUTE;
    const stale = await new Client().call('POST', '/webhooks/telnyx', undefined, { raw: req.body, headers: req.headers, header: false });
    expect(stale.status).toBe(401);
    expect((await c.state()).entries).toEqual([]);
  });

  it('STOP: the carrier confirms it, the site sends nothing and notes it; START turns texts back on', async () => {
    await textsOn(c, HUSBAND);
    await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day' });
    expect(await waiting()).toBeGreaterThan(0);
    expect(await count('households', 'wake_at IS NOT NULL')).toBe(1);
    const before = world.telnyx.sent.length;

    await text(HUSBAND, 'Stop', 'ev-stop', { autoresponseType: 'STOP' });
    world.telnyx.blocked.add(HUSBAND); // as the carrier does
    expect(world.telnyx.sent).toHaveLength(before); // no reply from the site
    let s = await c.state();
    expect(s.phones[0]).toMatchObject({ optedOut: true, texts: true });
    expect(s.messages[0]).toMatchObject({ direction: 'in', body: 'Stop' });
    expect(await waiting()).toBe(0); // nothing waits to be sent to it
    expect(await count('households', 'wake_at IS NOT NULL')).toBe(0);

    // commands are not acted on while opted out, and nothing is sent
    await text(HUSBAND, '9', 'ev-status');
    expect(world.telnyx.sent).toHaveLength(before);
    expect((await c.post('/api/phones/test', { number: HUSBAND })).status).toBe(400);

    world.telnyx.blocked.delete(HUSBAND);
    await text(HUSBAND, 'START', 'ev-start', { autoresponseType: 'START' });
    expect(textsTo(HUSBAND).at(-1)).toBe(START_REPLY);
    s = await c.state();
    expect(s.phones[0]).toMatchObject({ optedOut: false, texts: true });
    expect(await waiting()).toBeGreaterThan(0);
    await text(HUSBAND, '9', 'ev-status-2');
    expect(world.telnyx.sent).toHaveLength(before + 2);
  });

  it('the opt-out words work without Telnyx saying so, and for a phone that has not proved its number', async () => {
    await text(HUSBAND, 'unsubscribe', 'ev1');
    expect((await c.state()).phones[0].optedOut).toBe(true);
    await text(HUSBAND, 'unstop', 'ev2');
    expect((await c.state()).phones[0].optedOut).toBe(false);
    expect(replies()).toEqual([START_REPLY]);
  });

  it('HELP gets the program\'s description, once', async () => {
    await text(HUSBAND, 'HELP', 'ev1');
    expect(replies()).toEqual([HELP_REPLY]);
    // the filed wording is sent even when Telnyx marks the keyword as already answered
    await text(HUSBAND, 'HELP', 'ev2', { autoresponseType: 'HELP' });
    expect(replies()).toEqual([HELP_REPLY, HELP_REPLY]);
    await text(HUSBAND, '?', 'ev3');
    expect(replies().at(-1)).toMatch(/^1 flow began, 2 hefsek done/);
  });

  it('HELP and START from a number with no account get the filed replies, and the number is not stored', async () => {
    const stranger = '+17324440177'; // not one of the numbers reserved for fiction, which are never answered
    expect(await text(stranger, 'HELP', 'kw-help')).toBe(200);
    expect(textsTo(stranger)).toEqual([HELP_REPLY]);
    expect(await text(stranger, 'START', 'kw-start')).toBe(200);
    expect(textsTo(stranger)).toEqual([HELP_REPLY, START_REPLY]);
    expect(await text(stranger, 'STOP', 'kw-stop')).toBe(200);
    expect(textsTo(stranger)).toEqual([HELP_REPLY, START_REPLY]);
    expect(await text(stranger, '1', 'kw-command')).toBe(200);
    expect(textsTo(stranger)).toEqual([HELP_REPLY, START_REPLY]);
    expect(await count('phones')).toBe(1);
    expect(await count('households')).toBe(1);
    const again = await text(stranger, 'HELP', 'kw-help');
    expect(again).toBe(200);
    expect(textsTo(stranger)).toEqual([HELP_REPLY, START_REPLY]);
  });

  it('when the carrier says a number has opted out, the site notes it', async () => {
    world.telnyx.blocked.add(HUSBAND);
    await text(HUSBAND, '9', 'ev1');
    const s = await c.state();
    expect(s.phones[0].optedOut).toBe(true);
    expect(s.messages.find((m: any) => m.direction === 'out')).toMatchObject({ status: 'not sent' });
  });

  it('an account has a monthly limit on texts; past it nothing is sent, and failures are not counted', async () => {
    const op = await operator();
    await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, householdMonthlyLimit: 2 });
    world.telnyx.failNext = 1;
    await text(HUSBAND, '9', 'ev0'); // fails at the provider: not counted
    expect((await c.state()).sms.usedThisMonth).toBe(0);
    await text(HUSBAND, '9', 'ev1');
    await text(HUSBAND, '9', 'ev2');
    expect(replies()).toHaveLength(2);
    await text(HUSBAND, '9', 'ev3');
    expect(replies()).toHaveLength(2);
    const s = await c.state();
    expect(s.sms).toMatchObject({ usedThisMonth: 2, monthlyLimit: 2 });
    expect(s.messages.find((m: any) => m.direction === 'out')).toMatchObject({ status: 'not sent' });
    // another account is not affected
    const other = await account(OTHER, new Client('203.0.113.2'));
    await text(OTHER, '9', 'ev4');
    expect(textsTo(OTHER).at(-1)).toBe('Tehorah.');
    expect((await other.state()).sms.usedThisMonth).toBe(1);
    // a new month starts a new count
    world.clock.now = at(12, 2, 10);
    await text(HUSBAND, '9', 'ev5');
    expect(replies()).toHaveLength(3);
  });

  it('more than thirty texts in an hour from one phone are ignored', async () => {
    for (let i = 0; i < 31; i++) await text(HUSBAND, '9', `ev${i}`);
    expect(replies()).toHaveLength(30);
    world.clock.now += HOUR + MINUTE;
    await text(HUSBAND, '9', 'later');
    expect(replies()).toHaveLength(31);
  });
});

describe('reminders', () => {
  let c: Client;
  const reminders = (number: string): string[] => textsTo(number).filter(t => !t.startsWith('Betaharah code') && t !== REMINDERS_ON_TEXT);
  beforeEach(async () => {
    await site();
    c = await account(HUSBAND);
    await addPhone(c, WIFE);
  });
  const run = (): Promise<void> => tick(env, world.deps);

  it('go only to phones that agreed to them, each its own kinds, once', async () => {
    await textsOn(c, WIFE, ['hefsek']);
    await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day' });
    world.clock.now = at(11, 26, 14, 30); // before the hefsek reminder (two hours before sunset at 4:33)
    await run();
    expect(reminders(WIFE)).toEqual([]);
    world.clock.now = at(11, 26, 14, 34);
    await run();
    expect(reminders(WIFE)).toHaveLength(1);
    expect(reminders(WIFE)[0]).toMatch(/^Hefsek tahara: Thu Nov 26, before sunset at 4:33 PM\. Reply 2 when done\.$/);
    expect(reminders(HUSBAND)).toEqual([]); // he did not turn reminders on
    world.clock.now += MINUTE;
    await run();
    await run();
    expect(reminders(WIFE)).toHaveLength(1);
    const s = await c.state();
    expect(s.sms.usedThisMonth).toBe(2); // the confirmation and the reminder
  });

  it('what waits to be sent is unreadable in the database', async () => {
    await textsOn(c, WIFE);
    await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day' });
    expect(await waiting()).toBeGreaterThan(0);
    const all = await dump();
    for (const hidden of ['Hefsek', 'hefsek', 'bedikah', 'mikvah', 'onah', 'Clean day', '7324440102']) expect(all.includes(hidden), hidden).toBe(false);
    // the one thing kept outside the encrypted data is when the next reminder is due
    const first = Math.min(...(await queue()).map(q => q.at));
    expect(await count('households', `wake_at = ${first}`)).toBe(1);
  });

  it('a change to the entries replaces what waits, and never repeats what was sent', async () => {
    await textsOn(c, WIFE);
    await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day' });
    world.clock.now = at(11, 26, 14, 34);
    await run();
    expect(reminders(WIFE)).toHaveLength(1);
    // the hefsek is recorded: the hefsek reminders go, the reminders of the seven days come
    world.clock.now = at(11, 26, 16);
    await text(WIFE, '2', 'ev-h');
    const keys = await queue();
    expect(keys.filter(k => k.status === 'sent').map(k => k.key)).toEqual([expect.stringMatching(/^hefsek:/)]);
    expect(keys.find(k => k.status === 'sent')!.text).toBe(''); // the words are not kept once sent
    expect(keys.filter(k => k.status === 'pending' && k.key.startsWith('hefsek:'))).toEqual([]);
    expect(keys.filter(k => k.status === 'pending' && k.key.startsWith('bedikah_am:')).length).toBe(7);
    // she removes it again: the same day's hefsek reminder is not sent a second time
    await text(WIFE, '0', 'ev-undo');
    await run();
    expect(reminders(WIFE).filter(t => t.startsWith('Hefsek'))).toHaveLength(1);
  });

  it('nothing is sent on Shabbat: a reminder that could not go out before candle lighting is dropped', async () => {
    await textsOn(c, WIFE, ['bedikah_afternoon']);
    await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day' });
    world.clock.now = at(11, 26, 16);
    await c.post('/api/entries', { kind: 'hefsek', when: 'now' });
    // Friday 27 November: the afternoon reminder is at 3:03 PM; candle lighting is 4:15 PM.
    world.telnyx.failNext = 100; // the provider is down all Friday afternoon
    for (let m = 0; m <= 80; m += 10) {
      world.clock.now = at(11, 27, 15, 4) + m * MINUTE;
      await run();
    }
    world.telnyx.failNext = 0;
    world.clock.now = at(11, 27, 16, 20); // Shabbat has begun
    await run();
    world.clock.now = at(11, 28, 10);
    await run();
    expect(reminders(WIFE)).toEqual([]);
    const friday = (await queue()).find(q => /^bedikah_pm:.*:1$/.test(q.key))!;
    expect(friday.status).toBe('dropped');
    // Sunday's goes out as usual
    world.clock.now = at(11, 29, 15, 5);
    await run();
    expect(reminders(WIFE)).toHaveLength(1);
    expect(reminders(WIFE)[0]).toContain('Clean day 3 of 7');
  });

  it('a failed send is tried again ten minutes later, while the reminder is still worth sending', async () => {
    await textsOn(c, WIFE, ['hefsek']);
    await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day' });
    world.clock.now = at(11, 26, 14, 34);
    world.telnyx.failNext = 1;
    await run();
    expect(reminders(WIFE)).toEqual([]);
    world.clock.now += 5 * MINUTE;
    await run();
    expect(reminders(WIFE)).toEqual([]); // not yet
    world.clock.now += 6 * MINUTE;
    await run();
    expect(reminders(WIFE)).toHaveLength(1);
  });

  it('while texting is off, a due reminder is put off, and sent if texting comes back within its time', async () => {
    await textsOn(c, WIFE, ['hefsek']);
    await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day' });
    const op = await operator();
    expect((await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, smsEnabled: false })).status).toBe(200);
    world.clock.now = at(11, 26, 14, 34);
    await run();
    expect(reminders(WIFE)).toEqual([]);
    const hefsek = (await queue()).find(q => q.key.startsWith('hefsek:'))!;
    expect(hefsek).toMatchObject({ status: 'pending', notBefore: world.clock.now + 10 * MINUTE });
    // the stored wake time moved forward instead of staying in the past
    expect(await count('households', `wake_at = ${world.clock.now + 10 * MINUTE}`)).toBe(1);
    world.clock.now += 5 * MINUTE;
    expect((await (await operator()).put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, smsEnabled: true })).status).toBe(200);
    await run();
    expect(reminders(WIFE)).toEqual([]); // not before its new time
    world.clock.now += 6 * MINUTE;
    await run();
    expect(reminders(WIFE)).toHaveLength(1);
    expect(reminders(WIFE)[0]).toMatch(/^Hefsek tahara: Thu Nov 26/);
  });

  it('while texting stays off, a due reminder is dropped once its time is over', async () => {
    await textsOn(c, WIFE, ['hefsek']);
    await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day' });
    const op = await operator();
    expect((await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, smsEnabled: false })).status).toBe(200);
    for (let t = at(11, 26, 14, 34); t <= at(11, 26, 18); t += 10 * MINUTE) {
      world.clock.now = t;
      await run();
    }
    const hefsek = (await queue()).find(q => q.key.startsWith('hefsek:'))!;
    expect(hefsek).toMatchObject({ status: 'dropped', text: '' });
    expect((await (await operator()).put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, smsEnabled: true })).status).toBe(200);
    world.clock.now = at(11, 26, 18, 10);
    await run();
    expect(reminders(WIFE)).toEqual([]);
    expect(await count('households', `wake_at IS NOT NULL AND wake_at <= ${world.clock.now}`)).toBe(0);
  });

  it('a reminder whose time passed long ago is not sent late', async () => {
    await textsOn(c, WIFE, ['hefsek']);
    await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day' });
    world.clock.now = at(11, 26, 19); // hours after the reminder, and after sunset
    await run();
    expect(reminders(WIFE)).toEqual([]);
  });

  it('the periodic job keeps every account current, one at a time, and tidies up', async () => {
    await textsOn(c, WIFE);
    const other = await account(OTHER, new Client('203.0.113.2'));
    await other.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day' });
    await testDb.db.prepare('UPDATE households SET refresh_at = 0').run();
    await run();
    expect(await count('households', 'refresh_at = 0')).toBe(1);
    await run();
    expect(await count('households', 'refresh_at = 0')).toBe(0);
    expect(await count('households', `refresh_at = ${world.clock.now + 6 * HOUR}`)).toBe(2);
    // an account whose data cannot be read does not stop the others
    await testDb.db.prepare("UPDATE households SET data = 'broken', refresh_at = 0 WHERE id = (SELECT household_id FROM phones LIMIT 1)").run();
    await testDb.db.prepare('UPDATE households SET refresh_at = 1 WHERE refresh_at > 1').run();
    await run();
    await run();
    expect(await count('households', 'refresh_at <= 1')).toBe(0);
  });
});

describe('Google Calendar', () => {
  let c: Client;
  beforeEach(async () => {
    await site({ google: true });
    c = await account(HUSBAND);
  });

  async function connect(client: Client): Promise<void> {
    const start = await client.get('/api/google/start');
    expect(start.status).toBe(302);
    const to = new URL(start.res.headers.get('location') as string);
    expect(to.origin).toBe('https://accounts.google.com');
    expect(to.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.app.created');
    expect(to.searchParams.get('redirect_uri')).toBe('https://cal.example/api/google/callback');
    const back = await client.get(`/api/google/callback?code=good-code&state=${encodeURIComponent(to.searchParams.get('state') as string)}`);
    expect(back.status).toBe(302);
    expect(back.res.headers.get('location')).toBe('/app/?google=connected#settings');
  }

  it('connecting creates one calendar, which the periodic job fills and each change updates', async () => {
    await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day' });
    await connect(c);
    expect([...world.google.calendars.values()].map(x => [x.summary, x.timeZone])).toEqual([['Betaharah', TZ]]);
    expect((await c.state()).calendar.google).toEqual({ available: true, connected: true });
    expect(world.google.events()).toEqual([]);
    await tick(env, world.deps);
    const titles = world.google.events().map(e => e.resource.summary);
    expect(titles).toContain('Flow (day)');
    expect(titles).toContain('Hefsek taharah (by 4:33 PM)');
    expect(titles).toContain('Seven clean days: day 1 (projected)');
    expect(titles).toContain('Mikvah night (after 5:16 PM) (projected)');
    for (const e of world.google.events()) expect(e.resource.extendedProperties.private.mk).toBe('1');
    const s = await c.state();
    expect(s.calendar.sync).toMatchObject({ dirty: false, lastError: null });
    expect(s.setup.find((x: any) => x.key === 'calendar').done).toBe(true);

    world.clock.now = at(11, 26, 16);
    await c.post('/api/entries', { kind: 'hefsek', when: 'now' });
    const after = world.google.events().map(e => e.resource.summary);
    expect(after).toContain('Hefsek taharah ✓');
    expect(after).toContain('Seven clean days: day 1');
    expect(after.filter(t => t.includes('projected'))).toEqual([]);
    expect(new Set(world.google.events().map(e => e.resource.extendedProperties.private.k)).size).toBe(after.length);
  });

  it('the calendar follows the choice of terms and the chosen name', async () => {
    await c.put('/api/app', appSettings({ terms: 'he', calendar: { name: 'Home', style: 'words', historyDays: 400 } }));
    await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day' });
    await connect(c);
    await tick(env, world.deps);
    expect([...world.google.calendars.values()][0]!.summary).toBe('Home');
    expect(world.google.events().map(e => e.resource.summary)).toContain('הפסק טהרה (by 4:33 PM)');
    await c.put('/api/app', appSettings({ terms: 'en', calendar: { name: 'Home', style: 'discreet', historyDays: 400 } }));
    const titles = world.google.events().map(e => e.resource.summary);
    expect(titles).toContain('H < 4:33 PM');
    for (const e of world.google.events()) expect(e.resource.description).toBe('');
  });

  it('the way back from Google must belong to the same signed-in account', async () => {
    const start = await c.get('/api/google/start');
    const state = new URL(start.res.headers.get('location') as string).searchParams.get('state') as string;
    const other = await account(OTHER, new Client('203.0.113.2'));
    // another account, with the first account's state value
    const crossed = await other.get(`/api/google/callback?code=good-code&state=${encodeURIComponent(state)}`);
    expect(crossed.res.headers.get('location')).toContain('google_error=');
    // nobody signed in
    const nobody = await new Client().get(`/api/google/callback?code=good-code&state=${encodeURIComponent(state)}`);
    expect(nobody.res.headers.get('location')).toContain('google_error=');
    // a made-up state, an old one, a refusal at Google, a bad code
    expect((await c.get('/api/google/callback?code=good-code&state=made-up')).res.headers.get('location')).toContain('google_error=');
    expect((await c.get(`/api/google/callback?error=access_denied&state=${encodeURIComponent(state)}`)).res.headers.get('location')).toContain('google_error=');
    expect((await c.get(`/api/google/callback?code=bad-code&state=${encodeURIComponent(state)}`)).res.headers.get('location')).toContain('google_error=');
    world.clock.now += 11 * MINUTE;
    expect((await c.get(`/api/google/callback?code=good-code&state=${encodeURIComponent(state)}`)).res.headers.get('location')).toContain('google_error=');
    expect(world.google.calendars.size).toBe(0);
    expect((await c.state()).calendar.google.connected).toBe(false);
    expect((await other.state()).calendar.google.connected).toBe(false);
  });

  it('disconnecting withdraws the site\'s access at Google and forgets the token', async () => {
    await connect(c);
    const r = await c.post('/api/google/disconnect');
    expect(r.json.state.calendar.google.connected).toBe(false);
    expect(world.google.revoked).toEqual(['refresh-1']);
    await c.post('/api/entries', { kind: 'flow', when: 'now' });
    expect(world.google.events()).toEqual([]);
    expect(world.unexpected).toEqual([]);
  });

  it('when Google stops accepting the token, the account is told and can update again after reconnecting', async () => {
    await connect(c);
    world.google.refreshTokenValid = false;
    await c.post('/api/entries', { kind: 'flow', when: 'now' });
    const s = await c.state();
    expect(s.calendar.sync.lastError).toBe('Google no longer accepts the saved sign-in. Connect Google Calendar again.');
    expect(s.alerts.map((a: any) => a.text)).toContain('Google Calendar: Google no longer accepts the saved sign-in. Connect Google Calendar again.');
    world.google.refreshTokenValid = true;
    const sync = await c.post('/api/sync');
    expect(sync.json.outcome.status).toBe('ok');
    expect(sync.json.state.calendar.sync.lastError).toBeNull();
    expect(world.google.events().length).toBeGreaterThan(5);
  });

  it('is simply not offered when the operator has not set it up', async () => {
    const op = await operator();
    await op.put('/api/admin/secrets', { googleClientId: '', googleClientSecret: '' });
    expect((await c.state()).calendar.google).toEqual({ available: false, connected: false });
    const start = await c.get('/api/google/start');
    expect(start.res.headers.get('location')).toContain('/app/?google_error=');
  });
});

describe('the calendar subscription link', () => {
  let c: Client;
  beforeEach(async () => {
    await site();
    c = await account(HUSBAND);
    await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day' });
  });

  it('gives any calendar app the events, with no sign-in', async () => {
    expect((await c.state()).calendar.link).toBeNull();
    const made = await c.post('/api/calendar-link');
    const link = made.json.state.calendar.link as string;
    expect(link).toMatch(/^https:\/\/cal\.example\/cal\/[A-Za-z0-9_-]{32}\.ics$/);
    const feed = await new Client().get(new URL(link).pathname);
    expect(feed.status).toBe(200);
    expect(feed.res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(feed.res.headers.get('cache-control')).toBe('no-store');
    expect(feed.res.headers.get('x-robots-tag')).toBe('noindex');
    expect(feed.text).toContain('BEGIN:VCALENDAR');
    expect(feed.text).toContain('X-WR-CALNAME:Betaharah');
    expect(feed.text).toContain('SUMMARY:Hefsek taharah (by 4:33 PM)');
    expect(feed.text.match(/BEGIN:VEVENT/g)!.length).toBe((await c.state()).upcoming.length + 1); // and the flow, which is past
    // it follows the entries
    world.clock.now = at(11, 26, 16);
    await c.post('/api/entries', { kind: 'hefsek', when: 'now' });
    expect((await new Client().get(new URL(link).pathname)).text).toContain('SUMMARY:Hefsek taharah ✓');
  });

  it('only the exact link works; replacing or removing it ends the old one', async () => {
    const link = (await c.post('/api/calendar-link')).json.state.calendar.link as string;
    const path = new URL(link).pathname;
    expect((await new Client().get(path.replace('.ics', ''))).status).toBe(404);
    expect((await new Client().get(path.slice(0, -6) + 'AA.ics')).status).toBe(404);
    expect((await new Client().get('/cal/' + 'a'.repeat(32) + '.ics')).status).toBe(404);
    expect((await new Client().get('/cal/short.ics')).status).toBe(404);
    // the secret part is not readable in the database
    expect(await dump()).not.toContain(path.slice(5, -4));

    const replaced = (await c.post('/api/calendar-link')).json.state.calendar.link as string;
    expect(replaced).not.toBe(link);
    expect((await new Client().get(path)).status).toBe(404);
    expect((await new Client().get(new URL(replaced).pathname)).status).toBe(200);
    const removed = await c.del('/api/calendar-link');
    expect(removed.json.state.calendar.link).toBeNull();
    expect((await new Client().get(new URL(replaced).pathname)).status).toBe(404);
  });

  it('follows the discreet style', async () => {
    await c.put('/api/app', appSettings({ calendar: { name: 'B', style: 'discreet', historyDays: 400 } }));
    const link = (await c.post('/api/calendar-link')).json.state.calendar.link as string;
    const feed = (await new Client().get(new URL(link).pathname)).text;
    expect(feed).toContain('X-WR-CALNAME:B');
    expect(feed).toContain('SUMMARY:H < 4:33 PM');
    expect(feed).not.toContain('DESCRIPTION');
    const titles = feed.split('\r\n').filter(l => l.startsWith('SUMMARY:')).map(l => l.slice(8));
    expect(titles.length).toBeGreaterThan(8);
    for (const title of titles) expect(title).not.toMatch(/[A-Za-z]{3,}/);
  });
});

describe('your data', () => {
  beforeEach(async () => {
    await site({ google: true });
  });

  it('can be downloaded whole, without the secrets that open other things', async () => {
    const c = await account(HUSBAND);
    await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day', note: 'a note' });
    await c.post('/api/calendar-link');
    const r = await c.get('/api/export');
    expect(r.status).toBe(200);
    expect(r.res.headers.get('content-disposition')).toBe('attachment; filename="betaharah-export.json"');
    expect(r.json.entries).toHaveLength(1);
    expect(r.json.entries[0].note).toBe('a note');
    expect(r.json.phones[0].number).toBe(HUSBAND);
    expect(r.json.settings.place.name).toBe('Lakewood, NJ');
    expect(r.json.halachic).toEqual(BASIC);
    expect(r.json.calendarLinkExists).toBe(true);
    expect(r.text).not.toContain('refresh');
    expect(Object.keys(r.json)).not.toContain('calendarLinkToken');
  });

  it('deleting the account removes everything, withdraws Google access, and frees the number', async () => {
    const c = await account(HUSBAND);
    await addPhone(c, WIFE);
    await textsOn(c, WIFE);
    await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day' });
    const start = await c.get('/api/google/start');
    const state = new URL(start.res.headers.get('location') as string).searchParams.get('state') as string;
    await c.get(`/api/google/callback?code=good-code&state=${encodeURIComponent(state)}`);
    expect(await waiting()).toBeGreaterThan(0);

    expect((await c.post('/api/account/delete', { confirm: 'delete' })).status).toBe(400);
    expect((await c.post('/api/account/delete', {})).status).toBe(400);
    expect(await count('households')).toBe(1);

    const gone = await c.post('/api/account/delete', { confirm: 'DELETE' });
    expect(gone.status).toBe(200);
    expect(c.cookies.has('bt_session')).toBe(false);
    expect(world.google.revoked).toEqual(['refresh-1']);
    for (const table of ['households', 'phones', 'codes']) expect(await count(table, table === 'codes' ? 'household_id IS NOT NULL' : '1=1'), table).toBe(0);
    await text(WIFE, '9', 'ev-after');
    expect(textsTo(WIFE).filter(t => t.startsWith('Tehorah') || t.startsWith('Niddah'))).toEqual([]);

    // the same number can start again from nothing
    world.clock.now += 2 * MINUTE;
    const again = new Client('203.0.113.9');
    await again.post('/api/auth/code', { number: HUSBAND });
    expect((await again.post('/api/auth/verify', { number: HUSBAND, code: lastCode(HUSBAND) })).json).toEqual({ ok: true, created: true });
    expect((await again.state()).entries).toEqual([]);
  });
});

describe('what can be read in the database', () => {
  it('no phone number, entry, message, token, code or key appears there in the clear', async () => {
    const op = await site({ google: true, config: { contactName: 'M' } });
    const c = await account(HUSBAND);
    await addPhone(c, WIFE);
    await textsOn(c, WIFE);
    await c.put('/api/phones', { number: HUSBAND, name: 'Private name', canUpdate: true, reminders: ['mikvah'], texts: true });
    await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day', note: 'a private note' });
    await text(WIFE, '9', 'ev1');
    const start = await c.get('/api/google/start');
    await c.get(`/api/google/callback?code=good-code&state=${encodeURIComponent(new URL(start.res.headers.get('location') as string).searchParams.get('state') as string)}`);
    await tick(env, world.deps);
    const link = (await c.post('/api/calendar-link')).json.state.calendar.link as string;
    world.clock.now += 2 * MINUTE;
    await new Client('203.0.113.70').post('/api/auth/code', { number: OTHER });
    const pending = lastCode(OTHER);
    await c.put('/api/password', { password: 'a good long password' }).catch(() => undefined);
    await op.post('/api/admin/invites', { kind: 'setup', number: '+17324440177' });
    // the test account, with a simulated text, a simulated added phone and its simulated code
    expect((await op.post('/api/admin/demo')).status).toBe(200);
    expect((await op.post('/api/demo/text', { text: '9' })).status).toBe(200);
    const demoCode = (await op.post('/api/phones/code', { number: '+17325550150' })).json.demoCode as string;
    expect(demoCode).toMatch(/^\d{6}$/);

    const all = await dump();
    for (const secret of [
      '7325550100',
      '7325550199',
      '7325550150',
      'Test phone',
      'Spouse (example)',
      'simulated',
      // Short strings are looked for as whole values, because a few characters can turn up by chance in encrypted text.
      '"demo"',
      `"${demoCode}"`,
      `: ${demoCode}.`,
      '7324440101',
      '7324440102',
      '7324440199',
      '7324440177',
      '"0101"',
      'Private name',
      'a private note',
      'Lakewood',
      '"flow"',
      'onah:',
      '"onah"',
      'Niddah',
      'Tehorah',
      'refresh-1',
      'cal-1@group',
      new URL(link).pathname.slice(5, -4),
      `"${pending}"`,
      `: ${pending}.`,
      'telnyx-key',
      'client-secret',
      world.telnyx.publicKey,
      'a good long password',
      '203.0.113',
      '198.51.100',
      TEST_KEY,
      TEST_PASSWORD,
    ]) {
      expect(all.includes(secret), `"${secret}" is readable in the database`).toBe(false);
    }
    // what is readable: ids, times, counts, and the site's own settings
    expect(all).toContain('contactName');
    expect(all).toContain('codes:2026-11-23');
    expect(await count('households')).toBe(2);
  });
});

describe('the operator\'s console', () => {
  it('needs the operator password, and locks after eight wrong ones', async () => {
    const c = new Client();
    expect((await c.get('/api/admin/state')).status).toBe(401);
    for (let i = 0; i < 8; i++) expect((await c.post('/api/admin/login', { password: `wrong ${i}` })).status).toBe(401);
    expect((await c.post('/api/admin/login', { password: TEST_PASSWORD })).status).toBe(429);
    world.clock.now += 15 * MINUTE + 1000;
    expect((await c.post('/api/admin/login', { password: TEST_PASSWORD })).status).toBe(200);
    expect(c.lastSetCookie).toMatch(/^bt_admin=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure$/);
    expect((await c.get('/api/admin/state')).status).toBe(200);
    world.clock.now += 12 * HOUR + 1000;
    expect((await c.get('/api/admin/state')).status).toBe(401);
  });

  it('wrong passwords lock out only the address they come from', async () => {
    const attacker = new Client('203.0.113.66');
    for (let i = 0; i < 8; i++) expect((await attacker.post('/api/admin/login', { password: `wrong ${i}` })).status).toBe(401);
    expect((await attacker.post('/api/admin/login', { password: TEST_PASSWORD })).status).toBe(429);
    // the operator, from another address, still signs in
    const op = new Client('198.51.100.9');
    expect((await op.post('/api/admin/login', { password: TEST_PASSWORD })).status).toBe(200);
    expect((await op.get('/api/admin/state')).status).toBe(200);
    // the address is not kept in the clear
    expect(await dump()).not.toContain('203.0.113.66');
  });

  it('a much higher count over all addresses stops guessing from many addresses', async () => {
    let tried = 0;
    for (let a = 0; tried < ADMIN_MAX_FAILURES_ALL; a++) {
      const guesser = new Client(`192.0.2.${a}`);
      for (let i = 0; i < 8 && tried < ADMIN_MAX_FAILURES_ALL; i++, tried++) expect((await guesser.post('/api/admin/login', { password: `wrong ${tried}` })).status).toBe(401);
    }
    expect((await new Client('198.51.100.9').post('/api/admin/login', { password: TEST_PASSWORD })).status).toBe(429);
    world.clock.now += 15 * MINUTE + 1000;
    expect((await new Client('198.51.100.9').post('/api/admin/login', { password: TEST_PASSWORD })).status).toBe(200);
  });

  it('is separate from the accounts: neither sign-in opens the other', async () => {
    const op = await site();
    const member = await account(HUSBAND);
    expect((await member.get('/api/admin/state')).status).toBe(401);
    expect((await member.put('/api/admin/config', DEFAULT_SITE_CONFIG)).status).toBe(401);
    expect((await member.post('/api/admin/invites', { kind: 'signup' })).status).toBe(401);
    expect((await member.del('/api/admin/households/anything')).status).toBe(401);
    expect((await op.get('/api/state')).status).toBe(401);
    expect((await op.get('/api/export')).status).toBe(401);
    expect((await op.post('/api/admin/logout')).status).toBe(200);
    expect((await op.get('/api/admin/state')).status).toBe(401);
  });

  it('shows totals and settings, and nothing of any account', async () => {
    const op = await site({ google: true });
    const member = await account(HUSBAND);
    await addPhone(member, WIFE);
    await member.put('/api/phones', { number: WIFE, name: 'Private name', canUpdate: true, reminders: [], texts: false });
    await member.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day', note: 'a private note' });
    await text(HUSBAND, '9', 'ev1');
    const r = await op.get('/api/admin/state');
    expect(r.status).toBe(200);
    expect(r.json.totals).toEqual({ households: 1, phones: 2, waiting: 0 });
    expect(r.json.usage).toEqual({ textsThisMonth: 3, codesToday: 2 });
    expect(r.json.households).toEqual([{ id: expect.any(String), created_at: START, updated_at: expect.any(Number), phones: 2 }]);
    expect(r.json.secretsSet).toEqual({
      googleClientId: true,
      googleClientSecret: true,
      telnyxApiKey: true,
      telnyxPublicKey: true,
      telnyxNumber: true,
      telnyxMessagingProfileId: false,
      rcsAgentId: false,
    });
    expect(r.json.urls).toEqual({
      webhook: 'https://cal.example/webhooks/telnyx',
      redirect: 'https://cal.example/api/google/callback',
      signInRedirect: 'https://cal.example/api/auth/google/callback',
      home: 'https://cal.example/',
      privacy: 'https://cal.example/privacy',
      terms: 'https://cal.example/terms',
    });
    expect(r.json.smsReady).toBe(true);
    expect(r.json.googleReady).toBe(true);
    for (const hidden of ['7324440101', '7324440102', 'Private name', 'a private note', 'Lakewood', 'telnyx-key', 'client-secret', 'Tehorah']) {
      expect(r.text.includes(hidden), hidden).toBe(false);
    }
  });

  it('opens one account: its phone numbers, the Google email and its recent texts, and not its dates', async () => {
    const op = await site({ google: true });
    const member = await account(HUSBAND);
    await addPhone(member, WIFE);
    await member.put('/api/phones', { number: WIFE, name: 'Private name', canUpdate: true, reminders: [], texts: false });
    await member.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day', note: 'a private note' });
    await text(HUSBAND, '9', 'ev1');
    const id = (await op.get('/api/admin/state')).json.households[0].id;
    const r = await op.get(`/api/admin/accounts/${id}`);
    expect(r.status).toBe(200);
    expect(r.json.account).toMatchObject({ id, test: false, googleEmail: null, googleName: null });
    expect(r.json.account.phones).toEqual([
      { number: HUSBAND, verified: true, texts: false, optedOut: false },
      { number: WIFE, verified: true, texts: false, optedOut: false },
    ]);
    expect(r.json.account.messages.some((m: { body: string }) => m.body === '9')).toBe(true);
    expect(r.json.account.messages.length).toBeLessThanOrEqual(15);
    for (const hidden of ['Private name', 'a private note', 'Lakewood', 'telnyx-key', 'client-secret', '2026-11-22']) expect(r.text.includes(hidden), hidden).toBe(false);
    // only for the operator, and only an account that exists
    expect((await member.get(`/api/admin/accounts/${id}`)).status).toBe(401);
    expect((await new Client().get(`/api/admin/accounts/${id}`)).status).toBe(401);
    expect((await op.get('/api/admin/accounts/no-such-account')).status).toBe(404);
  });

  it('checks the settings it is given, and never gives a key back', async () => {
    const op = await site();
    expect((await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, signup: 'everyone' })).status).toBe(400);
    expect((await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, allowedPrefixes: [] })).status).toBe(400);
    expect((await op.put('/api/admin/secrets', { telnyxNumber: '555' })).status).toBe(400);
    expect((await op.put('/api/admin/secrets', { telnyxApiKey: 5 })).status).toBe(400);
    const saved = await op.put('/api/admin/config', { ...DEFAULT_SITE_CONFIG, allowedPrefixes: ['+1', '+44'], contactEmail: 'a@b.example' });
    expect(saved.json.config.allowedPrefixes).toEqual(['+1', '+44']);
    expect((await new Client().get('/api/public')).json.prefixes).toEqual(['+1', '+44']);
    // removing one key leaves the others
    const cleared = await op.put('/api/admin/secrets', { telnyxApiKey: '' });
    expect(cleared.json.secretsSet).toMatchObject({ telnyxApiKey: false, telnyxPublicKey: true, telnyxNumber: true });
    expect(cleared.json.smsReady).toBe(false);
    expect(cleared.text).not.toContain(world.telnyx.publicKey);
  });

  it('sends a test text, and deletes an account when asked', async () => {
    const op = await site({ google: true });
    expect((await op.post('/api/admin/test-text', { to: '(732) 444-0101' })).status).toBe(200);
    expect(textsTo(HUSBAND)).toEqual([TEST_TEXT]);
    world.telnyx.failNext = 1;
    expect((await op.post('/api/admin/test-text', { to: HUSBAND })).status).toBe(502);
    expect((await op.get('/api/admin/state')).json.usage.textsThisMonth).toBe(1);

    const member = await account(HUSBAND);
    world.clock.now += HOUR;
    const other = await account(OTHER, new Client('203.0.113.2'));
    const start = await member.get('/api/google/start');
    await member.get(`/api/google/callback?code=good-code&state=${encodeURIComponent(new URL(start.res.headers.get('location') as string).searchParams.get('state') as string)}`);
    const list = (await op.get('/api/admin/state')).json.households;
    expect(list).toHaveLength(2);
    const oldest = list.at(-1).id;
    expect((await op.del(`/api/admin/households/${oldest}`)).json.households).toHaveLength(1);
    expect((await member.get('/api/state')).status).toBe(401);
    expect(world.google.revoked).toEqual(['refresh-1']);
    expect((await other.get('/api/state')).status).toBe(200);
    expect((await op.del('/api/admin/households/no-such-id')).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------

/** Nothing went to the text-message provider, and no counter of texts or codes moved. */
async function nothingSent(): Promise<void> {
  expect(world.telnyx.sent).toEqual([]);
  expect(await count('counters', "key LIKE 'sms:%' OR key LIKE 'codes:%' OR key LIKE 'code-ip:%'")).toBe(0);
}

/** The operator opens the test account; the operator's browser is then signed in to it. */
async function openDemo(op: Client): Promise<Client> {
  const r = await op.post('/api/admin/demo');
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return op;
}

/** The test account's simulated text box. */
async function demoText(c: Client, body: string): Promise<string | null> {
  const r = await c.post('/api/demo/text', { text: body });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json.reply;
}

describe('the test account', () => {
  it('the operator opens it with one click, set up, in the clean days, and signed in', async () => {
    const op = await site({ sms: false });
    expect((await op.get('/api/admin/state')).json.demo).toEqual({ exists: false, number: DEMO_NUMBER });
    const r = await op.post('/api/admin/demo');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, number: DEMO_NUMBER });
    expect(op.lastSetCookie).toMatch(/^bt_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=5184000; Secure$/);

    const s = await op.state();
    expect(s.demo).toBe(true);
    expect(s.account).toEqual({ number: DEMO_NUMBER, method: 'code', hasPassword: false, googleEmail: null, fresh: true, welcomed: true });
    expect(s.phones.map((p: any) => [p.number, p.name, p.verified, p.texts, p.canUpdate, p.me])).toEqual([
      [DEMO_NUMBER, 'Test phone', true, true, true, true],
      [DEMO_SPOUSE, 'Spouse (example)', true, true, true, false],
    ]);
    // texting is shown as working, with a made-up number while the site has none
    expect(s.sms).toMatchObject({ ready: true, simulated: true, number: '+18885550100' });
    expect(s.app.place.name).toBe('Lakewood, NJ');
    expect(s.halachic.confirmedAt).not.toBeNull();
    expect(s.entryCount).toBe(14);
    expect(s.status.headline).toMatch(/: day 5$/);
    expect(s.setup.filter((x: any) => x.done).map((x: any) => x.key)).toEqual(['place', 'customs', 'entry', 'texts']);
    expect(s.reminders.length).toBeGreaterThan(5);
    expect(s.upcoming.some((e: any) => e.kind === 'mikvah')).toBe(true);
    expect(s.upcoming.some((e: any) => e.kind === 'onah')).toBe(true);
    expect(s.alerts.filter((a: any) => a.level === 'warn')).toEqual([]);
    // the reminders are waiting to be "sent"
    expect(await waiting()).toBeGreaterThan(0);
    expect(await count('households', 'wake_at IS NOT NULL')).toBe(1);

    const admin = (await op.get('/api/admin/state')).json;
    expect(admin.demo).toEqual({ exists: true, number: DEMO_NUMBER });
    expect(admin.totals).toMatchObject({ households: 1, phones: 2 });
    await nothingSent();
  });

  it('shows the site\'s own texting number once there is one', async () => {
    const op = await openDemo(await site());
    expect((await op.state()).sms).toMatchObject({ ready: true, simulated: true, number: OUR_NUMBER });
  });

  it('only the operator can open or delete it', async () => {
    await site();
    const member = await account(HUSBAND);
    expect((await member.post('/api/admin/demo')).status).toBe(401);
    expect((await member.del('/api/admin/demo')).status).toBe(401);
    expect((await new Client().post('/api/admin/demo')).status).toBe(401);
    expect((await new Client().post('/api/admin/demo', {}, { header: false })).status).toBe(400);
    expect(await count('households')).toBe(1);
    expect((await member.state()).demo).toBe(false);
  });

  it('opening it again starts a fresh one; deleting it removes it', async () => {
    const op = await openDemo(await site({ sms: false }));
    await op.put('/api/phones', { number: DEMO_SPOUSE, name: 'Changed', canUpdate: true, reminders: ['mikvah'], texts: true });
    const old = new Client('203.0.113.80');
    old.cookies.set('bt_session', op.cookies.get('bt_session') as string);
    expect((await old.get('/api/state')).status).toBe(200);

    world.clock.now += HOUR;
    await openDemo(op);
    expect(await count('households')).toBe(1);
    expect(await count('phones')).toBe(2);
    expect((await old.get('/api/state')).status).toBe(401);
    expect((await op.state()).phones[1].name).toBe('Spouse (example)');

    const gone = await op.del('/api/admin/demo');
    expect(gone.status).toBe(200);
    expect(gone.json.demo).toEqual({ exists: false, number: DEMO_NUMBER });
    expect(await count('households')).toBe(0);
    expect(await count('phones')).toBe(0);
    expect((await op.get('/api/state')).status).toBe(401);
    // deleting when there is none is harmless
    expect((await op.del('/api/admin/demo')).status).toBe(200);
  });

  it('deleting it leaves every other account alone', async () => {
    const op = await site();
    const member = await account(HUSBAND);
    await member.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day' });
    await openDemo(op);
    expect(await count('households')).toBe(2);
    await op.del('/api/admin/demo');
    expect(await count('households')).toBe(1);
    expect((await member.state()).entries).toHaveLength(1);
  });

  it('a simulated text is answered exactly as a real one would be, and nothing is sent', async () => {
    const c = await openDemo(await site({ sms: false }));
    const status = await demoText(c, '9');
    expect(status).toMatch(/^Clean day 5 of 7\. Mikvah /);
    let s = await c.state();
    expect(s.messages.slice(0, 2).map((m: any) => [m.direction, m.phone, m.body, m.status])).toEqual([
      ['out', '0100', status, 'simulated'],
      ['in', '0100', '9', 'simulated'],
    ]);
    expect(await demoText(c, '?')).toMatch(/^1 flow began, 2 hefsek done/);
    expect(await demoText(c, 'HELP')).toBe(HELP_REPLY);
    expect(await demoText(c, 'what?')).toMatch(/^Not understood; nothing was changed\./);

    // STOP and START: the carrier would confirm them, so the site's reply is null
    const stopped = await c.post('/api/demo/text', { text: 'STOP' });
    expect(stopped.json.reply).toBeNull();
    expect(stopped.json.state.phones[0]).toMatchObject({ number: DEMO_NUMBER, optedOut: true });
    expect(await demoText(c, '9')).toBeNull(); // not acted on while opted out
    expect(await demoText(c, 'START')).toBe(START_REPLY);
    expect((await c.state()).phones[0].optedOut).toBe(false);

    // commands change the account, and the reply comes with the new picture
    expect(await demoText(c, '0')).toBe('Nothing recent to undo. Older entries can be erased by text: send HISTORY. Or remove them on the website.');
    const flow = await c.post('/api/demo/text', { text: '1' });
    expect(flow.json.reply).toBe('Recorded: flow Mon Nov 23 by day. The count is cancelled; a new hefsek is needed. 0 to undo.');
    expect(flow.json.state.entryCount).toBe(15);
    expect(flow.json.state.entries[0]).toMatchObject({ kind: 'flow', source: 'sms' });
    expect(flow.json.state.status.headline).toBe('Niddah, before the hefsek taharah');
    const undo = await c.post('/api/demo/text', { text: '0' });
    expect(undo.json.reply).toMatch(/^Removed: flow Mon Nov 23 by day\. Clean day 5 of 7\./);
    expect(undo.json.state.entryCount).toBe(14);

    // a phone that may not record by text is told so
    await c.put('/api/phones', { number: DEMO_NUMBER, name: 'Test phone', canUpdate: false, reminders: [], texts: true });
    expect(await demoText(c, '1')).toBe('This phone may not record entries. That is changed on the website, under Settings.');
    s = await c.state();
    expect(s.entryCount).toBe(14);
    expect(s.messages[1]).toMatchObject({ direction: 'in', body: '1', status: 'simulated' });

    for (const bad of [{ text: '' }, { text: '   ' }, { text: 'x'.repeat(321) }, { text: 9 }, {}]) expect((await c.post('/api/demo/text', bad)).status, JSON.stringify(bad)).toBe(400);
    expect((await c.post('/api/demo/text', { text: '9' }, { header: false })).status).toBe(400);
    await nothingSent();
  });

  it('only the test account can send a simulated text', async () => {
    await site();
    const member = await account(HUSBAND);
    const r = await member.post('/api/demo/text', { text: '1' });
    expect(r.status).toBe(403);
    expect((await member.state()).entries).toEqual([]);
    expect((await new Client().post('/api/demo/text', { text: '1' })).status).toBe(401);
    expect(textsTo(HUSBAND).filter(t => !t.startsWith('Betaharah code'))).toEqual([]);
  });

  it('its reminders arrive in its messages, before texting is set up', async () => {
    const c = await openDemo(await site({ sms: false }));
    const next = (await c.state()).reminders[0];
    world.clock.now = next.at + MINUTE;
    await tick(env, world.deps);
    const arrived = (await c.state()).messages.filter((m: any) => m.direction === 'out' && m.body === next.text);
    expect(arrived.map((m: any) => [m.phone, m.status]).sort()).toEqual([
      ['0100', 'simulated'],
      ['0199', 'simulated'],
    ]);
    expect((await queue()).filter(q => q.status === 'sent')).toHaveLength(2);
    // once only
    world.clock.now += MINUTE;
    await tick(env, world.deps);
    expect((await c.state()).messages.filter((m: any) => m.body === next.text)).toHaveLength(2);
    await nothingSent();
  });

  it('its reminders are simulated also once texting is set up, while a real account\'s are sent', async () => {
    const op = await site();
    const member = await account(HUSBAND);
    await textsOn(member, HUSBAND, ['bedikah_afternoon']);
    // the member's hefsek on the same day as the test account's, so that both have the same reminders
    await member.post('/api/entries', { kind: 'flow', date: '2026-11-14', part: 'day' });
    world.clock.now = at(11, 18, 16);
    await member.post('/api/entries', { kind: 'hefsek', when: 'now' });
    world.clock.now = START;
    const before = world.telnyx.sent.length;
    const c = await openDemo(op);
    const next = (await c.state()).reminders.find((r: any) => r.kind === 'bedikah_afternoon');
    world.clock.now = next.at + MINUTE;
    await tick(env, world.deps);
    expect(world.telnyx.sent.slice(before).map(t => t.to)).toEqual([HUSBAND]);
    expect((await c.state()).messages.filter((m: any) => m.body === next.text && m.status === 'simulated')).toHaveLength(2);
  });

  it('adding a phone shows the code on the page instead of texting it', async () => {
    const c = await openDemo(await site({ sms: false }));
    const real = await c.post('/api/phones/code', { number: '+17324440150' });
    expect(real.status).toBe(400);
    expect(real.json.error).toContain('555-0100 to 555-0199');
    const asked = await c.post('/api/phones/code', { number: '(732) 555-0150' });
    expect(asked.status).toBe(200);
    expect(asked.json).toEqual({ ok: true, number: '+17325550150', demoCode: expect.stringMatching(/^\d{6}$/) });
    const code = asked.json.demoCode as string;
    expect((await c.state()).messages[0]).toMatchObject({ direction: 'out', phone: '0150', body: codeText(code), status: 'simulated' });
    // the limits on codes for a number still apply
    expect((await c.post('/api/phones/code', { number: '+17325550150' })).status).toBe(429);
    expect((await c.post('/api/phones/verify', { number: '+17325550150', code: code === '000000' ? '000001' : '000000' })).status).toBe(400);
    const added = await c.post('/api/phones/verify', { number: '+17325550150', code });
    expect(added.status).toBe(200);
    expect(added.json.state.phones.map((p: any) => [p.number, p.verified, p.texts])).toEqual([
      [DEMO_NUMBER, true, true],
      [DEMO_SPOUSE, true, true],
      ['+17325550150', true, false],
    ]);

    // turning reminders on, and a test text: both simulated
    await textsOn(c, '+17325550150', ['mikvah']);
    expect((await c.state()).messages[0]).toMatchObject({ direction: 'out', phone: '0150', body: REMINDERS_ON_TEXT, status: 'simulated' });
    const tested = await c.post('/api/phones/test', { number: '+17325550150' });
    expect(tested.status).toBe(200);
    expect(tested.json.state.messages[0]).toMatchObject({ direction: 'out', phone: '0150', body: TEST_TEXT, status: 'simulated' });
    expect(tested.json.state.sms.usedThisMonth).toBeGreaterThanOrEqual(2);
    await nothingSent();
  });

  it('a regular account cannot add a made-up number, and never sees a code', async () => {
    await site();
    const member = await account(HUSBAND);
    world.clock.now += 2 * MINUTE;
    const fictional = await member.post('/api/phones/code', { number: '+17325550150' });
    expect(fictional.status).toBe(400);
    expect(fictional.json.error).toContain('reserved for fiction');
    expect(textsTo('+17325550150')).toEqual([]);
    const real = await member.post('/api/phones/code', { number: WIFE });
    expect(real.json).toEqual({ ok: true, number: WIFE });
    expect(textsTo(WIFE)).toHaveLength(1);
  });

  it('made-up numbers are never texted by sign-in, invitations or the test text, and never get an account by code', async () => {
    const op = await site();
    await openDemo(op);
    for (const number of [DEMO_NUMBER, DEMO_SPOUSE, '(212) 555-0142']) {
      const c = new Client(`203.0.113.${number.length}`);
      const asked = await c.post('/api/auth/code', { number });
      expect(asked.status, number).toBe(200);
      expect(asked.json).toEqual({ ok: true });
      for (const code of ['000000', '123456']) expect((await c.post('/api/auth/verify', { number, code })).status).toBe(400);
      expect(c.cookies.has('bt_session')).toBe(false);
    }
    expect(await count('households')).toBe(1); // only the test account

    const invite = await op.post('/api/admin/invites', { kind: 'setup', number: '(732) 555-0142' });
    expect(invite.status).toBe(400);
    expect(invite.json.error).toContain('reserved for fiction');
    const test = await op.post('/api/admin/test-text', { to: DEMO_NUMBER });
    expect(test.status).toBe(400);
    expect(test.json.error).toContain('reserved for fiction');
    expect(world.telnyx.sent).toEqual([]);
  });

  it('a password set inside the test account signs in to it', async () => {
    const c = await openDemo(await site({ sms: false }));
    expect((await c.put('/api/password', { password: 'a good long password' })).status).toBe(200);
    const again = new Client('203.0.113.90');
    expect((await again.post('/api/auth/password', { number: '(732) 555-0100', password: 'a good long password' })).status).toBe(200);
    const s = await again.state();
    expect(s.demo).toBe(true);
    expect(s.account).toMatchObject({ number: DEMO_NUMBER, hasPassword: true });
  });

  it('the test phone stays on it; other phones can be removed, and the account can be deleted from inside', async () => {
    const op = await site({ sms: false });
    const c = await openDemo(op);
    const kept = await c.post('/api/phones/remove', { number: DEMO_NUMBER });
    expect(kept.status).toBe(400);
    expect(kept.json.error).toContain('test phone stays');
    const removed = await c.post('/api/phones/remove', { number: DEMO_SPOUSE });
    expect(removed.status).toBe(200);
    expect(removed.json.state.phones.map((p: any) => p.number)).toEqual([DEMO_NUMBER]);
    expect((await c.post('/api/account/delete', { confirm: 'DELETE' })).status).toBe(200);
    expect((await op.get('/api/admin/state')).json.demo.exists).toBe(false);
  });

  it('a regular account\'s data says it is not the test account, and texts to it are really sent', async () => {
    await site();
    const member = await account(HUSBAND);
    const s = await member.state();
    expect(s.demo).toBe(false);
    expect(s.sms).toMatchObject({ ready: true, simulated: false, number: OUR_NUMBER });
    await text(HUSBAND, '9', 'ev-real');
    expect(textsTo(HUSBAND).at(-1)).toBe('Tehorah.');
    expect((await member.state()).messages.map((m: any) => m.status)).toEqual(['sent', 'received']);
  });
});

describe('the guided first steps', () => {
  const welcomedAt = async (): Promise<number | null> => {
    const row = await testDb.db.prepare('SELECT id FROM households').first<{ id: string }>();
    return (await loadHousehold(env, row!.id))!.data.welcomedAt;
  };

  it('are marked as seen once, for the whole account', async () => {
    await site();
    const c = await signIn(HUSBAND);
    expect((await c.state()).account.welcomed).toBe(false);
    expect(await welcomedAt()).toBeNull();
    expect((await c.post('/api/welcome', {}, { header: false })).status).toBe(400);
    expect((await new Client().post('/api/welcome')).status).toBe(401);
    const r = await c.post('/api/welcome');
    expect(r.status).toBe(200);
    expect(r.json.state.account.welcomed).toBe(true);
    expect(await welcomedAt()).toBe(START);
    world.clock.now += HOUR;
    await c.post('/api/welcome');
    expect(await welcomedAt()).toBe(START);
    // a second phone of the account sees it as done too
    await addPhone(c, WIFE);
    world.clock.now += 2 * MINUTE;
    expect((await (await signIn(WIFE, new Client('203.0.113.8'))).state()).account.welcomed).toBe(true);
  });
});

describe('the month calendar on the dashboard', () => {
  beforeEach(async () => {
    await site();
  });
  const day = (grid: any, date: string): any => grid.days.find((d: any) => d.date === date);

  it('is empty until a location is chosen', async () => {
    const c = await signIn(HUSBAND);
    expect((await c.state()).grid).toBeNull();
  });

  it('has every civil day from 62 days before today to 124 after, with its Hebrew date, rest days and sun times', async () => {
    const c = await account(HUSBAND);
    const { grid } = await c.state();
    expect(Object.keys(grid).sort()).toEqual(['days', 'events', 'today']);
    expect(grid.today).toBe('2026-11-23');
    expect(grid.days).toHaveLength(187);
    expect(grid.days[0].date).toBe('2026-09-22');
    expect(grid.days[62].date).toBe('2026-11-23');
    expect(grid.days[186].date).toBe('2027-03-27');
    // consecutive dates
    for (let i = 1; i < grid.days.length; i++) {
      expect(Date.parse(`${grid.days[i].date}T00:00:00Z`) - Date.parse(`${grid.days[i - 1].date}T00:00:00Z`)).toBe(DAY);
    }
    expect(grid.days[62]).toEqual({ date: '2026-11-23', hebrewDay: '13', hebrewMonth: 'Kislev', monthStart: false, rest: false, sunrise: expect.any(String), sunset: expect.any(String) });
    expect(grid.days[0]).toMatchObject({ hebrewDay: '11', hebrewMonth: 'Tishrei' });
    expect(grid.days[186]).toMatchObject({ hebrewDay: '18', hebrewMonth: 'Adar II', rest: true }); // a Shabbat
    // the 1st of each month, and the two Adars of a leap year
    expect(grid.days.filter((d: any) => d.monthStart).map((d: any) => `${d.date} ${d.hebrewMonth}`)).toEqual([
      '2026-10-12 Cheshvan',
      '2026-11-11 Kislev',
      '2026-12-11 Tevet',
      '2027-01-09 Shevat',
      '2027-02-08 Adar I',
      '2027-03-10 Adar II',
    ]);
    expect(day(grid, '2026-12-10')).toMatchObject({ hebrewDay: '30', hebrewMonth: 'Kislev', monthStart: false });
    // Shabbat and Yom Tov (two days in the diaspora)
    expect(day(grid, '2026-11-27').rest).toBe(false); // Friday
    expect(day(grid, '2026-11-28').rest).toBe(true); // Shabbat
    expect(day(grid, '2026-09-26').rest).toBe(true); // 15 Tishrei, Shabbat and Sukkot
    expect(day(grid, '2026-09-27').rest).toBe(true); // 16 Tishrei, a Sunday: the second day of Sukkot
    expect(day(grid, '2026-10-04').rest).toBe(true); // 23 Tishrei, a Sunday: Simchat Torah
    expect(day(grid, '2026-09-28').rest).toBe(false); // Chol Hamoed
    expect(grid.days.filter((d: any) => d.rest).length).toBe(27 + 2); // the 27 Shabbatot, and the two Yom Tov days that are not on Shabbat
    // sun times as the rest of the site rounds them: sunrise up, sunset down
    expect(day(grid, '2026-11-26').sunset).toBe('4:33 PM');
    const where = { latitude: LAKEWOOD.latitude, longitude: LAKEWOOD.longitude, timeZone: LAKEWOOD.timeZone, elevation: LAKEWOOD.elevation };
    const first = civilToAbs({ y: 2026, m: 9, d: 22 });
    grid.days.forEach((d: any, i: number) => {
      expect(d.sunrise).toBe(clock12(sunriseMs(first + i, where)!, TZ, 'ceil'));
      expect(d.sunset).toBe(clock12(sunsetMs(first + i, where)!, TZ, 'floor'));
    });
    expect(grid.events).toEqual([]); // nothing recorded yet
  });

  it('in Israel, the second day of Yom Tov is an ordinary day', async () => {
    const c = await account(HUSBAND);
    expect((await c.put('/api/halachic', { ...BASIC, yomTov: 'israel' })).status).toBe(200);
    const { grid } = await c.state();
    expect(day(grid, '2026-09-27').rest).toBe(false);
    expect(day(grid, '2026-10-03').rest).toBe(true); // 22 Tishrei, Shabbat and Shemini Atzeret
    expect(day(grid, '2026-10-04').rest).toBe(false);
  });

  it('writes the Hebrew date in Hebrew when the terms are Hebrew', async () => {
    const c = await account(HUSBAND);
    expect((await c.put('/api/app', appSettings({ terms: 'he' }))).status).toBe(200);
    const { grid } = await c.state();
    expect(day(grid, '2026-11-23')).toMatchObject({ hebrewDay: 'י״ג', hebrewMonth: 'כסלו' });
    expect(day(grid, '2026-12-11')).toMatchObject({ hebrewDay: 'א׳', hebrewMonth: 'טבת', monthStart: true });
    expect(day(grid, '2026-09-26')).toMatchObject({ hebrewDay: 'ט״ו', hebrewMonth: 'תשרי' });
    expect(day(grid, '2027-02-08')).toMatchObject({ hebrewDay: 'א׳', hebrewMonth: 'אדר א׳' });
    expect(day(grid, '2027-03-27')).toMatchObject({ hebrewDay: 'י״ח', hebrewMonth: 'אדר ב׳' });
  });

  it('has the calendar\'s events that touch those days, in order, with their civil dates and times', async () => {
    const c = await account(HUSBAND);
    // a flow on the night that began on the evening of Sunday 22 November
    expect((await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'night' })).status).toBe(200);
    const s = await c.state();
    const { grid } = s;
    expect(grid.events.length).toBeGreaterThan(8);
    for (const e of grid.events) {
      expect(Object.keys(e).sort()).toEqual(['allDay', 'description', 'end', 'endDate', 'key', 'kind', 'light', 'projected', 'start', 'startDate', 'title']);
      expect(e.startDate >= '2026-09-22' || e.endDate >= '2026-09-22').toBe(true);
      expect(e.startDate <= '2027-03-27').toBe(true);
      expect(e.endDate >= e.startDate).toBe(true);
    }
    // in order of start
    const starts = grid.events.map((e: any) => e.startDate);
    expect([...starts].sort()).toEqual(starts);

    const flow = grid.events.find((e: any) => e.kind === 'flow');
    expect(flow).toMatchObject({ title: 'Flow (night)', allDay: false, projected: false, light: false, startDate: '2026-11-22', endDate: '2026-11-23' });
    expect(flow.start).toMatch(/^4:\d\d PM$/);
    expect(flow.end).toMatch(/^6:\d\d AM$/);
    expect(flow.description).toContain('Sunday evening, Nov 22, 2026');

    // a clean day is all-day: it starts and ends on the same date, with no times
    const clean = grid.events.find((e: any) => e.kind === 'clean_day');
    expect(clean).toMatchObject({ allDay: true, start: null, end: null, projected: true });
    expect(clean.endDate).toBe(clean.startDate);
    expect(clean.title).toMatch(/^Seven clean days: day 1 \(projected\)$/);

    // an onah at night begins on one civil date and ends on the next
    const night = grid.events.find((e: any) => e.kind === 'onah' && e.title.endsWith('(night)'));
    expect(night).toBeDefined();
    expect(night.allDay).toBe(false);
    expect(night.endDate > night.startDate).toBe(true);
    expect(night.start).toMatch(/PM$/);
    expect(night.end).toMatch(/AM$/);
    expect(night.description).toContain('Separation');

    // the same events, times and titles as the list of what is coming
    for (const u of s.upcoming) {
      const e = grid.events.find((x: any) => x.key === u.key);
      expect(e, u.key).toBeDefined();
      expect(e.title).toBe(u.title);
      expect(e.description).toBe(u.description);
    }
  });

  it('is in words, with full descriptions, also when the calendar style is discreet', async () => {
    const c = await account(HUSBAND);
    expect((await c.put('/api/app', appSettings({ calendar: { ...DEFAULT_APP_SETTINGS.calendar, style: 'discreet' } }))).status).toBe(200);
    expect((await c.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'night' })).status).toBe(200);
    const s = await c.state();
    // the calendar itself is discreet
    expect(s.upcoming.find((u: any) => u.kind === 'clean_day').title).toBe('1/7 ?');
    expect(s.grid.events.find((e: any) => e.kind === 'clean_day').title).toBe('Seven clean days: day 1 (projected)');
    const flow = s.grid.events.find((e: any) => e.kind === 'flow');
    expect(flow.title).toBe('Flow (night)');
    expect(flow.description).not.toBe('');
    for (const e of s.grid.events) {
      expect(e.title).not.toMatch(/^[•◆◇]|^\d\/7|^[HM] /);
      expect(e.description.length).toBeGreaterThan(0);
    }
    // in the household's form of the terms
    expect((await c.put('/api/app', appSettings({ terms: 'he', calendar: { ...DEFAULT_APP_SETTINGS.calendar, style: 'discreet' } }))).status).toBe(200);
    expect((await c.state()).grid.events.find((e: any) => e.kind === 'flow').title).toBe('ראייה (night)');
  });
});

describe('Sign in with Google', () => {
  async function googleSignIn(client = new Client(), expectedLocation = '/app/'): Promise<Client> {
    const start = await client.get('/api/auth/google/start');
    expect(start.status).toBe(302);
    const u = new URL(start.res.headers.get('location') as string);
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('access_type')).toBeNull();
    expect(u.searchParams.get('redirect_uri')).toBe('https://cal.example/api/auth/google/callback');
    const state = u.searchParams.get('state') as string;
    const back = await client.get(`/api/auth/google/callback?code=login-code&state=${encodeURIComponent(state)}`);
    expect(back.status).toBe(302);
    expect(back.res.headers.get('location')).toBe(expectedLocation);
    expect(client.cookies.has('bt_session')).toBe(true);
    return client;
  }

  it('creates an account from a verified Google email and signs in again as the same account', async () => {
    await site({ sms: false, google: true });
    expect((await new Client().get('/api/public')).json.google).toBe(true);
    const first = await googleSignIn();
    const state = await first.state();
    expect(state.account).toEqual({ number: null, method: 'google', hasPassword: false, googleEmail: 'ada@example.com', fresh: true, welcomed: false });
    expect(state.phones).toEqual([]);
    const id = (await testDb.db.prepare('SELECT id FROM households').first<{ id: string }>())!.id;
    first.cookies.clear();
    const again = await googleSignIn(new Client('203.0.113.50'));
    expect((await again.state()).account.googleEmail).toBe('ada@example.com');
    expect(await count('households')).toBe(1);
    expect((await loadHousehold(env, id))!.data.googleLogin).toEqual({ email: 'ada@example.com', name: 'Ada' });
    const stored = await testDb.db.prepare('SELECT hash FROM google_ids').all<{ hash: string }>();
    expect(JSON.stringify(stored)).not.toContain('ada@example.com');
    expect(JSON.stringify(stored)).not.toContain('google-sub-1');
    // the email is inside the encrypted document, not readable in the database
    expect((await dump()).includes('ada@example.com')).toBe(false);
  });

  it('does not ask for a calendar refresh token, and a closed sign-up refuses a new Google account', async () => {
    await site({ sms: false, google: true, config: { signup: 'closed' } });
    const start = await new Client().get('/api/auth/google/start');
    const state = new URL(start.res.headers.get('location') as string).searchParams.get('state') as string;
    const back = await new Client().get(`/api/auth/google/callback?code=login-code&state=${encodeURIComponent(state)}`);
    expect(back.res.headers.get('location')).toContain('google_error=');
    expect(await count('households')).toBe(0);
  });

  it('is not offered until the operator has saved the Google keys', async () => {
    await site({ sms: false });
    expect((await new Client().get('/api/public')).json.google).toBe(false);
    const start = await new Client().get('/api/auth/google/start');
    expect(start.status).toBe(302);
    expect(start.res.headers.get('location')).toContain('/app/?google_error=');
  });

  it('a phone account can add Google sign-in; then either way opens the same account, and the last phone may be removed', async () => {
    await site({ google: true });
    const member = await account(HUSBAND);
    await member.post('/api/entries', { kind: 'flow', date: '2026-11-22', part: 'day' });
    await googleSignIn(member, '/app/?google=signed-in#settings');
    expect(await count('households')).toBe(1);
    const s = await member.state();
    expect(s.account).toMatchObject({ method: 'google', googleEmail: 'ada@example.com', number: null });
    expect(s.phones.map((p: any) => p.number)).toEqual([HUSBAND]);
    expect(s.entries).toHaveLength(1);
    // from another browser, Google opens the same account
    const other = await googleSignIn(new Client('203.0.113.51'));
    expect((await other.state()).entries).toHaveLength(1);
    // a password belongs to a phone number, so a Google session cannot set one
    expect((await other.put('/api/password', { password: 'a long enough password' })).status).toBe(400);
    // Google is another way in, so the only phone may now be removed
    const removed = await other.post('/api/phones/remove', { number: HUSBAND });
    expect(removed.status, JSON.stringify(removed.json)).toBe(200);
    expect((await other.state()).phones).toEqual([]);
    expect(await count('phones')).toBe(0);
  });

  it('an account made with Google can add a phone, which can then sign in to the same account', async () => {
    await site({ google: true });
    const c = await googleSignIn();
    await addPhone(c, HUSBAND);
    const s = await c.state();
    expect(s.phones.map((p: any) => [p.number, p.verified, p.me])).toEqual([[HUSBAND, true, false]]);
    expect(s.account).toMatchObject({ number: null, method: 'google', googleEmail: 'ada@example.com' });
    world.clock.now += 2 * MINUTE; // a code for the same number may be asked for once a minute
    const byPhone = await signIn(HUSBAND, new Client('203.0.113.52'));
    expect((await byPhone.state()).account).toMatchObject({ number: HUSBAND, method: 'code', googleEmail: 'ada@example.com' });
    expect(await count('households')).toBe(1);
    // sign out everywhere in the Google session ends it, and leaves the phone's session alone
    expect((await c.post('/api/auth/logout-all', {})).status).toBe(200);
    expect((await c.get('/api/state')).status).toBe(401);
    expect((await byPhone.get('/api/state')).status).toBe(200);
  });

  it('deleting the account removes the Google sign-in with it', async () => {
    await site({ sms: false, google: true });
    const c = await googleSignIn();
    expect(await count('google_ids')).toBe(1);
    const gone = await c.post('/api/account/delete', { confirm: 'DELETE' });
    expect(gone.status, JSON.stringify(gone.json)).toBe(200);
    expect(await count('households')).toBe(0);
    expect(await count('google_ids')).toBe(0);
  });
});
