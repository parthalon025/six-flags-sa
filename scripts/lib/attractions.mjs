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

import { atLeast, fuse, pointOf, PUBLISH_AT, staleness, WEIGHTS } from './evidence.mjs';

export const SCHEMA_VERSION = 1;

/**
 * The one vocabulary for `src.by`, shared by everything that writes a
 * coordinate onto a place.
 *
 * Three writers hang points on a place: the builder's `entrancesFromQueues`,
 * the tracer's `applyTrace`, and this pipeline's own `publish()`. Until they
 * agreed on a word, `publish()` stamped the *feature* name — so a published
 * exit carried `ride_exit` — and both readers fell through to a default. The
 * app's own output re-entered the pipeline as `official_map`, the heaviest
 * source in the table, annotated as though a park had printed it: a claim
 * citing itself, which is how one fact publishes itself.
 *
 * So the writer says what kind of source it is, in the same words `WEIGHTS`
 * uses, and a reader that does not recognise the word reads nothing. There is
 * no default and there must never be one — an unlabelled coordinate is a
 * coordinate of unknown standing, and the honest weight for that is none.
 *
 * `fused` is deliberately absent from `WEIGHTS`. It is this pipeline's own
 * conclusion, and a conclusion is not evidence for itself.
 */
export const SRC_BY = {
  NAMED_QUEUE: 'osm_named_queue',
  TRACED: 'traced',
  FUSED: 'fused',
};

/* What each kind of already-placed point says for itself. Derived from the
   entry rather than asserted by the reader, because the reader does not know
   which writer put it there and the last thing that guessed was wrong. */
const WHY = {
  [SRC_BY.NAMED_QUEUE]: (e) =>
    `where "${e.n || 'the queue'}" begins — a named queue tagged one-way towards the ride`,
  [SRC_BY.TRACED]: (e) => {
    const err = e.src?.error_m;
    return `traced off ${e.src?.image || "the park's own map"}${err != null ? ` at \u00b1${err} m` : ''}`;
  },
};

/**
 * The claim a coordinate already sitting on a place makes about itself, or
 * nothing at all.
 *
 * Nothing at all in three cases, and each of them matters: an entry with no
 * `src.by` (nobody signed it), an entry naming a source this pipeline does not
 * weigh (a word no scoring rule covers cannot be scored), and an entry this
 * pipeline published itself (re-ingesting our own output is the loop).
 *
 * @param entry  one `e` or `out` value off a place
 * @returns `{ source, why }`, or `null` if it may not be cited
 */
export function claimFromSrc(entry) {
  const by = entry?.src?.by;
  if (!by || by === SRC_BY.FUSED) return null;
  if (!(by in WEIGHTS)) return null;
  const why = WHY[by]
    ? WHY[by](entry)
    : `${entry.n ? `"${entry.n}", ` : ''}already on the place, from ${by}`;
  return { source: by, why };
}

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

/**
 * The two the app actually walks people to, and what they become in the bundle.
 *
 * `e` rather than a field of this pipeline's own. The builder already derives
 * entrances from named one-way queues and hangs them there, and the app reads
 * the first of them — one concept wants one place to read it, or the next person
 * has to know that a traced entrance lives somewhere else from a derived one.
 */
export const PUBLISHED = { queue_entrance: 'e', ride_exit: 'out' };

const blank = () => ({ at: null, confidence: 'unknown', score: 0, sources: [], evidence: [] });

/* Whether two claims are about the same spot, to the last decimal place stored.
   Not a tolerance: a source that has moved its point by any amount it bothered
   to write down has said something new, and something new is dated today. */
const samePlace = (a, b) => {
  if (!a || !b) return !a && !b;
  return a.lat === b.lat && a.lng === b.lng;
};

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
 *
 * **The date is the observation, not the run.** A claim only takes today's date
 * when it says something new: a source nobody had heard from, or one that has
 * moved its coordinate. Re-deriving the same point from the same source is not
 * a fresh sighting of anything, and dating it as though it were is how a
 * pipeline launders its own age — every record reading the day the script last
 * ran, `staleness()` unable to fire because nothing is ever older than today,
 * and every rebuild rewriting all 230 records so no diff can answer "does
 * OpenStreetMap still say what we shipped?".
 */
export function addEvidence(record, feature, claim, { asOf } = {}) {
  const slot = record.features[feature];
  if (!slot) throw new Error(`No such feature "${feature}". One of: ${FEATURES.join(', ')}.`);

  const prior = slot.evidence.find((e) => e.source === claim.source);
  const next = slot.evidence.filter((e) => e.source !== claim.source);
  const at = claim.at ? { lat: claim.at.lat, lng: claim.at.lng } : null;
  next.push({
    source: claim.source,
    at,
    /* An explicit date on the claim is somebody stating when they saw it and
       always wins. Otherwise: the date this source was first seen saying this,
       kept while it keeps saying it, and today's only once it changes. */
    date: claim.date || (samePlace(prior?.at, at) ? prior.date : null) || asOf || null,
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
      n: `${record.name} entrance`,
      /* `by` is the *kind of source* this coordinate is, in the one vocabulary
         every writer uses — not which feature it is, which is what it used to
         say and which is how a published exit came back round as an
         `official_map` survey. The feature keeps its own field. */
      src: { by: SRC_BY.FUSED, feature, confidence: slot.confidence, sources: slot.sources },
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
