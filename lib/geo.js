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

export function formatAge(ms) {
  const s = Math.round(ms / 1000);
  if (s < 15) return 'live';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
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

export const PARK_BOUNDS = {
  north: 39.348,
  south: 39.3365,
  east: -84.2595,
  west: -84.2775,
};

export const inPark = (lat, lng) =>
  lat < PARK_BOUNDS.north &&
  lat > PARK_BOUNDS.south &&
  lng < PARK_BOUNDS.east &&
  lng > PARK_BOUNDS.west;

export const PARK_CENTER = { lat: 39.3434, lng: -84.267 };
