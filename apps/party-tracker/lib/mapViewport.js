/**
 * Map viewport helpers — frustum culling for heavy SVG layers (Map M0).
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
