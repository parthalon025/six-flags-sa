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
/** …and the floor a dash never draws shorter than, in cells. A dash under a
 *  cell is a dot, whatever the ground says. Named because the band policy has
 *  to measure the same dash the painter draws. */
const AISLE_DASH_MIN_CELLS = 0.8;

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
 * against this at resolve time, so the budget is a proof, not a promise.
 *
 * ADR-0021 clause 3 supersedes it for a band-addressed bake: three pixels is
 * a different ground distance at every park (1.21 m at kings-island, 0.52 m at
 * big-kahunas), and clause 3 wants one metre to mean one metre everywhere. The
 * style_world_geo row therefore asserts `alignmentBudgetMetres(band)` from
 * `display-style-contract.mjs` wherever a band is named, and falls back to this
 * number — restated in ground metres — only for a bake that has none.
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
    // The amplitude is the geo-truth budget in bake pixels. A band-addressed
    // bake is held to a tighter one — ADR-0021 clause 3 allows a single pixel
    // of ground, so an amplitude above 1 fails style_world_geo at the mid and
    // close bands even though it resolves cleanly here.
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

/* ------------------------------------- ADR-0019 clause 1: per-band content --
 *
 * A band is a ground resolution, not a sharpness knob, and the three bands
 * share ONE cell grid: `display-bands.mjs` makes the cell grid the coarsest
 * band's pixel grid, so finer bands draw the same cells larger rather than
 * adding cells. Left alone, that means all three bands carry identical content
 * at three sharpnesses — which is precisely "one ultra-res bake, tiled", the
 * shape ADR-0019 rejected on the grounds that sharper is not clearer.
 *
 * Generalization is what makes the bands differ in CONTENT. ADR-0021 clause 3
 * fixes its one permitted move: it removes, never moves. A band may drop a
 * feature entirely; any feature it does draw sits where Truth says it sits. So
 * this is a subtractive policy and nothing else — it never nudges a mark, never
 * simplifies a ring, never invents a landmark. That is also what keeps ADR-0021
 * clause 1 true: a band that only ever removes cannot become the sole home of a
 * fact, because everything it drops is still in `pois.json` and `map.json`.
 *
 * The rule is one legibility floor applied to every generalizable mark: a mark
 * that cannot draw at least `BAND_LEGIBILITY_FLOOR_PX` pixels across is not a
 * small version of itself, it is a stipple. Measured at the three bands (every
 * shipped venue plans a ~2.4 m cell, so these hold catalogue-wide):
 *
 *   mark            size        overview 2.4 m/px   mid 0.6 m/px   close 0.15
 *   tree crown      1.2 cells       1.2 px            4.8 px        19.2 px
 *   aisle dash      4 m             1.7 px            6.7 px        26.7 px
 *   badge spacing   1.6 cells       1.6 px            6.4 px        25.6 px
 *
 * So overview drops trees and aisle marks and thins its pins to landmarks,
 * while mid and close draw everything — which is the other half of the ADR:
 * mid is "today's bake, unchanged" (clause 1), and close is the finest band,
 * with nothing below it to generalize FOR. Close-band specificity is added
 * content from kit vocabulary (ADR-0021 clause 7), not removed content, and
 * therefore is not this policy's job.
 *
 * Scope, deliberately: MARKS, never cells. The terrain grid is the geometry all
 * three bands share and the thing every position is measured against; removing
 * a class from it would break both the cross-band comparison and
 * `style_terrain_coverage`, which exists to catch exactly a vanished class.
 */

/** The smallest a mark may draw and still be a shape rather than a smudge, in
 *  band pixels.
 *
 *  Three, and it is a judgement rather than a derivation: under three pixels a
 *  round crown cannot show a rim and a dash cannot show which way it points, so
 *  what lands on the picture is noise that happens to move with the data. The
 *  number is declared here, in one place, so a band's content is a consequence
 *  of it rather than of a hand-written list per band. The measured margins
 *  above are wide — 1.7 px at overview against 4.8 px at mid — so no shipped
 *  venue sits near the edge of it. */
export const BAND_LEGIBILITY_FLOOR_PX = 3;

/** How close two badge pins may sit, in cells, before `declutterBadges` thins
 *  one away. Exported because the band policy reads it as the drawn size of
 *  annotation: pins closer together than the legibility floor stack into an
 *  unreadable blend however big the discs themselves are. */
export const BADGE_DECLUTTER_REACH_CELLS = 1.6;

/** The badge kinds a band still pins once annotation has to thin — ADR-0019
 *  clause 1's "landmarks only". A gate is the one kind the map's own declutter
 *  already privileges over its cluster-mates, for the same reason: it is the
 *  pin a guest navigates the whole park by. Everything thinned away stays in
 *  `pois.json`, so nothing is lost (ADR-0021 clause 1). */
