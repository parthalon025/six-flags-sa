/**
 * Names that are not rides — height-chart headers, arcades, etc.
 * Applied during override pass so rebuilds stay honest without hand-editing
 * public/venues. Venue overrides.drop still wins for one-off names.
 */

/** Exact display names that must never ship as Rideable. */
export const NEVER_RIDE_NAMES = new Set([
  'Age or Weight',
  'Arcade',
  'Arcade Games',
  'Main Arcade',
  'Schi-Kugel Arcade',
]);

/** Case-insensitive substrings that mark amenity / chart noise as non-rideable. */
export const NEVER_RIDE_PATTERNS = [
  /^age\s*or\s*weight$/i,
  /\barcade\b/i,
];

/**
 * @param {{ n?: string, c?: string }} poi
 * @returns {boolean}
 */
export function looksLikeFalseRide(poi) {
  const name = String(poi?.n || '').trim();
  if (!name) return false;
  if (!(poi.c === 'ride' || poi.c === 'coaster')) return false;
  if (NEVER_RIDE_NAMES.has(name)) return true;
  return NEVER_RIDE_PATTERNS.some((re) => re.test(name));
}

/**
 * Drop chart-header noise; reclassify arcades and similar as `service`.
 * @param {object[]} pois
 * @returns {{ pois: object[], dropped: string[], reclassified: string[] }}
 */
export function scrubFalseRides(pois) {
  const dropped = [];
  const reclassified = [];
  const next = [];
  for (const p of pois) {
    if (!looksLikeFalseRide(p)) {
      next.push(p);
      continue;
    }
    const name = String(p.n || '').trim();
    if (/^age\s*or\s*weight$/i.test(name)) {
      dropped.push(name);
      continue;
    }
    // Arcades and similar stay on the map as services, not rides.
    next.push({ ...p, c: 'service', h: undefined });
    reclassified.push(name);
  }
  return { pois: next, dropped, reclassified };
}
