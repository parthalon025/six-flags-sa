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
import {
  TERRAIN_NAMES, impliedTerrainClasses, POI_BADGES, SPRITE_PIECES,
  WORLD_DISPLACEMENT_BUDGET_PX, bandGeneralization,
} from './display-bake.mjs';
import {
  isoCellMap, isoCellToPixel, buildingHeightsM, trackVertexHeightsM,
  buildingScreenHulls, occludedByBuilding,
} from './display-iso.mjs';
import { bandResolution } from '@party-tracker/shared/zoomBands.js';

/* ---------------------------------------------- alignment (ADR-0021 §3) */

/** How far a drawn feature may sit from where Truth says it sits, in baked
 *  pixels. ADR-0021 clause 3: "Generalization removes, never moves" — a band
 *  may drop a feature entirely, but one it draws stays put, within a pixel.
 *  This is CONTEXT.md's "the Visual factory restyles, never repositions" as a
 *  number a machine can check. */
export const ALIGNMENT_BUDGET_PIXELS = 1;

/** Bands clause 3 deliberately leaves unbudgeted. Departing from Truth is the
 *  overview band's job — bold shapes, landmarks only — so a budget there would
 *  forbid the generalization the band exists for. */
const UNBUDGETED_BANDS = new Set(['overview']);

/** A band's alignment budget, in ground metres. Infinity where clause 3
 *  leaves the band unconstrained.
 *
 *  Ground metres rather than a count of this bake's pixels, and that swap is
 *  the whole point of the clause. Under the retired px/cell spelling one
 *  budget of "3 px" meant 1.21 m at kings-island and 0.52 m at big-kahunas:
 *  the same rule was more than twice as strict at the small park, by accident
 *  of a formula with a 2 m floor. Clause 2 fixes ground sample distance per band
 *  instead, so a metre now means the same thing at every park — and the budget
 *  is read off that same shared table rather than restating 0.15 here, because
 *  a second copy of a number is a second number.
 *
 *  Throws `unknown band: <id>` on a band the table does not know. */
export function alignmentBudgetMetres(bandId) {
  const metresPerPixel = bandResolution(bandId);
  return UNBUDGETED_BANDS.has(bandId) ? Infinity : ALIGNMENT_BUDGET_PIXELS * metresPerPixel;
}

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
 * reason (and per-class counts where classes differ), and
 * certifyStyleContract turns them into explicit check rows.
 *
 * Occlusion is tracked PER CLASS: ground-plane samples hidden behind a
 * building extrusion test the building, not the terrain paint, so they
 * skip — and a class starved below STARVED_MIN_KEPT surviving samples
 * (or with the majority of its samples culled) withdraws its remaining
 * sliver too, under its own `occlusion_starved` skip entry. A sliver
 * median must never render as a normal-looking row, and a fully occluded
 * class must never just vanish from the cert.
 *
 * @returns {{ map: object, points: object[], skips: {key,reason,count,byClass?}[] }}
 */
export const STARVED_MIN_KEPT = 3;

export function isoStylePoints(model, points, { rotation = 0, px = 16, template = 'rct-classic' } = {}) {
  const map = isoCellMap(model, { rotation, px, template });
  const bHeights = buildingHeightsM(model);
  const tHeights = trackVertexHeightsM(model, template);
  const hulls = buildingScreenHulls(model, { rotation });
  const groundCls = new Set([...Object.values(TERRAIN_NAMES), 'roadline']);
  const kept = [];
  const skipped = {};
  const skip = (key, reason) => {
    skipped[key] = skipped[key] || { key, reason, count: 0 };
    skipped[key].count += 1;
  };
  const occl = {}; // per ground class: { culled, kept }
  const tally = (cls, field) => {
    occl[cls] = occl[cls] || { culled: 0, kept: 0 };
    occl[cls][field] += 1;
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
      if (groundCls.has(p.cls)) {
        if (occludedByBuilding((sx - map.ox) / map.hs, (map.oy - sy) / map.hs, hulls)) {
          tally(p.cls, 'culled');
          continue;
        }
        tally(p.cls, 'kept');
      }
    }
    kept.push({ ...p, sx: r2(sx), sy: r2(sy) });
  }

  // Occlusion accounting: classes that keep enough samples record their
  // culls under `occluded`; a starved class (below the floor, or mostly
  // culled) moves entirely — culls AND surviving sliver — under
  // `occlusion_starved`, so its median never renders as a normal row.
  const culledByClass = {};
  const starvedByClass = {};
  for (const [cls, c] of Object.entries(occl)) {
    if (!c.culled) continue;
    if (c.kept < STARVED_MIN_KEPT || c.culled > c.kept) starvedByClass[cls] = { ...c };
    else culledByClass[cls] = { ...c };
  }
  if (Object.keys(culledByClass).length) {
    skipped.occluded = {
      key: 'occluded',
      reason: 'ground-plane samples hidden behind a building extrusion at this rotation test the building, not the terrain paint',
      count: Object.values(culledByClass).reduce((n, c) => n + c.culled, 0),
      byClass: culledByClass,
    };
  }
  const starvedCls = new Set(Object.keys(starvedByClass));
  if (starvedCls.size) {
    skipped.occlusion_starved = {
      key: 'occlusion_starved',
      reason: `occlusion starves these classes below the certification floor (fewer than ${STARVED_MIN_KEPT} samples surviving, or most culled) — their remaining sliver is withdrawn rather than passing as a normal-looking row`,
      count: Object.values(starvedByClass).reduce((n, c) => n + c.culled + c.kept, 0),
      byClass: starvedByClass,
    };
  }
  const surviving = starvedCls.size ? kept.filter((p) => !starvedCls.has(p.cls)) : kept;
  return { map, points: surviving, skips: Object.values(skipped) };
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

