/**
 * The types of the conversation engine. See engine.ts for how they are used
 * and docs/TEXTING.md for the integrator's guide.
 */
import type { TzeitRule } from '../../engine/zmanim';
import type { Computed } from '../household';
import type { HouseholdData } from '../model';
import type { PlaceSetting } from '../settings';
import type { SiteTexts } from './site-texts';

/** A place found from a ZIP or postal code (from the lookup another module provides). */
export type Place = PlaceSetting & { postal: string };

/** One RCS button. `send` is what a tap sends back: exactly the label. */
export interface Suggestion {
  /** At most 20 characters. */
  label: string;
  send: string;
}

/** One text to send back to the phone that wrote. */
export interface OutMessage {
  /** The SMS: the body, then the options on the last line. GSM-7 basic characters; at most 306 (two segments). */
  text: string;
  /** The body alone: the text an RCS phone shows above its buttons. */
  body: string;
  /** The options, as RCS buttons (at most 6). An SMS phone sees them on the text's last line. */
  suggestions?: Suggestion[];
}

/** What a YES does. */
export type ConfirmAction =
  | { type: 'erase'; id: string }
  | { type: 'remove_phone'; number: string }
  | { type: 'leave' }
  | { type: 'delete_account' }
  | { type: 'calendar_new' }
  | { type: 'calendar_off' }
  | { type: 'pause_vesatot' }
  | { type: 'place'; place: Place };

/** What is recorded by text. */
export type RecordKind = 'flow' | 'stain' | 'broken' | 'hefsek' | 'mikvah';

/** Free text a message can ask for. */
export type ChatExpect = 'zip' | 'date' | 'days' | 'time';

/** What the options of the last message need to know to act. */
export interface ChatContext {
  /** In the setup conversation: after this step, the next one follows. */
  setup?: boolean;
  /** For the questions "when?": what is being recorded. */
  kind?: RecordKind;
  /** The day the hefsek reminder was about: DONE records the hefsek on it. */
  day?: number;
  /** HISTORY: the entries, in the order of the ordinals offered. */
  ids?: string[];
  /** PHONES: the phones, in the order of the ordinals. */
  numbers?: string[];
  /** A custom: its index in SMS_CUSTOMS, and whether it is part of going through all 12. */
  index?: number;
  walk?: boolean;
  /** A YES-or-NO question: what YES does. */
  action?: ConfirmAction;
}

/**
 * The options of the last message sent to one phone, kept (inside the
 * encrypted household document, one per phone) until the next message
 * replaces them or CHAT_TTL_MS (24 hours) passes. Plain JSON.
 */
export interface ChatState {
  v: 2;
  /** When the message was sent. */
  at: number;
  /** Its key in the registry (messages.ts). */
  key: string;
  /** The options as they were shown: [id, label]. */
  opts: Array<[string, string]>;
  /** Free text the message asked for: a ZIP code, a date, the numbers of clean days, or a clock time. */
  expect?: ChatExpect;
  ctx: ChatContext;
}

/**
 * Something only the server can do. Each carries `ifFailed`: if the server
 * cannot carry it out, it sends that text to the phone that wrote instead
 * of the engine's `out` messages.
 */
export type Effect =
  /**
   * A code for adding another phone to this household. The server stores it
   * (a keyed fingerprint only, bound to this household, single use, valid
   * `days` days) and then sends `out`, which tells the person who asked to
   * have the other phone text "JOIN <code>". Nothing is sent to any other
   * number.
   */
  | { type: 'join_code'; code: string; days: number; ifFailed: OutMessage }
  /** Remove another phone (`number`) from this household (accounts.removePhone). */
  | { type: 'remove_phone'; number: string; ifFailed: OutMessage }
  /** Remove the phone that wrote (`number`) from its household. Never the last phone. */
  | { type: 'leave'; number: string; ifFailed: OutMessage }
  /** Delete the whole household, before sending `out`. */
  | { type: 'delete_account'; ifFailed: OutMessage }
  /**
   * Create a one-time sign-in link for `number` and text it as one plain
   * SMS: `text` with LINK_MARK replaced by the link. The engine sends nothing else.
   */
  | { type: 'web_link'; number: string; text: string; ifFailed: OutMessage };

export interface ConverseInput {
  /** The household. Changed in place when something is recorded or changed (then `changed` is true). */
  data: HouseholdData;
  /** The options of the last message to this phone, as returned last time, or null. */
  chat: ChatState | null;
  /** E.164 of the phone that wrote; one of data.phones. */
  from: string;
  /** What was typed; for an RCS button tap, its label. */
  text: string;
  /** RCS only: a location the person shared. */
  location?: { latitude: number; longitude: number };
  now: number;
  limits: { maxPhones: number };
  lookupPostal(input: string): Place | null;
  nearestPostal(latitude: number, longitude: number): Place | null;
  /** An unguessable random token (for calendar links and the codes for adding a phone), e.g. crypto.randomToken(). */
  random(): string;
  /** The site's address for links, default "https://betaharah.com". */
  origin?: string;
  /** The operator's wording (store.loadSite); the defaults when absent. */
  texts?: SiteTexts;
}

export interface ConverseOutput {
  /** The options now offered to this phone, or null. */
  chat: ChatState | null;
  /** The texts to send back, in order; at most 2. */
  out: OutMessage[];
  /** Things only the server can do. */
  effects: Effect[];
  /** The household data was changed: save it, then refresh its reminders and calendar. */
  changed: boolean;
  /** The picture after the change, when it was already worked out. */
  computed?: Computed;
}

export interface GreetInput {
  /** What a number with no account typed. */
  text: string;
  signup: 'open' | 'invite' | 'closed';
  /** Whether the word after JOIN is a valid invitation; null when there was no word. */
  inviteValid: boolean | null;
  /** What the valid invitation is for: a new account, or adding this phone to an account. */
  inviteKind?: 'signup' | 'phone';
  texts?: SiteTexts;
}

export interface GreetOutput {
  /**
   * create: create an account with this phone, verified, then call begin(..., 'setup').
   * join:   add this phone to the household that issued invitation `invite`, then call begin(..., 'joined').
   * reply:  send `out`; nothing else.
   * ignore: send nothing.
   */
  action: 'create' | 'join' | 'reply' | 'ignore';
  out: OutMessage[];
  /** The invitation word typed after JOIN, as typed. */
  invite?: string;
}

export interface BeginInput {
  data: HouseholdData;
  from: string;
  now: number;
  texts?: SiteTexts;
}

/** Re-exported for the customs table. */
export type { TzeitRule };
