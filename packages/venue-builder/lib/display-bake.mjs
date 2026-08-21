/**
 * Skin bake, game tier — truth geometry → a tile-and-sprite bake model.
 *
 * The model is everything a canvas compositor needs to paint a game-style
 * park map: terrain cells (ground/grass/water/road/lot/outside), tree
 * sprites, building footprints with a chunky drop edge, ride tracks as
 * colored tubes, and POI badges. Pure and deterministic: same truth in,
 * byte-identical model out — sprite jitter comes from coordinate hashes,
 * never a clock or Math.random. Skins restyle, never reposition: every
 * pixel position derives from truth geometry.
 *
 * The renderer for this model is bin/display-bake.mjs (headless canvas).
 * The generative art tier (ControlNet / retexturing) conditions on this
 * same model — it is the semantic layout the design doc's §5 requires.
 */

import { bandResolution } from '@party-tracker/shared/zoomBands.js';
import { LINE_LAYERS } from './osm-tags.mjs';
import { bandBakePlan } from './display-bands.mjs';
import { densityFromSpecies, fillRows, scatterPoints } from './display-scatter.mjs';

/**
 * Sprite footprints, in cells. Radius is what stops two trees sharing a
 * trunk; probability is the mix within a terrain.
 */
const TREE_SPECIES = {
  wood: [
    { id: 'big', radius: 0.85, probability: 0.55, big: true },
    { id: 'small', radius: 0.6, probability: 0.45 },
  ],
  grass: [
    { id: 'big', radius: 0.9, probability: 0.2, big: true },
    { id: 'small', radius: 0.65, probability: 0.8 },
  ],
};

/** Woods saturate; grass is deliberately sparse ornamental planting. */
const TREE_DENSITY_SCALE = { wood: 1, grass: 0.22 };

/**
 * Parking aisle geometry, in metres.
 *
 * Individual bays are ~2.6 m and the bake grid is 2.4-7.4 m per cell, so
 * stalls are sub-cell and drawing them would be noise. Aisles are not: at
 * ~16 m apart they land 2.2-6.6 cells apart at every shipped venue, which
 * draws cleanly. This is depiction, not invention — the lot is in OSM, and
 * aisles are what a lot looks like.
 */
const AISLE_METRES = 16;
const AISLE_DASH_METRES = 4;

/* ------------------------------------------------ the pieces vocabulary --
 * The bake decomposes into the smallest pieces the builder owns. A kit is
 * a composition of pieces; a map prompt selects per piece; the compositor
 * only orders them. Each terrain piece = base color + one texture primitive;
 * each sprite piece = a small param set. New looks come from new piece
 * params — new *kinds* of pieces are code, added one at a time with a test.
 */

/** Texture primitives the compositor knows how to paint. */
export const TEXTURE_KINDS = ['none', 'speckle', 'tuft', 'wave', 'dot', 'stripe', 'dash', 'hatch', 'grain'];

/** Structural design switches — different drawing, not different color. */
export const BUILDING_STYLES = ['drop', 'flat', 'outline', 'plan'];
export const TREE_STYLES = ['round', 'dot', 'none'];
export const TRACK_STYLES = ['tube', 'mono', 'schematic'];
export const ROAD_STYLES = ['cased', 'double'];
export const SERVICE_STYLES = ['solid', 'dashed'];

/**
 * ADR-0016's "strictly geo-true" as a number: the most any painted stroke
 * may wander from its truth-projected position, in bake pixels. A kit's
 * seeded-noise displacement (`strokes.displacement.amplitude`) validates
 * against this at resolve time, and certification's style_world_geo row
 * re-asserts it against the bake, so the budget is a proof, not a promise.
 */
export const WORLD_DISPLACEMENT_BUDGET_PX = 3;

/**
 * `steep` is the variant a natural surface takes where the ground is actually
 * steep — a bank reads as a bank rather than as lawn drawn at an angle. It is
 * only consulted when the venue has a DEM (the model's `steep` channel), so a
 * flat park or one with no coverage never sees it, and a kit may override it
 * like any other piece value. Made surfaces are deliberately absent: a road on
 * a slope is still a road.
 */
export const TERRAIN_PIECES = {
  outside: { base: '#6B4E9B', texture: { kind: 'dot', color: '#7A5BAD', density: 0.35 } },
  ground: { base: '#EBDDA8', texture: { kind: 'speckle', color: '#DFCE8F', density: 0.3 }, steep: { base: '#D3C293' } },
  grass: { base: '#7FB86B', texture: { kind: 'tuft', color: '#5F9C50', density: 0.35 }, steep: { base: '#8FA163' } },
  wood: { base: '#639E55', texture: { kind: 'tuft', color: '#4E8443', density: 0.35 }, steep: { base: '#6C8B4E' } },
  water: { base: '#58AEDC', texture: { kind: 'wave', color: '#8FCBE8', density: 0.3 } },
  lot: { base: '#B9B3A6', texture: { kind: 'stripe', color: '#E2DDD2', density: 0.33 } },
  // road cells never take the per-cell texture pass — they render as cased
  // polylines whose casing and dashed centerline both use texture.color.
  road: { base: '#8C8F98', texture: { kind: 'none', color: '#C9CCD3' } },
  service: { base: '#7D8089', texture: { kind: 'none' } },
};