/* ------------------------------------------- ADR-0021 clause 1: no words */

/**
 * Keys whose STRING value would be readable copy on the map. `label` and
 * `labels` are here because clause 1 draws the line inside the label itself:
 * a Skin may style one, never write one.
 */
const LABEL_COPY_KEYS = new Set([
  'label', 'labels', 'text', 'text-field', 'textField', 'title', 'caption',
  'name', 'displayName', 'subtitle', 'abbr', 'string',
]);

/** A colour is not a word: `tokens.colors.label` is the ink, not the copy. */
const COLOR_LITERAL = /^(#[0-9a-fA-F]{3,8}|(?:rgb|hsl)a?\([^)]*\))$/;

const quote = (s) => JSON.stringify(s.length > 48 ? `${s.slice(0, 48)}…` : s);

/**
 * ADR-0021 clause 1's second certification row: no label strings in
 * `visual.json`. The spec may STYLE a label — ink, halo, the zoom it appears
 * at, per-Skin suppression — but the words come from `pois.json`, so two
 * Members on different Skins never read different names for the same Place
 * while trying to Rally, and a rename never means re-baking a Skin.
 *
 * A violation is a string VALUE under a key that names readable copy. Two
 * exemptions, both deliberate:
 *   - object KEYS are selectors, not copy. `landTones["Coney Mall"]` matches
 *     a district name the vector tiles already carry from truth, and
 *     display-pack's `references_resolve` row already holds every one of
 *     them to a district the venue actually has.
 *   - a colour literal under a copy key is styling: `tokens.colors.label` is
 *     the ink a label is drawn in. A word parked in that slot still fails.
 *
 * Pure; takes a parsed `<skin>.visual.json` body.
 *
 * @returns a check() row keyed `style_no_label_strings`
 */
export function visualLabelStringsRow(spec) {
  const found = [];
  let strings = 0;
  const walk = (value, key, path) => {
    if (typeof value === 'string') {
      strings += 1;
      if (LABEL_COPY_KEYS.has(key) && !COLOR_LITERAL.test(value)) found.push(`${path} = ${quote(value)}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, key, `${path}[${i}]`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, k, path ? `${path}.${k}` : k);
    }
  };
  walk(spec, null, '');
  const named = [spec?.venue, spec?.skin].filter(Boolean).join(' × ') || 'spec';
  return check({
    key: 'style_no_label_strings',
    claim: 'visual.json styles labels but supplies none of their words (ADR-0021 clause 1)',
    pass: found.length === 0,
    evidence: found.length
      ? `label copy in ${named}: ${found.join('; ')} — every string on the map comes from pois.json`
      : `${named}: ${strings} string value(s) scanned, none supplies label copy`,
    confidence: 1,
    falsifier: 'a spec that carries the words for a Place, so a Skin can rename what another Skin calls the same thing',
    soWhat: 'two Members on different Skins reading different names for one Place cannot Rally to it',
  });
}


/* ------------------- ADR-0019 clause 1 / ADR-0021 clause 3: band-aware rows --
 *
 * The three bands share one cell grid (display-bands.mjs derives every band's
 * grid from the coarsest), so a band bake and an ungeneralized one are the same
 * pixels at the same places until something removes content. "Which band is
 * this?" is therefore load-bearing rather than a label: it is the only thing
 * that says what the picture was supposed to leave out.
 *
 * Both rows below read the MODEL and re-derive the policy from the band table.
 * Neither takes the bake's own `generalization` stamp as the answer — that
 * stamp is one of the things being checked, because a model generalized under
 * one policy and stamped with another certifies clean if you believe it.
 */

/** One mark, as an identity that includes its position. Any difference at all —
 *  a nudged badge, a resampled ring, a re-indexed slide — is a different key,
 *  which is what makes "removes, never moves" checkable by set membership. */
const markKey = (mark) => JSON.stringify(mark);

/** The model arrays a band may carry marks in. Terrain cells are handled
 *  separately: they are the geometry every position is measured against, so
 *  they are compared whole rather than mark by mark. */
const BAND_MARK_KINDS = ['trees', 'lotRows', 'badges', 'buildings', 'tracks', 'roads'];

/** The fields a mark carries its position in. Stripped from its identity when
 *  the band being judged is one ADR-0021 clause 3 leaves unconstrained. */
const MARK_POSITION_KEYS = new Set(['x', 'y', 'pts', 'ring']);

/** A mark's identity with the position taken out — what it IS rather than
 *  where it sits. Two crowns of the same size share a shape key wherever they
 *  stand, so containment on shape keys counts marks per kind of thing and says
 *  nothing at all about placement. */
const markShapeKey = (mark) => JSON.stringify(
  Object.fromEntries(Object.entries(mark).filter(([k]) => !MARK_POSITION_KEYS.has(k))),
);

/** The bands whose placement ADR-0021 clause 3 does not hold to Truth. The
 *  clause gives close and mid a 1 px alignment budget and leaves overview
 *  "unconstrained because departing from Truth is that band's job" — at
 *  2.4 m/px a mark drawn where Truth put it can be indistinguishable from one
 *  nudged half a cell, and the ADR would rather have the readable picture. So
 *  an overview mark is held to existing in the finer band, not to sitting
 *  where the finer band draws it. A band this set does not name is held to the
 *  position: an unrecognised band must not get the looser rule by default. */
const POSITION_FREE_BANDS = new Set(['overview']);

/** What ground a generalizable mark grows from, in terrain classes. A model
 *  whose grid has none of a mark's ground carries none of that mark for
 *  reasons that have nothing to do with the band, so presence is only ever
 *  demanded where the venue could have produced one — big-kahunas has no
 *  parking at all, and a lotRows count of zero there is the truth.
 *
 *  `badges` are absent on purpose: annotation comes from `pois.json` rather
 *  than from ground, so a model carries no witness for how many pins the venue
 *  should have and presence cannot be asserted from the model alone. */
const MARK_GROUND = { trees: ['wood', 'grass'], lotRows: ['lot'] };

/**
 * ADR-0019 clause 1's content rule, as a row: a band carries only what it can
 * draw at its own ground resolution.
 *
 * What it can fail on, and why each matters:
 *   - a mark of a kind this band drops is still in the model — the
 *     generalization pass did not run, or ran under a different policy, and the
 *     band is about to ship as "one ultra-res bake, tiled" (ADR-0019's own
 *     rejected shape) while claiming to be generalized art.
 *   - a badge outside the band's landmark kinds — annotation that should have
 *     thinned, which at 2.4 m/px is pins stacking into an unreadable blend.
 *   - the model's declared `generalization` stamp disagrees with the policy the
 *     band table implies — the cert would otherwise be reporting the bake's own
 *     account of itself.
 *   - a kind the policy KEEPS is missing entirely from a model whose own
 *     terrain could have grown it. Over-removal is the failure the other three
 *     cannot see: a band that dropped a kind it was supposed to draw agrees
 *     with a stamp that says it dropped it, and the nesting row is blind to it
 *     too, because the coarser band would be missing the kind as well and
 *     produce no orphans. `MARK_GROUND` is what keeps this from firing on a
 *     venue that simply has no woods or no car park.
 *
 * Pure; takes a band bake's model. Nothing to say about an unbanded model, so
 * `certifyStyleContract` only asks when there is a band.
 *
 * @returns a check() row keyed `style_band_generalization`
 */
export function bandGeneralizationRow(model) {
  const band = model?.band ?? null;
  const policy = bandGeneralization(band, { tileMetres: model?.tileMetres });
  const found = [];
  if (JSON.stringify(model.generalization ?? null) !== JSON.stringify(policy)) {
    found.push(`the model's declared generalization stamp disagrees with what the band table implies for ${band}`);
  }
  const sizeOf = (kind) => policy.marks.find((m) => m.kind === kind)?.drawnPx;
  for (const kind of policy.drops) {
    const n = (model[kind] || []).length;
    if (n) found.push(`${kind}: ${n} mark(s) drawn at ${sizeOf(kind)} px, under the ${policy.floorPx} px floor`);
  }
  if (policy.badgeKinds) {
    const strays = [...new Set((model.badges || []).map((b) => b.kind))]
      .filter((k) => !policy.badgeKinds.includes(k)).sort();
    if (strays.length) {
      found.push(`badges: ${strays.join(', ')} pinned where only ${policy.badgeKinds.join(', ')} reads (pins land ${sizeOf('badges')} px apart)`);
    }
  }
  // The other direction: what the policy keeps has to actually be here. Asked
  // of the venue's ground rather than of the policy, because the policy is the
  // thing that would be lying.
  const classes = new Set((model.cells || []).map((c) => model.terrains?.[c]));
  for (const m of policy.marks.filter((k) => k.drawn)) {
    const ground = (MARK_GROUND[m.kind] || []).filter((t) => classes.has(t));
    if (!ground.length) continue;
    if (!(model[m.kind] || []).length) {
      found.push(`${m.kind}: none drawn, though this band draws them ${m.drawnPx} px across and the venue has ${ground.join('/')} to grow them on`);
    }
  }
  const drawn = policy.marks.map((m) => `${m.kind} ${m.drawnPx} px ${m.drawn ? 'drawn' : m.below === 'drop' ? 'dropped' : 'thinned to landmarks'}`);
  return check({
    key: 'style_band_generalization',
    claim: `the ${band} band carries the marks it can draw at ${policy.metresPerPixel} m/px, and only those`,
    pass: found.length === 0,
    evidence: found.length
      ? `${band}: ${found.join('; ')}`
      : `${band} (floor ${policy.floorPx} px): ${drawn.join(', ')}`,
    confidence: 1,
    falsifier: 'a band shipping the marks a coarser resolution cannot resolve, an annotation layer that never thinned, or a band missing a kind it is supposed to draw',
    soWhat: 'a band that draws everything is one bake tiled three ways — sharper, not clearer, which is the shape ADR-0019 rejected',
  });
}

/**
 * ADR-0021 clause 3, as a row: generalization removes, never moves.
 *
 * A coarser band is only ever a SUBSET of the band below it — same cell grid,
 * same crop, and for the bands clause 3 holds to a position, the same
 * coordinates for everything both bands draw. So this holds the pair to
 * containment on exact marks: a coarse mark with no identical twin in the finer
 * band either moved or was invented, and both are the failure clause 3 exists
 * to forbid.
 *
 * With one exception the clause writes down itself. Its alignment budget is
 * close ≤ 1 px, mid ≤ 1 px, "overview unconstrained because departing from
 * Truth is that band's job" — so an overview mark is judged on identity with
 * the position taken out (`markShapeKey`, `POSITION_FREE_BANDS`). Removal and
 * invention are still caught there, because containment counts marks: an
 * overview that grows a building the mid band does not have has one too many
 * of that shape and reports the orphan. What is deliberately no longer caught
 * is an overview mark that moved, which the ADR permits.
 *
 * Why it has to be a cross-band row rather than a per-band one: nothing inside
 * a single bake can tell a mark that sits where Truth put it from a mark that
 * was nudged, because the model IS the bake's account of where things are. The
 * finer band is the witness. That the two bands also share terrain cells is
 * checked here for the same reason it matters to the tiler — a placeholder
 * upscales a parent band pixel-for-pixel, so a grid that shifted between bands
 * is a seam in the picture.
 *
 * Pure. `coarse` may be null — the coarsest band has no parent to nest in, and
 * demanding one would fail the band that starts the chain.
 *
 * @returns a check() row keyed `style_band_removes_never_moves`
 */
export function bandNestingRow({ coarse, fine }) {
  const names = `${coarse?.band ?? 'none'} in ${fine?.band ?? 'none'}`;
  if (!coarse) {
    return check({
      key: 'style_band_removes_never_moves',
      claim: 'every mark a coarser band draws sits where the finer band draws it (ADR-0021 clause 3)',
      pass: true,
      evidence: `${fine?.band ?? 'this band'} is the coarsest band — no parent to nest in, so there is no pair to compare`,
      confidence: 1,
      falsifier: 'a band chain whose coarsest link has a coarser link above it after all',
      soWhat: 'the band that starts the chain must not fail a rule about pairs',
    });
  }
  const found = [];
  if (coarse.cols !== fine.cols || coarse.rows !== fine.rows) {
    found.push(`grid ${coarse.cols}x${coarse.rows} vs ${fine.cols}x${fine.rows}`);
  } else if (JSON.stringify(coarse.cells) !== JSON.stringify(fine.cells)) {
    const moved = coarse.cells.filter((c, i) => c !== fine.cells[i]).length;
    found.push(`terrain: ${moved} cell(s) classify differently between the two bands`);
  }
  const positionFree = POSITION_FREE_BANDS.has(coarse.band);
  const keyOf = positionFree ? markShapeKey : markKey;
  const kept = [];
  for (const kind of BAND_MARK_KINDS) {
    const coarseMarks = coarse[kind] || [];
    const fineMarks = fine[kind] || [];
    // A budget rather than a set, because with the position out of the identity
    // many marks share a key and containment has to count them. For a
    // position-budgeted band the key is the whole mark, so this is the same
    // membership as before with duplicates counted — a subtractive pass, which
    // is all clause 3 permits, can never hand the coarse band more copies of a
    // bit-identical mark than the fine one has.
    const budget = new Map();
    for (const m of fineMarks) {
      const k = keyOf(m);
      budget.set(k, (budget.get(k) ?? 0) + 1);
    }
    const orphans = coarseMarks.filter((m) => {
      const k = keyOf(m);
      const left = budget.get(k) ?? 0;
      if (left <= 0) return true;
      budget.set(k, left - 1);
      return false;
    });
    kept.push(`${kind} ${coarseMarks.length}/${fineMarks.length}`);
    if (orphans.length) {
      const missing = positionFree ? 'no counterpart' : 'no twin';
      found.push(`${kind}: ${orphans.length} of ${coarseMarks.length} mark(s) have ${missing} in ${fine.band}, e.g. ${markKey(orphans[0]).slice(0, 60)}`);
    }
  }
  return check({
    key: 'style_band_removes_never_moves',
    claim: positionFree
      ? `every mark the ${coarse.band} band draws is one ${fine.band} draws too — clause 3 leaves this band's placement unconstrained (ADR-0021 clause 3)`
      : 'every mark a coarser band draws sits where the finer band draws it (ADR-0021 clause 3)',
    pass: found.length === 0,
    evidence: found.length
      ? `${names}: ${found.join('; ')}`
      : `${names}: ${kept.join(', ')} kept of the finer band's, every one ${positionFree ? 'a mark the finer band draws too (placement unconstrained here)' : 'at an identical position'}`,
    confidence: 1,
    falsifier: 'a generalizer that simplifies a ring, snaps a mark to a coarser grid, or synthesises a landmark the finer band does not have',
    soWhat: 'the live overlay draws from Truth and is never snapped to art, so art that drifts is art a guest can see disagreeing with their route',
  });
}

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
 *
 * `map` is the venue's truth (map.json body) — optional, but when given it
 * powers `style_terrain_coverage`: a class the venue's own geometry implies
 * (map.grass, map.parking, map.water, …) must actually survive to the
 * sampled render. `style_terrain_palette` alone only judges classes that
 * DID survive; a compositing bug that erases a class entirely (issue #518:
 * water painted over the whole park with no boundary clip) passed that
 * check clean because there was nothing sampled to fail on.
 *
 * `pois` (truth places) powers `style_world_geo` on the flat tier — the
 * ADR-0016 geo-fidelity row for worlds placed image-on-truth-bounds.
 * `px` is the bake's pixels-per-cell; with the model's `tileMetres` it gives
 * the ground size of a baked pixel, which is what turns a measured departure
 * from truth into ground metres.
 *
 * `band` is the zoom band this bake is (`overview` | `mid` | `close`), and it
 * chooses the ADR-0021 clause 3 alignment budget the geo row asserts. A bake
 * that is not band-addressed has no band budget to name and stays on the
 * pre-ADR-0021 pixel budget, which the row says outright.
 *
 * `visual` is the venue × Skin spec (`<skin>.visual.json` body) — optional,
 * and when given it adds ADR-0021 clause 1's `style_no_label_strings` row
 * (see visualLabelStringsRow). Clause 1's other row, `style_no_baked_text`,
 * needs nothing extra: the model's badge kinds and the kit's icon ledger are
 * already here, and they are exactly what the painter reads.
 *
 * The band rows come off the model rather than an argument: a band bake stamps
 * its own `band`, so a cert of one is band-aware without the caller saying so
 * twice, and a cert of an unbanded bake is byte-identical to what it always
 * was. `coarserModel` is the band above this one, when the caller has it — the
 * only way to hold ADR-0021 clause 3's "removes, never moves" to a pair rather
 * than to a bake's account of itself (see bandNestingRow).
 */
export function certifyStyleContract({
  model, points, samples, rerunSamples = null, siblings = null, profile, kit,
  target = 'flat', skips = null, map = null, pois = null, px = 16, visual = null,
  band = null,
  coarserModel = null,
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

  // Coverage, not just color fit: style_terrain_palette above only judges
  // classes present in `medians` — a bake reduced to water/road/service by
  // a boundary-unaware paint order samples cleanly in-family on those three
  // and never surfaces the missing grass/wood/lot at all. Compare against
  // what the venue's OWN truth implies instead of what happened to render.
  if (map) {
    const implied = impliedTerrainClasses(map);
    const missing = [...implied].filter((cls) => !medians[cls]).sort();
    checks.push(check({
      key: 'style_terrain_coverage',
      claim: 'every terrain class the venue truth implies (map.grass, map.parking, map.water, …) survives to the sampled render',
      pass: missing.length === 0,
      evidence: missing.length
        ? `truth implies ${[...implied].sort().join(', ') || 'nothing'}; missing from the bake: ${missing.join(', ')}`
        : `truth implies ${[...implied].sort().join(', ') || 'no terrain classes'}; all present`,
      confidence: 1,
      falsifier: 'a terrain class present in truth geometry vanishing from the composited render (e.g. a boundary-unaware paint order painting over it)',
      soWhat: 'a bake that silently drops a class can certify clean while shipping an empty or wrong-looking world',
    }));
  }

  // Geo fidelity for the world tier (ADR-0016: strictly geo-true, bounded
  // displacement certified). The app places the baked image on the model's
  // truth-derived bounds, so a painted feature lands where the linear
  // bounds→cell map puts it. What this row PROVES, given that the bake is
  // deterministic (style_bake_deterministic) and the model is built from
  // truth alone: (1) sampled truth anchors — every model badge matched back
  // to its truth POI — sit where projecting that POI through the world's
  // own bounds says they must, i.e. the image-on-truth-bounds placement is
  // exact for painted features; (2) the only paint-time geometry wobble the
  // kit is allowed (seeded stroke displacement) is bounded by the declared
  // budget, so no painted edge sits further than that many pixels from its
  // truth position. It does not judge looks — the palette rows do that.
  if (pois && model.bounds && target === 'flat') {
    const b = model.bounds;
    const toCell = (lng, lat) => [
      ((lng - b.west) / (b.east - b.west)) * model.cols,
      ((b.north - lat) / (b.north - b.south)) * model.rows,
    ];
    // Parks repeat names ("Restrooms" × 12), so a badge matches the NEAREST
    // truth POI of its kind: every badge must coincide with some real place
    // of that kind — the model cannot invent or nudge a position.
    const truthByKind = new Map();
    for (const p of pois) {
      if (!POI_BADGES[p.c] || !Number.isFinite(p.lat)) continue;
      const kind = POI_BADGES[p.c];
      if (!truthByKind.has(kind)) truthByKind.set(kind, []);
      truthByKind.get(kind).push(toCell(p.lng, p.lat));
    }
    const errs = [];
    for (const badge of model.badges || []) {
      const candidates = truthByKind.get(badge.kind);
      if (!candidates) continue;
      errs.push(Math.min(...candidates.map(([ex, ey]) => Math.hypot(ex - badge.x, ey - badge.y))));
    }
    // Anchors are never displaced (annotation passes last, undisplaced);
    // the tolerance only absorbs the bounds' own 1e-7° rounding.
    const anchorTol = 0.05;
    const worstAnchor = errs.length ? Math.max(...errs) : 0;
    const amplitude = kit.strokes?.displacement?.amplitude ?? 0;

    // ADR-0021 clause 3 asks this row a question in ground metres, so it
    // needs the bake's ground scale. Every model carrying `bounds` came from
    // bakeModel, which states `tileMetres` outright; without it the row
    // cannot measure the thing it claims to bound, so it fails and says so
    // rather than quietly reverting to the unit clause 3 retired.
    const metresPerCell = model.tileMetres;
    const scaled = Number.isFinite(metresPerCell) && metresPerCell > 0;
    const metresPerBakePixel = scaled ? metresPerCell / px : null;
    const budgetMetres = band != null
      ? alignmentBudgetMetres(band)
      : (scaled ? WORLD_DISPLACEMENT_BUDGET_PX * metresPerBakePixel : Infinity);
    const budgetSource = band != null
      ? `${band} band, ADR-0021 clause 3`
      : `no band — ${WORLD_DISPLACEMENT_BUDGET_PX} px of this bake, pre-ADR-0021`;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    // Metres to the millimetre: a realised band resolution sits up to half a
    // coarsest cell off its nominal one (see packages/shared/zoomBands.js), so
    // comparing raw floats would fail one venue and pass its neighbour over
    // 70 µm of ground. A millimetre is 1/150th of a close-band pixel.
    const mm = (v) => Math.round(v * 1000);
    const say = (v) => (Number.isFinite(v) ? `${r3(v)} m` : 'unconstrained');
    const anchorMetres = scaled ? worstAnchor * metresPerCell : null;
    const displacementMetres = scaled ? amplitude * metresPerBakePixel : null;
    const worstMetres = scaled ? Math.max(anchorMetres, displacementMetres) : null;
    const budgetPhrase = !scaled
      ? 'stays inside the ground-metre alignment budget its band sets'
      : Number.isFinite(budgetMetres)
        ? `stays inside the ${say(budgetMetres)} alignment budget (${budgetSource})`
        : `is unbudgeted (${budgetSource}) — clause 3 leaves this band free to depart from truth`;
    checks.push(check({
      key: 'style_world_geo',
      claim: `world anchors project onto truth through the pack bounds (≤ ${anchorTol} cells), and every painted feature ${budgetPhrase}`,
      pass: scaled && worstAnchor <= anchorTol && mm(worstMetres) <= mm(budgetMetres),
      evidence: scaled
        ? `${errs.length} truth anchor(s) sampled, worst offset ${r3(worstAnchor)} cells = ${say(anchorMetres)}`
          + ` (projection tolerance ${anchorTol} cells); declared stroke displacement ${amplitude} px = ${say(displacementMetres)};`
          + ` alignment budget ${say(budgetMetres)} from ${budgetSource},`
          + ` at ${r3(metresPerCell)} m a cell and ${r3(metresPerBakePixel)} m a baked pixel`
        : 'the model states no tileMetres, so departure from truth cannot be measured in ground metres'
          + ' — ADR-0021 clause 3 budgets ground distance, not pixels of whatever this bake happens to be',
      confidence: 0.9,
      falsifier: 'a model whose badge positions no longer derive from truth through its own bounds, or a band drawing a feature further from truth than its ground-metre budget allows',
      soWhat: 'a world image that drifts from truth moves every Place a guest stands next to — at the close band a metre of drift is seven pixels of blue route crossing painted lawn',
    }));
  }

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

  // ADR-0021 clause 1, first row: no text glyphs in any baked band. The only
  // mark the painter puts inside a badge disc is an icon from the ledger —
  // bin/display-bake-page.html used to letter a kind whose icon was missing
  // (`fillText(LETTER[kind] || '?')`), which is a painted word by any other
  // name. Icons resolve here exactly the way the painter reads them:
  // resolveKit merges SPRITE_PIECES over every kit spec key by key, so a kind
  // the kit itself never names still inherits the module default, and only a
  // kind with no default anywhere — a POI_BADGES kind shipped without art —
  // has nothing to draw.
  const paintedKinds = [...new Set((model.badges || []).map((b) => b.kind))].sort();
  const glyphFor = (kind) => (kit.sprites?.badge?.icons?.[kind] ?? SPRITE_PIECES.badge.icons[kind])?.asset;
  const unglyphed = paintedKinds.filter((kind) => !glyphFor(kind));
  checks.push(check({
    key: 'style_no_baked_text',
    claim: 'nothing readable is baked into the band — every painted badge kind resolves to an icon glyph, never a letter',
    pass: unglyphed.length === 0,
    evidence: unglyphed.length
      ? `badge kind(s) with no icon glyph: ${unglyphed.join(', ')} — an unresolvable badge is a missing asset, not a letter to paint`
      : paintedKinds.length
        ? `${paintedKinds.length} painted badge kind(s) resolve to icon glyphs: ${paintedKinds.map((k) => `${k}→${glyphFor(k)}`).join(', ')}`
        : 'no badges in the model — nothing to letter',
    confidence: 1,
    falsifier: 'a painter falling back to a character when a badge kind has no icon, or a POI badge kind shipped with no glyph art',
    soWhat: 'a baked word cannot be read aloud, cannot change language, cannot dodge a party dot, and cannot survive a rename without re-baking every Skin',
  }));

  // Clause 1's second row rides along only when the caller has the spec.
  if (visual) checks.push(visualLabelStringsRow(visual));

  // Band rows. Both ride on every band cert, including the coarsest, where the
  // nesting row records that there was no pair to compare — a band whose row
  // set shrinks silently is exactly the "skipped row must be a visible
  // decision" failure the skip rows below exist to prevent.
  if (model.band) {
    checks.push(bandGeneralizationRow(model));
    checks.push(bandNestingRow({ coarse: coarserModel, fine: model }));
  }

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
    const perClass = s.byClass
      ? ` [${Object.entries(s.byClass).map(([cls, c]) => `${cls}: ${c.kept} kept / ${c.culled} culled`).join(', ')}]`
      : '';
    checks.push(check({
      key: `style_skip_${s.key}`,
      claim: `${s.key} sampling is structurally unsound in the ${target} projection and skipped on the record`,
      pass: true,
      evidence: `${s.count} points skipped: ${s.reason}${perClass}`,
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
    // Which band this cert covers. Absent on an unbanded bake, exactly like
    // `skips`: a cert of the one-band world stays byte-identical to the certs
    // already committed, and a reader takes absence as "not a band bake"
    // rather than as a band it has to guess.
    ...(model.band ? { band: model.band } : {}),
    // The signature is only reproducible at the resolution it sampled —
    // drift watches must re-bake at this px, not their own default.
    px,
    signature: sig,
    certified: checks.every((c) => c.pass),
    checks,
    review,
    // Structured pass-through of the projection's skip entries (occlusion
    // tallies included), so a sweep aggregator can reason about starvation
    // without parsing evidence strings. Absent on flat certs and on certs
    // baked before this existed — consumers must treat absence as "nothing
    // withdrawn". Two valid states, by design: `skips` is either a
    // non-empty array or missing entirely, never [] — guard reads with
    // `cert.skips || []` like crossRotationCoverageRow and display-pack do.
    ...(skips && skips.length ? { skips } : {}),
  };
}

/**
 * The sweep-level occlusion rule (issue #521): across an iso rotation sweep,
 * every ground class must survive to a real, un-withdrawn evaluation at
 * AT LEAST ONE rotation. A class the per-rotation contract withdrew
 * (`occlusion_starved`) at EVERY rotation was never actually held to the
 * contract anywhere — its disclosure rows are honest, but nothing certified
 * the class.
 *
 * The tradeoff, decided on #521: hard-failing the per-rotation cert for a
 * starved class was rejected, because geometry legitimately starves classes
 * at some cameras (big-kahunas r0/r2 put most road samples behind
 * extrusions) and failing r0/r2 for that would block venues whose look is
 * fine at the rotations a player actually gets shown. Per-rotation
 * starvation therefore stays a withdrawal-with-disclosure; this row is where
 * it hard-fails — when no rotation in the sweep ever covered the class.
 *
 * Pure. `sweep` is one entry per baked rotation: `{ rotation, skips }`,
 * with `skips` the cert's structured skip entries (certifyStyleContract
 * carries them; certs from before that carry none, which reads as "nothing
 * withdrawn" — correct, since withdrawal always writes a skip entry).
 * Fewer than two rotations is not a sweep: the row passes on the record,
 * because demanding cross-rotation coverage of a single rotation would be
 * exactly the per-rotation hard-fail the issue rejected.
 *
 * @param {{ rotation: number, skips?: {key: string, byClass?: object}[] }[]} sweep
 * @returns a check() row keyed `style_occlusion_cross_rotation`
 */
export function crossRotationCoverageRow(sweep) {
  const rotations = [...(sweep || [])].sort((a, b) => a.rotation - b.rotation);
  const starvedAt = {};
  for (const r of rotations) {
    const starved = (r.skips || []).find((s) => s.key === 'occlusion_starved');
    for (const cls of Object.keys(starved?.byClass || {})) {
      (starvedAt[cls] = starvedAt[cls] || []).push(r.rotation);
    }
  }
  const rname = (rs) => rs.map((r) => `r${r}`).join(',');
  const uncovered = Object.entries(starvedAt)
    .filter(([, rs]) => rs.length >= rotations.length)
    .map(([cls]) => cls)
    .sort();
  const partial = Object.entries(starvedAt)
    .filter(([, rs]) => rs.length < rotations.length)
    .map(([cls, rs]) => `${cls} withdrawn at ${rname(rs)} only`)
    .sort();
  return check({
    key: 'style_occlusion_cross_rotation',
    claim: 'every occlusion-withdrawn class still certifies un-withdrawn at ≥1 rotation of the iso sweep',
    pass: rotations.length < 2 || uncovered.length === 0,
    evidence: rotations.length < 2
      ? `${rotations.length} rotation(s) baked — not a sweep; per-rotation occlusion_starved rows carry the disclosure`
      : uncovered.length
        ? `starved at every rotation (${rname(rotations.map((r) => r.rotation))}): ${uncovered.join(', ')} — no rotation ever held these classes to the contract`
        : partial.length
          ? `${partial.join('; ')} — each survives elsewhere in the sweep`
          : `no class withdrawn anywhere across ${rname(rotations.map((r) => r.rotation))}`,
    confidence: 1,
    falsifier: 'a venue whose extrusions hide a ground class from every quarter-turn camera at once',
    soWhat: 'per-rotation withdrawal is disclosure, not certification — a class starved everywhere would ship with its look never checked at all',
  });
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
