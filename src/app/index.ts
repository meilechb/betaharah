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
import { addPhone, attachGoogle, createAccount, createGoogleAccount, deleteAccount, markVerified, prefixAllowed, prefixMessage, removePhone, tidyNumber } from './accounts';
import {
  clearedCookie,
  googleSessionCookie,
  isConfigured,
  makeLoginState,
  makeOAuthState,
  readLoginState,
  readOAuthState,
  readSession,
  SESSION_COOKIE,
  sessionCookie,
  type Session,
} from './auth';
import { registerAdminRoutes } from './admin-routes';
import { addressedToSite, handleInbound, receiveText } from './conversation';
import { checkPassword, fingerprint, hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, randomToken } from './crypto';
import { dashboardState, draftFromForm, FRESH_MS } from './dashboard';
import { DEMO_NUMBER, isFictionalNumber } from './demo';
import { recordTick } from './admin-data';
import { noteTextReceived } from './admin-notes';
import { realDeps, type Deps, type Env } from './env';
import { authorizationUrl, exchangeCode, fetchGoogleIdentity, GoogleCalendar, GoogleError, revokeToken, SIGN_IN_SCOPE } from './google';
import { compute, confirmationText, recordEntry, rejectionText, removeEntry, whereOf, type Computed } from './household';
import { toICalendar } from './ics';
import { addMessage, DEFAULT_SITE_CONFIG, donateReady, googleReady, lastFour, MAX_PHONES, smsReady, type Site } from './model';
import { donatePage, helpPage, privacyPage, termsPage } from './pages';
import { allowText, refundText } from './queue';
import { ensureSchema } from './schema';
import {
  allowInbound,
  checkCode,
  CODE_MINUTES,
  CODE_RESEND_SECONDS,
  codeText,
  messageStatus,
  refreshHousehold,
  startReply,
  requestCode,
  sendHouseholdText,
  testText,
  toSend,
  tick,
} from './service';
import { assertSunTimesExist, parseAppSettings, parsePhoneOptions, ValidationError } from './settings';
import { runSandbox, sandboxChoices, TRY_CUSTOMS, TRY_LIMITS, TRY_PER_ADDRESS, TRY_WINDOW_MS, tryCustoms, tryMonths, tryPlace } from './sandbox';
import { readTelnyxWebhook } from './sms';
import {
  bump,
  changeHousehold,
  ConflictError,
  deleteHousehold,
  endGoogleSessions,
  endSessions,
  getGoogleId,
  getInvite,
  getPhone,
  googleHash,
  householdIdByLink,
  inviteHash,
  loadHousehold,
  loadSite,
  phoneHash,
  readCounter,
  setPassword,
  setRefresh,
  takeLinkToken,
  useInvite,
  type Household,
} from './store';
import { lookupPostal } from './zip';

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

