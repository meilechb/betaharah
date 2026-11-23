/**
 * The server end to end, against a real local database, with stand-ins
 * for Google and Telnyx.
 */
import type { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/app/env';
import { createApp } from '../src/app/index';
import { tick } from '../src/app/service';
import { DEFAULT_APP_SETTINGS, PLACES } from '../src/app/settings';
import { civilToAbs, localToInstant } from '../src/engine/civil';
import { dayTimes } from '../src/engine/zmanim';
import { BASIC } from './helpers';
import { makeEnv, makeWorld, startDb, TEST_PASSWORD, type TestDb, type World } from './fakes';

const TZ = 'America/New_York';
const LAKEWOOD = PLACES[0]!;
const at = (m: number, d: number, hh: number, mi = 0): number => localToInstant({ y: 2026, m, d, hh, mi, ss: 0 }, TZ);
const START = at(11, 23, 10); // Monday 23 November 2026, 10:00
const MON = civilToAbs({ y: 2026, m: 11, d: 23 });
const HUSBAND = '+17325550101';
const WIFE = '+17325550102';
const OUR_NUMBER = '+18885550100';

let testDb: TestDb;
let world: World;
let env: Env;
let app: Hono<{ Bindings: Env }>;
let cookie = '';

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
  cookie = '';
});

interface CallOptions {
  header?: boolean;
  cookie?: string | null;
  env?: Env;
  headers?: Record<string, string>;
  raw?: string;
}

async function call(method: string, path: string, body?: unknown, opts: CallOptions = {}): Promise<{ status: number; json: any; res: Response }> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.header !== false) headers['x-mikvah'] = '1';
  const c = opts.cookie === undefined ? cookie : opts.cookie;
  if (c) headers.cookie = c;
  let payload: string | undefined;
  if (opts.raw !== undefined) payload = opts.raw;
  else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  const res = await app.request(`https://cal.example${path}`, { method, headers, body: payload }, opts.env ?? env);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, res };
}

async function signIn(): Promise<void> {
  const r = await call('POST', '/api/login', { password: TEST_PASSWORD });
  expect(r.status).toBe(200);
  cookie = (r.res.headers.get('set-cookie') ?? '').split(';')[0] as string;
  expect(cookie.startsWith('mk_session=')).toBe(true);
}

const appSettings = (patch: Record<string, unknown> = {}) => ({ ...DEFAULT_APP_SETTINGS, place: LAKEWOOD, ...patch });
const PHONES = [
  { number: HUSBAND, name: 'M', canUpdate: true, reminders: ['hefsek', 'mikvah', 'onah'] },
  { number: WIFE, name: 'R', canUpdate: true, reminders: ['hefsek', 'bedikah_morning', 'bedikah_afternoon', 'mikvah', 'mikvah_confirm', 'onah'] },
];

async function setUp(options: { google?: boolean; sms?: boolean } = {}): Promise<void> {
  await signIn();
  expect((await call('PUT', '/api/app', appSettings({ phones: PHONES }))).status).toBe(200);
  expect((await call('PUT', '/api/halachic', BASIC)).status).toBe(200);
  if (options.sms) {
    const r = await call('PUT', '/api/secrets', { telnyxApiKey: 'telnyx-key', telnyxPublicKey: world.telnyx.publicKey, telnyxNumber: '+1 (888) 555-0100' });
    expect(r.status).toBe(200);
  }
  if (options.google) {
    expect((await call('PUT', '/api/secrets', { googleClientId: 'client-id', googleClientSecret: 'client-secret' })).status).toBe(200);
    const start = await call('GET', '/api/google/start');
    expect(start.status).toBe(302);
    const state = new URL(start.res.headers.get('location') as string).searchParams.get('state') as string;
    const back = await call('GET', `/api/google/callback?code=good-code&state=${encodeURIComponent(state)}`);
    expect(back.status).toBe(302);
    expect(back.res.headers.get('location')).toBe('/?google=connected#settings');
  }
}

async function text(from: string, body: string, eventId: string, to = OUR_NUMBER): Promise<number> {
  const req = await world.telnyx.inbound({ from, to, text: body, eventId, nowMs: world.clock.now });
  const r = await call('POST', '/webhooks/telnyx', undefined, { raw: req.body, headers: req.headers, cookie: null, header: false });
  return r.status;
}

const lastSent = (): { from: string; to: string; text: string } => world.telnyx.sent[world.telnyx.sent.length - 1]!;
const logRows = async (): Promise<Array<{ kind: string; abs: number; part: string | null; source: string; deleted_at: number | null }>> =>
  (await testDb.db.prepare('SELECT kind, abs, part, source, deleted_at FROM log ORDER BY created_at').all<any>()).results;

