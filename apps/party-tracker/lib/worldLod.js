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

const DETAIL_ENTER = 0.7;
const DETAIL_LEAVE = 0.62;
const SERVICE_ENTER = 1.4;
const SERVICE_LEAVE = 1.28;
/** Path casing and slides: the SVG's `lowZoom` line (`!detail || z < 0.85`). */
const CLOSE_ENTER = 0.85;

const DETAIL_LAYERS = Object.freeze(['grass', 'building', 'coaster']);
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
