/**
 * Thin Gaps the phone may fetch — one fact per row, invented here once.
 *
 * Builder ask seeds and low-confidence queue evidence stay in certification
 * sidecars. This module is the seam that ships what guests can settle:
 * height, queue, restroom, food, gate, camping. Credits, aliases, locality,
 * and live ops never go in `*.gaps.json`.
 *
 * Does not import venue-io (venue-io calls this after reading sidecars).
 */

export const SHIPPED_GAP_TYPES = Object.freeze([
  'height',
  'queue',
  'restroom',
  'food',
  'gate',
  'camping',
]);

const TYPE_RANK = Object.fromEntries(SHIPPED_GAP_TYPES.map((t, i) => [t, i]));

const DROP_SEED_TYPES = new Set(['name_fix']);

/**
 * Map a builder seed onto a shipped Gap type, or null to drop it.
 * @param {object} seed
 * @returns {string | null}
 */
export function shippedTypeForSeed(seed) {
  if (!seed) return null;
  if (DROP_SEED_TYPES.has(seed.type)) return null;
  if (seed.sourceGap === 'credits' || seed.sourceGap === 'locality') return null;
  if (seed.sourceGap === 'ambient_ops') return null;
  if (seed.type === 'height_rule' || seed.sourceGap === 'heights') return 'height';
  if (seed.type === 'geometry_nudge' || seed.sourceGap === 'entrance_missing' || seed.sourceGap === 'entrance_low_confidence') {
    return 'queue';
  }
  if (seed.sourceGap === 'camping' || seed.type === 'poi_attribute') return 'camping';
  if (seed.type === 'poi_presence' || seed.sourceGap === 'missing-poi') {
    return presenceTypeFromSeed(seed);
  }
  return null;
}

function presenceTypeFromSeed(seed) {
  const from = (blob) => {
    if (/\btoilet|\brestroom/.test(blob)) return 'restroom';
    if (/\bfood|\beat\b/.test(blob)) return 'food';
    if (/\bgate\b|\bway in\b/.test(blob)) return 'gate';
    return null;
  };
  return from(String(seed.target || '').toLowerCase()) || from(String(seed.need || '').toLowerCase());
}

/**
 * Resolve a seed target to Place key(s) `i`. Missing Place / camping stay null.
 * @param {object[]} pois
 * @param {string | null} target
 * @returns {(string | null)[]}
 */
export function resolveGapTargets(pois, target) {
  if (target == null || target === '') return [null];
  const list = Array.isArray(pois) ? pois : [];
  const byKey = list.filter((p) => p && (p.i === target || p.id === target));
  if (byKey.length) return [...new Set(byKey.map((p) => p.i || p.id).filter(Boolean))];
  const byName = list.filter((p) => p && p.n === target);
  const keys = [...new Set(byName.map((p) => p.i || p.id).filter(Boolean))];
  return keys.length ? keys : [];
}

/**
 * Atomic Gaps the phone ranks. One row per fact.
 *
 * @param {{ venueId: string, seeds?: object[], pois?: object[] }} opts
 * @returns {{ version: number, venue: string, gaps: { type: string, target: string | null }[] }}
 */
export function shippedGapsDocument({ venueId, seeds = [], pois = [] } = {}) {
  const seen = new Set();
  const gaps = [];
  for (const seed of seeds) {
    const type = shippedTypeForSeed(seed);
    if (!type) continue;
    const needsPlace = type === 'height' || type === 'queue';
    const resolved = needsPlace ? resolveGapTargets(pois, seed.target) : [null];
    for (const target of resolved) {
      if (needsPlace && !target) continue;
      const key = `${type}:${target ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      gaps.push({ type, target: target ?? null });
    }
  }
  gaps.sort((a, b) => {
    const tr = (TYPE_RANK[a.type] ?? 99) - (TYPE_RANK[b.type] ?? 99);
    if (tr) return tr;
    return String(a.target || '').localeCompare(String(b.target || ''));
  });
  return {
    version: 1,
    venue: venueId || null,
    gaps,
  };
}