describe('signing in', () => {
  it('nothing is readable without a session', async () => {
    expect((await call('GET', '/api/session')).json).toEqual({ configured: true, authenticated: false });
    for (const [method, path] of [['GET', '/api/state'], ['PUT', '/api/app'], ['PUT', '/api/halachic'], ['PUT', '/api/secrets'], ['POST', '/api/entries'], ['DELETE', '/api/entries/x'], ['GET', '/api/google/start'], ['GET', '/api/google/callback'], ['POST', '/api/sync'], ['POST', '/api/sms/test'], ['GET', '/api/anything']] as const) {
      expect((await call(method, path, method === 'GET' || method === 'DELETE' ? undefined : {})).status, `${method} ${path}`).toBe(401);
    }
  });

  it('the right password opens a session; the cookie is HttpOnly, Secure and SameSite', async () => {
    const r = await call('POST', '/api/login', { password: TEST_PASSWORD });
    const set = r.res.headers.get('set-cookie') as string;
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/Secure/);
    expect(set).toMatch(/SameSite=Lax/);
    await signIn();
    expect((await call('GET', '/api/session')).json).toEqual({ configured: true, authenticated: true });
    expect((await call('GET', '/api/state')).status).toBe(200);
  });

  it('a wrong password is refused, and eight of them lock sign-in for 15 minutes', async () => {
    for (let i = 0; i < 8; i++) expect((await call('POST', '/api/login', { password: 'wrong' })).status).toBe(401);
    expect((await call('POST', '/api/login', { password: TEST_PASSWORD })).status).toBe(429);
    world.clock.now += 16 * 60_000;
    expect((await call('POST', '/api/login', { password: TEST_PASSWORD })).status).toBe(200);
  });

  it('a forged or expired cookie is refused', async () => {
    await signIn();
    const forged = cookie.slice(0, -6) + 'AAAAAA';
    expect((await call('GET', '/api/state', undefined, { cookie: forged })).status).toBe(401);
    world.clock.now += 31 * 86_400_000;
    expect((await call('GET', '/api/state')).status).toBe(401);
  });

  it('a change without the custom header is refused, so another site cannot make one', async () => {
    await signIn();
    expect((await call('PUT', '/api/app', appSettings(), { header: false })).status).toBe(400);
    expect((await call('POST', '/api/login', { password: TEST_PASSWORD }, { header: false, cookie: null })).status).toBe(400);
  });

  it('signing out ends the session in the browser', async () => {
    await signIn();
    const r = await call('POST', '/api/logout');
    expect(r.res.headers.get('set-cookie')).toMatch(/mk_session=;.*Max-Age=0/);
  });

  it('refuses to work until a password and key are set', async () => {
    const bare = makeEnv(testDb.db, { DASHBOARD_PASSWORD: 'short' });
    expect((await call('GET', '/api/session', undefined, { env: bare })).json).toEqual({ configured: false, authenticated: false });
    expect((await call('POST', '/api/login', { password: 'short' }, { env: bare })).status).toBe(503);
    expect((await call('POST', '/webhooks/telnyx', {}, { env: bare })).status).toBe(503);
  });
});

describe('settings', () => {
  beforeEach(signIn);

  it('starts with nothing set, and says so', async () => {
    const s = (await call('GET', '/api/state')).json;
    expect(s.status).toBeNull();
    expect(s.app.place).toBeNull();
    expect(s.alerts.map((a: any) => a.text).join(' ')).toContain('No location is set yet');
    expect(s.alerts.map((a: any) => a.text).join(' ')).toContain('ההגדרות ההלכתיות טרם אושרו');
    expect(s.halachic.choices.length).toBe(11);
    expect(s.places.length).toBeGreaterThan(10);
  });

  it('saving a location makes the calculation possible', async () => {
    const s = (await call('PUT', '/api/app', appSettings())).json;
    expect(s.status).toEqual({ headline: 'טהורה', detail: '' });
    expect(s.today).toEqual({ hebrew: 'יום שני, י״ג כסלו תשפ״ז', civil: 'יום שני 23.11.2026', onah: 'יום' });
    expect(s.timeZone).toBe(TZ);
  });

  it('refuses a location where the times cannot be calculated, and keeps the old one', async () => {
    await call('PUT', '/api/app', appSettings());
    const r = await call('PUT', '/api/app', appSettings({ place: { name: 'Tromso', latitude: 69.65, longitude: 18.96, timeZone: 'Europe/Oslo', elevation: 0 } }));
    expect(r.status).toBe(400);
    expect(r.json.error).toContain('sun does not rise or set');
    expect((await call('GET', '/api/state')).json.app.place.name).toBe('Lakewood, NJ');
    expect((await call('PUT', '/api/app', appSettings({ calendar: { style: 'x', historyDays: 400 } }))).status).toBe(400);
  });

  it('saving the halachic settings records that they were reviewed', async () => {
    const s = (await call('PUT', '/api/halachic', { ...BASIC, orZarua: 'yes' })).json;
    expect(s.halachic.confirmedAt).toBe(START);
    expect(s.halachic.settings.orZarua).toBe('yes');
    expect(s.alerts.map((a: any) => a.text).join(' ')).not.toContain('טרם אושרו');
    expect((await call('PUT', '/api/halachic', { ...BASIC, minWaitDays: '6' })).status).toBe(400);
    expect((await call('GET', '/api/state')).json.halachic.settings.minWaitDays).toBe('5');
  });

  it('keys are stored encrypted and never sent back', async () => {
    const r = await call('PUT', '/api/secrets', { telnyxApiKey: 'KEY_SUPER_SECRET', googleClientSecret: 'GOOGLE_SUPER_SECRET', googleRefreshToken: 'injected' });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.json)).not.toContain('SUPER_SECRET');
    expect(r.json.connections.secretsSet).toMatchObject({ telnyxApiKey: true, googleClientSecret: true, googleRefreshToken: false, telnyxNumber: false });
    const rows = (await testDb.db.prepare('SELECT key, value FROM kv').all<{ key: string; value: string }>()).results;
    expect(JSON.stringify(rows)).not.toContain('SUPER_SECRET');
    // clearing one
    const cleared = await call('PUT', '/api/secrets', { telnyxApiKey: '' });
    expect(cleared.json.connections.secretsSet.telnyxApiKey).toBe(false);
    expect(cleared.json.connections.secretsSet.googleClientSecret).toBe(true);
    expect((await call('PUT', '/api/secrets', { telnyxNumber: '888-555' })).status).toBe(400);
  });

  it('shows the addresses to give to Google and Telnyx', async () => {
    const s = (await call('GET', '/api/state')).json;
    expect(s.connections.redirectUri).toBe('https://cal.example/api/google/callback');
    expect(s.connections.webhookUrl).toBe('https://cal.example/webhooks/telnyx');
  });
});

