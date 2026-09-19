/**
 * Collect committed ParksAPI cache + bundle inventory samples for bake-off (#413).
 */

import path from 'node:path';
import { readJson, VENUE_DIR } from './venue-io.mjs';
import { compareParksApiToBundle } from './inventory-compare.mjs';
import { parksApiCacheFile } from './adapters/parks-api.mjs';
import { shapeVenueBakeoffReport } from './venue-data-adapter-bakeoff.mjs';

/** Venues with committed parks-api-cache.json sidecars (named in evaluation). */
export const BAKEOFF_VENUES = [
  'kings-island',
  'cedar-point',
  'six-flags-fiesta-texas',
];

/**
 * @param {string} venueId
 * @param {{ cacheFile?: string }} [opts]
 */
export function collectVenueSample(venueId, { cacheFile } = {}) {
  const cachePath = cacheFile || parksApiCacheFile(venueId);
  const parksApi = readJson(cachePath, null);
  if (!parksApi?.attractions?.length) {
    return shapeVenueBakeoffReport({
      venue: venueId,
      gap: true,
      error: parksApi?.error || `no cache at ${cachePath}`,
    });
  }

  const pois = readJson(path.join(VENUE_DIR, `${venueId}.pois.json`), []);
  const inventoryCompare = compareParksApiToBundle({ parksApi, pois });

  return shapeVenueBakeoffReport({
    venue: venueId,
    parksApi,
    inventoryCompare,
  });
}

/**
 * @param {string[]} [venueIds]
 */
export function collectBakeoffSamples(venueIds = BAKEOFF_VENUES) {
  return venueIds.map((id) => collectVenueSample(id));
}
