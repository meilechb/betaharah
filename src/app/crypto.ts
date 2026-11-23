/**
 * Small wrappers over Web Crypto: authenticated encryption for stored
 * secrets, HMAC for session cookies, Ed25519 for webhook signatures.
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

export async function sha256Hex(text: string): Promise<string> {
  return [...(await sha256(text))].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** A key for one purpose, derived from the master secret. */
async function derive(master: string, purpose: string): Promise<Uint8Array> {
  if (master.length < 32) throw new Error('ENCRYPTION_KEY must be at least 32 characters');
  return sha256(`betaharah:${purpose}:${master}`);
}

/** Encrypts a string with AES-256-GCM. Output: base64(iv || ciphertext). */
export async function encrypt(master: string, plaintext: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', await derive(master, 'storage'), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext)));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return toBase64(out);
}

/** Reverses `encrypt`. Throws if the text was altered or the key is wrong. */
export async function decrypt(master: string, encoded: string): Promise<string> {
  const data = fromBase64(encoded);
  if (data.length < 13) throw new Error('ciphertext is too short');
  const key = await crypto.subtle.importKey('raw', await derive(master, 'storage'), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, key, data.slice(12));
  return decoder.decode(plain);
}

async function hmacKey(master: string, purpose: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', await derive(master, purpose), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
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