describe('recording from the dashboard', () => {
  beforeEach(() => setUp());

  it('a flow now', async () => {
    const r = await call('POST', '/api/entries', { kind: 'flow', when: 'now' });
    expect(r.status).toBe(200);
    expect(r.json.message).toBe('Recorded: flow Mon Nov 23 by day. Hefsek from Fri Nov 27. 0 to undo.');
    expect(r.json.state.status.headline).toBe('נדה, קודם הפסק טהרה');
    expect(r.json.state.entries).toHaveLength(1);
    expect(r.json.state.entries[0].text).toBe('ראייה: יום שני, י״ג כסלו תשפ״ז, עונת היום');
    expect(r.json.state.entries[0].source).toBe('dashboard');
    const titles = r.json.state.upcoming.map((e: any) => e.title);
    expect(titles).toContain('שבעה נקיים: יום א׳ (משוער)');
    expect(titles.some((t: string) => t.startsWith('הפסק טהרה (עד 16:'))).toBe(true);
    expect(await logRows()).toEqual([{ kind: 'flow', abs: MON, part: 'day', source: 'dashboard', deleted_at: null }]);
  });

  it('the same thing twice is refused', async () => {
    await call('POST', '/api/entries', { kind: 'flow', when: 'now' });
    const again = await call('POST', '/api/entries', { kind: 'flow', when: 'now' });
    expect(again.status).toBe(400);
    expect(again.json.error).toBe('Already recorded.');
    expect(await logRows()).toHaveLength(1);
  });

  it('entries that make no sense are refused and not saved', async () => {
    expect((await call('POST', '/api/entries', { kind: 'hefsek', when: 'now' })).json.error).toBe('Not recorded: no period is open. Send 1 or 5 first.');
    expect((await call('POST', '/api/entries', { kind: 'mikvah', when: 'now' })).json.error).toBe('Not recorded: no period is open.');
    await call('POST', '/api/entries', { kind: 'flow', when: 'now' });
    // by day, "immersed now" means last night, which was before the flow
    expect((await call('POST', '/api/entries', { kind: 'mikvah', when: 'now' })).json.error).toBe('Not recorded: no period is open.');
    // an immersion dated after the flow, with no hefsek
    expect((await call('POST', '/api/entries', { kind: 'mikvah', date: '2026-11-23' })).json.error).toBe('Not recorded: that time has not come yet.');
    world.clock.now = at(11, 23, 20);
    expect((await call('POST', '/api/entries', { kind: 'mikvah', when: 'now' })).json.error).toBe('Not recorded: no hefsek is recorded. Send 2 first.');
    world.clock.now = START;
    expect((await call('POST', '/api/entries', { kind: 'broken', when: 'now' })).json.error).toBe('Not recorded: there is no count in progress.');
    expect((await call('POST', '/api/entries', { kind: 'hefsek', date: '2026-11-27' })).json.error).toBe('Not recorded: that time has not come yet.');
    expect((await call('POST', '/api/entries', { kind: 'flow', date: '2026-11-24', part: 'day' })).json.error).toBe('Not recorded: that time has not come yet.');
    expect((await call('POST', '/api/entries', { kind: 'flow', date: '2026-02-30', part: 'day' })).status).toBe(400);
    expect((await call('POST', '/api/entries', { kind: 'flow', date: '2026-11-20' })).status).toBe(400);
    expect((await call('POST', '/api/entries', { kind: 'party', when: 'now' })).status).toBe(400);
    expect(await logRows()).toHaveLength(1);
  });

  it('a whole period, with the immersion refused until the count is complete', async () => {
    await call('POST', '/api/entries', { kind: 'flow', when: 'now' });
    world.clock.now = at(11, 27, 15);
    const h = await call('POST', '/api/entries', { kind: 'hefsek', when: 'now' });
    expect(h.json.message).toMatch(/^Recorded: hefsek Fri Nov 27\. Clean days Sat Nov 28 - Fri Dec 4\. Mikvah Fri Dec 4 after 5:\d\d PM\. 0 to undo\.$/);
    expect(h.json.state.status.headline).toBe('לאחר הפסק טהרה');
    world.clock.now = at(11, 30, 12);
    expect((await call('GET', '/api/state')).json.status.headline).toBe('שבעה נקיים: יום ג׳');
    const early = await call('POST', '/api/entries', { kind: 'mikvah', when: 'now' });
    expect(early.json.error).toMatch(/^Not recorded: the count is not complete\. Mikvah night is Fri Dec 4 after 5:\d\d PM\.$/);
    world.clock.now = at(12, 4, 20);
    expect((await call('GET', '/api/state')).json.status.headline).toBe('ליל טבילה');
    const m = await call('POST', '/api/entries', { kind: 'mikvah', when: 'now' });
    expect(m.json.message).toBe('Recorded: mikvah Fri Dec 4 night. 0 to undo.');
    expect(m.json.state.status.headline).toBe('טהורה');
  });

  it('a past flow by date and onah, or by date and time', async () => {
    const night = await call('POST', '/api/entries', { kind: 'flow', date: '2026-11-21', part: 'night' });
    expect(night.json.message).toContain('Recorded: flow Sat Nov 21 night.');
    expect((await logRows())[0]).toMatchObject({ abs: MON - 1, part: 'night' }); // Saturday night belongs to Sunday
    const timed = await call('POST', '/api/entries', { kind: 'stain', date: '2026-10-20', time: '21:30' });
    expect(timed.status).toBe(200);
    expect((await logRows())[1]).toMatchObject({ kind: 'stain', abs: civilToAbs({ y: 2026, m: 10, d: 21 }), part: 'night' });
    const day = await call('POST', '/api/entries', { kind: 'flow', date: '2026-09-20', time: '11:00', veset: false, note: 'per rav' });
    expect(day.json.state.entries.some((e: any) => e.text.includes('אינה לחשבון הוסתות') && e.note === 'per rav')).toBe(true);
  });

  it('a hefsek recorded after midnight is yesterday\'s', async () => {
    await call('POST', '/api/entries', { kind: 'flow', when: 'now' });
    world.clock.now = at(11, 28, 0, 30); // half past midnight, Friday night
    const h = await call('POST', '/api/entries', { kind: 'hefsek', when: 'now' });
    expect(h.json.message).toMatch(/^Recorded: hefsek Fri Nov 27\./);
  });

  it('an entry can be removed', async () => {
    const r = await call('POST', '/api/entries', { kind: 'flow', when: 'now' });
    const id = r.json.state.entries[0].id;
    const removed = await call('DELETE', `/api/entries/${id}`);
    expect(removed.json.status.headline).toBe('טהורה');
    expect(removed.json.entries).toEqual([]);
    expect((await logRows())[0]!.deleted_at).toBe(START); // kept in the database, marked removed
    expect((await call('DELETE', `/api/entries/${id}`)).status).toBe(404);
  });

  it('nothing can be recorded before a location is set', async () => {
    await call('PUT', '/api/app', { ...DEFAULT_APP_SETTINGS, place: null });
    const r = await call('POST', '/api/entries', { kind: 'flow', when: 'now' });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain('set the location');
  });
});