export const SPRITE_PIECES = {
  tree: { style: 'round', canopy: '#3F7A38', highlight: '#6FBF5C', shadow: 'rgba(0,0,0,0.22)', scale: 1 },
  building: { style: 'drop', roofs: ['#C7B9A2', '#B79E8C', '#9FA6B4'], edge: '#5E5648', wall: '#6E6355', drop: 0.25 },
  slide: { style: 'tube', casing: 'rgba(255,255,255,0.9)', colors: ['#F4C542', '#E05548', '#3FA0D8', '#7BC47F', '#C468D8', '#F08A3C'], width: 1 },
  coaster: { style: 'tube', rail: '#4A3A30', tie: '#C9B9A6' },
  badge: {
    gate: '#D84B4B',
    food: '#E8862F',
    restroom: '#3F7FBF',
    shop: '#4FA36B',
    show: '#9A5FC0',
    service: '#8A8F98',
    icons: {
      gate: { asset: 'parkbound-badge-gate' },
      food: { asset: 'parkbound-badge-food' },
      restroom: { asset: 'parkbound-badge-restroom' },
      shop: { asset: 'parkbound-badge-shop' },
      show: { asset: 'parkbound-badge-show' },
      service: { asset: 'parkbound-badge-service' },
    },
  },
};

const merged = (base, over) => {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
      out[k] = k in base ? merged(base[k], v) : v;
    }
    return out;
  }
  return over === undefined ? base : over;
};

/**
 * Resolve a kit spec (any subset of pieces) onto the piece defaults.
 * Unknown texture kinds, unknown pieces, and unresolvable art refs are
 * rejected here, not at paint time — a prompt-authored kit fails loudly
 * before it ever renders, and can only reference license-gated ledger art.
 *
 * `overlay` is a venue design theme: a partial spec merged over the kit
 * before validation (data/venues/<id>/display/theme.json), so one World
 * can restyle any kit — custom quest-prize sprites included — without
 * forking it. Overlays restyle; they cannot move geometry any more than
 * kits can.
 *
 * `materials` is the MaterialSet ledger (data/display/materials.json):
 * pieces binding a `material` (tiled compiled-albedo underlay, ADR-0016
 * PBR pass) can only reference ledger rows, exactly like tile/sprite art.
 */
