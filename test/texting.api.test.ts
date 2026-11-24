/**
 * Betaharah by text message alone, end to end: the real webhook (SMS and
 * RCS), the conversation engine, sign-up by text and its limits, adding a
 * phone with a code, the sign-in link, the operator's simulator, and what
 * is readable in the database. Against a real local database, with
 * stand-ins for Telnyx (both its SMS and its RCS endpoint) and Google.
 *
 * One rule is checked after every test here: no text ever goes to a number
 * that has not texted the site (or asked for a sign-in code itself).
 */
import type { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { compose, NO_TEXTS, type Piece } from '../src/app/chat/site-texts';
import {
  simulateText,
  STRANGER_REPLIES_PER_DAY,
  KEYWORD_REPLIES_PER_NUMBER,
  STRANGER_REPLIES_PER_NUMBER,
  TEXT_SIGNUPS_PER_DAY,
} from '../src/app/conversation';
import type { Env } from '../src/app/env';
import { createApp } from '../src/app/index';
import { DEFAULT_SITE_CONFIG as SHIPPED_SITE_CONFIG, type HouseholdData, type SiteConfig } from '../src/app/model';
import { TABLES } from '../src/app/schema';
import { HELP_REPLY, START_REPLY, tick } from '../src/app/service';
import { DEFAULT_APP_SETTINGS, PLACES } from '../src/app/settings';
import { createInvitationWord, getPhone, loadHousehold, loadSite, phoneHash } from '../src/app/store';
import { nearestPostal } from '../src/app/zip';
import { localToInstant } from '../src/engine/civil';
import { BASIC } from './helpers';

/** A text as the site sends it by SMS in the shipped wording: messages of the registry joined, with the options of the last. */
const tx = (...pieces: Array<Piece | string>): string => compose(NO_TEXTS, pieces.map(p => (typeof p === 'string' ? { key: p } : p)))[0]!.text;
/** The same text as an RCS phone shows it: the words alone, above the buttons. */
const rcsBody = (...pieces: Array<Piece | string>): string => compose(NO_TEXTS, pieces.map(p => (typeof p === 'string' ? { key: p } : p)))[0]!.body;
const WELCOME_OPEN = tx('signup.welcome');
const SETUP_START = tx('setup.start');
const SETUP_DONE = tx('setup.done');
const BAD_INVITATION = tx('signup.bad_word');
const ALREADY_ON_ACCOUNT = tx('join.other_account');
const JOINED = tx({ key: 'setup.joined', vars: { others: ' with the phone ending 0102' } });
const WEB_TEXT = 'Betaharah sign-in link for this phone. It works once, within 10 minutes: ';
/** The secret of the sign-in link in the text sent for WEB LINK. */
const tokenIn = (t: string): string => new URL(t.slice(WEB_TEXT.length).split('\n')[0]!).searchParams.get('k')!;
import { makeEnv, makeWorld, MESSAGING_PROFILE, RCS_AGENT, startDb, TEST_PASSWORD, type TestDb, type World } from './fakes';

// Sign-up by text ships switched off (the toll-free filing describes opting in on the website);
// these tests are about it, so they run with it on unless a test turns it off.
const DEFAULT_SITE_CONFIG: SiteConfig = { ...SHIPPED_SITE_CONFIG, textSignup: true };

const TZ = 'America/New_York';
const at = (m: number, d: number, hh: number, mi = 0): number => localToInstant({ y: 2026, m, d, hh, mi, ss: 0 }, TZ);
const START = at(11, 23, 10); // Monday 23 November 2026, 10:00
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WIFE = '+17324440102';
const HUSBAND = '+17324440101';
const OTHER = '+17324440199';
const FOURTH = '+17324440104';
const OUR_NUMBER = '+18885550100';
const FICTIONAL = '+17325550142';

let testDb: TestDb;
let world: World;
let env: Env;
let app: Hono<any>;
/** Every number that texted the site or asked for a code: the only numbers anything may be sent to. */
let hasWritten: Set<string>;
let eventNo = 0;

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
  hasWritten = new Set();
});
afterEach(() => {
  // No reply ever goes to a number that has not texted us.
  for (const s of world.telnyx.sent) expect(hasWritten.has(s.to), `a text went to ${s.to}, which never wrote`).toBe(true);
  expect(world.telnyx.problems).toEqual([]);
  expect(world.unexpected).toEqual([]);
});

interface Result {
  status: number;
  json: any;
  res: Response;
}

class Client {
  cookies = new Map<string, string>();
  constructor(readonly address = '203.0.113.1') {}
  async call(method: string, path: string, body?: unknown, opts: { header?: boolean; headers?: Record<string, string>; raw?: string } = {}): Promise<Result> {
    const headers: Record<string, string> = { 'cf-connecting-ip': this.address, ...(opts.headers ?? {}) };
    if (opts.header !== false) headers['x-betaharah'] = '1';
    if (this.cookies.size > 0) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let payload: string | undefined;
    if (opts.raw !== undefined) payload = opts.raw;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['content-type'] = 'application/json';
    }
    const res = await app.request(`https://cal.example${path}`, { method, headers, body: payload }, env);
    const set = res.headers.get('set-cookie');
    if (set) {
      const [pair] = set.split(';') as [string];
      const eq = pair.indexOf('=');
      if (pair.slice(eq + 1) === '' || /Max-Age=0/.test(set)) this.cookies.delete(pair.slice(0, eq));
      else this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, res };
  }
  get = (path: string) => this.call('GET', path);
  post = (path: string, body: unknown = {}, opts?: { header?: boolean }) => this.call('POST', path, body, opts);
  put = (path: string, body: unknown) => this.call('PUT', path, body);
}

async function operator(): Promise<Client> {
  const c = new Client('198.51.100.9');
  expect((await c.post('/api/admin/login', { password: TEST_PASSWORD })).status).toBe(200);
  return c;
}

async function site(options: { rcs?: boolean; google?: boolean; config?: Partial<SiteConfig> } = {}): Promise<Client> {
  const op = await operator();
  expect((await op.put('/api/admin/secrets', { telnyxApiKey: 'telnyx-key', telnyxPublicKey: world.telnyx.publicKey, telnyxNumber: OUR_NUMBER })).status).toBe(200);
  if (options.rcs) expect((await op.put('/api/admin/secrets', { telnyxMessagingProfileId: MESSAGING_PROFILE, rcsAgentId: RCS_AGENT })).status).toBe(200);
  if (options.google) expect((await op.put('/api/admin/secrets', { googleClientId: 'client-id', googleClientSecret: 'client-secret' })).status).toBe(200);
  const config = { ...DEFAULT_SITE_CONFIG, rcsEnabled: options.rcs === true, ...options.config };
  expect((await op.put('/api/admin/config', config)).status).toBe(200);
  return op;
}

async function config(patch: Partial<SiteConfig>): Promise<void> {
  const op = await operator();
  const current = (await loadSite(env)).config;
  expect((await op.put('/api/admin/config', { ...current, ...patch })).status).toBe(200);
}

