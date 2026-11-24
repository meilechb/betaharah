import { describe, expect, it } from 'vitest';
import { tidyNumber } from '../src/app/accounts';
import {
  checkPassword,
  constantTimeEqual,
  decrypt,
  encrypt,
  fingerprint,
  hashPassword,
  PASSWORD_ITERATIONS,
  randomCode,
  randomId,
  randomToken,
  sign,
  toBase64,
  verifyEd25519,
  verifySigned,
} from '../src/app/crypto';
import type { ExistingEvent } from '../src/app/google';
import { authorizationUrl, CALENDAR_SCOPE } from '../src/app/google';
import { HELP_TEXT } from '../src/app/commands';
import { DEFAULT_SITE_CONFIG, newHousehold } from '../src/app/model';
import { codeText, HELP_REPLY, inboundKind, REMINDERS_ON_TEXT, TEST_TEXT } from '../src/app/service';
import {
  DEFAULT_APP_SETTINGS,
  parseAppSettings,
  parsePhoneNumber,
  parsePhoneOptions,
  parsePlace,
  assertSunTimesExist,
  PLACES,
  REMINDER_KINDS,
  ValidationError,
} from '../src/app/settings';
import { parseSiteConfig } from '../src/app/store';
import { readTelnyxWebhook } from '../src/app/sms';
import { planSync, toDesired, type DesiredEvent } from '../src/app/sync';
import { civilToAbs } from '../src/engine/civil';
import type { CalendarEvent } from '../src/engine/calendar';
import { DEFAULT_HALACHIC_SETTINGS, HALACHIC_CHOICES, parseHalachicSettings, SettingsError } from '../src/engine/settings';
import { fill } from '../src/engine/terms';
import { NoSunError } from '../src/engine/zmanim';
import { FakeTelnyx } from './fakes';

const KEY = 'x'.repeat(40);

