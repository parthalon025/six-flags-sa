/**
 * Judgement helpers for venue research — name pairing, gap triage, sourcing hints.
 *
 * Nothing here publishes coordinates or writes overrides. It reads what is on
 * disk and suggests what a person (or an optional model) should look at next.
 */

import { normaliseRideName } from '@party-tracker/shared/mapSymbols.js';
import { osmGaps } from './venue-sources.mjs';
// Re-exported, not re-implemented: the name-matching primitive is a leaf so a
// caller can score two lists without inheriting this module's ledger reads (#29).
import { nameSimilarity, pairSuggestions } from './name-matching.mjs';
import { addressBook, resolveOverride } from './venue-ids.mjs';

export { nameSimilarity, pairSuggestions };

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