/** The one answer to every sign-in link that does not work. */
const LINK_FAILED = 'This sign-in link does not work. It works once, within 10 minutes of being texted. Text WEB for a new one, or sign in with your number.';
const LINK_FAILURES_PER_ADDRESS = 20;
const LINK_FAILURE_WINDOW_MS = 15 * MINUTE;
/** Looking up postal codes: at most this many per signed-in phone in an hour. */
const POSTAL_LOOKUPS_PER_HOUR = 60;
/** The answer when someone tries to text, or make an account for, a number reserved for fiction. */
const FICTIONAL_MESSAGE = 'Numbers from 555-0100 to 555-0199 are reserved for fiction; they are never real phones and cannot receive texts.';

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
    if (c.req.path !== '/privacy' && c.req.path !== '/terms') h.set('X-Robots-Tag', 'noindex');
    h.set('Strict-Transport-Security', 'max-age=31536000');
    if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
    if ((h.get('Content-Type') ?? '').startsWith('text/html')) {
      h.set('Content-Security-Policy', "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self' data:; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    }
  });

  // ----- pages written by the server -----

  const siteForPage = async (env: Env): Promise<Site> => (isConfigured(env) ? loadSite(env) : { config: DEFAULT_SITE_CONFIG, secrets: {} });
  app.get('/help', async c => c.html(helpPage(await siteForPage(c.env))));
  app.get('/privacy', async c => c.html(privacyPage(await siteForPage(c.env))));
  app.get('/terms', async c => c.html(termsPage(await siteForPage(c.env))));
  // Only once the operator has entered a way to give; until then the address is like any unknown one.
  app.get('/donate', async c => {
    const site = await siteForPage(c.env);
    return donateReady(site) ? c.html(donatePage(site)) : c.notFound();
  });

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

  const telnyxInbound = async (c: C) => {
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
    // for the operator's console: when a text was last received (a time and a count, nothing about whose)
    if (result.message) await noteTextReceived(c.env.DB, deps.now());
    // SMS to the site's number and RCS to the site's agent come here alike; anything else is acknowledged and ignored.
    if (result.message && addressedToSite(site, result.message)) {
      const after = await handleInbound(c.env, deps, site, result.message, originOf(c));
      if (after) {
        const pending = background(c, refreshHousehold(c.env, deps, site, after.household, after.computed, deps.now()));
        if (pending) await pending;
      }
    }
    return c.json({ ok: true });
  };

  // One handler reads both shapes of message (an SMS, and an RCS message whose words are at body.text).
  // The second address exists because an RCS agent's inbound webhook was set to it; either address takes either kind.
  app.post('/webhooks/telnyx', telnyxInbound);
  app.post('/webhooks/telnyx/rcs', telnyxInbound);

  // ----- everything under /api -----

  app.use('/api/*', async (c, next) => {
    // The public page reads /api/public and the choices for "Try it" even before the site is set up.
    const open = c.req.path === '/api/public' || (c.req.path === '/api/try' && c.req.method === 'GET');
    if (!open && !isConfigured(c.env)) return c.json({ error: 'The site is not set up yet.' }, 503);
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
      // The number to text, shown publicly only when a person can sign up by texting it.
      textingNumber: smsReady(site) && site.config.textSignup && site.config.signup !== 'closed' ? (site.secrets.telnyxNumber ?? null) : null,
      google: googleReady(site),
      prefixes: site.config.allowedPrefixes,
      contactName: site.config.contactName,
      contactEmail: site.config.contactEmail,
      // Whether the Donate page exists, so that the home page shows its links.
      donate: donateReady(site),
      // How long a texted code lasts, and how long before another can be asked for.
      codeMinutes: CODE_MINUTES,
      resendSeconds: CODE_RESEND_SECONDS,
    });
  });

  // ----- "Try it" on the home page (sandbox.ts): no account, nothing stored but a counter per network address -----

  app.get('/api/try', c => {
    const all = sandboxChoices('en');
    return c.json({
      places: all.places,
      labels: all.labels,
      customs: all.choices.filter(ch => (TRY_CUSTOMS as readonly string[]).includes(ch.key)),
      defaults: Object.fromEntries(TRY_CUSTOMS.map(k => [k, all.defaults[k]])),
      maxEntries: TRY_LIMITS.maxEntries,
      kinds: TRY_LIMITS.kinds,
    });
  });

  app.post('/api/try', async c => {
    const now = deps.now();
    const key = `try-ip:${(await fingerprint(c.env.ENCRYPTION_KEY, 'ip', addressOf(c))).slice(0, 24)}`;
    if ((await bump(c.env.DB, key, TRY_WINDOW_MS, now)) > TRY_PER_ADDRESS) throw new HttpError(429, 'Too many tries in the last few minutes. Please wait ten minutes and try again.');
    const body = await readBody(c);
    const result = runSandbox({ place: tryPlace(body.place), halachic: tryCustoms(body.customs), today: body.today, entries: body.entries, months: tryMonths(body.today) }, TRY_LIMITS);
    const { reminders: _reminders, ...state } = result.state;
    return c.json({ place: result.place.name, today: result.today, outcomes: result.outcomes, message: result.message, state });
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
    if (isFictionalNumber(number)) {
      // A number reserved for fiction is never texted: it is answered like a number that may not sign up.
      send = false;
    } else if (!phone) {
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
    // No sign-in code is ever sent to a number reserved for fiction, so none can be right.
    if (isFictionalNumber(number)) throw new HttpError(400, 'That code is not right, or it has expired.');
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

  /**
   * Signs in with the one-time link texted in answer to WEB
   * (https://.../app/?k=<token>): the page posts the token here. It works
   * once, within 10 minutes, and signs in as the phone that asked for it,
   * on the household that phone is on now only if that is still the
   * household it asked from. Every failure gets the same answer.
   */
  app.post('/api/auth/link', async c => {
    const now = deps.now();
    const body = await readBody(c);
    const addressKey = `link-ip:${(await fingerprint(c.env.ENCRYPTION_KEY, 'ip', addressOf(c))).slice(0, 24)}`;
    const refused = async () => {
      await bump(c.env.DB, addressKey, LINK_FAILURE_WINDOW_MS, now);
      return c.json({ error: LINK_FAILED }, 400);
    };
    if ((await readCounter(c.env.DB, addressKey, now)) >= LINK_FAILURES_PER_ADDRESS) return c.json({ error: LINK_FAILED }, 400);
    if (typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{24,64}$/.test(body.token)) return refused();
    const link = await takeLinkToken(c.env, body.token, now);
    if (!link) return refused();
    const phone = await getPhone(c.env.DB, link.phoneHash);
    if (!phone || phone.household_id !== link.householdId) return refused();
    c.header('Set-Cookie', await sessionCookie(c.env, phone, 'code', now, isSecure(c)));
    return c.json({ ok: true });
  });

  // Sign in with Google. A separate redirect and a separate scope from Calendar connect.
  app.get('/api/auth/google/start', async c => {
    const site = await loadSite(c.env);
    if (!googleReady(site) || !site.secrets.googleClientId) {
      return c.redirect(`/app/?google_error=${encodeURIComponent('Sign-in with Google is not available on this site yet.')}`, 302);
    }
    const now = deps.now();
    const session = await readSession(c.env, c.req.header('cookie'), now);
    const invite = c.req.query('invite') ?? null;
    return c.redirect(
      authorizationUrl({
        clientId: site.secrets.googleClientId,
        redirectUri: `${originOf(c)}/api/auth/google/callback`,
        state: await makeLoginState(c.env, { householdId: session?.householdId ?? null, invite, now }),
        scope: SIGN_IN_SCOPE,
        offline: false,
        prompt: 'select_account',
      }),
      302,
    );
  });

  app.get('/api/auth/google/callback', async c => {
    const now = deps.now();
    const fail = (message: string) => c.redirect(`/app/?google_error=${encodeURIComponent(message)}`, 302);
    const state = await readLoginState(c.env, c.req.query('state'), now);
    if (!state) return fail('The sign-in took too long or did not start here. Try again.');
    if (c.req.query('error')) return fail('Google sign-in was not completed.');
    const code = c.req.query('code');
    if (!code) return fail('Google did not return a code.');
    const site = await loadSite(c.env);
    const { googleClientId, googleClientSecret } = site.secrets;
    if (!googleClientId || !googleClientSecret) return fail('Sign-in with Google is not available on this site yet.');
    try {
      const tokens = await exchangeCode(deps, {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        redirectUri: `${originOf(c)}/api/auth/google/callback`,
        code,
        requireRefresh: false,
      });
      const profile = await fetchGoogleIdentity(deps, tokens.accessToken);
      const hash = await googleHash(c.env, profile.sub);
      const existing = await getGoogleId(c.env.DB, hash);
      if (existing) {
        if (state.householdId && state.householdId !== existing.household_id) {
          return fail('That Google account is already used by another Betaharah account.');
        }
        const row = existing;
        c.header('Set-Cookie', await googleSessionCookie(c.env, row, now, isSecure(c)));
        await changeHousehold(c.env, row.household_id, now, data => {
          data.googleLogin = profile;
        });
        return c.redirect('/app/', 302);
      }
      const session = await readSession(c.env, c.req.header('cookie'), now);
      const linkTo = state.householdId && session && session.householdId === state.householdId ? state.householdId : null;
      if (linkTo) {
        const attached = await attachGoogle(c.env, linkTo, hash, profile, now);
        if (!attached.ok) return fail('That Google account is already used by another Betaharah account.');
        c.header('Set-Cookie', await googleSessionCookie(c.env, attached.row, now, isSecure(c)));
        return c.redirect('/app/?google=signed-in#settings', 302);
      }
      if (site.config.signup === 'closed') return fail('New sign-ups are closed.');
      if (site.config.signup === 'invite') {
        const invite = state.invite ? await getInvite(c.env.DB, await inviteHash(c.env, state.invite), now) : null;
        if (!invite || invite.kind !== 'signup') return fail('New accounts are by invitation.');
        if (!(await useInvite(c.env.DB, invite.hash, now))) return fail('This invitation is not valid any more.');
      }
      const made = await createGoogleAccount(c.env, hash, profile, now);
      if (!made.ok) return fail('That Google account is already used by another Betaharah account.');
      c.header('Set-Cookie', await googleSessionCookie(c.env, made.row, now, isSecure(c)));
      return c.redirect('/app/', 302);
    } catch (e) {
      return fail(e instanceof GoogleError ? e.message : 'Google sign-in failed.');
    }
  });

  // ----- the operator's console: the site's settings, never a household's data (admin-routes.ts) -----

  registerAdminRoutes(app, deps);

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
      if (!tokens.refreshToken) return fail('Google did not return a refresh token.');
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
          data.google = { calendarId: id, refreshToken: tokens.refreshToken as string, connectedAt: now };
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

  /** The number of the phone this session signed in with. */
  const numberOf = async (c: C, household: Household): Promise<string | null> => {
    const session = c.get('session');
    let myNumber: string | null = null;
    for (const p of household.data.phones) {
      if ((await phoneHash(c.env, p.number)) === session.phoneHash) myNumber = p.number;
    }
    return myNumber;
  };

  /** The dashboard's data. `computed` passes on a picture already worked out in this request. */
  const stateOf = async (c: C, site: Site, household: Household, computed?: Computed | null) => {
    const now = deps.now();
    return dashboardState({
      data: household.data,
      computed: computed === undefined ? compute(household.data, now) : computed,
      site,
      session: c.get('session'),
      myNumber: await numberOf(c, household),
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

  /** Notes that the guided first steps were shown and closed. */
  app.post('/api/welcome', async c => {
    const now = deps.now();
    const site = await loadSite(c.env);
    const { household } = await change(c, data => {
      data.welcomedAt ??= now;
    });
    return c.json({ state: await stateOf(c, site, household) });
  });

  /**
   * The test account only: a text "sent" from this session's phone, handled
   * exactly as a real received text is (STOP, START, HELP, and every text
   * the conversation engine reads: see docs/TEXTING.md). Nothing is sent:
   * `replies` are the texts that would have gone back (at most two, each
   * with its RCS buttons), and `reply` is the first of them or null. Both
   * directions are recorded as simulated.
   */
  app.post('/api/demo/text', async c => {
    const now = deps.now();
    const site = await loadSite(c.env);
    const body = await readBody(c);
    const household = await mine(c);
    if (!household.data.demo) throw new HttpError(403, 'Only the test account can simulate a text.');
    if (typeof body.text !== 'string' || body.text.trim() === '') throw new ValidationError('Type a text to send.');
    if (body.text.length > 320) throw new ValidationError('That text is too long.');
    const from = await numberOf(c, household);
    if (!from) throw new HttpError(404, 'This phone is no longer on the account.');
    if (!(await allowInbound(c.env, c.get('session').phoneHash, now))) throw new HttpError(429, 'Too many texts in the last hour. Try again later.');
    const received = await receiveText(
      c.env,
      deps,
      site,
      household.id,
      { eventId: `demo:${randomToken()}`, from, text: body.text, autoresponseType: null, location: null },
      now,
      { origin: originOf(c) },
    );
    if (!received) throw new HttpError(409, 'Please try again.');
    const extra = { reply: received.reply, replies: received.replies };
    // DELETE ACCOUNT, or this phone left: the session no longer opens anything.
    const after = received.household;
    if (!after || !after.data.phones.some(p => p.number === from)) {
      c.header('Set-Cookie', clearedCookie(SESSION_COOKIE, isSecure(c)));
      return c.json({ ...extra, signedOut: true });
    }
    return finish(c, site, after, received.computed ?? compute(after.data, now), extra);
  });

  /**
   * A place from a US ZIP code or a Canadian postal code, for the location
   * form. It is public data, but only for a signed-in phone, and at most 60
   * lookups an hour per phone.
   */
  app.get('/api/postal/:code', async c => {
    const now = deps.now();
    const key = `postal:${c.get('session').phoneHash.slice(0, 24)}`;
    if ((await bump(c.env.DB, key, 60 * MINUTE, now)) > POSTAL_LOOKUPS_PER_HOUR) throw new HttpError(429, 'Too many lookups in the last hour. Try again later.');
    const found = lookupPostal(c.req.param('code'));
    if (!found) return c.json({ error: 'No place was found for that code. Enter a 5-digit US ZIP code or a Canadian postal code.' }, 404);
    const { name, latitude, longitude, timeZone, elevation, postal } = found;
    return c.json({ place: { name, latitude, longitude, timeZone, elevation, postal } });
  });

  app.post('/api/auth/logout-all', async c => {
    const session = c.get('session');
    if (session.kind === 'google') await endGoogleSessions(c.env.DB, session.phoneHash);
    else await endSessions(c.env.DB, session.phoneHash);
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
    return finish(c, site, household, result.computed, { message: confirmationText(result, null), entryId: result.entry.id });
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
    const demo = household.data.demo;
    if (demo && !isFictionalNumber(number)) {
      throw new HttpError(400, 'The test account takes only made-up numbers, from 555-0100 to 555-0199 in any area code, for example (732) 555-0150.');
    }
    if (!demo && isFictionalNumber(number)) throw new HttpError(400, FICTIONAL_MESSAGE);
    const present = household.data.phones.find(p => p.number === number);
    if (present && present.verifiedAt !== null) throw new HttpError(400, 'That phone is already on this account.');
    if (!present && household.data.phones.length >= MAX_PHONES) throw new HttpError(400, `An account can have at most ${MAX_PHONES} phones.`);
    const result = await requestCode(c.env, deps, site, { number, purpose: 'add', householdId: household.id, address: addressOf(c), send: true, now, simulate: demo });
    if (!result.ok) throw new HttpError(result.reason === 'unavailable' ? 503 : 429, result.message);
    if (demo && result.code) {
      // Nothing is sent: the code is recorded as a simulated text and shown on the page.
      const code = result.code;
      await change(c, data => addMessage(data, { direction: 'out', phone: lastFour(number), body: codeText(code, site.texts), at: now, status: 'simulated' }));
      return c.json({ ok: true, number, demoCode: code });
    }
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
    const check = await checkCode(c.env, { number, code: body.code, purpose: 'add', householdId: session.householdId, now });
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
    const { result: changed } = await change(c, data => {
      const phone = data.phones.find(p => p.number === body.number);
      if (!phone) throw new HttpError(404, 'No such phone on this account.');
      if (texts && phone.verifiedAt === null) throw new HttpError(400, 'Verify this number with a texted code before turning on reminders for it.');
      Object.assign(phone, options);
      const turnedOn = texts && phone.consentAt === null;
      if (texts) phone.consentAt ??= now;
      else phone.consentAt = null;
      // One confirmation text when reminders are turned on for a phone, within the account's monthly limit.
      return { demo: data.demo, confirm: turnedOn && !phone.optedOut && allowText(data, site.config.householdMonthlyLimit, now) ? phone.number : null };
    });
    const { confirm } = changed;
    if (confirm) {
      const start = startReply(site.texts);
      const outcome = await sendHouseholdText(c.env, deps, site, changed.demo, { to: confirm, text: start, now });
      await change(c, data => {
        if (!outcome.ok) refundText(data, now);
        addMessage(data, { direction: 'out', phone: lastFour(confirm), body: start, at: now, status: messageStatus(outcome) });
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
    if (body.number === DEMO_NUMBER && (await mine(c)).data.demo) {
      // The console finds the test account by this phone.
      throw new HttpError(400, 'The test phone stays on the test account. Remove another phone, or delete the test account from the console.');
    }
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
    const { result: taken } = await change(c, data => {
      const phone = data.phones.find(p => p.number === body.number);
      if (!phone) throw new HttpError(404, 'No such phone on this account.');
      if (phone.verifiedAt === null) throw new HttpError(400, 'Verify this number first.');
      if (phone.optedOut) throw new HttpError(400, 'This phone replied STOP. Text START from it to receive texts again.');
      if (!allowText(data, site.config.householdMonthlyLimit, now)) throw new HttpError(429, "This account's monthly limit on text messages has been reached.");
      return { to: phone.number, demo: data.demo };
    });
    const { to } = taken;
    const test = testText(site.texts);
    const outcome = await sendHouseholdText(c.env, deps, site, taken.demo, { to, ...toSend(test), now });
    const { household: after } = await change(c, data => {
      if (!outcome.ok) refundText(data, now);
      addMessage(data, { direction: 'out', phone: lastFour(to), body: test.text, at: now, status: messageStatus(outcome) });
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
    if (session.kind === 'google') throw new HttpError(400, 'A password belongs to a phone number. Add a phone, sign in with it, and set the password there.');
    await endSessions(c.env.DB, session.phoneHash);
    const phone = await getPhone(c.env.DB, session.phoneHash);
    if (!phone) throw new HttpError(404, 'This account no longer exists.');
    c.header('Set-Cookie', await sessionCookie(c.env, phone, session.method === 'google' ? 'password' : session.method, session.startedAt, isSecure(c)));
    c.set('session', { ...session, phone });
  };

  app.put('/api/password', async c => {
    if (c.get('session').kind === 'google') throw new HttpError(400, 'A password belongs to a phone number. Add a phone, sign in with it, and set the password there.');
    requireFresh(c);
    const body = await readBody(c);
    const password = parsePassword(body.password);
    await setPassword(c.env.DB, c.get('session').phoneHash, await hashPassword(c.env.ENCRYPTION_KEY, password));
    await renewSession(c);
    // Stretching the password uses much of a request's processing time, so the page asks for its data separately.
    return c.json({ ok: true });
  });

  app.delete('/api/password', async c => {
    if (c.get('session').kind === 'google') throw new HttpError(400, 'A password belongs to a phone number. Add a phone, sign in with it, and set the password there.');
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
    await deleteAccount(c.env, deps, { id: household.id, google: household.data.google });
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
    ctx.waitUntil(
      ensureSchema(env.DB)
        .then(() => tick(env, realDeps))
        // for the operator's console: when the job last ran, and the day's counts
        .then(() => recordTick(env, Date.now())),
    );
  },
} satisfies ExportedHandler<Env>;
