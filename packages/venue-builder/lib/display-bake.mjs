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

import { LINE_LAYERS } from './osm-tags.mjs';

/* ------------------------------------------------ the pieces vocabulary --
 * The bake decomposes into the smallest pieces the builder owns. A kit is
 * a composition of pieces; a map prompt selects per piece; the compositor
 * only orders them. Each terrain piece = base color + one texture primitive;
 * each sprite piece = a small param set. New looks come from new piece
 * params — new *kinds* of pieces are code, added one at a time with a test.
 */

/** Texture primitives the compositor knows how to paint. */
export const TEXTURE_KINDS = ['none', 'speckle', 'tuft', 'wave', 'dot', 'stripe', 'dash', 'hatch'];

/** Structural design switches — different drawing, not different color. */
export const BUILDING_STYLES = ['drop', 'flat', 'outline'];
export const TREE_STYLES = ['round', 'dot', 'none'];
export const TRACK_STYLES = ['tube', 'mono'];

export const TERRAIN_PIECES = {
  outside: { base: '#6B4E9B', texture: { kind: 'dot', color: '#7A5BAD', density: 0.35 } },
  ground: { base: '#EBDDA8', texture: { kind: 'speckle', color: '#DFCE8F', density: 0.3 } },
  grass: { base: '#7FB86B', texture: { kind: 'tuft', color: '#5F9C50', density: 0.35 } },
  wood: { base: '#639E55', texture: { kind: 'tuft', color: '#4E8443', density: 0.35 } },
  water: { base: '#58AEDC', texture: { kind: 'wave', color: '#8FCBE8', density: 0.3 } },
  lot: { base: '#B9B3A6', texture: { kind: 'stripe', color: '#E2DDD2', density: 0.33 } },
  road: { base: '#8C8F98', texture: { kind: 'dash', color: '#C9CCD3', density: 1 } },
  service: { base: '#7D8089', texture: { kind: 'none' } },
};