export function resolveKit(spec = {}, { assets, overlay, materials } = {}) {
  if (overlay) {
    spec = {
      ...spec,
      terrain: merged(spec.terrain || {}, overlay.terrain || {}),
      sprites: merged(spec.sprites || {}, overlay.sprites || {}),
    };
  }
  const checkMaterial = (owner, ref) => {
    if (!ref) return;
    if (!materials) throw new Error(`${owner}.material needs the materials ledger to resolve`);
    if (!materials[ref.id]) throw new Error(`${owner}.material references unknown material "${ref.id}"`);
    if (ref.mix != null && !(ref.mix >= 0 && ref.mix <= 1)) {
      throw new Error(`${owner}.material.mix must sit in [0, 1]`);
    }
  };
  for (const key of Object.keys(spec.terrain || {})) {
    if (!TERRAIN_PIECES[key]) throw new Error(`Unknown terrain piece "${key}"`);
    const piece = spec.terrain[key] || {};
    const kind = piece.texture?.kind;
    if (kind && !TEXTURE_KINDS.includes(kind)) throw new Error(`Unknown texture kind "${kind}" on ${key}`);
    if (key === 'road' && piece.style && !ROAD_STYLES.includes(piece.style)) {
      throw new Error(`Unknown road style "${piece.style}"`);
    }
    if (key === 'service' && piece.style && !SERVICE_STYLES.includes(piece.style)) {
      throw new Error(`Unknown service style "${piece.style}"`);
    }
    if (piece.rim) {
      // Pigment-pooling rim: a darker second pass inside a terrain's own
      // boundary, falling off with cell distance. Bounded so a kit cannot
      // turn a rim into a fill (reach) or opaque repaint (alpha).
      if (!(piece.rim.reach >= 1 && piece.rim.reach <= 4)) throw new Error(`${key}.rim.reach must sit in [1, 4]`);
      if (!(piece.rim.alpha > 0 && piece.rim.alpha <= 1)) throw new Error(`${key}.rim.alpha must sit in (0, 1]`);
      if (!piece.rim.color) throw new Error(`${key}.rim needs a color`);
    }
    checkMaterial(key, piece.material);
    if (piece.tiles) {
      if (!assets) throw new Error(`${key}.tiles needs the asset ledger to resolve`);
      const row = assets[piece.tiles.asset];
      if (!row) throw new Error(`${key}.tiles references unknown asset "${piece.tiles.asset}"`);
      if (!row.import?.tiles?.[piece.tiles.tile]) {
        throw new Error(`${key}.tiles references unknown tile "${piece.tiles.tile}" on ${piece.tiles.asset}`);
      }
    }
  }
  for (const key of Object.keys(spec.sprites || {})) {
    if (!SPRITE_PIECES[key]) throw new Error(`Unknown sprite piece "${key}"`);
  }
  const spriteRef = spec.sprites?.tree?.sprite;
  if (spriteRef) {
    if (!assets) throw new Error('tree.sprite needs the asset ledger to resolve');
    const row = assets[spriteRef.asset];
    if (!row) throw new Error(`tree.sprite references unknown asset "${spriteRef.asset}"`);
    if (row.kind !== 'sprite') throw new Error(`tree.sprite asset "${spriteRef.asset}" is not a sprite`);
  }
  const BADGE_KINDS = Object.keys(SPRITE_PIECES.badge).filter((k) => k !== 'icons');
  for (const [kind, ref] of Object.entries(spec.sprites?.badge?.icons || {})) {
    if (!BADGE_KINDS.includes(kind)) throw new Error(`Unknown badge kind "${kind}"`);
    if (!assets) throw new Error('badge.icons needs the asset ledger to resolve');
    const row = assets[ref?.asset];
    if (!row) throw new Error(`badge.icons.${kind} references unknown asset "${ref?.asset}"`);
    if (row.kind !== 'icon') throw new Error(`badge.icons.${kind} asset "${ref.asset}" is not an icon`);
  }
  const STYLE_AXES = { building: BUILDING_STYLES, tree: TREE_STYLES, slide: TRACK_STYLES, coaster: TRACK_STYLES };
  for (const [k, allowed] of Object.entries(STYLE_AXES)) {
    const style = spec.sprites?.[k]?.style;
    if (style && !allowed.includes(style)) throw new Error(`Unknown ${k} style "${style}"`);
  }
  checkMaterial('building', spec.sprites?.building?.material);
  const amp = spec.strokes?.displacement?.amplitude;
  if (spec.strokes?.displacement) {
    // Seeded-noise hand-tremor on drawn edges (buildings, roads, tracks).
    // The amplitude is the geo-truth budget: certification's
    // style_world_geo row holds the bake to the same number.
    if (!(amp > 0 && amp <= WORLD_DISPLACEMENT_BUDGET_PX)) {
      throw new Error(`strokes.displacement.amplitude must sit in (0, ${WORLD_DISPLACEMENT_BUDGET_PX}] px`);
    }
    const wavelength = spec.strokes.displacement.wavelength;
    if (wavelength != null && !(wavelength >= 1 && wavelength <= 8)) {
      throw new Error('strokes.displacement.wavelength must sit in [1, 8] cells');
    }
  }
  if (spec.wash) {
    if (spec.wash.mode !== 'multiply') throw new Error(`Unknown wash mode "${spec.wash.mode}"`);
    if (!spec.wash.paper) throw new Error('wash needs a paper color under the multiply pass');
  }
  return {
    id: spec.id || 'default',
    label: spec.label || spec.id || 'Default',
    prompt: spec.prompt || null,
    ...(spec.strokes ? { strokes: spec.strokes } : {}),
    ...(spec.wash ? { wash: spec.wash } : {}),
    terrain: merged(TERRAIN_PIECES, spec.terrain),
    sprites: merged(SPRITE_PIECES, spec.sprites),
  };
}

/**
 * Every ledger asset a resolved kit references — tile sheets, the tree
 * sprite, badge icon glyphs. This is the credits manifest's input and the
 * atlas planner's frame list: one place decides what "used" means.
 */
export function kitAssetIds(kit) {
  const ids = new Set();
  for (const piece of Object.values(kit.terrain || {})) {
    if (piece.tiles?.asset) ids.add(piece.tiles.asset);
  }
  if (kit.sprites?.tree?.sprite?.asset) ids.add(kit.sprites.tree.sprite.asset);
  for (const ref of Object.values(kit.sprites?.badge?.icons || {})) {
    if (ref?.asset) ids.add(ref.asset);
  }
  return [...ids].sort();
}

/**
 * Deterministic 0..1 hash from integers — sprite jitter without a RNG.
 * Keep in sync with the inline hash() in bin/display-bake-page.html.
 */
