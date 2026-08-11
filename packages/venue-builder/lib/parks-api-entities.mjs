/**
 * ThemeParks.wiki entity discovery — map catalog venue ids to API park UUIDs.
 */

import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { OVERRIDE_DIR, readJson } from './venue-io.mjs';
import { loadCatalog, withIds } from './top-parks-catalog.mjs';
import { nameSimilarity } from './venue-judge.mjs';

const API = 'https://api.themeparks.wiki/v1';
const UA = 'six-flags-sa-venue-research/1.0 (+https://github.com/parthalon025/six-flags-sa)';

export const ENTITY_MAP_FILE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'data',
  'parks-api-entity-map.json',
);

/** Built-in overrides where fuzzy match is unreliable. */
const OVERRIDES = {
  'cedar-point': 'c8299e1a-0098-4677-8ead-dd0da204f8dc',
  'kings-island': 'a0df8d87-7f72-4545-a58d-eb8aa76f914b',
  'six-flags-fiesta-texas': '8be1e984-1e5f-40d0-a750-ce8e4dc2e87c',
  'magic-kingdom': '75ea578a-adc8-4116-a54d-dccb60765ef9',
  epcot: '47f90d2c-e191-4239-a466-5892ef59a88b',
  'disney-s-hollywood-studios': '288747d1-8b4f-4a64-867e-ea7c9b27bad8',
  'disney-s-animal-kingdom': '1c84a229-8862-4648-9c71-378ddd2c7693',
  'universal-studios-florida': '267615cc-8943-4c2a-b2b6-5a8ca1ae7a45',
  'universal-s-islands-of-adventure': '267615cc-8943-4c2a-b2b6-5a8ca1ae7a45',
};

async function fetchDestinations() {
  const res = await fetch(`${API}/destinations`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`destinations returned ${res.status}`);
  const data = await res.json();
  const parks = [];
  for (const dest of data.destinations || []) {
    for (const p of dest.parks || []) {
      parks.push({ id: p.id, name: p.name, destination: dest.name });
    }
  }
  return parks;
}

/**
 * Match catalog parks to API entity ids.
 *
 * @returns {{ map: Record<string, { entityId, apiName, score, reason? }>, unmatched: object[] }}
 */
function matchNames(park) {
  const names = [park.name];
  const prefixes = ["Six Flags ", "Disney's ", "Universal's ", "SeaWorld ", "Busch Gardens ", "Legoland "];
  for (const p of prefixes) {
    if (park.name.startsWith(p)) names.push(park.name.slice(p.length));
  }
  if (park.locality) {
    const city = park.locality.split(',')[0].trim();
    if (city && !names.includes(city)) names.push(city);
  }
  return names;
}

export async function discoverEntityMap({ floor = 0.68 } = {}) {
  const apiParks = await fetchDestinations();
  const catalog = loadCatalog();
  const parks = withIds(catalog.parks);
  const map = {};
  const unmatched = [];

  for (const park of parks) {
    if (OVERRIDES[park.id]) {
      const hit = apiParks.find((p) => p.id === OVERRIDES[park.id]);
      map[park.id] = {
        entityId: OVERRIDES[park.id],
        apiName: hit?.name || park.name,
        score: 1,
        reason: 'override',
      };
      continue;
    }

    let best = null;
    for (const api of apiParks) {
      for (const name of matchNames(park)) {
        const score = nameSimilarity(name, api.name);
        if (!best || score > best.score) best = { ...api, score, matchedAs: name };
      }
    }
    if (best && best.score >= floor) {
      map[park.id] = {
        entityId: best.id,
        apiName: best.name,
        score: best.score,
        destination: best.destination,
      };
    } else {
      unmatched.push({
        id: park.id,
        name: park.name,
        best: best ? { name: best.name, score: best.score } : null,
      });
    }
  }

  return { map, unmatched, apiParkCount: apiParks.length };
}

/** Load entity map from disk or fall back to built-in overrides. */
export function loadEntityMap() {
  const onDisk = readJson(ENTITY_MAP_FILE);
  const entities = { ...(onDisk?.entities || {}) };
  for (const [id, entityId] of Object.entries(OVERRIDES)) {
    if (!entities[id]?.entityId) {
      entities[id] = { entityId, apiName: id, score: 1, reason: 'override' };
    }
  }
  return entities;
}

/** Flat id → entityId record for parks-api adapter. */
export function parkEntityIds() {
  const map = loadEntityMap();
  const out = {};
  for (const [id, row] of Object.entries(map)) {
    if (row?.entityId) out[id] = row.entityId;
  }
  return out;
}

export async function writeEntityMapFile(opts = {}) {
  const { map, unmatched, apiParkCount } = await discoverEntityMap(opts);
  const doc = {
    version: 1,
    generated: new Date().toISOString().slice(0, 10),
    apiParkCount,
    matched: Object.keys(map).length,
    unmatched: unmatched.length,
    entities: map,
    failures: unmatched,
  };
  mkdirSync(path.dirname(ENTITY_MAP_FILE), { recursive: true });
  writeFileSync(ENTITY_MAP_FILE, `${JSON.stringify(doc, null, 2)}\n`);
  return doc;
}