describe('encryption and signatures', () => {
  it('encrypts and decrypts, with a fresh result each time', async () => {
    const a = await encrypt(KEY, 'secret value');
    const b = await encrypt(KEY, 'secret value');
    expect(a).not.toBe(b);
    expect(a).not.toContain('secret');
    expect(await decrypt(KEY, a)).toBe('secret value');
    expect(await decrypt(KEY, b)).toBe('secret value');
  });

  it('refuses altered text or a different key', async () => {
    const a = await encrypt(KEY, 'secret value');
    const altered = a.slice(0, -4) + (a.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    await expect(decrypt(KEY, altered)).rejects.toThrow();
    await expect(decrypt('y'.repeat(40), a)).rejects.toThrow();
    await expect(encrypt('short', 'x')).rejects.toThrow();
  });

  it('binds what it encrypts to a context: one account\'s data cannot be read as another\'s', async () => {
    const a = await encrypt(KEY, 'the entries of household A', 'household:A');
    expect(await decrypt(KEY, a, 'household:A')).toBe('the entries of household A');
    await expect(decrypt(KEY, a, 'household:B')).rejects.toThrow();
    await expect(decrypt(KEY, a)).rejects.toThrow();
  });

  it('fingerprints are keyed, stable, and differ by purpose', async () => {
    const a = await fingerprint(KEY, 'phone', '+17325550123');
    expect(a).toBe(await fingerprint(KEY, 'phone', '+17325550123'));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(await fingerprint(KEY, 'phone', '+17325550124'));
    expect(a).not.toBe(await fingerprint(KEY, 'invite', '+17325550123'));
    expect(a).not.toBe(await fingerprint('y'.repeat(40), 'phone', '+17325550123'));
  });

  it('keeps a password as a salted record that needs the server key to check', async () => {
    const record = await hashPassword(KEY, 'a long enough password');
    expect(record).toMatch(new RegExp(`^v1\\$${PASSWORD_ITERATIONS}\\$[A-Za-z0-9+/=]+\\$[A-Za-z0-9+/=]+$`));
    expect(record).not.toContain('password');
    expect(await checkPassword(KEY, 'a long enough password', record)).toBe(true);
    expect(await checkPassword(KEY, 'a long enough passwore', record)).toBe(false);
    expect(await checkPassword('y'.repeat(40), 'a long enough password', record)).toBe(false);
    expect(await hashPassword(KEY, 'a long enough password')).not.toBe(record); // a fresh salt each time
    for (const bad of ['', 'v1$1$x$y', 'v2$20000$AAAA$AAAA', 'v1$20000$AAAA', 'v1$99999999$AAAA$AAAA']) expect(await checkPassword(KEY, 'x', bad)).toBe(false);
  });

  it('makes codes of six digits and ids that do not repeat', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const code = randomCode();
      expect(code).toMatch(/^\d{6}$/);
      codes.add(code);
    }
    expect(codes.size).toBeGreaterThan(480);
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(randomId()).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(randomToken()).not.toBe(randomToken());
  });

  it('signs and verifies, per purpose', async () => {
    const token = await sign(KEY, 'session', '{"exp":1}');
    expect(await verifySigned(KEY, 'session', token)).toBe('{"exp":1}');
    expect(await verifySigned(KEY, 'oauth', token)).toBeNull();
    expect(await verifySigned('z'.repeat(40), 'session', token)).toBeNull();
    // alter one character in the middle of the signature (the final character carries unused bits)
    const dot = token.indexOf('.');
    const i = dot + 10;
    const altered = token.slice(0, i) + (token[i] === 'A' ? 'B' : 'A') + token.slice(i + 1);
    expect(await verifySigned(KEY, 'session', altered)).toBeNull();
    // and one in the payload
    const j = 3;
    const alteredPayload = token.slice(0, j) + (token[j] === 'A' ? 'B' : 'A') + token.slice(j + 1);
    expect(await verifySigned(KEY, 'session', alteredPayload)).toBeNull();
    expect(await verifySigned(KEY, 'session', 'garbage')).toBeNull();
    expect(await verifySigned(KEY, 'session', '')).toBeNull();
  });

  it('compares strings', async () => {
    expect(await constantTimeEqual('abc', 'abc')).toBe(true);
    expect(await constantTimeEqual('abc', 'abd')).toBe(false);
    expect(await constantTimeEqual('abc', 'abcd')).toBe(false);
  });

  it('verifies Ed25519 with a raw or a DER public key', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const raw = toBase64(new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer));
    const der = toBase64(new Uint8Array((await crypto.subtle.exportKey('spki', pair.publicKey)) as ArrayBuffer));
    const sig = toBase64(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode('hello'))));
    expect(await verifyEd25519(raw, sig, 'hello')).toBe(true);
    expect(await verifyEd25519(der, sig, 'hello')).toBe(true);
    expect(await verifyEd25519(raw, sig, 'hellp')).toBe(false);
    expect(await verifyEd25519('not a key', sig, 'hello')).toBe(false);
    expect(await verifyEd25519(raw, 'not a signature', 'hello')).toBe(false);
  });
});

