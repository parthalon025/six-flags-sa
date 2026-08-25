/**
 * Map factory PostDB mirror — file truth is still written by build-venue;
 * this appends a revision when DATABASE_URL is set.
 */

import { usingPostdb, writeTruth } from '../postdb-io.mjs';

/**
 * Mirror the published truth trio to PostDB when configured.
 * @param {string} venueId
 * @param {{ map: object, pois: object[], gaps?: object|null, routeId?: string }} truth
 * @returns {Promise<{ revisionId: string }|null>}
 */
export async function mirrorTruthToPostdb(venueId, { map, pois, gaps, routeId = 'map.truth' }) {
  if (!usingPostdb()) return null;
  return writeTruth(venueId, {
    map,
    pois,
    gaps,
    factory: 'map',
    routeId,
  });
}