export function cellHash(...nums) {
  let h = 2166136261;
  for (const n of nums) {
    h ^= Math.trunc(n * 8191);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Stable integer seed from a string. FNV-1a over char codes — a real hash, so
 * two areas in one park get unrelated streams. (A seed built by shifting a
 * byte right by 16, or by adding x to y, collapses to a handful of distinct
 * values and shows up as diagonal banding in the bake.)
 * @param {string} s
 * @returns {number}
 */
export function seedFromString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const TERRAIN = { outside: 0, ground: 1, grass: 2, wood: 3, water: 4, lot: 5, road: 6, service: 7 };
export const TERRAIN_NAMES = Object.fromEntries(Object.entries(TERRAIN).map(([k, v]) => [v, k]));

const AREA_TERRAIN = [
  // paint order: later wins
  ['park', TERRAIN.grass],
  ['grass', TERRAIN.grass],
  ['wood', TERRAIN.wood],
  ['parking', TERRAIN.lot],
  ['sea', TERRAIN.water],
  ['water', TERRAIN.water],
  ['pool', TERRAIN.water],
];

// Water/sea/pool paint last (AREA_TERRAIN order) so a real lake still wins
// over grass drawn under it — but a sea/water polygon is frequently just
// the venue's bbox clipped against a coastline, and for a peninsula venue
// that clip can cover nearly the whole grid. The venue's own boundary must
// always win over a lake that merely intersects the bbox: these three
// layers paint only inside it (when the venue has one at all).
const BOUNDARY_CLIPPED_LAYERS = new Set(['sea', 'water', 'pool']);

// Line layers (paintLine, not AREA_TERRAIN) that also imply a terrain
// class — kept alongside AREA_TERRAIN so certification's truth-coverage
// check (display-style-contract.mjs) can share one vocabulary with the
// painter instead of re-guessing which map layer paints which class.
const LINE_TERRAIN = [
  ['service', TERRAIN.service],
  ['path', TERRAIN.road],
];

/**
 * Every terrain class a venue's truth geometry implies should appear in
 * its bake — one map layer with at least one paintable way is one implied
 * class, using the exact same paint-order vocabulary bakeModel() composits
 * with (AREA_TERRAIN's polygons plus service/path's lines). Certification
 * compares this against what a render actually samples: a class implied
 * here and missing from the bake is a compositing bug, not a style choice.
 */
export function impliedTerrainClasses(map) {
  const implied = new Set();
  for (const [layer, terrain] of AREA_TERRAIN) {
    if ((map[layer] || []).some((w) => Array.isArray(w.r) && w.r.length >= 3)) implied.add(TERRAIN_NAMES[terrain]);
  }
  for (const [layer, terrain] of LINE_TERRAIN) {
    if ((map[layer] || []).some((w) => Array.isArray(w.r) && w.r.length >= 2)) implied.add(TERRAIN_NAMES[terrain]);
  }
  return implied;
}

/** The column budget a bake uses when nothing asks for another one. */
export const DEFAULT_MAX_COLS = 240;

/** Pixels a cell occupies when nothing asks for another number. */
export const DEFAULT_PX = 16;

/**
 * The venue's cell grid, and the two maps between geo and cell space.
 *
 * `grid` says how big a cell is, in one of two ways:
 *
 *   - `{ tileMetres }` — ground metres per cell, stated outright. This is what
 *     a band plan carries (`lib/display-bands.mjs`), because ADR-0021 clause 2
 *     fixes ground resolution rather than pixel counts.
 *   - `{ maxCols }`, or a bare number for the callers that predate plans — a
 *     column budget for the LONGER axis, floored at 2 m a cell.
 *
 * A budget cannot express every plan and never will: it is an integer, and it
 * divides both axes, so the resolutions it can reach are quantised. At
 * six-flags-fiesta-texas the overview band needs a cell in
 * (2.39949, 2.40001] m and no integer budget lands inside — 704 gives 2.3977,
 * 703 gives 2.4011. `tileMetres` is therefore the primary spelling and the
 * budget the derived one, not the other way round. `test/builder/display-bands.mjs`
 * pins both.
 *
 * Given both, `tileMetres` wins — bakeModel's callers layer options and the
 * explicit resolution is the more specific statement. A caller that must not
 * conflate the two (the bin, whose flags are a user's words) should refuse the
 * pair up front with `assertBakeGridFlags`.
 */
export function projector(map, grid = DEFAULT_MAX_COLS) {
  const b = map.meta.bounds || {};
  const north = b.n ?? b.north;
  const south = b.s ?? b.south;
  const east = b.e ?? b.east;
  const west = b.w ?? b.west;
  if (![north, south, east, west].every(Number.isFinite)) {
    throw new Error('map.meta.bounds must carry n/s/e/w or north/south/east/west');
  }
  const latMid = (north + south) / 2;
  const mPerLng = 111320 * Math.cos((latMid * Math.PI) / 180);
  const mPerLat = 110574;
  const spanX = (east - west) * mPerLng;
  const spanY = (north - south) * mPerLat;
  const { maxCols = null, tileMetres: fixed = null } = typeof grid === 'number'
    ? { maxCols: grid }
    : (grid ?? {});
  let tileMetres;
  if (fixed != null) {
    if (!(Number.isFinite(fixed) && fixed > 0)) {
      throw new Error(`tileMetres must be a positive finite number of ground metres, got ${fixed}`);
    }
    tileMetres = fixed;
  } else {
    const budget = maxCols || DEFAULT_MAX_COLS;
    tileMetres = Math.max(2, spanX / budget, spanY / budget);
  }
  const cols = Math.max(1, Math.round(spanX / tileMetres));
  const rows = Math.max(1, Math.round(spanY / tileMetres));
  const toCell = ([lng, lat]) => [
    ((lng - west) * mPerLng) / tileMetres,
    ((north - lat) * mPerLat) / tileMetres,
  ];
  const toGeo = ([x, y]) => [
    west + (x * tileMetres) / mPerLng,
    north - (y * tileMetres) / mPerLat,
  ];
  return { cols, rows, tileMetres, toCell, toGeo };
}

/**
 * Refuse a grid stated two ways at once.
 *
 * `--band` fixes both the cell size and the pixels a cell draws at, which is
 * exactly what `--max-cols` and `--px` set by hand. Resolving the pair either
 * way makes the losing flag a lie the caller never sees, and the two are not
 * interchangeable — a band's cell size is often unreachable from any integer
 * column budget (see `projector`). So this refuses rather than picks.
 *
 * Venue-independent on purpose: the bin can call it before it loads a map or
 * launches a browser, which is what makes the refusal cheap enough to test as
 * a process.
 *
 * @param {{band?: string|null, maxCols?: number|null, px?: number|null}} flags
 *   `null`/absent means the flag was not given on the command line.
 */
export function assertBakeGridFlags({ band = null, maxCols = null, px = null } = {}) {
  if (band == null) return;
  bandResolution(band); // throws `unknown band: <id>` before anything else
  const clashing = [maxCols != null && '--max-cols', px != null && '--px'].filter(Boolean);
  if (clashing.length) {
    throw new Error(
      `--band ${band} already fixes the grid, so ${clashing.join(' and ')} would silently `
        + 'overrule it — pass one or the other, not both',
    );
  }
}

/**
 * One venue's grid flags, resolved into what `bakeModel` and the painter page
 * need: a cell size and a pixels-per-cell.
 *
 * Bands are per venue — a band is a ground resolution, and how many cells that
 * is depends on how big the park is — so this takes the venue's `map.meta` and
 * must be called once per venue rather than once per invocation.
 *
 * @param {object} mapMeta the venue's `map.meta` (or the whole map)
 * @param {{band?: string|null, maxCols?: number|null, px?: number|null}} flags
 * @returns {{band: string|null, tileMetres: number|null, maxCols: number|null, px: number}}
 *   `tileMetres` and `maxCols` are mutually exclusive: exactly one is set, and
 *   both spread into `bakeModel` opts unchanged.
 */
export function resolveBakeGrid(mapMeta, flags = {}) {
  assertBakeGridFlags(flags);
  const { band = null, maxCols = null, px = null } = flags;
  if (band == null) {
    return { band: null, tileMetres: null, maxCols: maxCols ?? DEFAULT_MAX_COLS, px: px ?? DEFAULT_PX };
  }
  const plan = bandBakePlan(mapMeta, band);
  return { band, tileMetres: plan.tileMetres, maxCols: null, px: plan.px };
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * @param {number[]} cells terrain grid, mutated in place
 * @param {[number, number][]} ring polygon to paint, cell space
 * @param {number} terrain terrain code to paint
 * @param {[number, number][]|null} [clipRing] when given, a cell only
 *   paints if it is ALSO inside this ring — the venue boundary overruling
 *   a polygon that merely intersects the map's bbox (water/sea/pool).
 */
function paintPolygon(cells, cols, rows, ring, terrain, clipRing = null) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const x0 = Math.max(0, Math.floor(minX)); const x1 = Math.min(cols - 1, Math.ceil(maxX));
  const y0 = Math.max(0, Math.floor(minY)); const y1 = Math.min(rows - 1, Math.ceil(maxY));
  const painted = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const cx = x + 0.5; const cy = y + 0.5;
      if (pointInRing(cx, cy, ring) && (!clipRing || pointInRing(cx, cy, clipRing))) {
        cells[y * cols + x] = terrain;
        painted.push([x, y]);
      }
    }
  }
  return painted;
}