describe('Google Calendar', () => {
  it('needs the client ID and secret before connecting', async () => {
    await setUp();
    expect((await call('GET', '/api/google/start')).status).toBe(400);
  });

  it('sends the browser to Google with the right request', async () => {
    await setUp();
    await call('PUT', '/api/secrets', { googleClientId: 'client-id', googleClientSecret: 'client-secret' });
    const r = await call('GET', '/api/google/start');
    const u = new URL(r.res.headers.get('location') as string);
    expect(u.hostname).toBe('accounts.google.com');
    expect(u.searchParams.get('client_id')).toBe('client-id');
    expect(u.searchParams.get('redirect_uri')).toBe('https://cal.example/api/google/callback');
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.app.created');
  });

  it('refuses a return from Google that it did not start, or that failed', async () => {
    await setUp();
    await call('PUT', '/api/secrets', { googleClientId: 'client-id', googleClientSecret: 'client-secret' });
    const forged = await call('GET', '/api/google/callback?code=good-code&state=forged');
    expect(forged.res.headers.get('location')).toContain('google_error=');
    const start = await call('GET', '/api/google/start');
    const state = new URL(start.res.headers.get('location') as string).searchParams.get('state') as string;
    const denied = await call('GET', `/api/google/callback?error=access_denied&state=${encodeURIComponent(state)}`);
    expect(denied.res.headers.get('location')).toContain('google_error=');
    const badCode = await call('GET', `/api/google/callback?code=bad&state=${encodeURIComponent(state)}`);
    expect(badCode.res.headers.get('location')).toContain('google_error=');
    world.clock.now += 11 * 60_000; // the state is good for 10 minutes
    const late = await call('GET', `/api/google/callback?code=good-code&state=${encodeURIComponent(state)}`);
    expect(late.res.headers.get('location')).toContain('google_error=');
    expect(world.google.calendars.size).toBe(0);
    expect((await call('GET', '/api/state')).json.connections.google.connected).toBe(false);
  });

  it('connecting creates one calendar in the location\'s time zone', async () => {
    await setUp({ google: true });
    expect(world.google.calendars.size).toBe(1);
    const cal = [...world.google.calendars.values()][0]!;
    expect(cal).toMatchObject({ summary: 'בטהרה', timeZone: TZ });
    const s = (await call('GET', '/api/state')).json;
    expect(s.connections.google.connected).toBe(true);
    expect(JSON.stringify(s)).not.toContain('refresh-1');
    // connecting again reuses the calendar
    const start = await call('GET', '/api/google/start');
    const state = new URL(start.res.headers.get('location') as string).searchParams.get('state') as string;
    await call('GET', `/api/google/callback?code=good-code&state=${encodeURIComponent(state)}`);
    expect(world.google.calendars.size).toBe(1);
  });

  it('writes the events, changes nothing when nothing changed, and follows later changes', async () => {
    await setUp({ google: true });
    await call('POST', '/api/entries', { kind: 'flow', when: 'now' }); // syncs
    const first = world.google.events();
    // the flow, the hefsek, seven days, the immersion, and two onot (day 30 and the 12th of Tevet)
    expect(first).toHaveLength(12);
    for (const e of first) {
      expect(e.resource.extendedProperties.private.mk).toBe('1');
      expect(e.resource.transparency).toBe('transparent');
    }
    expect(first.map(e => e.resource.summary)).toContain('שבעה נקיים: יום ז׳ (משוער)');
    expect(first.find(e => e.resource.summary === 'ראייה (יום)')).toBeDefined();
    const allDay = first.find(e => e.resource.summary === 'שבעה נקיים: יום א׳ (משוער)')!;
    expect(allDay.resource.start).toEqual({ date: '2026-11-28' });
    expect(allDay.resource.end).toEqual({ date: '2026-11-29' });

    const idsBefore = first.map(e => e.id).sort();
    world.google.calls = [];
    const again = await call('POST', '/api/sync');
    expect(again.json.outcome).toEqual({ status: 'ok', result: { inserted: 0, updated: 0, deleted: 0, remaining: 0 } });
    expect(world.google.calls.filter(c => /^(POST|PUT|DELETE) /.test(c))).toEqual([]);
    expect(world.google.events().map(e => e.id).sort()).toEqual(idsBefore);

    // the hefsek is recorded: the same events are updated in place, none duplicated
    world.clock.now = at(11, 27, 15);
    await call('POST', '/api/entries', { kind: 'hefsek', when: 'now' });
    const after = world.google.events();
    expect(after).toHaveLength(12);
    expect(after.map(e => e.id).sort()).toEqual(idsBefore);
    expect(after.map(e => e.resource.summary)).toContain('הפסק טהרה ✓');
    expect(after.map(e => e.resource.summary)).toContain('שבעה נקיים: יום א׳');
    expect(after.some(e => e.resource.summary.includes('משוער'))).toBe(false);
    expect((await call('GET', '/api/state')).json.sync).toMatchObject({ dirty: false, lastError: null });
  });

  it('removes events that no longer apply, and never touches an event added by hand', async () => {
    await setUp({ google: true });
    const r = await call('POST', '/api/entries', { kind: 'flow', when: 'now' });
    const calId = [...world.google.calendars.keys()][0]!;
    world.google.calendars.get(calId)!.events.push({ id: 'mine', resource: { summary: 'Dentist', description: '', start: { date: '2026-12-01' }, end: { date: '2026-12-02' }, transparency: 'transparent', colorId: '1', reminders: { useDefault: true }, extendedProperties: { private: {} } } });
    await call('DELETE', `/api/entries/${r.json.state.entries[0].id}`);
    expect(world.google.events().map(e => e.id)).toEqual(['mine']);
  });

  it('removes a duplicate if Google ends up with two copies of an event', async () => {
    await setUp({ google: true });
    await call('POST', '/api/entries', { kind: 'flow', when: 'now' });
    const events = world.google.events();
    events.push({ id: 'copy', resource: structuredClone(events[0]!.resource) });
    await call('POST', '/api/sync');
    expect(world.google.events()).toHaveLength(12);
  });

  it('a discreet calendar has no Hebrew words', async () => {
    await setUp({ google: true });
    await call('PUT', '/api/app', appSettings({ phones: PHONES, calendar: { style: 'discreet', historyDays: 400 } }));
    await call('POST', '/api/entries', { kind: 'flow', when: 'now' });
    for (const e of world.google.events()) {
      expect(e.resource.summary).not.toMatch(/[֐-׿]/);
      expect(e.resource.description).toBe('');
    }
  });

  it('a long history is written over several runs, a limited number of changes each', async () => {
    await setUp({ google: true });
    let abs = MON - 280;
    for (let k = 0; k < 9; k++) {
      const c = new Date((abs - 719_163) * 86_400_000).toISOString().slice(0, 10);
      world.clock.now = at(11, 23, 10) + k; // distinct recording times
      // record without syncing each time: write straight to the log
      await testDb.db.prepare("INSERT INTO log (id, kind, abs, part, veset, source, created_at) VALUES (?, 'flow', ?, 'day', 1, 'test', ?)").bind(`f${k}`, abs, world.clock.now).run();
      await testDb.db.prepare("INSERT INTO log (id, kind, abs, veset, source, created_at) VALUES (?, 'hefsek', ?, 0, 'test', ?)").bind(`h${k}`, abs + 5, world.clock.now).run();
      await testDb.db.prepare("INSERT INTO log (id, kind, abs, veset, source, created_at) VALUES (?, 'mikvah', ?, 0, 'test', ?)").bind(`m${k}`, abs + 13, world.clock.now).run();
      expect(c).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      abs += 28 + (k % 3);
    }
    const one = (await call('POST', '/api/sync')).json;
    expect(one.outcome.result.inserted).toBe(35);
    expect(one.outcome.result.remaining).toBeGreaterThan(0);
    expect(one.state.sync.dirty).toBe(true);
    let runs = 1;
    while ((await call('GET', '/api/state')).json.sync.dirty && runs < 20) {
      await call('POST', '/api/sync');
      runs++;
    }
    expect(runs).toBeGreaterThan(1);
    const final = (await call('POST', '/api/sync')).json;
    expect(final.outcome.result).toEqual({ inserted: 0, updated: 0, deleted: 0, remaining: 0 });
    const keys = world.google.events().map(e => e.resource.extendedProperties.private.k);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter(k => k!.startsWith('mikvah:'))).toHaveLength(9);
  });

  it('reports it plainly when Google no longer accepts the sign-in', async () => {
    await setUp({ google: true });
    world.google.refreshTokenValid = false;
    const r = (await call('POST', '/api/sync')).json;
    expect(r.outcome.status).toBe('error');
    expect(r.state.sync.lastError).toContain('Connect Google Calendar again');
    expect(r.state.alerts.map((a: any) => a.text).join(' ')).toContain('Connect Google Calendar again');
    world.google.refreshTokenValid = true;
    expect((await call('POST', '/api/sync')).json.state.sync.lastError).toBeNull();
  });

  it('disconnecting forgets the sign-in but leaves the calendar', async () => {
    await setUp({ google: true });
    const s = (await call('POST', '/api/google/disconnect')).json;
    expect(s.connections.google.connected).toBe(false);
    expect(s.connections.secretsSet.googleRefreshToken).toBe(false);
    expect(world.google.calendars.size).toBe(1);
    expect((await call('POST', '/api/sync')).json.outcome).toEqual({ status: 'not_connected' });
  });

  it('makes no request to anywhere but Google and Telnyx', async () => {
    await setUp({ google: true, sms: true });
    await call('POST', '/api/entries', { kind: 'flow', when: 'now' });
    expect(world.unexpected).toEqual([]);
  });
});

