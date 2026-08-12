import { THEMES, CATEGORY_LABELS } from './theme.js';
import { ONTOLOGY } from './ontology.js';

/* Height rules, category colours and the eligibility question. The places
   themselves belong to whichever venue is loaded — see lib/venue/store.js.

   Relative imports here carry an explicit .js so this module — and the
   eligibility logic in particular — can be imported straight into plain Node
   for the unit suite, without a bundler resolving the extensionless form. */

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

/**
 * Height eligibility.
 *
 * @returns 'yes' | 'companion' | 'no' | 'toobig' | 'advisory' | 'unknown'
 */
export function eligibility(ride, inches, withAdult) {
  const h = normHeight(ride.h);
  if (!h) return 'unknown';
  if (inches == null) return 'unknown';
  const { min, alone, max, advisory } = h;
  if (max != null && max !== 'none' && inches > max) return 'toobig';
  if (min != null && min !== 'none' && inches < min) return 'no';
  if (alone != null && alone !== 'none' && inches < alone) return withAdult ? 'companion' : 'no';
  if (advisory != null && advisory !== 'none' && inches > advisory) return 'advisory';
  return 'yes';
}

/** Structured verdict codes for eligibilityWithReasons — a fixed vocabulary a
 *  UI can style once, instead of switching on eligibility()'s raw strings. */
export const VERDICT_ELIGIBLE = 'ELIGIBLE';
export const VERDICT_COMPANION = 'COMPANION';
export const VERDICT_NOT = 'NOT';
export const VERDICT_ADVISORY = 'ADVISORY';
export const VERDICT_UNKNOWN = 'UNKNOWN';

const RAW_TO_VERDICT = {
  yes: VERDICT_ELIGIBLE,
  companion: VERDICT_COMPANION,
  no: VERDICT_NOT,
  toobig: VERDICT_NOT,
  advisory: VERDICT_ADVISORY,
  unknown: VERDICT_UNKNOWN,
};

/**
 * eligibility(), plus a fixed verdict code and at least one plain-language
 * reason citing the actual min/alone/max inches on the rule — what a parent
 * standing at the ride wants to read, not a status string.
 *
 * Kept as an addition rather than a replacement: eligibility() still returns
 * the raw string every existing caller already switches on.
 *
 * @returns {{ verdict: string, raw: string, reasons: string[] }}
 */
export function eligibilityWithReasons(ride, inches, withAdult) {
  const raw = eligibility(ride, inches, withAdult);
  const verdict = RAW_TO_VERDICT[raw] || VERDICT_UNKNOWN;
  const h = normHeight(ride.h);

  if (!h) return { verdict, raw, reasons: ['No height rule published for this ride yet.'] };
  if (inches == null) return { verdict, raw, reasons: ['Set a rider height to check this ride.'] };

  const { min, alone, max, advisory } = h;
  const reasons = [];

  switch (raw) {
    case 'toobig':
      reasons.push(`Riders must be ${max}" or under to ride — this rider is over the max.`);
      break;
    case 'no':
      if (min != null && min !== 'none' && inches < min) {
        reasons.push(`Riders must be at least ${min}" tall to ride — this rider is under the min.`);
      } else if (alone != null && alone !== 'none' && inches < alone) {
        reasons.push(`Under ${alone}" needs an adult riding along, and none is assumed here.`);
      } else {
        reasons.push('This rider does not meet the height rule for this ride.');
      }
      break;
    case 'companion':
      reasons.push(`Under ${alone}" rides with an adult — this rider qualifies with one along.`);
      break;
    case 'advisory':
      reasons.push(`Built for riders under ${advisory}" — check with staff before riding.`);
      break;
    case 'yes':
    default:
      if (min != null && min !== 'none' && min > 0) reasons.push(`Meets the ${min}" minimum to ride.`);
      else reasons.push('No minimum height to ride.');
      if (alone != null && alone !== 'none' && inches >= alone) {
        reasons.push(`Tall enough to ride alone at ${alone}".`);
      }
      break;
  }

  return { verdict, raw, reasons };
}

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
