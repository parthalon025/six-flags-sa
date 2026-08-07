import raw from './rides.json';
import { THEMES, CATEGORY_LABELS } from './theme';

export const POIS = raw;

export const RIDES = raw.filter((p) => p.c === 'coaster' || p.c === 'ride');

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