describe('text messages', () => {
  it('the webhook does nothing until text messaging is set up', async () => {
    await setUp();
    expect(await text(HUSBAND, '1', 'e1')).toBe(503);
  });

  it('"1" from an allowed phone records a flow and is confirmed by text', async () => {
    await setUp({ sms: true });
    expect(await text(HUSBAND, '1', 'e1')).toBe(200);
    expect(await logRows()).toEqual([{ kind: 'flow', abs: MON, part: 'day', source: `sms:${HUSBAND}`, deleted_at: null }]);
    expect(world.telnyx.sent).toEqual([{ from: OUR_NUMBER, to: HUSBAND, text: 'Recorded: flow Mon Nov 23 by day. Hefsek from Fri Nov 27. 0 to undo.' }]);
  });

  it('a message delivered twice is handled once', async () => {
    await setUp({ sms: true });
    await text(HUSBAND, '1', 'same-event');
    expect(await text(HUSBAND, '1', 'same-event')).toBe(200);
    expect(await logRows()).toHaveLength(1);
    expect(world.telnyx.sent).toHaveLength(1);
  });

  it('both spouses texting the same thing gives one entry', async () => {
    await setUp({ sms: true });
    await text(HUSBAND, '1', 'e1');
    await text(WIFE, '1', 'e2');
    expect(await logRows()).toHaveLength(1);
    expect(lastSent()).toMatchObject({ to: WIFE, text: 'Already recorded.' });
  });

  it('a stranger, or a phone not allowed to record, gets no reply and changes nothing', async () => {
    await setUp({ sms: true });
    expect(await text('+19995550000', '1', 'e1')).toBe(200);
    await call('PUT', '/api/app', appSettings({ phones: [{ ...PHONES[0], canUpdate: false }] }));
    expect(await text(HUSBAND, '1', 'e2')).toBe(200);
    expect(await logRows()).toEqual([]);
    expect(world.telnyx.sent).toEqual([]);
    const statuses = (await testDb.db.prepare("SELECT status FROM sms WHERE direction = 'in'").all<{ status: string }>()).results.map(r => r.status);
    expect(statuses).toEqual(['ignored', 'ignored']);
  });

  it('a forged webhook is refused', async () => {
    await setUp({ sms: true });
    const req = await world.telnyx.inbound({ from: HUSBAND, to: OUR_NUMBER, text: '1', eventId: 'e1', nowMs: world.clock.now });
    const tampered = await call('POST', '/webhooks/telnyx', undefined, { raw: req.body.replace('"text":"1"', '"text":"4"'), headers: req.headers, cookie: null, header: false });
    expect(tampered.status).toBe(401);
    const unsigned = await call('POST', '/webhooks/telnyx', undefined, { raw: req.body, headers: { 'content-type': 'application/json' }, cookie: null, header: false });
    expect(unsigned.status).toBe(401);
    expect(await logRows()).toEqual([]);
    expect(world.telnyx.sent).toEqual([]);
  });

  it('a message to some other number is ignored', async () => {
    await setUp({ sms: true });
    expect(await text(HUSBAND, '1', 'e1', '+18885559999')).toBe(200);
    expect(await logRows()).toEqual([]);
  });

  it('a message that is not understood changes nothing and says so', async () => {
    await setUp({ sms: true });
    await text(HUSBAND, 'period started', 'e1');
    expect(await logRows()).toEqual([]);
    expect(lastSent().text).toMatch(/^Not understood; nothing was changed\. 1 flow began/);
    await text(HUSBAND, '?', 'e2');
    expect(lastSent().text).toMatch(/^1 flow began, 2 hefsek done/);
  });

  it('a whole cycle by text, with status and undo', async () => {
    await setUp({ sms: true, google: true });
    await text(WIFE, '9', 'a');
    expect(lastSent().text).toBe('Tehorah.');
    // Sunday night at 9 pm, reported on Monday morning
    await text(WIFE, '1 9pm', 'b');
    expect(lastSent().text).toBe('Recorded: flow Sun Nov 22 night. Hefsek from Fri Nov 27. 0 to undo.');
    expect((await logRows())[0]).toMatchObject({ abs: MON, part: 'night' });
    expect(world.google.events().length).toBeGreaterThan(0); // the calendar followed
    // too early for the hefsek? It is recorded, with the caution.
    world.clock.now = at(11, 26, 15);
    await text(WIFE, '2', 'c');
    expect(lastSent().text).toMatch(/^Recorded: hefsek Thu Nov 26\. Clean days Sat Nov 28 - Fri Dec 4\. .*It was before the wait ended; ask a rav\. 0 to undo\.$/);
    await text(WIFE, '0', 'd');
    expect(lastSent().text).toMatch(/^Removed: hefsek Thu Nov 26\. Niddah since/);
    world.clock.now = at(11, 27, 15, 30);
    await text(WIFE, '2', 'e');
    expect(lastSent().text).toMatch(/^Recorded: hefsek Fri Nov 27\. Clean days Sat Nov 28 - Fri Dec 4\. Mikvah Fri Dec 4 after 5:\d\d PM\. 0 to undo\.$/);
    world.clock.now = at(11, 30, 9);
    await text(HUSBAND, '9', 'f');
    expect(lastSent()).toMatchObject({ to: HUSBAND });
    expect(lastSent().text).toMatch(/^Clean day 3 of 7\. Mikvah Fri Dec 4 after 5:\d\d PM\.$/);
    await text(WIFE, '4', 'g');
    expect(lastSent().text).toMatch(/^Not recorded: the count is not complete\./);
    // Saturday night after Shabbat: "4 yesterday" for Friday night
    world.clock.now = at(12, 5, 19);
    await text(WIFE, '4 yesterday', 'h');
    expect(lastSent().text).toBe('Recorded: mikvah Fri Dec 4 night. 0 to undo.');
    await text(WIFE, '9', 'i');
    expect(lastSent().text).toMatch(/^Tehorah\. Next onah: /);
    expect((await logRows()).filter(r => r.deleted_at === null).map(r => r.kind)).toEqual(['flow', 'hefsek', 'mikvah']);
    expect(world.google.events().map(e => e.resource.summary)).toContain('טבילה ✓');
    expect(world.unexpected).toEqual([]);
  });

  it('a flow just after sunset is recorded as night and the reply says how to correct it', async () => {
    await setUp({ sms: true });
    const sunset = dayTimes(MON, { latitude: LAKEWOOD.latitude, longitude: LAKEWOOD.longitude, timeZone: TZ }, { useElevation: false, tzeit: BASIC.tzeit }).sunset;
    world.clock.now = sunset + 6 * 60_000;
    await text(WIFE, '1', 'a');
    expect((await logRows())[0]).toMatchObject({ abs: MON + 1, part: 'night' });
    expect(lastSent().text).toMatch(/Counted as night \(sunset was 4:3\d PM\)\. If it began before sunset send 0, then the same with: day\./);
    await text(WIFE, '0', 'b');
    await text(WIFE, '1 day', 'c');
    expect((await logRows()).filter(r => r.deleted_at === null)).toEqual([{ kind: 'flow', abs: MON, part: 'day', source: `sms:${WIFE}`, deleted_at: null }]);
  });

  it('undo reaches back 48 hours and no further', async () => {
    await setUp({ sms: true });
    await text(WIFE, '1', 'a');
    world.clock.now += 49 * 3_600_000;
    await text(WIFE, '0', 'b');
    expect(lastSent().text).toBe('Nothing recent to undo. Older entries can be removed in the dashboard.');
    expect((await logRows())[0]!.deleted_at).toBeNull();
  });

  it('a flood of messages from one phone stops being processed', async () => {
    await setUp({ sms: true });
    for (let i = 0; i < 40; i++) await text(HUSBAND, '9', `flood-${i}`);
    expect(world.telnyx.sent.length).toBeLessThanOrEqual(31);
    expect(world.telnyx.sent.length).toBeGreaterThanOrEqual(30);
  });

  it('a test message can be sent to a saved phone only', async () => {
    await setUp({ sms: true });
    expect((await call('POST', '/api/sms/test', { to: HUSBAND })).status).toBe(200);
    expect(lastSent()).toMatchObject({ to: HUSBAND, from: OUR_NUMBER });
    expect((await call('POST', '/api/sms/test', { to: '+19995550000' })).status).toBe(400);
    world.telnyx.failNext = 1;
    const failed = await call('POST', '/api/sms/test', { to: HUSBAND });
    expect(failed.status).toBe(502);
    expect(failed.json.state.sms[0]).toMatchObject({ direction: 'out', status: 'failed', peer: HUSBAND });
    expect(failed.json.state.sms[0].detail).toContain('Telnyx 422');
  });
});