describe('halachic settings', () => {
  it('the defaults are valid and every choice lists the default among its options', () => {
    expect(parseHalachicSettings(DEFAULT_HALACHIC_SETTINGS)).toEqual(DEFAULT_HALACHIC_SETTINGS);
    for (const c of HALACHIC_CHOICES) {
      expect(c.options.map(o => o.value)).toContain(DEFAULT_HALACHIC_SETTINGS[c.key]);
      expect(c.options.length).toBeGreaterThanOrEqual(2);
      // the texts are English sentences whose terms can be filled in either form
      expect(c.title).not.toMatch(/[֐-׿]/);
      for (const text of [c.title, c.help, ...c.options.map(o => o.label)]) {
        expect(fill(text, 'en')).not.toMatch(/[{}]/);
        expect(fill(text, 'he')).not.toMatch(/[{}]/);
      }
    }
    // every setting except tzeit is offered as a choice
    expect(HALACHIC_CHOICES.map(c => c.key).sort()).toEqual(Object.keys(DEFAULT_HALACHIC_SETTINGS).filter(k => k !== 'tzeit').sort());
  });

  it('accepts every combination of options', () => {
    for (const c of HALACHIC_CHOICES) {
      for (const o of c.options) expect(parseHalachicSettings({ ...DEFAULT_HALACHIC_SETTINGS, [c.key]: o.value })[c.key]).toBe(o.value);
    }
    expect(parseHalachicSettings({ ...DEFAULT_HALACHIC_SETTINGS, tzeit: { kind: 'minutes', value: 72 } }).tzeit).toEqual({ kind: 'minutes', value: 72 });
  });

  it('rejects anything else', () => {
    expect(() => parseHalachicSettings(null)).toThrow(SettingsError);
    expect(() => parseHalachicSettings({})).toThrow(SettingsError);
    expect(() => parseHalachicSettings({ ...DEFAULT_HALACHIC_SETTINGS, minWaitDays: '3' })).toThrow(SettingsError);
    expect(() => parseHalachicSettings({ ...DEFAULT_HALACHIC_SETTINGS, minWaitDays: 5 })).toThrow(SettingsError);
    expect(() => parseHalachicSettings({ ...DEFAULT_HALACHIC_SETTINGS, extra: 1 })).toThrow(SettingsError);
    expect(() => parseHalachicSettings({ ...DEFAULT_HALACHIC_SETTINGS, tzeit: { kind: 'degrees', value: 40 } })).toThrow(SettingsError);
    expect(() => parseHalachicSettings({ ...DEFAULT_HALACHIC_SETTINGS, tzeit: { kind: 'minutes', value: 5 } })).toThrow(SettingsError);
    expect(() => parseHalachicSettings({ ...DEFAULT_HALACHIC_SETTINGS, tzeit: { kind: 'hours', value: 1 } })).toThrow(SettingsError);
    const { orZarua: _omit, ...missing } = DEFAULT_HALACHIC_SETTINGS;
    expect(() => parseHalachicSettings(missing)).toThrow(SettingsError);
  });
});

