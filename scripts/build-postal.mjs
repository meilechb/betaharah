#!/usr/bin/env node
/**
 * Builds src/app/postal-data.ts, the table behind src/app/zip.ts: every US ZIP
 * code (and urban Canadian forward sortation area) with a known location, its
 * place name, its latitude and longitude, and its IANA time zone.
 *
 * Usage:  node scripts/build-postal.mjs [--cache <dir>]
 *
 * Sources (downloaded into the cache directory unless already there; through a
 * proxy, run with NODE_USE_ENV_PROXY=1):
 *
 * 1. GeoNames postal code files, https://download.geonames.org/export/zip/
 *    US.zip, PR.zip, VI.zip, GU.zip, AS.zip, MP.zip, CA.zip.
 *    Code, place name, state or province, latitude, longitude, accuracy.
 *    Licence: Creative Commons Attribution 4.0 (CC BY 4.0); attribution to
 *    GeoNames (www.geonames.org) is required and is in README.md, "Data".
 *    Files used for the committed table: as published on 2026-11-24.
 *
 * 2. US Census Bureau 2025 Gazetteer, ZIP Code Tabulation Areas,
 *    https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_zcta_national.zip
 *    Public domain (a work of the US government). Used only to check
 *    GeoNames locations whose accuracy GeoNames marks as estimated.
 *
 * 3. GeoNames gazetteer, https://download.geonames.org/export/dump/
 *    CA.zip (all of Canada) and cities500.zip (towns of 500 people or more),
 *    CC BY 4.0, as published on 2026-11-24. Used only to check locations.
 *
 * 4. Time zones: the geo-tz package (MIT licence; 72 MB, so it is not kept
 *    in package.json: before running this script, install it for the moment
 *    with `npm install --no-save geo-tz@8.1.11`), which looks
 *    a point up in the polygons of timezone-boundary-builder (data under the
 *    Open Database Licence; https://github.com/evansiroky/timezone-boundary-builder).
 *    Version 8.1.11, published 2026-11-02. The zone is computed here, at build
 *    time, from the code's own coordinates; nothing of geo-tz is in the Worker.
 *    tz-lookup was tried first and rejected: its answer differed from geo-tz's
 *    for 484 codes, mostly other names for the same rules, but some an hour
 *    off, such as America/Los_Angeles for Yuma, AZ and America/New_York for
 *    Blountstown, FL (both wrong).
 *
 * What is left out, so that a code can never give a wrong place:
 * - Military codes (APO, FPO, DPO; states AA, AE, AP) have no fixed location.
 * - A code whose location GeoNames marks as estimated (accuracy 1 or blank) is
 *   kept only if the Census point of the same ZIP is within 15 km of it, or
 *   another code with the same place name and state, located by GeoNames
 *   itself, is within 15 km of it, or a town of that name and state in the
 *   GeoNames gazetteer (source 3) is within 10 km of it.
 * - Canadian rural areas (second character 0) cover thousands of square km
 *   and sometimes several time zones, so they are left out. An urban area is
 *   kept only if a place its name mentions ("Calgary (Altadore / Bankview)",
 *   "Barrie North") is in the GeoNames gazetteer (source 3) within 8 km of
 *   it, or, when no place it mentions is in the gazetteer at all, if at least
 *   three areas sharing its first two characters are within 5 km of it. This
 *   catches gross errors in the source, such as T2P (downtown Calgary) placed
 *   27 km east of downtown.
 * - Each zone must be one of those used in its state or province (ALLOWED
 *   below); anything else stops the build, to be looked at by hand.
 *
 * Where a ZIP straddles a time zone line, the zone is the one at the place
 * GeoNames gives, which is the town named in the code's name.
 *
 * Encoding (read by src/app/zip.ts without decoding the whole table):
 * every number is written in base 91 with the characters '#' (0x23) to '~'
 * (0x7E), skipping the backslash, in fixed-width fields, one string per column.
 * - US_BITS: one bit per ZIP 00000-99999, six bits per character; US_RANK: the
 *   number of ZIPs before each run of 16 characters (3 digits). A ZIP's row is
 *   its rank among the ZIPs present.
 * - CA_KEYS: the Canadian areas in order, three letters each; their rows
 *   follow the US rows.
 * - LAT, LON: 2 digits each per row, in steps of LAT_STEP and LON_STEP from
 *   LAT_MIN and LON_MIN (longitude counted eastward from LON_ORIGIN). The steps
 *   come out at about 0.0104 and 0.0197 degrees, so a point is at most 0.6 km
 *   (north-south) and 1 km (east-west) from the source's.
 * - ZONE, STATE: 1 digit each per row, an index into ZONES and STATES.
 * - NAMES: the place names in row order, '|' after each, empty when the same
 *   as the row before within a block of BLOCK rows; NAME_BLOCKS: where each
 *   block starts in NAMES (3 digits).
 * - Grid for the nearest search, in cells 1/GRID of a degree square, in bands
 *   of latitude from GRID_FIRST_BAND. GRID_BITS: one bit per cell (does it
 *   hold rows), six per character; GRID_DIR: before each run of 16 characters,
 *   the number of cells with rows and the number of runs before it (3 digits
 *   each); GRID_RUN_COUNT: per cell with rows, its number of runs (1 digit);
 *   GRID_RUNS: per run its first row (3 digits) and length (2 digits).
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { find as findZones } from 'geo-tz/all';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/app/postal-data.ts');
const args = process.argv.slice(2);
const cacheArg = args.indexOf('--cache');
const CACHE = cacheArg >= 0 ? args[cacheArg + 1] : join(tmpdir(), 'betaharah-postal');

const GEONAMES = 'https://download.geonames.org/export/zip/';
const TERRITORIES = ['PR', 'VI', 'GU', 'AS', 'MP'];
const CENSUS = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_zcta_national.zip';

/** The zones each state or province may have; any other zone stops the build. */
const ALLOWED = {
  // Eastern only
  CT: ['America/New_York'], DE: ['America/New_York'], DC: ['America/New_York'], GA: ['America/New_York'],
  ME: ['America/New_York'], MD: ['America/New_York'], MA: ['America/New_York'], NH: ['America/New_York'],
  NJ: ['America/New_York'], NY: ['America/New_York'], NC: ['America/New_York'], OH: ['America/New_York'],
  PA: ['America/New_York'], RI: ['America/New_York'], SC: ['America/New_York'], VT: ['America/New_York'],
  VA: ['America/New_York'], WV: ['America/New_York'],
  // Split between Eastern and Central
  MI: ['America/Detroit', 'America/Menominee'],
  IN: ['America/Indiana/Indianapolis', 'America/Indiana/Knox', 'America/Indiana/Marengo', 'America/Indiana/Petersburg',
    'America/Indiana/Tell_City', 'America/Indiana/Vevay', 'America/Indiana/Vincennes', 'America/Indiana/Winamac',
    'America/Chicago', 'America/Kentucky/Louisville', 'America/New_York'],
  KY: ['America/New_York', 'America/Kentucky/Louisville', 'America/Kentucky/Monticello', 'America/Chicago'],
  TN: ['America/New_York', 'America/Chicago'],
  // Phenix City and its neighbours keep Eastern time by local custom, and the boundary data follows it.
  AL: ['America/Chicago', 'America/New_York'],
  FL: ['America/New_York', 'America/Chicago'],
  // Central only
  WI: ['America/Chicago'], IL: ['America/Chicago'], IA: ['America/Chicago'], MN: ['America/Chicago'],
  MO: ['America/Chicago'], AR: ['America/Chicago'], LA: ['America/Chicago'], MS: ['America/Chicago'],
  OK: ['America/Chicago'],
  // Split between Central and Mountain
  TX: ['America/Chicago', 'America/Denver'],
  KS: ['America/Chicago', 'America/Denver'],
  NE: ['America/Chicago', 'America/Denver'],
  SD: ['America/Chicago', 'America/Denver'],
  ND: ['America/Chicago', 'America/Denver', 'America/North_Dakota/Center', 'America/North_Dakota/New_Salem', 'America/North_Dakota/Beulah'],
  // Mountain
  CO: ['America/Denver'], WY: ['America/Denver'], MT: ['America/Denver'], NM: ['America/Denver'], UT: ['America/Denver'],
  AZ: ['America/Phoenix', 'America/Denver'],
  // Split between Mountain and Pacific
  ID: ['America/Boise', 'America/Los_Angeles'],
  OR: ['America/Los_Angeles', 'America/Boise'],
  NV: ['America/Los_Angeles', 'America/Denver', 'America/Boise'],
  // Pacific and beyond
  WA: ['America/Los_Angeles'], CA: ['America/Los_Angeles'],
  AK: ['America/Anchorage', 'America/Juneau', 'America/Sitka', 'America/Yakutat', 'America/Nome', 'America/Metlakatla', 'America/Adak'],
  // Wake Island has a Hawaii ZIP but keeps the time of the Gilbert Islands.
  HI: ['Pacific/Honolulu', 'Pacific/Wake', 'Pacific/Tarawa'],
  PR: ['America/Puerto_Rico'], VI: ['America/St_Thomas', 'America/Puerto_Rico'], GU: ['Pacific/Guam'],
  AS: ['Pacific/Pago_Pago'], MP: ['Pacific/Saipan', 'Pacific/Guam'], MH: ['Pacific/Majuro', 'Pacific/Kwajalein', 'Pacific/Tarawa'],
  // Canada
  AB: ['America/Edmonton'],
  BC: ['America/Vancouver', 'America/Creston', 'America/Dawson_Creek', 'America/Fort_Nelson', 'America/Edmonton'],
  MB: ['America/Winnipeg'],
  NB: ['America/Moncton', 'America/Halifax'],
  NL: ['America/St_Johns', 'America/Goose_Bay'],
  NS: ['America/Halifax', 'America/Glace_Bay'],
  NT: ['America/Yellowknife', 'America/Edmonton', 'America/Inuvik'],
  NU: ['America/Iqaluit', 'America/Rankin_Inlet', 'America/Cambridge_Bay', 'America/Pangnirtung'],
  ON: ['America/Toronto', 'America/Nipigon', 'America/Thunder_Bay', 'America/Winnipeg', 'America/Rainy_River', 'America/Atikokan'],
  PE: ['America/Halifax'],
  QC: ['America/Toronto', 'America/Montreal', 'America/Halifax', 'America/Blanc-Sablon'],
  SK: ['America/Regina', 'America/Swift_Current', 'America/Edmonton'],
  YT: ['America/Whitehorse'],
};