function paintLine(cells, cols, rows, pts, terrain, halfWidth) {
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
    for (let s = 0; s <= steps; s += 1) {
      const x = ax + ((bx - ax) * s) / steps;
      const y = ay + ((by - ay) * s) / steps;
      for (let dy = -halfWidth; dy <= halfWidth; dy += 1) {
        for (let dx = -halfWidth; dx <= halfWidth; dx += 1) {
          const cx = Math.round(x + dx); const cy = Math.round(y + dy);
          if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) cells[cy * cols + cx] = terrain;
        }
      }
    }
  }
}

/**
 * Dither vegetation into the surface beside it.
 *
 * A filled polygon ends on a hard vector edge, which is exactly what a park
 * does not look like — planting fades into pavement. Rather than offset the
 * polygon and fill a band (which needs boolean geometry), this walks the
 * cells that could receive spill and flips them with a probability that falls
 * off with distance from the nearest vegetated neighbour.
 *
 * The pattern is a hash of the cell and the terrain it is spilling, so it is
 * stable across reruns and different for grass than for wood.
 *
 * @param {number[]} cells terrain grid, mutated in place
 * @param {number} cols
 * @param {number} rows
 * @param {{ spread?: number[], over?: number[], reach?: number, strength?: number }} [opts]
 */
export function crownStipple(cells, cols, rows, opts = {}) {
  const spread = opts.spread ?? [TERRAIN.wood, TERRAIN.grass];
  const over = opts.over ?? [TERRAIN.ground, TERRAIN.lot];
  const reach = opts.reach ?? 2;
  const strength = opts.strength ?? 0.55;
  const src = cells.slice();
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const i = y * cols + x;
      if (!over.includes(src[i])) continue;
      let nearest = -1;
      let dist = Infinity;
      for (let dy = -reach; dy <= reach; dy += 1) {
        for (let dx = -reach; dx <= reach; dx += 1) {
          const cx = x + dx;
          const cy = y + dy;
          if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
          const v = src[cy * cols + cx];
          if (!spread.includes(v)) continue;
          const d = Math.hypot(dx, dy);
          if (d < dist) { dist = d; nearest = v; }
        }
      }
      if (nearest < 0) continue;
      const falloff = 1 - (dist - 1) / reach;
      if (falloff <= 0) continue;
      if (cellHash(x, y, nearest) < falloff * strength) cells[i] = nearest;
    }
  }
}

