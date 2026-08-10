/**
 * Adaptive GPS policy and broadcast gating. Canonical, and pure.
 *
 * Two knobs decide how much battery the app costs on a ten-hour park day:
 * how often the radio is asked for a fix, and how often a fix is worth putting
 * on the wire. Both rules live here, with no browser in sight, so the hook, the
 * party layer and the tests all agree on the answer.
 *
 * Nothing in this file may touch `window`, `document` or `navigator` — it has
 * to run in plain Node.
 */

import { distance } from '../geo.js';
import { isValidLocation } from '../core/state.js';

export const MOTION = {
  WALKING: 'walking',
  STANDING: 'standing',
  BACKGROUND: 'background',
};

/**
 * Sampling band per motion state, in milliseconds. `min` is the fast end (good
 * battery), `max` the slow end (nearly flat). Walking needs a fix every few
 * seconds or the map lies about which queue you are standing in; standing in a
 * 40-minute line does not.
 */
export const CADENCE = {
  [MOTION.WALKING]: { min: 3000, max: 5000 },
  [MOTION.STANDING]: { min: 15000, max: 30000 },
  [MOTION.BACKGROUND]: { min: 60000, max: 120000 },
};

/** Below this, sustained, you are queueing rather than walking. m/s. */
export const WALK_SPEED_MS = 0.35;

/** Battery levels that bracket the interpolation. See `cadenceFor`. */
export const BATTERY_HEALTHY = 0.5;
export const BATTERY_LOW = 0.2;

/**
 * Classify motion from the best speed evidence available.
 *
 * The GPS `speed` field is preferred because the chip derives it from Doppler
 * rather than from two noisy positions. Falling back to the last two samples
 * is fine over a multi-second gap but would amplify jitter over a short one,
 * so very close samples are skipped.
 *
 * Unknown speed reports `standing`: guessing slow costs a little freshness,
 * guessing fast costs the battery, and the battery is the scarce one.
 */
export function classifyMotion({ speed, recent, isBackground } = {}) {
  // A backgrounded tab cannot show a map, so nothing it might learn is worth
  // the radio. This outranks any speed reading.
  if (isBackground) return MOTION.BACKGROUND;

  const ms = Number.isFinite(speed) && speed >= 0 ? speed : derivedSpeed(recent);
  if (ms == null) return MOTION.STANDING;
  return ms >= WALK_SPEED_MS ? MOTION.WALKING : MOTION.STANDING;
}

/** Minimum gap between two samples before their delta is trusted as a speed. */
const MIN_SAMPLE_GAP_MS = 750;

function derivedSpeed(recent) {
  if (!Array.isArray(recent) || recent.length < 2) return null;
  const b = recent[recent.length - 1];
  const a = recent[recent.length - 2];
  if (!isValidLocation(a) || !isValidLocation(b)) return null;
  const dt = b.ts - a.ts;
  if (dt < MIN_SAMPLE_GAP_MS) return null;
  return distance(a.lat, a.lng, b.lat, b.lng) / (dt / 1000);
}

/**
 * Milliseconds between fixes for a motion state, given what we know about the
 * battery.
 *
 * Interpolation: a "drain" factor t runs 0 → 1 as the level falls from
 * BATTERY_HEALTHY (0.5) to BATTERY_LOW (0.2), and the result is
 * `min + t * (max - min)`. So a half-full phone samples at the fast end of its
 * band, a phone at or under 20% samples at the slow end, and the stretch in
 * between is linear rather than a cliff the user would feel as the map
 * suddenly going stale. Charging pins t to 0 — mains power is not scarce.
 *
 * An unknown battery (the common case; most browsers dropped the API) is
 * treated as healthy. Guessing "low" would quietly halve everyone's update
 * rate on the strength of no evidence at all.
 */
export function cadenceFor(motion, { battery } = {}) {
  const band = CADENCE[motion] || CADENCE[MOTION.STANDING];
  const level = battery && Number.isFinite(battery.level) ? battery.level : null;
  if (level == null || battery.charging) return band.min;
  const t = clamp((BATTERY_HEALTHY - level) / (BATTERY_HEALTHY - BATTERY_LOW), 0, 1);
  return Math.round(band.min + t * (band.max - band.min));
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Smallest signed angle between two bearings, in degrees. */
function headingDelta(a, b) {
  const d = Math.abs(((b - a + 540) % 360) - 180);
  return d;
}

/**
 * The broadcast gate: given a fix, decide whether it earns a transmission.
 *
 * Sending every fix is the single most expensive thing the app can do, so the
 * gate answers with a reason as well as a verdict — the diagnostics panel
 * shows the reason, which is the only way anyone notices when the policy
 * starts misbehaving in the field.
 *
 * Sends when the position moved `distanceM`, the heading turned `headingDeg`,
 * the ride target changed, or `heartbeatMs` has passed with nothing to say.
 * `minIntervalMs` caps all of it, including target changes: a friend tapping
 * through the ride list must not become a packet storm.
 */
export function createBroadcastGate({
  minIntervalMs = 3000,
  distanceM = 12,
  headingDeg = 25,
  heartbeatMs = 20000,
} = {}) {
  let last = null;
  let lastTarget = null;
  let lastSentAt = 0;

  function shouldSend(next, ctx = {}) {
    const now = Number.isFinite(ctx.now)
      ? ctx.now
      : Number.isFinite(next?.ts)
        ? next.ts
        : Date.now();
    const fix = { ...next, ts: now };
    if (!isValidLocation(fix)) return { send: false, reason: 'invalid' };

    // The compass is a fine heading source when the GPS has none — standing
    // still and turning to face a ride is exactly the update friends want.
    const heading = firstFinite(next?.heading, ctx.heading);
    const target = ctx.target ?? null;
    const send = (reason) => commit(fix, heading, target, now, reason);

    if (!last) return send('first');
    if (now - lastSentAt < minIntervalMs) return { send: false, reason: 'rate-limited' };
    if (target !== lastTarget) return send('target');
    if (distance(last.lat, last.lng, fix.lat, fix.lng) >= distanceM) return send('moved');
    if (
      heading != null &&
      Number.isFinite(last.heading) &&
      headingDelta(last.heading, heading) >= headingDeg
    ) {
      return send('heading');
    }
    if (now - lastSentAt >= heartbeatMs) return send('heartbeat');
    return { send: false, reason: 'unchanged' };
  }

  function commit(fix, heading, target, now, reason) {
    // A fix without a heading keeps the last known one, so a momentary dropout
    // doesn't reset the turn detector.
    last = { lat: fix.lat, lng: fix.lng, heading: heading == null ? last?.heading : heading };
    lastTarget = target;
    lastSentAt = now;
    return { send: true, reason };
  }

  function reset() {
    last = null;
    lastTarget = null;
    lastSentAt = 0;
  }

  return { shouldSend, reset };
}

function firstFinite(...values) {
  for (const v of values) if (Number.isFinite(v)) return v;
  return null;
}