describe('app settings', () => {
  const valid = { ...DEFAULT_APP_SETTINGS, place: PLACES[0] };

  it('accepts valid settings', () => {
    const s = parseAppSettings(valid);
    expect(s.place!.name).toBe('Lakewood, NJ');
    expect(parseAppSettings(DEFAULT_APP_SETTINGS)).toEqual(DEFAULT_APP_SETTINGS);
    expect(parseAppSettings({ ...valid, terms: 'he' }).terms).toBe('he');
    expect(DEFAULT_APP_SETTINGS.terms).toBe('en');
  });

  it('a new household starts from its own copy of the defaults', () => {
    const a = newHousehold();
    const b = newHousehold();
    a.app.terms = 'he';
    a.halachic.minWaitDays = '4';
    a.app.reminders.hefsek.on = false;
    expect(b.app.terms).toBe('en');
    expect(b.halachic.minWaitDays).toBe('5');
    expect(DEFAULT_APP_SETTINGS.terms).toBe('en');
    expect(DEFAULT_APP_SETTINGS.reminders.hefsek.on).toBe(true);
    expect(DEFAULT_HALACHIC_SETTINGS.minWaitDays).toBe('5');
  });

  it('tidies phone numbers and checks their form', () => {
    expect(parsePhoneNumber('+1 (732) 555-0123')).toBe('+17325550123');
    expect(() => parsePhoneNumber('7325550123')).toThrow(ValidationError);
    expect(() => parsePhoneNumber('+1')).toThrow(ValidationError);
    expect(() => parsePhoneNumber(17325550123)).toThrow(ValidationError);
    // as people type them, when North American numbers are allowed
    expect(tidyNumber('(732) 555-0123')).toBe('+17325550123');
    expect(tidyNumber('732.555.0123')).toBe('+17325550123');
    expect(tidyNumber('1 732 555 0123')).toBe('+17325550123');
    expect(tidyNumber('+44 20 7946 0958')).toBe('+442079460958');
    expect(() => tidyNumber('555-0123')).toThrow(ValidationError);
    expect(() => tidyNumber('(732) 555-0123', { ...DEFAULT_SITE_CONFIG, allowedPrefixes: ['+44'] })).toThrow(ValidationError);
    expect(() => tidyNumber(undefined)).toThrow(ValidationError);
  });

  it('checks what a household may change about a phone', () => {
    expect(parsePhoneOptions({ name: ' M ', canUpdate: true, reminders: ['hefsek', 'onah', 'hefsek'], number: 'ignored', verifiedAt: 1 })).toEqual({ name: 'M', canUpdate: true, reminders: ['hefsek', 'onah'] });
    expect(() => parsePhoneOptions({ name: 'M', canUpdate: true, reminders: ['everything'] })).toThrow(ValidationError);
    expect(() => parsePhoneOptions({ name: 'M', canUpdate: 'yes', reminders: [] })).toThrow(ValidationError);
    expect(() => parsePhoneOptions({ name: 'x'.repeat(41), canUpdate: true, reminders: [] })).toThrow(ValidationError);
    expect(REMINDER_KINDS).toHaveLength(6);
  });

  it('checks the site settings', () => {
    expect(parseSiteConfig(DEFAULT_SITE_CONFIG)).toEqual(DEFAULT_SITE_CONFIG);
    const bad = (patch: Record<string, unknown>) => () => parseSiteConfig({ ...DEFAULT_SITE_CONFIG, ...patch });
    expect(bad({ signup: 'everyone' })).toThrow(ValidationError);
    expect(bad({ allowedPrefixes: [] })).toThrow(ValidationError);
    expect(bad({ allowedPrefixes: ['1'] })).toThrow(ValidationError);
    expect(bad({ dailyCodeLimit: -1 })).toThrow(ValidationError);
    expect(bad({ monthlyMessageLimit: 1.5 })).toThrow(ValidationError);
    expect(bad({ contactEmail: 'not an address' })).toThrow(ValidationError);
    expect(bad({ smsEnabled: 'yes' })).toThrow(ValidationError);
    expect(parseSiteConfig({ ...DEFAULT_SITE_CONFIG, allowedPrefixes: ['+1', '+44', '+1'] }).allowedPrefixes).toEqual(['+1', '+44']);
  });

  it('rejects bad values', () => {
    const bad = (patch: Record<string, unknown>) => () => parseAppSettings({ ...valid, ...patch });
    expect(bad({ place: { ...PLACES[0], latitude: 91 } })).toThrow(ValidationError);
    expect(bad({ place: { ...PLACES[0], timeZone: 'Nowhere/Land' } })).toThrow(ValidationError);
    expect(bad({ place: { ...PLACES[0], name: ' ' } })).toThrow(ValidationError);
    expect(bad({ calendar: { name: 'B', style: 'fancy', historyDays: 400 } })).toThrow(ValidationError);
    expect(bad({ calendar: { name: 'B', style: 'words', historyDays: 5 } })).toThrow(ValidationError);
    expect(bad({ calendar: { name: ' ', style: 'words', historyDays: 400 } })).toThrow(ValidationError);
    expect(bad({ calendar: { name: 'x'.repeat(41), style: 'words', historyDays: 400 } })).toThrow(ValidationError);
    expect(bad({ terms: 'yi' })).toThrow(ValidationError);
    expect(bad({ boundaryMarginMinutes: -1 })).toThrow(ValidationError);
    expect(bad({ reminders: { ...DEFAULT_APP_SETTINGS.reminders, hefsek: { on: 'yes', minutesBeforeSunset: 120 } } })).toThrow(ValidationError);
    expect(bad({ reminders: { ...DEFAULT_APP_SETTINGS.reminders, bedikot: { ...DEFAULT_APP_SETTINGS.reminders.bedikot, morningHour: 24 } } })).toThrow(ValidationError);
    expect(() => parseAppSettings('x')).toThrow(ValidationError);
  });

  it('every listed place is valid and has sun times all year', () => {
    for (const p of PLACES) {
      const place = parsePlace(p);
      for (const useElevation of [false, true]) {
        expect(() => assertSunTimesExist(place, { useElevation, tzeit: { kind: 'degrees', value: 8.5 } })).not.toThrow();
      }
    }
    expect(new Set(PLACES.map(p => p.name)).size).toBe(PLACES.length);
  });

  it('refuses a place where the sun does not set every day', () => {
    const tromso = parsePlace({ name: 'Tromso', latitude: 69.65, longitude: 18.96, timeZone: 'Europe/Oslo', elevation: 0 });
    expect(() => assertSunTimesExist(tromso, { useElevation: false, tzeit: { kind: 'degrees', value: 8.5 } })).toThrow(NoSunError);
  });
});

