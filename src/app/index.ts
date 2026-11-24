/**
 * The Worker: the public pages, sign-in, the dashboard's API, the calendar
 * feed, the operator's console, the text-message webhook, and the periodic
 * job.
 *
 * Which household a request may touch is decided in one place for each way
 * in: the signed session cookie (the dashboard), the verified sender of a
 * text (the webhook), or the secret calendar link. No route takes a
 * household id from anything a visitor types.
 */
import { Hono, type Context } from 'hono';
import { absToUtcMidnightMs } from '../engine/civil';
import { parseHalachicSettings, SettingsError } from '../engine/settings';
import { NoSunError } from '../engine/zmanim';
import { addPhone, createAccount, markVerified, prefixAllowed, prefixMessage, removePhone, tidyNumber } from './accounts';
import {
  ADMIN_COOKIE,
  adminLogin,
  clearedCookie,
  hasAdminSession,
  isConfigured,
  makeOAuthState,
  readOAuthState,
  readSession,
  SESSION_COOKIE,
  sessionCookie,
  type Session,
} from './auth';
import { checkPassword, fingerprint, hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, randomToken } from './crypto';
import { dashboardState, draftFromForm, FRESH_MS } from './dashboard';
import { realDeps, type Deps, type Env } from './env';
import { authorizationUrl, exchangeCode, GoogleCalendar, GoogleError, revokeToken } from './google';
import { compute, confirmationText, recordEntry, rejectionText, removeEntry, whereOf, type Computed } from './household';
import { toICalendar } from './ics';
import { addMessage, DEFAULT_SITE_CONFIG, googleReady, lastFour, MAX_PHONES, SITE_SECRET_KEYS, smsReady, type Site } from './model';
import { helpPage, privacyPage, termsPage } from './pages';
import { allowText, refundText } from './queue';
import { ensureSchema } from './schema';
import {
  checkCode,
  codesTodayKey,
  handleInbound,
  refreshHousehold,
  REMINDERS_ON_TEXT,
  requestCode,
  sendSms,
  TEST_TEXT,
  textsThisMonthKey,
  tick,
} from './service';
import { assertSunTimesExist, parseAppSettings, parsePhoneOptions, ValidationError } from './settings';
import { readTelnyxWebhook } from './sms';
import {
  bump,
  changeHousehold,
  ConflictError,
  createInvite,
  deleteHousehold,
  deleteInvite,
  endSessions,
  getInvite,
  getPhone,
  householdIdByLink,
  inviteHash,
  listHouseholds,
  listInvites,
  loadHousehold,
  loadSite,
  phoneHash,
  readCounter,
  saveSiteConfig,
  saveSiteSecrets,
  setPassword,
  setRefresh,
  siteTotals,
  useInvite,
  type Household,
} from './store';

type Ctx = { Bindings: Env; Variables: { session: Session } };
type C = Context<Ctx>;

/** Every request that changes something must carry this header; a form on another site cannot send it. */
const HEADER = 'x-betaharah';
const DAY = 86_400_000;
const MINUTE = 60_000;

/** An error that ends a request with a given status and a message for the person. */
class HttpError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 429 | 502 | 503,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const PASSWORD_FAILURES = 8;
const PASSWORD_FAILURES_PER_ADDRESS = 40;
const PASSWORD_WINDOW_MS = 15 * MINUTE;

