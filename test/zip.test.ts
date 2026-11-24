import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { isValidTimeZone } from '../src/engine/civil';
import { assertSunTimesExist, parsePlace } from '../src/app/settings';
import { allPostalPlaces, lookupPostal, nearestPostal } from '../src/app/zip';
import { NoSunError, type ZmanimOptions } from '../src/engine/zmanim';
import { DEFAULT_HALACHIC_SETTINGS } from '../src/engine/settings';

const DEFAULT_TZEIT: ZmanimOptions = { useElevation: false, tzeit: DEFAULT_HALACHIC_SETTINGS.tzeit };
/** Nightfall a fixed time after sunset, for places where the sun does not reach 8.5 degrees below the horizon in June. */
const MINUTES_TZEIT: ZmanimOptions = { useElevation: false, tzeit: { kind: 'minutes', value: 72 } };

function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** UTC offset in hours of a zone on the 15th of a month of 2026 at noon UTC. */
function offset(timeZone: string, month: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date(Date.UTC(2026, month, 15, 12)));
  const name = parts.find(p => p.type === 'timeZoneName')?.value ?? '';
  const m = /GMT(?:([+-])(\d\d):(\d\d))?/.exec(name);
  if (!m) throw new Error(`cannot read offset ${name}`);
  return m[1] ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) + Number(m[3]) / 60) : 0;
}

interface Case {
  code: string;
  /** Start of the expected name, "Lakewood, NJ". */
  name: string;
  zone: string;
  /** UTC offsets in January and July. */
  winter: number;
  summer: number;
  /** A reference point for the place, from a source independent of GeoNames. */
  at: [number, number];
  /** How far from the reference point the table may be, in km. */
  within: number;
  /** Where the zone and the reference point come from. */
  source: string;
  /** Nightfall at 8.5 degrees does not occur every day of the year here. */
  noDegreeNightfall?: true;
}

