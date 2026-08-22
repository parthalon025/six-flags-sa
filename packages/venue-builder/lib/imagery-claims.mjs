/**
 * Train I — extraction lanes and the claims / Gap / truth wall.
 *
 * ADR-0020 clauses 3 and 5: imagery may add what OSM lacks and, where it
 * contradicts OSM, raise a Gap. It never silently moves geometry.
 *
 * Three lanes, one router:
 *   deterministic — may write truth only when the pass is CI-proven identical
 *   model         — evidence claims only
 *   agent         — evidence claims only
 */

import { metresToWalkable } from './ship-gaps.mjs';

export const EXTRACTION_LANES = Object.freeze(['deterministic', 'model', 'agent']);

export const WRITE_MODES = Object.freeze(['truth', 'claim', 'gap']);

/** Metres of centreline disagreement that count as a dispute, not noise. */
export const DISPUTE_TOLERANCE_M = 8;

/** Empty until a pass proves byte-identical across consecutive CI runs.
 *  A frozen array, not a Set: Set#add still mutates after Object.freeze. */
export const CI_PROVEN_PASSES = Object.freeze([]);

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** Factory ways use `{ r: [[lng,lat],…] }`; GeoJSON fixtures use coordinates. */
export function osmPathMap(map) {
  const ways = [];
  for (const feat of [...(map?.path || []), ...(map?.layers?.path || [])]) {
    const ring = feat?.r || feat?.geometry?.coordinates || feat?.c;
    if (Array.isArray(ring) && ring.length) ways.push({ r: ring });
  }
  return { path: ways };
}

/**
 * Compare one extraction against OSM truth already in the build.
 * Distance is point-to-segment on walkable rings, not vertex haversine.
 * @returns {{ relation: 'adds'|'agrees'|'disputes'|'outside', deltaM?: number }}
 */
export function compareToOsm(extraction, { map, toleranceM = DISPUTE_TOLERANCE_M } = {}) {
  const at = extraction?.at;
  if (!at || !finite(at.lat) || !finite(at.lng)) {
    return { relation: 'outside' };
  }
  const d = metresToWalkable(osmPathMap(map), at.lat, at.lng);
  if (d == null || !Number.isFinite(d) || d === Infinity) {
    return { relation: 'adds' };
  }
  if (d <= toleranceM) return { relation: 'agrees', deltaM: d };
  if (d > toleranceM * 4) return { relation: 'adds', deltaM: d };
  return { relation: 'disputes', deltaM: d };
}

function writeModeFor(extraction, relation) {
  const lane = extraction.lane;
  const proven = lane === 'deterministic'
    && extraction.deterministic === true
    && CI_PROVEN_PASSES.includes(extraction.passId);
  if (relation === 'disputes') return 'gap';
  if (relation === 'agrees') return 'claim';
  if (relation === 'adds' && proven) return 'truth';
  return 'claim';
}

/**
 * Route extractions under OSM-canonical rules.
 * @returns {{ truth: object[], claims: object[], gaps: object[] }}
 */
export function routeImageryExtractions(extractions, ctx = {}) {
  const truth = [];
  const claims = [];
  const gaps = [];
  for (const extraction of extractions || []) {
    const comparison = compareToOsm(extraction, ctx);
    const writeMode = writeModeFor(extraction, comparison.relation);
    const row = { ...extraction, comparison, writeMode };
    if (writeMode === 'truth') truth.push(row);
    else if (writeMode === 'gap') {
      gaps.push({
        type: 'path_disputed',
        target: null,
        note: 'path position disputed',
        extraction: row,
      });
      claims.push({ ...row, dissent: true });
    } else claims.push(row);
  }
  return { truth, claims, gaps };
}

/**
 * Run configured extraction passes and route the results.
 * Passes are injected so a test can exercise the wall without a raster.
 */
export function runImageryClaims(venueId, {
  map,
  extractions = [],
  toleranceM = DISPUTE_TOLERANCE_M,
} = {}) {
  return {
    venue: venueId,
    ...routeImageryExtractions(extractions, { map, toleranceM }),
  };
}
