/**
 * Fair reunification point on the real walk graph.
 *
 * Minimax walking time: minimise the longest leg, tiebreak on total walking.
 * Candidates must be named, findable, standing-room places.
 */

import { isMeetCandidate } from './ontology.js';
import { findRoute } from './routing.js';

const CANDIDATE_LIMIT = 12;

/** Prune to nearest named meet candidates around the party centroid. */
export function meetCandidates(pois, center, limit = CANDIDATE_LIMIT) {
  const pool = (pois || []).filter((p) => p.n && isMeetCandidate(p));
  if (!pool.length || !center) return [];
  return pool
    .map((p) => ({
      poi: p,
      d: Math.hypot(
        (p.lat - center.lat) * 110540,
        (p.lng - center.lng) * 111320 * Math.cos(center.lat * (Math.PI / 180)),
      ),
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.poi);
}

/**
 * Pick a reunification point. Never returns a candidate where any leg used
 * crow-flies fallback (`direct` mode).
 */
export function pickReunification(graph, members, pois) {
  const located = members.filter((m) => m.location);
  if (located.length < 2 || !graph) return null;

  const center = {
    lat: located.reduce((s, m) => s + m.location.lat, 0) / located.length,
    lng: located.reduce((s, m) => s + m.location.lng, 0) / located.length,
  };
  const candidates = meetCandidates(pois, center);
  if (!candidates.length) return null;

  let best = null;
  for (const candidate of candidates) {
    const to = { lat: candidate.lat, lng: candidate.lng };
    const legs = located.map((m) => {
      const route = findRoute(graph, m.location, to);
      return route;
    });
    if (legs.some((r) => !r || r.mode === 'direct')) continue;
    const times = legs.map((r) => r.durationSec || 0);
    const maxLeg = Math.max(...times);
    const total = times.reduce((a, b) => a + b, 0);
    const score = { maxLeg, total, candidate };
    if (!best || score.maxLeg < best.maxLeg || (score.maxLeg === best.maxLeg && score.total < best.total)) {
      best = score;
    }
  }
  return best?.candidate || null;
}
