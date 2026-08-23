/**
 * World-layer zoom LOD.
 *
 * The retired SVG map hid grass, buildings, track and service roads until a
 * pinch earned them (`layerVisible` at 0.7 / 1.4 px/m). MapLibre drew every
 * Truth layer at park-wide, so the tile map lost that rank. This is the same
 * table, so a pinch still reads as detail emerging rather than as a restyle.
 */
import { layerVisible } from '@party-tracker/shared/mapSymbols.js';

export const DETAIL_ENTER = 0.7;
export const DETAIL_LEAVE = 0.62;
export const SERVICE_ENTER = 1.4;
export const SERVICE_LEAVE = 1.28;
/** Path casing and slides: the SVG's `lowZoom` line (`!detail || z < 0.85`). */
export const CLOSE_ENTER = 0.85;

export const DETAIL_LAYERS = Object.freeze(['grass', 'building', 'coaster']);
export const SERVICE_LAYERS = Object.freeze(['service']);
export const CLOSE_LAYERS = Object.freeze(['slide', 'path-case']);

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
