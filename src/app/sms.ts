/**
 * Text messages through Telnyx: sending, and checking that a received
 * webhook really comes from Telnyx.
 *
 * Telnyx signs each webhook with Ed25519 over "{timestamp}|{raw body}" and
 * sends the signature and timestamp in the headers telnyx-signature-ed25519
 * and telnyx-timestamp.
 */
import { verifyEd25519 } from './crypto';
import type { Deps } from './env';

const TELNYX_MESSAGES = 'https://api.telnyx.com/v2/messages';

/** Reject webhooks whose timestamp is further than this from the current time. */
const MAX_SKEW_SECONDS = 300;

export interface InboundMessage {
  /** Id of the webhook event, used to recognise repeated deliveries. */
  eventId: string;
  from: string;
  to: string;
  text: string;
}

export type WebhookResult =
  | { ok: true; message: InboundMessage | null }
  | { ok: false; status: number; reason: string };

export async function readTelnyxWebhook(
  rawBody: string,
  headers: { signature: string | null; timestamp: string | null },
  publicKey: string,
  nowMs: number,
): Promise<WebhookResult> {
  if (!headers.signature || !headers.timestamp) return { ok: false, status: 401, reason: 'missing signature' };
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > MAX_SKEW_SECONDS) {
    return { ok: false, status: 401, reason: 'stale timestamp' };
  }
  if (!(await verifyEd25519(publicKey, headers.signature, `${headers.timestamp}|${rawBody}`))) {
    return { ok: false, status: 401, reason: 'bad signature' };
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, reason: 'not JSON' };
  }
  const data = (body as { data?: Record<string, unknown> }).data;
  if (!data || typeof data.id !== 'string') return { ok: false, status: 400, reason: 'no event' };
  // Delivery reports and other events are acknowledged and ignored.
  if (data.event_type !== 'message.received') return { ok: true, message: null };
  const payload = data.payload as { from?: { phone_number?: unknown }; to?: Array<{ phone_number?: unknown }>; text?: unknown } | undefined;
  const from = payload?.from?.phone_number;
  const to = payload?.to?.[0]?.phone_number;
  if (typeof from !== 'string' || typeof to !== 'string') return { ok: false, status: 400, reason: 'no sender' };
  return { ok: true, message: { eventId: data.id, from, to, text: typeof payload?.text === 'string' ? payload.text : '' } };
}

export type SendResult = { ok: true; id: string | null } | { ok: false; error: string };

export async function sendTelnyx(deps: Deps, args: { apiKey: string; from: string; to: string; text: string }): Promise<SendResult> {
  try {
    const res = await deps.fetch(TELNYX_MESSAGES, {
      method: 'POST',
      headers: { authorization: `Bearer ${args.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: args.from, to: args.to, text: args.text }),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = '';
      try {
        const errors = (JSON.parse(text) as { errors?: Array<{ code?: unknown; title?: unknown; detail?: unknown }> }).errors;
        const first = errors?.[0];
        if (first) detail = [first.code, first.title, first.detail].filter(x => typeof x === 'string').join(' ');
      } catch {
        // keep the status only
      }
      return { ok: false, error: `Telnyx ${res.status}${detail ? `: ${detail}` : ''}` };
    }
    let id: string | null = null;
    try {
      const parsed = JSON.parse(text) as { data?: { id?: unknown } };
      if (typeof parsed.data?.id === 'string') id = parsed.data.id;
    } catch {
      // sent, but no id to record
    }
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' };
  }
}
