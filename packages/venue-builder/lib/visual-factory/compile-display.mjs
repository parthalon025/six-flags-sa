/**
 * Visual factory entry — compile and certify display packs for one venue.
 *
 * Reads truth only through map-io; never writes coordinates.
 */

import { readTruthAsync } from '../map-factory/map-io.mjs';
import {
  applyMidPyramidToManifest,
  bakeOptsForVenue,
  cutPackedMidPyramid,
  runDisplayStage,
} from '../display-pack.mjs';
import { mirrorDisplayPacksToPostdb } from './postdb-sync.mjs';
import { displayDir } from './visual-io.mjs';

/**
 * @param {string} venueId
 * @param {object} [opts]
 * @returns {Promise<object>} display stage result (packs, certified, tiles, …)
 */
export async function compileDisplay(venueId, opts = {}) {
  const {
    tiles = true,
    terrain = null,
    wantTerrain = false,
    constrain = true,
    mesh = false,
    skinIds,
    ...rest
  } = opts;

  let terrainResult = terrain;
  if (wantTerrain && !terrainResult) {
    const { prepareVenueTerrain } = await import('../terrain/venue-terrain.mjs');
    const { map } = await readTruthAsync(venueId);
    const outDir = displayDir(venueId);
    const prepared = await prepareVenueTerrain({
      id: venueId, map, outDir, constrain, mesh,
    });
    terrainResult = prepared?.terrain || null;
  }

  const disp = runDisplayStage(venueId, {
    tiles,
    terrain: terrainResult,
    skinIds,
    ...bakeOptsForVenue(venueId),
    ...rest,
  });

  await mirrorDisplayPacksToPostdb(venueId, disp.packs);

  if (disp.bakeCerts?.length) {
    const cut = await cutPackedMidPyramid({
      id: venueId,
      bakeCerts: disp.bakeCerts,
      bakeDir: disp.bakeDir,
      outDir: disp.outDir,
      primaryKit: disp.primaryKit,
    });
    if (!cut?.gap) applyMidPyramidToManifest(disp.outDir, { primaryKit: disp.primaryKit });
  }

  return { ...disp, terrain: terrainResult };
}
