/**
 * Guest movement log — pure rules for recording walks inside a park.
 *
 * Opt-in breadcrumb trails stay on the phone until the guest uploads. Uploads
 * are anonymised LineStrings the venue builder can treat as path-geometry
 * evidence (never a silent write to public/venues). Nothing here touches the
 * DOM or IndexedDB so unit tests and the store agree on the same answers.
 */

import { distance } from '../geo.js';
import { withinBounds } from '../venue/store.js';

/** Prefer ~8 m between kept points — denser than walking GPS noise, sparse enough to store. */
export const MIN_POINT_GAP_M = 8;
/** Discard fixes looser than this; they smear midways into neighbouring paths. */
export const MAX_ACCURACY_M = 35;
/** Idle gap that closes one session and starts another on the next keepable fix. */
export const SESSION_GAP_MS = 15 * 60 * 1000;
export const MAX_POINTS_PER_SESSION = 2000;
export const MAX_SESSIONS = 40;
/** ~1.1 m at mid-latitudes — enough for walkways, not for identifying a person. */
export const ANON_DECIMALS = 5;

export const PREFS_KEY = 'parkbound.movementLog.prefs.v1';

export function defaultPrefs() {
  return { enabled: false, autoUpload: false };
}

export function parsePrefs(raw) {
  const base = defaultPrefs();
  if (!raw || typeof raw !== 'object') return base;
  return {
    enabled: Boolean(raw.enabled),
    autoUpload: Boolean(raw.autoUpload),
  };
}