export const BAND_LANDMARK_BADGE_KINDS = Object.freeze(['gate']);

/**
 * The generalizable marks, and how big each draws.
 *
 * `sizeMetres` is the size the SMALLEST mark of the kind draws at, because the
 * question a floor answers is "does this kind of detail survive here" — a kind
 * whose ordinary members are specks is drawn as noise even when its rare big
 * ones read. `below` says what removal means for the kind: an array the band
 * drops outright, or annotation the band thins to landmarks.
 */
const BAND_MARKS = Object.freeze([
  Object.freeze({
    kind: 'trees',
    below: 'drop',
    // The smallest crown any species scatters, read off TREE_SPECIES so the
    // policy cannot drift from the sprites it is judging.
    sizeMetres: (tileMetres) =>
      2 * Math.min(...Object.values(TREE_SPECIES).flat().map((s) => s.radius)) * tileMetres,
  }),
  Object.freeze({
    kind: 'lotRows',
    below: 'drop',
    // One aisle dash, with the same cell floor `fillRows` is handed below.
    sizeMetres: (tileMetres) => Math.max(AISLE_DASH_MIN_CELLS * tileMetres, AISLE_DASH_METRES),
  }),
  Object.freeze({
    kind: 'badges',
    below: 'landmarks',
    sizeMetres: (tileMetres) => BADGE_DECLUTTER_REACH_CELLS * tileMetres,
  }),
]);

/**
 * What one band draws, and what it removes.
 *
 * Pure and venue-aware: a band is a ground resolution, so how many pixels a
 * mark draws at depends on the venue's cell size as well as on the band.
 *
 * @param {string} bandId a band from the shared table — throws on an unknown one
 * @param {{tileMetres: number}} grid the venue's ground metres per cell
 * @returns a frozen policy: `drops` are the model arrays this band empties,
 *   `badgeKinds` is the kinds it still pins (`null` = every kind), and `marks`
 *   carries the measurement each decision was made from, so a certification row
 *   can restate the arithmetic rather than take the verdict on trust.
 */
export function bandGeneralization(bandId, { tileMetres } = {}) {
  const metresPerPixel = bandResolution(bandId); // throws `unknown band: <id>`
  if (!(Number.isFinite(tileMetres) && tileMetres > 0)) {
    throw new Error(
      `bandGeneralization needs the venue's ground metres per cell, got ${tileMetres}`,
    );
  }
  const marks = BAND_MARKS.map((m) => {
    const sizeMetres = m.sizeMetres(tileMetres);
    const drawnPx = sizeMetres / metresPerPixel;
    return Object.freeze({
      kind: m.kind,
      below: m.below,
      sizeMetres: Math.round(sizeMetres * 1000) / 1000,
      drawnPx: Math.round(drawnPx * 100) / 100,
      drawn: drawnPx >= BAND_LEGIBILITY_FLOOR_PX,
    });
  });
  const thins = marks.some((m) => m.kind === 'badges' && !m.drawn);
  return Object.freeze({
    band: bandId,
    metresPerPixel,
    tileMetres,
    floorPx: BAND_LEGIBILITY_FLOOR_PX,
    marks: Object.freeze(marks),
    drops: Object.freeze(marks.filter((m) => m.below === 'drop' && !m.drawn).map((m) => m.kind)),
    badgeKinds: thins ? BAND_LANDMARK_BADGE_KINDS : null,
  });
}

/**
 * Apply a band's policy to a finished model — the one place content is removed.
 *
 * Subtractive by construction: it empties arrays and filters one of them, and
 * has no way to express moving a mark. Everything it removes is still in the
 * venue's truth files, which is what makes the removal free (ADR-0021 clause 1).
 */
