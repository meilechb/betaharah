/** Stand-ins for Google and Telnyx, and a local database, for the server tests. */
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { toBase64 } from '../src/app/crypto';
import type { Deps, Env } from '../src/app/env';
import type { EventResource } from '../src/app/google';
import { ensureSchema, TABLES } from '../src/app/schema';

export interface TestDb {
  db: D1Database;
  reset: () => Promise<void>;
  dispose: () => Promise<void>;
}

export async function startDb(): Promise<TestDb> {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: join(import.meta.dirname, '..', 'wrangler.jsonc'),
    persist: false,
  });
  const db = proxy.env.DB;
  await ensureSchema(db);
  return {
    db,
    reset: async () => {
      await db.batch(TABLES.map(t => db.prepare(`DELETE FROM ${t}`)));
    },
    dispose: () => proxy.dispose(),
  };
}

export const TEST_PASSWORD = 'correct horse battery';
export const TEST_KEY = 'k'.repeat(40);

export function makeEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return { DB: db, DASHBOARD_PASSWORD: TEST_PASSWORD, ENCRYPTION_KEY: TEST_KEY, ...overrides };
}

interface StoredEvent {
  id: string;
  resource: EventResource;
}

/** An in-memory Google: the token endpoint and the Calendar calls the app makes. */
export class FakeGoogle {
  calendars = new Map<string, { summary: string; timeZone: string; events: StoredEvent[] }>();
  calls: string[] = [];
  refreshTokenValid = true;
  revoked: string[] = [];
  private n = 0;

  handle(url: URL, init: RequestInit | undefined): Response | null {
    const method = init?.method ?? 'GET';
    const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.href.startsWith('https://oauth2.googleapis.com/revoke')) {
      const token = new URLSearchParams(String(init?.body ?? '')).get('token');
      this.calls.push(`revoke:${token}`);
      this.revoked.push(String(token));
      if (token === 'refresh-1') this.refreshTokenValid = false;
      return json(200, {});
    }
    if (url.href.startsWith('https://oauth2.googleapis.com/token')) {
      const params = new URLSearchParams(String(init?.body ?? ''));
      this.calls.push(`token:${params.get('grant_type')}`);
      if (params.get('client_id') !== 'client-id' || params.get('client_secret') !== 'client-secret') return json(401, { error: 'invalid_client' });
      if (params.get('grant_type') === 'authorization_code') {
        if (params.get('code') !== 'good-code') return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3599 });
      }
      if (params.get('grant_type') === 'refresh_token') {
        if (!this.refreshTokenValid || params.get('refresh_token') !== 'refresh-1') return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: 'access-2', expires_in: 3599 });
      }
      return json(400, { error: 'unsupported_grant_type' });
    }
    if (!url.href.startsWith('https://www.googleapis.com/calendar/v3')) return null;
    const auth = new Headers(init?.headers).get('authorization');
    if (auth !== 'Bearer access-1' && auth !== 'Bearer access-2') return json(401, { error: { message: 'bad token', status: 'UNAUTHENTICATED' } });
    const path = url.pathname.replace('/calendar/v3', '');
    this.calls.push(`${method} ${decodeURIComponent(path)}`);
    if (method === 'POST' && path === '/calendars') {
      const body = JSON.parse(String(init?.body)) as { summary: string; timeZone: string };
      const id = `cal-${++this.n}@group.calendar.google.com`;
      this.calendars.set(id, { ...body, events: [] });
      return json(200, { id, ...body });
    }
    const m = /^\/calendars\/([^/]+)(\/events(?:\/([^/]+))?)?$/.exec(path);
    if (!m) return json(404, { error: { message: 'not found' } });
    const cal = this.calendars.get(decodeURIComponent(m[1] as string));
    if (!cal) return json(404, { error: { message: 'calendar not found' } });
    if (!m[2]) return json(200, { id: decodeURIComponent(m[1] as string), summary: cal.summary });
    const eventId = m[3] ? decodeURIComponent(m[3]) : null;
    if (method === 'GET' && !eventId) {
      const wanted = url.searchParams.get('privateExtendedProperty');
      const timeMin = Date.parse(url.searchParams.get('timeMin') ?? '1970-01-01T00:00:00Z');
      const items = cal.events
        .filter(e => {
          const [k, v] = (wanted ?? '=').split('=');
          return !wanted || e.resource.extendedProperties?.private?.[k as string] === v;
        })
        .filter(e => {
          const end = 'dateTime' in e.resource.end ? Date.parse(e.resource.end.dateTime) : Date.parse(`${e.resource.end.date}T00:00:00Z`);
          return end > timeMin;
        })
        .map(e => ({ id: e.id, ...e.resource }));
      return json(200, { items });
    }
    if (method === 'POST' && !eventId) {
      const id = `ev${++this.n}`;
      cal.events.push({ id, resource: JSON.parse(String(init?.body)) as EventResource });
      return json(200, { id });
    }
    const index = cal.events.findIndex(e => e.id === eventId);
    if (method === 'PUT' && eventId) {
      if (index < 0) return json(404, { error: { message: 'not found' } });
      cal.events[index] = { id: eventId, resource: JSON.parse(String(init?.body)) as EventResource };
      return json(200, { id: eventId });
    }
    if (method === 'DELETE' && eventId) {
      if (index < 0) return json(410, { error: { message: 'gone' } });
      cal.events.splice(index, 1);
      return new Response(null, { status: 204 });
    }
    return json(405, { error: { message: 'method' } });
  }

  events(calendarId?: string): StoredEvent[] {
    const id = calendarId ?? [...this.calendars.keys()][0];
    return id ? (this.calendars.get(id)?.events ?? []) : [];
  }
}