/**
 * Distance-to-boundary field for one terrain class, in cells: for every
 * cell of `terrain`, the chebyshev distance to the nearest cell of any
 * other class (1 = touching the boundary), capped at `reach + 1`; cells of
 * other classes carry 0. This is the research note's "watercolor via
 * distance-field boundary lookup" made concrete: the compositor's
 * pigment-pooling rim darkens a class near its own edge with an alpha that
 * falls off along this field. Pure and deterministic — computed lib-side
 * (like autotile masks) so the painter page stays a consumer.
 *
 * @param {number[]} cells terrain grid
 * @param {number} cols
 * @param {number} rows
 * @param {number} terrain terrain code the field describes
 * @param {number} [reach] cells past which distance saturates
 * @returns {number[]}
 */
export function boundaryDistanceField(cells, cols, rows, terrain, reach = 3) {
  const out = new Array(cols * rows).fill(0);
  const at = (x, y) => ((x < 0 || y < 0 || x >= cols || y >= rows) ? -1 : cells[y * cols + x]);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (at(x, y) !== terrain) continue;
      let d = reach + 1;
      ring: for (let r = 1; r <= reach; r += 1) {
        for (let dy = -r; dy <= r; dy += 1) {
          for (let dx = -r; dx <= r; dx += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (at(x + dx, y + dy) !== terrain) { d = r; break ring; }
          }
        }
      }
      out[y * cols + x] = d;
    }
  }
  return out;
}

/** POI category → badge kind. Exported so certification (style_world_geo)
 *  can match model badges back to the truth POIs they derive from. */
export const POI_BADGES = { gate: 'gate', food: 'food', restroom: 'restroom', shop: 'shop', show: 'show', service: 'service' };

/**
 * Build the bake model for one venue.
 *
 * @param {object} map map.json body
 * @param {object[]} pois pois.json
 * @param {{ maxCols?: number, tileMetres?: number, margin?: number }} opts
 *   How big a cell is — `tileMetres` outright (what a band plan carries), or
 *   `maxCols` as a column budget for the longer axis (default 240). Given
 *   both, `tileMetres` wins; see `projector` for why it has to be the primary
 *   spelling. `margin` is the crop padding in cells (default 6); `Infinity`
 *   opens the window to the whole grid.
 */
