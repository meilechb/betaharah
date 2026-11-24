/**
 * The types of the conversation engine. See engine.ts for how they are used
 * and docs/TEXTING.md for the integrator's guide.
 */
import type { TzeitRule } from '../../engine/zmanim';
import type { Computed } from '../household';
import type { HouseholdData } from '../model';
import type { PlaceSetting } from '../settings';

/** A place found from a ZIP or postal code (from the lookup another module provides). */
export type Place = PlaceSetting & { postal: string };

/** One RCS button. `send` is exactly what an SMS user would type for the same answer. */
export interface Suggestion {
  /** At most 20 characters. */
  label: string;
  send: string;
}

/** One text to send back to the phone that wrote. */
export interface OutMessage {
  /** GSM-7 basic characters only; at most 306 characters (two SMS segments). */
  text: string;
  /** RCS only: at most 4. An SMS user sees the text alone, which is complete without them. */
  suggestions?: Suggestion[];
}

/** What a yes-or-no question would do on YES. */
export type ConfirmAction =
  | { type: 'erase'; id: string }
  | { type: 'remove_phone'; number: string }
  | { type: 'leave' }
  | { type: 'delete_account' }
  | { type: 'calendar_new' }
  | { type: 'calendar_off' }
  | { type: 'pause_vesatot' }
  | { type: 'place'; place: Place };

/** The question waiting for an answer. */
export type Question =
  /** A ZIP or postal code (or, by RCS, a shared location). */
  | { kind: 'zip' }
  /** Setup step 2: A keep the customs, B go through them, C later on the website. */
  | { kind: 'customs_intro' }
  /** One custom (index into SMS_CUSTOMS, 0 to 11). `walk`: part of going through all twelve. */
  | { kind: 'custom'; index: number; walk: boolean }
  /** The list of customs: a letter A to L picks one. */
  | { kind: 'customs_list' }
  /** Setup step 3: dated record commands, then DONE or SKIP. `recorded`: one was recorded already. */
  | { kind: 'recent'; recorded: boolean }
  /** The lettered history list: ERASE and a letter. */
  | { kind: 'history'; ids: string[] }
  /** The lettered list of phones: REMOVE and a letter. */
  | { kind: 'phones'; numbers: string[] }
  /** Which reminder kinds this phone receives: letters A to F, ALL or NONE. */
  | { kind: 'kinds' }
  /** YES or NO. */
  | { kind: 'confirm'; action: ConfirmAction };

/**
 * The pending question for one phone. The integrator stores it (inside the
 * encrypted household document, one per phone number) and passes it back
 * with the next text from that phone. It is plain JSON.
 */
export interface ChatState {
  v: 1;
  /** When the question was asked. It closes CHAT_TTL_MS (30 minutes) later. */
  at: number;
  /** True while in the setup conversation: after this question, the next setup step follows. */
  setup: boolean;
  q: Question;
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
   * number: the other phone proves its number, and asks for itself, by
   * texting the code. The server then calls greet() with inviteValid true
   * and inviteKind 'phone', and adds the phone to this household (verified,
   * reminders off), unless the household is full by then.
   */
  | { type: 'join_code'; code: string; days: number; ifFailed: string }
  /** Remove another phone (`number`) from this household (accounts.removePhone). */
  | { type: 'remove_phone'; number: string; ifFailed: string }
  /** Remove the phone that wrote (`number`) from its household. Never the last phone. */
  | { type: 'leave'; number: string; ifFailed: string }
  /** Delete the whole household, after sending `out`. */
  | { type: 'delete_account'; ifFailed: string }
  /**
   * Create a one-time sign-in link for `number` and text it as one message:
   * `text` followed by the link. The engine sends nothing else.
   */
  | { type: 'web_link'; number: string; text: string; ifFailed: string };

export interface ConverseInput {
  /** The household. Changed in place when something is recorded or changed (then `changed` is true). */
  data: HouseholdData;
  /** The pending question of this phone, as returned last time, or null. */
  chat: ChatState | null;
  /** E.164 of the phone that wrote; one of data.phones. */
  from: string;
  /** What was typed; for an RCS button tap, the button's postback data (its `send`). */
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
}

export interface ConverseOutput {
  /** The new pending question, or null when none is open. */
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
}

/** Re-exported for the customs table. */
export type { TzeitRule };
