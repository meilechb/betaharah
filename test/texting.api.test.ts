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
import * as T from '../src/app/chat/texts';
import { WELCOME_OPEN } from '../src/app/chat/texts';
import {
  JOIN_FULL,
  simulateText,
  STRANGER_REPLIES_PER_DAY,
  STRANGER_REPLIES_PER_NUMBER,
  TEXT_SIGNUPS_PER_DAY,
} from '../src/app/conversation';
import type { Env } from '../src/app/env';
import { createApp } from '../src/app/index';
import { DEFAULT_SITE_CONFIG, type HouseholdData, type SiteConfig } from '../src/app/model';
import { TABLES } from '../src/app/schema';
import { HELP_REPLY, tick } from '../src/app/service';
import { DEFAULT_APP_SETTINGS, PLACES } from '../src/app/settings';
import { createInvitationWord, getPhone, loadHousehold, loadSite, phoneHash } from '../src/app/store';
import { nearestPostal } from '../src/app/zip';
import { localToInstant } from '../src/engine/civil';
import { BASIC } from './helpers';
import { makeEnv, makeWorld, MESSAGING_PROFILE, RCS_AGENT, startDb, TEST_PASSWORD, type TestDb, type World } from './fakes';

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
  expect(await sms(number, 'JOIN')).toEqual([T.SETUP_START]);
  expect((await sms(number, '08701'))[0]).toMatch(/^Location set: Lakewood, NJ 08701\./);
  await sms(number, 'A');
  expect(await sms(number, 'SKIP')).toEqual([T.SETUP_DONE]);
}

// ---------------------------------------------------------------------------

