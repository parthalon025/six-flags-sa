/**
 * Parkbound live recommendations: GO NOW / BUSY / LATER.
 *
 * There is no wait-time feed. These states are derived from what the app
 * already knows — party ride reports, the weather outlook, how far you are,
 * and whether your party is clustered on a ride — so they never invent a
 * queue length they cannot defend.
 */

import { LIVE } from './brand.js';
import { distance, formatWalk } from './geo.js';
import { isRideable } from './ontology.js';
import { exposureFor } from './weather.js';
import { statusFor } from './rideStatus.js';
import { identityOf } from './venue/ids.js';

/** Walk this close and an open ride becomes GO NOW (~6–7 min). */
export const GO_NOW_M = 480;

/** Party members this close to a ride count as "here". */
export const BUSY_CLUSTER_M = 50;

/** How many party members at a ride make it BUSY. */
export const BUSY_MIN_MEMBERS = 2;

/**
 * Count visible party members standing at a place.
 * @param {{lat:number,lng:number}} poi
 * @param {Array<{lat?:number,lng?:number,visible?:boolean}>} members
 */
export function membersAt(poi, members, radiusM = BUSY_CLUSTER_M) {
  if (!poi || !Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) return 0;
  let n = 0;
  for (const m of members || []) {
    if (!Number.isFinite(m?.lat) || !Number.isFinite(m?.lng)) continue;
    if (m.visible === false) continue;
    if (distance(poi.lat, poi.lng, m.lat, m.lng) <= radiusM) n += 1;
  }
  return n;
}

/**
 * Parkbound live label for one place.
 *
 * @param {object} poi
 * @param {object|null} report  party ride report
 * @param {object|null} weather classifyWeather result
 * @param {number} [now]
 * @param {{ metres?: number|null, membersNear?: number }} [opts]
 */
export function liveFor(poi, report, weather, now = Date.now(), opts = {}) {
  const metres = opts.metres;
  const membersNear = opts.membersNear ?? 0;
  const base = statusFor(poi, report, weather, now);
  const nearby = metres != null && Number.isFinite(metres) && metres <= GO_NOW_M;
  const exposure = exposureFor(poi);
  const isDay = weather?.obs?.isDay !== false;
  const rideable = isRideable(poi) || poi?.c === 'show';

  const withLive = (live, patch = {}) => ({
    ...base,
    live,
    label: LIVE[live] || base.label,
    ...patch,
  });

  // Hard party / weather stops keep their vocabulary.
  if (base.key === 'down' || base.key === 'hold') {
    return withLive('paused', { key: 'paused', tone: 'bad' });
  }
  if (base.key === 'closed') {
    return withLive('weather', { key: 'weather', tone: 'bad' });
  }
  // Sky to watch — come back later, not "it's closed".
  if (base.key === 'watch') {
    return withLive('later', {
      key: 'later',
      tone: 'warn',
      detail: base.detail || 'Watch the sky — try again later',
    });
  }

  // BUSY: your expedition is already piled onto this ride.
  if (
    rideable &&
    membersNear >= BUSY_MIN_MEMBERS &&
    (base.key === 'open' || base.key === 'running')
  ) {
    return withLive('busy', {
      key: 'busy',
      tone: 'warn',
      source: base.source === 'none' ? 'party' : base.source,
      detail: base.detail || `${membersNear} of your party are here`,
    });
  }

  // GO NOW: someone just saw it open, and you can walk there in minutes.
  if (base.key === 'open' && nearby) {
    return withLive('goNow', {
      key: 'goNow',
      tone: 'ok',
      detail: base.detail,
    });
  }

  // GO NOW (hedged): clear sky, outdoor ride, nearby, daytime, no report.
  if (
    base.key === 'running' &&
    nearby &&
    isDay &&
    rideable &&
    exposure.shelter === 'open' &&
    (poi.c === 'coaster' || poi.c === 'ride')
  ) {
    return withLive('goNow', {
      key: 'goNow',
      tone: 'ok',
      source: 'weather',
      detail: 'Nearby and the sky looks clear',
    });
  }

  // Night outdoors with nothing else to say — not a GO NOW.
  if (base.key === 'running' && !isDay && exposure.shelter === 'open' && rideable) {
    return withLive('later', {
      key: 'later',
      tone: 'warn',
      source: 'none',
      detail: 'Night — better by daylight',
    });
  }

  if (base.key === 'open') {
    return withLive('open', { key: 'open' });
  }

  return { ...base, live: base.label ? base.key : 'none' };
}

