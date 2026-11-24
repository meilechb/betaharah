/**
 * Text messages through Telnyx: sending (by SMS, or by RCS with an SMS
 * fallback), and checking that a received webhook really comes from Telnyx.
 *
 * Telnyx signs each webhook with Ed25519 over "{timestamp}|{raw body}" and
 * sends the signature and timestamp in the headers telnyx-signature-ed25519
 * and telnyx-timestamp. RCS webhooks are signed the same way (Telnyx's
 * "RCS Webhooks" guide, "Best practices").
 *
 * The RCS shapes follow Telnyx's guides "Send RCS Messages" and "RCS
 * Webhooks": a send goes to /v2/messages/rcs with agent_id, to,
 * messaging_profile_id, agent_message.content_message (text and
 * suggestions) and sms_fallback (from, text); its answer's data.type says
 * whether it went as "RCS" or "SMS". An inbound RCS message has
 * payload.type "RCS", the sender in payload.from.phone_number, the agent in
 * payload.to[].agent_id, and its content in payload.body: text, a tapped
 * suggestion (suggestion_response.postback_data), a shared location
 * (location.latitude, location.longitude), or a file (user_file).
 */
import { verifyEd25519 } from './crypto';
import type { Deps } from './env';

const TELNYX_MESSAGES = 'https://api.telnyx.com/v2/messages';
const TELNYX_RCS = 'https://api.telnyx.com/v2/messages/rcs';

/** Reject webhooks whose timestamp is further than this from the current time. */
const MAX_SKEW_SECONDS = 300;

export interface InboundMessage {
  /** Id of the webhook event, used to recognise repeated deliveries. */
  eventId: string;
  /** How it arrived. */
  channel: 'sms' | 'rcs';
  from: string;
  /** SMS: the number it was sent to. RCS: empty (see agentId). */
  to: string;
  /** RCS: the agent it was sent to. SMS: null. */
  agentId: string | null;
  /**
   * What was typed. For a tapped RCS suggestion, its postback data (which is
   * exactly what an SMS user would type). Empty for a shared location and
   * for content this app does not read (a file, a picture).
   */
  text: string;
  /** RCS: a location the person shared. */
  location: { latitude: number; longitude: number } | null;
  /**
   * Set by Telnyx when the text was one of its opt-out, opt-in or help
   * keywords and it acted on it: 'STOP', 'START' or 'HELP'.
   */
  autoresponseType: string | null;
}

export type WebhookResult =
  | { ok: true; message: InboundMessage | null }
  | { ok: false; status: number; reason: string };

/** Longest text read from a webhook; longer is cut (the conversation reads at most 400 characters). */
const MAX_INBOUND_TEXT = 2000;

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
  const data = (body as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== 'object' || typeof data.id !== 'string') return { ok: false, status: 400, reason: 'no event' };
  // Delivery reports, read receipts and other events are acknowledged and ignored.
  if (data.event_type !== 'message.received') return { ok: true, message: null };
  const payload = (typeof data.payload === 'object' && data.payload !== null ? data.payload : {}) as {
    type?: unknown;
    from?: { phone_number?: unknown };
    to?: Array<{ phone_number?: unknown; agent_id?: unknown }>;
    text?: unknown;
    body?: unknown;
    autoresponse_type?: unknown;
  };
  const from = payload.from?.phone_number;
  if (typeof from !== 'string') return { ok: false, status: 400, reason: 'no sender' };
  const autoresponseType = typeof payload.autoresponse_type === 'string' && payload.autoresponse_type !== '' ? payload.autoresponse_type.toUpperCase() : null;
  const firstTo = Array.isArray(payload.to) ? payload.to[0] : undefined;

  if (payload.type === 'RCS') {
    const agentId = firstTo?.agent_id;
    if (typeof agentId !== 'string') return { ok: false, status: 400, reason: 'no agent' };
    const b = (typeof payload.body === 'object' && payload.body !== null ? payload.body : {}) as {
      text?: unknown;
      suggestion_response?: { postback_data?: unknown };
      location?: { latitude?: unknown; longitude?: unknown };
    };
    let text = '';
    let location: InboundMessage['location'] = null;
    const postback = b.suggestion_response?.postback_data;
    if (typeof postback === 'string') text = postback;
    else if (typeof b.text === 'string') text = b.text;
    else if (b.location && typeof b.location.latitude === 'number' && typeof b.location.longitude === 'number') {
      location = { latitude: b.location.latitude, longitude: b.location.longitude };
    }
    // Anything else (a file, a picture) arrives as an empty text: the conversation says it was not understood.
    return { ok: true, message: { eventId: data.id, channel: 'rcs', from, to: '', agentId, text: text.slice(0, MAX_INBOUND_TEXT), location, autoresponseType } };
  }

  const to = firstTo?.phone_number;
  if (typeof to !== 'string') return { ok: false, status: 400, reason: 'no sender' };
  return {
    ok: true,
    message: {
      eventId: data.id,
      channel: 'sms',
      from,
      to,
      agentId: null,
      text: typeof payload.text === 'string' ? payload.text.slice(0, MAX_INBOUND_TEXT) : '',
      location: null,
      autoresponseType,
    },
  };
}