/** One text the fake Telnyx accepted. */
export interface SentRecord {
  from: string;
  to: string;
  text: string;
  /** Which endpoint was used: /v2/messages (sms) or /v2/messages/rcs (rcs). */
  endpoint: 'sms' | 'rcs';
  /** How it reached the phone: by RCS, or by SMS (an SMS send, or an RCS send to a phone without RCS, by its fallback). */
  delivered: 'sms' | 'rcs';
  /** RCS: the suggested replies, as sent. */
  suggestions?: Array<{ reply: { text: string; postback_data: string } }>;
  /** RCS: the SMS fallback, as sent. */
  fallback?: { from: string; text: string };
  agentId?: string;
  messagingProfileId?: string;
}

/** The RCS agent and messaging profile the fake accepts. */
export const RCS_AGENT = 'agent-betaharah-1';
export const MESSAGING_PROFILE = 'profile-0001';

/** An in-memory Telnyx: records what was sent; can be made to fail. */
export class FakeTelnyx {
  sent: SentRecord[] = [];
  /** Phones that have RCS; an RCS send to any other phone is delivered by its SMS fallback. */
  rcsPhones = new Set<string>();
  /** RCS requests that broke Telnyx's documented shape (should stay empty). */
  problems: string[] = [];
  failNext = 0;
  /** Numbers that have opted out with the carrier: sending to them is refused. */
  blocked = new Set<string>();
  privateKey!: CryptoKey;
  publicKey!: string;