function generalizeModel(model, policy) {
  const out = { ...model, band: policy.band, generalization: policy };
  for (const kind of policy.drops) out[kind] = [];
  // Scatter notes account for tree darts that could not be placed; a band that
  // draws no trees must not ship a note about them.
  if (policy.drops.includes('trees')) delete out.scatterNotes;
  if (policy.badgeKinds) out.badges = out.badges.filter((b) => policy.badgeKinds.includes(b.kind));
  return out;
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
 * The geo footprint of a baked grid: the grid's own four corners, in WSEN
 * like everything MapLibre reads.
 *
 * This is the whole of ADR-0021's crop answer, closed 2026-08-22 as "don't
 * trim, use the large tiles". The bake used to shrink itself to the boundary
 * ring's box plus a margin and state THAT window here, so a venue whose
 * boundary left slack inside its bbox planned one picture and emitted a
 * smaller one — big-kahunas planned 244x276 and baked 157x191, while
 * kings-island matched its plan only because its boundary happens to fill its
 * bbox. A band plan is a statement about the World, and the World is the map
 * bbox at the projector's cell size, so the emitted picture is that grid and
 * its bounds are that grid's corners. Nothing here consults the boundary: a
 * boundary decides which cells are ground and which are `outside`, never how
 * big a picture the bake hands back.
 *
 * The far corner is `toGeo([cols, rows])` rather than `[cols - 1, rows - 1]`
 * because these are cell EDGES, not cell centres — the last cell's far side is
 * where the image ends.
 *
 * NO COMMITTED VENUE PLACEMENT MOVES because of this. kings-island is the only
 * venue in the repo with a committed bake — six `*.world.json` sidecars under
 * `data/venues/kings-island/display/`, two of them published to
 * `apps/party-tracker/public/venues/kings-island/display/` — and its boundary
 * fills its bbox, so the crop was already a no-op there. Both revisions were
 * run against the shipped map: the old `cropModel` and this `gridBounds` each
 * bake 240x197 cells at the default column budget and each state
 * `{west: -84.2775, south: 39.3364963, east: -84.2595, north: 39.348}`, which
 * is byte for byte what those six sidecars already carry (and 240x197 cells is
 * what their PNGs measure: 2880x2364 at 12 px, 3840x3152 at 16). Checked by
 * running both, not by reading them; pinned by "the only committed bake keeps
 * its placement" in `test/builder/display-bands.mjs`. Every other venue's
 * picture does change size — that is the point of the change — but none of
 * them has a baked artifact in the tree to invalidate.
 */
function gridBounds(cols, rows, toGeo) {
  const [west, north] = toGeo([0, 0]);
  const [east, south] = toGeo([cols, rows]);
  // 1e-7 degrees is ~1 cm — finer than any truth this reads, and enough to
  // keep a rerun byte-identical against floating-point noise.
  const r = (v) => Math.round(v * 1e7) / 1e7;
  return { west: r(west), south: r(south), east: r(east), north: r(north) };
}

/**
 * Build the bake model for one venue.
 *
 * @param {object} map map.json body
 * @param {object[]} pois pois.json
 * @param {{ maxCols?: number, tileMetres?: number, band?: string }} opts
 *   How big a cell is — `tileMetres` outright (what a band plan carries), or
 *   `maxCols` as a column budget for the longer axis (default 240). Given
 *   both, `tileMetres` wins; see `projector` for why it has to be the primary
 *   spelling. Those two are the ONLY things that decide how big the emitted
 *   picture is: the model is always the projector's whole grid (see
 *   `gridBounds`), so a band plan and its bake describe the same picture.
 *
 *   `band` names which zoom band this model is for, and generalizes the content
 *   accordingly (`bandGeneralization`): the model then carries a `band` and a
 *   `generalization` stamp, and the marks that band cannot draw are gone. Omit
 *   it and the model is exactly what it has always been — no stamp, nothing
 *   removed — because a caller who never asked for a band has not asked to have
 *   content taken away either.
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
      itemSpacing: Math.max(AISLE_DASH_MIN_CELLS, AISLE_DASH_METRES / tileMetres),
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

  const model = {
    version: 1,
    venue: map.meta?.id,
    cols,
    rows,
    tileMetres: Math.round(tileMetres * 100) / 100,
    bounds: gridBounds(cols, rows, toGeo),
    terrains: TERRAIN_NAMES,
    cells,
    ...(shade ? { shade } : {}),
    ...(steep ? { steep } : {}),
    roads,
    trees,
    lotRows,
    buildings,
    tracks,
    badges: declutterBadges(badges),
    ...(scatterNotes.length ? { scatterNotes } : {}),
  };
  if (opts.band == null) return model;
  // Generalize last, on the finished model, so removal is one readable pass
  // over exactly what would otherwise ship. It reads the model's own rounded
  // `tileMetres` rather than the projector's, so the policy stamped here and
  // the policy a certification row re-derives from the model are the same
  // arithmetic on the same number.
  return generalizeModel(model, bandGeneralization(opts.band, { tileMetres: model.tileMetres }));
}

/**
 * Reference-map declutter: dense POI clusters would stack pins into
 * unreadable blends, so thin greedily — gate pins take priority over
 * other kinds (two gates within reach still thin to one), everything
 * else yields to an earlier pin within reach. Dropped POIs stay truth;
 * they just don't badge at this scale (ADR-0012: annotation is a
 * decluttered final layer).
 */
export function declutterBadges(badges, reach = BADGE_DECLUTTER_REACH_CELLS) {
  const kept = [];
  for (const b of [...badges.filter((x) => x.kind === 'gate'), ...badges.filter((x) => x.kind !== 'gate')]) {
    if (kept.some((k) => Math.hypot(k.x - b.x, k.y - b.y) < reach)) continue;
    kept.push(b);
  }
  return kept.sort((a, b) => a.y - b.y || a.x - b.x);
}
