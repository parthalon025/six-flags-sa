/**
 * GPS smoothing and map snapping. Canonical, and pure.
 *
 * A constant-velocity Kalman filter damps jitter; accuracy-gated outlier
 * rejection drops the fixes that arrive from under a roof or off a bad
 * satellite geometry; map snapping projects the estimate onto the walkable
 * graph when the phone is inside the venue. Nothing here touches the DOM.
 */

import { distance } from '../geo.js';
import { isValidLocation } from '../core/state.js';
import { MAX_SNAP_M, snapToGraph } from '../routing.js';
import { withinBounds } from '../venue/store.js';

/** Faster than anyone moves on foot at a park. m/s. */
export const MAX_SPEED_MS = 12;
/** Fixes worse than this are not worth updating on. metres. */
export const MAX_ACC_M = 80;
/** Squared Mahalanobis distance above which a fix is treated as an outlier. */
export const CHI2_GATE = 9;
/** After this many consecutive rejections, accept the next fix anyway. */
export const MAX_REJECT_STREAK = 3;
/** Ignore sample pairs closer than this when inferring speed. ms. */
export const MIN_DT_MS = 200;

function metresPerDegree(lat) {
  const cos = Math.cos((lat * Math.PI) / 180);
  return { lat: 111320, lng: 111320 * Math.max(cos, 0.01) };
}

function mul4(A, B) {
  const out = new Array(16).fill(0);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += A[r * 4 + k] * B[k * 4 + c];
      out[r * 4 + c] = s;
    }
  }
  return out;
}

function transpose4(A) {
  const out = new Array(16);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) out[r * 4 + c] = A[c * 4 + r];
  }
  return out;
}

function add4(A, B) {
  return A.map((v, i) => v + B[i]);
}

/** Innovation covariance S = H P H' + R for position-only H. */
function innovCov(P, rVar) {
  return [P[0] + rVar, P[1], P[4], P[5] + rVar];
}

/** 2D Mahalanobis squared distance. */
function mahal2(dx, dy, S) {
  const det = S[0] * S[3] - S[1] * S[2];
  if (det <= 0) return Infinity;
  const invDet = 1 / det;
  const a = S[3] * invDet;
  const b = -S[1] * invDet;
  const d = S[0] * invDet;
  return a * dx * dx + 2 * b * dx * dy + d * dy * dy;
}

/**
 * Factory for a GPS stream smoother.
 *
 * @returns {{ update: (fix) => object, reset: () => void }}
 */
