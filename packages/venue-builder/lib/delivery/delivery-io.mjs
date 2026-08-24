/**
 * Delivery I/O facade — publish paths and reindex over the venue-io kernel.
 */

import path from 'node:path';
import { reindex, VENUE_DIR } from '../venue-io.mjs';

export { reindex, VENUE_DIR };

/** Absolute path to one venue's published bundle manifest. */
export function bundlePath(venueId) {
  return path.join(VENUE_DIR, `${venueId}.bundle.json`);
}
