/**
 * Judgement helpers for venue research — name pairing, gap triage, sourcing hints.
 *
 * Nothing here publishes coordinates or writes overrides. It reads what is on
 * disk and suggests what a person (or an optional model) should look at next.
 */

import { normaliseRideName } from '@party-tracker/shared/mapSymbols.js';
import { osmGaps } from './venue-sources.mjs';
import { addressBook, resolveOverride } from './venue-ids.mjs';

const WORD = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Edit distance without pulling in a dependency. */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[n];
}

/**
 * How alike two attraction names read, 0–1.
 *
 * Uses the same normalisation the builder joins on, then token overlap and
 * character distance as a tie-breaker for near-misses like "Tiki River Run"
 * versus "Tiki River Run (Right Slide)".
 */
export function nameSimilarity(a, b) {
  const na = normaliseRideName(a);
  const nb = normaliseRideName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.92;

  const wa = new Set(WORD(na));
  const wb = new Set(WORD(nb));
  const union = new Set([...wa, ...wb]);
  const inter = [...wa].filter((w) => wb.has(w)).length;
  const jaccard = union.size ? inter / union.size : 0;

  const maxLen = Math.max(na.length, nb.length);
  const edit = 1 - levenshtein(na, nb) / maxLen;
  return Math.max(jaccard * 0.85, edit * 0.75);
}

/**
 * Best name pairings between two lists, above a floor.
 *
 * @returns {{ left, right, score }[]} sorted strongest first, one right per left
 */
