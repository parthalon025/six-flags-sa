import { THEMES, CATEGORY_LABELS } from './theme';

/* Height rules, category colours and the eligibility question. The places
   themselves belong to whichever venue is loaded — see lib/venue/store.js. */

export { THEMES, paletteFor, landTint } from './theme';

// Default (night) colours, kept for anything that renders outside the themed tree.
export const CATEGORIES = Object.fromEntries(
  Object.entries(CATEGORY_LABELS).map(([key, label]) => [
    key,
    { label, color: THEMES.night.categories[key] },
  ]),
);

/**
 * Height eligibility.
 *
 * Only amusement parks carry height rules, and only some of their places do.
 * Everywhere else every POI answers 'unknown', which the panels read as "no
 * filter applies here" — so a campus or a zoo simply never shows the slider.
 *
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

/** Whether this venue has any height rules at all — the filter hides if not. */
export const hasHeights = (pois) => pois.some((p) => p.h);

// The thresholds that actually change what a family can do.
export const HEIGHT_TIERS = [36, 38, 40, 42, 44, 46, 48, 52, 54];
