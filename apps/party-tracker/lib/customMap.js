/**
 * Custom map — extra drawing that replaces or overlays the OSM base.
 *
 * Not Overlay (contributions). Not Skin (paint). A Skin may attach one.
 * Places stay on their lat/lng; this module only decides how the ground is drawn.
 *
 * placement:
 *   overlay — draw on the OSM base (minus hideLayers)
 *   replace — hide the OSM base; the custom drawing is the map
 *
 * renderer:
 *   iso   — the live SVG iso painter (shared isoWorld meshes)
 *   baked — the Visual factory's world image from this World's display pack
 *           (ADR-0016), drawn on truth bounds under the live overlay. The
 *           pack sidecar (<skin>.world.json) is authoritative for the
 *           world's projection; `world` here is the fallback declaration
 *           when a venue ships no sidecar. A baked Skin hides no base
 *           layers: the image covers them when it loads, and the base map
 *           stays whole when it cannot.
 */

import { localMetres } from './geo.js';

export const PLACEMENT_OVERLAY = 'overlay';
export const PLACEMENT_REPLACE = 'replace';

const CUSTOM_MAPS = {
  'pixel-tycoon': {
    id: 'pixel-tycoon',
    placement: PLACEMENT_OVERLAY,
    camera: 'mercator',
    renderer: 'baked',
    world: { projection: 'top-down' },
  },
  'layered-atlas': {
    id: 'layered-atlas',
    placement: PLACEMENT_OVERLAY,
    camera: 'mercator',
    renderer: 'baked',
    world: { projection: 'top-down' },
  },
  'watercolor-quest': {
    id: 'watercolor-quest',
    placement: PLACEMENT_OVERLAY,
    camera: 'mercator',
    renderer: 'baked',
    world: { projection: 'top-down' },
  },
};

/** Custom map attached to this Wear, or null for the OSM base alone. */
export function resolveCustomMap(wear) {
  if (!wear) return null;
  return CUSTOM_MAPS[wear] || null;
}

/**
 * The MapLibre band map for a worn Skin that ships a certified world PNG.
 * Pixel tycoon is declared baked but has no pack yet — OSM until one exists.
 *
 * @param {string|null|undefined} venueId
 * @param {string|null|undefined} wear
 * @returns {{ mid: { image: string } }|null}
 */
export function bakedWorldBands(venueId, wear) {
  const spec = resolveCustomMap(wear);
  if (!spec || spec.renderer !== 'baked' || !venueId || wear === 'pixel-tycoon') return null;
  return { mid: { image: `/venues/${venueId}/display/${spec.id}.world.png` } };
}

export function customMapCamera(spec) {
  return spec?.camera || 'mercator';
}

/** Whether ParkMap still paints OSM ground under the custom drawing. */
export function showsBaseMap(spec) {
  if (!spec) return true;
  return spec.placement !== PLACEMENT_REPLACE;
}

/** Whether a named OSM layer is owned by the custom map (or the whole base is replaced). */
export function hidesBaseLayer(spec, layer) {
  if (!spec) return false;
  if (spec.placement === PLACEMENT_REPLACE) return true;
  return (spec.hideLayers || []).includes(layer);
}

/**
 * The baked world <image> rect in venue-local metres, for the renderer's
 * own scale(1,-1) group nested inside mapWorld's y-up scale(z,-z). The two
 * flips compose to screen y-down, so the rect pins the truth bounds'
 * north-west corner at its (x, y) top-left: x from the west edge,
 * y = -(north metres). Returns null when the bounds don't span (degenerate
 * or transposed sidecar) — the caller draws nothing rather than a wrongly
 * placed plate.
 */
export function worldImageRect(bounds, origin = [0, 0]) {
  if (!bounds) return null;
  const [x0, yN] = localMetres(bounds.north, bounds.west, origin);
  const [x1, yS] = localMetres(bounds.south, bounds.east, origin);
  if (![x0, x1, yN, yS].every(Number.isFinite) || x1 <= x0 || yN <= yS) return null;
  return { x: x0, y: -yN, width: x1 - x0, height: yN - yS };
}
