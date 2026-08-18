/**
 * Raster tier — the baked PNG as map tiles, honestly gapped until a tiler
 * exists.
 *
 * The seam mirrors display-tiles.mjs's tippecanoe wrap: the pack asks for
 * a raster PMTiles archive; when the toolchain to produce one is absent
 * (go-pmtiles converts MBTiles, which needs a tiler + sqlite this repo
 * deliberately does not carry), the result is `{ok: false, reason}` and
 * the certification records a gap instead of pretending. The baked PNG +
 * its geo bounds remain in the manifest, so a renderer can still place
 * the image directly (MapLibre image source) without any tiling.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';

const hasBinary = (cmd) => spawnSync(cmd, ['--help'], { stdio: 'ignore' }).error === undefined;

/**
 * Attempt the bake-PNG → raster-PMTiles conversion.
 * @param {{ bakePng: string, bounds?: object|null }} inputs
 * @returns {{ ok: boolean, reason?: string, file?: string, sizeKb?: number }}
 */
export function buildRasterTier({ bakePng, bounds }) {
  if (!bakePng || !existsSync(bakePng)) {
    return { ok: false, reason: 'no baked PNG to tile — run venues:bake first' };
  }
  if (!bounds) {
    return { ok: false, reason: 'bake model carries no geo bounds — rebake with the current builder' };
  }
  if (!hasBinary('pmtiles')) {
    return {
      ok: false,
      reason: `go-pmtiles binary not found — raster tier is a recorded gap; the ${Math.round(statSync(bakePng).size / 1024)} KB PNG + bounds still ship in the manifest for direct image placement`,
    };
  }
  // go-pmtiles present but conversion needs an MBTiles tiler this repo does
  // not carry — still a gap, named precisely so the fix is obvious.
  return { ok: false, reason: 'go-pmtiles found, but PNG→MBTiles tiling is not implemented — see plan slice 4 raster seam' };
}
