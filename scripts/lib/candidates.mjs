/**
 * Plausible entrances, proposed rather than asserted.
 *
 * The expensive way to fill in a park is to hunt down every ride's entrance by
 * hand. The cheap way is to notice that a park's own path network already
 * describes most of them, if you ask it the right question — and then to be very
 * clear that what comes out is a shortlist for somebody to approve, not an
 * answer. A detector that says "these four places are plausible" is useful. The
 * same detector claiming "this is the entrance" is a confidently wrong pin, and
 * a confidently wrong pin is worse than none: nobody checks a map that looks
 * right.
 *
 * Three detectors, in descending order of how much the evidence is worth. What
 * they can find was measured against the three parks on disk rather than
 * guessed, and the yield is the reason the confidence model exists:
 *
 *   named queue    A way called "Top Thrill 2 Standby Queue" names its ride and
 *                  draws its queue. Cedar Point has 22 of them, Kings Island 8,
 *                  Fiesta Texas none. Where it exists this is the best automatic
 *                  evidence there is, because a mapper stood there and wrote the
 *                  ride's name on the path.
 *   gate           A `barrier=gate` that survived the builder's furniture filter,
 *                  standing near a ride. Cedar Point has 158 gates before
 *                  filtering, which is the problem: most are queue and service
 *                  gates, and near a ride is only a hint.
 *   nearest path   Where the walkable network comes closest to the ride. Always
 *                  available, worth the least, and correct surprisingly often for
 *                  a small flat ride and hopeless for a coaster whose track runs
 *                  four hundred metres past three midways.
 *
 * OpenStreetMap's own `entrance=*` tagging would outrank all three and is read
 * where a park has it. Fiesta Texas has exactly one `entrance` tag in the whole
 * park, against 53 rides, which is why nothing here leans on it.
 */

import { metresBetween } from './evidence.mjs';

/** How far from a ride a candidate may stand before it is somebody else's. */
export const NEAR_M = 120;

const RIDE = (p) => p.c === 'coaster' || p.c === 'ride';

/* "Top Thrill 2 Standby Queue" → "top thrill 2". Parks label the lane rather
   than the ride, and the lane is not what anybody is walking to. */
const QUEUE_WORDS = /\s*[-–—]?\s*\b(standby|fastlane|fast lane|lightning lane|express|single rider|exit|entrance|queue|line|switchback)\b/gi;

