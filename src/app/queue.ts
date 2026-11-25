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
import { restText, type Reminder, type RestText } from '../engine/present';
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
 * The text of a Shabbat or Yom Tov that a queued key belongs to ("rest:<first
 * day>"), or null. Its texts to one phone are "rest:<day>" (the morning it
 * begins), "rest:<day>:more:<n>" (what became known after that text went
 * out, before it begins) and "rest:<day>:after" (after it ends).
 */
export function restBase(key: string): string | null {
  const m = /^rest:-?\d+/.exec(key);
  return m ? m[0] : null;
}

const carried = (q: QueuedReminder): boolean => q.status === 'sent' || q.status === 'sending';

/** The reminders that texts of the same Shabbat or Yom Tov as `q` have brought, or are bringing, to its phone. */
function restCovered(queue: readonly QueuedReminder[], q: QueuedReminder): Set<string> {
  const base = restBase(q.key);
  const covered = new Set<string>();
  for (const x of queue) if (x !== q && x.to === q.to && carried(x) && restBase(x.key) === base) for (const k of x.covered ?? []) covered.add(k);
  return covered;
}

/**
 * Replaces the waiting reminders with a new list worked out from the
 * current picture. Whatever was already sent, dropped, or is being sent
 * keeps its record, so nothing is sent a second time; a reminder waiting
 * for another attempt keeps its waiting time.
 *
 * The text of a Shabbat or Yom Tov goes to each phone with the lines of the
 * kinds that phone gets. Once it has gone out, what becomes known before
 * the days begin goes at once in a further text, and nothing it carried is
 * sent again, alone or in another text. After the days end, a text brings
 * what is still of use that no text before them brought (takeDue leaves out
 * what was).
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
  /** What texts of a Shabbat or Yom Tov brought to each phone. */
  const brought = new Map<string, Set<string>>();
  for (const q of next) if (restBase(q.key) && carried(q)) for (const k of q.covered ?? []) brought.set(q.to, (brought.get(q.to) ?? new Set()).add(k));
  if (reminders) {
    const phones = data.phones.filter(canText);
    const add = (key: string, to: string, at: number, until: number, fields: Pick<QueuedReminder, 'text'> & Partial<QueuedReminder>): void => {
      const id = `${key}|${to}`;
      if (done.has(id) || until <= now || at > now + HORIZON_MS) return;
      next.push({ key, to, at, until, ...fields, status: 'pending', notBefore: notBefore.get(id) ?? 0, doneAt: null });
    };
    for (const r of reminders) {
      for (const p of phones) {
        if (r.rest) {
          const mine = (t: RestText): RestText => ({ ...t, items: t.items.filter(i => p.reminders.includes(i.kind)) });
          const eve = mine(r.rest.eve);
          if (eve.items.length > 0) {
            const group = next.filter(q => q.to === p.number && restBase(q.key) === r.key);
            const covered = new Set(group.filter(carried).flatMap(q => q.covered ?? []));
            const late = eve.items.filter(i => !covered.has(i.key));
            if (!done.has(`${r.key}|${p.number}`)) add(r.key, p.number, r.at, r.until, { text: restText(eve), rest: eve });
            else if (covered.size > 0 && late.length > 0) {
              const more = { ...eve, items: late };
              add(`${r.key}:more:${group.length}`, p.number, Math.max(now, r.at), r.until, { text: restText(more), rest: more });
            }
          }
          const after = mine(r.rest.after.text);
          if (after.items.length > 0) add(`${r.key}:after`, p.number, r.rest.after.at, r.rest.after.until, { text: restText(after), rest: after });
          continue;
        }
        if (r.kind === 'rest' || !p.reminders.includes(r.kind) || brought.get(p.number)?.has(r.key)) continue;
        add(r.key, p.number, r.at, r.until, { text: r.text, msg: r.msg });
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
  delete q.rest;
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
    if (q.rest) {
      // A text of a Shabbat or Yom Tov carries only what no text of the same days has brought to this phone.
      const covered = restCovered(data.queue, q);
      const rest: RestText = { ...q.rest, items: q.rest.items.filter(i => !covered.has(i.key)) };
      if (rest.items.length === 0) {
        drop(q, now);
        continue;
      }
      q.rest = rest;
      q.text = restText(rest);
      q.covered = rest.items.map(i => i.key);
    }
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
export function settle(data: HouseholdData, taken: Pick<QueuedReminder, 'key' | 'to'>, result: Settlement, now: number, texts = 1): void {
  if (result !== 'sent') refundText(data, now);
  // A text of a Shabbat or Yom Tov that went as two texts counts as two (takeDue counted one).
  else if (texts > 1 && data.usage.month === new Date(now).toISOString().slice(0, 7)) data.usage.texts += texts - 1;
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
    delete q.rest;
  } else if (result === 'failed' && now + RETRY_MS < q.until) {
    q.status = 'pending';
    q.doneAt = null;
    q.notBefore = now + RETRY_MS;
  } else {
    drop(q, now);
  }
}
