/**
 * Map factory entry — certify and return the published truth bundle.
 *
 * Full geometry/research/rebuild stages stay in build-pipeline until PostDB
 * Slice 1; this is the stable interface CLIs and the route catalog call.
 */

import { certifyVenue } from '../venue-certify.mjs';
import { readTruth, truthPaths, truthStamp } from './map-io.mjs';

/**
 * @param {string} venueId
 * @param {{ certify?: boolean }} [opts]
 * @returns {import('../factory-types.mjs').VenueTruthBundle & { certification?: object|null, certified: boolean|null, paths: object }}
 */
export function buildTruth(venueId, opts = {}) {
  const { certify = true } = opts;
  const { map, pois, gaps } = readTruth(venueId);
  let certification = null;
  if (certify) certification = certifyVenue(venueId);
  return {
    venueId,
    generated: map?.meta?.generated ?? truthStamp(venueId),
    map,
    pois,
    gaps,
    paths: truthPaths(venueId),
    certification,
    certified: certification?.certified ?? null,
  };
}