/**
 * The status pill's classes for one `liveFor` result.
 *
 * Both surfaces that draw the pill — the list row and the selection capsule —
 * ask the same nine questions of the same object. While each kept its own
 * copy of them, the answers could drift: one screen inventing a fourth colour
 * for a ride the other already had an opinion about. The questions belong
 * beside `liveFor`, which is what settled the facts they read.
 *
 * Both `live` and `key` are matched on every rung because callers do not all
 * hold the same shape: `liveFor` sets `live` (and rewrites `key` with it),
 * while a raw `statusFor` result carries only `key` — and `watch`, `down` and
 * `hold` never become a `live` word at all, so they are only ever seen there.
 *
 * Returns a class string; the caller decides whether there is a label worth
 * drawing at all.
 *
 * @param {object|null} st `liveFor` (or `statusFor`) result
 */
export function statusPillClasses(st) {
  if (!st) return '';
  return [
    'liveBadge',
    'statusPill',
    st.live === 'goNow' || st.key === 'goNow' ? 'goNow' : '',
    st.live === 'busy' || st.key === 'busy' ? 'busy' : '',
    st.live === 'later' || st.key === 'later' || st.key === 'watch' ? 'later' : '',
    st.live === 'open' || st.key === 'open' ? 'open' : '',
    st.live === 'paused' || st.key === 'down' || st.key === 'hold' || st.key === 'paused'
      ? 'paused'
      : '',
    st.live === 'weather' || st.key === 'closed' ? 'weather' : '',
    st.source === 'weather' ? 'guess' : '',
    st.stale ? 'stale' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/* -------------------------------------------------------------- Why? --- */

/* One line each — "why" is a sentence a visitor can check against the park,
   never a number nobody can verify. Height is the one factor that needs a
   verdict rather than a fact already sitting in `live`, so it borrows
   fold.at(id).kind instead of re-deriving the rule. */
const ELIGIBLE_WHY = {
  eligible: 'Tall enough to ride',
  companion: 'Rides with an adult along',
  advisory: 'Built for smaller riders — worth a look',
};

function distanceFactor(metres) {
  return { key: 'distance', label: `${formatWalk(metres)} walk` };
}

/** The party's report or the sky's forecast — whichever `liveFor` used to say GO NOW. */
function statusFactor(live) {
  if (!live.detail) return null;
  return { key: live.source === 'weather' ? 'weather' : 'status', label: live.detail };
}

/**
 * Height eligibility as a factor, or null when there's nothing to say —
 * no height rule on the ride, or a silent cell (empty people / no rule).
 *
 * @returns {{key:'eligibility', label:string|null, verdict:string}|null}
 */
function eligibilityFactor(poi, view) {
  if (!view || !poi) return null;
  const cell = view.at(identityOf(poi));
  if (!cell.kind) return null;
  return { key: 'eligibility', label: ELIGIBLE_WHY[cell.kind] ?? null, verdict: cell.kind };
}

/** The short version of factors[] — the strongest reason first, distance only
 *  when nothing else beat it. Never every factor at once: that's a dashboard. */
function composeWhy(factors) {
  const reason = factors.find((f) => f.key === 'status' || f.key === 'weather');
  const elig = factors.find((f) => f.key === 'eligibility');
  const bits = [reason, elig].filter(Boolean).map((f) => f.label);
  if (bits.length === 0) {
    const dist = factors.find((f) => f.key === 'distance');
    if (dist) bits.push(dist.label);
  }
  return bits.join(' · ');
}

function goNowCandidates(pois, rides, weather, me, members, now, opts) {
  if (!me || !Number.isFinite(me.lat) || !Number.isFinite(me.lng)) return [];
  const view = opts?.eligibility ?? null;
  const scored = [];
  for (const poi of pois || []) {
    if (!isRideable(poi) && poi.c !== 'show') continue;
    const metres = distance(me.lat, me.lng, poi.lat, poi.lng);
    const membersNear = membersAt(poi, members);
    const live = liveFor(poi, rides?.[poi.id] ?? null, weather, now, { metres, membersNear });
    if (live.live !== 'goNow' && live.key !== 'goNow') continue;

    const elig = eligibilityFactor(poi, view);
    if (view?.at(identityOf(poi))?.blocks) continue;

    const factors = [distanceFactor(metres), statusFactor(live), elig].filter((f) => f?.label);
    const score = (live.source === 'party' ? 1000 : 0) - metres;
    scored.push({ poi, live, metres, factors, why: composeWhy(factors), score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function legMetres(from, to) {
  return distance(from.lat, from.lng, to.lat, to.lng);
}

function buildSequence(stops, me, strategy, tradeoff) {
  let total = 0;
  let cur = me;
  const out = [];
  for (const stop of stops) {
    const leg = legMetres(cur, stop.poi);
    total += leg;
    const factors = [
      distanceFactor(leg),
      ...stop.factors.filter((f) => f.key !== 'distance'),
    ].filter((f) => f?.label);
    out.push({
      poi: stop.poi,
      live: stop.live,
      metres: leg,
      factors,
      why: composeWhy(factors),
    });
    cur = stop.poi;
  }
  return { strategy, stops: out, totalWalkM: total, tradeoff };
}

function greedyNearSequence(candidates, me, maxStops) {
  const pool = [...candidates];
  const ordered = [];
  let cur = me;
  while (pool.length && ordered.length < maxStops) {
    pool.sort(
      (a, b) => legMetres(cur, a.poi) - legMetres(cur, b.poi),
    );
    const next = pool.shift();
    ordered.push(next);
    cur = next.poi;
  }
  return ordered;
}

function partyFirstSequence(candidates, me, maxStops) {
  let partyPool = candidates.filter((c) => c.live.source === 'party');
  let otherPool = candidates.filter((c) => c.live.source !== 'party');
  const ordered = [];
  let cur = me;
  const takeNearest = (pool) => {
    pool.sort((a, b) => legMetres(cur, a.poi) - legMetres(cur, b.poi));
    return pool.shift();
  };
  while ((partyPool.length || otherPool.length) && ordered.length < maxStops) {
    const next = partyPool.length ? takeNearest(partyPool) : takeNearest(otherPool);
    if (!next) break;
    ordered.push(next);
    cur = next.poi;
  }
  return ordered;
}

function sequenceTradeoff(strategy, totalWalkM, shortestWalk) {
  const extraWalkM = Math.round(totalWalkM - shortestWalk);
  const isShortest = totalWalkM <= shortestWalk + 1;
  const moreWalking =
    totalWalkM > shortestWalk + 15
      ? ` · about ${extraWalkM} m more walking than the shortest route`
      : '';

  if (strategy === 'near') {
    if (isShortest) return 'Nearest stops first · shortest total walk';
    return `Nearest stops first${moreWalking}`;
  }
  if (strategy === 'party') {
    return `Party-confirmed open first${moreWalking}`;
  }
  if (strategy === 'far') {
    return `Farther stop first · more walking up front${moreWalking}`;
  }
  if (strategy === 'swap') {
    return `Alternate stop order${moreWalking}`;
  }
  return `Score-ranked stops${moreWalking}`;
}

/**
 * Ranked GO NOW picks for the Explore rail — what should I do right now,
 * and why? Every pick carries `factors[]`, the plain-language evidence the
 * ranking is built from (how far, what the party or the sky says, whether
 * the rider is tall enough), and `why`, the one-line version of the
 * strongest of them. Nothing here asks an LLM — every factor is a fact the
 * app already holds, so the answer never outruns what it can defend.
 *
 * @param {object} [opts.eligibility]    fromFacts(facts, places) / fold(people, places)
 * @returns {Array<{ poi, live, metres, factors, why }>}
 */
export function recommendNow(
  pois,
  rides,
  weather,
  me,
  members = [],
  now = Date.now(),
  limit = 2,
  opts = {},
) {
  return goNowCandidates(pois, rides, weather, me, members, now, opts)
    .slice(0, limit)
    .map(({ score: _score, ...pick }) => pick);
}

/**
 * Compare a few short GO NOW sequences (2–3 stops) with explainable tradeoffs.
 * Uses straight-line walk legs — the same distance helper as single picks.
 *
 * @returns {Array<{ strategy, stops, totalWalkM, tradeoff }>}
 */
export function compareGoNowSequences(
  pois,
  rides,
  weather,
  me,
  members = [],
  now = Date.now(),
  opts = {},
) {
  const candidates = goNowCandidates(pois, rides, weather, me, members, now, opts);
  if (candidates.length < 2) return [];

  const maxStops = Math.min(3, candidates.length);
  const nearStops = greedyNearSequence(candidates, me, maxStops);
  const partyStops = partyFirstSequence(candidates, me, maxStops);

  const built = [];
  const push = (strategy, stops) => {
    if (stops.length < 2) return;
    const key = stops.map((s) => s.poi.id).join('>');
    if (built.some((b) => b.key === key)) return;
    built.push({ key, strategy, stops });
  };

  push('near', nearStops);
  push('party', partyStops);

  if (built.length < 2 && nearStops.length >= 2) {
    push('far', [...nearStops].reverse());
  }
  if (built.length < 2 && nearStops.length >= 2) {
    push('swap', [nearStops[1], nearStops[0], ...nearStops.slice(2)]);
  }
  if (built.length < 2 && candidates.length >= 2) {
    push('score', candidates.slice(0, maxStops));
  }

  const sequences = built.slice(0, 3).map(({ strategy, stops }) =>
    buildSequence(stops, me, strategy, ''),
  );
  const shortest = Math.min(...sequences.map((s) => s.totalWalkM));
  for (const seq of sequences) {
    seq.tradeoff = sequenceTradeoff(seq.strategy, seq.totalWalkM, shortest);
  }
  return sequences;
}