function parsePassword(input: unknown): string {
  if (typeof input !== 'string' || input.length < MIN_PASSWORD_LENGTH) throw new ValidationError(`A password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (input.length > MAX_PASSWORD_LENGTH) throw new ValidationError('That password is too long.');
  return input;
}

async function readBody(c: C): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ValidationError('The request could not be read.');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ValidationError('The request could not be read.');
  return body as Record<string, unknown>;
}

const isSecure = (c: C): boolean => new URL(c.req.url).protocol === 'https:';
const originOf = (c: C): string => new URL(c.req.url).origin;
const addressOf = (c: C): string => c.req.header('cf-connecting-ip') ?? 'unknown';

export function createApp(deps: Deps = realDeps): Hono<Ctx> {
  const app = new Hono<Ctx>();

  /** Runs work after the response has been sent. Without an execution context (tests) the caller awaits it. */
  const background = (c: C, work: Promise<unknown>): Promise<unknown> | void => {
    let ctx: { waitUntil(promise: Promise<unknown>): void } | null = null;
    try {
      ctx = c.executionCtx;
    } catch {
      ctx = null;
    }
    const guarded = work.catch(() => undefined);
    if (ctx) ctx.waitUntil(guarded);
    else return guarded;
  };

  /** A password record to check against when a number has none, so that the answer takes equally long. */
  let dummyRecord: Promise<string> | null = null;
  const dummyPassword = (env: Env): Promise<string> => (dummyRecord ??= hashPassword(env.ENCRYPTION_KEY, randomToken()));

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    if (err instanceof ValidationError || err instanceof SettingsError) return c.json({ error: err.message }, 400);
    if (err instanceof NoSunError) {
      return c.json({ error: 'With these settings, the times cannot be calculated for every day of the year at this location (the sun does not set far enough, or at all, on some days).' }, 400);
    }
    if (err instanceof GoogleError) return c.json({ error: err.message }, 502);
    if (err instanceof ConflictError) return c.json({ error: err.message }, 409);
    // Only the kind of error and where it happened are logged, never its message, which could quote a person's data.
    const where = (err.stack ?? '').split('\n').filter(line => line.trimStart().startsWith('at ')).slice(0, 4).join(' | ');
    console.error('error', err.name, where);
    return c.json({ error: 'Something went wrong on the server.' }, 500);
  });

  app.notFound(c => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found.' }, 404) : c.text('Not found.', 404)));

  app.use('*', async (c, next) => {
    await ensureSchema(c.env.DB);
    await next();
    const h = c.res.headers;
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'no-referrer');
    h.set('X-Frame-Options', 'DENY');
    h.set('X-Robots-Tag', 'noindex');
    h.set('Strict-Transport-Security', 'max-age=31536000');
    if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
    if ((h.get('Content-Type') ?? '').startsWith('text/html')) {
      h.set('Content-Security-Policy', "default-src 'none'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    }
  });

  // ----- pages written by the server -----

  const siteForPage = async (env: Env): Promise<Site> => (isConfigured(env) ? loadSite(env) : { config: DEFAULT_SITE_CONFIG, secrets: {} });
  app.get('/help', async c => c.html(helpPage(await siteForPage(c.env))));
  app.get('/privacy', async c => c.html(privacyPage(await siteForPage(c.env))));
  app.get('/terms', async c => c.html(termsPage(await siteForPage(c.env))));

  // ----- the calendar feed (authenticated by the secret in its address) -----

  app.get('/cal/:file', async c => {
    const match = /^([A-Za-z0-9_-]{24,64})\.ics$/.exec(c.req.param('file'));
    if (!match || !isConfigured(c.env)) return c.text('Not found.', 404);
    const id = await householdIdByLink(c.env, match[1] as string);
    const household = id ? await loadHousehold(c.env, id) : null;
    if (!household) return c.text('Not found.', 404);
    const now = deps.now();
    const computed = compute(household.data, now);
    const windowStart = now - household.data.app.calendar.historyDays * DAY;
    const events = (computed?.events ?? []).filter(e => (e.timed ? e.timed.end : absToUtcMidnightMs(e.allDay!.endAbsExclusive)) >= windowStart);
    return c.body(toICalendar(events, household.data.app.calendar.name, now), 200, { 'Content-Type': 'text/calendar; charset=utf-8' });
  });

  // ----- text-message webhook (authenticated by Telnyx's signature) -----

  app.post('/webhooks/telnyx', async c => {
    if (!isConfigured(c.env)) return c.json({ error: 'not set up' }, 503);
    const raw = await c.req.text();
    const site = await loadSite(c.env);
    const { telnyxPublicKey, telnyxNumber } = site.secrets;
    if (!telnyxPublicKey || !telnyxNumber) return c.json({ error: 'text messaging is not set up' }, 503);
    const result = await readTelnyxWebhook(
      raw,
      { signature: c.req.header('telnyx-signature-ed25519') ?? null, timestamp: c.req.header('telnyx-timestamp') ?? null },
      telnyxPublicKey,
      deps.now(),
    );
    if (!result.ok) return c.json({ error: result.reason }, result.status as 400 | 401);
    if (result.message && result.message.to === telnyxNumber) {
      const after = await handleInbound(c.env, deps, site, result.message);
      if (after) {
        const pending = background(c, refreshHousehold(c.env, deps, site, after.household, after.computed, deps.now()));
        if (pending) await pending;
      }
    }
    return c.json({ ok: true });
  });

  // ----- everything under /api -----

  app.use('/api/*', async (c, next) => {
    if (c.req.path !== '/api/public' && !isConfigured(c.env)) return c.json({ error: 'The site is not set up yet.' }, 503);
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      if (c.req.header(HEADER) !== '1') return c.json({ error: 'bad request' }, 400);
      const origin = c.req.header('origin');
      if (origin && origin !== originOf(c)) return c.json({ error: 'bad request' }, 403);
    }
    await next();
  });

  app.get('/api/public', async c => {
    if (!isConfigured(c.env)) return c.json({ configured: false });
    const site = await loadSite(c.env);
    const session = await readSession(c.env, c.req.header('cookie'), deps.now());
    return c.json({
      configured: true,
      signedIn: session !== null,
      signup: site.config.signup,
      sms: smsReady(site),
      prefixes: site.config.allowedPrefixes,
      contactName: site.config.contactName,
      contactEmail: site.config.contactEmail,
    });
  });

  // ----- sign-in -----

  /**
   * Texts a sign-in code. The answer is the same whether or not the number
   * has an account, and whether or not a code was really sent, so that
   * nobody can use this to find out who has an account.
   */
  app.post('/api/auth/code', async c => {
    const now = deps.now();
    const site = await loadSite(c.env);
    const body = await readBody(c);
    const number = tidyNumber(body.number, site.config);
    if (!prefixAllowed(number, site.config)) throw new ValidationError(prefixMessage(site.config));
    const phone = await getPhone(c.env.DB, await phoneHash(c.env, number));
    let send = phone !== null;
    if (!phone) {
      if (site.config.signup === 'open') {
        send = true;
      } else if (site.config.signup === 'invite' && typeof body.invite === 'string') {
        const invite = await getInvite(c.env.DB, await inviteHash(c.env, body.invite), now);
        send = invite !== null && invite.kind === 'signup';
      }
    }
    const result = await requestCode(c.env, deps, site, { number, purpose: 'login', householdId: phone?.household_id ?? null, address: addressOf(c), send, now });
    if (!result.ok) throw new HttpError(result.reason === 'unavailable' ? 503 : 429, result.message);
    const pending = background(c, result.delivery);
    if (pending) await pending;
    return c.json({ ok: true });
  });

  app.post('/api/auth/verify', async c => {
    const now = deps.now();
    const site = await loadSite(c.env);
    const body = await readBody(c);
    const number = tidyNumber(body.number, site.config);
    const check = await checkCode(c.env, { number, code: body.code, purpose: 'login', now });
    if (!check.ok) throw new HttpError(400, check.message);
    const hash = await phoneHash(c.env, number);
    let phone = await getPhone(c.env.DB, hash);
    let created = false;
    if (phone) {
      // An account set up by invitation has not yet proved its number; it has now.
      const household = await loadHousehold(c.env, phone.household_id);
      if (household?.data.phones.some(p => p.number === number && p.verifiedAt === null)) await markVerified(c.env, phone.household_id, number, now);
    } else {
      if (!prefixAllowed(number, site.config)) throw new ValidationError(prefixMessage(site.config));
      if (site.config.signup === 'closed') throw new HttpError(403, 'Sign-up is closed.');
      if (site.config.signup === 'invite') {
        const code = typeof body.invite === 'string' ? body.invite : '';
        const invite = code ? await getInvite(c.env.DB, await inviteHash(c.env, code), now) : null;
        if (!invite || invite.kind !== 'signup' || !(await useInvite(c.env.DB, invite.hash, now))) throw new HttpError(403, 'Sign-up is by invitation, and this invitation is not valid any more.');
      }
      const made = await createAccount(c.env, { number, verified: true, password: null, now });
      phone = made.ok ? made.phone : await getPhone(c.env.DB, hash);
      created = made.ok;
      if (!phone) throw new HttpError(409, 'Please try again.');
    }
    c.header('Set-Cookie', await sessionCookie(c.env, phone, 'code', now, isSecure(c)));
    return c.json({ ok: true, created });
  });

  app.post('/api/auth/password', async c => {
    const now = deps.now();
    const site = await loadSite(c.env);
    const body = await readBody(c);
    const number = tidyNumber(body.number, site.config);
    const hash = await phoneHash(c.env, number);
    const numberKey = `pw-fail:${hash.slice(0, 24)}`;
    const addressKey = `pw-ip:${(await fingerprint(c.env.ENCRYPTION_KEY, 'ip', addressOf(c))).slice(0, 24)}`;
    if ((await readCounter(c.env.DB, numberKey, now)) >= PASSWORD_FAILURES || (await readCounter(c.env.DB, addressKey, now)) >= PASSWORD_FAILURES_PER_ADDRESS) {
      throw new HttpError(429, 'Too many wrong passwords. Try again in 15 minutes, or sign in with a texted code.');
    }
    const phone = await getPhone(c.env.DB, hash);
    const password = typeof body.password === 'string' && body.password.length <= MAX_PASSWORD_LENGTH ? body.password : '';
    // The check always runs, against a stand-in when the number has no password, so that both cases take equally long.
    const matches = await checkPassword(c.env.ENCRYPTION_KEY, password, phone?.password ?? (await dummyPassword(c.env)));
    if (!phone || phone.password === null || !matches) {
      await bump(c.env.DB, numberKey, PASSWORD_WINDOW_MS, now);
      await bump(c.env.DB, addressKey, PASSWORD_WINDOW_MS, now);
      return c.json({ error: 'Wrong number or password.' }, 401);
    }
    c.header('Set-Cookie', await sessionCookie(c.env, phone, 'password', now, isSecure(c)));
    return c.json({ ok: true });
  });

  /** Says what kind of invitation a link carries, so that the page can show the right form. */
  app.get('/api/auth/invite', async c => {
    const code = c.req.query('code');
    const invite = code ? await getInvite(c.env.DB, await inviteHash(c.env, code), deps.now()) : null;
    if (!invite) return c.json({ error: 'This invitation is not valid any more.' }, 404);
    return c.json({ kind: invite.kind });
  });

  /**
   * Creates an account from an invitation the operator made for one phone
   * number: a number and a password, with no texted code. Used before text
   * messaging is available.
   */
  app.post('/api/auth/setup', async c => {
    const now = deps.now();
    const site = await loadSite(c.env);
    const body = await readBody(c);
    const number = tidyNumber(body.number, site.config);
    const password = parsePassword(body.password);
    const hash = await phoneHash(c.env, number);
    const invite = typeof body.invite === 'string' ? await getInvite(c.env.DB, await inviteHash(c.env, body.invite), now) : null;
    if (!invite || invite.kind !== 'setup' || invite.phone_hash !== hash) throw new HttpError(400, 'This invitation is not valid for that number.');
    if (await getPhone(c.env.DB, hash)) throw new HttpError(400, 'That number already has an account. Sign in instead.');
    const record = await hashPassword(c.env.ENCRYPTION_KEY, password);
    if (!(await useInvite(c.env.DB, invite.hash, now))) throw new HttpError(400, 'This invitation is not valid any more.');
    const made = await createAccount(c.env, { number, verified: false, password: record, now });
    if (!made.ok) throw new HttpError(400, 'That number already has an account. Sign in instead.');
    c.header('Set-Cookie', await sessionCookie(c.env, made.phone, 'password', now, isSecure(c)));
    return c.json({ ok: true, created: true });
  });

  app.post('/api/auth/logout', c => {
    c.header('Set-Cookie', clearedCookie(SESSION_COOKIE, isSecure(c)));
    return c.json({ ok: true });
  });

  // ----- the operator's console: the site's settings, never a household's data -----

  app.post('/api/admin/login', async c => {
    const body = await readBody(c);
    const result = await adminLogin(c.env, body.password, deps.now(), isSecure(c));
    if (!result.ok) return c.json({ error: result.message }, result.status);
    c.header('Set-Cookie', result.cookie);
    return c.json({ ok: true });
  });

  app.post('/api/admin/logout', c => {
    c.header('Set-Cookie', clearedCookie(ADMIN_COOKIE, isSecure(c)));
    return c.json({ ok: true });
  });

  app.use('/api/admin/*', async (c, next) => {
    if (!(await hasAdminSession(c.env, c.req.header('cookie'), deps.now()))) return c.json({ error: 'Please sign in.' }, 401);
    await next();
  });

  const adminState = async (c: C) => {
    const now = deps.now();
    const site = await loadSite(c.env);
    const origin = originOf(c);
    return {
      config: site.config,
      secretsSet: Object.fromEntries(SITE_SECRET_KEYS.map(k => [k, Boolean(site.secrets[k])])),
      textingNumber: site.secrets.telnyxNumber ?? null,
      smsReady: smsReady(site),
      googleReady: googleReady(site),
      totals: await siteTotals(c.env.DB),
      usage: {
        textsThisMonth: await readCounter(c.env.DB, textsThisMonthKey(now), now),
        codesToday: await readCounter(c.env.DB, codesTodayKey(now), now),
      },
      households: await listHouseholds(c.env.DB),
      invites: (await listInvites(c.env.DB, now)).map(i => ({ id: i.hash, kind: i.kind, note: i.note, createdAt: i.created_at, expiresAt: i.expires_at, maxUses: i.max_uses, uses: i.uses })),
      urls: {
        webhook: `${origin}/webhooks/telnyx`,
        redirect: `${origin}/api/google/callback`,
        home: `${origin}/`,
        privacy: `${origin}/privacy`,
        terms: `${origin}/terms`,
      },
    };
  };

  app.get('/api/admin/state', async c => c.json(await adminState(c)));

  app.put('/api/admin/config', async c => {
    await saveSiteConfig(c.env, await readBody(c), deps.now());
    return c.json(await adminState(c));
  });

  app.put('/api/admin/secrets', async c => {
    const site = await loadSite(c.env);
    const body = await readBody(c);
    const patch: Partial<Record<(typeof SITE_SECRET_KEYS)[number], string | null>> = {};
    for (const key of SITE_SECRET_KEYS) {
      if (!(key in body)) continue;
      const value = body[key];
      if (value !== null && typeof value !== 'string') throw new ValidationError(`${key}: expected text`);
      if (typeof value === 'string' && value.length > 500) throw new ValidationError(`${key}: too long`);
      patch[key] = value;
    }
    // The texting number is checked only for its form; it need not begin with a prefix that people may sign up with.
    if (typeof patch.telnyxNumber === 'string' && patch.telnyxNumber.trim() !== '') patch.telnyxNumber = tidyNumber(patch.telnyxNumber, site.config);
    await saveSiteSecrets(c.env, site.secrets, patch, deps.now());
    return c.json(await adminState(c));
  });

  app.post('/api/admin/invites', async c => {
    const now = deps.now();
    const site = await loadSite(c.env);
    const body = await readBody(c);
    const days = typeof body.days === 'number' && Number.isInteger(body.days) && body.days >= 1 && body.days <= 90 ? body.days : 14;
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 80) || null : null;
    const code = randomToken();
    const base = { hash: await inviteHash(c.env, code), note, created_at: now, expires_at: now + days * DAY };
    if (body.kind === 'setup') {
      const number = tidyNumber(body.number, site.config);
      if (!prefixAllowed(number, site.config)) throw new ValidationError(prefixMessage(site.config));
      const hash = await phoneHash(c.env, number);
      if (await getPhone(c.env.DB, hash)) throw new HttpError(400, 'That number already has an account.');
      await createInvite(c.env.DB, { ...base, kind: 'setup', phone_hash: hash, max_uses: 1 });
    } else if (body.kind === 'signup') {
      const maxUses = typeof body.maxUses === 'number' && Number.isInteger(body.maxUses) && body.maxUses >= 1 && body.maxUses <= 100 ? body.maxUses : 1;
      await createInvite(c.env.DB, { ...base, kind: 'signup', phone_hash: null, max_uses: maxUses });
    } else {
      throw new ValidationError('kind: signup or setup');
    }
    // The link is shown once; only a fingerprint of it is stored.
    return c.json({ link: `${originOf(c)}/app/?invite=${code}`, state: await adminState(c) });
  });

  app.delete('/api/admin/invites/:id', async c => {
    await deleteInvite(c.env.DB, c.req.param('id'));
    return c.json(await adminState(c));
  });

  app.delete('/api/admin/households/:id', async c => {
    const household = await loadHousehold(c.env, c.req.param('id')).catch(() => null);
    if (household?.data.google) await revokeToken(deps, household.data.google.refreshToken);
    await deleteHousehold(c.env.DB, c.req.param('id'));
    return c.json(await adminState(c));
  });

  app.post('/api/admin/test-text', async c => {
    const site = await loadSite(c.env);
    const body = await readBody(c);
    const to = tidyNumber(body.to, site.config);
    const outcome = await sendSms(c.env, deps, site, { to, text: TEST_TEXT, now: deps.now() });
    if (!outcome.ok) throw new HttpError(502, outcome.detail);
    return c.json({ ok: true });
  });

  app.all('/api/admin/*', c => c.json({ error: 'Not found.' }, 404));

  // ----- Google's redirect back (it arrives as an ordinary page visit) -----

  app.get('/api/google/callback', async c => {
    const now = deps.now();
    const fail = (message: string) => c.redirect(`/app/?google_error=${encodeURIComponent(message)}#settings`, 302);
    const session = await readSession(c.env, c.req.header('cookie'), now);
    if (!session) return fail('Please sign in, then connect Google Calendar again.');
    if (c.req.query('error')) return fail('Google sign-in was not completed.');
    const stateHousehold = await readOAuthState(c.env, c.req.query('state'), now);
    if (!stateHousehold || stateHousehold !== session.householdId) return fail('The sign-in took too long or did not start here. Try again.');
    const code = c.req.query('code');
    if (!code) return fail('Google did not return a code.');
    const site = await loadSite(c.env);
    const { googleClientId, googleClientSecret } = site.secrets;
    if (!googleClientId || !googleClientSecret) return fail('Google Calendar is not available on this site.');
    try {
      const household = await loadHousehold(c.env, session.householdId);
      if (!household) return fail('Please sign in again.');
      const tokens = await exchangeCode(deps, { clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: `${originOf(c)}/api/google/callback`, code });
      const calendar = new GoogleCalendar(deps, tokens.accessToken);
      let calendarId = household.data.google?.calendarId ?? null;
      if (calendarId && !(await calendar.calendarExists(calendarId))) calendarId = null;
      if (!calendarId) calendarId = await calendar.createCalendar(household.data.app.calendar.name, household.data.app.place?.timeZone ?? 'UTC');
      const id = calendarId;
      await changeHousehold(
        c.env,
        session.householdId,
        now,
        data => {
          data.google = { calendarId: id, refreshToken: tokens.refreshToken, connectedAt: now };
          data.sync = { dirty: true, lastRunAt: null, lastOkAt: null, lastError: null };
        },
        now, // the periodic job fills the calendar within a minute
      );
    } catch (e) {
      return fail(e instanceof GoogleError ? e.message : 'Google sign-in failed.');
    }
    return c.redirect('/app/?google=connected#settings', 302);
  });

  // ----- everything below needs a signed-in session -----

  app.use('/api/*', async (c, next) => {
    const session = await readSession(c.env, c.req.header('cookie'), deps.now());
    if (!session) return c.json({ error: 'Please sign in.' }, 401);
    c.set('session', session);
    await next();
  });

  const mine = async (c: C): Promise<Household> => {
    const household = await loadHousehold(c.env, c.get('session').householdId);
    if (!household) throw new HttpError(404, 'This account no longer exists.');
    return household;
  };

  /** The dashboard's data. `computed` passes on a picture already worked out in this request. */
  const stateOf = async (c: C, site: Site, household: Household, computed?: Computed | null) => {
    const now = deps.now();
    const session = c.get('session');
    let myNumber: string | null = null;
    for (const p of household.data.phones) {
      if ((await phoneHash(c.env, p.number)) === session.phoneHash) myNumber = p.number;
    }
    return dashboardState({
      data: household.data,
      computed: computed === undefined ? compute(household.data, now) : computed,
      site,
      session,
      myNumber,
      now,
      origin: originOf(c),
    });
  };

  /** After a change was saved: brings reminders and calendar up to date in the background, and answers with the new state. */
  const finish = async (c: C, site: Site, household: Household, computed: Computed | null, extra: Record<string, unknown> = {}) => {
    const state = await stateOf(c, site, household, computed);
    const pending = background(c, refreshHousehold(c.env, deps, site, household, computed, deps.now()));
    if (pending) await pending;
    return c.json({ ...extra, state });
  };

  const change = async <T>(c: C, fn: (data: Household['data']) => T): Promise<{ household: Household; result: T }> => {
    const changed = await changeHousehold(c.env, c.get('session').householdId, deps.now(), fn);
    if (!changed) throw new HttpError(404, 'This account no longer exists.');
    return changed;
  };

  app.get('/api/state', async c => c.json({ state: await stateOf(c, await loadSite(c.env), await mine(c)) }));

  app.post('/api/auth/logout-all', async c => {
    await endSessions(c.env.DB, c.get('session').phoneHash);
    c.header('Set-Cookie', clearedCookie(SESSION_COOKIE, isSecure(c)));
    return c.json({ ok: true });
  });

  // ----- settings -----

  app.put('/api/halachic', async c => {
    const now = deps.now();
    const site = await loadSite(c.env);
    const settings = parseHalachicSettings(await readBody(c));
    const { household } = await change(c, data => {
      const p = data.app.place;
      // Every day of the year must still have its times with this definition of nightfall.
      if (p) assertSunTimesExist({ latitude: p.latitude, longitude: p.longitude, timeZone: p.timeZone, elevation: p.elevation }, { useElevation: data.app.useElevation, tzeit: settings.tzeit });
      data.halachic = settings;
      data.halachicConfirmedAt = now;
      data.sync.dirty = true;
    });
    return finish(c, site, household, compute(household.data, now));
  });

  app.put('/api/app', async c => {
    const now = deps.now();
    const site = await loadSite(c.env);
    const settings = parseAppSettings(await readBody(c));
    const { household } = await change(c, data => {
      const p = settings.place;
      if (p) assertSunTimesExist({ latitude: p.latitude, longitude: p.longitude, timeZone: p.timeZone, elevation: p.elevation }, { useElevation: settings.useElevation, tzeit: data.halachic.tzeit });
      data.app = settings;
      data.sync.dirty = true;
    });
    return finish(c, site, household, compute(household.data, now));
  });

  // ----- the log -----

  app.post('/api/entries', async c => {
    const now = deps.now();
    const site = await loadSite(c.env);
    const body = await readBody(c);
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : null;
    const { household, result } = await change(c, data => {
      const where = whereOf(data);
      if (!where) throw new HttpError(400, rejectionText('no_place', null));
      const recorded = recordEntry(data, draftFromForm(body, where, now), 'dashboard', note, now);
      if (!recorded.ok) throw new HttpError(400, rejectionText(recorded.reason, recorded.computed));
      return recorded;
    });
    return finish(c, site, household, result.computed, { message: confirmationText(result, null).replace(' 0 to undo.', '') });
  });

  app.delete('/api/entries/:id', async c => {
    const now = deps.now();
    const site = await loadSite(c.env);
    const id = c.req.param('id');
    const { household } = await change(c, data => {
      if (!removeEntry(data, id, now)) throw new HttpError(404, 'No such entry.');
    });
    return finish(c, site, household, compute(household.data, now));
  });

  // ----- phones -----

  app.post('/api/phones/code', async c => {
    const now = deps.now();
    const site = await loadSite(c.env);
    const body = await readBody(c);
    const number = tidyNumber(body.number, site.config);
    if (!prefixAllowed(number, site.config)) throw new ValidationError(prefixMessage(site.config));
    const household = await mine(c);
    const present = household.data.phones.find(p => p.number === number);
    if (present && present.verifiedAt !== null) throw new HttpError(400, 'That phone is already on this account.');
    if (!present && household.data.phones.length >= MAX_PHONES) throw new HttpError(400, `An account can have at most ${MAX_PHONES} phones.`);
    const result = await requestCode(c.env, deps, site, { number, purpose: 'add', householdId: household.id, address: addressOf(c), send: true, now });
    if (!result.ok) throw new HttpError(result.reason === 'unavailable' ? 503 : 429, result.message);
    const outcome = await result.delivery;
    if (!outcome.ok) throw new HttpError(502, 'The code could not be sent. Check the number and try again.');
    return c.json({ ok: true, number });
  });

  app.post('/api/phones/verify', async c => {
    const now = deps.now();
    const site = await loadSite(c.env);
    const body = await readBody(c);
    const number = tidyNumber(body.number, site.config);
    const session = c.get('session');
    const check = await checkCode(c.env, { number, code: body.code, purpose: 'add', now });
    if (!check.ok) throw new HttpError(400, check.message);
    if (check.householdId !== session.householdId) throw new HttpError(400, 'That code is not right, or it has expired.');
    const added = await addPhone(c.env, session.householdId, number, now);
    if (!added.ok) {
      throw new HttpError(
        400,
        added.reason === 'full'
          ? `An account can have at most ${MAX_PHONES} phones.`
          : 'That number already belongs to another account. Its owner can sign in with it and delete that account; then it can be added here.',
      );
    }
    const household = await mine(c);
    return finish(c, site, household, compute(household.data, now));
  });

  app.put('/api/phones', async c => {
    const now = deps.now();
    const site = await loadSite(c.env);
    const body = await readBody(c);
    const options = parsePhoneOptions(body);
    const texts = body.texts === true;
    const { result: confirm } = await change(c, data => {
      const phone = data.phones.find(p => p.number === body.number);
      if (!phone) throw new HttpError(404, 'No such phone on this account.');
      if (texts && phone.verifiedAt === null) throw new HttpError(400, 'Verify this number with a texted code before turning on reminders for it.');
      Object.assign(phone, options);
      const turnedOn = texts && phone.consentAt === null;
      if (texts) phone.consentAt ??= now;
      else phone.consentAt = null;
      // One confirmation text when reminders are turned on for a phone, within the account's monthly limit.
      return turnedOn && !phone.optedOut && allowText(data, site.config.householdMonthlyLimit, now) ? phone.number : null;
    });
    if (confirm) {
      const outcome = await sendSms(c.env, deps, site, { to: confirm, text: REMINDERS_ON_TEXT, now });
      await change(c, data => {
        if (!outcome.ok) refundText(data, now);
        addMessage(data, { direction: 'out', phone: lastFour(confirm), body: REMINDERS_ON_TEXT, at: now, status: outcome.ok ? 'sent' : 'not sent' });
        const phone = data.phones.find(p => p.number === confirm);
        if (phone && !outcome.ok && outcome.reason === 'blocked') phone.optedOut = true;
      });
    }
    const household = await mine(c);
    return finish(c, site, household, compute(household.data, now));
  });

  app.post('/api/phones/remove', async c => {
    const now = deps.now();
    const site = await loadSite(c.env);
    const body = await readBody(c);
    const session = c.get('session');
    if (typeof body.number !== 'string') throw new ValidationError('number: required');
    const removed = await removePhone(c.env, session.householdId, body.number, now);
    if (!removed.ok) {
      throw new HttpError(
        removed.reason === 'missing' ? 404 : 400,
        removed.reason === 'missing' ? 'No such phone on this account.' : 'This is the only phone on the account. To leave, delete the account instead.',
      );
    }
    if (removed.hash === session.phoneHash) {
      // The phone that was signed in removed itself.
      c.header('Set-Cookie', clearedCookie(SESSION_COOKIE, isSecure(c)));
      await setRefresh(c.env.DB, session.householdId, now);
      return c.json({ signedOut: true });
    }
    const household = await mine(c);
    return finish(c, site, household, compute(household.data, now));
  });

  app.post('/api/phones/test', async c => {
    const now = deps.now();
    const site = await loadSite(c.env);
    const body = await readBody(c);
    const { result: to } = await change(c, data => {
      const phone = data.phones.find(p => p.number === body.number);
      if (!phone) throw new HttpError(404, 'No such phone on this account.');
      if (phone.verifiedAt === null) throw new HttpError(400, 'Verify this number first.');
      if (phone.optedOut) throw new HttpError(400, 'This phone replied STOP. Text START from it to receive texts again.');
      if (!allowText(data, site.config.householdMonthlyLimit, now)) throw new HttpError(429, "This account's monthly limit on text messages has been reached.");
      return phone.number;
    });
    const outcome = await sendSms(c.env, deps, site, { to, text: TEST_TEXT, now });
    const { household: after } = await change(c, data => {
      if (!outcome.ok) refundText(data, now);
      addMessage(data, { direction: 'out', phone: lastFour(to), body: TEST_TEXT, at: now, status: outcome.ok ? 'sent' : 'not sent' });
      const p = data.phones.find(x => x.number === to);
      if (p && !outcome.ok && outcome.reason === 'blocked') p.optedOut = true;
    });
    if (!outcome.ok) {
      throw new HttpError(502, outcome.reason === 'failed' ? 'The text could not be sent.' : outcome.reason === 'blocked' ? 'This phone has opted out. Text START from it to receive texts again.' : outcome.detail);
    }
    return c.json({ state: await stateOf(c, site, after) });
  });

  // ----- password -----

  /** Changing how the account is signed in to needs a session that began in the last few minutes. */
  const requireFresh = (c: C): void => {
    if (deps.now() - c.get('session').startedAt >= FRESH_MS) {
      throw new HttpError(403, 'To change the password, first sign out and sign in again. That confirms it is you. Then make the change within 15 minutes.');
    }
  };

  /** After the way of signing in changed: ends every other session of this phone and keeps this one. */
  const renewSession = async (c: C): Promise<void> => {
    const session = c.get('session');
    await endSessions(c.env.DB, session.phoneHash);
    const phone = await getPhone(c.env.DB, session.phoneHash);
    if (!phone) throw new HttpError(404, 'This account no longer exists.');
    c.header('Set-Cookie', await sessionCookie(c.env, phone, session.method, session.startedAt, isSecure(c)));
    c.set('session', { ...session, phone });
  };

  app.put('/api/password', async c => {
    requireFresh(c);
    const body = await readBody(c);
    const password = parsePassword(body.password);
    await setPassword(c.env.DB, c.get('session').phoneHash, await hashPassword(c.env.ENCRYPTION_KEY, password));
    await renewSession(c);
    // Stretching the password uses much of a request's processing time, so the page asks for its data separately.
    return c.json({ ok: true });
  });

  app.delete('/api/password', async c => {
    requireFresh(c);
    const site = await loadSite(c.env);
    if (!smsReady(site)) throw new HttpError(400, 'Sign-in by text message is not available yet, so the password is the only way in and cannot be removed.');
    await setPassword(c.env.DB, c.get('session').phoneHash, null);
    await renewSession(c);
    return c.json({ ok: true });
  });

  // ----- Google Calendar -----

  app.get('/api/google/start', async c => {
    const site = await loadSite(c.env);
    if (!site.secrets.googleClientId || !googleReady(site)) {
      return c.redirect(`/app/?google_error=${encodeURIComponent('Google Calendar is not available on this site.')}#settings`, 302);
    }
    return c.redirect(
      authorizationUrl({
        clientId: site.secrets.googleClientId,
        redirectUri: `${originOf(c)}/api/google/callback`,
        state: await makeOAuthState(c.env, c.get('session').householdId, deps.now()),
      }),
      302,
    );
  });

  app.post('/api/google/disconnect', async c => {
    const site = await loadSite(c.env);
    const { household, result: token } = await change(c, data => {
      const refreshToken = data.google?.refreshToken ?? null;
      data.google = null;
      data.sync = { dirty: true, lastRunAt: null, lastOkAt: null, lastError: null };
      return refreshToken;
    });
    if (token) await revokeToken(deps, token);
    return c.json({ state: await stateOf(c, site, household) });
  });

  app.post('/api/sync', async c => {
    const now = deps.now();
    const site = await loadSite(c.env);
    const household = await mine(c);
    const computed = compute(household.data, now);
    const outcome = await refreshHousehold(c.env, deps, site, household, computed, now);
    return c.json({ outcome, state: await stateOf(c, site, household, computed) });
  });

  // ----- the calendar subscription link -----

  app.post('/api/calendar-link', async c => {
    const site = await loadSite(c.env);
    const { household } = await change(c, data => {
      data.calendarLinkToken = randomToken();
    });
    return c.json({ state: await stateOf(c, site, household) });
  });

  app.delete('/api/calendar-link', async c => {
    const site = await loadSite(c.env);
    const { household } = await change(c, data => {
      data.calendarLinkToken = null;
    });
    return c.json({ state: await stateOf(c, site, household) });
  });

  // ----- your data -----

  app.get('/api/export', async c => {
    const { data } = await mine(c);
    const file = {
      exportedAt: new Date(deps.now()).toISOString(),
      halachic: data.halachic,
      halachicConfirmedAt: data.halachicConfirmedAt,
      settings: data.app,
      phones: data.phones,
      entries: data.entries,
      removedEntries: data.removed,
      messages: data.messages,
      googleCalendar: data.google ? { calendarId: data.google.calendarId, connectedAt: data.google.connectedAt } : null,
      calendarLinkExists: data.calendarLinkToken !== null,
    };
    return c.body(JSON.stringify(file, null, 2), 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="betaharah-export.json"',
    });
  });

  app.post('/api/account/delete', async c => {
    const body = await readBody(c);
    if (body.confirm !== 'DELETE') throw new ValidationError('Type DELETE to confirm.');
    const household = await mine(c);
    if (household.data.google) await revokeToken(deps, household.data.google.refreshToken);
    await deleteHousehold(c.env.DB, household.id);
    c.header('Set-Cookie', clearedCookie(SESSION_COOKIE, isSecure(c)));
    return c.json({ ok: true });
  });

  app.all('/api/*', c => c.json({ error: 'Not found.' }, 404));

  return app;
}

const app = createApp();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    if (!isConfigured(env)) return;
    ctx.waitUntil(ensureSchema(env.DB).then(() => tick(env, realDeps)));
  },
} satisfies ExportedHandler<Env>;
