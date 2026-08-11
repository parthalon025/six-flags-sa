/**
 * Map viewport helpers — frustum culling and SVG transform precision (Map M0).
 *
 * Venue geometry is drawn in mercator metres and moved with an SVG transform.
 * SVG engines often concatenate that transform into float32. Absolute mercator
 * values sit around 1e7, so metre-scale noise becomes several screen pixels at
 * max zoom — the map shimmers under float64 labels while you pan. Rebase the
 * path data (and the matching translate) onto a venue-local origin so matrix
 * coefficients stay small.
 */

/** Expand a view rect by padding fraction of width/height. */
export function paddedViewRect(view, cx, cy, pad = 0.15) {
  const w = view.width || 800;
  const h = view.height || 600;
  const padX = w * pad;
  const padY = h * pad;
  return { left: -padX, top: -padY, right: w + padX, bottom: h + padY, cx, cy, scale: view.scale || 1 };
}

/** Test whether a mercator bbox intersects the visible view (approximate). */
export function bboxInView(bbox, view, spin = { cos: 1, sin: 0 }) {
  if (!bbox) return true;
  const { minX, minY, maxX, maxY } = bbox;
  const corners = [
    [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY],
  ];
  const toScreen = (x, y) => {
    const u = (x - view.x) * view.scale;
    const v = (view.y - y) * view.scale;
    return [u * spin.cos - v * spin.sin + view.cx, u * spin.sin + v * spin.cos + view.cy];
  };
  let sMinX = Infinity;
  let sMinY = Infinity;
  let sMaxX = -Infinity;
  let sMaxY = -Infinity;
  for (const [x, y] of corners) {
    const [sx, sy] = toScreen(x, y);
    sMinX = Math.min(sMinX, sx);
    sMinY = Math.min(sMinY, sy);
    sMaxX = Math.max(sMaxX, sx);
    sMaxY = Math.max(sMaxY, sy);
  }
  const rect = paddedViewRect(view, view.cx, view.cy);
  return !(sMaxX < rect.left || sMinX > rect.right || sMaxY < rect.top || sMinY > rect.bottom);
}

/** Compute mercator bbox from a ring [[lng,lat], ...]. */
export function bboxFromRing(ring) {
  if (!Array.isArray(ring) || ring.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of ring) {
    const lng = pt[0];
    const lat = pt[1];
    const x = lng * 20037508.34 / 180;
    const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * 20037508.34 / 180;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * SVG transform string for venue geometry stored relative to `origin`.
 * View centre stays in absolute mercator; only the translate is rebased.
 *
 * Optional `pixelRatio` snaps the scaled translation to device pixels so a
 * finger-drag on a retina phone does not shimmer from sub-pixel SVG rounding.
 */
export function localViewTransform({
  cx,
  cy,
  rotation = 0,
  scale,
  viewX,
  viewY,
  originX = 0,
  originY = 0,
  pixelRatio = 1,
}) {
  const lx = viewX - originX;
  const ly = viewY - originY;
  const pr = Math.max(1, pixelRatio || 1);
  const snap = (metres) => {
    const px = metres * scale * pr;
    if (!Number.isFinite(px)) return metres;
    return Math.round(px) / (scale * pr);
  };
  return `translate(${cx} ${cy}) rotate(${-rotation}) scale(${scale} ${-scale}) translate(${-snap(lx)} ${-snap(ly)})`;
}

/**
 * Worst-case float32 screen error for a point under a combined SVG matrix.
 * Used by tests to prove absolute mercator shimmers and local origin does not.
 */
export function float32ScreenError(point, view, scale, cx, cy, originX = 0, originY = 0) {
  const f32 = (n) => {
    const buf = new Float32Array(1);
    buf[0] = n;
    return buf[0];
  };
  const lx = point.x - originX;
  const ly = point.y - originY;
  const vx = view.x - originX;
  const vy = view.y - originY;
  const exactX = (point.x - view.x) * scale + cx;
  const exactY = (view.y - point.y) * scale + cy;
  const A = f32(scale);
  const E = f32(cx - scale * vx);
  const F = f32(cy + scale * vy);
  const sx = f32(f32(A * lx) + E);
  const sy = f32(f32(f32(-scale) * ly) + F);
  return Math.hypot(sx - exactX, sy - exactY);
}

/**
 * Snap the view used for frustum membership onto a screen-sized grid so pan
 * frames do not remount path lists every pixel. Returns a stable `{x,y,scale}`.
 */
export function stableCullView(view, cellPx = 160) {
  const scale = view.scale || 1;
  const cellM = cellPx / Math.max(scale, 0.01);
  return {
    x: Math.round(view.x / cellM) * cellM,
    y: Math.round(view.y / cellM) * cellM,
    scale: Math.round(scale * 40) / 40,
  };
}
