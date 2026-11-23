/**
 * Halachic times for a location, and the mapping between instants and onot.
 */
import { localAbs } from './civil';
import { type Onah } from './onah';
import { duskAtDegreesMs, sunriseMs, sunsetMs, type GeoPoint } from './sun';

export type TzeitRule =
  /** The sun's centre is this many degrees below the horizon. */
  | { kind: 'degrees'; value: number }
  /** A fixed number of minutes after sunset. */
  | { kind: 'minutes'; value: number };

export interface ZmanimOptions {
  /** Adjust sunrise and sunset for elevation. */
  useElevation: boolean;
  /** Definition of nightfall (tzeit hakochavim) used for immersion. */
  tzeit: TzeitRule;
}

export class NoSunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoSunError';
  }
}

function need(value: number | null, what: string, abs: number): number {
  if (value === null) {
    throw new NoSunError(`${what} does not occur at this location on R.D. ${abs}; times cannot be computed`);
  }
  return value;
}

export interface DayTimes {
  /** Civil date, as an R.D. day number */
  abs: number;
  /** Netz hachamah */
  sunrise: number;
  /** Shekiat hachamah */
  sunset: number;
  /** Tzeit hakochavim on the evening of this civil date */
  tzeit: number;
  /** Minchah ketanah: 9.5 proportional hours after sunrise (sunrise-to-sunset day) */
  minchaKetana: number;
}

/** Times on one civil date. All values are epoch milliseconds. */
export function dayTimes(abs: number, where: GeoPoint, opts: ZmanimOptions): DayTimes {
  const sunOpts = { useElevation: opts.useElevation };
  const sunrise = need(sunriseMs(abs, where, sunOpts), 'sunrise', abs);
  const sunset = need(sunsetMs(abs, where, sunOpts), 'sunset', abs);
  let tzeit: number;
  if (opts.tzeit.kind === 'minutes') {
    if (!(opts.tzeit.value >= 0 && opts.tzeit.value <= 180)) throw new RangeError('tzeit minutes out of range');
    tzeit = sunset + Math.round(opts.tzeit.value * 60_000);
  } else {
    if (!(opts.tzeit.value > 0 && opts.tzeit.value <= 26)) throw new RangeError('tzeit degrees out of range');
    tzeit = need(duskAtDegreesMs(abs, where, opts.tzeit.value), 'nightfall', abs);
  }
  if (!(sunrise < sunset && sunset <= tzeit)) throw new Error('inconsistent sun times');
  const minchaKetana = sunrise + Math.round(((sunset - sunrise) * 9.5) / 12);
  return { abs, sunrise, sunset, tzeit, minchaKetana };
}

export interface OnahWindow {
  /** First instant of the onah (inclusive) */
  start: number;
  /** End of the onah (exclusive) */
  end: number;
}

/**
 * Night onah of Hebrew date D: sunset on the civil date before D until
 * sunrise on D. Day onah of D: sunrise until sunset on D.
 */
export function onahWindow(onah: Onah, where: GeoPoint, opts: ZmanimOptions): OnahWindow {
  const sunOpts = { useElevation: opts.useElevation };
  if (onah.part === 'day') {
    return {
      start: need(sunriseMs(onah.abs, where, sunOpts), 'sunrise', onah.abs),
      end: need(sunsetMs(onah.abs, where, sunOpts), 'sunset', onah.abs),
    };
  }
  return {
    start: need(sunsetMs(onah.abs - 1, where, sunOpts), 'sunset', onah.abs - 1),
    end: need(sunriseMs(onah.abs, where, sunOpts), 'sunrise', onah.abs),
  };
}

export interface ResolvedOnah {
  onah: Onah;
  window: OnahWindow;
  /** Milliseconds from the instant to the nearer edge of its onah. */
  msFromBoundary: number;
}

/** The onah an instant falls in. */
export function onahAt(ms: number, where: GeoPoint, opts: ZmanimOptions): ResolvedOnah {
  if (!Number.isFinite(ms)) throw new RangeError('invalid instant');
  const sunOpts = { useElevation: opts.useElevation };
  const civil = localAbs(ms, where.timeZone);
  const sunrise = need(sunriseMs(civil, where, sunOpts), 'sunrise', civil);
  const sunset = need(sunsetMs(civil, where, sunOpts), 'sunset', civil);
  let onah: Onah;
  if (ms < sunrise) onah = { abs: civil, part: 'night' };
  else if (ms < sunset) onah = { abs: civil, part: 'day' };
  else onah = { abs: civil + 1, part: 'night' };
  const window = onahWindow(onah, where, opts);
  if (!(ms >= window.start && ms < window.end)) throw new Error('onah resolution is inconsistent');
  return { onah, window, msFromBoundary: Math.min(ms - window.start, window.end - ms) };
}