export const SPRITE_PIECES = {
  tree: { style: 'round', canopy: '#3F7A38', highlight: '#6FBF5C', shadow: 'rgba(0,0,0,0.22)', scale: 1 },
  building: { style: 'drop', roofs: ['#C7B9A2', '#B79E8C', '#9FA6B4'], edge: '#5E5648', wall: '#6E6355', drop: 0.25 },
  slide: { style: 'tube', casing: 'rgba(255,255,255,0.9)', colors: ['#F4C542', '#E05548', '#3FA0D8', '#7BC47F', '#C468D8', '#F08A3C'], width: 1 },
  coaster: { style: 'tube', rail: '#4A3A30', tie: '#C9B9A6' },
  badge: { gate: '#D84B4B', food: '#E8862F', restroom: '#3F7FBF', shop: '#4FA36B', show: '#9A5FC0', service: '#8A8F98' },
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
 */
export function resolveKit(spec = {}, { assets, overlay } = {}) {
  if (overlay) {
    spec = {
      ...spec,
      terrain: merged(spec.terrain || {}, overlay.terrain || {}),
      sprites: merged(spec.sprites || {}, overlay.sprites || {}),
    };
  }
  for (const key of Object.keys(spec.terrain || {})) {
    if (!TERRAIN_PIECES[key]) throw new Error(`Unknown terrain piece "${key}"`);
    const piece = spec.terrain[key] || {};
    const kind = piece.texture?.kind;
    if (kind && !TEXTURE_KINDS.includes(kind)) throw new Error(`Unknown texture kind "${kind}" on ${key}`);
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
  const styleOf = (k) => spec.sprites?.[k]?.style;
  if (styleOf('building') && !BUILDING_STYLES.includes(styleOf('building'))) {
    throw new Error(`Unknown building style "${styleOf('building')}"`);
  }
  if (styleOf('tree') && !TREE_STYLES.includes(styleOf('tree'))) {
    throw new Error(`Unknown tree style "${styleOf('tree')}"`);
  }
  for (const k of ['slide', 'coaster']) {
    if (styleOf(k) && !TRACK_STYLES.includes(styleOf(k))) throw new Error(`Unknown ${k} style "${styleOf(k)}"`);
  }
  return {
    id: spec.id || 'default',
    label: spec.label || spec.id || 'Default',
    prompt: spec.prompt || null,
    terrain: merged(TERRAIN_PIECES, spec.terrain),
    sprites: merged(SPRITE_PIECES, spec.sprites),
  };
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

function projector(map, maxCols) {
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
  const tileMetres = Math.max(2, spanX / maxCols, spanY / maxCols);
  const cols = Math.max(1, Math.round(spanX / tileMetres));
  const rows = Math.max(1, Math.round(spanY / tileMetres));
  const toCell = ([lng, lat]) => [
    ((lng - west) * mPerLng) / tileMetres,
    ((north - lat) * mPerLat) / tileMetres,
  ];
  return { cols, rows, tileMetres, toCell };
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

function paintPolygon(cells, cols, rows, ring, terrain) {
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
      if (pointInRing(x + 0.5, y + 0.5, ring)) {
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

const POI_BADGES = { gate: 'gate', food: 'food', restroom: 'restroom', shop: 'shop', show: 'show', service: 'service' };

/**
 * Build the bake model for one venue.
 *
 * @param {object} map map.json body
 * @param {object[]} pois pois.json
 * @param {{ maxCols?: number }} opts grid budget (default 240 cells across)
 */
export function bakeModel(map, pois = [], opts = {}) {
  const { cols, rows, tileMetres, toCell } = projector(map, opts.maxCols || 240);
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
  for (const [layer, terrain] of AREA_TERRAIN) {
    for (const way of map[layer] || []) {
      if (!Array.isArray(way.r) || way.r.length < 3) continue;
      const painted = paintPolygon(cells, cols, rows, way.r.map(toCell), terrain);
      if (terrain === TERRAIN.wood) treeCells.wood.push(...painted);
      if (terrain === TERRAIN.grass) treeCells.grass.push(...painted);
    }
  }

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

  // Trees: dense canopy in woods, scattered on grass — hash-jittered, never random.
  const trees = [];
  for (const [x, y] of treeCells.wood) {
    if (cells[y * cols + x] !== TERRAIN.wood || isOccupied(x, y)) continue;
    if (cellHash(x, y) < 0.65) trees.push({ x: x + cellHash(x, y, 1), y: y + cellHash(x, y, 2), big: cellHash(x, y, 3) > 0.4 });
  }
  for (const [x, y] of treeCells.grass) {
    if (cells[y * cols + x] !== TERRAIN.grass || isOccupied(x, y)) continue;
    if (cellHash(x, y) < 0.14) trees.push({ x: x + cellHash(x, y, 1), y: y + cellHash(x, y, 2), big: cellHash(x, y, 3) > 0.8 });
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

  return cropModel({
    version: 1,
    venue: map.meta?.id,
    cols,
    rows,
    tileMetres: Math.round(tileMetres * 100) / 100,
    terrains: TERRAIN_NAMES,
    cells,
    roads,
    trees,
    buildings,
    tracks,
    badges,
  }, boundaryRing, opts.margin ?? 6);
}

/**
 * Crop to the venue: the map fills the frame instead of floating in its
 * padded bounds. The window is the boundary ring's box plus a margin
 * (falling back to non-outside content when a venue has no boundary).
 */
function cropModel(model, boundaryRing, margin) {
  const { cols, rows, cells } = model;
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
  if (maxX < 0) return model;
  // Boundary ring coords are floats — floor/ceil before the margin so the
  // window (and every array size derived from it) stays integral.
  const x0 = Math.max(0, Math.floor(minX) - margin); const y0 = Math.max(0, Math.floor(minY) - margin);
  const x1 = Math.min(cols - 1, Math.ceil(maxX) + margin); const y1 = Math.min(rows - 1, Math.ceil(maxY) + margin);
  const newCols = x1 - x0 + 1; const newRows = y1 - y0 + 1;
  const newCells = new Array(newCols * newRows);
  for (let y = 0; y < newRows; y += 1) {
    for (let x = 0; x < newCols; x += 1) {
      newCells[y * newCols + x] = cells[(y + y0) * cols + (x + x0)];
    }
  }
  const shiftPt = ([x, y]) => [x - x0, y - y0];
  return {
    ...model,
    cols: newCols,
    rows: newRows,
    cells: newCells,
    roads: model.roads.map((r) => ({ ...r, pts: r.pts.map(shiftPt) })),
    trees: model.trees.map((t) => ({ ...t, x: t.x - x0, y: t.y - y0 })),
    buildings: model.buildings.map((b) => ({ ...b, ring: b.ring.map(shiftPt) })),
    tracks: model.tracks.map((t) => ({ ...t, pts: t.pts.map(shiftPt) })),
    badges: model.badges.map((b) => ({ ...b, x: b.x - x0, y: b.y - y0 })),
  };
}
