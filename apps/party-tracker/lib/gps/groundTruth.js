/**
 * Guest ground-truth sightings — pure rules.
 *
 * While walk logging is on, GPS near published queue entrances, ride exits,
 * park gates and amenities can become research evidence. Passive dwell and
 * explicit "I'm here" confirms both produce the same observation shape; only
 * `mode` differs. Nothing here writes public/venues — uploads feed the
 * guest-traces builder adapter like path LineStrings do.
 */

import { distance } from '../geo.js';
import { withinBounds } from '../venue/store.js';
import { ANON_DECIMALS, MAX_ACCURACY_M, newSessionId, roundCoord } from './movementLog.js';

/** Guest must be this close to a published pin (or place) to count. */
export const PROXIMITY_M = 28;
/** Standing still near a target this long → automatic dwell sighting. */
export const DWELL_MS = 45_000;
export const MAX_OBS_PER_SESSION = 48;
/** Categories whose place pins are worth validating beyond rides/gates. */
export const INTEREST_CATEGORIES = new Set([
  'coaster',
  'ride',
  'gate',
  'restroom',
  'food',
  'service',
  'landmark',
  'shop',
  'water',
]);

export const FEATURE_LABELS = {
  queue_entrance: 'Queue entrance',
  ride_exit: 'Ride exit',
  park_entrance: 'Park entrance',
  ride_area: 'Ride area',
  restroom: 'Restroom',
  food: 'Food',
  service: 'Service',
  landmark: 'Landmark',
  shop: 'Shop',
  water: 'Water',
  poi: 'Place',
};

function featureForCategory(c) {
  if (c === 'gate') return 'park_entrance';
  if (c === 'restroom') return 'restroom';
  if (c === 'food') return 'food';
  if (c === 'service') return 'service';
  if (c === 'landmark') return 'landmark';
  if (c === 'shop') return 'shop';
  if (c === 'water') return 'water';
  if (c === 'coaster' || c === 'ride') return 'ride_area';
  return 'poi';
}

function placeKey(poi) {
  return String(poi?.i || poi?.id || poi?.n || '').trim();
}

/**
 * Flatten venue POIs into observation targets the phone can dwell near or confirm.
 * Includes published `e` / `out` pins and place centroids for interesting categories.
 */
export function extractTargets(pois = []) {
  const out = [];
  for (const p of pois) {
    if (!p) continue;
    const placeId = placeKey(p);
    const placeName = String(p.n || placeId || 'Place');
    const category = p.c || null;

    if (Array.isArray(p.e)) {
      p.e.forEach((g, idx) => {
        if (!Number.isFinite(g?.lat) || !Number.isFinite(g?.lng)) return;
        out.push({
          key: `${placeId}:queue_entrance:${idx}`,
          feature: 'queue_entrance',
          placeId,
          placeName,
          category,
          lat: g.lat,
          lng: g.lng,
          published: true,
          confidence: g.src?.confidence || null,
        });
      });
    }

    const exit = p.out && typeof p.out === 'object' ? p.out : null;
    if (exit && Number.isFinite(exit.lat) && Number.isFinite(exit.lng)) {
      out.push({
        key: `${placeId}:ride_exit`,
        feature: 'ride_exit',
        placeId,
        placeName,
        category,
        lat: exit.lat,
        lng: exit.lng,
        published: true,
        confidence: exit.src?.confidence || null,
      });
    }

    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (!INTEREST_CATEGORIES.has(category)) continue;

    const feature = featureForCategory(category);
    // Park gates are the venue entrance pin.
    out.push({
      key: `${placeId}:${feature}:centroid`,
      feature,
      placeId,
      placeName,
      category,
      lat: p.lat,
      lng: p.lng,
      published: true,
      confidence: null,
      isCentroid: true,
    });

    // Rides without a published queue entrance still need ground truth — offer
    // a confirm target at the ride area so guests can pin where the queue starts.
    if ((category === 'coaster' || category === 'ride') && !p.e?.length) {
      out.push({
        key: `${placeId}:queue_entrance:propose`,
        feature: 'queue_entrance',
        placeId,
        placeName,
        category,
        lat: p.lat,
        lng: p.lng,
        published: false,
        confidence: null,
        isCentroid: true,
      });
    }
    if ((category === 'coaster' || category === 'ride') && !exit) {
      out.push({
        key: `${placeId}:ride_exit:propose`,
        feature: 'ride_exit',
        placeId,
        placeName,
        category,
        lat: p.lat,
        lng: p.lng,
        published: false,
        confidence: null,
        isCentroid: true,
      });
    }
  }
  return out;
}