export function newSessionId(now = Date.now()) {
  return `walk-${now}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Whether a new GPS fix should be appended to the open session.
 * Manual placements are never logged — they are not walks.
 */
export function shouldKeepPoint({ prev, point, bounds } = {}) {
  if (!point || point.manual) return { keep: false, reason: 'manual' };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return { keep: false, reason: 'invalid' };
  }
  if (!bounds || !withinBounds(bounds, point.lat, point.lng)) {
    return { keep: false, reason: 'outside' };
  }
  if (Number.isFinite(point.acc) && point.acc > MAX_ACCURACY_M) {
    return { keep: false, reason: 'accuracy' };
  }
  if (!prev) return { keep: true, reason: 'first' };
  const gap = distance(prev.lat, prev.lng, point.lat, point.lng);
  if (gap < MIN_POINT_GAP_M) return { keep: false, reason: 'too-close', gap };
  return { keep: true, reason: 'moved', gap };
}

/** True when the previous keepable fix is old enough that this is a new walk. */
export function shouldStartNewSession(prevPoint, point, gapMs = SESSION_GAP_MS) {
  if (!prevPoint || !point) return true;
  const dt = (point.ts || 0) - (prevPoint.ts || 0);
  return !Number.isFinite(dt) || dt < 0 || dt >= gapMs;
}

export function metresAlong(points = []) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!Number.isFinite(a?.lat) || !Number.isFinite(b?.lat)) continue;
    total += distance(a.lat, a.lng, b.lat, b.lng);
  }
  return total;
}

export function roundCoord(n, decimals = ANON_DECIMALS) {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/**
 * Strip identity and tighten precision before anything leaves the phone.
 * Timestamps become offsets from the first point so wall-clock habits drop out.
 */
export function anonymizeSession(session) {
  const points = Array.isArray(session?.points) ? session.points : [];
  const t0 = points[0]?.ts || session?.startedAt || 0;
  return {
    id: session?.id || newSessionId(),
    venueId: String(session?.venueId || ''),
    startedAt: session?.startedAt || t0 || null,
    endedAt: session?.endedAt || points[points.length - 1]?.ts || null,
    metres: Number.isFinite(session?.metres) ? session.metres : metresAlong(points),
    pointCount: points.length,
    points: points.map((p) => ({
      lat: roundCoord(p.lat),
      lng: roundCoord(p.lng),
      t: Math.max(0, Math.round((p.ts || 0) - t0)),
      ...(Number.isFinite(p.acc) ? { acc: Math.round(p.acc) } : {}),
    })),
  };
}

/** GeoJSON Feature (LineString) suitable for upload / builder cache. */
export function sessionToGeoJSON(session, { anonymize = true } = {}) {
  const body = anonymize ? anonymizeSession(session) : session;
  const pts = body.points || [];
  const coordinates = pts.map((p) => [p.lng ?? p[0], p.lat ?? p[1]]);
  return {
    type: 'Feature',
    properties: {
      kind: 'guest_trace',
      venueId: body.venueId,
      sessionId: body.id,
      startedAt: body.startedAt,
      endedAt: body.endedAt,
      metres: body.metres,
      pointCount: pts.length,
      source: 'parkbound_guest_movement',
    },
    geometry: {
      type: 'LineString',
      coordinates,
    },
  };
}

export function sessionsToFeatureCollection(sessions, opts) {
  return {
    type: 'FeatureCollection',
    features: (sessions || [])
      .filter((s) => (s.points || []).length >= 2)
      .map((s) => sessionToGeoJSON(s, opts)),
  };
}

export function summarizeSession(session) {
  const points = session?.points || [];
  const metres = Number.isFinite(session?.metres) ? session.metres : metresAlong(points);
  const startedAt = session?.startedAt || points[0]?.ts || null;
  const endedAt = session?.endedAt || points[points.length - 1]?.ts || startedAt;
  const durationMs =
    Number.isFinite(startedAt) && Number.isFinite(endedAt) ? Math.max(0, endedAt - startedAt) : 0;
  return {
    id: session?.id,
    venueId: session?.venueId || '',
    venueName: session?.venueName || '',
    pointCount: points.length,
    metres: Math.round(metres),
    startedAt,
    endedAt,
    durationMs,
    uploadedAt: session?.uploadedAt || null,
    status: session?.uploadedAt ? 'uploaded' : points.length >= 2 ? 'ready' : 'recording',
  };
}

/**
 * Validate an upload body from the phone.
 * Accepts either a Feature, FeatureCollection, or a compact anonymised session.
 */
export function validateTraceUpload(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Expected JSON object' };

  if (body.type === 'FeatureCollection') {
    const features = Array.isArray(body.features) ? body.features : [];
    if (!features.length) return { ok: false, error: 'Empty FeatureCollection' };
    if (features.length > 20) return { ok: false, error: 'Too many features (max 20)' };
    const parsed = [];
    for (const f of features) {
      const one = validateTraceFeature(f);
      if (!one.ok) return one;
      parsed.push(one.trace);
    }
    return { ok: true, traces: parsed };
  }

  if (body.type === 'Feature') {
    const one = validateTraceFeature(body);
    if (!one.ok) return one;
    return { ok: true, traces: [one.trace] };
  }

  // Compact anonymised session shape from anonymizeSession().
  if (body.venueId && Array.isArray(body.points)) {
    const feature = sessionToGeoJSON(body, { anonymize: false });
    const one = validateTraceFeature(feature);
    if (!one.ok) return one;
    return { ok: true, traces: [one.trace] };
  }

  return { ok: false, error: 'Unrecognized trace payload' };
}

function validateTraceFeature(feature) {
  if (!feature || feature.type !== 'Feature') return { ok: false, error: 'Expected Feature' };
  const geom = feature.geometry;
  if (!geom || geom.type !== 'LineString') return { ok: false, error: 'Expected LineString' };
  const coords = geom.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) {
    return { ok: false, error: 'LineString needs at least two points' };
  }
  if (coords.length > MAX_POINTS_PER_SESSION) {
    return { ok: false, error: `Too many points (max ${MAX_POINTS_PER_SESSION})` };
  }
  for (const c of coords) {
    if (!Array.isArray(c) || c.length < 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
      return { ok: false, error: 'Invalid coordinate' };
    }
    if (Math.abs(c[1]) > 90 || Math.abs(c[0]) > 180) {
      return { ok: false, error: 'Coordinate out of range' };
    }
  }
  const props = feature.properties || {};
  const venueId = String(props.venueId || '').trim();
  if (!venueId || venueId.length > 64) return { ok: false, error: 'venueId required' };

  const points = coords.map(([lng, lat], i) => ({
    lat: roundCoord(lat),
    lng: roundCoord(lng),
    t: Number.isFinite(props.times?.[i]) ? Math.round(props.times[i]) : i,
  }));

  return {
    ok: true,
    trace: {
      id: String(props.sessionId || newSessionId()).slice(0, 80),
      venueId,
      startedAt: props.startedAt ?? null,
      endedAt: props.endedAt ?? null,
      metres: Number.isFinite(props.metres) ? props.metres : metresAlong(points),
      pointCount: points.length,
      points,
      receivedAt: Date.now(),
      source: 'parkbound_guest_movement',
    },
  };
}

/**
 * Append a keepable point into session state. Pure — the store persists the result.
 *
 * @returns {{ sessions, openId, recorded: boolean, reason: string }}
 */
export function recordPoint(state, { point, venueId, venueName, bounds }) {
  const sessions = Array.isArray(state?.sessions) ? [...state.sessions] : [];
  let openId = state?.openId || null;
  const decision = shouldKeepPoint({
    prev: lastPointOf(sessions, openId),
    point,
    bounds,
  });
  if (!decision.keep) {
    return { sessions, openId, recorded: false, reason: decision.reason };
  }

  const prev = lastPointOf(sessions, openId);
  if (!openId || shouldStartNewSession(prev, point) || venueChanged(sessions, openId, venueId)) {
    openId = newSessionId(point.ts);
    sessions.push({
      id: openId,
      venueId: venueId || '',
      venueName: venueName || '',
      startedAt: point.ts,
      endedAt: point.ts,
      points: [],
      metres: 0,
      uploadedAt: null,
    });
    trimSessions(sessions);
  }

  const session = sessions.find((s) => s.id === openId);
  if (!session) return { sessions, openId: null, recorded: false, reason: 'missing-session' };
  if (session.points.length >= MAX_POINTS_PER_SESSION) {
    return { sessions, openId, recorded: false, reason: 'session-full' };
  }

  const kept = {
    lat: point.lat,
    lng: point.lng,
    ts: point.ts || Date.now(),
    ...(Number.isFinite(point.acc) ? { acc: point.acc } : {}),
  };
  const last = session.points[session.points.length - 1];
  if (last) session.metres += distance(last.lat, last.lng, kept.lat, kept.lng);
  session.points.push(kept);
  session.endedAt = kept.ts;
  session.venueId = venueId || session.venueId;
  session.venueName = venueName || session.venueName;

  return { sessions, openId, recorded: true, reason: decision.reason };
}

function lastPointOf(sessions, openId) {
  if (!openId) return null;
  const s = sessions.find((x) => x.id === openId);
  if (!s?.points?.length) return null;
  return s.points[s.points.length - 1];
}

function venueChanged(sessions, openId, venueId) {
  if (!openId || !venueId) return false;
  const s = sessions.find((x) => x.id === openId);
  return Boolean(s?.venueId && s.venueId !== venueId);
}

function trimSessions(sessions) {
  while (sessions.length > MAX_SESSIONS) sessions.shift();
}

/** Format metres for the history list. */
export function formatMetres(m) {
  if (!Number.isFinite(m) || m < 1) return '0 m';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 1000) return '<1 min';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${h} h ${rem} min` : `${h} h`;
}
