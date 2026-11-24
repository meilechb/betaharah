/** What is stored for one household, and for the site as a whole. */
import type { LogEntry } from '../engine/cycle';
import { DEFAULT_HALACHIC_SETTINGS, type HalachicSettings } from '../engine/settings';
import { DEFAULT_APP_SETTINGS, type AppSettings, type PhoneRecord } from './settings';

export interface StoredEntry {
  entry: LogEntry;
  /** 'dashboard' or 'sms' */
  source: string;
  note: string | null;
  createdAt: number;
}

export interface SyncState {
  /** Something changed since the calendar was last brought fully up to date. */
  dirty: boolean;
  lastRunAt: number | null;
  lastOkAt: number | null;
  lastError: string | null;
}

export interface MessageRecord {
  direction: 'in' | 'out';
  /** Last four digits of the phone, for display */
  phone: string;
  body: string;
  at: number;
  status: string;
}

/** A reminder waiting to be sent to one phone, or a note that it was dealt with. */
export interface QueuedReminder {
  /** The reminder's stable identity; with `to`, it is sent at most once. */
  key: string;
  /** The phone it goes to, E.164. */
  to: string;
  at: number;
  /** It is no longer sent from this time on. */
  until: number;
  /** The words to send; emptied once it has been dealt with. */
  text: string;
  status: 'pending' | 'sending' | 'sent' | 'dropped';
  /** After a failed attempt: not to be tried again before this time. */
  notBefore: number;
  /** When it was taken for sending, sent, or dropped. */
  doneAt: number | null;
}

/**
 * Everything about one household. It is stored as a single encrypted
 * document, so none of it is readable in the database.
 */
export interface HouseholdData {
  halachic: HalachicSettings;
  /** When the halachic settings were last reviewed and saved; null if never. */
  halachicConfirmedAt: number | null;
  app: AppSettings;
  /** The phones that can sign in to this household. */
  phones: PhoneRecord[];
  entries: StoredEntry[];
  /** Recently removed entries, kept so that a mistaken removal can be traced. */
  removed: Array<StoredEntry & { removedAt: number }>;
  google: { calendarId: string; refreshToken: string; connectedAt: number } | null;
  sync: SyncState;
  /** Secret part of the calendar subscription link, if one was created. */
  calendarLinkToken: string | null;
  /** The most recent text messages, newest first. */
  messages: MessageRecord[];
  /** The coming reminders for each phone, and a record of those already dealt with. */
  queue: QueuedReminder[];
  /** Texts sent to this household in one calendar month, for its monthly limit. */
  usage: { month: string; texts: number };
  /** Ids of the latest received texts, so that one delivered twice is acted on once. */
  seenTexts: string[];
  /** The Google account that can sign in, if one was connected. The subject id is not stored here. */
  googleLogin: { email: string; name: string } | null;
}

export function newHousehold(): HouseholdData {
  return {
    // Copies, so that changing one household's settings can never change the defaults.
    halachic: structuredClone(DEFAULT_HALACHIC_SETTINGS),
    halachicConfirmedAt: null,
    app: structuredClone(DEFAULT_APP_SETTINGS),
    phones: [],
    entries: [],
    removed: [],
    google: null,
    sync: { dirty: true, lastRunAt: null, lastOkAt: null, lastError: null },
    calendarLinkToken: null,
    messages: [],
    queue: [],
    usage: { month: '', texts: 0 },
    seenTexts: [],
    googleLogin: null,
  };
}

export const MAX_MESSAGES_KEPT = 30;
export const MAX_REMOVED_KEPT = 50;
export const MAX_PHONES = 4;
export const MAX_SEEN_TEXTS = 60;

export function addMessage(data: HouseholdData, m: MessageRecord): void {
  data.messages.unshift({ ...m, body: m.body.slice(0, 320) });
  if (data.messages.length > MAX_MESSAGES_KEPT) data.messages.length = MAX_MESSAGES_KEPT;
}

export function lastFour(number: string): string {
  return number.slice(-4);
}

/** A phone that has proved its number and agreed to texts, and has not replied STOP. */
export function canText(p: PhoneRecord): boolean {
  return p.verifiedAt !== null && p.consentAt !== null && !p.optedOut;
}

// ---------- the site ----------

export interface SiteConfig {
  /** Who may create an account. */
  signup: 'open' | 'invite' | 'closed';
  /** Master switch for sending text messages. */
  smsEnabled: boolean;
  /** Numbers must begin with one of these to sign up or be added, e.g. "+1". */
  allowedPrefixes: string[];
  /** Most sign-in codes sent in one day, across everyone. */
  dailyCodeLimit: number;
  /** Most text messages sent in one month, across everyone. */
  monthlyMessageLimit: number;
  /** Most text messages sent to one household in one month. */
  householdMonthlyLimit: number;
  /** Shown on the help, privacy and terms pages. */
  contactName: string;
  contactEmail: string;
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  signup: 'open',
  smsEnabled: true,
  allowedPrefixes: ['+1'],
  dailyCodeLimit: 150,
  monthlyMessageLimit: 3000,
  householdMonthlyLimit: 200,
  contactName: 'Betaharah',
  contactEmail: 'privacy@betaharah.com',
};

/** Standing mailboxes. They are live even when the operator has not typed a contact. */
export const PRIVACY_EMAIL = 'privacy@betaharah.com';
export const ADMIN_EMAIL = 'admin@betaharah.com';

export interface SiteSecrets {
  googleClientId?: string;
  googleClientSecret?: string;
  telnyxApiKey?: string;
  telnyxPublicKey?: string;
  /** The number messages are sent from and received on, E.164. */
  telnyxNumber?: string;
}

export const SITE_SECRET_KEYS = ['googleClientId', 'googleClientSecret', 'telnyxApiKey', 'telnyxPublicKey', 'telnyxNumber'] as const;

export interface Site {
  config: SiteConfig;
  secrets: SiteSecrets;
}

export function smsReady(site: Site): boolean {
  return site.config.smsEnabled && Boolean(site.secrets.telnyxApiKey && site.secrets.telnyxPublicKey && site.secrets.telnyxNumber);
}

export function googleReady(site: Site): boolean {
  return Boolean(site.secrets.googleClientId && site.secrets.googleClientSecret);
}
