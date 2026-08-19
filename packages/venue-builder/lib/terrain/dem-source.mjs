/**
 * Pick an elevation source for a venue, and say which one it got.
 *
 * Order is fitness, not coverage: bare-earth and fine first, surface-model and
 * coarse second, nothing third. "Nothing" is a real answer — a venue with no
 * usable DEM renders flat, which is honest, where a fabricated heightfield
 * would look plausible and be wrong everywhere.
 *
 * Whatever is chosen is recorded on the venue's visual spec, so a reader can
 * tell a 10 m lidar DTM from a 30 m radar DSM without re-deriving it.
 */

import * as usgs3dep from '../adapters/usgs-3dep.mjs';
import * as copernicus from '../adapters/copernicus-dem.mjs';

export const SOURCES = { [usgs3dep.ID]: usgs3dep, [copernicus.ID]: copernicus };

/** Fitness order: bare-earth 10 m, then global 30 m surface model. */
export const DEFAULT_ORDER = [usgs3dep.ID, copernicus.ID];

/**
 * @param {{north:number,south:number,east:number,west:number}} bounds
 * @param {object} [opts]
 * @param {string[]} [opts.order] source ids to try, best first
 * @param {string} [opts.url] pin an explicit tile (used for 3DEP 1 m)
 * @param {Function} [opts.openTiff] injected for tests
 * @returns {Promise<{sample:Function, resolution:number, source:string,
 *   url:string, surfaceModel?:boolean}|null>}
 */
export async function resolveDem(bounds, { order = DEFAULT_ORDER, url, openTiff } = {}) {
  for (const id of order) {
    const mod = SOURCES[id];
    if (!mod) continue;
    const opts = { ...(openTiff ? { openTiff } : {}) };
    // An explicit tile only makes sense for the source it was pinned for.
    if (url && id === usgs3dep.ID) opts.url = url;
    const got = await mod.elevationSampler(bounds, opts);
    if (got) return got;
  }
  return null;
}

/**
 * Does this source actually resolve the grid it will paint?
 *
 * A source coarser than the bake cell is not an error — it still carries broad
 * relief — but it is worth stating rather than discovering in a render.
 *
 * @param {number} resolution metres per DEM post
 * @param {number} cellMetres metres per bake cell
 * @returns {'resolves'|'marginal'|'coarse'}
 */
export function fitness(resolution, cellMetres) {
  if (!(resolution > 0) || !(cellMetres > 0)) return 'coarse';
  const ratio = resolution / cellMetres;
  if (ratio <= 1) return 'resolves';
  if (ratio <= 2.5) return 'marginal';
  return 'coarse';
}
