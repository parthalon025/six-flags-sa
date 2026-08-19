// Distance, bearing, projection and formatting helpers.

const R = 6371000;
const rad = Math.PI / 180;

export function distance(aLat, aLng, bLat, bLng) {
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearing(aLat, aLng, bLat, bLng) {
  const y = Math.sin((bLng - aLng) * rad) * Math.cos(bLat * rad);
  const x =
    Math.cos(aLat * rad) * Math.sin(bLat * rad) -
    Math.sin(aLat * rad) * Math.cos(bLat * rad) * Math.cos((bLng - aLng) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const cardinal = (deg) => CARDINALS[Math.round(deg / 45) % 8];

export const metresToFeet = (m) => m * 3.28084;

export function formatDistance(m) {
  if (m == null || Number.isNaN(m)) return '—';
  const ft = metresToFeet(m);
  if (ft < 1000) return `${Math.round(ft / 5) * 5} ft`;
  return `${(ft / 5280).toFixed(2)} mi`;
}

// Crowded-park walking pace, not open-sidewalk pace.
export function formatWalk(m) {
  if (m == null) return '—';
  const secs = m / 1.15;
  return secs < 60 ? '<1 min' : `${Math.round(secs / 60)} min`;
}

/**
 * How long ago, in words. The one formatter — a screen that says "12m ago" in
 * one place and "12 min ago" in another is a screen that looks like two
 * different apps, and "12m" beside a column of distances reads as miles.
 */
export function formatAge(ms) {
  const s = Math.round(ms / 1000);
  if (s < 15) return 'just now';
  if (s < 60) return `${s} sec ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} hr ago`;
}

// --- Web Mercator, metres, used by the SVG map renderer -----------------
export function project(lat, lng) {
  const x = R * lng * rad;
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2));
  return [x, y];
}

export function unproject(x, y) {
  const lng = x / R / rad;
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / rad;
  return [lat, lng];
}

/**
 * Mercator metres for (lat, lng), rebased onto a local `origin` (itself a
 * `project()` result) — the venue-relative frame the SVG renderer builds its
 * paths in so float32 transforms stay precise at max zoom. ParkMap calls it
 * per-vertex (the rebase used to be inlined there); MapLibre never does — it
 * takes raw [lng, lat] and projects internally with the same Web Mercator
 * formula. That asymmetry is what makes this the reference implementation
 * the renderer-parity check measures both renderers against independently.
 */
export function localMetres(lat, lng, origin) {
  const [x, y] = project(lat, lng);
  const [ox, oy] = origin;
  return [x - ox, y - oy];
}

/* Where the park is no longer lives here. Bounds and centre belong to whichever
   venue is loaded, so they come from lib/venue/store.js — see withinBounds. */