describe('the whole life of an account, by text message alone', () => {
  it('from a stranger\'s first text to a deleted account, through the real webhook', async () => {
    await site({ google: true });

    // A stranger texts the number: one reply, with the compliance wording.
    expect(await sms(WIFE, 'Hi, what is this?')).toEqual([WELCOME_OPEN]);
    expect(await count('households')).toBe(0);

    // JOIN: the account is created with this phone, verified; reminders are not on; setup starts.
    expect(await sms(WIFE, 'JOIN')).toEqual([T.SETUP_START]);
    let h = (await householdOf(WIFE))!;
    expect(h.data.phones).toEqual([expect.objectContaining({ number: WIFE, canUpdate: true, consentAt: null, optedOut: false })]);
    expect(h.data.phones[0]!.verifiedAt).toBe(START + 10_000);
    expect(h.data.welcomedAt).toBeNull();
    expect(h.data.demo).toBe(false);
    expect(h.data.chat?.[WIFE]?.q).toEqual({ kind: 'zip' });

    // Step 1: the ZIP code.
    expect(await sms(WIFE, '99999')).toEqual([T.unknownZip('99999')]);
    expect(await sms(WIFE, '08701')).toEqual(['Location set: Lakewood, NJ 08701. Sunset and nightfall are now worked out for it.', T.CUSTOMS_INTRO]);
    h = (await householdOf(WIFE))!;
    expect(h.data.app.place).toMatchObject({ name: 'Lakewood, NJ 08701', timeZone: TZ });

    // Step 2: keep the customs.
    expect(await sms(WIFE, 'A')).toEqual([`${T.CUSTOMS_KEPT} ${T.RECENT_ASK}`]);

    // Step 3: dated entries.
    const flow = await sms(WIFE, '1 11/19 day');
    expect(flow).toHaveLength(1);
    expect(flow[0]).toBe(`Recorded: flow Thu Nov 19 by day, 2026. Hefsek from Mon Nov 23. 0 to undo. ${T.RECENT_NEXT}`);
    expect(await sms(WIFE, 'DONE')).toEqual([T.SETUP_DONE]);
    h = (await householdOf(WIFE))!;
    expect(h.data.entries.map(e => [e.entry.kind, e.source])).toEqual([['flow', 'sms']]);
    expect(h.data.chat).toBeNull();

    // Status, and reminders turned on by text (the consent).
    expect((await sms(WIFE, '9'))[0]).toMatch(/^Niddah since Thu Nov 19\./);
    expect(await sms(WIFE, 'REMINDERS ON')).toEqual([T.remindersOn('0102')]);
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
    expect(reminder[0]!.text).toMatch(/^Hefsek tahara: Mon Nov 23, before sunset at 4:3\d PM\. Reply 2 when done\.$/);

    // ADD: the person who asks gets a code; nothing is sent to anyone else.
    const added = await sms(WIFE, 'ADD');
    expect(added).toHaveLength(1);
    const code = codeIn(added[0]!);
    expect(added[0]).toBe(T.addCode(code, 7));
    expect(world.telnyx.sent.filter(s => s.to === HUSBAND)).toEqual([]);

    // The second phone joins by texting the code itself.
    expect(await sms(HUSBAND, `join ${code.toLowerCase()}`)).toEqual([T.joinedText(' with the phone ending 0102')]);
    h = (await householdOf(HUSBAND))!;
    expect(h.id).toBe((await householdOf(WIFE))!.id);
    expect(h.data.phones.map(p => [p.number, p.verifiedAt !== null, p.consentAt])).toEqual([
      [WIFE, true, expect.any(Number)],
      [HUSBAND, true, null],
    ]);
    expect(await count('join_codes')).toBe(0); // used up

    // Both record.
    expect((await sms(HUSBAND, '2'))[0]).toMatch(/^Recorded: hefsek Mon Nov 23\. Clean days Tue Nov 24 - Mon Nov 30\./);
    expect((await sms(WIFE, 'HISTORY'))[0]).toBe('Latest entries: A hefsek Mon Nov 23. B flow Thu Nov 19 by day. To erase one, reply ERASE and its letter, e.g. ERASE A.');
    expect((await sms(HUSBAND, 'PHONES'))[0]).toBe(
      'Phones: A ending 0102 (reminders on), B ending 0101 (this phone, reminders off). ADD gives a code to add a phone. REMOVE and a letter removes one. LEAVE takes this phone off.',
    );

    // The calendar link, by text.
    const cal = await sms(WIFE, 'CALENDAR LINK');
    const calUrl = /(https:\/\/cal\.example\/cal\/[A-Za-z0-9_-]+\.ics)/.exec(cal[0]!)![1]!;
    expect(cal[0]).toBe(T.calendarCreated(calUrl));
    const feed = await new Client().get(new URL(calUrl).pathname);
    expect(feed.status).toBe(200);

    // WEB: a one-time link that signs in on the website, as the phone that asked.
    const web = await sms(HUSBAND, 'WEB');
    expect(web).toHaveLength(1);
    expect(web[0]!.startsWith(T.WEB_LINK_TEXT)).toBe(true);
    const link = new URL(web[0]!.slice(T.WEB_LINK_TEXT.length));
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
    expect(await sms(WIFE, 'DELETE ACCOUNT')).toEqual([T.DELETE_ASK]);
    expect(await sms(WIFE, 'NO')).toEqual([T.NO_CHANGE]);
    expect(await count('households')).toBe(1);
    await sms(WIFE, 'ADD'); // a waiting code
    await sms(WIFE, 'WEB'); // a waiting link
    expect(await count('join_codes')).toBe(1);
    expect(await count('link_tokens')).toBe(1);
    expect(await sms(WIFE, 'DELETE ACCOUNT')).toEqual([T.DELETE_ASK]);
    expect(await sms(WIFE, 'YES')).toEqual([T.DELETED]);
    for (const table of ['households', 'phones', 'join_codes', 'link_tokens', 'codes']) expect(await count(table), table).toBe(0);
    expect(world.google.revoked).toContain('refresh-1');
    expect((await browser.get('/api/state')).status).toBe(401);
    expect((await new Client().get(new URL(calUrl).pathname)).status).toBe(404);
    // the numbers are strangers again: a text gets the greeting (one a day)
    world.clock.now += DAY;
    expect(await sms(HUSBAND, '9')).toEqual([WELCOME_OPEN]);
  });
});

