/**
 * venues:report gate — every shipped venue must pass the checklist and any
 * expect locks declared in its recipe or overrides.
 */
import fs from 'node:fs';
import path from 'node:path';
import { checklist, failures } from './venue-checklist.mjs';
import { readRecipe } from './venue-recipe.mjs';
import { readJson, venueSidecar, VENUE_DIR } from './venue-io.mjs';
import { MANIFEST_FILE } from '../src/paths.mjs';

/** Expect block from overrides, then recipe — same precedence as build-venue.mjs. */
export function readExpectLock(id) {
  const overrides = readJson(venueSidecar(id, 'overrides.json'), null);
  const { data: recipe } = readRecipe(id);
  return overrides?.expect || recipe?.expect || null;
}

/** One venue's expect-lock violations (empty when no lock or when satisfied). */
export function checkExpectLock(id, map, expectLock) {
  if (!expectLock) return [];
  const out = [];
  if (expectLock.walkable_km_min != null) {
    const walkable = map?.meta?.coverage?.walkable_km;
    if (walkable == null || walkable < expectLock.walkable_km_min) {
      out.push({
        kind: 'expect',
        key: 'walkable_km_min',
        message:
          `walkable network is ${walkable ?? 'missing'} km, below locked floor of `
          + `${expectLock.walkable_km_min} km`,
      });
    }
  }
  return out;
}

/** Checklist + expect locks for one manifest row. */
export function checkVenueReport({ venue, map, pois, mapKb, poisKb, expectLock = null }) {
  const out = [];
  for (const item of failures(checklist(venue, map, pois, { mapKb, poisKb }))) {
    out.push({
      kind: 'checklist',
      key: item.key,
      message: `${item.label} — ${item.detail}`,
    });
  }
  for (const item of checkExpectLock(venue.id, map, expectLock)) {
    out.push(item);
  }
  return out;
}

/**
 * Every venue in the manifest, loaded through injectable seams for tests.
 * @param {{ venues, load: (venue) => { map, pois, mapKb, poisKb }, readExpect?: (id) => object|null }} opts
 */
export function checkAllVenueReports({ venues, load, readExpect = readExpectLock }) {
  const all = [];
  for (const venue of venues) {
    const { map, pois, mapKb, poisKb } = load(venue);
    const expectLock = readExpect(venue.id);
    for (const failure of checkVenueReport({ venue, map, pois, mapKb, poisKb, expectLock })) {
      all.push({ venueId: venue.id, ...failure });
    }
  }
  return { ok: all.length === 0, failures: all };
}

const kb = (file) => Math.round(fs.statSync(file).size / 1024);

const defaultLoad = (venue) => {
  const mapFile = path.join(VENUE_DIR, `${venue.id}.map.json`);
  const poisFile = path.join(VENUE_DIR, `${venue.id}.pois.json`);
  return {
    map: JSON.parse(fs.readFileSync(mapFile, 'utf8')),
    pois: JSON.parse(fs.readFileSync(poisFile, 'utf8')),
    mapKb: kb(mapFile),
    poisKb: kb(poisFile),
  };
};

/** CI gate: enumerate shipped venues from manifest.json, fail on any violation. */
export function checkShippedVenueReports() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  return checkAllVenueReports({
    venues: manifest.venues,
    load: defaultLoad,
  });
}