export function nearestTarget(point, targets = [], maxM = PROXIMITY_M) {
  if (!point || !Number.isFinite(point.lat)) return null;
  let best = null;
  for (const t of targets) {
    if (!Number.isFinite(t?.lat) || !Number.isFinite(t?.lng)) continue;
    const d = distance(point.lat, point.lng, t.lat, t.lng);
    if (d > maxM) continue;
    if (!best || d < best.distanceM) best = { target: t, distanceM: d };
  }
  return best;
}

/** Nearby confirm options for the history UI — rides get entrance + exit. */
export function confirmOptions(point, pois = [], maxM = PROXIMITY_M + 12) {
  if (!point || !Number.isFinite(point.lat)) return [];
  const options = [];
  for (const p of pois) {
    if (!Number.isFinite(p?.lat)) continue;
    const d = distance(point.lat, point.lng, p.lat, p.lng);
    // Also consider published entrance distance for rides whose centroid is farther.
    let bestD = d;
    if (Array.isArray(p.e)) {
      for (const g of p.e) {
        if (!Number.isFinite(g?.lat)) continue;
        bestD = Math.min(bestD, distance(point.lat, point.lng, g.lat, g.lng));
      }
    }
    if (p.out && Number.isFinite(p.out.lat)) {
      bestD = Math.min(bestD, distance(point.lat, point.lng, p.out.lat, p.out.lng));
    }
    if (bestD > maxM) continue;

    const placeId = placeKey(p);
    const placeName = String(p.n || placeId);
    const category = p.c || null;

    if (category === 'gate') {
      options.push({
        key: `${placeId}:park_entrance:confirm`,
        feature: 'park_entrance',
        placeId,
        placeName,
        category,
        lat: p.lat,
        lng: p.lng,
        published: true,
        distanceM: bestD,
      });
      continue;
    }

    if (category === 'coaster' || category === 'ride') {
      const gate = Array.isArray(p.e) && p.e.find((g) => Number.isFinite(g?.lat));
      options.push({
        key: `${placeId}:queue_entrance:confirm`,
        feature: 'queue_entrance',
        placeId,
        placeName,
        category,
        lat: gate ? gate.lat : p.lat,
        lng: gate ? gate.lng : p.lng,
        published: Boolean(gate),
        distanceM: gate
          ? distance(point.lat, point.lng, gate.lat, gate.lng)
          : d,
      });
      const exit = p.out && Number.isFinite(p.out.lat) ? p.out : null;
      options.push({
        key: `${placeId}:ride_exit:confirm`,
        feature: 'ride_exit',
        placeId,
        placeName,
        category,
        lat: exit ? exit.lat : p.lat,
        lng: exit ? exit.lng : p.lng,
        published: Boolean(exit),
        distanceM: exit ? distance(point.lat, point.lng, exit.lat, exit.lng) : d,
      });
      continue;
    }

    if (INTEREST_CATEGORIES.has(category)) {
      options.push({
        key: `${placeId}:${featureForCategory(category)}:confirm`,
        feature: featureForCategory(category),
        placeId,
        placeName,
        category,
        lat: p.lat,
        lng: p.lng,
        published: true,
        distanceM: d,
      });
    }
  }
  return options.sort((a, b) => a.distanceM - b.distanceM).slice(0, 8);
}

function sampleCentroid(samples) {
  if (!samples?.length) return null;
  let lat = 0;
  let lng = 0;
  for (const s of samples) {
    lat += s.lat;
    lng += s.lng;
  }
  return { lat: lat / samples.length, lng: lng / samples.length };
}