  static async create(): Promise<FakeTelnyx> {
    const t = new FakeTelnyx();
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    t.privateKey = pair.privateKey;
    t.publicKey = toBase64(new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer));
    return t;
  }

  handle(url: URL, init: RequestInit | undefined): Response | null {
    if (url.href === 'https://api.telnyx.com/v2/messages/rcs') return this.handleRcs(init);
    if (url.href !== 'https://api.telnyx.com/v2/messages') return null;
    if (new Headers(init?.headers).get('authorization') !== 'Bearer telnyx-key') {
      return new Response(JSON.stringify({ errors: [{ code: '10009', title: 'Authentication failed' }] }), { status: 401 });
    }
    if (this.failNext > 0) {
      this.failNext--;
      return new Response(JSON.stringify({ errors: [{ code: '40008', title: 'Message filtered' }] }), { status: 422 });
    }
    const body = JSON.parse(String(init?.body)) as { from: string; to: string; text: string };
    if (this.blocked.has(body.to)) {
      return new Response(JSON.stringify({ errors: [{ code: '40300', title: 'Blocked due to STOP message', detail: 'Messages cannot be sent due to an existing block rule.' }] }), { status: 400 });
    }
    this.sent.push({ ...body, endpoint: 'sms', delivered: 'sms' });
    return new Response(JSON.stringify({ data: { id: `msg-${this.sent.length}`, type: 'SMS' } }), { status: 200 });
  }

  /** POST /v2/messages/rcs, as in Telnyx's "Send RCS Messages" guide. */
  private handleRcs(init: RequestInit | undefined): Response {
    if (new Headers(init?.headers).get('authorization') !== 'Bearer telnyx-key') {
      return new Response(JSON.stringify({ errors: [{ code: '10009', title: 'Authentication failed' }] }), { status: 401 });
    }
    const body = JSON.parse(String(init?.body)) as {
      agent_id?: unknown;
      to?: unknown;
      messaging_profile_id?: unknown;
      agent_message?: { content_message?: { text?: unknown; suggestions?: Array<{ reply?: { text?: unknown; postback_data?: unknown } }> } };
      sms_fallback?: { from?: unknown; text?: unknown };
    };
    const content = body.agent_message?.content_message;
    const problem = (p: string): Response => {
      this.problems.push(p);
      return new Response(JSON.stringify({ errors: [{ code: '10015', title: 'Bad request', detail: p }] }), { status: 422 });
    };
    if (body.agent_id !== RCS_AGENT) return problem('agent_id');
    if (body.messaging_profile_id !== MESSAGING_PROFILE) return problem('messaging_profile_id');
    if (typeof body.to !== 'string') return problem('to');
    if (typeof content?.text !== 'string') return problem('agent_message.content_message.text');
    if (!body.sms_fallback || typeof body.sms_fallback.from !== 'string' || typeof body.sms_fallback.text !== 'string') return problem('sms_fallback');
    for (const s of content.suggestions ?? []) {
      if (typeof s.reply?.text !== 'string' || typeof s.reply.postback_data !== 'string') return problem('suggestions');
    }
    if (this.failNext > 0) {
      this.failNext--;
      return new Response(JSON.stringify({ errors: [{ code: '40008', title: 'Message filtered' }] }), { status: 422 });
    }
    if (this.blocked.has(body.to)) {
      return new Response(JSON.stringify({ errors: [{ code: '40300', title: 'Blocked due to STOP message' }] }), { status: 400 });
    }
    const delivered = this.rcsPhones.has(body.to) ? 'rcs' : 'sms';
    this.sent.push({
      from: body.sms_fallback.from,
      to: body.to,
      text: delivered === 'rcs' ? content.text : body.sms_fallback.text,
      endpoint: 'rcs',
      delivered,
      suggestions: content.suggestions as SentRecord['suggestions'],
      fallback: { from: body.sms_fallback.from, text: body.sms_fallback.text },
      agentId: body.agent_id,
      messagingProfileId: body.messaging_profile_id,
    });
    return new Response(JSON.stringify({ data: { record_type: 'message', direction: 'outbound', id: `rcs-${this.sent.length}`, type: delivered === 'rcs' ? 'RCS' : 'SMS' } }), { status: 200 });
  }

  /**
   * A signed webhook request for a received RCS message, in the shape of
   * Telnyx's "RCS Webhooks" guide: the sender in payload.from.phone_number,
   * the agent in payload.to[0].agent_id, and the content in payload.body.
   */
  async inboundRcs(args: {
    from: string;
    agentId: string;
    eventId: string;
    nowMs: number;
    body: { text: string } | { suggestion_response: { postback_data: string; text: string } } | { location: { latitude: number; longitude: number } } | { user_file: unknown };
  }): Promise<{ body: string; headers: Record<string, string> }> {
    const body = JSON.stringify({
      data: {
        event_type: 'message.received',
        id: args.eventId,
        occurred_at: new Date(args.nowMs).toISOString(),
        payload: {
          body: args.body,
          direction: 'inbound',
          from: { carrier: 'T-Mobile USA', line_type: 'long_code', phone_number: args.from, status: 'webhook_delivered' },
          id: `in-${args.eventId}`,
          messaging_profile_id: MESSAGING_PROFILE,
          to: [{ agent_id: args.agentId, agent_name: 'Betaharah' }],
          type: 'RCS',
        },
        record_type: 'event',
      },
    });
    return this.sign(body, args.nowMs);
  }

  private async sign(body: string, nowMs: number): Promise<{ body: string; headers: Record<string, string> }> {
    const timestamp = String(Math.floor(nowMs / 1000));
    const signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, this.privateKey, new TextEncoder().encode(`${timestamp}|${body}`)));
    return { body, headers: { 'telnyx-signature-ed25519': toBase64(signature), 'telnyx-timestamp': timestamp, 'content-type': 'application/json' } };
  }

  /** A signed webhook request for a received message. */
  async inbound(args: { from: string; to: string; text: string; eventId: string; nowMs: number; eventType?: string; autoresponseType?: string }): Promise<{ body: string; headers: Record<string, string> }> {
    const body = JSON.stringify({
      data: {
        event_type: args.eventType ?? 'message.received',
        id: args.eventId,
        occurred_at: new Date(args.nowMs).toISOString(),
        payload: {
          direction: 'inbound',
          from: { phone_number: args.from },
          to: [{ phone_number: args.to }],
          text: args.text,
          type: 'SMS',
          ...(args.autoresponseType ? { autoresponse_type: args.autoresponseType } : {}),
        },
        record_type: 'event',
      },
      meta: { attempt: 1 },
    });
    return this.sign(body, args.nowMs);
  }
}

export interface World {
  deps: Deps;
  google: FakeGoogle;
  telnyx: FakeTelnyx;
  clock: { now: number };
  unexpected: string[];
}

export async function makeWorld(startMs: number): Promise<World> {
  const google = new FakeGoogle();
  const telnyx = await FakeTelnyx.create();
  const clock = { now: startMs };
  const unexpected: string[] = [];
  const deps: Deps = {
    now: () => clock.now,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const res = google.handle(url, init) ?? telnyx.handle(url, init);
      if (res) return res;
      unexpected.push(url.href);
      return new Response('unexpected request', { status: 500 });
    }) as typeof fetch,
  };
  return { deps, google, telnyx, clock, unexpected };
}