export function bakeModel(map, pois = [], opts = {}) {
  const { cols, rows, tileMetres, toCell, toGeo } = projector(map, {
    maxCols: opts.maxCols,
    tileMetres: opts.tileMetres,
  });
  const cells = new Array(cols * rows).fill(TERRAIN.outside);

  // Ground inside the venue boundary (or everywhere when no boundary).
  let boundaryRing = null;
  if (Array.isArray(map.boundary) && map.boundary.length >= 3) {
    boundaryRing = map.boundary.map(toCell);
    paintPolygon(cells, cols, rows, boundaryRing, TERRAIN.ground);
  } else {
    cells.fill(TERRAIN.ground);
  }

  const treeCells = { wood: [], grass: [] };
  const scatterNotes = [];
  for (const [layer, terrain] of AREA_TERRAIN) {
    const clipRing = boundaryRing && BOUNDARY_CLIPPED_LAYERS.has(layer) ? boundaryRing : null;
    for (const way of map[layer] || []) {
      if (!Array.isArray(way.r) || way.r.length < 3) continue;
      const painted = paintPolygon(cells, cols, rows, way.r.map(toCell), terrain, clipRing);
      // Appended one at a time, never spread. `push(...painted)` passes every
      // cell as an argument, and the engine caps that near 125k — under the
      // 47,520-cell grid a 240-column bake produces, so it never fired, and
      // over it the moment ADR-0021 clause 2's close band asks for 646 columns
      // and 344,964 cells. A meadow covering a third of the park is enough.
      const sink = terrain === TERRAIN.wood ? treeCells.wood
        : terrain === TERRAIN.grass ? treeCells.grass
          : null;
      if (sink) for (const cell of painted) sink.push(cell);
    }
  }

  // Soften vegetation edges before roads and lots are stamped, so paths stay
  // crisp and only open ground receives the spill.
  crownStipple(cells, cols, rows);

  // Ground truth (aerial imagery): a parking lot is one contiguous asphalt
  // expanse; OSM often maps it as separate row polygons. A cell flanked by
  // lot within LOT_REACH cells on opposite sides is aisle, not meadow —
  // close it, but only over ground/grass, never over water or roads.
  const LOT_REACH = 4;
  const closable = new Set([TERRAIN.ground, TERRAIN.grass]);
  const lotWithin = (x, y, dx, dy) => {
    for (let k = 1; k <= LOT_REACH; k += 1) {
      const cx = x + dx * k; const cy = y + dy * k;
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
      const t = cells[cy * cols + cx];
      if (t === TERRAIN.lot) return true;
      if (!closable.has(t)) return false;
    }
    return false;
  };
  const grown = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!closable.has(cells[y * cols + x])) continue;
      if ((lotWithin(x, y, -1, 0) && lotWithin(x, y, 1, 0))
        || (lotWithin(x, y, 0, -1) && lotWithin(x, y, 0, 1))) grown.push(x + y * cols);
    }
  }
  for (const i of grown) cells[i] = TERRAIN.lot;
  // Roads render as smooth round-capped polylines (crisp diagonals, dashed
  // centerlines); cells under them still classify for terrain sanity.
  const roads = [];
  for (const way of map.service || []) {
    if (way.r?.length >= 2) {
      const pts = way.r.map(toCell);
      paintLine(cells, cols, rows, pts, TERRAIN.service, 0);
      roads.push({ kind: 'service', pts });
    }
  }
  for (const way of map.path || []) {
    if (way.r?.length >= 2) {
      const pts = way.r.map(toCell);
      paintLine(cells, cols, rows, pts, TERRAIN.road, 0);
      roads.push({ kind: 'path', pts });
    }
  }

  const buildings = (map.building || [])
    .filter((w) => w.r?.length >= 3)
    .map((w, i) => ({ ring: w.r.map(toCell), roof: i % 3 }));

  // Occupancy: cells under building footprints (padded a cell) grow no
  // trees — a sprite inside a roof reads as a bug, not a forest.
  const occupied = new Array(cols * rows).fill(0);
  for (const b of buildings) paintPolygon(occupied, cols, rows, b.ring, 1);
  const isOccupied = (x, y) => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const cx = x + dx; const cy = y + dy;
        if (cx >= 0 && cy >= 0 && cx < cols && cy < rows && occupied[cy * cols + cx]) return true;
      }
    }
    return false;
  };

  // Parking aisles, along each lot's own long axis.
  const lotRows = [];
  for (const way of map.parking || []) {
    if (!(way.r?.length >= 3)) continue;
    const ring = way.r.map(toCell);
    const { placed, axis } = fillRows({
      ring,
      rowSpacing: Math.max(1.4, AISLE_METRES / tileMetres),
      itemSpacing: Math.max(0.8, AISLE_DASH_METRES / tileMetres),
      id: 'aisle',
      // Only over ground the lot actually covers — a lot polygon that overlaps
      // a path or a building must not stripe across it.
      reject: (x, y) => {
        const cx = Math.round(x);
        const cy = Math.round(y);
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return true;
        return cells[cy * cols + cx] !== TERRAIN.lot || isOccupied(cx, cy);
      },
    });
    for (const p of placed) lotRows.push({ x: p.x, y: p.y, dx: axis.ax, dy: axis.ay });
  }
  lotRows.sort((a, b) => a.y - b.y || a.x - b.x);

  // Trees: dense canopy in woods, scattered on grass. Placement is a real
  // scatter (area-derived count, non-overlapping discs, noise-biased darts)
  // rather than a per-cell coin flip, so sprites stop stacking on each other
  // and a wood reads as a thicket instead of wallpaper. See display-scatter.mjs.
  const trees = [];
  for (const kind of ['wood', 'grass']) {
    const candidates = treeCells[kind].filter(
      ([x, y]) => cells[y * cols + x] === TERRAIN[kind] && !isOccupied(x, y),
    );
    const species = TREE_SPECIES[kind];
    const { placed, dropped, requested } = scatterPoints({
      cells: candidates,
      species,
      seed: seedFromString(`${map.meta?.id || 'venue'}:${kind}`),
      density: densityFromSpecies(species) * TREE_DENSITY_SCALE[kind],
      reject: (x, y) => isOccupied(Math.floor(x), Math.floor(y)),
    });
    // No silent caps: a wood that could not be filled is worth knowing about.
    if (dropped > 0) scatterNotes.push({ kind, requested, dropped });
    for (const p of placed) trees.push({ x: p.x, y: p.y, big: p.big });
  }
  trees.sort((a, b) => a.y - b.y || a.x - b.x);

  const tracks = [];
  let slideIdx = 0;
  for (const layer of ['coaster', 'slide']) {
    if (!LINE_LAYERS.has(layer)) continue;
    for (const way of map[layer] || []) {
      if (!(way.r?.length >= 2)) continue;
      // Presentation stays out of the model: slides carry an index the
      // kit's slide piece maps to a color.
      tracks.push({ kind: layer, pts: way.r.map(toCell), idx: layer === 'slide' ? slideIdx++ : 0 });
    }
  }

  const badges = pois
    .filter((p) => POI_BADGES[p.c] && Number.isFinite(p.lat))
    .map((p) => {
      const [x, y] = toCell([p.lng, p.lat]);
      return { kind: POI_BADGES[p.c], name: p.n, x, y };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);

  // Terrain channels: relief shading and a steepness flag the kit may paint
  // differently. Absent when the venue has no DEM — flat is a real answer.
  let shade = null;
  let steep = null;
  if (opts.terrain?.grid && opts.terrain?.shade) {
    const { grid } = opts.terrain;
    const steepAt = opts.terrain.steepDegrees ?? 18;
    shade = opts.terrain.shade;
    steep = new Array(cols * rows).fill(0);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        // Grid and bake share an aspect but not always a resolution.
        const gx = ((x + 0.5) / cols) * grid.cols;
        const gy = ((y + 0.5) / rows) * grid.rows;
        steep[y * cols + x] = grid.slopeAt(gx, gy) >= steepAt ? 1 : 0;
      }
    }
  }

  const model = cropModel({
    version: 1,
    venue: map.meta?.id,
    cols,
    rows,
    tileMetres: Math.round(tileMetres * 100) / 100,
    terrains: TERRAIN_NAMES,
    cells,
    ...(shade ? { shade } : {}),
    ...(steep ? { steep } : {}),
    roads,
    trees,
    lotRows,
    buildings,
    tracks,
    badges,
    ...(scatterNotes.length ? { scatterNotes } : {}),
  }, boundaryRing, opts.margin ?? 6, toGeo);
  // Declutter after the crop so a cluster whose greedy keeper fell
  // outside the window still pins an in-window member.
  model.badges = declutterBadges(model.badges);
  return model;
}