function makeObservation({ target, point, mode, dwellMs = null, samples = null }) {
  const at = samples?.length ? sampleCentroid(samples) : { lat: point.lat, lng: point.lng };
  const published =
    target.published === false
      ? null
      : { lat: target.lat, lng: target.lng };
  const deltaM = published
    ? Math.round(distance(at.lat, at.lng, published.lat, published.lng))
    : null;
  return {
    id: `obs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    feature: target.feature,
    placeId: target.placeId || '',
    placeName: target.placeName || '',
    category: target.category || null,
    mode, // 'dwell' | 'confirm'
    lat: at.lat,
    lng: at.lng,
    published,
    deltaM,
    acc: Number.isFinite(point.acc) ? point.acc : null,
    ts: point.ts || Date.now(),
    dwellMs,
    targetKey: target.key,
  };
}

function ensureOpenSession(state, { point, venueId, venueName }) {
  let sessions = Array.isArray(state.sessions) ? [...state.sessions] : [];
  let openId = state.openId || null;
  let session = openId ? sessions.find((s) => s.id === openId) : null;
  if (!session) {
    openId = newSessionId(point.ts);
    session = {
      id: openId,
      venueId: venueId || '',
      venueName: venueName || '',
      startedAt: point.ts || Date.now(),
      endedAt: point.ts || Date.now(),
      points: [],
      metres: 0,
      observations: [],
      uploadedAt: null,
    };
    sessions.push(session);
  }
  if (!Array.isArray(session.observations)) session.observations = [];
  return { sessions, openId, session };
}

function alreadyObserved(session, targetKey, mode) {
  return (session.observations || []).some(
    (o) => o.targetKey === targetKey && (mode === 'confirm' ? o.mode === 'confirm' : true),
  );
}

/**
 * Advance dwell tracking for one GPS fix. May append a dwell observation.
 * Call even when the path logger skipped the point for spacing.
 */
export function updateDwell(state, { point, targets, venueId, venueName, bounds } = {}) {
  const base = {
    sessions: Array.isArray(state?.sessions) ? state.sessions : [],
    openId: state?.openId || null,
    dwell: state?.dwell || null,
  };

  if (!point || point.manual) {
    return { ...base, recorded: false, reason: 'manual', observation: null };
  }
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return { ...base, recorded: false, reason: 'invalid', observation: null };
  }
  if (bounds && !withinBounds(bounds, point.lat, point.lng)) {
    return { ...base, sessions: base.sessions, openId: base.openId, dwell: null, recorded: false, reason: 'outside', observation: null };
  }
  if (Number.isFinite(point.acc) && point.acc > MAX_ACCURACY_M) {
    return { ...base, recorded: false, reason: 'accuracy', observation: null };
  }

  const hit = nearestTarget(point, targets, PROXIMITY_M);
  if (!hit) {
    return { ...base, dwell: null, recorded: false, reason: 'no-target', observation: null };
  }

  const { target, distanceM } = hit;
  const now = point.ts || Date.now();
  let dwell = base.dwell;
  if (!dwell || dwell.key !== target.key) {
    dwell = {
      key: target.key,
      target,
      since: now,
      samples: [{ lat: point.lat, lng: point.lng, ts: now, acc: point.acc }],
    };
    return { ...base, dwell, recorded: false, reason: 'dwell-start', observation: null, distanceM };
  }

  dwell = {
    ...dwell,
    samples: [...dwell.samples, { lat: point.lat, lng: point.lng, ts: now, acc: point.acc }].slice(-20),
  };
  const dwellMs = now - dwell.since;
  if (dwellMs < DWELL_MS || dwell.samples.length < 3) {
    return { ...base, dwell, recorded: false, reason: 'dwell-progress', observation: null, distanceM, dwellMs };
  }

  const { sessions, openId, session } = ensureOpenSession(base, { point, venueId, venueName });
  if (alreadyObserved(session, target.key, 'dwell')) {
    return {
      sessions,
      openId,
      dwell: null,
      recorded: false,
      reason: 'already-observed',
      observation: null,
    };
  }
  if (session.observations.length >= MAX_OBS_PER_SESSION) {
    return { sessions, openId, dwell: null, recorded: false, reason: 'obs-full', observation: null };
  }

  const observation = makeObservation({
    target,
    point,
    mode: 'dwell',
    dwellMs,
    samples: dwell.samples,
  });
  session.observations = [...session.observations, observation];
  session.endedAt = now;
  session.venueId = venueId || session.venueId;
  session.venueName = venueName || session.venueName;

  const nextSessions = sessions.map((s) => (s.id === session.id ? session : s));
  return {
    sessions: nextSessions,
    openId,
    dwell: null,
    recorded: true,
    reason: 'dwell',
    observation,
    distanceM,
    dwellMs,
  };
}

/** Explicit guest confirm — stronger than dwell for the same target. */
export function confirmObservation(state, { point, target, venueId, venueName, bounds } = {}) {
  if (!point || point.manual) return { ...state, recorded: false, reason: 'manual', observation: null };
  if (!target?.feature) return { ...state, recorded: false, reason: 'no-target', observation: null };
  if (bounds && !withinBounds(bounds, point.lat, point.lng)) {
    return { ...state, recorded: false, reason: 'outside', observation: null };
  }

  const { sessions, openId, session } = ensureOpenSession(
    { sessions: state?.sessions || [], openId: state?.openId || null },
    { point, venueId, venueName },
  );

  // One confirm per target per session; allow confirm to replace a prior dwell.
  session.observations = (session.observations || []).filter(
    (o) => !(o.targetKey === target.key && o.mode === 'dwell'),
  );
  if (alreadyObserved(session, target.key, 'confirm')) {
    return { sessions, openId, dwell: state?.dwell || null, recorded: false, reason: 'already-observed', observation: null };
  }
  if (session.observations.length >= MAX_OBS_PER_SESSION) {
    return { sessions, openId, dwell: state?.dwell || null, recorded: false, reason: 'obs-full', observation: null };
  }

  const observation = makeObservation({ target, point, mode: 'confirm' });
  session.observations = [...session.observations, observation];
  session.endedAt = point.ts || Date.now();
  session.venueId = venueId || session.venueId;
  session.venueName = venueName || session.venueName;

  return {
    sessions: sessions.map((s) => (s.id === session.id ? session : s)),
    openId,
    dwell: null,
    recorded: true,
    reason: 'confirm',
    observation,
  };
}

export function anonymizeObservation(obs) {
  if (!obs) return null;
  return {
    id: obs.id,
    feature: obs.feature,
    placeId: String(obs.placeId || '').slice(0, 80),
    placeName: String(obs.placeName || '').slice(0, 80),
    category: obs.category || null,
    mode: obs.mode === 'confirm' ? 'confirm' : 'dwell',
    lat: roundCoord(obs.lat, ANON_DECIMALS),
    lng: roundCoord(obs.lng, ANON_DECIMALS),
    published: obs.published
      ? {
          lat: roundCoord(obs.published.lat, ANON_DECIMALS),
          lng: roundCoord(obs.published.lng, ANON_DECIMALS),
        }
      : null,
    deltaM: Number.isFinite(obs.deltaM) ? Math.round(obs.deltaM) : null,
    acc: Number.isFinite(obs.acc) ? Math.round(obs.acc) : null,
    ts: obs.ts || null,
    dwellMs: Number.isFinite(obs.dwellMs) ? Math.round(obs.dwellMs) : null,
    targetKey: obs.targetKey || null,
  };
}

export function observationToGeoJSON(obs, { venueId, sessionId } = {}) {
  const body = anonymizeObservation(obs);
  return {
    type: 'Feature',
    properties: {
      kind: 'guest_ground_truth',
      feature: body.feature,
      venueId: venueId || '',
      sessionId: sessionId || '',
      observationId: body.id,
      placeId: body.placeId,
      placeName: body.placeName,
      category: body.category,
      mode: body.mode,
      published: body.published,
      deltaM: body.deltaM,
      dwellMs: body.dwellMs,
      acc: body.acc,
      ts: body.ts,
      source: 'parkbound_guest_movement',
    },
    geometry: {
      type: 'Point',
      coordinates: [body.lng, body.lat],
    },
  };
}

export function summarizeObservations(sessions = []) {
  const rows = [];
  for (const s of sessions) {
    for (const o of s.observations || []) {
      rows.push({
        ...o,
        sessionId: s.id,
        venueId: s.venueId,
        venueName: s.venueName,
        uploadedAt: s.uploadedAt,
        label: FEATURE_LABELS[o.feature] || o.feature,
      });
    }
  }
  return rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
}
