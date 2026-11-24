/**
 * Small wrappers over Web Crypto: authenticated encryption for stored data,
 * HMAC for sessions and fingerprints, password hashing, and Ed25519 for
 * webhook signatures.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

/** A key for one purpose, derived from the master secret. */
async function derive(master: string, purpose: string): Promise<Uint8Array> {
  if (typeof master !== 'string' || master.length < 32) throw new Error('ENCRYPTION_KEY must be at least 32 characters');
  return sha256(`betaharah:${purpose}:${master}`);
}

function storageKey(master: string): Promise<CryptoKey> {
  return cachedKey(`aes|${master}`, async () =>
    crypto.subtle.importKey('raw', await derive(master, 'storage'), 'AES-GCM', false, ['encrypt', 'decrypt']),
  );
}

/**
 * Encrypts a string with AES-256-GCM. Output: base64(iv || ciphertext).
 * `context` is bound into the result: text encrypted for one context cannot
 * be decrypted as another, so one household's stored data cannot be passed
 * off as a different household's.
 */
export async function encrypt(master: string, plaintext: string, context = ''): Promise<string> {
  const key = await storageKey(master);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, key, encoder.encode(plaintext)),
  );
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return toBase64(out);
}

/** Reverses `encrypt`. Throws if the text was altered, the key is wrong, or the context differs. */
export async function decrypt(master: string, encoded: string, context = ''): Promise<string> {
  const data = fromBase64(encoded);
  if (data.length < 13) throw new Error('ciphertext is too short');
  const key = await storageKey(master);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: data.slice(0, 12), additionalData: encoder.encode(context) },
    key,
    data.slice(12),
  );
  return decoder.decode(plain);
}

// Prepared keys are kept for the life of the process, so that each request
// does not derive them again.
const keyCache = new Map<string, Promise<CryptoKey>>();

function cachedKey(id: string, make: () => Promise<CryptoKey>): Promise<CryptoKey> {
  let key = keyCache.get(id);
  if (!key) {
    key = make();
    keyCache.set(id, key);
    key.catch(() => keyCache.delete(id));
  }
  return key;
}

function hmacKey(master: string, purpose: string): Promise<CryptoKey> {
  return cachedKey(`hmac|${purpose}|${master}`, async () =>
    crypto.subtle.importKey('raw', await derive(master, purpose), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']),
  );
}

/** `payload.signature`, both base64url. */
export async function sign(master: string, purpose: string, payload: string): Promise<string> {
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(master, purpose), encoder.encode(payload)));
  return `${toBase64Url(encoder.encode(payload))}.${toBase64Url(mac)}`;
}

/** Returns the payload if the signature is valid, otherwise null. */
export async function verifySigned(master: string, purpose: string, token: string): Promise<string | null> {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  try {
    const payload = fromBase64(token.slice(0, dot));
    const mac = fromBase64(token.slice(dot + 1));
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(master, purpose), mac, payload);
    return ok ? decoder.decode(payload) : null;
  } catch {
    return null;
  }
}

/**
 * A keyed fingerprint of a value (hex). Phone numbers, invitation codes and
 * calendar links are looked up by fingerprint, so the values themselves are
 * not readable in the database, and the fingerprints cannot be recomputed
 * without the master secret.
 */
export async function fingerprint(master: string, purpose: string, value: string): Promise<string> {
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(master, `fp:${purpose}`), encoder.encode(value)));
  return [...mac].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Compares two strings without leaking, through timing, where they differ. */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] as number) ^ (y[i] as number);
  return diff === 0;
}

/**
 * Verifies an Ed25519 signature. `publicKey` is base64: either the raw
 * 32-byte key or a DER SubjectPublicKeyInfo.
 */
export async function verifyEd25519(publicKey: string, signature: string, message: string): Promise<boolean> {
  try {
    const keyBytes = fromBase64(publicKey.trim());
    const key = await crypto.subtle.importKey(keyBytes.length === 32 ? 'raw' : 'spki', keyBytes, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, fromBase64(signature.trim()), encoder.encode(message));
  } catch {
    return false;
  }
}

export function randomId(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(12)));
}

/** A long random value for links that must not be guessable. */
export function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(24)));
}

/** A six-digit code, each value equally likely. */
export function randomCode(): string {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  for (;;) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] as number;
    if (n < limit) return String(n % 1_000_000).padStart(6, '0');
  }
}

// ---------- passwords ----------

/**
 * Passwords are stretched with PBKDF2-SHA256 and then keyed with a secret
 * that is not in the database (derived from ENCRYPTION_KEY). Someone who
 * obtains only the database cannot test guesses at all.
 *
 * The iteration count is what fits in Cloudflare's free plan (10 ms of
 * processor time per request); it is lower than OWASP recommends for PBKDF2
 * on its own. The count is stored with each record, so it can be raised
 * later and existing passwords upgraded at the next sign-in.
 */
export const PASSWORD_ITERATIONS = 20_000;
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

async function stretch(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

async function keyed(master: string, stretched: Uint8Array): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(master, 'password'), stretched)));
}

/** A record of a password that can be checked later but not reversed. */
export async function hashPassword(master: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await keyed(master, await stretch(password, salt, PASSWORD_ITERATIONS));
  return `v1$${PASSWORD_ITERATIONS}$${toBase64(salt)}$${hash}`;
}

export async function checkPassword(master: string, password: string, record: string): Promise<boolean> {
  const parts = record.split('$');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 1_000_000) return false;
  try {
    const hash = await keyed(master, await stretch(password, fromBase64(parts[2] as string), iterations));
    return await constantTimeEqual(hash, parts[3] as string);
  } catch {
    return false;
  }
}