/** Sends an SMS from a phone to the site, through the real webhook; returns the texts sent back to it. */
async function sms(from: string, body: string, extra: { to?: string; eventId?: string; autoresponseType?: string } = {}): Promise<string[]> {
  hasWritten.add(from);
  const before = world.telnyx.sent.length;
  const req = await world.telnyx.inbound({ from, to: extra.to ?? OUR_NUMBER, text: body, eventId: extra.eventId ?? `ev${++eventNo}`, nowMs: world.clock.now, autoresponseType: extra.autoresponseType });
  const r = await new Client().call('POST', '/webhooks/telnyx', undefined, { raw: req.body, headers: req.headers, header: false });
  expect(r.status).toBe(200);
  world.clock.now += 10_000;
  return world.telnyx.sent.slice(before).filter(s => s.to === from).map(s => s.text);
}

type RcsBody = Parameters<World['telnyx']['inboundRcs']>[0]['body'];

/** Sends an RCS message from a phone to the site's agent, through the real webhook; returns what was sent back. */
async function rcs(from: string, body: RcsBody, extra: { agentId?: string; eventId?: string } = {}): Promise<Array<{ text: string; suggestions?: string[]; endpoint: string; delivered: string }>> {
  hasWritten.add(from);
  const before = world.telnyx.sent.length;
  const req = await world.telnyx.inboundRcs({ from, agentId: extra.agentId ?? RCS_AGENT, eventId: extra.eventId ?? `rcs${++eventNo}`, nowMs: world.clock.now, body });
  const r = await new Client().call('POST', '/webhooks/telnyx', undefined, { raw: req.body, headers: req.headers, header: false });
  expect(r.status).toBe(200);
  world.clock.now += 10_000;
  return world.telnyx.sent
    .slice(before)
    .filter(s => s.to === from)
    .map(s => ({ text: s.text, suggestions: s.suggestions?.map(x => `${x.reply.text}=${x.reply.postback_data}`), endpoint: s.endpoint, delivered: s.delivered }));
}
const tap = (send: string, label = send) => ({ suggestion_response: { postback_data: send, text: label } });

async function householdOf(number: string): Promise<{ id: string; data: HouseholdData } | null> {
  const row = await getPhone(env.DB, await phoneHash(env, number));
  if (!row) return null;
  const h = await loadHousehold(env, row.household_id);
  return h ? { id: h.id, data: h.data } : null;
}

const count = async (table: string, where = '1=1'): Promise<number> =>
  ((await testDb.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).first<{ n: number }>()) as { n: number }).n;

async function dump(): Promise<string> {
  let out = '';
  for (const table of TABLES) {
    const { results } = await testDb.db.prepare(`SELECT * FROM ${table}`).all();
    out += `${table}: ${JSON.stringify(results)}\n`;
  }
  return out;
}

const codeIn = (text: string): string => {
  const m = /JOIN ([A-Z]{8}) /.exec(text);
  if (!m) throw new Error('no code in the text');
  return m[1] as string;
};

/** A website account (signed in with a texted code), with a location and customs saved. */
async function webAccount(number: string, client = new Client()): Promise<Client> {
  hasWritten.add(number);
  expect((await client.post('/api/auth/code', { number })).status).toBe(200);
  const text = world.telnyx.sent.filter(s => s.to === number).at(-1)!.text;
  const code = /code: (\d{6})\./.exec(text)![1];
  expect((await client.post('/api/auth/verify', { number, code })).status).toBe(200);
  expect((await client.put('/api/app', { ...DEFAULT_APP_SETTINGS, place: PLACES[0] })).status).toBe(200);
  expect((await client.put('/api/halachic', BASIC)).status).toBe(200);
  return client;
}

/** An account made by text: JOIN, a ZIP code, customs kept, setup skipped. */
async function textAccount(number: string): Promise<void> {
  expect(await sms(number, 'JOIN')).toEqual([SETUP_START]);
  expect((await sms(number, '08701'))[0]).toMatch(/^Location set: Lakewood, NJ 08701\./);
  await sms(number, 'KEEP FOR NOW');
  expect(await sms(number, 'SKIP')).toEqual([SETUP_DONE]);
}

// ---------------------------------------------------------------------------

