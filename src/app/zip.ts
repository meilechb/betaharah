/**
 * Location from a postal code, for setting up by text message: a US ZIP code,
 * or the first three characters of a Canadian postal code (the forward
 * sortation area, urban areas only).
 *
 * The table is src/app/postal-data.ts, made by scripts/build-postal.mjs from
 * GeoNames (CC BY 4.0), with each code's time zone computed at build time from
 * its coordinates. The table is a handful of string constants that are read
 * in place: nothing is decoded at import, and a lookup decodes only the
 * characters it needs (test/zip.test.ts measures it). The layout is described
 * at the top of the build script.
 *
 * Both functions are synchronous and need no database.
 */
import type { PlaceSetting } from './settings';
import {
  BLOCK, CA_KEYS, GRID, GRID_BANDS, GRID_BITS, GRID_DIR, GRID_FIRST_BAND, GRID_RUN_COUNT, GRID_RUNS, LAT, LAT_MIN, LAT_STEP, LON, LON_MIN, LON_ORIGIN,
  LON_STEP, NAME_BLOCKS, NAMES, ROW_COUNT, STATE, STATES, US_BITS, US_COUNT, US_RANK, ZONE,
  ZONES,
} from './postal-data';

export type PostalPlace = PlaceSetting & { postal: string };

/** Distance within which nearestPostal answers. */
const NEAREST_KM = 80;

/** One base-91 digit: '#' (0x23) to '~' (0x7E), without the backslash. */
function digit(s: string, i: number): number {
  const c = s.charCodeAt(i);
  return c - (c > 0x5c ? 0x24 : 0x23);
}

function digits(s: string, i: number, width: number): number {
  let n = 0;
  for (let k = 0; k < width; k++) n = n * 91 + digit(s, i + k);
  return n;
}

function bitCount(v: number): number {
  let n = 0;
  for (; v; v &= v - 1) n++;
  return n;
}

/** The row of a US ZIP code (0-99999), or -1. */
function usRow(zip: number): number {
  const ci = (zip / 6) | 0;
  const bit = zip - ci * 6;
  const v = digit(US_BITS, ci);
  if (!((v >> bit) & 1)) return -1;
  const block = ci >> 4;
  let row = digits(US_RANK, block * 3, 3);
  for (let k = block * 16; k < ci; k++) row += bitCount(digit(US_BITS, k));
  return row + bitCount(v & ((1 << bit) - 1));
}

/** The ZIP code of a US row. */
function usZip(row: number): number {
  // The last block that starts at or before this row.
  let lo = 0;
  let hi = US_RANK.length / 3 - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (digits(US_RANK, mid * 3, 3) <= row) lo = mid;
    else hi = mid - 1;
  }
  let left = row - digits(US_RANK, lo * 3, 3);
  for (let ci = lo * 16; ; ci++) {
    const v = digit(US_BITS, ci);
    for (let bit = 0; bit < 6; bit++) {
      if ((v >> bit) & 1) {
        if (left === 0) return ci * 6 + bit;
        left--;
      }
    }
  }
}

