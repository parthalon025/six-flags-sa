/**
 * Skin bake, iso tier — the RCT-style projection of the SAME bake model.
 *
 * The flat tier's bakeModel output is the single geometry source; this
 * module only projects it. All projection math is imported from the shared
 * iso modules (isoWorld/isoTrack — one implementation, never forked): cell
 * coordinates become north-up world metres (cell y grows south, so it
 * negates), isoLocal spins the quarter-turn view, extrudeBuilding and
 * liftCoaster raise structures, depthKey orders the paint.
 *
 * Everything here is pure and deterministic; the browser page
 * (bin/display-iso-page.html) is a dumb painter of the draw list this
 * module assembles, so the geometry assembly is testable in Node.
 */

import {
  isoLocal,
  depthKey,
  extrudeBuilding,
  liftCoaster,
  buildingHeightM,
  liftHeightAt,
  resolveIsoMapTemplate,
  convexHull,
} from '@party-tracker/shared/isoWorld.js';
import { trackSegments } from '@party-tracker/shared/isoTrack.js';

const r2 = (v) => Math.round(v * 100) / 100;

/** Cell coords (y south/down) → shared-iso world metres (y north/up). */
export const cellToWorld = ([cx, cy], tileMetres) => [cx * tileMetres, -cy * tileMetres];

const worldRing = (ring, t) => ring.map((p) => cellToWorld(p, t));

/**
 * The affine cell→pixel map for one rotation: because isoLocal is linear,
 * a cell step projects to constant screen vectors (ax,ay) per +x and
 * (bx,by) per +y, plus the height term hs (screen px per metre, up).
 * Canvas offsets/size come from the projected grid corners plus headroom
 * for the tallest structure and the badge pins.
 */
export function isoCellMap(model, { rotation = 0, px = 16, template = 'rct-classic' } = {}) {
  const t = model.tileMetres || 1;
  const recipe = resolveIsoMapTemplate(template);
  const e1 = isoLocal(1, 0, rotation); // +1 cell east
  const e2 = isoLocal(0, -1, rotation); // +1 cell south (north-up world)
  const ax = px * e1.x;
  const ay = -px * e1.y; // screen y grows down
  const bx = px * e2.x;
  const by = -px * e2.y;
  const hs = px / t; // screen px per metre of lift
  const corners = [[0, 0], [model.cols, 0], [0, model.rows], [model.cols, model.rows]]
    .map(([cx, cy]) => [cx * ax + cy * bx, cx * ay + cy * by]);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const heights = (model.buildings || []).map((b) => buildingHeightM(worldRing(b.ring, t)));
  const trackTop = model.tracks?.length ? recipe.coasterBaseM + recipe.coasterHeightAmp : 0;
  const headroomM = Math.max(12, trackTop, ...heights) + 4;
  const pad = px;
  const padTop = pad + headroomM * hs + Math.ceil(px * 2.4); // structures + pin discs
  return {
    rotation,
    px,
    tileMetres: t,
    ax,
    ay,
    bx,
    by,
    hs,
    ox: pad - Math.min(...xs),
    oy: padTop - Math.min(...ys),
    width: Math.ceil(Math.max(...xs) - Math.min(...xs) + 2 * pad),
    height: Math.ceil(Math.max(...ys) - Math.min(...ys) + padTop + pad),
  };
}

/** Cell coords (+ metres of lift) → canvas pixel through the affine map. */
export function isoCellToPixel(map, cx, cy, hM = 0) {
  return [
    map.ox + cx * map.ax + cy * map.bx,
    map.oy + cx * map.ay + cy * map.by - hM * map.hs,
  ];
}

/** Extrusion height (metres) per model building, from the world-metre ring. */
export function buildingHeightsM(model) {
  const t = model.tileMetres || 1;
  return (model.buildings || []).map((b) => buildingHeightM(worldRing(b.ring, t)));
}

/**
 * Lift-profile height (metres) at every vertex of every model track —
 * the same travelled-distance sin-hill liftCoaster draws, so sample
 * points and rails agree to the pixel.
 */
export function trackVertexHeightsM(model, template = 'rct-classic') {
  const t = model.tileMetres || 1;
  const recipe = resolveIsoMapTemplate(template);
  const lift = { heightAmp: recipe.coasterHeightAmp, baseHeight: recipe.coasterBaseM };
  return (model.tracks || []).map((tr) => {
    const line = tr.pts.map((p) => cellToWorld(p, t));
    let travelled = 0;
    return line.map((p, i) => {
      if (i > 0) travelled += Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]);
      return liftHeightAt(travelled, lift);
    });
  });
}

