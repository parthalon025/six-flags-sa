/**
 * Venue POI record shape — the fields the builder may publish and the app may read.
 */

const REQUIRED = ['n', 'lat', 'lng', 'c'];

/** Optional keys on a published place row. Unknown keys are rejected. */
export const POI_OPTIONAL_KEYS = [
  'i',
  'h',
  'tel',
  'oh',
  'camp',
  'a',
  'note',
  'e',
  'out',
  'osm',
];

const OPTIONAL = new Set(POI_OPTIONAL_KEYS);

/**
 * @param {unknown} poi
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validatePoi(poi) {
  const errors = [];
  if (!poi || typeof poi !== 'object') return { ok: false, errors: ['poi must be an object'] };

  for (const key of REQUIRED) {
    if (poi[key] == null || poi[key] === '') errors.push(`missing ${key}`);
  }
  if (poi.c != null && typeof poi.c !== 'string') errors.push('c must be a string');
  if (poi.lat != null && !Number.isFinite(poi.lat)) errors.push('lat must be a number');
  if (poi.lng != null && !Number.isFinite(poi.lng)) errors.push('lng must be a number');

  if (poi.oh != null && typeof poi.oh !== 'string') errors.push('oh must be a string');
  if (poi.tel != null && typeof poi.tel !== 'string') errors.push('tel must be a string');

  for (const key of Object.keys(poi)) {
    if (!REQUIRED.includes(key) && !OPTIONAL.has(key)) errors.push(`unknown field "${key}"`);
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}