describe('Google sign-in address', () => {
  it('asks only for the app-created-calendar permission, with offline access', () => {
    const u = new URL(authorizationUrl({ clientId: 'id', redirectUri: 'https://x.example/api/google/callback', state: 's' }));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('scope')).toBe(CALENDAR_SCOPE);
    expect(CALENDAR_SCOPE).toBe('https://www.googleapis.com/auth/calendar.app.created');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('redirect_uri')).toBe('https://x.example/api/google/callback');
    expect(u.searchParams.get('state')).toBe('s');
  });
});

describe('planning a calendar sync', () => {
  const NOW = Date.UTC(2026, 10, 23);
  const DAY = 86_400_000;
  const windowStart = NOW - 400 * DAY;
  const want = (key: string, hash: string, endMs = NOW + DAY): DesiredEvent => ({ key, hash, endMs, resource: {} as DesiredEvent['resource'] });
  const have = (id: string, key: string | null, hash: string, endMs = NOW + DAY): ExistingEvent => ({ id, props: key === null ? {} : { mk: '1', k: key, h: hash }, endMs });

  it('adds what is missing', () => {
    expect(planSync([want('a', '1')], [], windowStart)).toEqual([{ op: 'insert', desired: want('a', '1') }]);
  });
  it('does nothing when everything matches', () => {
    expect(planSync([want('a', '1'), want('b', '2')], [have('e1', 'a', '1'), have('e2', 'b', '2')], windowStart)).toEqual([]);
  });
  it('replaces what changed', () => {
    expect(planSync([want('a', '2')], [have('e1', 'a', '1')], windowStart)).toEqual([{ op: 'update', id: 'e1', desired: want('a', '2') }]);
  });
  it('removes what is no longer wanted', () => {
    expect(planSync([], [have('e1', 'a', '1')], windowStart)).toEqual([{ op: 'delete', id: 'e1', key: 'a' }]);
  });
  it('removes duplicates of a wanted event and keeps one', () => {
    const ops = planSync([want('a', '1')], [have('e1', 'a', '1'), have('e2', 'a', '1'), have('e3', 'a', '0')], windowStart);
    expect(ops).toEqual([{ op: 'delete', id: 'e2', key: 'a' }, { op: 'delete', id: 'e3', key: 'a' }]);
  });
  it('does not write events that ended before the window', () => {
    expect(planSync([want('old', '1', windowStart - DAY)], [], windowStart)).toEqual([]);
  });
  it('leaves old events at the edge of the window alone', () => {
    expect(planSync([], [have('e1', 'old', '1', windowStart + 3 * DAY)], windowStart)).toEqual([]);
    expect(planSync([], [have('e1', 'old', '1', windowStart + 8 * DAY)], windowStart)).toEqual([{ op: 'delete', id: 'e1', key: 'old' }]);
  });
  it('removals come first, then replacements, then additions', () => {
    const ops = planSync([want('a', '2'), want('c', '1')], [have('e1', 'a', '1'), have('e2', 'b', '1')], windowStart);
    expect(ops.map(o => o.op)).toEqual(['delete', 'update', 'insert']);
  });

  it('turns an event into a Google event', async () => {
    const timed: CalendarEvent = { key: 'onah:1', kind: 'onah', title: 'עונת הוסת (יום)', description: 'x', timed: { start: Date.UTC(2026, 11, 21, 12, 15), end: Date.UTC(2026, 11, 21, 21, 35) }, projected: false };
    const d = toDesired(timed, 'America/New_York');
    expect(d.resource.start).toEqual({ dateTime: '2026-12-21T12:15:00.000Z', timeZone: 'America/New_York' });
    expect(d.resource.end).toEqual({ dateTime: '2026-12-21T21:35:00.000Z', timeZone: 'America/New_York' });
    expect(d.resource.extendedProperties.private).toEqual({ mk: '1', k: 'onah:1', h: d.hash });
    expect(d.resource.transparency).toBe('transparent');
    expect(d.resource.colorId).toBe('11');
    expect(d.endMs).toBe(timed.timed!.end);
    expect((toDesired({ ...timed, light: true }, 'America/New_York')).resource.colorId).toBe('6');

    const allDay: CalendarEvent = { key: 'clean:f:1', kind: 'clean_day', title: 't', description: '', allDay: { startAbs: civilToAbs({ y: 2026, m: 11, d: 27 }), endAbsExclusive: civilToAbs({ y: 2026, m: 11, d: 28 }) }, projected: false };
    const a = toDesired(allDay, 'America/New_York');
    expect(a.resource.start).toEqual({ date: '2026-11-27' });
    expect(a.resource.end).toEqual({ date: '2026-11-28' });
    expect(a.endMs).toBe(Date.UTC(2026, 10, 28, 5)); // midnight in New York

    // the hash follows the content
    expect((toDesired(timed, 'America/New_York')).hash).toBe(d.hash);
    expect((toDesired({ ...timed, title: 'other' }, 'America/New_York')).hash).not.toBe(d.hash);
    expect((toDesired({ ...timed, timed: { ...timed.timed!, end: timed.timed!.end + 60_000 } }, 'America/New_York')).hash).not.toBe(d.hash);
  });
});

