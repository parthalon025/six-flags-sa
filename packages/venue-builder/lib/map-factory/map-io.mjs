/**
 * Map factory I/O facade — truth reads and writes over the venue-io kernel.
 *
 * No factory business logic here: path helpers and JSON I/O only. Map factory
 * stages call through this seam so Visual factory never reaches venue-io for
 * truth coordinates.
 */

import path from 'node:path';
import {
  VENUE_DIR,
  gapsDocumentFor,
  readJson,
  serializeVenue,
  writeVenue,
  writeJson,
} from '../venue-io.mjs';

/**
 * Read the published truth trio for one venue.
 * @param {string} venueId
 * @returns {{ map: object, pois: object[], gaps: object|null }}
 */
export function readTruth(venueId) {
  const map = readJson(path.join(VENUE_DIR, `${venueId}.map.json`), null);
  const pois = readJson(path.join(VENUE_DIR, `${venueId}.pois.json`), null);
  const gaps = readJson(path.join(VENUE_DIR, `${venueId}.gaps.json`), null);
  if (!map || !pois) throw new Error(`Venue "${venueId}" is missing map.json or pois.json`);
  return { map, pois, gaps };
}

/** Current truth stamp from map.meta.generated. */
export function truthStamp(venueId) {
  const { map } = readTruth(venueId);
  return map?.meta?.generated ?? null;
}

/** Absolute paths to the published truth trio. */
export function truthPaths(venueId) {
  return {
    map: path.join(VENUE_DIR, `${venueId}.map.json`),
    pois: path.join(VENUE_DIR, `${venueId}.pois.json`),
    gaps: path.join(VENUE_DIR, `${venueId}.gaps.json`),
  };
}

export { gapsDocumentFor, serializeVenue, writeVenue, writeJson, VENUE_DIR };