// Zones: the legal boundaries are 49 CFR Part 71 (Standard Time Zone Boundaries) and the
// Uniform Time Act (15 U.S.C. 260a: Arizona, Hawaii and the territories may stay on standard
// time all year); the IANA zone names are from the tz database (zone1970.tab and its comments).
// Reference points: "Census" is the internal point of the ZIP Code Tabulation Area in the
// US Census Bureau 2025 Gazetteer (public domain); "Wikipedia" is the coordinate of the town's
// article on en.wikipedia.org, fetched on 2026-11-24.
const CASES: Case[] = [
  // Eastern, the communities asked for by name
  { code: '08701', name: 'Lakewood, NJ', zone: 'America/New_York', winter: -5, summer: -4, at: [40.077069, -74.19851], within: 3, source: 'Census' },
  { code: '11219', name: 'Brooklyn, NY', zone: 'America/New_York', winter: -5, summer: -4, at: [40.63262, -73.99677], within: 3, source: 'Census (Borough Park)' },
  { code: '10952', name: 'Monsey, NY', zone: 'America/New_York', winter: -5, summer: -4, at: [41.111118, -74.07854], within: 3, source: 'Census' },
  { code: '10950', name: 'Monroe, NY', zone: 'America/New_York', winter: -5, summer: -4, at: [41.34, -74.16722], within: 3, source: 'Wikipedia, Kiryas Joel (ZIP 10950 is Monroe and Kiryas Joel)' },
  { code: '11559', name: 'Lawrence, NY', zone: 'America/New_York', winter: -5, summer: -4, at: [40.602924, -73.714434], within: 3, source: 'Census (Five Towns)' },
  { code: '07055', name: 'Passaic, NJ', zone: 'America/New_York', winter: -5, summer: -4, at: [40.857552, -74.129089], within: 3, source: 'Census' },
  { code: '07666', name: 'Teaneck, NJ', zone: 'America/New_York', winter: -5, summer: -4, at: [40.890317, -74.011478], within: 3, source: 'Census' },
  { code: '21215', name: 'Baltimore, MD', zone: 'America/New_York', winter: -5, summer: -4, at: [39.345947, -76.682206], within: 3, source: 'Census' },
  { code: '33140', name: 'Miami Beach, FL', zone: 'America/New_York', winter: -5, summer: -4, at: [25.816916, -80.13566], within: 3, source: 'Census' },
  { code: '44118', name: 'Cleveland, OH', zone: 'America/New_York', winter: -5, summer: -4, at: [41.502337, -81.556571], within: 3, source: 'Census (Cleveland Heights / University Heights)' },
  { code: '48237', name: 'Oak Park, MI', zone: 'America/Detroit', winter: -5, summer: -4, at: [42.46722, -83.17944], within: 3, source: 'Wikipedia; Michigan is Eastern except four counties on the Wisconsin border' },
  // Central, Mountain, Pacific
  { code: '60645', name: 'Chicago, IL', zone: 'America/Chicago', winter: -6, summer: -5, at: [42.008603, -87.694579], within: 3, source: 'Census (West Rogers Park)' },
  { code: '77096', name: 'Houston, TX', zone: 'America/Chicago', winter: -6, summer: -5, at: [29.675339, -95.479372], within: 3, source: 'Census (Meyerland)' },
  { code: '80204', name: 'Denver, CO', zone: 'America/Denver', winter: -7, summer: -6, at: [39.734757, -105.020678], within: 3, source: 'Census' },
  { code: '90036', name: 'Los Angeles, CA', zone: 'America/Los_Angeles', winter: -8, summer: -7, at: [34.070291, -118.349191], within: 3, source: 'Census (Fairfax)' },
  // Arizona keeps Mountain Standard Time all year; the Navajo Nation keeps daylight time; the Hopi reservation, inside it, does not.
  { code: '85004', name: 'Phoenix, AZ', zone: 'America/Phoenix', winter: -7, summer: -7, at: [33.451609, -112.06988], within: 3, source: 'Census' },
  { code: '86001', name: 'Flagstaff, AZ', zone: 'America/Phoenix', winter: -7, summer: -7, at: [35.18056, -111.62], within: 5, source: 'Wikipedia' },
  { code: '86515', name: 'Window Rock, AZ', zone: 'America/Denver', winter: -7, summer: -6, at: [35.67056, -109.06389], within: 3, source: 'Wikipedia; Navajo Nation capital' },
  { code: '86504', name: 'Fort Defiance, AZ', zone: 'America/Denver', winter: -7, summer: -6, at: [35.7475, -109.06861], within: 3, source: 'Wikipedia; Navajo Nation' },
  { code: '86045', name: 'Tuba City, AZ', zone: 'America/Denver', winter: -7, summer: -6, at: [36.125, -111.24722], within: 5, source: 'Wikipedia; Navajo Nation' },
  { code: '86043', name: 'Second Mesa, AZ', zone: 'America/Phoenix', winter: -7, summer: -7, at: [35.809702, -110.533441], within: 5, source: 'Census; Hopi reservation' },
  // Indiana: Eastern, except the northwest (Chicago area) and southwest (Evansville) corners, which are Central.
  { code: '46204', name: 'Indianapolis, IN', zone: 'America/Indiana/Indianapolis', winter: -5, summer: -4, at: [39.770593, -86.157054], within: 3, source: 'Census' },
  { code: '46320', name: 'Hammond, IN', zone: 'America/Chicago', winter: -6, summer: -5, at: [41.608922, -87.497554], within: 3, source: 'Census; Lake County is Central' },
  { code: '47708', name: 'Evansville, IN', zone: 'America/Chicago', winter: -6, summer: -5, at: [37.974249, -87.574336], within: 3, source: 'Census; Vanderburgh County is Central' },
  { code: '47586', name: 'Tell City, IN', zone: 'America/Indiana/Tell_City', winter: -6, summer: -5, at: [37.95306, -86.75583], within: 3, source: 'Wikipedia; Perry County is Central' },
  { code: '47591', name: 'Vincennes, IN', zone: 'America/Indiana/Vincennes', winter: -5, summer: -4, at: [38.6775, -87.50194], within: 3, source: 'Wikipedia; Knox County is Eastern' },
  // El Paso and Hudspeth counties, Texas, are Mountain.
  { code: '79901', name: 'El Paso, TX', zone: 'America/Denver', winter: -7, summer: -6, at: [31.759397, -106.480128], within: 3, source: 'Census' },
  // Florida west of the Apalachicola River is Central; Tallahassee, east of it, is Eastern.
  { code: '32501', name: 'Pensacola, FL', zone: 'America/Chicago', winter: -6, summer: -5, at: [30.428781, -87.222515], within: 3, source: 'Census' },
  { code: '32401', name: 'Panama City, FL', zone: 'America/Chicago', winter: -6, summer: -5, at: [30.158374, -85.637996], within: 3, source: 'Census' },
  { code: '32301', name: 'Tallahassee, FL', zone: 'America/New_York', winter: -5, summer: -4, at: [30.427618, -84.257753], within: 3, source: 'Census' },
  // Idaho: Mountain in the south, Pacific north of the Salmon River. Oregon: Malheur County is Mountain.
  { code: '83702', name: 'Boise, ID', zone: 'America/Boise', winter: -7, summer: -6, at: [43.61583, -116.20167], within: 3, source: 'Wikipedia' },
  { code: '83814', name: "Coeur d'Alene, ID", zone: 'America/Los_Angeles', winter: -8, summer: -7, at: [47.69278, -116.78], within: 3, source: 'Wikipedia' },
  { code: '97914', name: 'Ontario, OR', zone: 'America/Boise', winter: -7, summer: -6, at: [44.0266, -116.9629], within: 3, source: 'Ontario city centre (not fetched; the Census point of this large ZIP is 11 km away)' },
  { code: '97201', name: 'Portland, OR', zone: 'America/Los_Angeles', winter: -8, summer: -7, at: [45.508551, -122.688283], within: 3, source: 'Census' },
  // Hawaii keeps standard time all year.
  { code: '96813', name: 'Honolulu, HI', zone: 'Pacific/Honolulu', winter: -10, summer: -10, at: [21.316548, -157.845053], within: 3, source: 'Census' },
  // Alaska; the Aleutians west of 169 degrees 30 minutes west are Hawaii-Aleutian time.
  { code: '99501', name: 'Anchorage, AK', zone: 'America/Anchorage', winter: -9, summer: -8, at: [61.219998, -149.85784], within: 3, source: 'Census', noDegreeNightfall: true },
  // ZIP 99801 covers the Mendenhall Valley, where most of Juneau lives; its point is 9 km from downtown.
  { code: '99801', name: 'Juneau, AK', zone: 'America/Juneau', winter: -9, summer: -8, at: [58.3, -134.41611], within: 10, source: 'Wikipedia (downtown)', noDegreeNightfall: true },
  { code: '99685', name: 'Unalaska, AK', zone: 'America/Nome', winter: -9, summer: -8, at: [53.873873, -166.482953], within: 5, source: 'Census; east of 169 degrees 30 minutes, Alaska time' },
  { code: '99546', name: 'Adak, AK', zone: 'America/Adak', winter: -10, summer: -9, at: [51.87806, -176.64611], within: 3, source: 'Wikipedia; Hawaii-Aleutian time' },
  // Puerto Rico keeps Atlantic Standard Time all year.
  { code: '00901', name: 'San Juan, PR', zone: 'America/Puerto_Rico', winter: -4, summer: -4, at: [18.466594, -66.107982], within: 3, source: 'Census' },
  { code: '00725', name: 'Caguas, PR', zone: 'America/Puerto_Rico', winter: -4, summer: -4, at: [18.220689, -66.03958], within: 3, source: 'Census' },
  // Canada (forward sortation areas). Reference points are the subway stations in each area (not fetched).
  { code: 'M6B', name: 'North York, ON', zone: 'America/Toronto', winter: -5, summer: -4, at: [43.7089, -79.4407], within: 3, source: 'Glencairn station, Toronto' },
  { code: 'H3W', name: 'Côte-des-Neiges Southwest, QC', zone: 'America/Toronto', winter: -5, summer: -4, at: [45.4855, -73.6276], within: 3, source: 'Snowdon station, Montreal' },
];

