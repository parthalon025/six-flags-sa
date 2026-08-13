import { THEMES, CATEGORY_LABELS } from './theme.js';
import { ONTOLOGY } from './ontology.js';

/* Height labels, category colours, search. Eligibility itself lives in
   lib/eligibility.js — fromFacts(facts, places) — so this file is not a junk
   drawer for verdicts.

   Relative imports here carry an explicit .js so this module can be imported
   straight into plain Node for the unit suite, without a bundler resolving
   the extensionless form. */

export { THEMES, paletteFor, landTint } from './theme.js';
export { isRideable, isQueueable, isReportable, rideable } from './ontology.js';
export { categoriesFor, matchesQuery, matchedByName } from './search.js';

// Default (night) colours, kept for anything that renders outside the themed tree.
export const CATEGORIES = Object.fromEntries(
  Object.entries(ONTOLOGY.categories).map(([key, row]) => [
    key,
    { label: row.label || CATEGORY_LABELS[key], color: THEMES.night.categories[key] },
  ]),
);

/** One uniform three-state on every height dimension. */
const normDim = (v) => {
  if (v === 'none') return 'none';
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const normHeight = (h) => {
  if (!h) return null;
  return {
    min: normDim(h.min),
    alone: normDim(h.alone),
    max: normDim(h.max),
    advisory: normDim(h.advisory),
    note: h.note || null,
  };
};

export function heightLabel(ride) {
  const h = normHeight(ride.h);
  if (!h) return 'Check at the ride';
  const bits = [];
  if (h.min === 'none') bits.push('No minimum');
  else if (h.min != null && h.min > 0) bits.push(`${h.min}" min`);
  else bits.push('No minimum');
  if (h.alone != null && h.alone !== 'none') bits.push(`${h.alone}" to ride alone`);
  if (h.max != null && h.max !== 'none') bits.push(`${h.max}" max`);
  if (h.advisory != null && h.advisory !== 'none') bits.push(`Built for under ${h.advisory}"`);
  return bits.join(' · ');
}

/** Whether this venue has any height rules at all — the filter hides if not. */
export const hasHeights = (pois) => pois.some((p) => p.h);

// The thresholds that actually change what a family can do.
export const HEIGHT_TIERS = [36, 38, 40, 42, 44, 46, 48, 52, 54];
