/**
 * An onah is half of a halachic day: the night (sunset to sunrise) or the
 * day (sunrise to sunset).
 *
 * `abs` is the R.D. day number of the Hebrew date the onah belongs to, which
 * equals the R.D. number of the civil date of that Hebrew date's daytime.
 * The night onah of a Hebrew date therefore starts on the evening of the
 * civil date before.
 */
export type OnahPart = 'night' | 'day';

export interface Onah {
  abs: number;
  part: OnahPart;
}

/** A single increasing number per onah: night of a date, then its day. */
export function onahIndex(o: Onah): number {
  if (!Number.isInteger(o.abs)) throw new RangeError('onah.abs must be an integer');
  return o.abs * 2 + (o.part === 'day' ? 1 : 0);
}

export function onahFromIndex(index: number): Onah {
  if (!Number.isInteger(index)) throw new RangeError('onah index must be an integer');
  const abs = Math.floor(index / 2);
  return { abs, part: index - abs * 2 === 1 ? 'day' : 'night' };
}

export function previousOnah(o: Onah): Onah {
  return onahFromIndex(onahIndex(o) - 1);
}

export function otherHalfOfDay(o: Onah): Onah {
  return { abs: o.abs, part: o.part === 'day' ? 'night' : 'day' };
}

export function sameOnah(a: Onah, b: Onah): boolean {
  return a.abs === b.abs && a.part === b.part;
}
