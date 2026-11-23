/**
 * Sunrise, sunset and sun-depression times.
 *
 * This is the solar position algorithm published by NOAA (the equations of
 * the NOAA Solar Calculator, after Jean Meeus, "Astronomical Algorithms").
 * The tests compare every result against @hebcal/noaa, the library behind
 * Hebcal's zmanim.
 *
 * All angles are degrees. Longitude is positive east of Greenwich.
 */
import { absToCivil, absToUtcMidnightMs, localAbs } from './civil';

export interface GeoPoint {
  /** Latitude in degrees, north positive */
  latitude: number;
  /** Longitude in degrees, east positive */
  longitude: number;
  /** IANA time zone, e.g. "America/New_York" */
  timeZone: string;
  /** Elevation above sea level in metres. Used only when `useElevation` is on. */
  elevation?: number;
}

/**
 * Zenith of sunrise/sunset: 90 degrees, plus 34 arc-minutes of atmospheric
 * refraction, plus the 16 arc-minute radius of the sun's disc, so that the
 * time is the moment the upper edge of the sun is on the horizon.
 */
export const SUNRISE_SUNSET_ZENITH = 90 + 50 / 60;

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

function julianDayOfAbs(abs: number): number {
  // R.D. 1 = 0001-01-01 (Gregorian). JD at 00:00 UTC of R.D. n is n + 1721424.5.
  return abs + 1_721_424.5;
}

function centuriesOfJd(jd: number): number {
  return (jd - 2_451_545.0) / 36_525.0;
}

function meanLongitude(t: number): number {
  const l = 280.46646 + t * (36000.76983 + 0.0003032 * t);
  return ((l % 360) + 360) % 360;
}

function meanAnomaly(t: number): number {
  return 357.52911 + t * (35999.05029 - 0.0001537 * t);
}

function eccentricity(t: number): number {
  return 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
}

function equationOfCenter(t: number): number {
  const m = rad(meanAnomaly(t));
  return (
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289
  );
}

function apparentLongitude(t: number): number {
  const trueLong = meanLongitude(t) + equationOfCenter(t);
  const omega = 125.04 - 1934.136 * t;
  return trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
}

function obliquityCorrection(t: number): number {
  const seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813));
  const mean = 23 + (26 + seconds / 60) / 60;
  const omega = 125.04 - 1934.136 * t;
  return mean + 0.00256 * Math.cos(rad(omega));
}

function declination(t: number): number {
  const e = rad(obliquityCorrection(t));
  const lambda = rad(apparentLongitude(t));
  return deg(Math.asin(Math.sin(e) * Math.sin(lambda)));
}

/** Equation of time in minutes. */
function equationOfTime(t: number): number {
  const epsilon = rad(obliquityCorrection(t));
  const l0 = rad(meanLongitude(t));
  const e = eccentricity(t);
  const m = rad(meanAnomaly(t));
  let y = Math.tan(epsilon / 2);
  y *= y;
  const eq =
    y * Math.sin(2 * l0) -
    2 * e * Math.sin(m) +
    4 * e * y * Math.sin(m) * Math.cos(2 * l0) -
    0.5 * y * y * Math.sin(4 * l0) -
    1.25 * e * e * Math.sin(2 * m);
  return deg(eq) * 4;
}

/** Hour angle (degrees) at which the sun is at `zenith`, or NaN if it never is. */
function hourAngle(latitude: number, decl: number, zenith: number): number {
  const lat = rad(latitude);
  const d = rad(decl);
  const cosH = Math.cos(rad(zenith)) / (Math.cos(lat) * Math.cos(d)) - Math.tan(lat) * Math.tan(d);
  if (cosH < -1 || cosH > 1) return Number.NaN;
  return deg(Math.acos(cosH));
}

/**
 * Minutes after 00:00 UTC of the R.D. day `abs` at which the sun reaches
 * `zenith` on its way up (rising) or down (setting), for the solar day whose
 * noon is nearest 12:00 local mean time at the given longitude.
 * The value may be below 0 or above 1440.
 */
function eventMinutesUtc(abs: number, latitude: number, longitude: number, zenith: number, rising: boolean): number {
  const jd = julianDayOfAbs(abs);
  // Solar noon, refined once.
  let noon = 720 - 4 * longitude - equationOfTime(centuriesOfJd(jd + (720 - 4 * longitude) / 1440));
  noon = 720 - 4 * longitude - equationOfTime(centuriesOfJd(jd + noon / 1440));
  // Start from noon and iterate to the event.
  let minutes = noon;
  for (let i = 0; i < 4; i++) {
    const t = centuriesOfJd(jd + minutes / 1440);
    const h = hourAngle(latitude, declination(t), zenith);
    if (Number.isNaN(h)) return Number.NaN;
    const next = 720 - 4 * (longitude + (rising ? h : -h)) - equationOfTime(t);
    const done = Math.abs(next - minutes) < 1 / 6000; // 0.01 second
    minutes = next;
    if (done) break;
  }
  return minutes;
}

