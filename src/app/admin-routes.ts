/**
 * The operator's console API: everything under /api/admin.
 *
 * The console shows the site's own settings and totals, never an account's
 * data. Every route except sign-in is behind the operator's session (the
 * DASHBOARD_PASSWORD sign-in in auth.ts); every request that changes
 * something carries the x-betaharah header (checked for all of /api in
 * index.ts). Keys are write-only: a response says whether each one is
 * saved, never what it is.
 */
import type { Context, Hono } from 'hono';
import { deleteAccount, prefixAllowed, prefixMessage, tidyNumber } from './accounts';
import { simulateText } from './conversation';
import { ADMIN_COOKIE, adminLogin, clearedCookie, hasAdminSession, sessionCookie, type Session } from './auth';
import { randomToken } from './crypto';
import { adminSessionUntil, adminState, checkGoogle, checkRcs, checkTelnyx, listAccounts, saveCheck, saveNotes, usageHistory, type AccountSort, type Notes } from './admin-data';
import { ensureAdminSchema, failureOf, noteSmsOutcome } from './admin-notes';
import { buildDemoData, DEMO_NUMBER, DEMO_SPOUSE, isFictionalNumber } from './demo';
import type { Deps, Env } from './env';
import { compute } from './household';
import { SITE_SECRET_KEYS } from './model';
import { refreshHousehold, sendSms, TEST_TEXT } from './service';
import { ValidationError } from './settings';
import { createHousehold, createInvitationWord, createInvite, deleteHousehold, deleteInvite, getPhone, insertPhone, inviteHash, loadHousehold, loadSite, phoneHash, saveSiteConfig, saveSiteSecrets } from './store';

type AdminApp = Hono<{ Bindings: Env; Variables: { session: Session } }>;
type C = Context<{ Bindings: Env; Variables: { session: Session } }>;

const DAY = 86_400_000;

/** The answer when someone tries to text, or make an account for, a number reserved for fiction. */
const FICTIONAL_MESSAGE = 'Numbers from 555-0100 to 555-0199 are reserved for fiction; they are never real phones and cannot receive texts.';

/** An error that ends an admin request with a status, a message for the operator, and the field it is about. */
class AdminError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 502,
    message: string,
    readonly field: string | null = null,
  ) {
    super(message);
    this.name = 'AdminError';
  }
}

const isSecure = (c: C): boolean => new URL(c.req.url).protocol === 'https:';
const originOf = (c: C): string => new URL(c.req.url).origin;
const addressOf = (c: C): string => c.req.header('cf-connecting-ip') ?? 'unknown';

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

/** Turns an AdminError into its answer; anything else goes on to the app's error handler. */
const handle =
  (fn: (c: C) => Promise<Response>) =>
  async (c: C): Promise<Response> => {
    try {
      return await fn(c);
    } catch (e) {
      if (e instanceof AdminError) return c.json(e.field ? { error: e.message, field: e.field } : { error: e.message }, e.status);
      throw e;
    }
  };

/** The sentence for a test text that was not sent, by the kind of failure. */
const FAILURE_SENTENCE: Record<string, string> = {
  not_set_up: 'Text messaging is not set up: save the three Telnyx keys and switch on "Send text messages".',
  site_limit: "This month's limit on text messages has been reached. Raise it under Site settings, or wait for the next month.",
  blocked: 'That phone has replied STOP to the number. Text START from it, then try again.',
  auth: 'Telnyx refused the API key. Save the key again.',
  refused: 'Telnyx refused the text.',
  network: 'Telnyx could not be reached. Try again in a minute.',
};

