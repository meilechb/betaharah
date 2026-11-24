/**
 * The reminders waiting to be sent, and the count of texts a household has
 * used this month. Both live inside the household's encrypted document, so
 * that nobody reading the database can see a household's schedule. The only
 * thing kept outside is one time per household: when its next reminder is
 * due (see `nextWake`), which the periodic job needs in order to know which
 * household to open.
 *
 * Everything here works on the household's data alone, with no access to
 * the database or the network.
 */
import type { Reminder } from '../engine/present';
import { canText, type HouseholdData, type QueuedReminder } from './model';

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Reminders are worked out this far ahead; later ones are added as the time approaches. */
const HORIZON_MS = 45 * DAY;
/** How long a note of a sent or dropped reminder is kept, so that it is never sent again. */
const KEEP_DONE_MS = 45 * DAY;
/** A reminder taken for sending by a run that then stopped goes back to waiting after this long. */
export const SENDING_TIMEOUT_MS = 10 * MINUTE;
/** After a failed attempt a reminder is tried again this much later, while it is still worth sending. */
export const RETRY_MS = 10 * MINUTE;

const idOf = (q: { key: string; to: string }): string => `${q.key}|${q.to}`;

/**
 * Replaces the waiting reminders with a new list worked out from the
 * current picture. Whatever was already sent, dropped, or is being sent
 * keeps its record, so nothing is sent a second time; a reminder waiting
 * for another attempt keeps its waiting time.
 */
export function rebuildQueue(data: HouseholdData, reminders: readonly Reminder[] | null, now: number): void {
  const numbers = new Set(data.phones.map(p => p.number));
  const done = new Map<string, QueuedReminder>();
  const notBefore = new Map<string, number>();
  for (const q of data.queue) {
    if (!numbers.has(q.to)) continue; // the phone was removed from the account
    if (q.status === 'pending') {
      if (q.notBefore > now) notBefore.set(idOf(q), q.notBefore);
    } else if (q.status === 'sending' || (q.doneAt ?? 0) > now - KEEP_DONE_MS) {
      done.set(idOf(q), q);
    }
  }
  const next = [...done.values()];
  if (reminders) {
    const phones = data.phones.filter(canText);
    for (const r of reminders) {
      if (r.until <= now || r.at > now + HORIZON_MS) continue;
      for (const p of phones) {
        if (!p.reminders.includes(r.kind)) continue;
        const id = `${r.key}|${p.number}`;
        if (done.has(id)) continue;
        next.push({ key: r.key, to: p.number, at: r.at, until: r.until, text: r.text, msg: r.msg, status: 'pending', notBefore: notBefore.get(id) ?? 0, doneAt: null });
      }
    }
  }
  data.queue = next;
}

/**
 * When the periodic job should next open this household: the time of its
 * earliest waiting reminder, or null if nothing waits.
 */
export function nextWake(data: HouseholdData): number | null {
  let wake: number | null = null;
  for (const q of data.queue) {
    let t: number;
    if (q.status === 'pending') t = Math.max(q.at, q.notBefore);
    else if (q.status === 'sending') t = (q.doneAt ?? 0) + SENDING_TIMEOUT_MS;
    else continue;
    if (wake === null || t < wake) wake = t;
  }
  return wake;
}

function drop(q: QueuedReminder, now: number): void {
  q.status = 'dropped';
  q.doneAt = now;
  q.text = '';
  delete q.msg;
}

const monthOf = (now: number): string => new Date(now).toISOString().slice(0, 7);

/** Texts sent to the household so far this month. */
export function textsThisMonth(data: HouseholdData, now: number): number {
  return data.usage.month === monthOf(now) ? data.usage.texts : 0;
}

/**
 * Counts one text against the household's monthly limit. Returns false,
 * counting nothing, if the limit has been reached.
 */
export function allowText(data: HouseholdData, monthlyLimit: number, now: number): boolean {
  const month = monthOf(now);
  if (data.usage.month !== month) data.usage = { month, texts: 0 };
  if (data.usage.texts >= monthlyLimit) return false;
  data.usage.texts += 1;
  return true;
}

/** Takes back one count, for a text that was not sent after all. */
export function refundText(data: HouseholdData, now: number): void {
  if (data.usage.month === monthOf(now) && data.usage.texts > 0) data.usage.texts -= 1;
}

/**
 * Marks the reminders that are due as being sent, and returns them (at most
 * `limit`). A reminder is dropped instead if its time is over, its phone no
 * longer receives texts, or the household's monthly limit is reached.
 */
export function takeDue(data: HouseholdData, now: number, limit: number, monthlyLimit: number): QueuedReminder[] {
  const taken: QueuedReminder[] = [];
  for (const q of data.queue) {
    if (q.status === 'sending' && (q.doneAt ?? 0) <= now - SENDING_TIMEOUT_MS) {
      // a run that stopped half-way
      q.status = 'pending';
      q.doneAt = null;
    }
    if (q.status !== 'pending' || q.at > now || q.notBefore > now) continue;
    if (now >= q.until) {
      drop(q, now);
      continue;
    }
    const phone = data.phones.find(p => p.number === q.to);
    if (!phone || !canText(phone)) {
      drop(q, now);
      continue;
    }
    if (taken.length >= limit) continue;
    if (!allowText(data, monthlyLimit, now)) {
      drop(q, now);
      continue;
    }
    q.status = 'sending';
    q.doneAt = now;
    taken.push({ ...q });
  }
  return taken;
}

/**
 * While the site cannot send texts: puts off each reminder that is due, so
 * that it is still sent if texting comes back while it is worth sending,
 * and drops it once its time is over (or its phone no longer receives
 * texts). A put-off reminder is looked at again `RETRY_MS` later, so that
 * the household's next wake time moves forward instead of staying in the
 * past. Nothing is counted against the monthly limit. Returns how many
 * reminders were put off or dropped.
 */
export function postponeDue(data: HouseholdData, now: number): number {
  let changed = 0;
  for (const q of data.queue) {
    if (q.status === 'sending' && (q.doneAt ?? 0) <= now - SENDING_TIMEOUT_MS) {
      q.status = 'pending';
      q.doneAt = null;
    }
    if (q.status !== 'pending' || q.at > now || q.notBefore > now) continue;
    changed++;
    const phone = data.phones.find(p => p.number === q.to);
    if (now >= q.until || !phone || !canText(phone)) drop(q, now);
    else q.notBefore = now + RETRY_MS;
  }
  return changed;
}

export type Settlement = 'sent' | 'failed' | 'blocked' | 'refused';

/**
 * Records what became of a reminder that was taken for sending.
 *   sent     it went out
 *   failed   the provider could not send it: tried again later, while it is still worth sending
 *   blocked  the carrier says the phone opted out: noted on the phone
 *   refused  the site's own limit was reached, or texting is off
 */
export function settle(data: HouseholdData, taken: Pick<QueuedReminder, 'key' | 'to'>, result: Settlement, now: number): void {
  if (result !== 'sent') refundText(data, now);
  if (result === 'blocked') {
    const phone = data.phones.find(p => p.number === taken.to);
    if (phone) phone.optedOut = true;
  }
  const q = data.queue.find(x => x.key === taken.key && x.to === taken.to && x.status === 'sending');
  if (!q) return;
  if (result === 'sent') {
    q.status = 'sent';
    q.doneAt = now;
    q.text = '';
    delete q.msg;
  } else if (result === 'failed' && now + RETRY_MS < q.until) {
    q.status = 'pending';
    q.doneAt = null;
    q.notBefore = now + RETRY_MS;
  } else {
    drop(q, now);
  }
}
