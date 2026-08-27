/**
 * Visual factory I/O facade — display pack paths and sidecar reads/writes.
 *
 * Truth coordinates are read only through map-factory/map-io (readTruth).
 */

import path from 'node:path';
import { readJson, venueSidecar, writeJson, VENUE_DIR } from '../venue-io.mjs';

/** Builder-side display pack directory for one venue. */
export function displayDir(venueId) {
  return venueSidecar(venueId, 'display');
}

/** Published display directory under public/venues. */
export function publishedDisplayDir(venueId) {
  return path.join(VENUE_DIR, venueId, 'display');
}

export function readDisplayJson(venueId, name) {
  return readJson(path.join(displayDir(venueId), name));
}

export function writeDisplayJson(venueId, name, value, pretty = true) {
  writeJson(path.join(displayDir(venueId), name), value, pretty);
}

export { VENUE_DIR, readJson, writeJson };
export { writeDisplayPack as writeDisplayPackToPostdb } from '../postdb-io.mjs';