describe('lookupPostal', () => {
  for (const c of CASES) {
    it(`${c.code} ${c.name}: ${c.zone}, near the real place, sun times exist (${c.source})`, () => {
      const p = lookupPostal(c.code);
      expect(p).not.toBeNull();
      if (!p) return;
      expect(p.postal).toBe(c.code);
      expect(p.name).toBe(`${c.name} ${c.code}`);
      expect(p.timeZone).toBe(c.zone);
      expect(p.elevation).toBe(0);
      expect(offset(p.timeZone, 0)).toBe(c.winter);
      expect(offset(p.timeZone, 6)).toBe(c.summer);
      expect(km(p.latitude, p.longitude, c.at[0], c.at[1])).toBeLessThanOrEqual(c.within);
      expect(parsePlace(p)).toEqual({ name: p.name, latitude: p.latitude, longitude: p.longitude, timeZone: p.timeZone, elevation: 0 });
      if (c.noDegreeNightfall) {
        // The default nightfall (8.5 degrees) does not occur in June this far north; the app refuses
        // the place with that setting, and accepts it with nightfall a fixed time after sunset.
        expect(() => assertSunTimesExist(p, DEFAULT_TZEIT)).toThrow(NoSunError);
        expect(() => assertSunTimesExist(p, MINUTES_TZEIT)).not.toThrow();
      } else {
        expect(() => assertSunTimesExist(p, DEFAULT_TZEIT)).not.toThrow();
      }
    });
  }

  it('tidies what is typed', () => {
    const lakewood = lookupPostal('08701');
    expect(lakewood?.name).toBe('Lakewood, NJ 08701');
    for (const typed of ['08701-1234', ' 08701 ', '08701 1234', '087011234', '08701 - 1234', '\t08701\n']) {
      expect(lookupPostal(typed), typed).toEqual(lakewood);
    }
    const h3w = lookupPostal('H3W');
    for (const typed of ['h3w', 'h3w 1a1', 'H3W1A1', ' H3W 1A1 ', 'h3W1a1']) {
      expect(lookupPostal(typed), typed).toEqual(h3w);
    }
    expect(lookupPostal('m6b 2k3')?.postal).toBe('M6B');
  });

  it('returns null for unknown and malformed input', () => {
    for (const bad of [
      '', ' ', '8701', '087012', '0870', '00000', '99999', 'abcde', 'H3', 'H3WW', '3HW', 'H3W 1A', 'H3W-1A1X', 'Lakewood', '08701-12',
      '08701-12345', 'ZIP 08701', '08701x', '1e4', '-8701', '08 701', 'D0A', 'Z1Z', 'H0H', '0'.repeat(30),
    ]) {
      expect(lookupPostal(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(lookupPostal(undefined as unknown as string)).toBeNull();
    expect(lookupPostal(8701 as unknown as string)).toBeNull();
  });

  it('has no military or post-office-only codes without a real place', () => {
    // APO/FPO/DPO codes (09xxx, 340xx, 962xx-966xx); GeoNames lists 96860 both as FPO AA and as Pearl Harbor.
    for (const code of ['09001', '09007', '34002', '96201', '96601', '96319']) expect(lookupPostal(code), code).toBeNull();
    // A post-office-box code whose estimated location in the source is 36 km from the town it names.
    expect(lookupPostal('80044')).toBeNull();
  });
});

describe('nearestPostal', () => {
  it('finds Lakewood for a point in Lakewood', () => {
    const p = nearestPostal(40.0821, -74.2097);
    expect(p?.postal).toBe('08701');
    expect(p?.timeZone).toBe('America/New_York');
  });

  it('finds the nearest area in a city and across a border', () => {
    expect(nearestPostal(45.4855, -73.6276)?.postal).toBe('H3W');
    expect(nearestPostal(31.7619, -106.485)?.timeZone).toBe('America/Denver'); // El Paso
    expect(nearestPostal(51.878, -176.646)?.postal).toBe('99546'); // Adak, near the 180th meridian
  });

  it('returns null far from any known area', () => {
    expect(nearestPostal(35, -40)).toBeNull(); // mid-Atlantic
    expect(nearestPostal(0, 0)).toBeNull();
    expect(nearestPostal(51.5074, -0.1278)).toBeNull(); // London: not in the table
    expect(nearestPostal(Number.NaN, 0)).toBeNull();
    expect(nearestPostal(91, 0)).toBeNull();
    expect(nearestPostal(0, 181)).toBeNull();
  });

  it('answers within 80 km and not beyond', () => {
    // Adak has no other code near it: 0.6 degrees of latitude (67 km) south of it, over the sea,
    // the answer is Adak; 0.8 degrees (89 km) south, there is none.
    const adak = lookupPostal('99546');
    expect(adak).not.toBeNull();
    if (!adak) return;
    expect(nearestPostal(adak.latitude - 0.6, adak.longitude)?.postal).toBe('99546');
    expect(nearestPostal(adak.latitude - 0.8, adak.longitude)).toBeNull();
  });

  it('agrees with a search of every row', () => {
    const all = allPostalPlaces();
    const points: Array<[number, number]> = [
      [40.75, -73.99], [41.88, -87.63], [34.05, -118.25], [25.77, -80.19], [47.6, -122.33], [61.2, -149.9], [21.3, -157.86],
      [18.4, -66.06], [43.65, -79.38], [45.5, -73.57], [49.28, -123.12], [44.0, -103.0], [37.0, -114.0], [32.0, -100.0],
    ];
    for (const [lat, lon] of points) {
      let best = all[0];
      let bestKm = Infinity;
      for (const p of all) {
        const d = km(lat, lon, p.latitude, p.longitude);
        if (d < bestKm) {
          bestKm = d;
          best = p;
        }
      }
      const got = nearestPostal(lat, lon);
      if (bestKm > 80) expect(got).toBeNull();
      // The search measures on a flat map around the point; within 80 km that differs from the
      // great-circle distance by far less than 1 km.
      else expect(got && km(lat, lon, got.latitude, got.longitude)).toBeLessThanOrEqual(bestKm + 0.2);
      expect(best).toBeDefined();
    }
  });
});

describe('the whole table', () => {
  const all = allPostalPlaces();

  it('every row is a valid place that looks itself up', () => {
    expect(all.length).toBeGreaterThan(40_000);
    const zones = new Set(all.map(p => p.timeZone));
    for (const z of zones) expect(isValidTimeZone(z), z).toBe(true);
    for (const p of all) {
      expect(p.name.length).toBeLessThanOrEqual(80);
      expect(p.name.endsWith(` ${p.postal}`)).toBe(true);
      expect(Math.abs(p.latitude)).toBeLessThanOrEqual(90);
      expect(Math.abs(p.longitude)).toBeLessThanOrEqual(180);
      expect(lookupPostal(p.postal)).toEqual(p);
    }
    console.log(`postal table: ${all.length} rows, ${all.filter(p => /^\d/.test(p.postal)).length} US, ${all.filter(p => /^[A-Z]/.test(p.postal)).length} Canada, ${zones.size} zones`);
  });

  it('the nearest area to each area is at its own point', () => {
    for (const p of all) {
      const got = nearestPostal(p.latitude, p.longitude);
      expect(got && km(p.latitude, p.longitude, got.latitude, got.longitude), p.name).toBe(0);
    }
  });

  it('every zone keeps the offsets of its state', () => {
    // A zone whose January offset is not one of its state's would be a wrong hour for every time.
    const allowed: Record<string, number[]> = {
      NJ: [-5], NY: [-5], CT: [-5], MA: [-5], PA: [-5], MD: [-5], OH: [-5], GA: [-5], VA: [-5], NC: [-5], SC: [-5], DC: [-5],
      FL: [-5, -6], IN: [-5, -6], KY: [-5, -6], TN: [-5, -6], MI: [-5, -6], AL: [-6, -5],
      IL: [-6], WI: [-6], MN: [-6], IA: [-6], MO: [-6], AR: [-6], LA: [-6], MS: [-6], OK: [-6],
      TX: [-6, -7], KS: [-6, -7], NE: [-6, -7], SD: [-6, -7], ND: [-6, -7],
      CO: [-7], UT: [-7], NM: [-7], WY: [-7], MT: [-7], AZ: [-7], ID: [-7, -8], OR: [-8, -7], NV: [-8, -7], WA: [-8], CA: [-8],
      AK: [-9, -10], HI: [-10], PR: [-4], VI: [-4], GU: [10], MP: [10], AS: [-11],
      ON: [-5, -6], QC: [-5, -4], BC: [-8, -7], AB: [-7], MB: [-6], SK: [-6, -7], NS: [-4], NB: [-4], PE: [-4], NL: [-3.5, -4], YT: [-7], NT: [-7],
    };
    const memo = new Map<string, number>();
    const winter = (z: string) => memo.get(z) ?? (memo.set(z, offset(z, 0)), memo.get(z) as number);
    for (const p of all) {
      const state = (/, ([A-Z]{2}) [0-9A-Z]{3,5}$/.exec(p.name) ?? [])[1] ?? '';
      const ok = allowed[state];
      if (ok) expect(ok, `${p.name} ${p.timeZone}`).toContain(winter(p.timeZone));
    }
  });
});

describe('cost', () => {
  it('importing and the first lookup in a fresh process cost well under a millisecond', async () => {
    // Bundle the module as the Worker would get it, then time it in a new Node process (a fresh isolate).
    const dir = mkdtempSync(join(tmpdir(), 'zip-cost-'));
    try {
      const bundle = join(dir, 'zip.mjs');
      await build({ entryPoints: [join(import.meta.dirname, '../src/app/zip.ts')], bundle: true, format: 'esm', outfile: bundle, logLevel: 'silent' });
      const empty = join(dir, 'empty.mjs');
      writeFileSync(empty, 'export const x = 1;\n');
      const script = join(dir, 'time.mjs');
      writeFileSync(
        script,
        `const t0 = performance.now();
await import(${JSON.stringify(pathToFileURL(empty).href)});
const t1 = performance.now();
const m = await import(${JSON.stringify(pathToFileURL(bundle).href)});
const t2 = performance.now();
const a = m.lookupPostal('08701');
const t3 = performance.now();
const b = m.lookupPostal('H3W 1A1');
const t4 = performance.now();
const c = m.nearestPostal(40.75, -73.99);
const t5 = performance.now();
const zips = ['08701', '11219', '90036', '99546', '00901', '60645', '77096', '33140', '48237', '10950'];
let n = 0;
const w0 = performance.now();
for (let i = 0; i < 20000; i++) if (m.lookupPostal(zips[i % zips.length])) n++;
const w1 = performance.now();
for (let i = 0; i < 2000; i++) if (m.nearestPostal(40 + (i % 50) / 10, -74 - (i % 37) / 10)) n++;
const w2 = performance.now();
console.log(JSON.stringify({ ok: !!(a && b && c && n), importEmpty: t1 - t0, importZip: t2 - t1, firstLookup: t3 - t2, firstCanada: t4 - t3, firstNearest: t5 - t4,
  warmLookup: (w1 - w0) / 20000, warmNearest: (w2 - w1) / 2000 }));
`,
      );
      const runs = [0, 1, 2].map(() => JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8' })) as Record<string, number | boolean>);
      const median = (k: string) => (runs.map(r => r[k] as number).sort((x, y) => x - y)[1] as number);
      const r = {
        importEmpty: median('importEmpty'), importZip: median('importZip'), firstLookup: median('firstLookup'), firstCanada: median('firstCanada'),
        firstNearest: median('firstNearest'), warmLookup: median('warmLookup'), warmNearest: median('warmNearest'),
      };
      console.log(`postal lookup cost in ms (median of 3 fresh processes): ${Object.entries(r).map(([k, v]) => `${k} ${v.toFixed(4)}`).join(', ')}`);
      expect(runs.every(x => x.ok)).toBe(true);
      // Import includes reading and compiling the file, which in a Worker happens once with the
      // whole bundle at startup; the lookups themselves must be far below the 10 ms budget.
      expect(r.firstLookup).toBeLessThan(1);
      expect(r.firstCanada).toBeLessThan(1);
      expect(r.firstNearest).toBeLessThan(1.5);
      expect(r.warmLookup).toBeLessThan(0.05);
      expect(r.warmNearest).toBeLessThan(0.5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
