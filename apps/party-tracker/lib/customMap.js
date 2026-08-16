/**
 * Custom map — extra drawing that replaces or overlays the OSM base.
 *
 * Not Overlay (contributions). Not Skin (paint). A Skin may attach one.
 * Places stay on their lat/lng; this module only decides how the ground is drawn.
 *
 * placement:
 *   overlay — draw on the OSM base (minus hideLayers)
 *   replace — hide the OSM base; the custom drawing is the map
 */

export const PLACEMENT_OVERLAY = 'overlay';
export const PLACEMENT_REPLACE = 'replace';

const CUSTOM_MAPS = {
  'pixel-tycoon': {
    id: 'pixel-tycoon',
    placement: PLACEMENT_OVERLAY,
    camera: 'iso',
    renderer: 'iso',
    template: 'rct-classic',
    hideLayers: ['building', 'coaster'],
  },
};

/** Custom map attached to this Wear, or null for the OSM base alone. */
export function resolveCustomMap(wear) {
  if (!wear) return null;
  return CUSTOM_MAPS[wear] || null;
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