describe('the whole life of an account, by text message alone', () => {
  it('from a stranger\'s first text to a deleted account, through the real webhook', async () => {
    await site({ google: true });

    // A stranger texts the number: one reply, with the compliance wording.
    expect(await sms(WIFE, 'Hi, what is this?')).toEqual([WELCOME_OPEN]);
    expect(await count('households')).toBe(0);

    // JOIN: the account is created with this phone, verified; reminders are not on; setup starts.
    expect(await sms(WIFE, 'JOIN')).toEqual([SETUP_START]);
    let h = (await householdOf(WIFE))!;
    expect(h.data.phones).toEqual([expect.objectContaining({ number: WIFE, canUpdate: true, consentAt: null, optedOut: false })]);
    expect(h.data.phones[0]!.verifiedAt).toBe(START + 10_000);
    expect(h.data.welcomedAt).toBeNull();
    expect(h.data.demo).toBe(false);
    expect(h.data.chat?.[WIFE]).toMatchObject({ key: 'setup.start', expect: 'zip', ctx: { setup: true } });

    // Step 1: the ZIP code.
    expect(await sms(WIFE, '99999')).toEqual([tx({ key: 'location.unknown', vars: { code: '99999' }, offer: ['skip_place', 'web', 'menu'] })]);
    expect(await sms(WIFE, '08701')).toEqual([tx({ key: 'location.set', vars: { place: 'Lakewood, NJ 08701' } }, 'setup.customs')]);
    h = (await householdOf(WIFE))!;
    expect(h.data.app.place).toMatchObject({ name: 'Lakewood, NJ 08701', timeZone: TZ });

    // Step 2: keep the customs.
    expect(await sms(WIFE, 'KEEP FOR NOW')).toEqual([tx('setup.recent')]);

    // Step 3: dated entries.
    const flow = await sms(WIFE, 'Nov 19 day');
    expect(flow).toHaveLength(1);
    expect(flow[0]).toBe('Recorded: flow Thu Nov 19 by day, 2026. Hefsek from Mon Nov 23. Hefsek done? Its date, for example: Nov 27.\nReply: NOT YET');
    expect(await sms(WIFE, 'NOT YET')).toEqual([SETUP_DONE]);
    h = (await householdOf(WIFE))!;
    expect(h.data.entries.map(e => [e.entry.kind, e.source])).toEqual([['flow', 'sms']]);
    expect(h.data.chat?.[WIFE]?.key).toBe('setup.done'); // the options of the last text

    // Status, and reminders turned on by text (the consent).
    expect((await sms(WIFE, 'status'))[0]).toMatch(/^Niddah since Thu Nov 19\./);
    expect(await sms(WIFE, 'REMINDERS ON')).toEqual([tx({ key: 'reminders.on', vars: { last4: '0102' } })]);
    h = (await householdOf(WIFE))!;
    expect(h.data.phones[0]!.consentAt).not.toBeNull();
    const hefsekReminder = h.data.queue.find(q => q.status === 'pending' && q.key.includes('hefsek'));
    expect(hefsekReminder).toBeDefined();

    // A reminder arrives.
    world.clock.now = hefsekReminder!.at + MINUTE;
    const beforeTick = world.telnyx.sent.length;
    await tick(env, world.deps);
    const reminder = world.telnyx.sent.slice(beforeTick);
    expect(reminder).toHaveLength(1);
    expect(reminder[0]).toMatchObject({ to: WIFE, endpoint: 'sms' });
    expect(reminder[0]!.text).toMatch(/^Hefsek tahara: Mon Nov 23, before sunset at 4:3\d PM\.\nReply: DONE, STATUS$/);

    // ADD: the person who asks gets a code; nothing is sent to anyone else.
    const added = await sms(WIFE, 'ADD');
    expect(added).toHaveLength(1);
    const code = codeIn(added[0]!);
    expect(added[0]).toBe(tx({ key: 'phones.add_code', vars: { code, days: '7' } }));
    expect(world.telnyx.sent.filter(s => s.to === HUSBAND)).toEqual([]);

    // The second phone joins by texting the code itself.
    expect(await sms(HUSBAND, `join ${code.toLowerCase()}`)).toEqual([JOINED]);
    h = (await householdOf(HUSBAND))!;
    expect(h.id).toBe((await householdOf(WIFE))!.id);
    expect(h.data.phones.map(p => [p.number, p.verifiedAt !== null, p.consentAt])).toEqual([
      [WIFE, true, expect.any(Number)],
      [HUSBAND, true, null],
    ]);
    expect(await count('join_codes')).toBe(0); // used up

    // Both record.
    expect((await sms(HUSBAND, 'hefsek today'))[0]).toMatch(/^Recorded: hefsek Mon Nov 23\. Clean days Tue Nov 24 - Mon Nov 30\./);
    expect((await sms(WIFE, 'HISTORY'))[0]).toBe('Latest: first: hefsek Mon Nov 23; second: flow Thu Nov 19 by day. Erase one?\nReply: FIRST, SECOND, MENU');
    expect((await sms(HUSBAND, 'PHONES'))[0]).toBe(
      'Phones: first ending 0102 (reminders on); second ending 0101 (this phone, reminders off).\nReply: ADD, REMOVE, LEAVE, MENU',
    );

    // The calendar link, by text.
    const cal = await sms(WIFE, 'CALENDAR LINK');
    const calUrl = /(https:\/\/cal\.example\/cal\/[A-Za-z0-9_-]+\.ics)/.exec(cal[0]!)![1]!;
    expect(cal[0]).toBe(tx({ key: 'calendar.link', vars: { url: calUrl } }));
    const feed = await new Client().get(new URL(calUrl).pathname);
    expect(feed.status).toBe(200);

    // WEB: a one-time link that signs in on the website, as the phone that asked.
    const web = await sms(HUSBAND, 'WEB');
    expect(web).toHaveLength(1);
    expect(web[0]!.startsWith(WEB_TEXT)).toBe(true);
    expect(web[0]!.endsWith('\nReply: MENU')).toBe(true);
    const link = new URL(web[0]!.slice(WEB_TEXT.length).split('\n')[0]!);
    expect(`${link.origin}${link.pathname}`).toBe('https://cal.example/app/');
    const token = link.searchParams.get('k')!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const browser = new Client('203.0.113.50');
    expect((await browser.post('/api/auth/link', { token })).status).toBe(200);
    const state = (await browser.get('/api/state')).json.state;
    expect(state.entries.map((e: any) => [e.kind, e.source])).toEqual([
      ['hefsek', 'sms'],
      ['flow', 'sms'],
    ]);
    expect(state.phones.map((p: any) => p.number)).toEqual([WIFE, HUSBAND]);
    expect(state.app.place.name).toBe('Lakewood, NJ 08701');
    // used once only
    expect((await new Client('203.0.113.51').post('/api/auth/link', { token })).json).toEqual({
      error: 'This sign-in link does not work. It works once, within 10 minutes of being texted. Text WEB for a new one, or sign in with your number.',
    });

    // Google Calendar, connected on the website, is let go when the account is deleted by text.
    const start = await browser.get('/api/google/start');
    const oauthState = new URL(start.res.headers.get('location')!).searchParams.get('state')!;
    await browser.get(`/api/google/callback?code=good-code&state=${encodeURIComponent(oauthState)}`);
    expect((await householdOf(WIFE))!.data.google).not.toBeNull();

    // DELETE ACCOUNT asks first; NO keeps it; YES deletes everything.
    expect(await sms(WIFE, 'DELETE ACCOUNT')).toEqual([tx('delete.ask')]);
    expect(await sms(WIFE, 'NO')).toEqual([tx('confirm.no')]);
    expect(await count('households')).toBe(1);
    await sms(WIFE, 'ADD'); // a waiting code
    await sms(WIFE, 'WEB'); // a waiting link
    expect(await count('join_codes')).toBe(1);
    expect(await count('link_tokens')).toBe(1);
    expect(await sms(WIFE, 'DELETE ACCOUNT')).toEqual([tx('delete.ask')]);
    expect(await sms(WIFE, 'YES')).toEqual([tx('delete.done')]);
    for (const table of ['households', 'phones', 'join_codes', 'link_tokens', 'codes']) expect(await count(table), table).toBe(0);
    expect(world.google.revoked).toContain('refresh-1');
    expect((await browser.get('/api/state')).status).toBe(401);
    expect((await new Client().get(new URL(calUrl).pathname)).status).toBe(404);
    // the numbers are strangers again: a text gets the greeting (one a day)
    world.clock.now += DAY;
    expect(await sms(HUSBAND, 'status')).toEqual([WELCOME_OPEN]);
  });
});

