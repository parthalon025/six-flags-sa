import raw from './rides.json';
import { THEMES, CATEGORY_LABELS } from './theme';

/*
 * rides.json is a flat list of POIs whose only stable field is the name, and
 * names are not unique (a park has ten "Restrooms"). Anything that has to
 * *address* one — a ride report on the wire, a favourite, a target — needs an
 * id, so it is slugged here, once, and both the browser and the API read it
 * from this module. A repeat gets a numeric suffix in file order, which is
 * stable as long as rides.json is only appended to.
 */
const slug = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const seen = new Map();

export const POIS = raw.map((poi) => {
  const base = slug(poi.n) || 'poi';
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return { id: n === 1 ? base : `${base}-${n}`, ...poi };
});

export const POI_BY_ID = new Map(POIS.map((p) => [p.id, p]));

export const RIDES = POIS.filter((p) => p.c === 'coaster' || p.c === 'ride');

/**
 * The middle of the park, for the one question that needs a single coordinate:
 * what the weather is doing here. The median rather than the mean, because a
 * park-and-ride lot two miles down the road should not drag the centre out of
 * the gates — and because it makes this work for any park's data unchanged.
 */
export const PARK_CENTER = (() => {
  const mid = (values) => {
    const s = [...values].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };
  const inside = POIS.filter((p) => p.c !== 'parking');
  const pool = inside.length ? inside : POIS;
  return { lat: mid(pool.map((p) => p.lat)), lng: mid(pool.map((p) => p.lng)) };
})();

export { THEMES, paletteFor } from './theme';

// Default (night) colours, kept for anything that renders outside the themed tree.
export const CATEGORIES = Object.fromEntries(
  Object.entries(CATEGORY_LABELS).map(([key, label]) => [
    key,
    { label, color: THEMES.night.categories[key] },
  ]),
);

export const LANDS = THEMES.night.lands;

export const LAND_ORDER = Object.keys(LANDS);

/**
 * Height eligibility.
 * @param ride     a POI record
 * @param inches   rider height, or null when no filter is active
 * @param withAdult whether a supervising companion is present
 * @returns 'yes' | 'companion' | 'no' | 'toobig' | 'unknown'
 */
export function eligibility(ride, inches, withAdult) {
  const h = ride.h;
  if (!h) return 'unknown';
  if (inches == null) return 'unknown';
  const { min, alone, max } = h;
  if (max != null && inches > max) return 'toobig';
  if (min != null && inches < min) return 'no';
  if (alone != null && inches < alone) return withAdult ? 'companion' : 'no';
  return 'yes';
}

export function heightLabel(ride) {
  const h = ride.h;
  if (!h) return 'Check at the ride';
  const bits = [];
  if (h.min != null && h.min > 0) bits.push(`${h.min}" min`);
  else bits.push('No minimum');
  if (h.alone != null) bits.push(`${h.alone}" to ride alone`);
  if (h.max != null) bits.push(`${h.max}" max`);
  return bits.join(' · ');
}

// The thresholds that actually change what a family can do.
export const HEIGHT_TIERS = [36, 38, 40, 42, 44, 46, 48, 52, 54];
