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
 *   baked — the Visual factory's world image from this World's display pack
 *           (ADR-0016), drawn on truth bounds under the live overlay. The
 *           pack sidecar (<skin>.world.json) is authoritative for the
 *           world's projection; `world` here is the fallback declaration
 *           when a venue ships no sidecar. A baked Skin hides no base
 *           layers: the image covers them when it loads, and the base map
 *           stays whole when it cannot.
 *
 * `iso` used to be a second renderer here — a live SVG painter assembling
 * isoWorld meshes for pixel-tycoon, on its own camera. ADR-0019 clause 6
 * retired it from the map path: pixel-tycoon converts to top-down banded art
 * with the iso flavour painted into the sprites plus a camera preset
 * (`skinCameraPreset` in packages/shared/mapCamera.js). ADR-0021 reaffirms the
 * rejection of keeping a true-iso path for it — "if painted-iso plus a camera
 * preset cannot carry the feeling, the answers are a kit redesign or retiring
 * the Skin with compensation, not two renderers forever".
 *
 * So the vocabulary is closed rather than merely unused. `assertCustomMap`
 * refuses a declaration naming a renderer or camera that does not exist, which
 * is what stops the second renderer coming back as data with no code change to
 * notice it. isoWorld.js itself stays: the Visual factory's `--target iso` bake
 * is a separate artefact path, and this is the MAP path.
 */

import { localMetres } from './geo.js';

export const PLACEMENT_OVERLAY = 'overlay';
export const PLACEMENT_REPLACE = 'replace';

/** Renderers the map path has. One, since ADR-0019 clause 6. */
export const CUSTOM_MAP_RENDERERS = Object.freeze(['baked']);

/** Cameras a custom map may ask the renderer for. */
export const CUSTOM_MAP_CAMERAS = Object.freeze(['mercator']);

export const CUSTOM_MAPS = {
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

/**
 * Refuse a custom map declaring a renderer or camera the map path does not
 * have. Exported so the suite can hold the vocabulary itself, not only the
 * declarations that happen to use it today — a retirement that leaves the word
 * accepted is a retirement one data edit undoes.
 */
export function assertCustomMap(spec) {
  if (!spec) return spec;
  if (spec.renderer != null && !CUSTOM_MAP_RENDERERS.includes(spec.renderer)) {
    throw new Error(
      `custom map "${spec.id}" names renderer "${spec.renderer}"; the map path has `
        + `${CUSTOM_MAP_RENDERERS.join(', ')} (ADR-0019 clause 6 retired the iso painter)`,
    );
  }
  if (spec.camera != null && !CUSTOM_MAP_CAMERAS.includes(spec.camera)) {
    throw new Error(
      `custom map "${spec.id}" names camera "${spec.camera}"; the map path has `
        + `${CUSTOM_MAP_CAMERAS.join(', ')}. A Skin's camera FEEL is a preset `
        + '(skinCameraPreset in packages/shared/mapCamera.js), not a second projection',
    );
  }
  return spec;
}

/** Custom map attached to this Wear, or null for the OSM base alone. */
export function resolveCustomMap(wear) {
  if (!wear) return null;
  return assertCustomMap(CUSTOM_MAPS[wear] || null);
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