describe('the same conversation over RCS', () => {
  beforeEach(async () => {
    await site({ rcs: true });
    world.telnyx.rcsPhones.add(WIFE);
  });

  it('suggestion taps, a shared location, a fallback on every send, and an SMS-only phone served alike', async () => {
    const hello = await rcs(WIFE, { text: 'hello' });
    expect(hello).toEqual([{ text: rcsBody('signup.welcome'), suggestions: ['JOIN=JOIN'], endpoint: 'rcs', delivered: 'rcs' }]);

    expect(await rcs(WIFE, tap('JOIN'))).toEqual([{ text: rcsBody('setup.start'), suggestions: ['SKIP=SKIP'], endpoint: 'rcs', delivered: 'rcs' }]);

    // A shared location answers the ZIP question with the nearest ZIP code.
    const near = nearestPostal(40.0821, -74.2097)!;
    const located = await rcs(WIFE, { location: { latitude: 40.0821, longitude: -74.2097 } });
    expect(located.map(m => m.text)).toEqual([rcsBody({ key: 'location.set', vars: { place: near.name } }, 'setup.customs')]);
    expect(located[0]!.suggestions).toEqual(['KEEP FOR NOW=KEEP FOR NOW', 'ANSWER BY TEXT=ANSWER BY TEXT', 'LATER=LATER']);
    expect((await householdOf(WIFE))!.data.app.place).toMatchObject({ name: near.name, latitude: near.latitude });

    const kept = await rcs(WIFE, tap('KEEP FOR NOW'));
    expect(kept).toEqual([{ text: rcsBody('setup.recent'), suggestions: ['SKIP=SKIP'], endpoint: 'rcs', delivered: 'rcs' }]);
    expect((await rcs(WIFE, { text: 'Nov 19 day' }))[0]!.suggestions).toEqual(['NOT YET=NOT YET']);
    expect(await rcs(WIFE, tap('NOT YET'))).toEqual([
      { text: rcsBody('setup.done'), suggestions: ['PERIOD=PERIOD', 'HEFSEK=HEFSEK', 'REMINDERS=REMINDERS', 'MORE=MORE'], endpoint: 'rcs', delivered: 'rcs' },
    ]);
    // the options are answered by buttons and by words alike
    expect((await rcs(WIFE, tap('PERIOD')))[0]).toMatchObject({ text: 'When did it begin?', suggestions: ['NOW=NOW', 'LAST NIGHT=LAST NIGHT', 'ANOTHER DAY=ANOTHER DAY'] });
    expect((await rcs(WIFE, { text: 'menu' }))[0]!.text).toBe('Betaharah.');

    // A file or picture is not read: the usual "not understood", nothing changes.
    const before = JSON.stringify((await householdOf(WIFE))!.data.entries);
    expect((await rcs(WIFE, { user_file: { payload: { file_name: 'photo.jpg', mime_type: 'image/jpeg', file_uri: 'https://example.invalid/x', file_size_bytes: 10 } } })).map(m => m.text)).toEqual(['Not understood; nothing was changed.']);
    expect(JSON.stringify((await householdOf(WIFE))!.data.entries)).toBe(before);

    // A yes-or-no question by buttons.
    expect((await rcs(WIFE, { text: 'PAUSE VESATOT' }))[0]!.suggestions).toEqual(['YES=YES', 'NO=NO']);
    expect((await rcs(WIFE, tap('NO')))[0]!.text).toBe(rcsBody('confirm.no'));

    // A location shared later asks first.
    const asked = await rcs(WIFE, { location: { latitude: 40.6326, longitude: -73.9967 } });
    expect(asked[0]!.text).toMatch(/^Set the location to Brooklyn, NY \d{5}\? Now: /);
    expect((await rcs(WIFE, tap('NO')))[0]!.text).toBe(rcsBody('confirm.no'));

    // A phone without RCS, texting by SMS, gets the same texts by the RCS endpoint's SMS fallback.
    const code = codeIn((await rcs(WIFE, { text: 'ADD' }))[0]!.text);
    const joined = await sms(HUSBAND, `JOIN ${code}`);
    expect(joined).toEqual([JOINED]);
    const last = world.telnyx.sent.at(-1)!;
    expect(last).toMatchObject({ to: HUSBAND, endpoint: 'rcs', delivered: 'sms', fallback: { from: OUR_NUMBER, text: joined[0] } });
    expect((await sms(HUSBAND, 'STATUS'))[0]).toMatch(/^Niddah since Thu Nov 19\./);

    // A sign-in code goes as a plain SMS even with RCS on, and so does the sign-in link.
    hasWritten.add(WIFE);
    expect((await new Client().post('/api/auth/code', { number: WIFE })).status).toBe(200);
    expect(world.telnyx.sent.at(-1)).toMatchObject({ to: WIFE, endpoint: 'sms', delivered: 'sms' });
    expect(world.telnyx.sent.at(-1)!.text).toMatch(/^Betaharah code: \d{6}\./);
    const web = await rcs(WIFE, { text: 'WEB' });
    expect(web).toHaveLength(1);
    expect(web[0]).toMatchObject({ endpoint: 'sms', delivered: 'sms' });

    // Every RCS send carried its SMS fallback from the site's number: the same words, with the options as the last line.
    const viaRcs = world.telnyx.sent.filter(s => s.endpoint === 'rcs');
    expect(viaRcs.length).toBeGreaterThan(10);
    for (const s of viaRcs) {
      const labels = (s.suggestions ?? []).map(x => x.reply.text);
      expect(labels.length).toBeGreaterThan(0);
      for (const x of s.suggestions ?? []) expect(x.reply.postback_data).toBe(x.reply.text); // a tap sends the label
      expect(s.fallback).toEqual({ from: OUR_NUMBER, text: s.delivered === 'rcs' ? `${s.text}\nReply: ${labels.join(', ')}` : s.text });
      expect(s.agentId).toBe(RCS_AGENT);
      expect(s.messagingProfileId).toBe(MESSAGING_PROFILE);
      for (const sug of s.suggestions ?? []) expect(sug.reply.text.length).toBeLessThanOrEqual(20);
    }
  });

  it('a message to another agent is ignored; a repeated delivery is acted on once; the hourly limit counts both channels', async () => {
    await textAccount(HUSBAND);
    world.telnyx.rcsPhones.add(HUSBAND);
    expect(await rcs(HUSBAND, { text: 'status' }, { agentId: 'someone-else' })).toEqual([]);
    expect((await rcs(HUSBAND, { text: 'period now' }, { eventId: 'same' })).map(m => m.text)[0]).toMatch(/^Recorded: flow /);
    expect(await rcs(HUSBAND, { text: 'period now' }, { eventId: 'same' })).toEqual([]);
    expect((await householdOf(HUSBAND))!.data.entries).toHaveLength(1);
    world.clock.now += 2 * HOUR;
    let replies = 0;
    for (let i = 0; i < 31; i++) replies += (i % 2 ? await rcs(HUSBAND, { text: 'status' }) : await sms(HUSBAND, 'status')).length;
    expect(replies).toBe(30);
  });

  it('while RCS is switched off, everything goes by SMS; RCS messages are still answered', async () => {
    await config({ rcsEnabled: false });
    await rcs(WIFE, tap('JOIN'));
    expect(world.telnyx.sent.at(-1)).toMatchObject({ to: WIFE, endpoint: 'sms', text: SETUP_START });
    // while no agent id is saved, an RCS message is taken as it comes (Telnyx signed it) and answered by SMS;
    // once one is saved, only that agent's messages are taken (the test above)
    const op = await operator();
    expect((await op.put('/api/admin/secrets', { rcsAgentId: null })).status).toBe(200);
    const before = world.telnyx.sent.length;
    await rcs(WIFE, { text: 'status' });
    expect(world.telnyx.sent.slice(before)).toHaveLength(1);
    expect(world.telnyx.sent.at(-1)).toMatchObject({ to: WIFE, endpoint: 'sms' });
  });
});

