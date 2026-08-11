/**
 * Maps venue IDs to third-party park slugs / API identifiers.
 * Extend when onboarding new parks.
 */

/** @type {Record<string, string>} queue-times.com park slug */
export const QUEUE_TIMES_SLUGS = {
  'kings-island': 'kings-island',
  'cedar-point': 'cedar-point',
  'six-flags-fiesta-texas': 'six-flags-fiesta-texas',
  'six-flags-magic-mountain': 'six-flags-magic-mountain',
  'six-flags-america': 'six-flags-america',
};

/** @type {Record<string, string>} RopeDrop open-data park slug (Disney parks) */
export const ROPEDROP_SLUGS = {
  // Disney/Universal only — shipped Cedar Fair / SF / waterpark venues declare
  // gaps.adapters.ropedrop in sources.json instead of a silent no-op.
};

/** Wikidata Q-ids for shipped venues (manual curation). */
export const WIKIDATA_QIDS = {
  'cedar-point': 'Q859230',
  'kings-island': 'Q1765802',
  'six-flags-fiesta-texas': 'Q2521644',
  'big-kahunas': 'Q4905920',
  'six-flags-magic-mountain': 'Q1193015',
  'six-flags-america': 'Q7565147',
};