/** Registers every /api/admin route on the app. Call it where the operator's routes belong: after the /api checks, before the account routes. */
export function registerAdminRoutes(app: AdminApp, deps: Deps): void {
  const state = async (c: C) => adminState(c.env, deps.now(), originOf(c), c.req.header('cookie'));

  app.post('/api/admin/login', async c => {
    const body = await readBody(c);
    const now = deps.now();
    const result = await adminLogin(c.env, body.password, addressOf(c), now, isSecure(c));
    if (!result.ok) return c.json({ error: result.message }, result.status);
    c.header('Set-Cookie', result.cookie);
    return c.json({ ok: true, until: await adminSessionUntil(c.env, result.cookie.split(';')[0]) });
  });

  app.post('/api/admin/logout', c => {
    c.header('Set-Cookie', clearedCookie(ADMIN_COOKIE, isSecure(c)));
    return c.json({ ok: true });
  });

  app.use('/api/admin/*', async (c, next) => {
    if (!(await hasAdminSession(c.env, c.req.header('cookie'), deps.now()))) return c.json({ error: 'Please sign in.' }, 401);
    await ensureAdminSchema(c.env.DB);
    await next();
  });

  app.get('/api/admin/state', async c => c.json(await state(c)));

  app.put(
    '/api/admin/config',
    handle(async c => {
      try {
        await saveSiteConfig(c.env, await readBody(c), deps.now());
      } catch (e) {
        // The message names the setting ("dailyCodeLimit: ..."), so that the page can show it at the right field.
        if (e instanceof ValidationError) throw new AdminError(400, e.message, /^(\w+):/.exec(e.message)?.[1] ?? null);
        throw e;
      }
      return c.json(await state(c));
    }),
  );

  app.put(
    '/api/admin/secrets',
    handle(async c => {
      const site = await loadSite(c.env);
      const body = await readBody(c);
      const patch: Partial<Record<(typeof SITE_SECRET_KEYS)[number], string | null>> = {};
      for (const key of SITE_SECRET_KEYS) {
        if (!(key in body)) continue;
        const value = body[key];
        if (value !== null && typeof value !== 'string') throw new AdminError(400, `${key}: expected text`, key);
        if (typeof value === 'string' && value.length > 500) throw new AdminError(400, `${key}: too long`, key);
        patch[key] = value;
      }
      // The texting number is checked only for its form; it need not begin with a prefix that people may sign up with.
      if (typeof patch.telnyxNumber === 'string' && patch.telnyxNumber.trim() !== '') {
        try {
          patch.telnyxNumber = tidyNumber(patch.telnyxNumber, site.config);
        } catch (e) {
          if (e instanceof ValidationError) throw new AdminError(400, 'That is not a phone number. Write it with the country code, for example +1 888 555 0100.', 'telnyxNumber');
          throw e;
        }
      }
      await saveSiteSecrets(c.env, site.secrets, patch, deps.now());
      return c.json(await state(c));
    }),
  );

  /** The operator's notes to self (the toll-free verification) and the price per text for the cost estimate. */
  app.put(
    '/api/admin/notes',
    handle(async c => {
      const body = await readBody(c);
      const now = deps.now();
      const patch: Partial<Notes> = {};
      const flag = (key: string): boolean | undefined => {
        const v = body[key];
        if (v === undefined) return undefined;
        if (typeof v !== 'boolean') throw new AdminError(400, `${key}: true or false`, key);
        return v;
      };
      const submitted = flag('tollFreeSubmitted');
      const verified = flag('tollFreeVerified');
      if (submitted !== undefined) patch.tollFreeSubmittedAt = submitted ? now : null;
      if (verified !== undefined) patch.tollFreeVerifiedAt = verified ? now : null;
      if (verified === true && submitted === undefined) patch.tollFreeSubmittedAt ??= now;
      if (body.centsPerText !== undefined) {
        const v = body.centsPerText;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) throw new AdminError(400, 'The price per text must be a number of cents from 0 to 100.', 'centsPerText');
        patch.centsPerText = Math.round(v * 1000) / 1000;
      }
      await saveNotes(c.env.DB, patch, now);
      return c.json(await state(c));
    }),
  );

  app.post(
    '/api/admin/invites',
    handle(async c => {
      const now = deps.now();
      const site = await loadSite(c.env);
      const body = await readBody(c);
      const days = typeof body.days === 'number' && Number.isInteger(body.days) && body.days >= 1 && body.days <= 90 ? body.days : 14;
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 80) || null : null;
      const code = randomToken();
      const base = { hash: await inviteHash(c.env, code), note, created_at: now, expires_at: now + days * DAY };
      if (body.kind === 'setup') {
        let number: string;
        try {
          number = tidyNumber(body.number, site.config);
        } catch (e) {
          if (e instanceof ValidationError) throw new AdminError(400, e.message, 'number');
          throw e;
        }
        if (!prefixAllowed(number, site.config)) throw new AdminError(400, prefixMessage(site.config), 'number');
        if (isFictionalNumber(number)) throw new AdminError(400, `${FICTIONAL_MESSAGE} To try the site, open the test account instead.`, 'number');
        const hash = await phoneHash(c.env, number);
        if (await getPhone(c.env.DB, hash)) throw new AdminError(400, 'That number already has an account.', 'number');
        await createInvite(c.env.DB, { ...base, kind: 'setup', phone_hash: hash, max_uses: 1 });
      } else if (body.kind === 'signup') {
        const maxUses = typeof body.maxUses === 'number' && Number.isInteger(body.maxUses) && body.maxUses >= 1 && body.maxUses <= 100 ? body.maxUses : 1;
        await createInvite(c.env.DB, { ...base, kind: 'signup', phone_hash: null, max_uses: maxUses });
      } else {
        throw new ValidationError('kind: signup or setup');
      }
      // The link is shown once; only a fingerprint of it is stored.
      return c.json({ link: `${originOf(c)}/app/?invite=${code}`, state: await state(c) });
    }),
  );

  app.delete('/api/admin/invites/:id', async c => {
    await deleteInvite(c.env.DB, c.req.param('id'));
    return c.json(await state(c));
  });

  /**
   * A word people text as "JOIN <word>" to sign up while sign-up is by
   * invitation. It is an ordinary sign-up invitation: listed and cancelled
   * with the others.
   */
  app.post(
    '/api/admin/invite-words',
    handle(async c => {
      const body = await readBody(c);
      const num = (v: unknown): number | undefined => (v === undefined || v === null ? undefined : (v as number));
      try {
        const made = await createInvitationWord(c.env, {
          word: body.word,
          days: num(body.days),
          maxUses: num(body.maxUses),
          note: typeof body.note === 'string' ? body.note : null,
          now: deps.now(),
        });
        return c.json({ word: made.word, state: await state(c) });
      } catch (e) {
        if (e instanceof ValidationError) throw new AdminError(400, e.message, /^(\w+):/.exec(e.message)?.[1] ?? 'word');
        throw e;
      }
    }),
  );

  /**
   * "Try signing up by text": a text from a number reserved for fiction,
   * run through the real path with every reply returned instead of sent.
   * Only the conversation the operator is typing comes back.
   */
  app.post(
    '/api/admin/simulate',
    handle(async c => {
      const body = await readBody(c);
      const site = await loadSite(c.env);
      let from: string;
      try {
        from = tidyNumber(body.from, site.config);
      } catch {
        throw new AdminError(400, 'Type a number from 555-0100 to 555-0199, for example (732) 555-0150.', 'from');
      }
      const loc = body.location as { latitude?: unknown; longitude?: unknown } | null | undefined;
      const location =
        loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number' && Math.abs(loc.latitude) <= 90 && Math.abs(loc.longitude) <= 180 ? { latitude: loc.latitude, longitude: loc.longitude } : null;
      if (typeof body.text !== 'string' || (body.text.trim() === '' && !location)) throw new AdminError(400, 'Type a text to send.', 'text');
      try {
        const result = await simulateText(c.env, deps, site, { from, text: body.text, location, origin: originOf(c) });
        return c.json({ outcome: result.outcome, replies: result.replies.map(r => (r.suggestions ? { text: r.text, suggestions: r.suggestions } : { text: r.text })), householdId: result.householdId });
      } catch (e) {
        if (e instanceof ValidationError) throw new AdminError(400, e.message, isFictionalNumber(from) ? 'text' : 'from');
        throw e;
      }
    }),
  );

  app.delete('/api/admin/households/:id', async c => {
    const household = await loadHousehold(c.env, c.req.param('id')).catch(() => null);
    await deleteAccount(c.env, deps, { id: c.req.param('id'), google: household?.data.google ?? null });
    return c.json(await state(c));
  });

  /** Accounts as counts and dates only: ?sort=newest|oldest|changed|phones&q=<part of an id>. */
  app.get('/api/admin/accounts', async c => {
    const sortParam = c.req.query('sort');
    const sort: AccountSort = sortParam === 'oldest' || sortParam === 'changed' || sortParam === 'phones' ? sortParam : 'newest';
    const query = (c.req.query('q') ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    return c.json(await listAccounts(c.env, deps.now(), { sort, query }));
  });

  /** Counts per day for the last ?days= days (7 to 90, default 30). */
  app.get('/api/admin/history', async c => {
    const asked = Number(c.req.query('days') ?? 30);
    const days = Number.isInteger(asked) && asked >= 7 && asked <= 90 ? asked : 30;
    return c.json({ days: await usageHistory(c.env, deps.now(), days) });
  });

  app.post(
    '/api/admin/test-text',
    handle(async c => {
      const now = deps.now();
      const site = await loadSite(c.env);
      const body = await readBody(c);
      let to: string;
      try {
        to = tidyNumber(body.to, site.config);
      } catch (e) {
        if (e instanceof ValidationError) throw new AdminError(400, e.message, 'to');
        throw e;
      }
      if (isFictionalNumber(to)) throw new AdminError(400, FICTIONAL_MESSAGE, 'to');
      const outcome = await sendSms(c.env, deps, site, { to, text: TEST_TEXT, now });
      await noteSmsOutcome(c.env.DB, outcome, now);
      if (!outcome.ok) {
        const { kind, code } = failureOf(outcome);
        throw new AdminError(502, `${FAILURE_SENTENCE[kind] ?? 'The text was not sent.'}${kind === 'refused' && code ? ` Telnyx error ${code}.` : ''}`);
      }
      return c.json({ ok: true, state: await state(c) });
    }),
  );

  /** The "Check" buttons: read-only calls to Telnyx or Google. The result is kept for the status page. */
  app.post('/api/admin/check/:which', async c => {
    const which = c.req.param('which');
    if (which !== 'telnyx' && which !== 'rcs' && which !== 'google') return c.json({ error: 'Not found.' }, 404);
    const now = deps.now();
    const { secrets } = await loadSite(c.env);
    const result =
      which === 'telnyx' ? await checkTelnyx(deps, secrets, now) : which === 'rcs' ? await checkRcs(deps, secrets, now) : await checkGoogle(deps, secrets, `${originOf(c)}/api/google/callback`, now);
    await saveCheck(c.env.DB, which, result, now);
    return c.json({ result, state: await state(c) });
  });

  /** Deletes the test account, found by the phones it was made with. Only a test account is ever deleted here. */
  const deleteDemo = async (env: Env): Promise<void> => {
    for (const number of [DEMO_NUMBER, DEMO_SPOUSE]) {
      const row = await getPhone(env.DB, await phoneHash(env, number));
      if (!row) continue;
      const household = await loadHousehold(env, row.household_id).catch(() => null);
      if (household && !household.data.demo) throw new AdminError(409, 'A regular account uses a number of the test account; it was left alone.');
      await deleteAccount(env, deps, { id: row.household_id, google: household?.data.google ?? null });
    }
  };

  /**
   * Opens a fresh test account: deletes the one there was, makes a new one
   * with a made-up history, and signs this browser in to it with its test
   * phone. No text is sent.
   */
  app.post(
    '/api/admin/demo',
    handle(async c => {
      const now = deps.now();
      const site = await loadSite(c.env);
      await deleteDemo(c.env);
      const household = await createHousehold(c.env, buildDemoData(now), now);
      for (const number of [DEMO_NUMBER, DEMO_SPOUSE]) {
        if (!(await insertPhone(c.env.DB, await phoneHash(c.env, number), household.id, null, now))) {
          await deleteHousehold(c.env.DB, household.id);
          throw new AdminError(409, 'Please try again.');
        }
      }
      await refreshHousehold(c.env, deps, site, household, compute(household.data, now), now);
      const phone = await getPhone(c.env.DB, await phoneHash(c.env, DEMO_NUMBER));
      if (!phone) throw new AdminError(409, 'Please try again.');
      // Signed in "by code", so that the password can be set within the next minutes, as after a real sign-in.
      c.header('Set-Cookie', await sessionCookie(c.env, phone, 'code', now, isSecure(c)));
      return c.json({ ok: true, number: DEMO_NUMBER });
    }),
  );

  app.delete(
    '/api/admin/demo',
    handle(async c => {
      await deleteDemo(c.env);
      return c.json(await state(c));
    }),
  );

  app.all('/api/admin/*', c => c.json({ error: 'Not found.' }, 404));
}