describe('sign-up by text, and its limits', () => {
  it('by invitation: one reply naming what is missing; JOIN and an invitation word creates the account', async () => {
    await site({ config: { signup: 'invite' } });
    const made = await createInvitationWord(env, { word: 'Spring26', days: 3, maxUses: 2, note: 'shul', now: START });
    expect(made).toMatchObject({ word: 'SPRING26', maxUses: 2 });
    expect(await sms(HUSBAND, 'hello')).toEqual([tx('signup.invite')]);
    expect(await sms(HUSBAND, 'JOIN')).toEqual([]); // one reply a day to a number without an account
    world.clock.now += DAY;
    expect(await sms(HUSBAND, 'JOIN autumn26')).toEqual([BAD_INVITATION]);
    expect(await count('households')).toBe(0);
    expect(await sms(HUSBAND, 'join spring26')).toEqual([SETUP_START]); // any case
    expect(await sms(WIFE, 'JOIN SPRING26')).toEqual([SETUP_START]);
    expect(await count('households')).toBe(2);
    expect(await sms(OTHER, 'JOIN Spring26')).toEqual([BAD_INVITATION]); // used up
    expect(await count('households')).toBe(2);
    // the operator sees it among the invitations, used twice
    expect((await (await operator()).get('/api/admin/state')).json.invites).toEqual([]);
    // an expired word
    await createInvitationWord(env, { word: 'WINTER27', days: 1, now: world.clock.now });
    world.clock.now += 2 * DAY;
    expect(await sms(FOURTH, 'JOIN WINTER27')).toEqual([BAD_INVITATION]);
    expect(await count('households')).toBe(2);
  });

  it('invitation words: letters and digits, 6 to 24, at least one letter, each used once', async () => {
    await site();
    for (const word of ['short', '123456', 'has space', 'x'.repeat(25), 'dash-ed', 7, null]) {
      await expect(createInvitationWord(env, { word, now: START }), String(word)).rejects.toThrow(/word/);
    }
    await createInvitationWord(env, { word: 'Purim5787', now: START });
    await expect(createInvitationWord(env, { word: 'PURIM5787', now: START })).rejects.toThrow(/already in use/);
    await expect(createInvitationWord(env, { word: 'Lag2BOmer', days: 91, now: START })).rejects.toThrow(/days/);
    // while sign-up is open, a valid word also creates (and an invalid word never does)
    expect(await sms(HUSBAND, 'JOIN NOTAWORD')).toEqual([BAD_INVITATION]);
    expect(await count('households')).toBe(0);
    expect(await sms(WIFE, 'JOIN purim5787')).toEqual([SETUP_START]);
  });

  it('closed: nothing is sent to anyone without an account, whatever they text, except the filed reply to HELP', async () => {
    await site({ config: { signup: 'closed' } });
    await createInvitationWord(env, { word: 'CLOSED01', now: START });
    for (const t of ['hi', 'JOIN', 'JOIN CLOSED01', 'status']) expect(await sms(HUSBAND, t), t).toEqual([]);
    expect(await sms(HUSBAND, 'HELP')).toEqual([HELP_REPLY]);
    expect(await count('households')).toBe(0);
  });

  it('sign-up by text switched off (as shipped): no account is made and nothing is sent but the filed reply to HELP, in every mode', async () => {
    expect(SHIPPED_SITE_CONFIG.textSignup).toBe(false);
    for (const signup of ['open', 'invite'] as const) {
      await testDb.reset();
      await site({ config: { signup, textSignup: false } });
      for (const t of ['hi', 'JOIN']) expect(await sms(HUSBAND, t), `${signup} ${t}`).toEqual([]);
      expect(await sms(HUSBAND, 'HELP'), signup).toEqual([HELP_REPLY]);
      expect(await count('households')).toBe(0);
    }
  });

  it('a number with a prefix that is not allowed, or reserved for fiction, is never answered', async () => {
    await site({ config: { allowedPrefixes: ['+1'] } });
    expect(await sms('+447700900123', 'JOIN')).toEqual([]);
    expect(await sms('+447700900123', 'hi')).toEqual([]);
    expect(await sms(FICTIONAL, 'JOIN')).toEqual([]);
    expect(await count('households')).toBe(0);
    expect(world.telnyx.sent).toEqual([]);
  });

  it('HELP and START from a number without an account get the filed replies, within their own limits; STOP gets nothing from the site', async () => {
    await site();
    expect(await sms(HUSBAND, 'STOP')).toEqual([]);
    // the filed wording is sent also when Telnyx marks the keyword as already answered
    expect(await sms(HUSBAND, 'HELP', { autoresponseType: 'HELP' })).toEqual([HELP_REPLY]);
    expect(await sms(HUSBAND, 'HELP', { eventId: 'help-twice' })).toEqual([HELP_REPLY]);
    expect(await sms(HUSBAND, 'HELP', { eventId: 'help-twice' })).toEqual([]); // a repeated delivery
    expect(await sms(HUSBAND, 'START')).toEqual([START_REPLY]);
    // they do not use up the one reply a day to a number without an account
    expect(await sms(HUSBAND, 'hello')).toHaveLength(1);
    expect(await sms(HUSBAND, 'hello')).toEqual([]);
    // their own limit for one number
    for (let i = 3; i < KEYWORD_REPLIES_PER_NUMBER; i++) expect(await sms(HUSBAND, 'HELP')).toEqual([HELP_REPLY]);
    expect(await sms(HUSBAND, 'HELP')).toEqual([]);
    expect(await sms(HUSBAND, 'START')).toEqual([]);
    expect(await count('households')).toBe(0);
    expect(await count('phones')).toBe(0);
  });

  it('a JOIN delivered twice creates one account and answers once', async () => {
    await site();
    expect(await sms(WIFE, 'JOIN', { eventId: 'twice' })).toEqual([SETUP_START]);
    expect(await sms(WIFE, 'JOIN', { eventId: 'twice' })).toEqual([]);
    expect(await count('households')).toBe(1);
    const code = codeIn((await sms(WIFE, 'ADD'))[0]!);
    expect(await sms(HUSBAND, `JOIN ${code}`, { eventId: 'twice-2' })).toHaveLength(1);
    expect(await sms(HUSBAND, `JOIN ${code}`, { eventId: 'twice-2' })).toEqual([]);
    expect((await householdOf(WIFE))!.data.phones).toHaveLength(2);
  });

  it(`one reply a day to each number without an account (${STRANGER_REPLIES_PER_NUMBER})`, async () => {
    await site();
    expect(await sms(HUSBAND, 'hi')).toEqual([WELCOME_OPEN]);
    expect(await sms(HUSBAND, 'hi')).toEqual([]);
    expect(await sms(HUSBAND, 'what')).toEqual([]);
    world.clock.now += DAY;
    expect(await sms(HUSBAND, 'hi')).toEqual([WELCOME_OPEN]);
    // a JOIN is not a reply: it still creates the account
    expect(await sms(HUSBAND, 'JOIN')).toEqual([SETUP_START]);
  });

  it(`at most ${STRANGER_REPLIES_PER_DAY} replies a day to numbers without an account, for the whole site`, async () => {
    await site();
    let replied = 0;
    for (let i = 0; i < STRANGER_REPLIES_PER_DAY + 3; i++) replied += (await sms(`+1732600${String(i).padStart(4, '0')}`, 'hi')).length;
    expect(replied).toBe(STRANGER_REPLIES_PER_DAY);
    world.clock.now = at(11, 24, 10);
    expect(await sms('+17326009999', 'hi')).toEqual([WELCOME_OPEN]);
  });

  it(`at most ${TEXT_SIGNUPS_PER_DAY} accounts a day are created by text`, async () => {
    await site();
    let created = 0;
    for (let i = 0; i < TEXT_SIGNUPS_PER_DAY + 2; i++) created += (await sms(`+1732700${String(i).padStart(4, '0')}`, 'JOIN')).length;
    expect(created).toBe(TEXT_SIGNUPS_PER_DAY);
    expect(await count('households')).toBe(TEXT_SIGNUPS_PER_DAY);
    world.clock.now = at(11, 24, 10);
    expect(await sms('+17327009999', 'JOIN')).toEqual([SETUP_START]);
  });
});