describe('the same conversation over RCS', () => {
  beforeEach(async () => {
    await site({ rcs: true });
    world.telnyx.rcsPhones.add(WIFE);
  });

  it('suggestion taps, a shared location, a fallback on every send, and an SMS-only phone served alike', async () => {
    const hello = await rcs(WIFE, { text: 'hello' });
    expect(hello).toEqual([{ text: WELCOME_OPEN, suggestions: ['Join=JOIN'], endpoint: 'rcs', delivered: 'rcs' }]);

    expect(await rcs(WIFE, tap('JOIN', 'Join'))).toEqual([{ text: T.SETUP_START, suggestions: undefined, endpoint: 'rcs', delivered: 'rcs' }]);

    // A shared location answers the ZIP question with the nearest ZIP code.
    const near = nearestPostal(40.0821, -74.2097)!;
    const located = await rcs(WIFE, { location: { latitude: 40.0821, longitude: -74.2097 } });
    expect(located.map(m => m.text)).toEqual([`Location set: ${near.name}. Sunset and nightfall are now worked out for it.`, T.CUSTOMS_INTRO]);
    expect(located[1]!.suggestions).toEqual(['A: Keep for now=A', 'B: Answer by text=B', 'C: Later, website=C']);
    expect((await householdOf(WIFE))!.data.app.place).toMatchObject({ name: near.name, latitude: near.latitude });

    const kept = await rcs(WIFE, tap('A', 'A: Keep for now'));
    expect(kept).toEqual([{ text: `${T.CUSTOMS_KEPT} ${T.RECENT_ASK}`, suggestions: ['Skip=SKIP'], endpoint: 'rcs', delivered: 'rcs' }]);
    expect((await rcs(WIFE, { text: '1 11/19 day' }))[0]!.suggestions).toEqual(['Done=DONE']);
    expect(await rcs(WIFE, tap('DONE', 'Done'))).toEqual([
      { text: T.SETUP_DONE, suggestions: ['Status=STATUS', 'History=HISTORY', 'Customs=CUSTOMS', 'Reminders=REMINDERS'], endpoint: 'rcs', delivered: 'rcs' },
    ]);

    // A file or picture is not read: the usual "not understood", nothing changes.
    const before = JSON.stringify((await householdOf(WIFE))!.data.entries);
    expect((await rcs(WIFE, { user_file: { payload: { file_name: 'photo.jpg', mime_type: 'image/jpeg', file_uri: 'https://example.invalid/x', file_size_bytes: 10 } } })).map(m => m.text)).toEqual([T.UNKNOWN]);
    expect(JSON.stringify((await householdOf(WIFE))!.data.entries)).toBe(before);

    // A yes-or-no question by buttons.
    expect((await rcs(WIFE, { text: 'PAUSE VESATOT' }))[0]!.suggestions).toEqual(['Yes=YES', 'No=NO']);
    expect((await rcs(WIFE, tap('NO', 'No')))[0]!.text).toBe(T.NO_CHANGE);

    // A location shared later asks first.
    const asked = await rcs(WIFE, { location: { latitude: 40.6326, longitude: -73.9967 } });
    expect(asked[0]!.text).toMatch(/^Set your location to Brooklyn, NY \d{5}\? Reply YES to set it, NO to keep /);
    expect((await rcs(WIFE, tap('NO')))[0]!.text).toBe(T.NO_CHANGE);

    // A phone without RCS, texting by SMS, gets the same texts by the RCS endpoint's SMS fallback.
    const code = codeIn((await rcs(WIFE, { text: 'ADD' }))[0]!.text);
    const joined = await sms(HUSBAND, `JOIN ${code}`);
    expect(joined).toEqual([T.joinedText(' with the phone ending 0102')]);
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

    // Every RCS send carried the same text as its SMS fallback, from the site's number.
    const viaRcs = world.telnyx.sent.filter(s => s.endpoint === 'rcs');
    expect(viaRcs.length).toBeGreaterThan(10);
    for (const s of viaRcs) {
      expect(s.fallback).toEqual({ from: OUR_NUMBER, text: s.text });
      expect(s.agentId).toBe(RCS_AGENT);
      expect(s.messagingProfileId).toBe(MESSAGING_PROFILE);
      for (const sug of s.suggestions ?? []) expect(sug.reply.text.length).toBeLessThanOrEqual(20);
    }
  });

  it('a message to another agent is ignored; a repeated delivery is acted on once; the hourly limit counts both channels', async () => {
    await textAccount(HUSBAND);
    world.telnyx.rcsPhones.add(HUSBAND);
    expect(await rcs(HUSBAND, { text: '9' }, { agentId: 'someone-else' })).toEqual([]);
    expect((await rcs(HUSBAND, { text: '1' }, { eventId: 'same' })).map(m => m.text)[0]).toMatch(/^Recorded: flow /);
    expect(await rcs(HUSBAND, { text: '1' }, { eventId: 'same' })).toEqual([]);
    expect((await householdOf(HUSBAND))!.data.entries).toHaveLength(1);
    world.clock.now += 2 * HOUR;
    let replies = 0;
    for (let i = 0; i < 31; i++) replies += (i % 2 ? await rcs(HUSBAND, { text: '9' }) : await sms(HUSBAND, '9')).length;
    expect(replies).toBe(30);
  });

  it('while RCS is switched off, everything goes by SMS; RCS messages to a saved agent are still answered', async () => {
    await config({ rcsEnabled: false });
    await rcs(WIFE, tap('JOIN'));
    expect(world.telnyx.sent.at(-1)).toMatchObject({ to: WIFE, endpoint: 'sms', text: T.SETUP_START });
    // an agent id that is not saved is never accepted
    const op = await operator();
    expect((await op.put('/api/admin/secrets', { rcsAgentId: null })).status).toBe(200);
    expect(await rcs(WIFE, { text: '9' })).toEqual([]);
  });
});

