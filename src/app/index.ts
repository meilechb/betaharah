/**
 * The Worker: the dashboard's API, the Google sign-in redirect, the
 * text-message webhook, and the periodic job.
 */
import { Hono } from 'hono';
import { SettingsError } from '../engine/settings';
import { NoSunError } from '../engine/zmanim';
import { checkOAuthState, hasSession, isConfigured, login, makeOAuthState, sessionCookie } from './auth';
import { dashboardState, draftFromForm } from './dashboard';
import { realDeps, type Deps, type Env } from './env';
import { authorizationUrl, exchangeCode, GoogleCalendar, GoogleError } from './google';
import {
  compute,
  confirmationText,
  handleInbound,
  recordEntry,
  rejectionText,
  sendText,
  syncCalendar,
  tick,
  whereOf,
  type Computed,
} from './service';
import { assertSunTimesExist, E164, parsePlace, ValidationError } from './settings';
import { ensureSchema } from './schema';
import { readTelnyxWebhook } from './sms';
import {
  clearGoogle,
  listEntries,
  loadStored,
  markDirty,
  recentSms,
  removeEntry,
  saveApp,
  saveGoogle,
  saveHalachic,
  saveSecrets,
  SECRET_KEYS,
  type StoredEntry,
} from './store';

type Ctx = { Bindings: Env };

const CALENDAR_NAME = 'בטהרה';