describe('adding a phone with a code', () => {
  beforeEach(async () => {
    await site();
    await textAccount(WIFE);
  });

  it('a code works once; then, or after 7 days, it is refused and changes nothing', async () => {
    const code = codeIn((await sms(WIFE, 'ADD'))[0]!);
    expect(await sms(HUSBAND, `JOIN ${code}`)).toEqual([JOINED]);
    expect(await sms(OTHER, `JOIN ${code}`)).toEqual([BAD_INVITATION]);
    expect(await householdOf(OTHER)).toBeNull();
    expect((await householdOf(WIFE))!.data.phones).toHaveLength(2);

    const late = codeIn((await sms(WIFE, 'ADD'))[0]!);
    world.clock.now += 7 * DAY + MINUTE;
    expect(await sms(FOURTH, `JOIN ${late}`)).toEqual([BAD_INVITATION]);
    expect(await householdOf(FOURTH)).toBeNull();
  });

  it('a new code replaces the one before', async () => {
    const first = codeIn((await sms(WIFE, 'ADD'))[0]!);
    const second = codeIn((await sms(WIFE, 'ADD'))[0]!);
    expect(await sms(HUSBAND, `JOIN ${first}`)).toEqual([BAD_INVITATION]);
    world.clock.now += DAY;
    expect(await sms(HUSBAND, `JOIN ${second}`)).toEqual([JOINED]);
  });

  it('from a number that already has an account: the reply says so, nothing changes, and the code still works', async () => {
    await textAccount(OTHER);
    const code = codeIn((await sms(WIFE, 'ADD'))[0]!);
    expect(await sms(OTHER, `JOIN ${code}`)).toEqual([ALREADY_ON_ACCOUNT]);
    expect((await householdOf(WIFE))!.data.phones.map(p => p.number)).toEqual([WIFE]);
    expect((await householdOf(OTHER))!.data.phones.map(p => p.number)).toEqual([OTHER]);
    expect(await sms(HUSBAND, `JOIN ${code}`)).toEqual([JOINED]);
  });

  it('works while sign-up is closed or sign-up by text is off, because it adds to an existing account', async () => {
    await config({ signup: 'closed', textSignup: false });
    const code = codeIn((await sms(WIFE, 'ADD'))[0]!);
    expect(await sms(HUSBAND, `JOIN ${code}`)).toEqual([JOINED]);
  });

  it('an account that became full in the meantime: the phone is not added, and is told so', async () => {
    const code = codeIn((await sms(WIFE, 'ADD'))[0]!);
    for (const n of [HUSBAND, OTHER, FOURTH]) {
      const c = codeIn((await sms(WIFE, 'ADD'))[0]!);
      expect(await sms(n, `JOIN ${c}`)).toHaveLength(1);
    }
    expect((await householdOf(WIFE))!.data.phones).toHaveLength(4);
    expect(await sms(WIFE, 'ADD')).toEqual(['This account already has 4 phones, the most allowed. Nothing was changed.\nReply: PHONES, MENU']);
    const fifth = '+17324440105';
    expect(await sms(fifth, `JOIN ${code}`)).toEqual([BAD_INVITATION]); // replaced by the later codes
    expect(await householdOf(fifth)).toBeNull();
    expect(tx('signup.join_full').length).toBeLessThanOrEqual(160);
  });

  it('LEAVE and REMOVE by text take a phone off, as on the website', async () => {
    const code = codeIn((await sms(WIFE, 'ADD'))[0]!);
    await sms(HUSBAND, `JOIN ${code}`);
    expect(await sms(HUSBAND, 'LEAVE')).toEqual([tx('phones.leave_ask')]);
    expect(await sms(HUSBAND, 'YES')).toEqual([tx('phones.left')]);
    expect(await householdOf(HUSBAND)).toBeNull();
    expect((await householdOf(WIFE))!.data.phones.map(p => p.number)).toEqual([WIFE]);
    const again = codeIn((await sms(WIFE, 'ADD'))[0]!);
    world.clock.now += DAY;
    await sms(HUSBAND, `JOIN ${again}`);
    await sms(WIFE, 'PHONES');
    expect(await sms(WIFE, 'REMOVE')).toEqual([tx({ key: 'phones.remove_which', vars: { list: 'second ending 0101' }, offer: ['second', 'menu'] })]);
    expect(await sms(WIFE, 'second')).toEqual([tx({ key: 'phones.remove_ask', vars: { last4: '0101' } })]);
    expect(await sms(WIFE, 'YES')).toEqual([tx({ key: 'phones.removed', vars: { last4: '0101' } })]);
    expect(await householdOf(HUSBAND)).toBeNull();
    expect(await sms(WIFE, 'LEAVE')).toEqual([tx('phones.last')]);
  });
});

