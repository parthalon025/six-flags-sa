/**
 * Visual factory entry — compile and certify display packs for one venue.
 *
 * Reads truth only through map-io; never writes coordinates.
 */

import { readTruthAsync } from '../map-factory/map-io.mjs';
import {
  bakeOptsForVenue,
  cutPackedBandPyramids,
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

  // The band pyramids are cut BEFORE the stage: cutting is sharp (async)
  // while the stage is synchronous, so the archives have to be on disk by the
  // time it seals the manifest and the bundle that pin them.
  const bakeOpts = bakeOptsForVenue(venueId);
  const pyramids = bakeOpts.bake
    ? await cutPackedBandPyramids({
      id: venueId,
      bakeDir: bakeOpts.bake.dir,
      outDir: rest.outDir || displayDir(venueId),
    })
    : null;

  const disp = runDisplayStage(venueId, {
    tiles,
    terrain: terrainResult,
    skinIds,
    ...bakeOpts,
    ...(pyramids ? { pyramids } : {}),
    ...rest,
  });

  await mirrorDisplayPacksToPostdb(venueId, disp.packs);

  return { ...disp, terrain: terrainResult };
}
