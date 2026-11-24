/**
 * Creating an account, and adding and removing the phones that can sign in
 * to it.
 *
 * A phone number can belong to one household only. The `phones` table
 * enforces that (the number's fingerprint is its primary key); the
 * household's own list of phones is kept in step with it here.
 */
import { DEFAULT_SITE_CONFIG, MAX_PHONES, newHousehold, type SiteConfig } from './model';
import { parsePhoneNumber, REMINDER_KINDS, ValidationError, type PhoneRecord } from './settings';
import type { Env } from './env';
import { changeHousehold, createHousehold, deleteHousehold, deletePhone, getPhone, insertPhone, phoneHash, type PhoneRow } from './store';

/**
 * Tidies a number as people type it. A ten-digit number, or eleven digits
 * beginning with 1, is taken as a North American number when the site
 * allows those.
 */
export function tidyNumber(input: unknown, config: SiteConfig = DEFAULT_SITE_CONFIG): string {
  if (typeof input !== 'string') throw new ValidationError('Enter a phone number.');
  let n = input.replace(/[\s().-]/g, '');
  if (!n.startsWith('+') && config.allowedPrefixes.includes('+1')) {
    if (/^\d{10}$/.test(n)) n = `+1${n}`;
    else if (/^1\d{10}$/.test(n)) n = `+${n}`;
  }
  return parsePhoneNumber(n);
}

export function prefixAllowed(number: string, config: SiteConfig): boolean {
  return config.allowedPrefixes.some(p => number.startsWith(p));
}

export function prefixMessage(config: SiteConfig): string {
  return `Only numbers beginning with ${config.allowedPrefixes.join(' or ')} can be used here.`;
}

function newPhone(number: string, verified: boolean, now: number): PhoneRecord {
  return { number, name: '', canUpdate: true, reminders: [...REMINDER_KINDS], verifiedAt: verified ? now : null, consentAt: null, optedOut: false };
}

export type Created = { ok: true; phone: PhoneRow } | { ok: false; reason: 'taken' };

/**
 * Creates a household with one phone. `verified` says whether the number
 * was proved by a texted code; `password` is an already-hashed password or
 * null.
 */
export async function createAccount(env: Env, args: { number: string; verified: boolean; password: string | null; now: number }): Promise<Created> {
  const hash = await phoneHash(env, args.number);
  const data = newHousehold();
  data.phones.push(newPhone(args.number, args.verified, args.now));
  const household = await createHousehold(env, data, args.now);
  if (!(await insertPhone(env.DB, hash, household.id, args.password, args.now))) {
    // The number was registered by another request in the same moment.
    await deleteHousehold(env.DB, household.id);
    return { ok: false, reason: 'taken' };
  }
  const phone = await getPhone(env.DB, hash);
  if (!phone) throw new Error('phone row missing after insert');
  return { ok: true, phone };
}

/** Notes that a phone's number has now been proved by a texted code. */
export async function markVerified(env: Env, householdId: string, number: string, now: number): Promise<void> {
  await changeHousehold(env, householdId, now, data => {
    const phone = data.phones.find(p => p.number === number);
    if (phone && phone.verifiedAt === null) phone.verifiedAt = now;
  });
}

export type Added = { ok: true; already: boolean } | { ok: false; reason: 'taken' | 'full' };

/** Adds a phone whose number was just proved by a code to a household. */
export async function addPhone(env: Env, householdId: string, number: string, now: number): Promise<Added> {
  const hash = await phoneHash(env, number);
  const existing = await getPhone(env.DB, hash);
  if (existing) {
    if (existing.household_id !== householdId) return { ok: false, reason: 'taken' };
    await markVerified(env, householdId, number, now);
    return { ok: true, already: true };
  }
  if (!(await insertPhone(env.DB, hash, householdId, null, now))) return { ok: false, reason: 'taken' };
  const changed = await changeHousehold(env, householdId, now, data => {
    if (data.phones.some(p => p.number === number)) return true;
    if (data.phones.length >= MAX_PHONES) return false;
    data.phones.push(newPhone(number, true, now));
    return true;
  });
  if (!changed || !changed.result) {
    await deletePhone(env.DB, hash, householdId);
    return { ok: false, reason: 'full' };
  }
  return { ok: true, already: false };
}

export type Removed = { ok: true; hash: string } | { ok: false; reason: 'missing' | 'last' };

/** Removes a phone from a household. The last phone cannot be removed; the account is deleted instead. */
export async function removePhone(env: Env, householdId: string, number: string, now: number): Promise<Removed> {
  const changed = await changeHousehold(env, householdId, now, data => {
    if (!data.phones.some(p => p.number === number)) return 'missing' as const;
    if (data.phones.length <= 1) return 'last' as const;
    data.phones = data.phones.filter(p => p.number !== number);
    data.queue = data.queue.filter(q => q.to !== number); // nothing more waits for it
    return 'ok' as const;
  });
  if (!changed || changed.result === 'missing') return { ok: false, reason: 'missing' };
  if (changed.result === 'last') return { ok: false, reason: 'last' };
  const hash = await phoneHash(env, number);
  await deletePhone(env.DB, hash, householdId);
  return { ok: true, hash };
}
