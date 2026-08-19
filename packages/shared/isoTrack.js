/**
 * Coaster segment vocabulary — classify a track polyline for the iso painter.
 *
 * A coaster in truth is one undifferentiated ribbon of [[x,y], ...] local
 * mercator metres. This module walks it with the SAME lift profile the iso
 * renderer draws (isoWorld's liftHeightAt — one implementation, imported)
 * and emits a deterministic sequence of segments so painters can style lift
 * hills, drops, and turns differently. Station detection is out of scope.
 */

import { liftHeightAt, resolveIsoMapTemplate } from './isoWorld.js';

/** The whole vocabulary, paint-legend order. */
export const TRACK_SEGMENT_KINDS = ['flat', 'climb', 'drop', 'turn-left', 'turn-right'];

/** Rise/run above which an edge reads as climb (negated, drop) — gentler grades paint flat. */
export const GRADE_THRESHOLD = 0.08;

/** Heading change (degrees) accumulated across a vertex that reads as a turn, not a wobble. */
export const TURN_THRESHOLD_DEG = 30;

/** 2-decimal metres; normalizes -0 so deepEqual never sees a signed zero. */
const round2 = (v) => Math.round(v * 100) / 100 || 0;

function headingDeg(a, b) {
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
}

/** Signed turn, normalized to (-180, 180]; positive is left (CCW, x east / y north). */
function headingDelta(prev, next) {
  let d = next - prev;
  while (d <= -180) d += 360;
  while (d > 180) d -= 360;
  return d;
}

/**
 * Classify a coaster polyline into a deterministic segment sequence.
 *
 * Lift parameters resolve exactly like assembleIsoMeshes: explicit opts win
 * over the template's coaster fields. stepM (support spacing) rides the
 * option bag for parity but has no bearing on classification.
 *
 * Per edge: grade = lift rise / run against GRADE_THRESHOLD; at each
 * interior vertex, same-sign heading changes accumulate and a flat edge
 * past TURN_THRESHOLD_DEG becomes a turn (turns never outrank climb/drop).
 * Consecutive same-kind edges merge; neighbors share their boundary vertex.
 *
 * @param {number[][]} line [[x,y], ...] local mercator metres
 * @param {{ stepM?: number, heightAmp?: number, baseHeight?: number, template?: string|object }} [opts]
 * @returns {{ kind: string, fromM: number, toM: number, points: number[][], rise: number }[]}
 */
export function trackSegments(line, { heightAmp, baseHeight, template = 'rct-classic' } = {}) {
  const pts = (line || []).filter((p) => Array.isArray(p) && p.length >= 2);
  if (pts.length < 2) return [];
  const recipe = resolveIsoMapTemplate(template);
  const lift = {
    heightAmp: heightAmp ?? recipe.coasterHeightAmp,
    baseHeight: baseHeight ?? recipe.coasterBaseM,
  };

  const travelled = [0];
  for (let i = 1; i < pts.length; i += 1) {
    travelled.push(travelled[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const heights = travelled.map((t) => liftHeightAt(t, lift));

  const kinds = [];
  let acc = 0; // signed heading change, accumulated while the curve keeps bending one way
  for (let i = 0; i < pts.length - 1; i += 1) {
    const run = travelled[i + 1] - travelled[i];
    const grade = run > 1e-9 ? (heights[i + 1] - heights[i]) / run : 0;
    let kind = 'flat';
    if (grade > GRADE_THRESHOLD) kind = 'climb';
    else if (grade < -GRADE_THRESHOLD) kind = 'drop';
    if (i > 0) {
      const d = headingDelta(headingDeg(pts[i - 1], pts[i]), headingDeg(pts[i], pts[i + 1]));
      acc = Math.sign(d) === Math.sign(acc) ? acc + d : d;
      if (kind === 'flat' && Math.abs(acc) > TURN_THRESHOLD_DEG) {
        kind = acc > 0 ? 'turn-left' : 'turn-right';
        acc = 0;
      }
    }
    kinds.push(kind);
  }

  const runs = [];
  for (let i = 0; i < kinds.length; i += 1) {
    const last = runs[runs.length - 1];
    if (last && last.kind === kinds[i]) last.end = i + 1;
    else runs.push({ kind: kinds[i], start: i, end: i + 1 });
  }
  return runs.map((r) => ({
    kind: r.kind,
    fromM: round2(travelled[r.start]),
    toM: round2(travelled[r.end]),
    points: pts.slice(r.start, r.end + 1).map((p) => [p[0], p[1]]),
    rise: round2(heights[r.end] - heights[r.start]),
  }));
}

/** Roll segments up for cert rows: counts per kind plus total classified length. */
export function segmentStats(segments = []) {
  const byKind = Object.fromEntries(TRACK_SEGMENT_KINDS.map((k) => [k, 0]));
  let lengthM = 0;
  for (const s of segments) {
    byKind[s.kind] = (byKind[s.kind] || 0) + 1;
    lengthM += s.toM - s.fromM;
  }
  return { total: segments.length, byKind, lengthM: round2(lengthM) };
}
