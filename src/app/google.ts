/**
 * Google sign-in (OAuth 2.0 for web server applications) and the Calendar
 * API calls the app makes.
 *
 * The app asks only for `calendar.app.created`: it can create its own
 * secondary calendar and manage the events on it, and cannot see any other
 * calendar. The calendar belongs to the Google account that signs in.
 */
import type { Deps } from './env';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';

export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Google's error code, e.g. "invalid_grant" */
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'GoogleError';
  }
}

export function authorizationUrl(args: { clientId: string; redirectUri: string; state: string }): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', args.clientId);
  u.searchParams.set('redirect_uri', args.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', CALENDAR_SCOPE);
  // offline access returns a refresh token; prompt=consent makes Google return it every time
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('state', args.state);
  return u.toString();
}

async function tokenRequest(deps: Deps, params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await deps.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // not JSON; handled below
  }
  if (!res.ok) {
    const code = typeof body.error === 'string' ? body.error : null;
    throw new GoogleError(`Google sign-in failed (${res.status}${code ? `, ${code}` : ''})`, res.status, code);
  }
  return body;
}

export async function exchangeCode(
  deps: Deps,
  args: { clientId: string; clientSecret: string; redirectUri: string; code: string },
): Promise<{ accessToken: string; refreshToken: string }> {
  const body = await tokenRequest(deps, {
    client_id: args.clientId,
    client_secret: args.clientSecret,
    redirect_uri: args.redirectUri,
    code: args.code,
    grant_type: 'authorization_code',
  });
  if (typeof body.access_token !== 'string') throw new GoogleError('Google did not return an access token', 200, null);
  if (typeof body.refresh_token !== 'string') throw new GoogleError('Google did not return a refresh token', 200, 'no_refresh_token');
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

export async function refreshAccessToken(deps: Deps, args: { clientId: string; clientSecret: string; refreshToken: string }): Promise<string> {
  const body = await tokenRequest(deps, {
    client_id: args.clientId,
    client_secret: args.clientSecret,
    refresh_token: args.refreshToken,
    grant_type: 'refresh_token',
  });
  if (typeof body.access_token !== 'string') throw new GoogleError('Google did not return an access token', 200, null);
  return body.access_token;
}

/** The fields of a Google Calendar event that the app sets. */
export interface EventResource {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string } | { date: string };
  end: { dateTime: string; timeZone: string } | { date: string };
  /** "transparent": the event does not mark the person as busy */
  transparency: 'transparent';
  colorId: string;
  reminders: { useDefault: boolean };
  extendedProperties: { private: Record<string, string> };
}

export interface ExistingEvent {
  id: string;
  /** Private extended properties */
  props: Record<string, string>;
  /** End of the event, epoch ms (for an all-day event, 00:00 UTC of its end date) */
  endMs: number;
}

export class GoogleCalendar {
  constructor(
    private readonly deps: Deps,
    private readonly accessToken: string,
  ) {}

  private async call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await this.deps.fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    if (text) {
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // leave empty
      }
    }
    return { status: res.status, json };
  }

  private fail(what: string, r: { status: number; json: Record<string, unknown> }): never {
    const err = r.json.error as { message?: unknown; status?: unknown } | undefined;
    const detail = typeof err?.message === 'string' ? `: ${err.message}` : '';
    throw new GoogleError(`${what} failed (${r.status})${detail}`, r.status, typeof err?.status === 'string' ? err.status : null);
  }

  /** Creates a secondary calendar owned by the signed-in account. Returns its id. */
  async createCalendar(summary: string, timeZone: string): Promise<string> {
    const r = await this.call('POST', '/calendars', { summary, timeZone });
    if (r.status !== 200 || typeof r.json.id !== 'string') this.fail('Creating the calendar', r);
    return r.json.id as string;
  }

  /** True if the calendar still exists and is reachable. */
  async calendarExists(calendarId: string): Promise<boolean> {
    const r = await this.call('GET', `/calendars/${encodeURIComponent(calendarId)}`);
    if (r.status === 200) return true;
    if (r.status === 404 || r.status === 410) return false;
    return this.fail('Reading the calendar', r);
  }

  /** Events the app created (marked with the private property mk=1) that end after `timeMinMs`. */
  async listManagedEvents(calendarId: string, timeMinMs: number): Promise<ExistingEvent[]> {
    const out: ExistingEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 20; page++) {
      const q = new URLSearchParams({
        privateExtendedProperty: 'mk=1',
        timeMin: new Date(timeMinMs).toISOString(),
        maxResults: '2500',
        singleEvents: 'true',
        showDeleted: 'false',
      });
      if (pageToken) q.set('pageToken', pageToken);
      const r = await this.call('GET', `/calendars/${encodeURIComponent(calendarId)}/events?${q.toString()}`);
      if (r.status !== 200) this.fail('Listing events', r);
      const items = Array.isArray(r.json.items) ? (r.json.items as Array<Record<string, unknown>>) : [];
      for (const item of items) {
        if (typeof item.id !== 'string') continue;
        const ext = item.extendedProperties as { private?: Record<string, string> } | undefined;
        const end = item.end as { dateTime?: string; date?: string } | undefined;
        const endMs = end?.dateTime ? Date.parse(end.dateTime) : end?.date ? Date.parse(`${end.date}T00:00:00Z`) : Number.NaN;
        out.push({ id: item.id, props: ext?.private ?? {}, endMs });
      }
      pageToken = typeof r.json.nextPageToken === 'string' ? r.json.nextPageToken : undefined;
      if (!pageToken) return out;
    }
    throw new GoogleError('Listing events: too many pages', 200, null);
  }

  async insertEvent(calendarId: string, event: EventResource): Promise<void> {
    const r = await this.call('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, event);
    if (r.status !== 200) this.fail('Adding an event', r);
  }

  /** Replaces the event's fields with `event`. */
  async updateEvent(calendarId: string, eventId: string, event: EventResource): Promise<void> {
    const r = await this.call('PUT', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, event);
    if (r.status !== 200) this.fail('Updating an event', r);
  }

  /** Deletes an event. An event that is already gone counts as deleted. */
  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    const r = await this.call('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    if (r.status === 204 || r.status === 200 || r.status === 404 || r.status === 410) return;
    this.fail('Deleting an event', r);
  }
}
