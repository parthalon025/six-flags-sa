/**
 * The master list: one record per ride, with every feature it has and where each
 * claim came from.
 *
 * A place in the venue bundle is one point, and a ride is not one point. It has
 * a queue that starts somewhere, a station, and an exit that puts you somewhere
 * else entirely — and for a park-navigation app the queue entrance and the exit
 * are the two that anybody actually walks to. "Where is Orion" is not the
 * question; "how do I get into Orion, and where will I come out" is.
 *
 * So this file is the layer between "OpenStreetMap has a point for Orion" and
 * "the app routes you to the back of Orion's queue". It holds, per ride, per
 * feature: the coordinate, the sources behind it, the fused confidence, and the
 * dates — because a park moves a queue between seasons and an expired coordinate
 * and a wrong one look identical in a file that stores only numbers.
 *
 * It is deliberately *beside* the venue bundle rather than inside it. The bundle
 * is generated and overwritten by every rebuild; this is the accumulated
 * evidence, which is the expensive part and must survive one. Only the features
 * that clear the confidence bar are copied into the bundle, where the app can
 * see them.
 */

import { atLeast, fuse, pointOf, PUBLISH_AT, staleness } from './evidence.mjs';

export const SCHEMA_VERSION = 1;

/**
 * The features a ride has, in the order somebody walks them.
 *
 * The distinction that park maps routinely blur, and that matters most here, is
 * between the queue entrance and the ride entrance. A park map prints one arrow
 * and calls it the entrance; on the ground the queue entrance is out on the
 * midway and the ride entrance is at the far end of forty metres of switchback.
 * For navigation the first is the one you want, and for "how long until we are
 * on it" the second is. They are different places and are stored as such.
 */
export const FEATURES = [
  'queue_entrance',
  'queue_path',
  'ride_entrance',
  'station',
  'unload',
  'ride_exit',
  'queue_exit',
];

/** The two the app actually walks people to, and what they become in the bundle. */
export const PUBLISHED = { queue_entrance: 'in', ride_exit: 'out' };

const blank = () => ({ at: null, confidence: 'unknown', score: 0, sources: [], evidence: [] });

/** A record for a ride that has none yet. */
export function attractionFor(poi, venueId) {
  return {
    id: `${venueId}-${String(poi.n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    name: poi.n,
    venue: venueId,
    type: poi.c === 'coaster' ? 'roller_coaster' : 'attraction',
    /* Where OpenStreetMap puts the ride itself, kept so a record can be matched
       back to its place after a rebuild has moved it a metre. Not a feature:
       nobody walks to the middle of a ride. */
    at: { lat: poi.lat, lng: poi.lng },
    features: Object.fromEntries(FEATURES.map((f) => [f, blank()])),
    last_verified: null,
  };
}

/**
 * Fold new evidence into a record, and re-fuse whatever it now knows.
 *
 * Evidence accumulates rather than replacing: the point of keeping this file
 * beside the bundle is that a claim made in March is still on the record in
 * August, and can be seen to disagree with a newer one. A source is only ever
 * superseded by a newer claim *from that same source* — a park that redraws its
 * map has changed its mind, and that is exactly what should overwrite; a forum
 * post does not get to overwrite the park.
 */
export function addEvidence(record, feature, claim, { asOf } = {}) {
  const slot = record.features[feature];
  if (!slot) throw new Error(`No such feature "${feature}". One of: ${FEATURES.join(', ')}.`);

  const next = slot.evidence.filter((e) => e.source !== claim.source);
  next.push({
    source: claim.source,
    at: claim.at ? { lat: claim.at.lat, lng: claim.at.lng } : null,
    date: claim.date || asOf || null,
    note: claim.why || claim.note || null,
  });

  slot.evidence = next.sort((a, b) => String(a.source).localeCompare(String(b.source)));
  return refuse(record, feature, asOf);
}

/** Re-derive a feature's point, score and dates from its evidence. */
export function refuse(record, feature, asOf) {
  const slot = record.features[feature];
  const fused = fuse(slot.evidence);
  const where = pointOf(slot.evidence);
  const age = staleness(slot.evidence, asOf || new Date().toISOString().slice(0, 10));

  slot.at = where ? { lat: where.lat, lng: where.lng } : null;
  slot.from = where?.from || null;
  slot.score = fused.score;
  slot.confidence = fused.band;
  slot.sources = fused.sources;
  slot.spread_m = fused.spread;
  /* Sources that put the feature somewhere else. Recorded rather than averaged
     in: a point between two claims is a point neither of them supports. A
     lighter source dissenting is a note; one of equal standing dissenting is a
     conflict, and a conflict is never published. */
  slot.dissent = fused.dissent;
  slot.conflict = fused.conflict;
  slot.newest_evidence = age.newest;
  slot.stale = age.stale;
  return slot;
}

/**
 * The features that have earned their way into the bundle the app reads.
 *
 * The bar is deliberately above what geometry alone can reach. Every ride in
 * every park can be given a plausible entrance by looking at the path network,
 * and if that were enough to publish then every ride in every park would get one
 * and none of them would be checked. Geometry proposes; it does not publish.
 */
export function publishable(record, floor = PUBLISH_AT) {
  const out = {};
  for (const [feature, key] of Object.entries(PUBLISHED)) {
    const slot = record.features[feature];
    if (!slot?.at || slot.conflict) continue;
    if (!atLeast(slot.confidence, floor)) continue;
    out[key] = {
      lat: slot.at.lat,
      lng: slot.at.lng,
      src: { by: feature, confidence: slot.confidence, sources: slot.sources },
    };
  }
  return out;
}

/** Every ride in a venue that still has no way in worth publishing. */
export const unresolved = (records, floor = PUBLISH_AT) =>
  records.filter((r) => {
    const slot = r.features.queue_entrance;
    return !slot.at || slot.conflict || !atLeast(slot.confidence, floor);
  });

/**
 * A record with its empty slots dropped, for writing out.
 *
 * Seven features per ride and seventy-six rides is five hundred slots per park,
 * and at most a tenth of them have anything in them. Serialising the rest
 * tripled the file and buried the records that had something to say among
 * screens of `"at": null`. A missing feature and an empty one mean the same
 * thing, and reading restores whichever are absent.
 */
export const trim = (record) => ({
  ...record,
  features: Object.fromEntries(
    Object.entries(record.features).filter(([, slot]) => slot?.evidence?.length),
  ),
});

/** The whole list as GeoJSON, one feature per located feature of every ride. */
export function toGeoJson(records) {
  return {
    type: 'FeatureCollection',
    features: records.flatMap((r) =>
      FEATURES.map((f) => [f, r.features[f]])
        .filter(([, slot]) => slot?.at)
        .map(([f, slot]) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [slot.at.lng, slot.at.lat] },
          properties: {
            ride: r.name,
            ride_id: r.id,
            feature: f,
            confidence: slot.confidence,
            score: slot.score,
            sources: slot.sources,
            conflict: slot.conflict,
            newest_evidence: slot.newest_evidence,
          },
        })),
    ),
  };
}
