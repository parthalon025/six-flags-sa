/**
 * Scout quest seeds — gaps open sources cannot reliably fill.
 *
 * OpenStreetMap, official pages, and LLM research cover a lot of a park.
 * What they cannot settle — queue entrances you have to stand at, restrooms
 * the park moved this season, height signs that disagree with the website —
 * is exactly where gamification (living-map contributions) earns its keep:
 * real guests on the ground, peer-confirmed, then graduated into overlays and
 * eventually `data/venues/<id>/` via the builder.
 *
 * This module does not award XP or talk to a contribution API. It turns the
 * builder's existing ask/checklist gaps into structured Tier-1 / Tier-2 quest
 * seeds the Scout UI (backlog E9–E10) can schedule. Maintainers still get the
 * venues:ask brief; guests get missions when they are in the park.
 *
 * Design: docs/superpowers/specs/2026-08-10-gamified-map-contributions-design.md
 */

import { PUBLISH_AT, atLeast } from './evidence.mjs';
import { ambientSignalShipArtifacts } from './ambient-signal-seeds.mjs';

/** Builder ask key → contribution quest type (design taxonomy). */
export const REQUEST_TO_QUEST = {
  heights: {
    type: 'height_rule',
    tier: 2,
    graduation: 'overrides_heights',
    whyOpenSourceFails:
      'Height rules are park policy prose, not OSM geometry. Official pages help; signs on the day win.',
  },
  'missing-poi': {
    type: 'poi_presence',
    tier: 2,
    graduation: 'osm_or_overrides',
    whyOpenSourceFails:
      'OSM may be incomplete inside the fence; guest presence reports fill toilets, food, and gates.',
  },
  camping: {
    type: 'poi_attribute',
    tier: 2,
    graduation: 'overrides',
    whyOpenSourceFails:
      'Hookups and pad facts are operator catalogues — guests verify what is actually laid on.',
  },
  unmatched: {
    type: 'name_fix',
    tier: 2,
    graduation: 'overrides_alias',
    whyOpenSourceFails:
      'Park marketing names and OSM names drift; guests who read the sign settle aliases.',
  },
  credits: null, // maintainer / catalogue — not a guest quest
  locality: null, // build metadata — not a guest quest
};

/**
 * Turn venues:ask requests into Scout quest seeds.
 * @param {string} venueId
 * @param {Array} reqs from requests()
 * @returns {object[]}
 */
export function questSeedsFromRequests(venueId, reqs = []) {
  const seeds = [];
  for (const r of reqs) {
    const map = REQUEST_TO_QUEST[r.key];
    if (!map) continue;
    const targets = Array.isArray(r.targets) ? r.targets : [];
    if (targets.length) {
      for (const target of targets.slice(0, 40)) {
        seeds.push({
          venueId,
          type: map.type,
          tier: map.tier,
          graduation: map.graduation,
          sourceGap: r.key,
          target: typeof target === 'string' ? target : String(target),
          blocking: Boolean(r.blocking),
          whyOpenSourceFails: map.whyOpenSourceFails,
          need: r.need,
        });
      }
    } else {
      seeds.push({
        venueId,
        type: map.type,
        tier: map.tier,
        graduation: map.graduation,
        sourceGap: r.key,
        target: null,
        blocking: Boolean(r.blocking),
        whyOpenSourceFails: map.whyOpenSourceFails,
        need: r.need,
      });
    }
  }
  return seeds;
}

/**
 * Low-confidence / unpublished queue entrances need boots on the ground.
 * @param {string} venueId
 * @param {object} attractionsSidecar attractions.json
 */
export function questSeedsFromEntrances(venueId, attractionsSidecar) {
  const seeds = [];
  const list = attractionsSidecar?.attractions || [];
  for (const a of list) {
    const name = a.name || a.n;
    if (!name) continue;
    const placeKey = a.place || a.id || name;
    const feat = a.features?.queue_entrance;
    if (!feat) {
      seeds.push({
        venueId,
        type: 'geometry_nudge',
        tier: 2,
        graduation: 'attractions_evidence',
        sourceGap: 'entrance_missing',
        target: placeKey,
        blocking: false,
        whyOpenSourceFails:
          'Queue entrances are rarely tagged in OSM; guests standing in line are the reliable source.',
        need: 'Queue entrance position',
      });
      continue;
    }
    const band = feat.confidence || feat.band;
    if (!band || !atLeast(band, PUBLISH_AT)) {
      seeds.push({
        venueId,
        type: 'geometry_nudge',
        tier: 2,
        graduation: 'attractions_evidence',
        sourceGap: 'entrance_low_confidence',
        target: placeKey,
        blocking: false,
        whyOpenSourceFails:
          'Geometry inference and illustrated maps are approximate; peer-confirmed guest pins raise confidence.',
        need: 'Confirm queue entrance',
        evidenceBand: band || 'unknown',
      });
    }
  }
  return seeds.slice(0, 60);
}

/**
 * Ephemeral ops signals — always available as Tier-1 ambient quests once E9 ships.
 * Not derived from builder gaps; listed so the handoff doc and API share one catalogue.
 */
export const TIER1_AMBIENT = [
  { type: 'ride_status', tier: 1, graduation: 'overlay_ttl', need: 'Ride up / down / delayed' },
  { type: 'queue_band', tier: 1, graduation: 'overlay_ttl', need: 'Queue short / medium / long' },
  { type: 'amenity_outage', tier: 1, graduation: 'overlay_ttl', need: 'Restroom or fountain outage' },
  { type: 'crowd_hotspot', tier: 1, graduation: 'overlay_ttl', need: 'Midway crowded' },
  { type: 'hazard', tier: 1, graduation: 'overlay_ttl', need: 'Spill or blocked path' },
];

/**
 * Full seed list for a venue: durable gaps from ask + entrances, plus ambient Tier-1 catalogue.
 */
export function questSeedsForVenue({
  venueId,
  reqs = [],
  attractions = null,
  includeAmbient = true,
  signalSeeds = [],
} = {}) {
  const durable = [
    ...questSeedsFromRequests(venueId, reqs),
    ...questSeedsFromEntrances(venueId, attractions),
    ...signalSeeds,
  ];
  const ambient = includeAmbient
    ? TIER1_AMBIENT.map((a) => ({
      venueId,
      ...a,
      sourceGap: 'ambient_ops',
      target: null,
      blocking: false,
      whyOpenSourceFails:
        'Live ops change by the hour — open data cannot carry ride-down or crowd bands.',
    }))
    : [];
  return {
    version: 1,
    venueId,
    principle:
      'Open sources build the base map; gamified on-the-ground contributions fill what they cannot reliably settle.',
    durable,
    ambient,
    counts: { durable: durable.length, ambient: ambient.length },
  };
}