describe('one account never reaches another by text', () => {
  beforeEach(async () => {
    await site();
    await textAccount(WIFE);
    await textAccount(OTHER);
  });

  it('a text reads and changes only its own phone\'s account', async () => {
    await sms(WIFE, 'period 11/19 day');
    expect((await sms(OTHER, 'status'))[0]).toMatch(/^Tehorah\./);
    expect((await sms(OTHER, 'HISTORY'))[0]).toBe(tx('history.empty'));
    expect((await sms(OTHER, 'PHONES'))[0]).toMatch(/^Phones: first ending 0199 \(this phone, reminders off\)\./);
    expect(await sms(OTHER, 'FIRST')).toEqual([tx('not_understood')]);
    expect(await sms(OTHER, 'UNDO')).toHaveLength(1);
    expect((await householdOf(WIFE))!.data.entries).toHaveLength(1);
    expect((await householdOf(OTHER))!.data.entries).toHaveLength(0);
  });

  it('a code attaches a phone only to the household that made it', async () => {
    const code = codeIn((await sms(WIFE, 'ADD'))[0]!);
    expect(await sms(OTHER, `JOIN ${code}`)).toEqual([ALREADY_ON_ACCOUNT]);
    expect(await sms(HUSBAND, `JOIN ${code}`)).toEqual([JOINED]);
    expect((await householdOf(HUSBAND))!.id).toBe((await householdOf(WIFE))!.id);
    expect((await householdOf(OTHER))!.data.phones.map(p => p.number)).toEqual([OTHER]);
    // a code from a deleted account is gone with it
    const code2 = codeIn((await sms(OTHER, 'ADD'))[0]!);
    await sms(OTHER, 'DELETE ACCOUNT');
    await sms(OTHER, 'YES');
    expect(await sms(FOURTH, `JOIN ${code2}`)).toEqual([BAD_INVITATION]);
  });

  it('a sign-in link works once, only for the phone and household that asked', async () => {
    const tokenOf = tokenIn;
    const mine = tokenOf((await sms(WIFE, 'WEB'))[0]!);
    const theirs = tokenOf((await sms(OTHER, 'WEB'))[0]!);
    const a = new Client('203.0.113.60');
    expect((await a.post('/api/auth/link', { token: mine })).status).toBe(200);
    expect((await a.get('/api/state')).json.state.phones.map((p: any) => p.number)).toEqual([WIFE]);
    expect((await a.post('/api/auth/link', { token: mine })).status).toBe(400);
    const b = new Client('203.0.113.61');
    expect((await b.post('/api/auth/link', { token: theirs })).status).toBe(200);
    expect((await b.get('/api/state')).json.state.phones.map((p: any) => p.number)).toEqual([OTHER]);
    // after 10 minutes it no longer works
    const late = tokenOf((await sms(WIFE, 'WEB'))[0]!);
    world.clock.now += 10 * MINUTE + 1000;
    expect((await new Client('203.0.113.62').post('/api/auth/link', { token: late })).status).toBe(400);
    // a phone that left its household cannot use a link it asked for there
    const code = codeIn((await sms(WIFE, 'ADD'))[0]!);
    await sms(HUSBAND, `JOIN ${code}`);
    const husbands = tokenOf((await sms(HUSBAND, 'WEB'))[0]!);
    await sms(HUSBAND, 'LEAVE');
    await sms(HUSBAND, 'YES');
    expect((await new Client('203.0.113.63').post('/api/auth/link', { token: husbands })).status).toBe(400);
    for (const bad of [{}, { token: 5 }, { token: 'short' }, { token: 'x'.repeat(65) }, { token: '../../etc' }]) {
      expect((await new Client('203.0.113.64').post('/api/auth/link', bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await new Client('203.0.113.64').post('/api/auth/link', { token: mine }, { header: false })).status).toBe(400);
  });

  it('wrong sign-in links from one address are limited', async () => {
    const c = new Client('203.0.113.70');
    for (let i = 0; i < 20; i++) await c.post('/api/auth/link', { token: `${'a'.repeat(31)}${String.fromCharCode(65 + (i % 26))}` });
    const tokenOf = tokenIn;
    const good = tokenOf((await sms(WIFE, 'WEB'))[0]!);
    expect((await c.post('/api/auth/link', { token: good })).status).toBe(400);
    expect((await new Client('203.0.113.71').post('/api/auth/link', { token: good })).status).toBe(200);
  });
});

describe('carrier words in the middle of a conversation', () => {
  it('get the filed replies, and the question stays open', async () => {
    await site();
    await textAccount(WIFE);
    expect((await sms(WIFE, 'CUSTOMS ALL'))[0]).toMatch(/^Custom 1 of 12: /);
    expect(await sms(WIFE, 'HELP')).toEqual([HELP_REPLY]);
    expect(await sms(WIFE, 'HELP', { autoresponseType: 'HELP' })).toEqual([HELP_REPLY]);
    expect((await sms(WIFE, 'FIVE DAYS'))[0]).toMatch(/^Kept: wait before hefsek: five days\. Custom 2 of 12: /);
    expect(await sms(WIFE, 'STOP', { autoresponseType: 'STOP' })).toEqual([]);
    expect((await householdOf(WIFE))!.data.phones[0]!.optedOut).toBe(true);
    expect(await sms(WIFE, 'DAY 30')).toEqual([]); // not acted on while opted out
    expect(await sms(WIFE, 'START', { autoresponseType: 'START' })).toEqual([START_REPLY]);
    expect((await householdOf(WIFE))!.data.phones[0]!.optedOut).toBe(false);
    expect((await sms(WIFE, 'DAY 30'))[0]).toMatch(/^Saved: onah beinonit day: day 30\. Custom 3 of 12: /);
    expect(await sms(WIFE, 'unsubscribe')).toEqual([]);
    expect(await sms(WIFE, 'unstop')).toEqual([START_REPLY]);
    expect((await sms(WIFE, 'KEEP'))[0]).toMatch(/^Kept: onah beinonit length: /);
  });

  it('a phone the carrier says opted out is noted, in a conversation as in a reply', async () => {
    await site();
    await textAccount(WIFE);
    world.telnyx.blocked.add(WIFE);
    expect(await sms(WIFE, 'MENU')).toEqual([]);
    expect((await householdOf(WIFE))!.data.phones[0]!.optedOut).toBe(true);
    const out = (await householdOf(WIFE))!.data.messages.find(m => m.direction === 'out');
    expect(out).toMatchObject({ body: tx('menu.main'), status: 'not sent' });
  });
});

describe('what can be read in the database', () => {
  it('no conversation, code, word, link, number or counter of a stranger is readable', async () => {
    // "Betaharah" stands for the words of a text below, so the site's public contact name is another word here
    await site({ config: { signup: 'invite', contactName: 'The Operator' } });
    const word = 'Tishrei87';
    await createInvitationWord(env, { word, now: START });
    await sms(HUSBAND, 'hello'); // a stranger: counters only
    expect(await sms(WIFE, `JOIN ${word}`)).toEqual([SETUP_START]);
    expect(await sms(WIFE, '08701')).toHaveLength(1); // the location and the next question in one text
    expect((await sms(WIFE, 'ANSWER BY TEXT'))[0]).toMatch(/^Custom 1 of 12/); // a pending custom question
    const code = codeIn((await sms(WIFE, 'ADD'))[0]!);
    const web = (await sms(WIFE, 'WEB'))[0]!;
    const token = tokenIn(web);
    expect((await sms(WIFE, 'CUSTOMS ALL'))[0]).toMatch(/^Custom 1 of 12/);
    const h = (await householdOf(WIFE))!;
    expect(h.data.chat?.[WIFE]).toMatchObject({ key: 'custom.minWaitDays', ctx: { index: 0, walk: true } }); // it is stored, encrypted
    // a simulated account too
    await simulateText(env, world.deps, await loadSite(env), { from: FICTIONAL, text: 'JOIN' }).catch(() => undefined);

    const all = await dump();
    for (const secret of [
      code,
      code.toLowerCase(),
      token,
      word,
      word.toUpperCase(),
      word.toLowerCase(),
      '7324440101',
      '7324440102',
      '7325550142',
      '0101',
      '0102',
      '"custom.minWaitDays"',
      '"walk"',
      '"zip"',
      '"opts"',
      'FIVE DAYS',
      '"setup"',
      'Lakewood',
      'JOIN ',
      '"hello"',
      'Custom 1 of 12',
      'Betaharah',
    ]) {
      expect(all.includes(secret), `"${secret}" is readable in the database`).toBe(false);
    }
    // what is there: fingerprints and counts
    expect(await count('join_codes')).toBe(1);
    expect(await count('link_tokens')).toBe(1);
    expect(all).toMatch(/st:[A-Za-z0-9_-]{24}/);
    expect(all).toContain('st-day:2026-11-23');
  });
});

describe('the operator\'s simulator', () => {
  it('signs up a number reserved for fiction through the whole real path, with nothing sent and no site counter moved', async () => {
    await site();
    const s = await loadSite(env);
    const counters = async () => JSON.stringify((await testDb.db.prepare('SELECT * FROM counters ORDER BY key').all()).results);
    const before = await counters();
    const say = async (text: string) => simulateText(env, world.deps, s, { from: FICTIONAL, text, origin: 'https://cal.example' });

    expect(await say('hello')).toEqual({ outcome: 'replied', replies: [{ text: WELCOME_OPEN, suggestions: [{ label: 'JOIN', send: 'JOIN' }] }], householdId: null });
    const joined = await say('JOIN');
    expect(joined).toMatchObject({ outcome: 'created', replies: [{ text: SETUP_START, suggestions: [{ label: 'SKIP', send: 'SKIP' }] }] });
    const h = (await householdOf(FICTIONAL))!;
    expect(h.id).toBe(joined.householdId);
    expect(h.data.demo).toBe(true);
    expect((await say('08701')).replies.map(r => r.text)).toEqual([tx({ key: 'location.set', vars: { place: 'Lakewood, NJ 08701' } }, 'setup.customs')]);
    expect((await say('KEEP FOR NOW')).outcome).toBe('conversed');
    expect((await say('Nov 19 day')).replies[0]!.text).toMatch(/^Recorded: flow Thu Nov 19 by day, 2026\./);
    expect((await say('NOT YET')).replies).toEqual([{ text: SETUP_DONE, suggestions: ['PERIOD', 'HEFSEK', 'REMINDERS', 'MORE'].map(l => ({ label: l, send: l })) }]);
    expect((await say('REMINDERS ON')).replies[0]!.text).toBe(tx({ key: 'reminders.on', vars: { last4: '0142' } }));
    // a second made-up phone joins with a code
    const code = codeIn((await say('ADD')).replies[0]!.text);
    const spouse = await simulateText(env, world.deps, s, { from: '+17325550143', text: `JOIN ${code}` });
    expect(spouse).toMatchObject({ outcome: 'joined', householdId: h.id });
    // the sign-in link is returned, and works
    const web = (await say('WEB')).replies[0]!.text;
    const token = tokenIn(web);
    const browser = new Client();
    expect((await browser.post('/api/auth/link', { token })).status).toBe(200);
    expect((await browser.get('/api/state')).json.state.demo).toBe(true);
    // its messages are recorded as simulated
    const msgs = (await householdOf(FICTIONAL))!.data.messages;
    expect(msgs.every(m => m.status === 'simulated')).toBe(true);
    // its reminders are simulated by the periodic job, never sent
    world.clock.now = at(11, 23, 16);
    await tick(env, world.deps);
    expect((await householdOf(FICTIONAL))!.data.queue.some(q => q.status === 'sent')).toBe(true);

    expect(world.telnyx.sent).toEqual([]);
    expect(await counters()).toBe(before);
    // deleting it by text
    await say('DELETE ACCOUNT');
    expect((await say('YES')).replies[0]!.text).toBe(tx('delete.done'));
    expect(await householdOf(FICTIONAL)).toBeNull();
    expect(world.telnyx.sent).toEqual([]);
  });

  it('takes only numbers reserved for fiction, and never touches a real account', async () => {
    await site();
    const s = await loadSite(env);
    await expect(simulateText(env, world.deps, s, { from: HUSBAND, text: 'JOIN' })).rejects.toThrow(/reserved for fiction/);
    await expect(simulateText(env, world.deps, s, { from: FICTIONAL, text: 'x'.repeat(321) })).rejects.toThrow(/320/);
    await textAccount(WIFE);
    const code = codeIn((await sms(WIFE, 'ADD'))[0]!);
    // a real household's code cannot bring a made-up phone in
    expect(await simulateText(env, world.deps, s, { from: FICTIONAL, text: `JOIN ${code}` })).toEqual({ outcome: 'replied', replies: [{ text: BAD_INVITATION, suggestions: [{ label: 'JOIN', send: 'JOIN' }] }], householdId: null });
    expect((await householdOf(WIFE))!.data.phones).toHaveLength(1);
    // and a test account's code cannot bring a real phone in
    await simulateText(env, world.deps, s, { from: FICTIONAL, text: 'JOIN' });
    const demoCode = codeIn((await simulateText(env, world.deps, s, { from: FICTIONAL, text: 'ADD' })).replies[0]!.text);
    expect(await sms(HUSBAND, `JOIN ${demoCode}`)).toEqual([BAD_INVITATION]);
    expect(await householdOf(HUSBAND)).toBeNull();
  });
});

describe('the test account\'s text box', () => {
  it('goes through the same conversation, and returns every text that would be sent', async () => {
    const op = await site();
    expect((await op.post('/api/admin/demo')).status).toBe(200);
    const r = await op.post('/api/demo/text', { text: 'MENU' });
    expect(r.status).toBe(200);
    expect(r.json.reply).toBe(tx('menu.main'));
    expect(r.json.replies).toEqual([{ text: tx('menu.main'), suggestions: ['PERIOD', 'HEFSEK', 'STATUS', 'MORE'].map(l => ({ label: l, send: l })) }]);
    const customs = await op.post('/api/demo/text', { text: 'CUSTOMS ALL' });
    expect(customs.json.replies[0].text).toMatch(/^Custom 1 of 12: /);
    expect(customs.json.replies[0].suggestions.map((s: any) => s.send)).toEqual(['FIVE DAYS', 'FOUR DAYS', 'KEEP']);
    const add = await op.post('/api/demo/text', { text: 'ADD' });
    expect(add.json.reply).toMatch(/^Have that phone text JOIN [A-Z]{8} to this number within 7 days\./);
    const cal = await op.post('/api/demo/text', { text: 'CALENDAR LINK' });
    expect(cal.json.reply).toMatch(/^Calendar link: https:\/\/cal\.example\/cal\/[A-Za-z0-9_-]+\.ics /);
    expect(cal.json.state.calendar.link).toBeTruthy();
    const web = await op.post('/api/demo/text', { text: 'WEB' });
    expect(web.json.reply.startsWith(WEB_TEXT)).toBe(true);
    expect(web.json.state.messages[0].body).toBe(`${WEB_TEXT}(link)\nReply: MENU`); // the link itself is not kept
    // an effect the server cannot carry out: its "could not" text is sent instead, and recorded so
    expect((await op.post('/api/demo/text', { text: 'LEAVE' })).json.reply).toBe(tx('phones.leave_ask'));
    const leave = await op.post('/api/demo/text', { text: 'YES' });
    expect(leave.json.replies.map((x: any) => x.text)).toEqual([tx('phones.leave_failed')]); // the test phone stays on the test account
    expect(leave.json.state.messages.slice(0, 2).map((m: any) => [m.direction, m.body, m.status])).toEqual([
      ['out', tx('phones.leave_failed'), 'simulated'],
      ['in', 'YES', 'simulated'],
    ]);
    expect(leave.json.state.phones).toHaveLength(2);
    const del = await op.post('/api/demo/text', { text: 'DELETE ACCOUNT' });
    expect(del.json.reply).toBe(tx('delete.ask'));
    const yes = await op.post('/api/demo/text', { text: 'YES' });
    expect(yes.json).toEqual({ reply: tx('delete.done'), replies: [{ text: tx('delete.done'), suggestions: [{ label: 'JOIN', send: 'JOIN' }] }], signedOut: true });
    expect((await op.get('/api/state')).status).toBe(401);
    expect(world.telnyx.sent).toEqual([]);
  });
});

describe('looking up a postal code', () => {
  it('needs a session, answers a place or 404, and is limited per phone', async () => {
    await site();
    expect((await new Client().get('/api/postal/08701')).status).toBe(401);
    const c = await webAccount(HUSBAND);
    const r = await c.get('/api/postal/08701');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ place: { name: 'Lakewood, NJ 08701', latitude: expect.any(Number), longitude: expect.any(Number), timeZone: TZ, elevation: 0, postal: '08701' } });
    expect((await c.get('/api/postal/h3w%201a1')).json.place).toMatchObject({ postal: 'H3W', timeZone: 'America/Toronto' });
    const missing = await c.get('/api/postal/99999');
    expect(missing.status).toBe(404);
    expect(missing.json.error).toMatch(/^No place was found/);
    expect((await c.get('/api/postal/x'.padEnd(40, 'x'))).status).toBe(404);
    for (let i = 0; i < 56; i++) await c.get('/api/postal/08701');
    expect((await c.get('/api/postal/08701')).status).toBe(429);
  });

  it('GET /api/public still names the texting number', async () => {
    await site();
    expect((await new Client().get('/api/public')).json.textingNumber).toBe(OUR_NUMBER);
  });
});