/**
 * `blocked` is true when Telnyx refused because the recipient opted out (its
 * error 40300). `channel` is how Telnyx says it sent the message ("RCS" or
 * "SMS" for an RCS send with a fallback), when it says.
 */
export type SendResult = { ok: true; id: string | null; channel: 'rcs' | 'sms' | null } | { ok: false; error: string; blocked: boolean };

async function postTelnyx(deps: Deps, url: string, apiKey: string, payload: unknown): Promise<SendResult> {
  try {
    const res = await deps.fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = '';
      let blocked = false;
      try {
        const errors = (JSON.parse(text) as { errors?: Array<{ code?: unknown; title?: unknown; detail?: unknown }> }).errors;
        const first = errors?.[0];
        if (first) detail = [first.code, first.title, first.detail].filter(x => typeof x === 'string').join(' ');
        blocked = (errors ?? []).some(e => String(e.code) === '40300');
      } catch {
        // keep the status only
      }
      return { ok: false, error: `Telnyx ${res.status}${detail ? `: ${detail}` : ''}`, blocked };
    }
    let id: string | null = null;
    let channel: 'rcs' | 'sms' | null = null;
    try {
      const parsed = JSON.parse(text) as { data?: { id?: unknown; type?: unknown } };
      if (typeof parsed.data?.id === 'string') id = parsed.data.id;
      if (parsed.data?.type === 'RCS') channel = 'rcs';
      else if (parsed.data?.type === 'SMS') channel = 'sms';
    } catch {
      // sent, but no id to record
    }
    return { ok: true, id, channel };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error', blocked: false };
  }
}

export async function sendTelnyx(deps: Deps, args: { apiKey: string; from: string; to: string; text: string }): Promise<SendResult> {
  const result = await postTelnyx(deps, TELNYX_MESSAGES, args.apiKey, { from: args.from, to: args.to, text: args.text });
  return result.ok ? { ...result, channel: 'sms' } : result;
}

/** One tap-to-reply button: `label` is shown, `send` comes back as the postback data. */
export interface RcsSuggestion {
  label: string;
  send: string;
}

/**
 * Sends a text through the RCS agent, with its suggestions as suggested
 * replies, and always with an SMS fallback of the same text from the site's
 * number, so that a phone without RCS receives an ordinary text.
 */
export async function sendTelnyxRcs(
  deps: Deps,
  args: { apiKey: string; agentId: string; messagingProfileId: string; from: string; to: string; text: string; rcsText?: string; suggestions?: RcsSuggestion[] },
): Promise<SendResult> {
  // By RCS the options are the buttons, so the text above them is the body alone; the SMS fallback keeps the options line.
  const content: { text: string; suggestions?: Array<{ reply: { text: string; postback_data: string } }> } = { text: args.suggestions && args.suggestions.length > 0 && args.rcsText ? args.rcsText : args.text };
  if (args.suggestions && args.suggestions.length > 0) content.suggestions = args.suggestions.map(s => ({ reply: { text: s.label, postback_data: s.send } }));
  return postTelnyx(deps, TELNYX_RCS, args.apiKey, {
    agent_id: args.agentId,
    to: args.to,
    messaging_profile_id: args.messagingProfileId,
    agent_message: { content_message: content },
    sms_fallback: { from: args.from, text: args.text },
  });
}