describe('sign-up by text, and its limits', () => {
  it('by invitation: one reply naming what is missing; JOIN and an invitation word creates the account', async () => {
    await site({ config: { signup: 'invite' } });
    const made = await createInvitationWord(env, { word: 'Spring26', days: 3, maxUses: 2, note: 'shul', now: START });
    expect(made).toMatchObject({ word: 'SPRING26', maxUses: 2 });
    expect(await sms(HUSBAND, 'hello')).toEqual([T.WELCOME_INVITE]);
    expect(await sms(HUSBAND, 'JOIN')).toEqual([]); // one reply a day to a number without an account
    world.clock.now += DAY;
    expect(await sms(HUSBAND, 'JOIN autumn26')).toEqual([T.BAD_INVITATION]);
    expect(await count('households')).toBe(0);
    expect(await sms(HUSBAND, 'join spring26')).toEqual([T.SETUP_START]); // any case
    expect(await sms(WIFE, 'JOIN SPRING26')).toEqual([T.SETUP_START]);
    expect(await count('households')).toBe(2);
    expect(await sms(OTHER, 'JOIN Spring26')).toEqual([T.BAD_INVITATION]); // used up
    expect(await count('households')).toBe(2);
    // the operator sees it among the invitations, used twice
    expect((await (await operator()).get('/api/admin/state')).json.invites).toEqual([]);
    // an expired word
    await createInvitationWord(env, { word: 'WINTER27', days: 1, now: world.clock.now });
    world.clock.now += 2 * DAY;
    expect(await sms(FOURTH, 'JOIN WINTER27')).toEqual([T.BAD_INVITATION]);
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
    expect(await sms(HUSBAND, 'JOIN NOTAWORD')).toEqual([T.BAD_INVITATION]);
    expect(await count('households')).toBe(0);
    expect(await sms(WIFE, 'JOIN purim5787')).toEqual([T.SETUP_START]);
  });

  it('closed: nothing is sent to anyone without an account, whatever they text', async () => {
    await site({ config: { signup: 'closed' } });
    await createInvitationWord(env, { word: 'CLOSED01', now: START });
    for (const t of ['hi', 'JOIN', 'JOIN CLOSED01', 'HELP', '9']) expect(await sms(HUSBAND, t), t).toEqual([]);
    expect(await count('households')).toBe(0);
  });

  it('sign-up by text switched off: nothing is sent and no account is made, in every mode', async () => {
    for (const signup of ['open', 'invite'] as const) {
      await testDb.reset();
      await site({ config: { signup, textSignup: false } });
      for (const t of ['hi', 'JOIN', 'HELP']) expect(await sms(HUSBAND, t), `${signup} ${t}`).toEqual([]);
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

  it('HELP from a number without an account gets the description, within the same limits; STOP gets nothing from the site', async () => {
    await site();
    expect(await sms(HUSBAND, 'STOP')).toEqual([]);
    expect(await sms(HUSBAND, 'HELP', { autoresponseType: 'HELP' })).toEqual([]);
    expect(await sms(HUSBAND, 'HELP')).toEqual([HELP_REPLY]);
    expect(await sms(HUSBAND, 'hello')).toEqual([]);
  });

  it('a JOIN delivered twice creates one account and answers once', async () => {
    await site();
    expect(await sms(WIFE, 'JOIN', { eventId: 'twice' })).toEqual([T.SETUP_START]);
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
    expect(await sms(HUSBAND, 'JOIN')).toEqual([T.SETUP_START]);
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
    expect(await sms('+17327009999', 'JOIN')).toEqual([T.SETUP_START]);
  });
});

describe('adding a phone with a code', () => {
  beforeEach(async () => {
    await site();
    await textAccount(WIFE);
  });

  it('a code works once; then, or after 7 days, it is refused and changes nothing', async () => {
    const code = codeIn((await sms(WIFE, 'ADD'))[0]!);
    expect(await sms(HUSBAND, `JOIN ${code}`)).toEqual([T.joinedText(' with the phone ending 0102')]);
    expect(await sms(OTHER, `JOIN ${code}`)).toEqual([T.BAD_INVITATION]);
    expect(await householdOf(OTHER)).toBeNull();
    expect((await householdOf(WIFE))!.data.phones).toHaveLength(2);

    const late = codeIn((await sms(WIFE, 'ADD'))[0]!);
    world.clock.now += 7 * DAY + MINUTE;
    expect(await sms(FOURTH, `JOIN ${late}`)).toEqual([T.BAD_INVITATION]);
    expect(await householdOf(FOURTH)).toBeNull();
  });

  it('a new code replaces the one before', async () => {
    const first = codeIn((await sms(WIFE, 'ADD'))[0]!);
    const second = codeIn((await sms(WIFE, 'ADD'))[0]!);
    expect(await sms(HUSBAND, `JOIN ${first}`)).toEqual([T.BAD_INVITATION]);
    world.clock.now += DAY;
    expect(await sms(HUSBAND, `JOIN ${second}`)).toEqual([T.joinedText(' with the phone ending 0102')]);
  });

  it('from a number that already has an account: the reply says so, nothing changes, and the code still works', async () => {
    await textAccount(OTHER);
    const code = codeIn((await sms(WIFE, 'ADD'))[0]!);
    expect(await sms(OTHER, `JOIN ${code}`)).toEqual([T.ALREADY_ON_ACCOUNT]);
    expect((await householdOf(WIFE))!.data.phones.map(p => p.number)).toEqual([WIFE]);
    expect((await householdOf(OTHER))!.data.phones.map(p => p.number)).toEqual([OTHER]);
    expect(await sms(HUSBAND, `JOIN ${code}`)).toEqual([T.joinedText(' with the phone ending 0102')]);
  });

  it('works while sign-up is closed or sign-up by text is off, because it adds to an existing account', async () => {
    await config({ signup: 'closed', textSignup: false });
    const code = codeIn((await sms(WIFE, 'ADD'))[0]!);
    expect(await sms(HUSBAND, `JOIN ${code}`)).toEqual([T.joinedText(' with the phone ending 0102')]);
  });

  it('an account that became full in the meantime: the phone is not added, and is told so', async () => {
    const code = codeIn((await sms(WIFE, 'ADD'))[0]!);
    for (const n of [HUSBAND, OTHER, FOURTH]) {
      const c = codeIn((await sms(WIFE, 'ADD'))[0]!);
      expect(await sms(n, `JOIN ${c}`)).toHaveLength(1);
    }
    expect((await householdOf(WIFE))!.data.phones).toHaveLength(4);
    expect(await sms(WIFE, 'ADD')).toEqual(['This account already has 4 phones, the most allowed. Send PHONES to remove one first. Nothing was changed.']);
    const fifth = '+17324440105';
    expect(await sms(fifth, `JOIN ${code}`)).toEqual([T.BAD_INVITATION]); // replaced by the later codes
    expect(await householdOf(fifth)).toBeNull();
    expect(JOIN_FULL.length).toBeLessThanOrEqual(160);
  });

  it('LEAVE and REMOVE by text take a phone off, as on the website', async () => {
    const code = codeIn((await sms(WIFE, 'ADD'))[0]!);
    await sms(HUSBAND, `JOIN ${code}`);
    expect(await sms(HUSBAND, 'LEAVE')).toEqual([T.LEAVE_ASK]);
    expect(await sms(HUSBAND, 'YES')).toEqual([T.LEFT]);
    expect(await householdOf(HUSBAND)).toBeNull();
    expect((await householdOf(WIFE))!.data.phones.map(p => p.number)).toEqual([WIFE]);
    const again = codeIn((await sms(WIFE, 'ADD'))[0]!);
    world.clock.now += DAY;
    await sms(HUSBAND, `JOIN ${again}`);
    await sms(WIFE, 'PHONES');
    expect(await sms(WIFE, 'REMOVE B')).toEqual([T.removeAsk('0101')]);
    expect(await sms(WIFE, 'YES')).toEqual([T.removed('0101')]);
    expect(await householdOf(HUSBAND)).toBeNull();
    expect(await sms(WIFE, 'LEAVE')).toEqual([T.LAST_PHONE]);
  });
});

describe('one account never reaches another by text', () => {
  beforeEach(async () => {
    await site();
    await textAccount(WIFE);
    await textAccount(OTHER);
  });

  it('a text reads and changes only its own phone\'s account', async () => {
    await sms(WIFE, '1 11/19 day');
    expect((await sms(OTHER, '9'))[0]).toMatch(/^Tehorah\./);
    expect((await sms(OTHER, 'HISTORY'))[0]).toBe(T.HISTORY_EMPTY);
    expect((await sms(OTHER, 'PHONES'))[0]).toMatch(/^Phones: A ending 0199 \(this phone, reminders off\)\. /);
    expect(await sms(OTHER, 'ERASE A')).toEqual([T.ERASE_NEEDS_LIST]);
    expect(await sms(OTHER, 'UNDO')).toHaveLength(1);
    expect((await householdOf(WIFE))!.data.entries).toHaveLength(1);
    expect((await householdOf(OTHER))!.data.entries).toHaveLength(0);
  });

  it('a code attaches a phone only to the household that made it', async () => {
    const code = codeIn((await sms(WIFE, 'ADD'))[0]!);
    expect(await sms(OTHER, `JOIN ${code}`)).toEqual([T.ALREADY_ON_ACCOUNT]);
    expect(await sms(HUSBAND, `JOIN ${code}`)).toEqual([T.joinedText(' with the phone ending 0102')]);
    expect((await householdOf(HUSBAND))!.id).toBe((await householdOf(WIFE))!.id);
    expect((await householdOf(OTHER))!.data.phones.map(p => p.number)).toEqual([OTHER]);
    // a code from a deleted account is gone with it
    const code2 = codeIn((await sms(OTHER, 'ADD'))[0]!);
    await sms(OTHER, 'DELETE ACCOUNT');
    await sms(OTHER, 'YES');
    expect(await sms(FOURTH, `JOIN ${code2}`)).toEqual([T.BAD_INVITATION]);
  });

  it('a sign-in link works once, only for the phone and household that asked', async () => {
    const tokenOf = (t: string) => new URL(t.slice(T.WEB_LINK_TEXT.length)).searchParams.get('k')!;
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
    const tokenOf = (t: string) => new URL(t.slice(T.WEB_LINK_TEXT.length)).searchParams.get('k')!;
    const good = tokenOf((await sms(WIFE, 'WEB'))[0]!);
    expect((await c.post('/api/auth/link', { token: good })).status).toBe(400);
    expect((await new Client('203.0.113.71').post('/api/auth/link', { token: good })).status).toBe(200);
  });
});

describe('carrier words in the middle of a conversation', () => {
  it('behave exactly as before, and the question stays open', async () => {
    await site();
    await textAccount(WIFE);
    expect((await sms(WIFE, 'CUSTOMS ALL'))[0]).toMatch(/^Custom 1 of 12: /);
    expect(await sms(WIFE, 'HELP')).toEqual([HELP_REPLY]);
    expect(await sms(WIFE, 'HELP', { autoresponseType: 'HELP' })).toEqual([]);
    expect((await sms(WIFE, 'A'))[0]).toMatch(/^Kept: wait before hefsek: Five days\. Custom 2 of 12: /);
    expect(await sms(WIFE, 'STOP', { autoresponseType: 'STOP' })).toEqual([]);
    expect((await householdOf(WIFE))!.data.phones[0]!.optedOut).toBe(true);
    expect(await sms(WIFE, 'A')).toEqual([]); // not acted on while opted out
    expect(await sms(WIFE, 'START', { autoresponseType: 'START' })).toEqual([]);
    expect((await householdOf(WIFE))!.data.phones[0]!.optedOut).toBe(false);
    expect((await sms(WIFE, 'A'))[0]).toMatch(/^Saved: onah beinonit day: Day 30 only\. Custom 3 of 12: /);
    expect(await sms(WIFE, 'unsubscribe')).toEqual([]);
    expect(await sms(WIFE, 'unstop')).toEqual([]);
    expect((await sms(WIFE, 'KEEP'))[0]).toMatch(/^Kept: onah beinonit length: /);
  });

  it('a phone the carrier says opted out is noted, in a conversation as in a reply', async () => {
    await site();
    await textAccount(WIFE);
    world.telnyx.blocked.add(WIFE);
    expect(await sms(WIFE, 'MENU')).toEqual([]);
    expect((await householdOf(WIFE))!.data.phones[0]!.optedOut).toBe(true);
    const out = (await householdOf(WIFE))!.data.messages.find(m => m.direction === 'out');
    expect(out).toMatchObject({ body: T.MENU, status: 'not sent' });
  });
});

describe('what can be read in the database', () => {
  it('no conversation, code, word, link, number or counter of a stranger is readable', async () => {
    await site({ config: { signup: 'invite' } });
    const word = 'Tishrei87';
    await createInvitationWord(env, { word, now: START });
    await sms(HUSBAND, 'hello'); // a stranger: counters only
    expect(await sms(WIFE, `JOIN ${word}`)).toEqual([T.SETUP_START]);
    expect(await sms(WIFE, '08701')).toHaveLength(2);
    expect((await sms(WIFE, 'B'))[0]).toMatch(/^Custom 1 of 12/); // a pending custom question
    const code = codeIn((await sms(WIFE, 'ADD'))[0]!);
    const web = (await sms(WIFE, 'WEB'))[0]!;
    const token = new URL(web.slice(T.WEB_LINK_TEXT.length)).searchParams.get('k')!;
    expect((await sms(WIFE, 'CUSTOMS ALL'))[0]).toMatch(/^Custom 1 of 12/);
    const h = (await householdOf(WIFE))!;
    expect(h.data.chat?.[WIFE]?.q).toEqual({ kind: 'custom', index: 0, walk: true }); // it is stored, encrypted
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
      '"custom"',
      '"walk"',
      '"zip"',
      '"q"',
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

    expect(await say('hello')).toEqual({ outcome: 'replied', replies: [{ text: WELCOME_OPEN, suggestions: [{ label: 'Join', send: 'JOIN' }] }], householdId: null });
    const joined = await say('JOIN');
    expect(joined).toMatchObject({ outcome: 'created', replies: [{ text: T.SETUP_START }] });
    const h = (await householdOf(FICTIONAL))!;
    expect(h.id).toBe(joined.householdId);
    expect(h.data.demo).toBe(true);
    expect((await say('08701')).replies.map(r => r.text)).toEqual(['Location set: Lakewood, NJ 08701. Sunset and nightfall are now worked out for it.', T.CUSTOMS_INTRO]);
    expect((await say('A')).outcome).toBe('conversed');
    expect((await say('1 11/19 day')).replies[0]!.text).toMatch(/^Recorded: flow Thu Nov 19 by day, 2026\./);
    expect((await say('DONE')).replies).toEqual([{ text: T.SETUP_DONE, suggestions: T.MENU_SUGGEST }]);
    expect((await say('REMINDERS ON')).replies[0]!.text).toBe(T.remindersOn('0142'));
    // a second made-up phone joins with a code
    const code = codeIn((await say('ADD')).replies[0]!.text);
    const spouse = await simulateText(env, world.deps, s, { from: '+17325550143', text: `JOIN ${code}` });
    expect(spouse).toMatchObject({ outcome: 'joined', householdId: h.id });
    // the sign-in link is returned, and works
    const web = (await say('WEB')).replies[0]!.text;
    const token = new URL(web.slice(T.WEB_LINK_TEXT.length)).searchParams.get('k')!;
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
    expect((await say('YES')).replies[0]!.text).toBe(T.DELETED);
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
    expect(await simulateText(env, world.deps, s, { from: FICTIONAL, text: `JOIN ${code}` })).toEqual({ outcome: 'replied', replies: [{ text: T.BAD_INVITATION }], householdId: null });
    expect((await householdOf(WIFE))!.data.phones).toHaveLength(1);
    // and a test account's code cannot bring a real phone in
    await simulateText(env, world.deps, s, { from: FICTIONAL, text: 'JOIN' });
    const demoCode = codeIn((await simulateText(env, world.deps, s, { from: FICTIONAL, text: 'ADD' })).replies[0]!.text);
    expect(await sms(HUSBAND, `JOIN ${demoCode}`)).toEqual([T.BAD_INVITATION]);
    expect(await householdOf(HUSBAND)).toBeNull();
  });
});

describe('the test account\'s text box', () => {
  it('goes through the same conversation, and returns every text that would be sent', async () => {
    const op = await site();
    expect((await op.post('/api/admin/demo')).status).toBe(200);
    const r = await op.post('/api/demo/text', { text: 'MENU' });
    expect(r.status).toBe(200);
    expect(r.json.reply).toBe(T.MENU);
    expect(r.json.replies).toEqual([{ text: T.MENU, suggestions: T.MENU_SUGGEST }]);
    const customs = await op.post('/api/demo/text', { text: 'CUSTOMS ALL' });
    expect(customs.json.replies[0].text).toMatch(/^Custom 1 of 12: /);
    expect(customs.json.replies[0].suggestions.map((s: any) => s.send)).toEqual(['A', 'B', 'KEEP']);
    const add = await op.post('/api/demo/text', { text: 'ADD' });
    expect(add.json.reply).toMatch(/^Have that phone text JOIN [A-Z]{8} to this number within 7 days\./);
    const cal = await op.post('/api/demo/text', { text: 'CALENDAR LINK' });
    expect(cal.json.reply).toMatch(/^Calendar link created: https:\/\/cal\.example\/cal\/[A-Za-z0-9_-]+\.ics /);
    expect(cal.json.state.calendar.link).toBeTruthy();
    const web = await op.post('/api/demo/text', { text: 'WEB' });
    expect(web.json.reply.startsWith(T.WEB_LINK_TEXT)).toBe(true);
    expect(web.json.state.messages[0].body).toBe(`${T.WEB_LINK_TEXT}(link)`); // the link itself is not kept
    // an effect the server cannot carry out: its "could not" text is sent instead, and recorded so
    expect((await op.post('/api/demo/text', { text: 'LEAVE' })).json.reply).toBe(T.LEAVE_ASK);
    const leave = await op.post('/api/demo/text', { text: 'YES' });
    expect(leave.json.replies).toEqual([{ text: T.LEAVE_FAILED }]); // the test phone stays on the test account
    expect(leave.json.state.messages.slice(0, 2).map((m: any) => [m.direction, m.body, m.status])).toEqual([
      ['out', T.LEAVE_FAILED, 'simulated'],
      ['in', 'YES', 'simulated'],
    ]);
    expect(leave.json.state.phones).toHaveLength(2);
    const del = await op.post('/api/demo/text', { text: 'DELETE ACCOUNT' });
    expect(del.json.reply).toBe(T.DELETE_ASK);
    const yes = await op.post('/api/demo/text', { text: 'YES' });
    expect(yes.json).toEqual({ reply: T.DELETED, replies: [{ text: T.DELETED }], signedOut: true });
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