/** The row of a Canadian forward sortation area such as "H3W", or -1. */
function caRow(fsa: string): number {
  let lo = 0;
  let hi = CA_KEYS.length / 3 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const key = CA_KEYS.slice(mid * 3, mid * 3 + 3);
    if (key === fsa) return US_COUNT + mid;
    if (key < fsa) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Coordinates are kept in steps of about 0.01 and 0.02 degrees (at most 0.6 and 1 km); shown to 4 decimals. */
function latitudeOf(row: number): number {
  return Math.round((LAT_MIN + digits(LAT, row * 2, 2) * LAT_STEP) * 1e4) / 1e4;
}

function longitudeOf(row: number): number {
  const lon = Math.round((LON_ORIGIN + LON_MIN + digits(LON, row * 2, 2) * LON_STEP) * 1e4) / 1e4;
  return lon > 180 ? lon - 360 : lon;
}

function townOf(row: number): string {
  // Names are in row order; an empty name repeats the one before it within the block.
  const block = (row / BLOCK) | 0;
  let at = digits(NAME_BLOCKS, block * 3, 3);
  let named = at;
  for (let k = block * BLOCK; k < row; k++) {
    at = NAMES.indexOf('|', at) + 1;
    if (NAMES.charCodeAt(at) !== 0x7c) named = at;
  }
  return NAMES.slice(named, NAMES.indexOf('|', named));
}

function place(row: number, postal: string): PostalPlace {
  const town = townOf(row);
  return {
    name: `${town}, ${STATES[digit(STATE, row)]} ${postal}`,
    latitude: latitudeOf(row),
    longitude: longitudeOf(row),
    timeZone: ZONES[digit(ZONE, row)] as string,
    elevation: 0,
    postal,
  };
}

/** A US ZIP code ("08701", "08701-1234") or a Canadian forward sortation area ("H3W", "h3w 1a1" → "H3W"). Null if not known. */
export function lookupPostal(input: string): PostalPlace | null {
  if (typeof input !== 'string' || input.length > 20) return null;
  const s = input.trim().toUpperCase();
  const us = /^(\d{5})(?:\s*-?\s*\d{4})?$/.exec(s);
  if (us) {
    const code = us[1] as string;
    const row = usRow(Number(code));
    return row < 0 ? null : place(row, code);
  }
  const ca = /^([A-Z]\d[A-Z])(?:\s*\d[A-Z]\d)?$/.exec(s);
  if (ca) {
    const fsa = ca[1] as string;
    const row = caRow(fsa);
    return row < 0 ? null : place(row, fsa);
  }
  return null;
}

function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Set by cellRuns: the run after the cell's last run. */
let cellRunEnd = 0;

/**
 * The first run, in GRID_RUNS, of the grid cell at a band (floor((latitude + 90) * GRID))
 * and column (floor((longitude + 180) * GRID)), or -1 if no row is in it. Sets cellRunEnd.
 */
function cellRuns(band: number, column: number): number {
  const b = band - GRID_FIRST_BAND;
  if (b < 0 || b >= GRID_BANDS) return -1;
  const cell = b * 360 * GRID + column;
  const ci = (cell / 6) | 0;
  const bit = cell - ci * 6;
  const v = digit(GRID_BITS, ci);
  if (!((v >> bit) & 1)) return -1;
  const block = ci >> 4;
  let rank = digits(GRID_DIR, block * 6, 3);
  let run = digits(GRID_DIR, block * 6 + 3, 3);
  for (let k = block * 16; k <= ci; k++) {
    const n = bitCount(k < ci ? digit(GRID_BITS, k) : v & ((1 << bit) - 1));
    for (let t = 0; t < n; t++) run += digit(GRID_RUN_COUNT, rank + t);
    rank += n;
  }
  cellRunEnd = run + digit(GRID_RUN_COUNT, rank);
  return run;
}

/** Kilometres per degree of latitude. */
const KM_PER_DEGREE = 111.2;

/** The known postal area whose centre is nearest to a point (for a location shared from a phone). Null if nothing is within 80 km. */
export function nearestPostal(latitude: number, longitude: number): PostalPlace | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  // Distances are measured on a flat map around the point (good to a fraction of a
  // percent within 80 km), and the cells are visited in rings outward from the point's
  // cell until no cell further out can hold anything nearer.
  const step = 1 / GRID;
  const cellsAround = 360 * GRID;
  const kmX = KM_PER_DEGREE * Math.cos((latitude * Math.PI) / 180);
  const kmCell = step * Math.min(KM_PER_DEGREE, Math.max(kmX, 0.1 * KM_PER_DEGREE));
  const homeI = Math.floor((latitude + 90) * GRID);
  const homeJ = Math.floor((longitude + 180) * GRID);
  const limit = NEAREST_KM * 1.01;
  let best = -1;
  let bestSq = limit * limit;
  const lastRing = Math.ceil(limit / kmCell) + 1;
  for (let ring = 0; ring <= lastRing; ring++) {
    const gap = (ring - 1) * kmCell;
    if (ring > 0 && gap * gap >= bestSq) break;
    for (let i = homeI - ring; i <= homeI + ring; i++) {
      if (i < 0 || i >= 180 * GRID) continue;
      const edge = i === homeI - ring || i === homeI + ring;
      for (let j = homeJ - ring; j <= homeJ + ring; j += edge || ring === 0 ? 1 : 2 * ring) {
        // Nearest corner or side of the cell, to skip cells that cannot hold anything nearer.
        const south = i * step - 90;
        const west = j * step - 180;
        const dy = (latitude < south ? south - latitude : latitude > south + step ? latitude - south - step : 0) * KM_PER_DEGREE;
        const dx = (longitude < west ? west - longitude : longitude > west + step ? longitude - west - step : 0) * kmX;
        if (dx * dx + dy * dy >= bestSq) continue;
        const first = cellRuns(i, ((j % cellsAround) + cellsAround) % cellsAround);
        if (first < 0) continue;
        const end = cellRunEnd;
        for (let run = first; run < end; run++) {
          const start = digits(GRID_RUNS, run * 5, 3);
          const stop = start + digits(GRID_RUNS, run * 5 + 3, 2);
          for (let row = start; row < stop; row++) {
            const y = (latitudeOf(row) - latitude) * KM_PER_DEGREE;
            if (y * y >= bestSq) continue;
            let x = longitudeOf(row) - longitude;
            if (x > 180) x -= 360;
            else if (x < -180) x += 360;
            x *= kmX;
            const sq = x * x + y * y;
            if (sq < bestSq) {
              bestSq = sq;
              best = row;
            }
          }
        }
      }
    }
  }
  if (best < 0) return null;
  const lat = latitudeOf(best);
  const lon = longitudeOf(best);
  if (km(latitude, longitude, lat, lon) > NEAREST_KM) return null;
  if (best < US_COUNT) return place(best, String(usZip(best)).padStart(5, '0'));
  return place(best, CA_KEYS.slice((best - US_COUNT) * 3, (best - US_COUNT) * 3 + 3));
}

/** Every row as a place, for tests and checks. Not for use in a request: it decodes the whole table. */
export function allPostalPlaces(): PostalPlace[] {
  const out: PostalPlace[] = [];
  for (let row = 0; row < ROW_COUNT; row++) {
    out.push(row < US_COUNT ? place(row, String(usZip(row)).padStart(5, '0')) : place(row, CA_KEYS.slice((row - US_COUNT) * 3, (row - US_COUNT) * 3 + 3)));
  }
  return out;
}