// ---------------------------------------------------------------- download

async function cached(url, name) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, name);
  if (!existsSync(file)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log(`downloaded ${url}`);
  }
  return readFileSync(file);
}

/** The files in a zip archive (stored or deflated), by name. */
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(data) : data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function geonames(country) {
  const files = unzip(await cached(`${GEONAMES}${country}.zip`, `${country}.zip`));
  const text = files.get(`${country}.txt`);
  if (!text) throw new Error(`${country}.zip has no ${country}.txt`);
  return text.toString('utf8').split('\n').filter(Boolean).map(line => {
    const c = line.split('\t');
    return { country: c[0], code: c[1], place: c[2].trim(), state: c[4], county: c[5], lat: Number(c[9]), lon: Number(c[10]), accuracy: c[11] ?? '' };
  });
}

// ---------------------------------------------------------------- helpers

function km(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** Lower case, without accents or punctuation, for comparing names. */
const plain = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const DIRECTION = /\s+(north|south|east|west|central|northeast|northwest|southeast|southwest|inner|outer|upper|lower|centre|center|downtown|outskirts|region|extremities)$/i;

/** The place names a Canadian area's name mentions: "Calgary (Altadore / Bankview)", "Barrie North". */
function nameParts(name) {
  const parts = new Set();
  const add = t => {
    t = t.trim();
    if (!t) return;
    parts.add(t);
    let s = t;
    for (let i = 0; i < 3; i++) s = s.replace(DIRECTION, '');
    parts.add(s);
    parts.add(s.replace(/^(downtown|central|north|south|east|west|old|new)\s+/i, ''));
  };
  const m = name.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (m) {
    add(m[1]);
    m[2].split('/').forEach(add);
  } else add(name);
  return parts;
}

/** Populated places, municipalities and areas in the GeoNames Canada gazetteer, by "province|plain name". */
async function canadianPlaces() {
  const PROVINCE = { '01': 'AB', '02': 'BC', '03': 'MB', '04': 'NB', '05': 'NL', '07': 'NS', '08': 'ON', '09': 'PE', '10': 'QC', '11': 'SK', '12': 'YT', '13': 'NT', '14': 'NU' };
  const files = unzip(await cached('https://download.geonames.org/export/dump/CA.zip', 'dump-CA.zip'));
  const places = new Map();
  for (const line of files.get('CA.txt').toString('utf8').split('\n')) {
    const c = line.split('\t');
    if (c.length < 15) continue;
    const wanted = c[6] === 'P' || (c[6] === 'A' && /^ADM[34]$/.test(c[7])) || (c[6] === 'L' && c[7] === 'AREA');
    const province = PROVINCE[c[10]];
    if (!wanted || !province) continue;
    for (const n of new Set([c[1], c[2], ...c[3].split(',')].filter(Boolean).map(plain))) {
      const k = `${province}|${n}`;
      if (!places.has(k)) places.set(k, []);
      places.get(k).push([Number(c[4]), Number(c[5])]);
    }
  }
  return places;
}

/** Longitudes are counted eastward from here, so that all the data is in one span. */
const LON_ORIGIN = 140;
/** Rows per block of place names. */
const BLOCK = 32;

const B = 91;
function digit(d) {
  if (!(d >= 0 && d < B && Number.isInteger(d))) throw new Error(`digit out of range: ${d}`);
  const c = 0x23 + d;
  return String.fromCharCode(c >= 0x5c ? c + 1 : c);
}
function digits(n, width) {
  if (!(n >= 0 && n < B ** width && Number.isInteger(n))) throw new Error(`${n} does not fit in ${width} digits`);
  let s = '';
  for (let i = 0; i < width; i++) {
    s = digit(n % B) + s;
    n = Math.floor(n / B);
  }
  return s;
}

// ---------------------------------------------------------------- build

const isMilitary = r => ['AA', 'AE', 'AP', ''].includes(r.state) || /^(APO|FPO|DPO)\b/.test(r.place);
const isEstimated = r => r.accuracy === '1' || r.accuracy === '';

async function main() {
  const census = new Map();
  const gaz = unzip(await cached(CENSUS, '2025_Gaz_zcta_national.zip'));
  for (const [, buf] of gaz) {
    for (const line of buf.toString('utf8').split('\n').slice(1)) {
      const c = line.trim().split('|');
      if (c.length >= 8) census.set(c[0], { lat: Number(c[6]), lon: Number(c[7]) });
    }
  }

  // US and its territories
  let us = (await geonames('US')).filter(r => !isMilitary(r));
  for (const t of TERRITORIES) us.push(...(await geonames(t)).map(r => ({ ...r, state: t })));
  const seen = new Set();
  for (const r of us) {
    if (!/^\d{5}$/.test(r.code)) throw new Error(`odd US code ${r.code}`);
    if (seen.has(r.code)) throw new Error(`duplicate code ${r.code}`);
    seen.add(r.code);
  }
  const located = us.filter(r => !isEstimated(r));
  const byName = new Map();
  for (const r of located) {
    const k = `${r.state}|${r.place.toLowerCase()}`;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(r);
  }
  const towns = new Map();
  const cities = unzip(await cached('https://download.geonames.org/export/dump/cities500.zip', 'cities500.zip'));
  for (const line of cities.get('cities500.txt').toString('utf8').split('\n')) {
    const c = line.split('\t');
    if (c.length < 15) continue;
    const state = c[8] === 'US' ? c[10] : c[8];
    if (c[8] !== 'US' && !TERRITORIES.includes(c[8])) continue;
    for (const n of new Set([c[1], c[2]].map(plain))) {
      const k = `${state}|${n}`;
      if (!towns.has(k)) towns.set(k, []);
      towns.get(k).push([Number(c[4]), Number(c[5])]);
    }
  }
  const dropped = [];
  us = us.filter(r => {
    if (!isEstimated(r)) return true;
    const z = census.get(r.code);
    if (z && km(r.lat, r.lon, z.lat, z.lon) <= 15) return true;
    const sibs = byName.get(`${r.state}|${r.place.toLowerCase()}`) ?? [];
    if (sibs.some(s => km(r.lat, r.lon, s.lat, s.lon) <= 15)) return true;
    const town = towns.get(`${r.state}|${plain(r.place)}`) ?? [];
    if (town.some(([a, b]) => km(r.lat, r.lon, a, b) <= 10)) return true;
    dropped.push(r);
    return false;
  });
  console.log(`US: ${us.length} codes kept, ${dropped.length} estimated locations left out`);

  // Canada: urban forward sortation areas, checked against the GeoNames gazetteer.
  const caAll = await geonames('CA');
  const caCount = new Map();
  for (const r of caAll) caCount.set(r.code, (caCount.get(r.code) ?? 0) + 1);
  // A code listed more than once (L9X: Barrie, Midhurst, Minesing, Springwater) has no single place; it is left out.
  let ca = caAll
    .filter(r => /^[A-Z][1-9][A-Z]$/.test(r.code) && caCount.get(r.code) === 1)
    .map(r => ({ ...r, place: r.place.replace(/þ/g, 'ç') })); // two names in the source have "þ" for "ç"
  const gazetteer = await canadianPlaces();
  const caDropped = [];
  ca = ca.filter(r => {
    let best = Infinity;
    for (const t of nameParts(r.place)) {
      for (const [a, b] of gazetteer.get(`${r.state}|${plain(t)}`) ?? []) best = Math.min(best, km(r.lat, r.lon, a, b));
    }
    if (best <= 8) return true;
    if (best < Infinity) { caDropped.push([r, `${best.toFixed(0)} km from the place it names`]); return false; }
    const near = ca
      .filter(o => o !== r && o.code.slice(0, 2) === r.code.slice(0, 2))
      .map(o => km(r.lat, r.lon, o.lat, o.lon))
      .sort((a, b) => a - b);
    if (near.length >= 3 && near[2] <= 5) return true;
    caDropped.push([r, 'name not in the gazetteer and no close neighbours']);
    return false;
  });
  console.log(`Canada: ${ca.length} urban areas kept, ${caDropped.length} left out`);

  // Time zones
  const zoneCount = new Map();
  const problems = [];
  // Plain code-unit order, which is the order zip.ts searches in.
  const byCode = (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  const rows = [...us.sort(byCode), ...ca.sort(byCode)].map(r => {
    const zones = findZones(r.lat, r.lon);
    const zone = zones[0];
    const allowed = ALLOWED[r.state];
    if (!allowed) problems.push(`${r.code}: no allowed zones for state "${r.state}"`);
    else if (!zone || !allowed.includes(zone)) problems.push(`${r.code} ${r.place}, ${r.state} (${r.lat}, ${r.lon}): zone ${zones.join('/') || 'none'}`);
    if (zones.length > 1) console.log(`note: ${r.code} lies in ${zones.join(' and ')}; using ${zone}`);
    zoneCount.set(zone, (zoneCount.get(zone) ?? 0) + 1);
    let place = r.place;
    if (r.country === 'CA') place = place.replace(/\s*\(.*$/, '');
    // The name is "place, ST 12345" and must fit the 80 characters a saved place name may have.
    const suffix = `, ${r.state} ${r.code}`;
    if (place.length + suffix.length > 80) place = place.slice(0, 80 - suffix.length).trimEnd();
    return { ...r, place, zone };
  });
  if (problems.length) {
    console.error(problems.join('\n'));
    throw new Error(`${problems.length} codes have a time zone not expected in their state`);
  }

  // Encoding
  const zones = [...zoneCount.keys()].sort();
  const states = [...new Set(rows.map(r => r.state))].sort();
  if (zones.length > B || states.length > B) throw new Error('too many zones or states for one digit');
  // Place names in row order, each followed by '|', and where each block of rows starts.
  let names = '';
  let nameBlocks = '';
  // A name that is the same as the row before (within a block) is left empty.
  rows.forEach((r, i) => {
    if (r.place.includes('|') || !r.place) throw new Error(`bad name: "${r.place}"`);
    if (i % BLOCK === 0) nameBlocks += digits(names.length, 3);
    names += (i % BLOCK !== 0 && rows[i - 1].place === r.place ? '' : r.place) + '|';
  });

  const usRows = rows.filter(r => r.country !== 'CA');
  const present = new Uint8Array(100000);
  for (const r of usRows) present[Number(r.code)] = 1;
  let bits = '';
  let rank = '';
  let count = 0;
  const chars = Math.ceil(100000 / 6);
  for (let ci = 0; ci < chars; ci++) {
    if (ci % 16 === 0) rank += digits(count, 3);
    let v = 0;
    for (let b = 0; b < 6; b++) {
      const zip = ci * 6 + b;
      if (zip < 100000 && present[zip]) { v |= 1 << b; count++; }
    }
    bits += digit(v);
  }
  if (count !== usRows.length) throw new Error('bit count mismatch');

  const caCodes = rows.filter(r => r.country === 'CA').map(r => r.code);
  caCodes.forEach((c, i) => { if (i > 0 && !(caCodes[i - 1] < c)) throw new Error(`Canadian codes out of order at ${c}`); });
  const caKeys = caCodes.join('');
  // Coordinates: two digits each (8281 steps) across the span of the data. Longitude is
  // measured eastward from 140 degrees east, so that Guam and Newfoundland are one span.
  const rotated = lon => (lon - LON_ORIGIN + 720) % 360;
  const span = values => {
    const min = Math.floor(Math.min(...values));
    const step = Math.ceil(((Math.max(...values) - min) / (B * B - 1)) * 1e6) / 1e6;
    return { min, step };
  };
  const latSpan = span(rows.map(r => r.lat));
  const lonSpan = span(rows.map(r => rotated(r.lon)));
  let lat = '', lon = '', zone = '', state = '';
  for (const r of rows) {
    const la = Math.round((r.lat - latSpan.min) / latSpan.step);
    const lo = Math.round((rotated(r.lon) - lonSpan.min) / lonSpan.step);
    lat += digits(la, 2);
    lon += digits(lo, 2);
    // The coordinates as zip.ts will read them, for the grid below.
    r.readLat = Math.round((latSpan.min + la * latSpan.step) * 1e4) / 1e4;
    const readLon = Math.round((LON_ORIGIN + lonSpan.min + lo * lonSpan.step) * 1e4) / 1e4;
    r.readLon = readLon > 180 ? readLon - 360 : readLon;
    if (Math.abs(r.readLat - r.lat) > 0.006 || Math.abs(((r.readLon - r.lon + 540) % 360) - 180) > 0.011) throw new Error(`coordinates of ${r.code} do not fit`);
    zone += digit(zones.indexOf(r.zone));
    state += digit(states.indexOf(r.state));
  }
  console.log(`coordinate steps: ${latSpan.step} degrees of latitude, ${lonSpan.step} of longitude`);

  // Grid of cells 1/GRID of a degree square, each a list of runs of consecutive rows.
  // Four cells per degree: cells of 1 or 2 degrees made the search look at too many rows;
  // 8 per degree made the table bigger without making the first search faster.
  const GRID = 4;
  const GAP = 8;
  const COLUMNS = 360 * GRID;
  const bandOf = lat => Math.floor((lat + 90) * GRID);
  const firstBand = Math.min(...rows.map(r => bandOf(r.readLat)));
  const bands = Math.max(...rows.map(r => bandOf(r.readLat))) - firstBand + 1;
  const cells = new Map();
  rows.forEach((r, i) => {
    const cell = (bandOf(r.readLat) - firstBand) * COLUMNS + (Math.floor((r.readLon + 180) * GRID) % COLUMNS);
    if (!cells.has(cell)) cells.set(cell, []);
    cells.get(cell).push(i);
  });
  // A run may take in up to GAP rows of other cells, which the search then also looks at:
  // with 8, the runs take a third less space and the search looks at about twice as many rows.
  let gridRuns = '', gridRunCount = '', runCount = 0, maxCell = 0, scanned = 0;
  const runsBefore = new Map();
  for (const cell of [...cells.keys()].sort((a, b) => a - b)) {
    const list = cells.get(cell);
    maxCell = Math.max(maxCell, list.length);
    runsBefore.set(cell, runCount);
    let n = 0;
    for (let i = 0; i < list.length;) {
      let j = i;
      while (j + 1 < list.length && list[j + 1] - list[j] <= GAP + 1 && list[j + 1] - list[i] < B * B - 1) j++;
      gridRuns += digits(list[i], 3) + digits(list[j] - list[i] + 1, 2);
      scanned += list[j] - list[i] + 1;
      runCount++;
      n++;
      i = j + 1;
    }
    gridRunCount += digit(n);
  }
  // Which cells hold rows: one bit per cell, six per character; and before each run of 16
  // characters, the number of cells with rows and the number of runs that come before it.
  let gridBits = '', gridDir = '', cellsSoFar = 0;
  const cellChars = Math.ceil((bands * COLUMNS) / 6);
  for (let ci = 0; ci < cellChars; ci++) {
    if (ci % 16 === 0) {
      let firstRun = runCount;
      for (let c = ci * 6; c < bands * COLUMNS; c++) if (cells.has(c)) { firstRun = runsBefore.get(c); break; }
      gridDir += digits(cellsSoFar, 3) + digits(firstRun, 3);
    }
    let v = 0;
    for (let b = 0; b < 6; b++) if (cells.has(ci * 6 + b)) { v |= 1 << b; cellsSoFar++; }
    gridBits += digit(v);
  }

  const q = s => JSON.stringify(s);
  const out = `// Generated by scripts/build-postal.mjs. Do not edit by hand.
// Place names and coordinates: GeoNames (www.geonames.org), CC BY 4.0.
// Time zones: computed from the coordinates with timezone-boundary-builder data (ODbL) through geo-tz.
// ${usRows.length} US codes, ${rows.length - usRows.length} Canadian areas.

export const US_COUNT = ${usRows.length};
export const ROW_COUNT = ${rows.length};
export const ZONES: readonly string[] = ${q(zones)};
export const STATES: readonly string[] = ${q(states)};
export const US_BITS = ${q(bits)};
export const US_RANK = ${q(rank)};
export const CA_KEYS = ${q(caKeys)};
export const LAT_MIN = ${latSpan.min};
export const LAT_STEP = ${latSpan.step};
export const LON_ORIGIN = ${LON_ORIGIN};
export const LON_MIN = ${lonSpan.min};
export const LON_STEP = ${lonSpan.step};
export const LAT = ${q(lat)};
export const LON = ${q(lon)};
export const ZONE = ${q(zone)};
export const STATE = ${q(state)};
export const BLOCK = ${BLOCK};
export const GRID = ${GRID};
export const NAME_BLOCKS = ${q(nameBlocks)};
export const NAMES = ${q(names)};
export const GRID_FIRST_BAND = ${firstBand};
export const GRID_BANDS = ${bands};
export const GRID_BITS = ${q(gridBits)};
export const GRID_DIR = ${q(gridDir)};
export const GRID_RUN_COUNT = ${q(gridRunCount)};
export const GRID_RUNS = ${q(gridRuns)};
`;
  writeFileSync(OUT, out);
  console.log(`zones: ${zones.length}, states: ${states.length}, grid cells: ${cells.size} in ${bands} bands, runs: ${runCount}, largest cell: ${maxCell} rows, rows in runs: ${scanned}`);
  console.log(`wrote ${OUT} (${(out.length / 1024).toFixed(0)} KiB)`);
  if (process.env.VERBOSE) {
    for (const r of dropped) console.log(`left out ${r.code} ${r.place}, ${r.state}`);
    for (const [r, why] of caDropped) console.log(`left out ${r.code} ${r.place}, ${r.state}: ${why}`);
  }
}

await main();