export const rideNameOf = (wayName) =>
  String(wayName || '')
    .replace(QUEUE_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const endsOf = (ring) => [ring[0], ring[ring.length - 1]];
const asPoint = ([lng, lat]) => ({ lat, lng });

/**
 * Everything the geometry has to say about where a ride is entered and left.
 *
 * @param map   the drawn bundle: `path`, `service`, `coaster`, `slide`
 * @param pois  the places, so a candidate can be tied to the ride it serves
 * @returns `[{ ride, type, at, source, why }]` — one entry per proposal, and a
 *          ride may well collect several. Nothing is chosen here; choosing is
 *          what the evidence model is for.
 */
export function candidates(map = {}, pois = []) {
  const rides = pois.filter(RIDE);
  if (!rides.length) return [];

  const byName = new Map();
  for (const r of rides) {
    const key = String(r.n).toLowerCase();
    if (!byName.has(key)) byName.set(key, r);
  }

  const walkable = [...(map.path || []), ...(map.service || [])]
    .map((w) => (Array.isArray(w) ? { n: '', r: w } : w))
    .filter((w) => Array.isArray(w.r) && w.r.length > 1);

  /* The general network, with the queues taken out of it. A queue entrance is
     where a queue *meets the park*, so the park has to be the thing that is not
     the queue — otherwise every switchback bend counts as an entrance. */
  const queueish = new Set();
  const named = [];
  for (const w of walkable) {
    if (!w.n) continue;
    if (!/\b(queue|standby|fastlane|fast lane|single rider|switchback)\b/i.test(w.n)) continue;
    queueish.add(w);
    const ride = byName.get(rideNameOf(w.n));
    if (ride) named.push({ way: w, ride });
  }
  const network = walkable.filter((w) => !queueish.has(w));

  const out = [];

  /* ---- 1. a queue that carries its ride's name ---- */

  /* One ride often has several. Cedar Point draws Maverick's standby lane, its
     Fastlane lane and two more segments of the same queue as four separate ways,
     all carrying the ride's name — and they are not four entrances. Whichever
     end reaches furthest out into the park is the way in that a person walking
     up to the ride actually meets; the rest are lanes that branch off it or
     pieces of the same run. Reconciled here rather than left to the evidence
     model, which dedupes by *source* and would otherwise keep whichever way
     happened to be last in the file. */
  const perRide = new Map();
  for (const { way, ride } of named) {
    const [a, b] = endsOf(way.r).map(asPoint);
    /* Which end is the way in. A queue runs from the midway to the station, so
       the entrance is the end nearer the rest of the park and the station is the
       end nearer the ride. Measured rather than assumed, because a way is drawn
       in whichever direction the mapper walked. */
    const aToNet = nearestOn(network, a);
    const bToNet = nearestOn(network, b);
    if (!aToNet && !bToNet) continue;
    const aWins = (aToNet?.d ?? Infinity) <= (bToNet?.d ?? Infinity);
    const proposal = {
      ride: ride.n,
      entrance: aWins ? a : b,
      station: aWins ? b : a,
      toNetwork: Math.min(aToNet?.d ?? Infinity, bToNet?.d ?? Infinity),
      way: way.n,
      lanes: 1,
    };
    const held = perRide.get(ride.n);
    if (!held) perRide.set(ride.n, proposal);
    else {
      held.lanes += 1;
      if (proposal.toNetwork < held.toNetwork) {
        Object.assign(held, proposal, { lanes: held.lanes });
      }
    }
  }

  for (const p of perRide.values()) {
    const also = p.lanes > 1 ? `, the outermost of ${p.lanes} lanes mapped for this ride` : '';
    out.push({
      ride: p.ride,
      type: 'queue_entrance',
      at: p.entrance,
      source: 'osm_named_queue',
      why: `the park end of "${p.way}", a way in OpenStreetMap named for this ride${also}`,
    });
    out.push({
      ride: p.ride,
      type: 'station',
      at: p.station,
      source: 'osm_named_queue',
      why: `the far end of "${p.way}", where the queue reaches the ride`,
    });
  }

  /* ---- 2. a gate standing near a ride ---- */

  const gates = pois.filter((p) => p.c === 'gate');
  for (const ride of rides) {
    for (const gate of gates) {
      const d = metresBetween(gate, ride);
      if (d > NEAR_M) continue;
      out.push({
        ride: ride.n,
        type: 'queue_entrance',
        at: { lat: gate.lat, lng: gate.lng },
        source: 'geometry',
        why: `"${gate.n}", a gate ${Math.round(d)} m from the ride`,
      });
    }
  }

  /* ---- 3. where the network comes closest ---- */

  for (const ride of rides) {
    const near = nearestOn(network, ride);
    if (!near || near.d > NEAR_M) continue;
    out.push({
      ride: ride.n,
      type: 'queue_entrance',
      at: near.at,
      source: 'geometry',
      why: `the walkable network at its closest, ${Math.round(near.d)} m from the ride`
        + (near.name ? ` (${near.name})` : ''),
    });
  }

  return out;
}

/** The nearest point on any of these ways, as a vertex. */
function nearestOn(ways, to) {
  let best = null;
  for (const w of ways) {
    for (const [lng, lat] of w.r) {
      const d = metresBetween(to, { lat, lng });
      if (!best || d < best.d) best = { d, at: { lat, lng }, name: w.n || '' };
    }
  }
  return best;
}

/**
 * A ride whose position is the middle of its own track.
 *
 * The builder takes a ride from named track when nothing else supplies one,
 * positioned at the track's midpoint — surveyed geometry, and the middle of the
 * ride rather than its entrance. For a carousel that is a distinction without a
 * difference. For a coaster it is the top of the lift hill, over a fence, and it
 * is the case where an entrance is not a nicety: it is the difference between a
 * walking route that works and one that aims at the wrong side of the park.
 *
 * Reported so a review can start with the rides where it matters most.
 */
export function needEntranceMost(map = {}, pois = []) {
  const track = [...(map.coaster || []), ...(map.slide || [])].filter((w) => w?.n && w.r?.length);
  const byName = new Map(track.map((w) => [String(w.n).toLowerCase(), w]));
  return pois
    .filter(RIDE)
    .map((ride) => {
      const w = byName.get(String(ride.n).toLowerCase());
      if (!w) return null;
      // How far the ride sprawls: half the distance between its track's ends is
      // a fair estimate of how wrong "the middle of it" can be.
      const [a, b] = endsOf(w.r).map(asPoint);
      const span = metresBetween(a, b);
      return span > 60 ? { ride: ride.n, spanM: Math.round(span) } : null;
    })
    .filter(Boolean)
    .sort((x, y) => y.spanM - x.spanM);
}