export function createGpsSmoother({
  maxSpeedMs = MAX_SPEED_MS,
  maxAccM = MAX_ACC_M,
  chi2Gate = CHI2_GATE,
  maxRejectStreak = MAX_REJECT_STREAK,
} = {}) {
  let anchor = null;
  let state = null; // { x, y, vx, vy, P, ts, acc }
  let rejectStreak = 0;
  let lastOut = null;

  function toLocal(lat, lng) {
    return {
      x: (lng - anchor.lng) * anchor.mLng,
      y: (lat - anchor.lat) * anchor.mLat,
    };
  }

  function toGeo(x, y) {
    return {
      lat: anchor.lat + y / anchor.mLat,
      lng: anchor.lng + x / anchor.mLng,
    };
  }

  function seed(fix) {
    const scale = metresPerDegree(fix.lat);
    anchor = { lat: fix.lat, lng: fix.lng, mLat: scale.lat, mLng: scale.lng };
    const p = toLocal(fix.lat, fix.lng);
    const acc = Math.max(4, fix.acc ?? 25);
    state = {
      x: p.x,
      y: p.y,
      vx: 0,
      vy: 0,
      P: [acc * acc, 0, 0, 0, 0, acc * acc, 0, 0, 0, 0, 4, 0, 0, 0, 0, 4],
      ts: fix.ts,
      acc,
    };
    rejectStreak = 0;
  }

  function predict(dt) {
    const F = [1, 0, dt, 0, 0, 1, 0, dt, 0, 0, 1, 0, 0, 0, 0, 1];
    const vec = [state.x, state.y, state.vx, state.vy];
    const next = [
      vec[0] + vec[2] * dt,
      vec[1] + vec[3] * dt,
      vec[2],
      vec[3],
    ];
    const FT = transpose4(F);
    const qPos = (0.6 * dt) ** 2;
    const qVel = 0.8 * dt;
    const Q = [qPos, 0, 0, 0, 0, qPos, 0, 0, 0, 0, qVel, 0, 0, 0, 0, qVel];
    const P = add4(mul4(mul4(F, state.P), FT), Q);
    state = { ...state, x: next[0], y: next[1], vx: next[2], vy: next[3], P };
  }

  function updateMeas(zx, zy, rVar) {
    // H picks position only.
    const S = innovCov(state.P, rVar);
    const dx = zx - state.x;
    const dy = zy - state.y;
    const m2 = mahal2(dx, dy, S);
    if (m2 > chi2Gate && rejectStreak < maxRejectStreak) {
      rejectStreak += 1;
      return false;
    }
    rejectStreak = 0;
    const det = S[0] * S[3] - S[1] * S[2];
    if (det <= 0) return false;
    const invDet = 1 / det;
    const kx0 = (state.P[0] * S[3] - state.P[1] * S[2]) * invDet;
    const kx1 = (-state.P[0] * S[1] + state.P[1] * S[0]) * invDet;
    const ky0 = (state.P[4] * S[3] - state.P[5] * S[2]) * invDet;
    const ky1 = (-state.P[4] * S[1] + state.P[5] * S[0]) * invDet;
    const kvx0 = state.P[8] * S[3] * invDet;
    const kvx1 = -state.P[8] * S[1] * invDet;
    const kvy0 = state.P[12] * S[3] * invDet;
    const kvy1 = -state.P[12] * S[1] * invDet;
    state.x += kx0 * dx + kx1 * dy;
    state.y += ky0 * dx + ky1 * dy;
    state.vx += kvx0 * dx + kvx1 * dy;
    state.vy += kvy0 * dx + kvy1 * dy;
    const IKH = [
      1 - kx0,
      -kx1,
      0,
      0,
      -ky0,
      1 - ky1,
      0,
      0,
      -kvx0,
      -kvx1,
      1,
      0,
      -kvy0,
      -kvy1,
      0,
      1,
    ];
    state.P = mul4(IKH, state.P);
    return true;
  }

  function emit(fix, raw, rejected) {
    const geo = toGeo(state.x, state.y);
    const acc = Math.sqrt(Math.max(state.P[0], state.P[5]));
    state.acc = acc;
    const out = {
      lat: geo.lat,
      lng: geo.lng,
      acc,
      ts: fix.ts,
      manual: false,
      raw: { lat: raw.lat, lng: raw.lng, acc: raw.acc ?? null },
      rejected,
      smooth: true,
    };
    if (Number.isFinite(fix.heading)) out.heading = fix.heading;
    if (Number.isFinite(fix.speed)) out.speed = fix.speed;
    lastOut = out;
    return out;
  }

  function reset() {
    anchor = null;
    state = null;
    rejectStreak = 0;
    lastOut = null;
  }

  function update(fix) {
    if (!fix || !isValidLocation(fix)) return lastOut;
    if (fix.manual) {
      reset();
      const out = { ...fix, raw: null, rejected: false, smooth: false };
      lastOut = out;
      return out;
    }

    const raw = {
      lat: fix.lat,
      lng: fix.lng,
      acc: Number.isFinite(fix.acc) ? fix.acc : null,
      ts: fix.ts,
    };
    const acc = Math.max(4, Number.isFinite(fix.acc) ? fix.acc : 25);

    if (state && acc > maxAccM && rejectStreak < maxRejectStreak) {
      rejectStreak += 1;
      return { ...lastOut, ts: fix.ts, rejected: true, raw };
    }

    if (!state) {
      seed({ ...fix, acc });
      return emit(fix, raw, false);
    }

    const dt = Math.max((fix.ts - state.ts) / 1000, MIN_DT_MS / 1000);
    if (dt > 0) predict(dt);

    const meas = toLocal(fix.lat, fix.lng);
    if (lastOut) {
      const implied = distance(lastOut.lat, lastOut.lng, fix.lat, fix.lng) / dt;
      if (implied > maxSpeedMs && rejectStreak < maxRejectStreak) {
        rejectStreak += 1;
        return { ...lastOut, ts: fix.ts, rejected: true, raw };
      }
    }

    const accepted = updateMeas(meas.x, meas.y, acc * acc);
    state.ts = fix.ts;
    state.acc = acc;
    if (!accepted) {
      return lastOut ? { ...lastOut, ts: fix.ts, rejected: true, raw } : emit(fix, raw, true);
    }
    return emit(fix, raw, false);
  }

  return { update, reset };
}

/**
 * Display position: snap to the walkable graph when inside the venue.
 * Navigation mode keeps its own route puck — this is for the idle blue dot.
 */
export function positionForMap({
  position,
  graph,
  bounds,
  walking = false,
  maxSnap = MAX_SNAP_M,
} = {}) {
  if (!position || position.manual || walking) return position;
  if (!graph || !bounds || !withinBounds(bounds, position.lat, position.lng)) return position;

  const snap = snapToGraph(graph, position.lat, position.lng, maxSnap);
  if (!snap) return position;

  const limit = Math.min(maxSnap, Math.max(15, (position.acc ?? 25) * 1.2));
  if (snap.offset > limit) return position;

  return {
    ...position,
    lat: snap.lat,
    lng: snap.lng,
    snapped: true,
    raw: position.raw ?? { lat: position.lat, lng: position.lng, acc: position.acc ?? null },
  };
}
