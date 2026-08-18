/**
 * Everything the display layer needs to know about the ground under a venue.
 *
 * Fetches a DEM, resamples it onto the venue's own grid, writes a hillshade
 * overlay, and returns a descriptor the visual spec carries. Network lives
 * here so `compileVisualSpec` stays pure — the spec receives a plain object,
 * never a fetch.
 *
 * A venue with no coverage returns null and renders flat. That is the correct
 * outcome, not a degraded one: a fabricated heightfield looks convincing and
 * is wrong everywhere, which is worse than admitting there is no data.
 */

import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolveDem, fitness } from './dem-source.mjs';
import { gridFromBounds } from './elevation-grid.mjs';
import { shadeField, shadeRgba, shadeBytes, encodePng, DEFAULT_LIGHT } from './hillshade.mjs';
import { constrainFromTruth } from './constraints-from-truth.mjs';
import { meshFromGrid } from './mesh-export.mjs';

export const HILLSHADE_FILE = 'hillshade.png';

/** Slope past which a kit may paint its `steep` variant instead of the base. */
export const STEEP_DEGREES = 18;

const boundsOf = (map) => {
  const b = map?.meta?.bounds || {};
  const north = b.n ?? b.north;
  const south = b.s ?? b.south;
  const east = b.e ?? b.east;
  const west = b.w ?? b.west;
  return [north, south, east, west].every(Number.isFinite)
    ? { north, south, east, west }
    : null;
};

/**
 * @param {object} opts
 * @param {string} opts.id venue id
 * @param {object} opts.map map.json body
 * @param {string} opts.outDir directory to write the hillshade into
 * @param {number} [opts.maxCols] grid budget, matched to the bake
 * @param {boolean} [opts.write]
 * @param {object} [opts.light] azimuth/altitude override
 * @param {string} [opts.url] pin an explicit DEM tile
 * @param {boolean} [opts.constrain] make paths, water and pads sit properly
 * @param {boolean} [opts.mesh] also write an OBJ/MTL of the heightfield
 * @param {Function} [opts.openTiff] injected for tests
 * @returns {Promise<{terrain: object, grid: object, written: string[]}|null>}
 */
export async function prepareVenueTerrain({
  id,
  map,
  outDir,
  maxCols = 240,
  write = true,
  light = DEFAULT_LIGHT,
  url,
  constrain = false,
  mesh = false,
  openTiff,
}) {
  const bounds = boundsOf(map);
  if (!bounds) return null;

  const dem = await resolveDem(bounds, { url, openTiff });
  if (!dem) return null;

  // Match the bake's aspect so shade lines up with terrain cells 1:1.
  const spanLng = bounds.east - bounds.west;
  const spanLat = bounds.north - bounds.south;
  const midLat = (bounds.north + bounds.south) / 2;
  const widthM = spanLng * 111320 * Math.cos((midLat * Math.PI) / 180);
  const heightM = spanLat * 110540;
  const cols = Math.min(maxCols, Math.max(16, Math.round(maxCols)));
  const rows = Math.max(16, Math.round((cols * heightM) / widthM));

  const grid = gridFromBounds({ bounds, cols, rows, sample: dem.sample });
  const { min, max } = grid.extent();
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

  // Constraints run before shading: the light must fall on the ground the
  // renderer will actually draw, not the raw DEM it started from.
  let constrained = null;
  if (constrain) {
    const toCell = ([lng, lat]) => [
      ((lng - bounds.west) / spanLng) * cols,
      ((bounds.north - lat) / spanLat) * rows,
    ];
    const { constraints, applied } = constrainFromTruth(grid, map, toCell);
    constraints.solveAndApply({ iterations: 8 });
    constrained = { ...applied, nodes: constraints.nodes.length };
  }

  const field = shadeField(grid, light);
  const written = [];
  if (write) {
    mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, HILLSHADE_FILE);
    writeFileSync(file, encodePng(cols, rows, shadeRgba(field, cols, rows)));
    written.push(file);
    if (mesh) {
      const { obj, mtl } = meshFromGrid(grid, { name: `${id}-terrain`, texture: 'ground.png' });
      const objFile = path.join(outDir, `${id}-terrain.obj`);
      const mtlFile = path.join(outDir, `${id}-terrain.mtl`);
      writeFileSync(objFile, obj);
      writeFileSync(mtlFile, mtl);
      written.push(objFile, mtlFile);
    }
  }

  const terrain = {
    source: dem.source,
    url: dem.url,
    resolution: dem.resolution,
    surfaceModel: Boolean(dem.surfaceModel),
    cellMetres: Math.round(grid.cellSize * 100) / 100,
    fitness: fitness(dem.resolution, grid.cellSize),
    relief: {
      min: Math.round(min * 10) / 10,
      max: Math.round(max * 10) / 10,
    },
    grid: { cols, rows },
    hillshade: {
      file: HILLSHADE_FILE,
      azimuth: light.azimuth ?? DEFAULT_LIGHT.azimuth,
      altitude: light.altitude ?? DEFAULT_LIGHT.altitude,
    },
    // Truth's own bounds, echoed so the renderer can place the overlay. The
    // certification asserts these are equal to truth rather than merely absent.
    bounds,
    steepDegrees: STEEP_DEGREES,
    ...(constrained ? { constrained } : {}),
  };

  return { terrain, grid, shade: shadeBytes(field), written };
}
