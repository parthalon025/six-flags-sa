/* Decluttering.
 *
 * 152 places and ten thousand metres of track compete for the same few hundred
 * pixels. Drawing all of it is what turns a map into a ransom note — the old
 * renderer put "Queen City Stunt Coaster" straight across its own track and ran
 * "The Great Pumpkin Coaster" through the PLANET SNOOPY label.
 *
 * So: place in importance order, and drop whatever will not fit. Importance is
 * a stable property of the place, never of where the camera happens to be, so
 * panning does not make markers flicker in and out of existence.
 */

/** A uniform grid, so a crowded midway does not cost O(n²) box tests. */
const CELL = 32;

export class Declutter {
  constructor() {
    this.cells = new Map();
  }

  static hits(a, b) {
    return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  }

  free(box) {
    const cx0 = Math.floor(box.x0 / CELL);
    const cx1 = Math.floor(box.x1 / CELL);
    const cy0 = Math.floor(box.y0 / CELL);
    const cy1 = Math.floor(box.y1 / CELL);
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cy = cy0; cy <= cy1; cy += 1) {
        const bucket = this.cells.get(`${cx},${cy}`);
        if (!bucket) continue;
        for (const other of bucket) if (Declutter.hits(box, other)) return false;
      }
    }
    return true;
  }

  occupy(box) {
    const cx0 = Math.floor(box.x0 / CELL);
    const cx1 = Math.floor(box.x1 / CELL);
    const cy0 = Math.floor(box.y0 / CELL);
    const cy1 = Math.floor(box.y1 / CELL);
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cy = cy0; cy <= cy1; cy += 1) {
        const key = `${cx},${cy}`;
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(box);
        else this.cells.set(key, [box]);
      }
    }
  }

  /** Take the space if it is free. `pinned` takes it either way. */
  claim(box, pinned = false) {
    if (!pinned && !this.free(box)) return false;
    this.occupy(box);
    return true;
  }
}

export const boxAround = (x, y, halfW, halfH) => ({
  x0: x - halfW,
  x1: x + halfW,
  y0: y - halfH,
  y1: y + halfH,
});

/* IBM Plex Mono at the sizes we label with. Close enough to lay out against,
   and cheaper by far than measuring 150 strings a frame. */
export const textWidth = (text, fontSize, tracking = 0) =>
  String(text).length * (fontSize * 0.6 + tracking);

/** Is any of this box on screen, allowing for chrome at the top and bottom? */
export const onScreen = (box, w, h, pad = 0) =>
  box.x1 > -pad && box.x0 < w + pad && box.y1 > -pad && box.y0 < h + pad;

/** Pull a point inside a rectangle. Used to keep a land's name over its land. */
export function clampInto(x, y, rect) {
  return [Math.min(Math.max(x, rect.x0), rect.x1), Math.min(Math.max(y, rect.y0), rect.y1)];
}

/** The overlap of two rectangles, or null when they miss. */
export function intersect(a, b) {
  const x0 = Math.max(a.x0, b.x0);
  const x1 = Math.min(a.x1, b.x1);
  const y0 = Math.max(a.y0, b.y0);
  const y1 = Math.min(a.y1, b.y1);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, x1, y0, y1 };
}

/* A scale bar has to state a true distance, and it has to be a distance people
   round to. So pick the length, then measure it — not the other way round. The
   old bar set its width to 100·scale px against a CSS max-width of 140px, so
   from zoom 1.4 up it was clamped while still claiming to be 100 m. */
const FEET_STEPS = [25, 50, 100, 250, 500, 1000, 2000, 5280];
const FEET_PER_METRE = 3.28084;

export function scaleBar(pxPerMetre, target = 96) {
  const wanted = target / pxPerMetre; // metres we would like to span
  const wantedFt = wanted * FEET_PER_METRE;
  let feet = FEET_STEPS[0];
  for (const step of FEET_STEPS) if (step <= wantedFt) feet = step;
  const metres = feet / FEET_PER_METRE;
  return {
    px: metres * pxPerMetre,
    feet,
    metres: Math.round(metres),
    label: feet >= 5280 ? '1 mi' : `${feet} ft`,
  };
}

/* The long axis of a land, so its name can lie along it the way a printed park
   map lays it out, rather than sitting horizontally in the middle and reading
   as a single point. Plain principal-component analysis over the polygon's
   vertices — the eigenvector of the 2×2 covariance matrix, which for a
   symmetric 2×2 is one arctangent. */
export function principalAxis(points) {
  const n = points.length;
  if (!n) return null;
  let mx = 0;
  let my = 0;
  for (const [x, y] of points) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;

  let cxx = 0;
  let cyy = 0;
  let cxy = 0;
  for (const [x, y] of points) {
    const dx = x - mx;
    const dy = y - my;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);

  let lo = Infinity;
  let hi = -Infinity;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    const t = (x - mx) * ux + (y - my) * uy;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { mx, my, ux, uy, extent: hi - lo, bounds: { x0, x1, y0, y1 } };
}

/* A gently bowed baseline for a land name, in screen pixels. Text is never
   allowed to run right-to-left: past ±90° the whole line is reversed, so
   walking south never turns INTERNATIONAL STREET upside down. */
export function labelArc(cx, cy, dx, dy, length, bow = 0.05) {
  let ax = dx;
  let ay = dy;
  const mag = Math.hypot(ax, ay) || 1;
  ax /= mag;
  ay /= mag;
  if (ax < 0) {
    ax = -ax;
    ay = -ay;
  }
  const half = length / 2;
  const sx = cx - ax * half;
  const sy = cy - ay * half;
  const ex = cx + ax * half;
  const ey = cy + ay * half;
  // Control point pushed along the normal; the curve then passes ~half of it.
  const off = length * bow;
  const qx = cx - ay * -off;
  const qy = cy - ax * off;
  return `M${sx.toFixed(1)} ${sy.toFixed(1)}Q${qx.toFixed(1)} ${qy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
}