const EARTH_RADIUS_KM = 6356.9;

/** Extra zenith angle, in degrees, for an observer `elevation` metres above sea level. */
export function elevationAdjustment(elevation: number): number {
  if (!(elevation > 0)) return 0;
  return deg(Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + elevation / 1000)));
}

/**
 * Instant (epoch ms) at which the sun reaches `zenith` on the civil date
 * `abs` *as that date is reckoned in the location's time zone*.
 * Returns null where the event does not occur (polar day or night).
 */
export function sunEventMs(abs: number, where: GeoPoint, zenith: number, rising: boolean): number | null {
  if (!Number.isInteger(abs)) throw new RangeError('abs must be an integer');
  if (!(where.latitude >= -90 && where.latitude <= 90) || !(where.longitude >= -180 && where.longitude <= 180)) {
    throw new RangeError('latitude/longitude out of range');
  }
  // The same few days are asked for again and again, so answers are kept per
  // location object. The location's values are checked on every use, so a
  // changed object never gets an old answer.
  let entry = cache.get(where);
  if (
    !entry ||
    entry.latitude !== where.latitude ||
    entry.longitude !== where.longitude ||
    entry.timeZone !== where.timeZone ||
    entry.values.size >= CACHE_LIMIT
  ) {
    entry = { latitude: where.latitude, longitude: where.longitude, timeZone: where.timeZone, zeniths: [], values: new Map() };
    cache.set(where, entry);
  }
  let z = entry.zeniths.indexOf(zenith);
  if (z < 0) {
    if (entry.zeniths.length >= MAX_ZENITHS) return computeSunEventMs(abs, where, zenith, rising);
    z = entry.zeniths.push(zenith) - 1;
  }
  const key = (abs * MAX_ZENITHS + z) * 2 + (rising ? 1 : 0);
  const cached = entry.values.get(key);
  if (cached !== undefined) return cached;
  const value = computeSunEventMs(abs, where, zenith, rising);
  entry.values.set(key, value);
  return value;
}

const CACHE_LIMIT = 20_000;
const MAX_ZENITHS = 16;
interface CacheEntry {
  latitude: number;
  longitude: number;
  timeZone: string;
  zeniths: number[];
  values: Map<number, number | null>;
}
const cache = new WeakMap<GeoPoint, CacheEntry>();

function computeSunEventMs(abs: number, where: GeoPoint, zenith: number, rising: boolean): number | null {
  // The solar day centred on local-mean-time noon normally falls on the same
  // civil date. Near the date line a zone's civil date can differ by a day
  // (e.g. Pacific/Apia), so check and shift.
  for (const shift of [0, -1, 1]) {
    const day = abs + shift;
    const noonMs = absToUtcMidnightMs(day) + (720 - 4 * where.longitude) * 60_000;
    if (localAbs(noonMs, where.timeZone) !== abs) continue;
    const minutes = eventMinutesUtc(day, where.latitude, where.longitude, zenith, rising);
    if (Number.isNaN(minutes)) return null;
    return absToUtcMidnightMs(day) + Math.round(minutes * 60_000);
  }
  const c = absToCivil(abs);
  throw new Error(`cannot place solar noon of ${c.y}-${c.m}-${c.d} in ${where.timeZone}`);
}

export interface SunOptions {
  /** Adjust sunrise and sunset for the location's elevation. Default: sea level. */
  useElevation?: boolean;
}

function horizonZenith(where: GeoPoint, opts?: SunOptions): number {
  const extra = opts?.useElevation ? elevationAdjustment(where.elevation ?? 0) : 0;
  return SUNRISE_SUNSET_ZENITH + extra;
}

/** Sunrise (netz hachamah) on a civil date, epoch ms, or null if the sun does not rise. */
export function sunriseMs(abs: number, where: GeoPoint, opts?: SunOptions): number | null {
  return sunEventMs(abs, where, horizonZenith(where, opts), true);
}

/** Sunset (shekiah) on a civil date, epoch ms, or null if the sun does not set. */
export function sunsetMs(abs: number, where: GeoPoint, opts?: SunOptions): number | null {
  return sunEventMs(abs, where, horizonZenith(where, opts), false);
}

/**
 * Evening instant when the centre of the sun is `degrees` below the
 * geometric horizon (elevation is never applied to degree-based times).
 */
export function duskAtDegreesMs(abs: number, where: GeoPoint, degrees: number): number | null {
  return sunEventMs(abs, where, 90 + degrees, false);
}