describe('reading a Telnyx webhook', () => {
  const NOW = Date.UTC(2026, 10, 23, 15);
  it('accepts a correctly signed message', async () => {
    const telnyx = await FakeTelnyx.create();
    const req = await telnyx.inbound({ from: '+17325550123', to: '+18885550100', text: '1', eventId: 'e1', nowMs: NOW });
    const r = await readTelnyxWebhook(req.body, { signature: req.headers['telnyx-signature-ed25519']!, timestamp: req.headers['telnyx-timestamp']! }, telnyx.publicKey, NOW);
    expect(r).toEqual({ ok: true, message: { eventId: 'e1', channel: 'sms', from: '+17325550123', to: '+18885550100', agentId: null, text: '1', location: null, autoresponseType: null } });
  });
  it('passes on the keyword Telnyx says it acted on', async () => {
    const telnyx = await FakeTelnyx.create();
    const req = await telnyx.inbound({ from: '+17325550123', to: '+18885550100', text: 'Stop', eventId: 'e1', nowMs: NOW, autoresponseType: 'STOP' });
    const r = await readTelnyxWebhook(req.body, { signature: req.headers['telnyx-signature-ed25519']!, timestamp: req.headers['telnyx-timestamp']! }, telnyx.publicKey, NOW);
    expect(r).toMatchObject({ ok: true, message: { text: 'Stop', autoresponseType: 'STOP' } });
  });
  it('rejects a changed body, a wrong key, a missing or old signature', async () => {
    const telnyx = await FakeTelnyx.create();
    const other = await FakeTelnyx.create();
    const req = await telnyx.inbound({ from: '+17325550123', to: '+18885550100', text: '1', eventId: 'e1', nowMs: NOW });
    const headers = { signature: req.headers['telnyx-signature-ed25519']!, timestamp: req.headers['telnyx-timestamp']! };
    expect(await readTelnyxWebhook(req.body.replace('"1"', '"4"'), headers, telnyx.publicKey, NOW)).toMatchObject({ ok: false, status: 401 });
    expect(await readTelnyxWebhook(req.body, headers, other.publicKey, NOW)).toMatchObject({ ok: false, status: 401 });
    expect(await readTelnyxWebhook(req.body, { signature: null, timestamp: headers.timestamp }, telnyx.publicKey, NOW)).toMatchObject({ ok: false, status: 401 });
    expect(await readTelnyxWebhook(req.body, headers, telnyx.publicKey, NOW + 10 * 60_000)).toMatchObject({ ok: false, status: 401, reason: 'stale timestamp' });
    // a valid signature over an older timestamp cannot be replayed with a new one
    expect(await readTelnyxWebhook(req.body, { ...headers, timestamp: String(Math.floor((NOW + 10 * 60_000) / 1000)) }, telnyx.publicKey, NOW + 10 * 60_000)).toMatchObject({ ok: false, status: 401, reason: 'bad signature' });
  });
  it('acknowledges other events without acting on them', async () => {
    const telnyx = await FakeTelnyx.create();
    const req = await telnyx.inbound({ from: '+1', to: '+2', text: '', eventId: 'e2', nowMs: NOW, eventType: 'message.finalized' });
    const r = await readTelnyxWebhook(req.body, { signature: req.headers['telnyx-signature-ed25519']!, timestamp: req.headers['telnyx-timestamp']! }, telnyx.publicKey, NOW);
    expect(r).toEqual({ ok: true, message: null });
  });
});