export function pairSuggestions(left, right, { floor = 0.55, limit = 12 } = {}) {
  const scored = [];
  for (const l of left) {
    for (const r of right) {
      const score = nameSimilarity(l, r);
      if (score >= floor) scored.push({ left: l, right: r, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const usedRight = new Set();
  const out = [];
  for (const row of scored) {
    if (usedRight.has(row.right)) continue;
    usedRight.add(row.right);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/** Every name the bundle currently carries. */
export function bundleNames(pois = []) {
  return [...new Set(pois.map((p) => p.n).filter(Boolean))].sort();
}

/** Named OSM track with no matching place yet. */
export function trackNames(layers = {}) {
  const out = [];
  for (const layer of ['coaster', 'slide']) {
    for (const way of layers[layer] || []) {
      const n = way.n?.trim();
      if (n) out.push(n);
    }
  }
  return [...new Set(out)].sort();
}

/**
 * Overrides and `_unmapped` keys that do not land on a place.
 *
 * Mirrors venue-requests' matching so suggestions line up with the brief.
 */
export function strayOverrideKeys(pois, overrides) {
  if (!overrides) return { pois: [], unmapped: Object.keys(overrides?._unmapped || {}).sort() };
  const book = addressBook(pois);
  const poisKeys = Object.entries(overrides.pois || {})
    .filter(([name, patch]) => !resolveOverride(book, name, patch))
    .map(([name]) => name)
    .sort();
  const unmapped = Object.keys(overrides._unmapped || {}).sort();
  return { pois: poisKeys, unmapped };
}

/**
 * Judgement items a researcher should look at before editing overrides.
 */
export function judgements({ pois = [], layers = {}, overrides = null } = {}) {
  const out = [];
  const names = bundleNames(pois);
  const tracks = trackNames(layers);
  const gaps = osmGaps({ pois, layers });
  const stray = strayOverrideKeys(pois, overrides);

  if (gaps.missingRides.length) {
    const pairs = pairSuggestions(gaps.missingRides, names, { floor: 0.6 });
    out.push({
      key: 'osm-gap-rides',
      need: 'Named track with no place',
      count: gaps.missingRides.length,
      targets: gaps.missingRides,
      hints: pairs.length
        ? pairs.map((p) => `"${p.left}" may be the same as "${p.right}" (${Math.round(p.score * 100)}%)`)
        : ['Survey positions from orthophoto into an imagery GeoJSON, or add overrides once named on the map.'],
    });
  }

  if (stray.pois.length) {
    const pairs = pairSuggestions(stray.pois, names, { floor: 0.5 });
    out.push({
      key: 'unmatched-overrides',
      need: 'Override keys that match no place',
      count: stray.pois.length,
      targets: stray.pois,
      hints: pairs.map((p) => `Key "${p.left}" → try alias "${p.right}" (${Math.round(p.score * 100)}%)`),
    });
  }

  if (stray.unmapped.length) {
    const pairs = pairSuggestions(stray.unmapped, [...names, ...tracks], { floor: 0.45 });
    out.push({
      key: 'unmapped-heights',
      need: 'Height rules waiting for a place name',
      count: stray.unmapped.length,
      targets: stray.unmapped,
      hints: pairs.map((p) => `"${p.left}" may belong on "${p.right}" when OSM names it (${Math.round(p.score * 100)}%)`),
    });
  }

  /* Two bundle places that normalise the same — often a duplicate queue node. */
  const byNorm = new Map();
  for (const p of pois) {
    const k = normaliseRideName(p.n);
    if (!k) continue;
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k).push(p.n);
  }
  const dupes = [...byNorm.values()].filter((g) => g.length > 1);
  if (dupes.length) {
    out.push({
      key: 'duplicate-normalised',
      need: 'Places that read as the same ride',
      count: dupes.length,
      targets: dupes.map((g) => g.join(' / ')),
      hints: ['Usually one is the ride and one is its queue entrance — heights need only one entry with an alias if names differ.'],
    });
  }

  return out;
}

/** Which source kinds from the catalogue apply to each gap type. */
export const SOURCE_FOR = {
  paths: ['aerial_imagery', 'official_map', 'traced'],
  rides: ['aerial_imagery', 'official_map', 'official_site'],
  heights: ['official_site', 'official_map'],
  pois: ['official_map', 'aerial_imagery', 'openstreetmap'],
  entrances: ['official_map', 'aerial_imagery', 'openstreetmap'],
};

/**
 * What additional sourcing would help, given the catalogue on disk.
 */
export function sourcingPlan({
  catalog = null,
  pois = [],
  layers = {},
  requests = [],
  judgements: judgeItems = [],
} = {}) {
  const have = new Set((catalog?.sources || []).map((s) => s.kind));
  const gaps = osmGaps({ pois, layers });
  const needs = [];

  if (gaps.missingRides.length) {
    needs.push({
      gap: 'rides-without-places',
      count: gaps.missingRides.length,
      wants: SOURCE_FOR.rides.filter((k) => !have.has(k)),
      have: SOURCE_FOR.rides.filter((k) => have.has(k)),
      datasets: catalog?.datasets?.imagery?.length ? ['imagery'] : [],
    });
  }

  const missingPoi = requests.find((r) => r.key === 'missing-poi');
  if (missingPoi) {
    needs.push({
      gap: 'visitor-essentials',
      count: missingPoi.targets?.length || 0,
      wants: SOURCE_FOR.pois.filter((k) => !have.has(k)),
      have: SOURCE_FOR.pois.filter((k) => have.has(k)),
      datasets: [
        ...(catalog?.datasets?.imagery?.length ? ['imagery'] : []),
        ...(catalog?.datasets?.merge?.length ? ['merge'] : []),
        ...(catalog?.datasets?.trace?.length ? ['trace'] : []),
      ],
    });
  }

  if (requests.some((r) => r.key === 'heights')) {
    needs.push({
      gap: 'ride-heights',
      wants: SOURCE_FOR.heights.filter((k) => !have.has(k)),
      have: SOURCE_FOR.heights.filter((k) => have.has(k)),
    });
  }

  if (judgeItems.some((j) => j.key === 'osm-gap-rides') && !catalog?.datasets?.imagery?.length) {
    needs.push({
      gap: 'imagery-dataset',
      wants: ['aerial_imagery'],
      have: have.has('aerial_imagery') ? ['aerial_imagery'] : [],
      note: 'Catalogue lists aerial imagery but no imagery GeoJSON is wired in datasets.imagery.',
    });
  }

  return {
    catalogued: [...have],
    sources: catalog?.sources || [],
    needs,
  };
}