/** Darken/lighten a #rgb/#rrggbb color by a factor — wall-face shading. */
export function shade(hex, f) {
  const h = hex.replace('#', '');
  const s = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const ch = (i) => Math.max(0, Math.min(255, Math.round(parseInt(s.slice(i, i + 2), 16) * f)));
  return `#${[0, 2, 4].map((i) => ch(i).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

const pathD = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('');

/* Point-in-hull test against isoWorld's shared convexHull — occlusion
 * culling for the sample plan, the same screen-silhouette idea isoWorld's
 * buildingHitsLiftedTrack uses for its culling. */
function pointInHull(x, y, hull) {
  let inside = false;
  for (let i = 0, j = hull.length - 1; i < hull.length; j = i, i += 1) {
    const { x: xi, y: yi } = hull[i];
    const { x: xj, y: yj } = hull[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * Every building's screen silhouette (convex hull of foot ∪ roof, iso-metre
 * coords) for one rotation. An extruded building hides the ground behind
 * it in this projection — the sample plan skips those points on the record.
 */
export function buildingScreenHulls(model, { rotation = 0 } = {}) {
  const t = model.tileMetres || 1;
  return (model.buildings || []).map((b) => {
    const ring = worldRing(b.ring, t);
    const h = buildingHeightM(ring);
    const foot = ring.map(([x, y]) => isoLocal(x, y, rotation));
    const roof = foot.map((p) => ({ x: p.x, y: p.y + h }));
    return convexHull([...foot, ...roof]);
  });
}

/** True when an iso-metre ground point hides behind any building silhouette. */
export const occludedByBuilding = (x, y, hulls) => hulls.some((hull) => hull.length >= 3 && pointInHull(x, y, hull));

/**
 * The iso draw list: depth-sorted structures (buildings, lifted tracks,
 * trees) plus screen-space badge anchors, all styled from the kit — the
 * same palette the flat tier certifies. Ground diamonds stay page-side
 * (a pure affine iteration of model.cells through `map`); everything
 * with depth is assembled here.
 *
 * Track segments (isoTrack's climb/drop vocabulary) ride each track item
 * as `emphasis` overlay paths: the painter strokes them wider (coaster
 * rail) or with the casing color widened (slide) — subtle, deterministic.
 *
 * @param {object} model bakeModel output — never re-derived truth
 * @param {object} kit resolved kit (resolveKit)
 */
export function isoBakeGeometry(model, kit, {
  rotation = 0, px = 16, template = 'rct-classic', treeAsset = null,
} = {}) {
  const map = isoCellMap(model, { rotation, px, template });
  const t = map.tileMetres;
  const recipe = resolveIsoMapTemplate(template);
  const items = [];

  const B = kit.sprites.building;
  (model.buildings || []).forEach((b, i) => {
    const ring = worldRing(b.ring, t);
    const h = buildingHeightM(ring);
    const ext = extrudeBuilding(ring, h, { rotation });
    items.push({
      type: 'building',
      seq: items.length,
      i,
      depth: ext.depth,
      roof: { d: ext.roof.d, color: B.roofs[b.roof % B.roofs.length] },
      walls: [...ext.walls]
        .sort((a, z) => z.depth - a.depth)
        .map((w) => ({ d: w.d, color: w.side === 'L' ? shade(B.wall, 0.82) : B.wall })),
      edge: B.edge,
      edgeW: 1.6 / map.hs, // ~1.6 screen px, in metres
    });
  });

  const lift = {
    stepM: recipe.coasterStepM,
    heightAmp: recipe.coasterHeightAmp,
    baseHeight: recipe.coasterBaseM,
  };
  const vertexHeights = trackVertexHeightsM(model, template);
  const CO = kit.sprites.coaster;
  const SL = kit.sprites.slide;
  (model.tracks || []).forEach((tr, i) => {
    const line = tr.pts.map((p) => cellToWorld(p, t));
    const lc = liftCoaster(line, { ...lift, rotation });
    const lifted = line.map((p, v) => {
      const g = isoLocal(p[0], p[1], rotation);
      return { x: g.x, y: g.y + vertexHeights[i][v] };
    });
    // Segment slices share boundary vertices: seg k starts where k-1 ended.
    const emphasis = [];
    let idx0 = 0;
    for (const seg of trackSegments(line, { template })) {
      const n = seg.points.length;
      if (seg.kind === 'climb' || seg.kind === 'drop') {
        emphasis.push({ kind: seg.kind, d: pathD(lifted.slice(idx0, idx0 + n)) });
      }
      idx0 += n - 1;
    }
    const slide = tr.kind === 'slide';
    items.push({
      type: 'track',
      kind: tr.kind,
      seq: items.length,
      i,
      depth: lc.depth,
      shadow: lc.shadow.d,
      track: lc.track.d,
      supports: lc.supports.map((s) => s.d),
      emphasis,
      color: slide ? SL.colors[tr.idx % SL.colors.length] : CO.rail,
      casing: slide ? SL.casing : null,
      support: slide ? SL.casing : CO.tie,
      w: {
        shadow: 0.62 * t,
        casing: 0.68 * t * (slide ? SL.width : 1),
        fill: 0.42 * t * (slide ? SL.width : 1),
        emphasis: slide ? 0.92 * t * SL.width : 0.58 * t,
        support: 0.12 * t,
      },
    });
  });

  const TR = kit.sprites.tree;
  if (TR.style !== 'none') {
    for (const tree of model.trees || []) {
      const [wx, wy] = cellToWorld([tree.x, tree.y], t);
      const g = isoLocal(wx, wy, rotation);
      items.push({
        type: 'tree',
        seq: items.length,
        depth: depthKey({ x: wx, y: wy }, rotation),
        x: r2(g.x),
        y: r2(g.y),
        r: (tree.big ? 0.44 : 0.3) * t * (TR.scale || 1),
        canopy: TR.canopy,
        highlight: TR.highlight,
        shadow: TR.shadow,
        sprite: treeAsset ? true : false,
      });
    }
  }

  // Larger depthKey = farther from the camera = paints first.
  items.sort((a, b) => b.depth - a.depth || a.seq - b.seq);

  const badges = (model.badges || []).map((b) => {
    const [sx, sy] = isoCellToPixel(map, b.x, b.y, 0);
    return { kind: b.kind, sx: r2(sx), sy: r2(sy) };
  });

  return { map, items, badges, treeAsset };
}