describe('reminders and the periodic job', () => {
  const sunsetOf = (abs: number): number => dayTimes(abs, { latitude: LAKEWOOD.latitude, longitude: LAKEWOOD.longitude, timeZone: TZ }, { useElevation: false, tzeit: BASIC.tzeit }).sunset;

  it('sends each reminder once, at its time, to the phones that asked for that kind', async () => {
    await setUp({ sms: true });
    await text(WIFE, '1', 'a');
    world.telnyx.sent = [];
    const due = sunsetOf(MON + 4) - 120 * 60_000; // hefsek reminder: two hours before sunset on Friday
    world.clock.now = due - 60_000;
    await tick(env, world.deps);
    expect(world.telnyx.sent).toEqual([]);
    world.clock.now = due + 60_000;
    await tick(env, world.deps);
    expect(world.telnyx.sent.map(m => m.to).sort()).toEqual([HUSBAND, WIFE]);
    expect(world.telnyx.sent[0]!.text).toMatch(/^Hefsek tahara: Fri Nov 27, before sunset at 4:3\d PM\. Before candle lighting if possible\. Reply 2 when done\.$/);
    world.clock.now += 5 * 60_000;
    await tick(env, world.deps);
    await tick(env, world.deps);
    expect(world.telnyx.sent).toHaveLength(2);
  });

  it('bedikah reminders go only to the phone that asked for them', async () => {
    await setUp({ sms: true });
    await text(WIFE, '1', 'a');
    world.clock.now = at(11, 27, 15);
    await text(WIFE, '2', 'b');
    world.telnyx.sent = [];
    world.clock.now = at(11, 29, 8, 2); // Sunday 8:02, clean day 2
    await tick(env, world.deps);
    expect(world.telnyx.sent).toHaveLength(1);
    expect(world.telnyx.sent[0]).toMatchObject({ to: WIFE });
    expect(world.telnyx.sent[0]!.text).toMatch(/^Clean day 2 of 7 is Sun Nov 29: bedikah in the morning/);
  });

  it('a reminder that failed to send is tried again; one that is hours late is dropped', async () => {
    await setUp({ sms: true });
    await text(WIFE, '1', 'a');
    world.telnyx.sent = [];
    const due = sunsetOf(MON + 4) - 120 * 60_000;
    world.clock.now = due + 60_000;
    world.telnyx.failNext = 2;
    await tick(env, world.deps);
    expect(world.telnyx.sent).toEqual([]);
    world.clock.now += 5 * 60_000;
    await tick(env, world.deps);
    expect(world.telnyx.sent).toHaveLength(2);
    // a different day, found late: Saturday's reminder (moved to Friday) is long past by Sunday
    world.telnyx.sent = [];
    world.clock.now = at(11, 29, 23);
    await tick(env, world.deps);
    expect(world.telnyx.sent.every(m => !m.text.includes('Sat Nov 28'))).toBe(true);
  });

  it('nothing is sent on Shabbat, not even a reminder that is overdue', async () => {
    await setUp({ sms: true });
    await text(WIFE, '1', 'a');
    // The hefsek is recorded at 3 pm on Friday. Saturday's reminder, which is
    // sent on Friday afternoon instead, was due a few minutes earlier.
    world.clock.now = at(11, 27, 15);
    await text(WIFE, '2', 'b');
    world.telnyx.sent = [];
    const fridaySunset = sunsetOf(MON + 4);
    const saturdayNightfall = dayTimes(MON + 5, { latitude: LAKEWOOD.latitude, longitude: LAKEWOOD.longitude, timeZone: TZ }, { useElevation: false, tzeit: BASIC.tzeit }).tzeit;
    for (let t = fridaySunset - 18 * 60_000; t < saturdayNightfall; t += 5 * 60_000) {
      world.clock.now = t;
      await tick(env, world.deps);
    }
    expect(world.telnyx.sent).toEqual([]);
  });

  it('a reminder for Shabbat that became due late on Friday is sent at once, before candle lighting', async () => {
    await setUp({ sms: true });
    await text(WIFE, '1', 'a');
    world.clock.now = at(11, 27, 15);
    await text(WIFE, '2', 'b');
    world.telnyx.sent = [];
    world.clock.now = at(11, 27, 15, 5);
    expect(world.clock.now).toBeLessThan(sunsetOf(MON + 4) - 18 * 60_000);
    await tick(env, world.deps);
    expect(world.telnyx.sent).toHaveLength(1);
    expect(world.telnyx.sent[0]).toMatchObject({ to: WIFE });
    expect(world.telnyx.sent[0]!.text).toMatch(/^Clean day 1 of 7 is Sat Nov 28: bedikah in the morning and again before sunset at 4:3\d PM\. Required on this day\.$/);
    // and the check after an immersion on Friday night waits until Shabbat is over
    world.telnyx.sent = [];
  });

  it('the job also brings the calendar up to date, and refreshes it a few times a day', async () => {
    await setUp({ google: true, sms: true });
    await testDb.db.prepare("INSERT INTO log (id, kind, abs, part, veset, source, created_at) VALUES ('f', 'flow', ?, 'day', 1, 'test', ?)").bind(MON, START).run();
    await tick(env, world.deps);
    expect(world.google.events()).toHaveLength(12);
    world.google.calls = [];
    world.clock.now += 5 * 60_000;
    await tick(env, world.deps);
    expect(world.google.calls).toEqual([]); // nothing changed, not due
    // no hefsek by Saturday: the projected dates move, and the refresh picks that up
    world.clock.now = at(11, 28, 9);
    await tick(env, world.deps);
    const hefsek = world.google.events().find(e => e.resource.summary.startsWith('הפסק טהרה'))!;
    expect((hefsek.resource.end as { dateTime: string }).dateTime.slice(0, 10)).toBe('2026-11-28');
    expect(world.unexpected).toEqual([]);
  });
});