/**
 * Reference-map declutter: dense POI clusters would stack pins into
 * unreadable blends, so thin greedily — gate pins take priority over
 * other kinds (two gates within reach still thin to one), everything
 * else yields to an earlier pin within reach. Dropped POIs stay truth;
 * they just don't badge at this scale (ADR-0012: annotation is a
 * decluttered final layer).
 */
export function declutterBadges(badges, reach = 1.6) {
  const kept = [];
  for (const b of [...badges.filter((x) => x.kind === 'gate'), ...badges.filter((x) => x.kind !== 'gate')]) {
    if (kept.some((k) => Math.hypot(k.x - b.x, k.y - b.y) < reach)) continue;
    kept.push(b);
  }
  return kept.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * Crop to the venue: the map fills the frame instead of floating in its
 * padded bounds. The window is the boundary ring's box plus a margin
 * (falling back to non-outside content when a venue has no boundary).
 */
function cropModel(model, boundaryRing, margin, toGeo) {
  const { cols, rows, cells } = model;
  // Geo bounds of the window — the raster tier and pack manifest need to
  // place the baked image on the map (WSEN, like everything MapLibre).
  const geoBounds = (x0, y0, x1, y1) => {
    if (!toGeo) return null;
    const [west, north] = toGeo([x0, y0]);
    const [east, south] = toGeo([x1 + 1, y1 + 1]);
    const r = (v) => Math.round(v * 1e7) / 1e7;
    return { west: r(west), south: r(south), east: r(east), north: r(north) };
  };
  let minX = cols; let minY = rows; let maxX = -1; let maxY = -1;
  if (boundaryRing) {
    for (const [x, y] of boundaryRing) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  } else {
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        if (TERRAIN_NAMES[cells[y * cols + x]] !== 'outside') {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
  }
  if (maxX < 0) return { ...model, bounds: geoBounds(0, 0, cols - 1, rows - 1) };
  // Boundary ring coords are floats — floor/ceil before the margin so the
  // window (and every array size derived from it) stays integral.
  const x0 = Math.max(0, Math.floor(minX) - margin); const y0 = Math.max(0, Math.floor(minY) - margin);
  const x1 = Math.min(cols - 1, Math.ceil(maxX) + margin); const y1 = Math.min(rows - 1, Math.ceil(maxY) + margin);
  const newCols = x1 - x0 + 1; const newRows = y1 - y0 + 1;
  const cropCells = (src) => {
    const out = new Array(newCols * newRows);
    for (let y = 0; y < newRows; y += 1) {
      for (let x = 0; x < newCols; x += 1) {
        out[y * newCols + x] = src[(y + y0) * cols + (x + x0)];
      }
    }
    return out;
  };
  const newCells = cropCells(cells);
  // Per-cell terrain channels ride along, or the shade lands on the wrong ground.
  const newShade = model.shade ? cropCells(model.shade) : null;
  const newSteep = model.steep ? cropCells(model.steep) : null;
  const shiftPt = ([x, y]) => [x - x0, y - y0];
  // Entities entirely outside the window (neighboring businesses inside the
  // map bbox but beyond the venue boundary) leave the model, not just the
  // canvas — an off-crop building is not part of this world.
  const ptIn = ([x, y]) => x >= 0 && y >= 0 && x < newCols && y < newRows;
  const anyIn = (pts) => pts.some(ptIn);
  return {
    ...model,
    cols: newCols,
    rows: newRows,
    bounds: geoBounds(x0, y0, x1, y1),
    cells: newCells,
    ...(newShade ? { shade: newShade } : {}),
    ...(newSteep ? { steep: newSteep } : {}),
    roads: model.roads.map((r) => ({ ...r, pts: r.pts.map(shiftPt) })).filter((r) => anyIn(r.pts)),
    trees: model.trees.map((t) => ({ ...t, x: t.x - x0, y: t.y - y0 })).filter((t) => ptIn([t.x, t.y])),
    lotRows: (model.lotRows || []).map((r) => ({ ...r, x: r.x - x0, y: r.y - y0 })).filter((r) => ptIn([r.x, r.y])),
    buildings: model.buildings.map((b) => ({ ...b, ring: b.ring.map(shiftPt) })).filter((b) => anyIn(b.ring)),
    tracks: model.tracks.map((t) => ({ ...t, pts: t.pts.map(shiftPt) })).filter((t) => anyIn(t.pts)),
    badges: model.badges.map((b) => ({ ...b, x: b.x - x0, y: b.y - y0 })).filter((b) => ptIn([b.x, b.y])),
  };
}
