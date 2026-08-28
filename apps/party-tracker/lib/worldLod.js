/**
 * World-layer zoom LOD.
 *
 * The retired SVG map hid grass, buildings, track and service roads until a
 * pinch earned them (`layerVisible` at 0.7 / 1.4 px/m). MapLibre drew every
 * Truth layer at park-wide, so the tile map lost that rank. This is the same
 * table, so a pinch still reads as detail emerging rather than as a restyle.
 */
import { layerVisible, planZoom } from '@party-tracker/shared/mapSymbols.js';
import { metresPerPixel } from '@party-tracker/shared/zoomBands.js';
import { WORLD_LAYERS } from './worldGeo.js';

const DETAIL_ENTER = 0.7;
const DETAIL_LEAVE = 0.62;
const SERVICE_ENTER = 1.4;
const SERVICE_LEAVE = 1.28;
/** Path casing and slides: the SVG's `lowZoom` line (`!detail || z < 0.85`). */
const CLOSE_ENTER = 0.85;

/* Coaster track is deliberately absent. Grass and buildings are detail — they
   clutter a park-wide read and say nothing at that scale. Track is the
   opposite: it is the landmark a guest orients by, and hiding it meant the
   view the app opens on had no coasters in a coaster park. It is drawn at
   every zoom now and kept quiet at the wide end by paint rather than by
   absence (mapViewStyle.js ramps its width and opacity), which is what keeps
   ADR-0012's "overview zoom keeps line spaghetti quiet" true without also
   making the ride invisible. */
const DETAIL_LAYERS = Object.freeze(['grass', 'building']);
const SERVICE_LAYERS = Object.freeze(['service']);
const CLOSE_LAYERS = Object.freeze(['slide', 'path-case']);

/** MapLibre zoom → the px/m scale `layerVisible` and `sizeAtZoom` read. */
export function worldPlanZoom(zoom, latitude) {
  if (!Number.isFinite(zoom)) return 0;
  const mpp = metresPerPixel(zoom, { latitude: Number.isFinite(latitude) ? latitude : 0 });
  if (!Number.isFinite(mpp) || mpp <= 0) return 0;
  return planZoom(1 / mpp);
}

/**
 * @param {number} zPlan px/m from `labelPlanZoom` / `planZoom`
 * @param {{detail?: boolean, service?: boolean, close?: boolean}} [wasShown]
 */
export function worldLodGroups(zPlan, wasShown = {}) {
  const z = Number.isFinite(zPlan) ? zPlan : 0;
  const detail = layerVisible(z, DETAIL_ENTER, DETAIL_LEAVE, wasShown.detail);
  const service = layerVisible(z, SERVICE_ENTER, SERVICE_LEAVE, wasShown.service);
  return {
    detail,
    service,
    close: detail && z >= CLOSE_ENTER,
  };
}

/** Layer-id keys the MapLibre adapter turns into `world-*` visibility. */
export function worldLodVisibility(groups) {
  const vis = {};
  for (const id of DETAIL_LAYERS) vis[id] = Boolean(groups.detail);
  for (const id of SERVICE_LAYERS) vis[id] = Boolean(groups.service);
  for (const id of CLOSE_LAYERS) vis[id] = Boolean(groups.close);
  return vis;
}

/**
 * Visibility for every layer in the vector tier, given the zoom LOD and
 * whether a baked band is actually covering the ground.
 *
 * `worldLodVisibility` answers only for the layers the LOD table names. This
 * answers for all of them, because the bake question is not per-layer: when
 * the Visual factory's image is on screen it *is* the map, and the Truth
 * geometry underneath is drawn for nobody — wasted work at best, and at worst
 * it bleeds through the bake's edges and semi-transparent passages.
 *
 * `covered` is deliberately "the image has loaded", not "a Skin declares a
 * pack". ADR-0019 makes the vector tier the never-fails fallback, and a bake
 * that has not arrived — offline, still downloading, a decode that failed —
 * must leave a working map rather than an empty one. Hiding on the
 * declaration would trade that away; hiding on the event keeps it, and the
 * tier comes straight back if the image is ever lost.
 *
 * @param {{detail?: boolean, service?: boolean, close?: boolean}} groups
 * @param {{covered?: boolean}} [bake]
 * @returns {Record<string, boolean>} layer key → visible
 */
export function worldTierVisibility(groups, { covered = false } = {}) {
  const lod = worldLodVisibility(groups);
  const out = {};
  for (const { id } of WORLD_LAYERS) out[id] = covered ? false : (lod[id] ?? true);
  out['path-case'] = covered ? false : (lod['path-case'] ?? true);
  return out;
}