export function createApp(deps: Deps = realDeps): Hono<Ctx> {
  const app = new Hono<Ctx>();

  type Waiter = { waitUntil(promise: Promise<unknown>): void };
  const background = (c: { executionCtx: Waiter }, work: Promise<unknown>): Promise<unknown> | void => {
    let ctx: Waiter | null = null;
    try {
      ctx = c.executionCtx;
    } catch {
      ctx = null; // no execution context (tests): the caller awaits the work instead
    }
    const guarded = work.catch(() => undefined);
    if (ctx) ctx.waitUntil(guarded);
    else return guarded;
  };

  app.onError((err, c) => {
    if (err instanceof ValidationError || err instanceof SettingsError) return c.json({ error: err.message }, 400);
    if (err instanceof NoSunError) return c.json({ error: 'The sun does not rise or set every day at this location, so the times cannot be calculated there.' }, 400);
    if (err instanceof GoogleError) return c.json({ error: err.message }, 502);
    console.error(err);
    return c.json({ error: 'Something went wrong on the server.' }, 500);
  });

  app.use('*', async (c, next) => {
    await ensureSchema(c.env.DB);
    await next();
  });

  // ----- text-message webhook (authenticated by Telnyx's signature, not by the session) -----

  app.post('/webhooks/telnyx', async c => {
    if (!isConfigured(c.env)) return c.json({ error: 'not set up' }, 503);
    const raw = await c.req.text();
    const stored = await loadStored(c.env);
    const { telnyxPublicKey, telnyxNumber } = stored.secrets;
    if (!telnyxPublicKey || !telnyxNumber) return c.json({ error: 'text messaging is not set up' }, 503);
    const result = await readTelnyxWebhook(
      raw,
      { signature: c.req.header('telnyx-signature-ed25519') ?? null, timestamp: c.req.header('telnyx-timestamp') ?? null },
      telnyxPublicKey,
      deps.now(),
    );
    if (!result.ok) return c.json({ error: result.reason }, result.status as 400 | 401);
    if (result.message && result.message.to === telnyxNumber) {
      const after = await handleInbound(c.env, deps, stored, result.message);
      if (after) {
        const pending = background(c, syncCalendar(c.env, deps, stored, after.computed));
        if (pending) await pending;
      }
    }
    return c.json({ ok: true });
  });

  // ----- sign-in -----

  app.get('/api/session', async c => {
    return c.json({ configured: isConfigured(c.env), authenticated: await hasSession(c.env, c.req.header('cookie'), deps.now()) });
  });

  app.post('/api/login', async c => {
    if (c.req.header('x-mikvah') !== '1') return c.json({ error: 'bad request' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { password?: unknown };
    const secure = new URL(c.req.url).protocol === 'https:';
    const result = await login(c.env, body.password, deps.now(), secure);
    if (!result.ok) return c.json({ error: result.message }, result.status);
    c.header('Set-Cookie', result.cookie);
    return c.json({ ok: true });
  });

  app.post('/api/logout', c => {
    const secure = new URL(c.req.url).protocol === 'https:';
    c.header('Set-Cookie', sessionCookie('', 0, secure));
    return c.json({ ok: true });
  });

  // Everything else under /api needs a session; changes also need the custom header (cross-site forms cannot send it).
  app.use('/api/*', async (c, next) => {
    if (!(await hasSession(c.env, c.req.header('cookie'), deps.now()))) return c.json({ error: 'Please sign in.' }, 401);
    if (c.req.method !== 'GET' && c.req.header('x-mikvah') !== '1') return c.json({ error: 'bad request' }, 400);
    c.header('Cache-Control', 'no-store');
    await next();
  });

  /** The dashboard's data. `ready` passes on entries and a picture already worked out in this request. */
  const state = async (env: Env, origin: string, ready?: { entries: readonly StoredEntry[]; computed: Computed | null }) => {
    const now = deps.now();
    const stored = await loadStored(env);
    const entries = ready?.entries ?? (await listEntries(env.DB));
    const computed = ready ? ready.computed : compute(stored, entries, now);
    return dashboardState(stored, entries, computed, await recentSms(env.DB, 30), now, origin);
  };

  app.get('/api/state', async c => c.json(await state(c.env, new URL(c.req.url).origin)));

  // ----- settings -----

  app.put('/api/halachic', async c => {
    const now = deps.now();
    const stored = await loadStored(c.env);
    await saveHalachic(c.env.DB, await c.req.json(), now);
    await markDirty(c.env.DB, stored.sync, now);
    return c.json(await state(c.env, new URL(c.req.url).origin));
  });

  app.put('/api/app', async c => {
    const now = deps.now();
    const stored = await loadStored(c.env);
    const input = (await c.req.json()) as { place?: unknown; useElevation?: unknown };
    // Validate the place against the sun before saving: every day of the year must have its times.
    if (input.place) {
      const place = parsePlace(input.place);
      assertSunTimesExist(
        { latitude: place.latitude, longitude: place.longitude, timeZone: place.timeZone, elevation: place.elevation },
        { useElevation: input.useElevation === true, tzeit: stored.halachic.settings.tzeit },
      );
    }
    await saveApp(c.env.DB, input, now);
    await markDirty(c.env.DB, stored.sync, now);
    return c.json(await state(c.env, new URL(c.req.url).origin));
  });

  app.put('/api/secrets', async c => {
    const now = deps.now();
    const stored = await loadStored(c.env);
    const body = (await c.req.json()) as Record<string, unknown>;
    const patch: Record<string, string | null> = {};
    for (const key of SECRET_KEYS) {
      if (key === 'googleRefreshToken') continue; // set only by signing in
      if (!(key in body)) continue;
      const value = body[key];
      if (value !== null && typeof value !== 'string') throw new ValidationError(`${key}: expected text`);
      if (typeof value === 'string' && value.length > 500) throw new ValidationError(`${key}: too long`);
      patch[key] = value;
    }
    if (typeof patch.telnyxNumber === 'string' && patch.telnyxNumber.trim() !== '') {
      const n = patch.telnyxNumber.replace(/[\s().-]/g, '');
      if (!E164.test(n)) throw new ValidationError('The number must be written with its country code, like +18885550123');
      patch.telnyxNumber = n;
    }
    await saveSecrets(c.env, stored.secrets, patch, now);
    return c.json(await state(c.env, new URL(c.req.url).origin));
  });

  // ----- the log -----

  app.post('/api/entries', async c => {
    const now = deps.now();
    const stored = await loadStored(c.env);
    const entries = await listEntries(c.env.DB);
    const where = whereOf(stored);
    if (!where) return c.json({ error: rejectionText('no_place', null) }, 400);
    const body = (await c.req.json()) as Record<string, unknown>;
    const draft = draftFromForm(body, where, now);
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : null;
    const result = await recordEntry(c.env, stored, entries, draft, 'dashboard', note, now);
    if (!result.ok) return c.json({ error: rejectionText(result.reason, result.computed) }, 400);
    const pending = background(c, syncCalendar(c.env, deps, stored, result.computed));
    if (pending) await pending;
    return c.json({ message: confirmationText(result, null), state: await state(c.env, new URL(c.req.url).origin, result) });
  });

  app.delete('/api/entries/:id', async c => {
    const now = deps.now();
    const stored = await loadStored(c.env);
    const removed = await removeEntry(c.env.DB, c.req.param('id'), now);
    if (!removed) return c.json({ error: 'No such entry.' }, 404);
    await markDirty(c.env.DB, stored.sync, now);
    const entries = await listEntries(c.env.DB);
    const computed = compute(stored, entries, now);
    const pending = background(c, syncCalendar(c.env, deps, stored, computed));
    if (pending) await pending;
    return c.json(await state(c.env, new URL(c.req.url).origin, { entries, computed }));
  });

  // ----- Google Calendar -----

  app.get('/api/google/start', async c => {
    const stored = await loadStored(c.env);
    if (!stored.secrets.googleClientId || !stored.secrets.googleClientSecret) {
      return c.json({ error: 'Enter the Google client ID and client secret first.' }, 400);
    }
    const origin = new URL(c.req.url).origin;
    return c.redirect(
      authorizationUrl({
        clientId: stored.secrets.googleClientId,
        redirectUri: `${origin}/api/google/callback`,
        state: await makeOAuthState(c.env, deps.now()),
      }),
      302,
    );
  });

  app.get('/api/google/callback', async c => {
    const now = deps.now();
    const origin = new URL(c.req.url).origin;
    const fail = (message: string) => c.redirect(`/?google_error=${encodeURIComponent(message)}#settings`, 302);
    if (c.req.query('error')) return fail(`Google sign-in was not completed (${c.req.query('error')}).`);
    if (!(await checkOAuthState(c.env, c.req.query('state'), now))) return fail('The sign-in took too long or did not start here. Try again.');
    const code = c.req.query('code');
    if (!code) return fail('Google did not return a code.');
    const stored = await loadStored(c.env);
    const { googleClientId, googleClientSecret } = stored.secrets;
    if (!googleClientId || !googleClientSecret) return fail('The Google client ID and secret are missing.');
    try {
      const tokens = await exchangeCode(deps, { clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: `${origin}/api/google/callback`, code });
      const calendar = new GoogleCalendar(deps, tokens.accessToken);
      let calendarId = stored.google?.calendarId ?? null;
      if (calendarId && !(await calendar.calendarExists(calendarId))) calendarId = null;
      if (!calendarId) calendarId = await calendar.createCalendar(CALENDAR_NAME, stored.app.place?.timeZone ?? 'UTC');
      await saveSecrets(c.env, stored.secrets, { googleRefreshToken: tokens.refreshToken }, now);
      await saveGoogle(c.env.DB, { calendarId, connectedAt: now }, now);
      await markDirty(c.env.DB, stored.sync, now);
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Google sign-in failed.');
    }
    return c.redirect('/?google=connected#settings', 302);
  });

  app.post('/api/google/disconnect', async c => {
    const now = deps.now();
    const stored = await loadStored(c.env);
    await saveSecrets(c.env, stored.secrets, { googleRefreshToken: null }, now);
    await clearGoogle(c.env.DB);
    return c.json(await state(c.env, new URL(c.req.url).origin));
  });

  app.post('/api/sync', async c => {
    const stored = await loadStored(c.env);
    const entries = await listEntries(c.env.DB);
    const computed = compute(stored, entries, deps.now());
    const outcome = await syncCalendar(c.env, deps, stored, computed);
    return c.json({ outcome, state: await state(c.env, new URL(c.req.url).origin, { entries, computed }) });
  });

  // ----- text messages -----

  app.post('/api/sms/test', async c => {
    const stored = await loadStored(c.env);
    const body = (await c.req.json()) as { to?: unknown };
    const phone = stored.app.phones.find(p => p.number === body.to);
    if (!phone) return c.json({ error: 'Choose one of the saved phones.' }, 400);
    const ok = await sendText(c.env, deps, stored, { to: phone.number, text: 'Test message from your calendar. Text 9 for status, ? for help.' });
    return c.json({ ok, state: await state(c.env, new URL(c.req.url).origin) }, ok ? 200 : 502);
  });

  app.all('/api/*', c => c.json({ error: 'Not found.' }, 404));

  return app;
}

const app = createApp();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(ensureSchema(env.DB).then(() => tick(env, realDeps)));
  },
} satisfies ExportedHandler<Env>;