describe('received texts', () => {
  const kind = (text: string, autoresponseType: string | null = null) => inboundKind({ text, autoresponseType });

  it('recognises the opt-out and opt-in words Telnyx acts on, in any case', () => {
    for (const word of ['STOP', 'stop', ' Stop ', 'STOPALL', 'stop all', 'Unsubscribe', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPT OUT', 'optout', 'Opt-Out']) expect(kind(word), word).toBe('stop');
    for (const word of ['START', 'start', 'UNSTOP', ' unstop ']) expect(kind(word), word).toBe('start');
    expect(kind('HELP')).toBe('help');
    expect(kind('info')).toBe('help');
  });

  it('follows what Telnyx reports, whatever the words were', () => {
    expect(kind('please stop texting me', 'STOP')).toBe('stop');
    expect(kind('ok', 'START')).toBe('start');
    // Telnyx may mark HELP as already answered; the site still classifies it as help
    expect(kind('HELP', 'HELP')).toBe('help_answered');
  });

  it('everything else is a command for the calendar, including "?" and digits', () => {
    for (const text of ['1', '2 yesterday', '?', '9', 'stop it', 'yes', 'hello', '']) expect(kind(text), text).toBe('command');
  });
});

describe('the texts the site sends', () => {
  it('each fits one text message in the basic character set', () => {
    const basic = /^[A-Za-z0-9 .,:;()\-\/?!'&@]+$/;
    for (const text of [codeText('123456'), REMINDERS_ON_TEXT, HELP_REPLY, TEST_TEXT, HELP_TEXT]) {
      expect(text, text).toMatch(basic);
      expect(text.length, text).toBeLessThanOrEqual(160);
    }
  });

  it('say who they are from and how to stop, where the carriers require it', () => {
    expect(codeText('123456')).toBe('Betaharah code: 123456. It expires in 10 minutes. Do not share it.');
    expect(HELP_REPLY).toBe('Betaharah: text ? for commands. Help: admin@betaharah.com. Reply STOP to opt out.');
    expect(REMINDERS_ON_TEXT).toBe("Betaharah: you're subscribed to reminder texts. Message frequency varies. Msg&data rates may apply. Reply ? for help, STOP to opt out.");
    expect(HELP_REPLY).toContain('STOP');
    expect(REMINDERS_ON_TEXT).toContain('STOP');
  });
});
