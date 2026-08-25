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
import {
  postdbRequired,
  readTruth as readTruthFromPostdb,
  usingPostdb,
} from '../postdb-io.mjs';

export { writeTruth as writeTruthToPostdb } from '../postdb-io.mjs';

/**
 * Read the published truth trio for one venue from on-disk files.
 * @param {string} venueId
 * @returns {{ map: object, pois: object[], gaps: object|null }}
 */
export function readTruthFromFiles(venueId) {
  const map = readJson(path.join(VENUE_DIR, `${venueId}.map.json`), null);
  const pois = readJson(path.join(VENUE_DIR, `${venueId}.pois.json`), null);
  const gaps = readJson(path.join(VENUE_DIR, `${venueId}.gaps.json`), null);
  if (!map || !pois) throw new Error(`Venue "${venueId}" is missing map.json or pois.json`);
  return { map, pois, gaps };
}

/**
 * Read the published truth trio for one venue (file-only; backward compat).
 * @param {string} venueId
 * @returns {{ map: object, pois: object[], gaps: object|null }}
 */
export function readTruth(venueId) {
  return readTruthFromFiles(venueId);
}

/**
 * Read truth from PostDB when configured, otherwise from files.
 * @param {string} venueId
 * @returns {Promise<{ map: object, pois: object[], gaps: object|null }>}
 */
export async function readTruthAsync(venueId) {
  if (!usingPostdb()) return readTruthFromFiles(venueId);
  try {
    const { map, pois, gaps } = await readTruthFromPostdb(venueId);
    return { map, pois, gaps };
  } catch (err) {
    if (postdbRequired()) throw err;
    return readTruthFromFiles(venueId);
  }
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
