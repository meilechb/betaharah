/*
 * Shared state of the operator console: the state from the server (S), the
 * drafts of the forms, and small helpers for numbers, dates and money.
 * The console never receives any account's data; S holds the site's own
 * settings, counts and times only.
 */
import { api, toast, setBusy } from '/app/lib.js';

/** The server's state (GET /api/admin/state), or null before sign-in. */
export let S = null;

/** Drafts of the forms, kept across redraws until saved. */
export const draft = {
  config: null,
  /** True once the settings form was changed and not yet saved. */
  configDirty: false,
  secrets: {},
  invite: { kind: 'setup', number: '', word: '', note: '', maxUses: 5, days: 14, link: '', linkKind: '' },
  testTo: '',
  price: null,
  errors: {},
};

let redraw = () => undefined;
let onSignedOut = () => undefined;

/** main.js tells the sections how to redraw the page and what to do after a sign-out. */
export function configure(opts) {
  if (opts.redraw) redraw = opts.redraw;
  if (opts.signedOut) onSignedOut = opts.signedOut;
}

export const render = () => redraw();

export function adopt(state, opts) {
  S = state;
  const keepConfig = draft.configDirty && !(opts && opts.configSaved);
  if (!keepConfig) {
    draft.config = JSON.parse(JSON.stringify(state.config));
    draft.configDirty = false;
  }
  if (opts && opts.secretsSaved) draft.secrets = {};
  if (draft.price === null || (opts && opts.priceSaved)) draft.price = String(state.notes.centsPerText);
}

export function forget() {
  S = null;
  draft.secrets = {};
  draft.invite.link = '';
  draft.configDirty = false;
  draft.price = null;
}

/**
 * Runs an action with a button busy. done(result) runs on success. Errors
 * are shown in a toast, unless onError handles them (and returns true).
 */
export async function run(action, done, button, onError) {
  setBusy(button, true);
  try {
    const result = await action();
    if (done) done(result);
    return result;
  } catch (e) {
    if (onError && onError(e)) return null;
    if (e.status === 401) {
      onSignedOut('Your session has ended. Sign in again.');
      return null;
    }
    toast(e.message || 'Something went wrong.', true);
    return null;
  } finally {
    if (button && button.isConnected) setBusy(button, false);
  }
}

/** After a call that answers with the new state: adopt it, redraw, show a message. */
export function saved(message, opts) {
  return state => {
    adopt(state, opts);
    redraw();
    if (message) toast(message);
  };
}

export const call = api;

// ---------- numbers, dates, money ----------

const nf = new Intl.NumberFormat('en-US');
export const num = n => nf.format(n);
export const plural = (n, one, many) => num(n) + ' ' + (n === 1 ? one : many || one + 's');

export function date(ms) {
  return new Date(ms).toLocaleDateString('en-US', { dateStyle: 'medium' });
}
export function dateTime(ms) {
  return new Date(ms).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}
export function time(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { timeStyle: 'short' });
}

/** "3 minutes ago", "yesterday at 4:10 PM", or a date. */
export function ago(ms, now) {
  const n = now === undefined ? Date.now() : now;
  const diff = Math.max(0, n - ms);
  const min = Math.round(diff / 60000);
  if (min < 1) return 'less than a minute ago';
  if (min < 60) return plural(min, 'minute') + ' ago';
  const hours = Math.round(min / 60);
  if (hours < 24) return plural(hours, 'hour') + ' ago';
  const days = Math.round(hours / 24);
  if (days < 7) return plural(days, 'day') + ' ago';
  return 'on ' + date(ms);
}

/** Dollars from cents, e.g. 1234.5 cents as "$12.35". */
export function dollars(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(cents / 100);
}

/** A UTC day key ("2026-11-23") as "Nov 23". */
export function dayLabel(day, withYear) {
  const d = new Date(day + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: withYear ? 'numeric' : undefined, timeZone: 'UTC' });
}

/** The pages of the console, in the order of the navigation. */
export const PAGES = [
  { id: 'overview', label: 'Overview', icon: 'info', group: '', desc: 'How the site is doing, and what is left to set up.' },
  { id: 'accounts', label: 'Accounts', icon: 'user', group: 'People', desc: 'Every account, by an internal id and its dates.' },
  { id: 'invites', label: 'Invitations', icon: 'link', group: 'People', desc: 'Links and words that let people sign up while sign-up is by invitation, and accounts for one number.' },
  { id: 'usage', label: 'Usage and cost', icon: 'message', group: 'Texting', desc: 'Texts and sign-in codes against the limits, what they cost, and the last 30 days.' },
  { id: 'simulator', label: 'Text simulator', icon: 'phone', group: 'Texting', desc: 'Try sign-up and every text command from a made-up number. Nothing is sent and nothing is charged.' },
  { id: 'settings', label: 'Site settings', icon: 'settings', group: 'Setup', desc: 'Who may sign up, the switches for texting, and the limits that cap the bill.' },
  { id: 'keys', label: 'Keys and connections', icon: 'lock', group: 'Setup', desc: 'Telnyx for texts, RCS, and Google Calendar. Keys are write-only.' },
  { id: 'test', label: 'Test account', icon: 'calendar', group: 'Tools', desc: 'A made-up household for trying every feature. It never texts a real phone.' },
  { id: 'tools', label: 'Tools', icon: 'bell', group: 'Tools', desc: 'A test text to your own phone, and the public pages.' },
];

export const sectionLabel = id => (PAGES.find(p => p.id === id) || { label: id }).label;
