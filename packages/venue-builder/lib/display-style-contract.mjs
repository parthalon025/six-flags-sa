/**
 * Style contract — hold real bake pixels to the reference profile.
 *
 * The certifier upgrade over PR #447's visual matrix: sample points are
 * computed from the bake model (we know the terrain class of every cell),
 * the page samples its own canvas at those points (getImageData — no PNG
 * decoder, no new deps), and this module turns {points, samples, profile}
 * into the same check() rows the display certification already speaks.
 * Mechanical rows gate; agent-review prompts ride a separate `review`
 * array because certified must stay a machine statement.
 */

import { check } from './evidence.mjs';
import { TERRAIN_NAMES } from './display-bake.mjs';
import {
  isoCellMap, isoCellToPixel, buildingHeightsM, trackVertexHeightsM,
  buildingScreenHulls, occludedByBuilding,
} from './display-iso.mjs';

/* ------------------------------------------------------------ color math */

const srgbToLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** sRGB [r,g,b] → CIE Lab (D65). */
export function rgbToLab([r, g, b]) {
  const [lr, lg, lb] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  // linear sRGB → XYZ (D65), then f(t) per CIE
  const x = (0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047;
  const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const z = (0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 ΔE between two sRGB colors. */
export function deltaE(a, b) {
  const [l1, a1, b1] = rgbToLab(a);
  const [l2, a2, b2] = rgbToLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

export const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  const s = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};

const rgbToHex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

const median = (nums) => {
  const s = [...nums].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Per-channel median color of a sample set. */
export const medianColor = (colors) => [0, 1, 2].map((i) => median(colors.map((c) => c[i])));

/** Nearest-family ΔE: the best match among anchor + members. */
export function familyDistance(color, family) {
  const candidates = [family.anchor, ...(family.members || [])].map(hexToRgb);
  return Math.min(...candidates.map((c) => deltaE(color, c)));
}

/* --------------------------------------------------------- sample points */

const ringCentroid = (ring) => {
  const n = ring.length;
  return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
};

const insideRing = ([px, py], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/**
 * Truth-derived sample plan, all coordinates in cell space. Deterministic:
 * interior cells (4-neighbors share the class) picked at even strides per
 * class, plus one point per building (interior + edge), per track vertex
 * run, per road polyline, and per badge disc.
 */
export function stylePoints(model, { perClass = 48 } = {}) {
  const { cols, rows, cells, buildings = [], tracks = [], roads = [], badges = [] } = model;
  const at = (x, y) => cells[y * cols + x];
  const interior = {};
  for (let y = 1; y < rows - 1; y += 1) {
    for (let x = 1; x < cols - 1; x += 1) {
      const t = at(x, y);
      if (at(x - 1, y) === t && at(x + 1, y) === t && at(x, y - 1) === t && at(x, y + 1) === t) {
        (interior[t] = interior[t] || []).push([x + 0.5, y + 0.5]);
      }
    }
  }
  // Classes with no pure-interior cell (thin ribbons like a walkway floor)
  // fall back to any cell of the class — noisier, but a median over edge
  // pixels still beats a silently missing family.
  const anyCell = {};
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const t = at(x, y);
      if (!interior[t]) (anyCell[t] = anyCell[t] || []).push([x + 0.5, y + 0.5]);
    }
  }
  const points = [];
  for (const [t, cellsOfClass] of Object.entries({ ...anyCell, ...interior })) {
    const cls = TERRAIN_NAMES[t];
    const stride = Math.max(1, Math.floor(cellsOfClass.length / perClass));
    for (let i = 0; i < cellsOfClass.length && points.filter((p) => p.cls === cls).length < perClass; i += stride) {
      points.push({ cls, x: cellsOfClass[i][0], y: cellsOfClass[i][1] });
    }
  }
  buildings.forEach((b, i) => {
    const c = ringCentroid(b.ring);
    if (insideRing(c, b.ring)) points.push({ cls: 'structure', mode: 'interior', idx: i, x: c[0], y: c[1] });
    // A 2px outline stroke is easy to miss with one rounded sample — take
    // up to four edge midpoints and let the certifier keep the best.
    for (let e = 0; e < Math.min(4, b.ring.length - 1); e += 1) {
      const [a, z] = [b.ring[e], b.ring[e + 1]];
      points.push({ cls: 'structure', mode: 'edge', idx: i, x: (a[0] + z[0]) / 2, y: (a[1] + z[1]) / 2 });
    }
  });
  tracks.forEach((t, i) => {
    for (let v = 1; v < t.pts.length - 1; v += Math.max(1, Math.floor(t.pts.length / 5))) {
      const [x, y] = t.pts[v];
      const under = TERRAIN_NAMES[at(Math.min(cols - 1, Math.floor(x)), Math.min(rows - 1, Math.floor(y)))];
      points.push({ cls: 'track', idx: i, under, x, y });
      // The tube's casing carries legibility when the fill matches the
      // terrain (a green flume over a lawn): sample the edge too,
      // perpendicular to the local run direction.
      const [px2, py2] = t.pts[Math.min(v + 1, t.pts.length - 1)];
      const [px0, py0] = t.pts[Math.max(v - 1, 0)];
      const len = Math.hypot(px2 - px0, py2 - py0) || 1;
      // 0.26 cells sits inside the casing ring (fill radius ~0.21, casing
      // radius ~0.32 at the compositor's tube widths). Both sides: at a
      // sharp bend the inner offset can stay inside the fill.
      const [nx, ny] = [-(py2 - py0) / len, (px2 - px0) / len];
      points.push({ cls: 'trackedge', idx: i, under, x: x + nx * 0.26, y: y + ny * 0.26 });
      points.push({ cls: 'trackedge', idx: i, under, x: x - nx * 0.26, y: y - ny * 0.26 });
    }
  });
  roads.filter((r) => r.kind === 'path').forEach((r, i) => {
    for (let v = 1; v < r.pts.length - 1; v += Math.max(1, Math.floor(r.pts.length / 4))) {
      points.push({ cls: 'roadline', idx: i, x: r.pts[v][0], y: r.pts[v][1] });
    }
  });
  // The disc-ink moat: glyphs stop at 0.23 cells (1.1 × 0.42/2), the white
  // ring starts at 0.37 — ±0.32 lands in pure disc ink on either side, and
  // the certifier keeps each badge's best sample.
  badges.forEach((b, i) => {
    points.push({ cls: 'badge', idx: i, x: b.x + 0.32, y: b.y - 0.63 });
    points.push({ cls: 'badge', idx: i, x: b.x - 0.32, y: b.y - 0.63 });
  });
  return points;
}

/**
 * The iso tier's sample plan: the SAME truth-derived stylePoints selection,
 * with only the coordinates re-projected — truth cell → isoLocal(rotation)
 * → pixel, through the exact affine map the iso painter draws with.
 *
 * Lifted geometry keeps its lift: track points project at the rail's
 * height (trackVertexHeightsM — the painter's own sin-hill), structure
 * interior points at the roof plane (the iso structure check compares the
 * roof color family), and badge offsets apply in SCREEN pixels because
 * pins are screen-space annotation in both tiers.
 *
 * Point classes the projection makes structurally unsound are SKIPPED on
 * the record, never silently dropped: each skip carries a named key +
 * reason, and certifyStyleContract turns them into explicit check rows.
 * That includes occlusion: ground-plane samples hidden behind a building
 * extrusion at this rotation test the building, not the terrain paint.
 *
 * @returns {{ map: object, points: object[], skips: {key,reason,count}[] }}
 */
export function isoStylePoints(model, points, { rotation = 0, px = 16, template = 'rct-classic' } = {}) {
  const map = isoCellMap(model, { rotation, px, template });
  const bHeights = buildingHeightsM(model);
  const tHeights = trackVertexHeightsM(model, template);
  const hulls = buildingScreenHulls(model, { rotation });
  const t = model.tileMetres || 1;
  const groundCls = new Set([...Object.values(TERRAIN_NAMES), 'roadline']);
  const kept = [];
  const skipped = {};
  const skip = (key, reason) => {
    skipped[key] = skipped[key] || { key, reason, count: 0 };
    skipped[key].count += 1;
  };
  const r2 = (v) => Math.round(v * 100) / 100;
  for (const p of points) {
    if (p.cls === 'trackedge') {
      skip('trackedge', 'the ±0.26-cell casing-edge offsets are flat tube geometry; they do not survive the iso lift and projection');
      continue;
    }
    if (p.cls === 'structure' && p.mode === 'edge') {
      skip('structure_edge', 'flat outline strokes have no counterpart on an extruded building; the roof plane carries the interior sample instead');
      continue;
    }
    let sx;
    let sy;
    if (p.cls === 'badge') {
      const b = model.badges[p.idx];
      const [ax, ay] = isoCellToPixel(map, b.x, b.y, 0);
      sx = ax + (p.x - b.x) * px;
      sy = ay + (p.y - b.y) * px;
    } else if (p.cls === 'structure') {
      [sx, sy] = isoCellToPixel(map, p.x, p.y, bHeights[p.idx]);
    } else if (p.cls === 'track') {
      const tr = model.tracks[p.idx];
      const v = tr.pts.findIndex((q) => q[0] === p.x && q[1] === p.y);
      [sx, sy] = isoCellToPixel(map, p.x, p.y, v >= 0 ? tHeights[p.idx][v] : 0);
    } else {
      [sx, sy] = isoCellToPixel(map, p.x, p.y, 0);
      if (groundCls.has(p.cls)
        && occludedByBuilding((sx - map.ox) / map.hs, (map.oy - sy) / map.hs, hulls)) {
        skip('occluded', 'ground-plane samples hidden behind a building extrusion at this rotation test the building, not the terrain paint');
        continue;
      }
    }
    kept.push({ ...p, sx: r2(sx), sy: r2(sy) });
  }
  return { map, points: kept, skips: Object.values(skipped) };
}

/* ---------------------------------------------------------- certification */

/** FNV-1a over sample bytes — the cross-kit / determinism signature. */
export function signature(samples) {
  let h = 2166136261;
  for (const s of samples) {
    for (const v of s) {
      h ^= v & 0xff;
      h = Math.imul(h, 16777619);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const groupMedians = (points, samples) => {
  const groups = {};
  points.forEach((p, i) => {
    if (!samples[i]) return;
    (groups[p.cls] = groups[p.cls] || []).push({ point: p, color: samples[i].slice(0, 3) });
  });
  const medians = {};
  for (const [cls, list] of Object.entries(groups)) medians[cls] = medianColor(list.map((e) => e.color));
  return { groups, medians };
};

/**
 * The mechanical style-contract rows + the agent-review items, from one
 * bake's sampled pixels. Pure: everything it needs rides its arguments.
 * `rerunSamples` (a second render of the same model) powers the
 * determinism row; `siblings` ([{kit, signature}] from the same
 * invocation) powers cross-kit distinctness — pass an empty array to
 * record an explicit skip rather than omitting the row.
 *
 * `target` names the render tier ('flat' default). For 'iso' the same
 * rows run against the iso projection's samples; the profile's optional
 * `iso` block may override family tolerances (iso.toleranceOverrides)
 * and the track margin (iso.structures.coasterVsUnderlay.minDeltaE).
 * `skips` ([{key, reason, count}] from isoStylePoints) become explicit
 * pass rows so a projection-skipped check is visible, never silent.
 */
export function certifyStyleContract({
  model, points, samples, rerunSamples = null, siblings = null, profile, kit,
  target = 'flat', skips = null,
}) {
  const { groups, medians } = groupMedians(points, samples);
  const sig = signature(samples);
  const baseFams = profile.colorFamilies || {};
  const isoOverrides = (target === 'iso' && profile.iso?.toleranceOverrides) || {};
  const fams = Object.fromEntries(Object.entries(baseFams).map(([cls, fam]) => [
    cls,
    isoOverrides[cls] && fam && typeof fam === 'object' ? { ...fam, deltaE: isoOverrides[cls] } : fam,
  ]));
  const checks = [];
  const dE = (a, b) => Math.round(deltaE(a, b) * 10) / 10;

  checks.push(check({
    key: 'reference_profile_resolves',
    claim: `kit "${kit.id}" has a committed reference profile`,
    pass: profile.kit === kit.id,
    evidence: `profile ${profile.id} (style ${profile.style})`,
    confidence: 1,
    falsifier: 'a kit on disk with no profile under data/display/references/',
    soWhat: 'no contract, no certification — the look would drift unmeasured',
  }));

  const terrainRows = [];
  let worst = null;
  for (const [cls, family] of Object.entries(fams)) {
    if (cls === 'draft' || cls === 'structure' || cls === 'badge' || !medians[cls]) continue;
    const nearest = Math.round(familyDistance(medians[cls], family) * 10) / 10;
    terrainRows.push({ cls, nearest, tolerance: family.deltaE });
    if (!worst || nearest / family.deltaE > worst.nearest / worst.tolerance) worst = { cls, nearest, tolerance: family.deltaE };
  }
  checks.push(check({
    key: 'style_terrain_palette',
    claim: 'every sampled terrain class stays inside its profile color family',
    pass: terrainRows.every((r) => r.nearest <= r.tolerance),
    evidence: terrainRows.map((r) => `${r.cls} ΔE ${r.nearest}/${r.tolerance}`).join(', ') || 'no terrain classes sampled',
    confidence: 0.9,
    falsifier: `worst class ${worst ? worst.cls : 'n/a'} beyond tolerance on a rerun`,
    soWhat: 'palette drift is the first way a design language stops matching its reference',
  }));

  // The park floor a road must separate from: ground where the venue has
  // it, else the class that actually carpets the park (all-lawn venues).
  const floorName = ['ground', 'grass', 'lot'].find((n) => medians[n]);
  const floor = floorName ? medians[floorName] : null;

  if (profile.roads?.vsGround && medians.road && floor) {
    const d = dE(medians.road, floor);
    const [lRoad] = rgbToLab(medians.road);
    const [lGround] = rgbToLab(floor);
    const polarity = profile.roads.vsGround.polarity;
    const polarityOk = polarity === 'darker' ? lRoad < lGround : polarity === 'lighter' ? lRoad > lGround : true;
    checks.push(check({
      key: 'style_road_hierarchy',
      claim: `roads separate from the park floor (ΔE ≥ ${profile.roads.vsGround.minDeltaE}, ${polarity})`,
      pass: d >= profile.roads.vsGround.minDeltaE && polarityOk,
      evidence: `road vs ${floorName} ΔE ${d}, L* ${Math.round(lRoad)} vs ${Math.round(lGround)}`,
      confidence: 0.9,
      falsifier: 'a kit whose roads dissolve into the floor on a phone outdoors',
      soWhat: 'wayfinding is the map’s one job',
    }));
  } else if (profile.roads?.centerlineVsPaper && groups.roadline && floor) {
    const best = Math.max(...groups.roadline.map((e) => dE(e.color, floor)));
    checks.push(check({
      key: 'style_road_hierarchy',
      claim: `road centerline ink separates from paper (ΔE ≥ ${profile.roads.centerlineVsPaper.minDeltaE})`,
      pass: best >= profile.roads.centerlineVsPaper.minDeltaE,
      evidence: `best roadline sample vs paper ΔE ${best}`,
      confidence: 0.85,
      falsifier: 'linework styles whose ink fades into the paper',
      soWhat: 'near-monochrome styles carry hierarchy in ink, not fill',
    }));
  }

  if (medians.water) {
    const min = profile.ground?.waterVsVegetation?.minDeltaE ?? 20;
    const dGrass = medians.grass ? dE(medians.water, medians.grass) : null;
    const dGround = medians.ground ? dE(medians.water, medians.ground) : null;
    const worstWater = Math.min(...[dGrass, dGround].filter((v) => v !== null));
    checks.push(check({
      key: 'style_water_legibility',
      claim: `water reads as water (ΔE ≥ ${min} vs vegetation and ground)`,
      pass: worstWater >= min,
      evidence: `water vs grass ΔE ${dGrass ?? '—'}, vs ground ΔE ${dGround ?? '—'}`,
      confidence: 0.9,
      falsifier: 'a pool that reads as lawn',
      soWhat: 'the kit brief’s own promise, now enforced',
    }));
  }

  if (medians.outside && floor) {
    const min = profile.ground?.outsideVsInside?.minDeltaE ?? 12;
    const d = dE(medians.outside, floor);
    checks.push(check({
      key: 'style_outside_distinct',
      claim: `the world outside the venue separates from the park floor (ΔE ≥ ${min})`,
      pass: d >= min,
      evidence: `outside vs ${floorName} ΔE ${d}`,
      confidence: 0.9,
      falsifier: 'a bake where the park has no edge',
      soWhat: 'the boundary is the first thing the reference maps establish',
    }));
  }

  const structureMode = profile.structures?.buildingStyle === 'outline' ? 'edge' : 'interior';
  const structureFamily = structureMode === 'edge' ? (profile.structures?.edgeInk || fams.structure) : fams.structure;
  const structureSamples = (groups.structure || []).filter((e) => e.point.mode === structureMode);
  if (structureFamily && model.buildings?.length) {
    // Per building, the best of its samples — one stroke hit proves the
    // treatment painted; rounding misses on the other edges don't.
    const perBuilding = {};
    for (const e of structureSamples) {
      const d = familyDistance(e.color, structureFamily);
      perBuilding[e.point.idx] = Math.min(perBuilding[e.point.idx] ?? Infinity, d);
    }
    const sampled = Object.keys(perBuilding).length;
    const matched = Object.values(perBuilding).filter((d) => d <= structureFamily.deltaE).length;
    checks.push(check({
      key: 'style_structure_presence',
      claim: `buildings paint in the profile's ${structureMode} treatment`,
      pass: sampled > 0 && matched >= Math.ceil(sampled / 2),
      evidence: `${matched}/${sampled} buildings show ${structureMode} treatment (${model.buildings.length} total)`,
      confidence: 0.8,
      falsifier: 'a kit whose buildings vanish into terrain',
      soWhat: 'structures are the landmarks navigation hangs on',
    }));
  }

  if (groups.track?.length) {
    const margin = (target === 'iso' ? profile.iso?.structures?.coasterVsUnderlay?.minDeltaE : null)
      ?? profile.structures?.coasterVsUnderlay?.minDeltaE ?? 10;
    // Compare against the under-terrain's BASE fill only: family members
    // often carry stroke inks (a road's centerline, water's hatch), and a
    // track legitimately shares ink vocabulary with those in linework
    // styles — the cell it crosses is still base-colored.
    const perTrack = {};
    for (const e of [...groups.track, ...(groups.trackedge || [])]) {
      const fam = e.point.under && fams[e.point.under];
      const under = fam ? deltaE(e.color, hexToRgb(fam.anchor)) : Infinity;
      perTrack[e.point.idx] = Math.max(perTrack[e.point.idx] ?? 0, under);
    }
    const failing = Object.values(perTrack).filter((v) => v < margin).length;
    // Sampling noise floor: thin mono lines and rounded single-vertex
    // tracks can miss by a pixel — tolerate 2%, never silence the count.
    const allowed = Math.ceil(Object.keys(perTrack).length * 0.02);
    checks.push(check({
      key: 'style_track_presence',
      claim: `ride tracks separate from the terrain under them (fill or casing, ΔE ≥ ${margin})`,
      pass: failing <= allowed,
      evidence: `${Object.keys(perTrack).length} tracks sampled, ${failing} indistinct (noise floor ${allowed})`,
      confidence: 0.8,
      falsifier: 'a flume whose fill AND casing both dissolve into the lawn',
      soWhat: 'rides are why the map exists',
    }));
  }

  if (groups.badge?.length && fams.badge) {
    const perBadge = {};
    for (const e of groups.badge) {
      const d = familyDistance(e.color, fams.badge);
      perBadge[e.point.idx] = Math.min(perBadge[e.point.idx] ?? Infinity, d);
    }
    const badgeIds = Object.keys(perBadge);
    const off = Object.values(perBadge).filter((d) => d > fams.badge.deltaE).length;
    checks.push(check({
      key: 'style_annotation_on_top',
      claim: 'every badge disc samples badge ink, never the terrain under it',
      pass: off === 0,
      evidence: `${badgeIds.length - off}/${badgeIds.length} badge discs in family`,
      confidence: 0.85,
      falsifier: 'a badge painted under a later layer (ADR-0012 rule: annotation pass last)',
      soWhat: 'POI pins must survive every style',
    }));
  }

  const badgeKeys = new Set((model.badges || []).map((b) => `${b.x},${b.y}`));
  checks.push(check({
    key: 'style_badge_dedup',
    claim: 'one badge per POI position',
    pass: badgeKeys.size === (model.badges || []).length,
    evidence: `${(model.badges || []).length} badges, ${badgeKeys.size} distinct positions`,
    confidence: 1,
    falsifier: 'duplicate pins stacked on one POI',
    soWhat: 'ADR-0012 declutter rule, model-side',
  }));

  if (rerunSamples) {
    checks.push(check({
      key: 'style_bake_deterministic',
      claim: 'a fresh render of the same model samples byte-identical pixels',
      pass: signature(rerunSamples) === sig,
      evidence: `render ${sig} vs rerender ${signature(rerunSamples)}`,
      confidence: 1,
      falsifier: 'any clock or RNG sneaking into the compositor',
      soWhat: 'determinism is the bake’s core guarantee',
    }));
  }

  if (siblings) {
    // Sibling kits from the same invocation must not collapse into one
    // look (design languages, not palette swaps).
    const clashes = siblings.filter((s) => s.signature === sig);
    checks.push(check({
      key: 'style_cross_kit_distinct',
      claim: 'sibling kits of this venue sample distinct pixels',
      pass: clashes.length === 0,
      evidence: siblings.length === 0
        ? 'no sibling kits in this invocation — nothing to compare'
        : clashes.length
          ? `identical to ${clashes.map((s) => s.kit).join(', ')}`
          : `distinct from ${siblings.length} sibling bake(s)`,
      confidence: 0.9,
      falsifier: 'two kits that only differ in name',
      soWhat: 'the factory exists to make different-looking maps',
    }));
  }

  for (const s of skips || []) {
    checks.push(check({
      key: `style_skip_${s.key}`,
      claim: `${s.key} sampling is structurally unsound in the ${target} projection and skipped on the record`,
      pass: true,
      evidence: `${s.count} points skipped: ${s.reason}`,
      confidence: 1,
      falsifier: 'a projection change that makes these samples meaningful again without updating the contract',
      soWhat: 'a skipped row must be a visible decision, never a silent pass',
    }));
  }

  const review = (profile.agentReview || []).map((item, i) => ({
    key: (typeof item === 'object' && item.key) || `style_review_${i}`,
    prompt: typeof item === 'object' ? item.prompt : item,
    images: profile.inspiration?.images || [],
  }));

  return {
    version: 1,
    kit: kit.id,
    profile: profile.id,
    target,
    signature: sig,
    certified: checks.every((c) => c.pass),
    checks,
    review,
  };
}

/**
 * Draft color families from measured medians — profile authoring starts
 * from a real bake compared by eye against the reference, never guessed.
 */
export function harvestProfileDraft({ points, samples }) {
  const { medians } = groupMedians(points, samples);
  const families = {};
  for (const [cls, color] of Object.entries(medians)) {
    if (cls === 'track' || cls === 'trackedge' || cls === 'roadline') continue;
    families[cls] = { anchor: rgbToHex(color), deltaE: 14 };
  }
  return { draft: true, ...families };
}
