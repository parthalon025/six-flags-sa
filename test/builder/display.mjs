#!/usr/bin/env node
/**
 * Display factory — skin templates, material ledger, visual spec, and the
 * display-certify gate. Skins restyle, never reposition: the spec carries
 * no coordinates, and certification proves it.
 *
 *   node test/builder/display.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PASS = [];
const FAIL = [];

async function check(name, fn) {
  try {
    const r = await fn();
    if (r === false) throw new Error('assertion false');
    PASS.push(name);
    console.log('  PASS', name);
  } catch (e) {
    FAIL.push(`${name} :: ${e.message.split('\n')[0]}`);
    console.log('  FAIL', name, '->', e.message.split('\n')[0]);
  }
}

console.log('\ndisplay factory\n');

const {
  SURFACE_CLASSES,
  ALLOWED_LICENSES,
  LAND_COVER_STYLE,
  readSkinTemplates,
  readMaterials,
  compileVisualSpec,
  certifyDisplayPack,
  styleFromSpec,
  anchorsFromTruth,
  runDisplayStage,
  foldBakeCerts,
  tierManifest,
  pyramidGatePasses,
} = await import('../../packages/venue-builder/lib/display-pack.mjs');
const { displayGeoJson, buildTiles, tippecanoeAvailable } = await import(
  '../../packages/venue-builder/lib/display-tiles.mjs'
);
const { LAYERS } = await import('../../packages/venue-builder/lib/osm-tags.mjs');
const { STAGES, parseCatalogArgs, pipelineOptsFromCatalogArgs } = await import(
  '../../packages/venue-builder/lib/build-pipeline.mjs'
);

/* ------------------------------------------------------ display ontology -- */

await check('every surface class maps only to real map layers', () => {
  const layerSet = new Set(LAYERS);
  for (const [key, row] of Object.entries(SURFACE_CLASSES)) {
    assert.match(key, /^[a-z][a-z-]*$/, `surface class key "${key}" is not a slug`);
    assert.ok(row.layers.length, `${key} maps no layers`);
    for (const layer of row.layers) {
      assert.ok(layerSet.has(layer), `${key} references unknown layer "${layer}"`);
    }
  }
  return true;
});

await check('no map layer is claimed by two surface classes', () => {
  const seen = new Map();
  for (const [key, row] of Object.entries(SURFACE_CLASSES)) {
    for (const layer of row.layers) {
      assert.ok(!seen.has(layer), `layer "${layer}" claimed by ${seen.get(layer)} and ${key}`);
      seen.set(layer, key);
    }
  }
  return true;
});

/* -------------------------------------------------- land-cover materials -- */

await check('every WorldCover class binds a real ledger material', () => {
  const materials = readMaterials();
  assert.ok(Object.keys(LAND_COVER_STYLE).length >= 4, 'expected built-up/tree-cover/water/grassland at least');
  for (const [cls, row] of Object.entries(LAND_COVER_STYLE)) {
    assert.match(cls, /^[a-z][a-z_]*$/, `class key "${cls}" is not a WorldCover class name`);
    assert.ok(materials[row.material], `${cls} binds unknown material "${row.material}"`);
    assert.ok(row.tone.day && row.tone.night, `${cls} is missing a day/night tone`);
  }
  return true;
});

/* --------------------------------------------------------------- ledgers -- */

await check('material ledger rows carry provenance and an allowed license', () => {
  const materials = readMaterials();
  assert.ok(Object.keys(materials).length >= 3, 'ledger is empty');
  for (const [id, m] of Object.entries(materials)) {
    assert.match(id, /^[a-z][a-z0-9-]*--[a-z0-9-]+$/, `material id "${id}" is not <family>--<variant>`);
    assert.ok(ALLOWED_LICENSES.includes(m.license), `${id} license "${m.license}" not allowed`);
    assert.ok(m.source, `${id} has no source`);
    assert.ok(Array.isArray(m.maps) && m.maps.includes('basecolor'), `${id} lacks a basecolor map`);
    assert.ok(m.resolution <= 1024, `${id} resolution ${m.resolution} over the phone budget`);
  }
  return true;
});

await check('every skin template binding resolves to a ledger material', () => {
  const skins = readSkinTemplates();
  const materials = readMaterials();
  assert.ok(skins['park-midnight'], 'always-on palette park-midnight missing');
  assert.ok(skins.trail, 'always-on palette trail missing');
  for (const [id, skin] of Object.entries(skins)) {
    for (const [surface, materialId] of Object.entries(skin.surfaces)) {
      assert.ok(SURFACE_CLASSES[surface], `${id} binds unknown surface "${surface}"`);
      assert.ok(materials[materialId], `${id}.${surface} binds unknown material "${materialId}"`);
    }
  }
  return true;
});

/* ------------------------------------------------- compile, no positions -- */

const FIXTURE_MAP = {
  meta: {
    id: 'test-park',
    name: 'Test Park',
    generated: '2026-08-01',
    lands: { day: { Midway: '#f2e8d0' }, night: { Midway: '#1a2233' } },
  },
  lands: [{ n: 'Midway', r: [[0, 0], [1, 0], [1, 1]] }],
  path: [{ r: [[0, 0], [1, 1]] }],
  water: [{ r: [[2, 2], [3, 3], [2, 3]] }],
  building: [],
  landAnchors: { Midway: [0.5, 0.5] },
};
const FIXTURE_POIS = [
  { i: 'front-gate', n: 'Front Gate', c: 'gate', lat: 1, lng: 2 },
  { i: 'orion', n: 'Orion', c: 'coaster', lat: 0.4, lng: 0.6 },
];

function compiled(skinId = 'trail') {
  const skins = readSkinTemplates();
  return compileVisualSpec({
    map: FIXTURE_MAP,
    pois: FIXTURE_POIS,
    template: skins[skinId],
    materials: readMaterials(),
  });
}

await check('compiled spec binds only surfaces the venue actually has', () => {
  const spec = compiled();
  assert.ok(spec.surfaces.walkway, 'venue has paths but no walkway binding');
  assert.ok(spec.surfaces.water, 'venue has water but no water binding');
  assert.ok(!spec.surfaces.structure, 'no buildings, yet structure is bound');
  return true;
});

await check('compiled spec preserves hand land tints and invents none', () => {
  const spec = compiled();
  assert.equal(spec.landTones.Midway.day, '#f2e8d0');
  assert.equal(spec.landTones.Midway.night, '#1a2233');
  assert.equal(Object.keys(spec.landTones).length, 1);
  return true;
});

await check('compiled spec carries no coordinates and no build date', () => {
  const text = JSON.stringify(compiled());
  assert.ok(!/"lat"|"lng"|"r":/.test(text), 'a coordinate leaked into the spec');
  assert.equal(compiled().basedOn.map, '2026-08-01', 'basedOn must come from truth, not the clock');
  return true;
});

await check('compiling twice is byte-identical (deterministic)', () => {
  assert.equal(JSON.stringify(compiled()), JSON.stringify(compiled()));
  return true;
});

/* -------------------------------------------- WorldCover land-cover tones -- */

const FIXTURE_MAP_TWO_LANDS = {
  ...FIXTURE_MAP,
  meta: { ...FIXTURE_MAP.meta, lands: { day: {}, night: {} } }, // no hand tints
  lands: [
    { n: 'Midway', r: [[0, 0], [1, 0], [1, 1]] },
    { n: 'Backwoods', r: [[2, 2], [3, 2], [3, 3]] },
  ],
};

function compiledWithCover(landCover) {
  const skins = readSkinTemplates();
  return compileVisualSpec({
    map: FIXTURE_MAP_TWO_LANDS,
    pois: FIXTURE_POIS,
    template: skins.trail,
    materials: readMaterials(),
    landCover,
  });
}

await check('WorldCover classification picks a land tone when there is no hand tint', () => {
  const spec = compiledWithCover({
    Midway: { code: 50, name: 'built_up' },
    Backwoods: { code: 10, name: 'tree_cover' },
  });
  assert.equal(spec.landTones.Midway.day, LAND_COVER_STYLE.built_up.tone.day);
  assert.equal(spec.landTones.Backwoods.night, LAND_COVER_STYLE.tree_cover.tone.night);
  return true;
});

await check('an unmapped WorldCover class invents no tone — falls to name-hue', () => {
  const spec = compiledWithCover({ Midway: { code: 70, name: 'snow_ice' } });
  assert.equal(spec.landTones.Midway, undefined);
  return true;
});

await check('a hand tint always wins over an inferred WorldCover tone', () => {
  const skins = readSkinTemplates();
  const handTinted = {
    ...FIXTURE_MAP_TWO_LANDS,
    meta: { ...FIXTURE_MAP_TWO_LANDS.meta, lands: { day: { Midway: '#f2e8d0' }, night: { Midway: '#1a2233' } } },
  };
  const spec = compileVisualSpec({
    map: handTinted,
    pois: FIXTURE_POIS,
    template: skins.trail,
    materials: readMaterials(),
    landCover: { Midway: { code: 50, name: 'built_up' } },
  });
  assert.equal(spec.landTones.Midway.day, '#f2e8d0', 'the curated hand tint must not be overwritten');
  return true;
});

await check('omitting landCover behaves exactly as before (no WorldCover data)', () => {
  const spec = compiledWithCover(undefined);
  assert.equal(Object.keys(spec.landTones).length, 0);
  return true;
});

/* --------------------------------------------------------------- certify -- */

function certified(mutate = (s) => s) {
  const skins = readSkinTemplates();
  const materials = readMaterials();
  const spec = mutate(compiled());
  return certifyDisplayPack({
    spec,
    map: FIXTURE_MAP,
    template: skins.trail,
    materials,
  });
}

await check('a clean pack certifies green with claim/evidence rows', () => {
  const cert = certified();
  assert.equal(cert.certified, true);
  for (const row of cert.checks) {
    assert.ok(row.claim && row.falsifier && row.soWhat, `${row.key} lacks the reasoning contract`);
  }
  return true;
});

await check('a coordinate smuggled into the spec fails certification', () => {
  const cert = certified((spec) => ({ ...spec, hero: { lat: 39.1, lng: -84.5 } }));
  assert.equal(cert.certified, false);
  assert.ok(cert.checks.find((c) => c.key === 'no_repositioning' && !c.pass));
  return true;
});

await check('an unknown material fails certification', () => {
  const cert = certified((spec) => ({
    ...spec,
    surfaces: { ...spec.surfaces, walkway: { ...spec.surfaces.walkway, material: 'lava--fake' } },
  }));
  assert.equal(cert.certified, false);
  assert.ok(cert.checks.find((c) => c.key === 'bindings_resolve' && !c.pass));
  return true;
});

await check('a disallowed license fails the license gate', () => {
  const skins = readSkinTemplates();
  const materials = readMaterials();
  const spec = compiled();
  const bound = Object.values(spec.surfaces)[0].material;
  const tainted = { ...materials, [bound]: { ...materials[bound], license: 'AGPL-3.0' } };
  const cert = certifyDisplayPack({ spec, map: FIXTURE_MAP, template: skins.trail, materials: tainted });
  assert.equal(cert.certified, false);
  assert.ok(cert.checks.find((c) => c.key === 'license_gate' && !c.pass));
  return true;
});

await check('a land tone naming a land the venue does not have fails', () => {
  const cert = certified((spec) => ({
    ...spec,
    landTones: { ...spec.landTones, Atlantis: { day: '#fff', night: '#000' } },
  }));
  assert.equal(cert.certified, false);
  assert.ok(cert.checks.find((c) => c.key === 'references_resolve' && !c.pass));
  return true;
});

/* ----------------------------------------------------- style + geometry -- */

await check('styleFromSpec paints from tokens and carries no coordinates', () => {
  const style = styleFromSpec(compiled());
  assert.equal(style.version, 8);
  assert.equal(style.layers[0].type, 'background');
  assert.equal(style.layers[0].paint['background-color'], '#F5F0E8');
  const lands = style.layers.find((l) => l.id === 'lands');
  assert.ok(JSON.stringify(lands.paint['fill-color']).includes('#f2e8d0'), 'day land tint missing');
  assert.ok(!/"lat"|"lng"|"center"|"bounds"/.test(JSON.stringify(style)), 'style carries a position');
  return true;
});

await check('park-midnight style picks the night side of land tones', () => {
  const style = styleFromSpec(compiled('park-midnight'));
  const lands = style.layers.find((l) => l.id === 'lands');
  assert.ok(JSON.stringify(lands.paint['fill-color']).includes('#1a2233'));
  return true;
});

await check('displayGeoJson splits area rings from open lines', () => {
  const layers = displayGeoJson(FIXTURE_MAP, FIXTURE_POIS);
  assert.equal(layers.path.features[0].geometry.type, 'LineString');
  assert.equal(layers.water.features[0].geometry.type, 'Polygon');
  const ring = layers.water.features[0].geometry.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1], 'polygon ring not closed');
  assert.equal(layers.lands.features[0].properties.name, 'Midway');
  assert.equal(layers.places.features.length, 2);
  assert.equal(layers.places.features[0].properties.key, 'front-gate');
  return true;
});

await check('anchorsFromTruth is deterministic: gates, lands, coasters', () => {
  const anchors = anchorsFromTruth(FIXTURE_MAP, FIXTURE_POIS);
  assert.deepEqual(anchors.map((a) => a.id), ['gate:front-gate', 'land:Midway', 'coaster:orion']);
  assert.deepEqual(anchors, anchorsFromTruth(FIXTURE_MAP, FIXTURE_POIS));
  return true;
});

await check('buildTiles produces base.pmtiles, or records the gap honestly', () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'tiles-'));
  const result = buildTiles({ id: 'test-park', map: FIXTURE_MAP, pois: FIXTURE_POIS, outDir });
  if (tippecanoeAvailable()) {
    assert.equal(result.ok, true, result.reason);
    assert.ok(result.sizeKb >= 1, 'archive is empty');
    assert.ok(readFileSync(result.file).subarray(0, 2).toString() !== '', 'unreadable archive');
  } else {
    assert.equal(result.ok, false);
    assert.match(result.reason, /tippecanoe/);
  }
  assert.ok(result.files.length >= 3, 'geojson export missing');
  return true;
});

/* ------------------------------------------------------- the bake pieces -- */

const {
  bakeModel, declutterBadges, resolveKit, TERRAIN_PIECES, TEXTURE_KINDS, impliedTerrainClasses,
  POI_BADGES,
} = await import(
  '../../packages/venue-builder/lib/display-bake.mjs'
);

await check('a kit composes pieces onto defaults; unknown pieces fail loudly', () => {
  const kit = resolveKit({ id: 'night', terrain: { water: { base: '#123' } } });
  assert.equal(kit.terrain.water.base, '#123');
  assert.equal(kit.terrain.water.texture.kind, 'wave', 'omitted texture must keep its default');
  assert.equal(kit.terrain.grass.base, TERRAIN_PIECES.grass.base);
  assert.throws(() => resolveKit({ terrain: { lava: {} } }), /Unknown terrain piece/);
  assert.throws(() => resolveKit({ terrain: { water: { texture: { kind: 'sparkle' } } } }), /Unknown texture kind/);
  assert.throws(() => resolveKit({ sprites: { dragon: {} } }), /Unknown sprite piece/);
  assert.ok(TEXTURE_KINDS.includes('none') && TEXTURE_KINDS.includes('hatch'));
  // Structural design switches — different drawing, not different color.
  const survey = resolveKit({
    id: 'survey',
    sprites: { building: { style: 'outline' }, tree: { style: 'none' }, coaster: { style: 'mono' } },
  });
  assert.equal(survey.sprites.building.style, 'outline');
  assert.throws(() => resolveKit({ sprites: { building: { style: 'hologram' } } }), /Unknown building style/);
  assert.throws(() => resolveKit({ sprites: { tree: { style: 'cubist' } } }), /Unknown tree style/);
  assert.throws(() => resolveKit({ sprites: { slide: { style: 'ribbon' } } }), /Unknown slide style/);
  return true;
});

const BAKE_MAP = {
  meta: { id: 'test-park', bounds: { n: 0.01, s: 0, e: 0.01, w: 0 } },
  boundary: [[0.001, 0.001], [0.009, 0.001], [0.009, 0.009], [0.001, 0.009]],
  water: [{ r: [[0.002, 0.002], [0.004, 0.002], [0.004, 0.004], [0.002, 0.004]] }],
  wood: [{ r: [[0.006, 0.006], [0.008, 0.006], [0.008, 0.008], [0.006, 0.008]] }],
  path: [{ r: [[0.001, 0.005], [0.009, 0.005]] }],
  building: [{ r: [[0.005, 0.002], [0.006, 0.002], [0.006, 0.003]] }],
  slide: [{ r: [[0.002, 0.006], [0.003, 0.007]] }, { r: [[0.003, 0.006], [0.004, 0.007]] }],
};

// A polygon big enough to matter cannot be spread into push(). The engine caps
// `a.push(...b)` at ~125k arguments; today's whole grid is 47,520 cells at
// maxCols 240, so no single polygon can reach it and the bug cannot fire. The
// close band of ADR-0021 clause 2 needs maxCols 646 at kings-island — 344,964
// cells — where one large meadow overruns the cap and bakeModel dies with
// "Maximum call stack size exceeded" before a pixel is drawn.
await check('a meadow larger than the argument cap does not blow the stack', () => {
  const SPREAD_CAP = 125_274;
  const big = {
    // ~2.2 km on a side, so span/646 clears the projector's 2 m cell floor
    // and the grid really is 646 columns — the close band's own shape.
    meta: { id: 'big-park', bounds: { n: 0.02, s: 0, e: 0.02, w: 0 } },
    boundary: [[0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02]],
    // One meadow covering the whole park: cells painted === cols * rows.
    grass: [{ r: [[0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02]] }],
  };
  const maxCols = 646;
  const model = bakeModel(big, [], { maxCols });
  assert.ok(
    model.cols * model.rows > SPREAD_CAP,
    `fixture must exceed the ${SPREAD_CAP} argument cap to prove anything, got ${model.cols * model.rows}`,
  );
  assert.equal(model.cols, maxCols);
  return true;
});

await check('the bake model is truth-locked and deterministic', () => {
  const a = bakeModel(BAKE_MAP, FIXTURE_POIS, { maxCols: 60 });
  const b = bakeModel(BAKE_MAP, FIXTURE_POIS, { maxCols: 60 });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const name = (t) => a.terrains[t];
  const cellAt = (fx, fy) => a.cells[Math.floor(fy * a.rows) * a.cols + Math.floor(fx * a.cols)];
  assert.equal(name(cellAt(0.3, 0.7)), 'water', 'water ring must classify as water');
  assert.equal(name(cellAt(0.5, 0.5)), 'road', 'the path line must paint road cells');
  assert.equal(name(cellAt(0.02, 0.02)), 'outside', 'beyond the boundary is outside');
  assert.ok(a.trees.length > 0, 'woods must grow trees');
  assert.ok(a.trees.every((t) => Number.isFinite(t.x) && t.x <= a.cols && t.y <= a.rows));
  assert.deepEqual(a.tracks.filter((t) => t.kind === 'slide').map((t) => t.idx), [0, 1],
    'slides carry indices; color belongs to the kit piece');
  return true;
});

// Issue #518: a peninsula venue's map.water/map.sea is Lake Erie clipped to
// the MAP BBOX, not to the venue boundary — the water polygon can span the
// entire bbox even though the venue boundary is a much smaller box inside
// it. Water painted last, unclipped, used to paint over that land. This
// fixture reproduces the exact shape: a sea polygon spanning the whole bbox,
// and a grass strip straddling the boundary's left edge, half outside it.
const BOUNDARY_LEAK_MAP = {
  meta: { id: 'peninsula-park', bounds: { n: 0.01, s: 0, e: 0.01, w: 0 } },
  boundary: [[0.001, 0.001], [0.009, 0.001], [0.009, 0.009], [0.001, 0.009]],
  grass: [{ r: [[0, 0.004], [0.002, 0.004], [0.002, 0.006], [0, 0.006]] }],
  sea: [{ r: [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]] }],
};

await check('water/sea/pool paint only inside the venue boundary — the lake no longer erases the park', () => {
  const m = bakeModel(BOUNDARY_LEAK_MAP, [], { maxCols: 60 });
  const name = (t) => m.terrains[t];
  const cellAt = (fx, fy) => m.cells[Math.floor(fy * m.rows) * m.cols + Math.floor(fx * m.cols)];
  // Grass outside the boundary (but inside the bbox-spanning sea polygon):
  // before the fix this painted as water, erasing land the venue never
  // claimed the sea covers.
  assert.equal(name(cellAt(0.02, 0.5)), 'grass', 'land outside the boundary must survive a bbox-spanning sea polygon');
  // Beyond the boundary and outside any land layer: before the fix this
  // painted as water too (the sea polygon reached every corner of the grid).
  assert.equal(name(cellAt(0.98, 0.5)), 'outside', 'beyond the boundary with no land layer stays outside, not lake');
  // A real lake genuinely inside the venue boundary still reads as water —
  // clipping to the boundary is not the same as withholding the lake.
  assert.equal(name(cellAt(0.5, 0.5)), 'water', 'water genuinely inside the boundary must still render as water');
  return true;
});

await check('impliedTerrainClasses names every class the venue truth implies, using the paint-order vocabulary', () => {
  const implied = impliedTerrainClasses(BAKE_MAP);
  // BAKE_MAP carries water, wood, path (-> road) — no park/grass/parking/service.
  assert.deepEqual([...implied].sort(), ['road', 'water', 'wood']);
  assert.ok(impliedTerrainClasses({}).size === 0, 'a venue with no area/line truth implies no terrain class');
  const full = impliedTerrainClasses({
    park: [{ r: [[0, 0], [1, 0], [1, 1]] }],
    grass: [{ r: [[0, 0], [1, 0], [1, 1]] }],
    wood: [{ r: [[0, 0], [1, 0], [1, 1]] }],
    parking: [{ r: [[0, 0], [1, 0], [1, 1]] }],
    sea: [{ r: [[0, 0], [1, 0], [1, 1]] }],
    water: [{ r: [[0, 0], [1, 0], [1, 1]] }],
    pool: [{ r: [[0, 0], [1, 0], [1, 1]] }],
    service: [{ r: [[0, 0], [1, 1]] }],
    path: [{ r: [[0, 0], [1, 1]] }],
  });
  assert.deepEqual([...full].sort(), ['grass', 'lot', 'road', 'service', 'water', 'wood']);
  // A way with too few vertices to paint (a degenerate ring, a single-point
  // line) implies nothing — matches bakeModel's own paintability guard.
  assert.equal(impliedTerrainClasses({ grass: [{ r: [[0, 0], [1, 1]] }] }).size, 0);
  return true;
});

await check('Cedar Point regression (issue #518): the bake is not all water/road/service', async () => {
  const { readFileSync: readFile } = await import('node:fs');
  const mapFile = new URL('../../apps/party-tracker/public/venues/cedar-point.map.json', import.meta.url);
  const map = JSON.parse(readFile(mapFile, 'utf8'));
  const model = bakeModel(map, []);
  const hist = {};
  for (const c of model.cells) hist[model.terrains[c]] = (hist[model.terrains[c]] || 0) + 1;
  const total = model.cells.length;
  // The bug's exact symptom: every cell classified as one of water/road/
  // service, with grass/wood/lot/ground/outside entirely absent.
  const landClasses = ['grass', 'wood', 'lot', 'ground', 'outside'];
  assert.ok(landClasses.some((cls) => hist[cls] > 0), `bake still has no land classes: ${JSON.stringify(hist)}`);
  // Water must still be a small share of the grid, not the whole park —
  // the boundary wins over a lake that merely intersects the venue bbox.
  assert.ok((hist.water || 0) < total * 0.5, `water still dominates the bake: ${JSON.stringify(hist)}`);
  // Every class the venue's own truth implies must survive the composite.
  const implied = impliedTerrainClasses(map);
  const missing = [...implied].filter((cls) => !hist[cls]);
  assert.deepEqual(missing, [], `truth implies ${[...implied].join(', ')} but the bake is missing: ${missing.join(', ')}`);
  return true;
});

await check('dual-grid masks: one cell yields its four corner vertices', async () => {
  const { dualGridIndices } = await import('../../packages/venue-builder/lib/display-autotile.mjs');
  const masks = dualGridIndices([7], 1, 1, 7);
  // vertices row-major on the (cols+1)x(rows+1) offset grid
  assert.deepEqual(Array.from(masks), [8, 4, 2, 1]);
  const none = dualGridIndices([7], 1, 1, 3);
  assert.deepEqual(Array.from(none), [0, 0, 0, 0]);
  const same = dualGridIndices([7], 1, 1, 7);
  assert.deepEqual(Array.from(masks), Array.from(same), 'deterministic');
  return true;
});

await check('kit tile refs resolve against the ledger or fail loudly', async () => {
  const { readAssetLedger } = await import('../../packages/venue-builder/lib/display-assets.mjs');
  const assets = readAssetLedger();
  const good = resolveKit({
    id: 'tiled',
    terrain: { grass: { tiles: { asset: 'kenney-roguelike-sheet', tile: 'grass' } } },
  }, { assets });
  assert.equal(good.terrain.grass.tiles.tile, 'grass');
  assert.throws(() => resolveKit({ terrain: { grass: { tiles: { asset: 'nope', tile: 'grass' } } } }, { assets }), /unknown asset/);
  assert.throws(() => resolveKit({ terrain: { grass: { tiles: { asset: 'kenney-roguelike-sheet', tile: 'lava' } } } }, { assets }), /unknown tile/);
  assert.throws(() => resolveKit({ terrain: { grass: { tiles: { asset: 'kenney-roguelike-sheet', tile: 'grass' } } } }), /needs the asset ledger/);
  return true;
});

await check('a venue design theme overlays a kit; custom sprite refs are gated', async () => {
  const { readAssetLedger } = await import('../../packages/venue-builder/lib/display-assets.mjs');
  const assets = readAssetLedger();
  const overlay = {
    sprites: { tree: { sprite: { asset: 'parkbound-palm-tree' }, scale: 1.35 } },
    terrain: { water: { base: '#00CED1' } },
  };
  const themed = resolveKit({ id: 'base', terrain: { water: { base: '#111111' } } }, { assets, overlay });
  assert.equal(themed.sprites.tree.sprite.asset, 'parkbound-palm-tree', 'overlay adds the custom sprite');
  assert.equal(themed.terrain.water.base, '#00CED1', 'overlay wins over the kit');
  assert.equal(themed.terrain.water.texture.kind, 'wave', 'defaults still fill the rest');
  assert.throws(() => resolveKit({}, { assets, overlay: { sprites: { tree: { sprite: { asset: 'ghost' } } } } }), /unknown asset/);
  assert.throws(
    () => resolveKit({}, { assets, overlay: { sprites: { tree: { sprite: { asset: 'kenney-roguelike-sheet' } } } } }),
    /not a sprite/,
  );
  return true;
});

await check('every Skin bakeKit binding names a kit on disk', async () => {
  const { readSkinTemplates } = await import('../../packages/venue-builder/lib/display-pack.mjs');
  const { existsSync } = await import('node:fs');
  const bound = Object.entries(readSkinTemplates()).filter(([, s]) => s.bakeKit);
  assert.ok(bound.length >= 2, 'expected Skin→kit bindings');
  for (const [id, skin] of bound) {
    assert.ok(
      existsSync(new URL(`../../packages/venue-builder/data/display/kits/${skin.bakeKit}.json`, import.meta.url)),
      `Skin "${id}" binds missing kit "${skin.bakeKit}"`,
    );
  }
  return true;
});

await check('the grid is the planned extent, whatever the boundary encloses', () => {
  // A boundary covering a fifth of the bbox. It used to shrink the picture to
  // its own box plus a margin; it now decides only which cells are inside the
  // venue, never how big the picture is.
  const tight = {
    ...BAKE_MAP,
    boundary: [[0.004, 0.004], [0.006, 0.004], [0.006, 0.006], [0.004, 0.006]],
  };
  const boundless = bakeModel({ ...tight, boundary: null }, [], { maxCols: 60 });
  const bounded = bakeModel(tight, [], { maxCols: 60 });
  assert.ok(Number.isInteger(bounded.cols) && Number.isInteger(bounded.rows), 'grid dims must be integers');
  assert.equal(bounded.cells.length, bounded.cols * bounded.rows, 'cells must fill the grid exactly');
  assert.equal(bounded.cols, boundless.cols, 'the boundary must not narrow the picture');
  assert.equal(bounded.rows, boundless.rows, 'nor shorten it');
  // The boundary still does its real job: it is what makes cells "outside".
  const outside = Number(Object.keys(bounded.terrains).find((v) => bounded.terrains[v] === 'outside'));
  assert.ok(bounded.cells.some((c) => c === outside), 'ground beyond the boundary reads as outside');
  assert.ok(!boundless.cells.some((c) => c === outside), 'and a venue with no boundary has none');
  assert.equal(JSON.stringify(bounded), JSON.stringify(bakeModel(tight, [], { maxCols: 60 })));
  return true;
});

/* A boundary tucked into one corner of BAKE_MAP's bbox — small enough that a
 * trim would bite, and clear of every bbox edge so a trimmed origin moves in
 * both axes rather than clamping to zero. Cells x 18..30, y 12..24 on the
 * 60x60 grid below. */
const CORNER_BOUNDED = {
  ...BAKE_MAP,
  boundary: [[0.003, 0.006], [0.005, 0.006], [0.005, 0.008], [0.003, 0.008]],
};

await check('the bake model is georeferenced against its whole grid', () => {
  const boundless = bakeModel({ ...BAKE_MAP, boundary: null }, [], { maxCols: 60 });
  const bounded = bakeModel(CORNER_BOUNDED, [], { maxCols: 60 });
  for (const m of [boundless, bounded]) {
    assert.ok(m.bounds, 'bounds ride every model');
    assert.ok(m.bounds.west < m.bounds.east && m.bounds.south < m.bounds.north, 'WSEN ordering');
    // BAKE_MAP's bbox NW corner, straight off the fixture: the grid starts
    // where truth's own rectangle starts, wherever the boundary happens to sit.
    assert.equal(m.bounds.west, 0, 'the grid starts at the bbox west edge');
    assert.equal(m.bounds.north, 0.01, 'and at its north edge');
  }
  assert.deepEqual(bounded.bounds, boundless.bounds,
    'the boundary changes what is painted, never where the picture sits');
  assert.deepEqual(bounded.bounds, bakeModel(CORNER_BOUNDED, [], { maxCols: 60 }).bounds, 'deterministic');
  return true;
});

await check('bake certifications fold into the pack, namespaced and gated', () => {
  const certA = { certified: true, checks: [{ key: 'style_terrain_palette', pass: true, evidence: 'x' }] };
  const certB = { certified: false, checks: [{ key: 'style_track_presence', pass: false, evidence: 'y' }] };
  const rows = foldBakeCerts([{ kit: 'a', cert: certA }, { kit: 'b', cert: certB }]);
  assert.ok(rows.some((r) => r.key === 'bake:a:style_terrain_palette' && r.pass));
  assert.ok(rows.some((r) => r.key === 'bake:b:style_track_presence' && !r.pass));
  const gate = rows.find((r) => r.key === 'bake_certs');
  assert.equal(gate.pass, false, 'one failing kit fails the gate');
  assert.match(gate.evidence, /b:FAILING/);
  const empty = foldBakeCerts([]).find((r) => r.key === 'bake_certs');
  assert.equal(empty.pass, false, 'no bakes is a recorded gap, not a silent pass');
  assert.match(empty.evidence, /run venues:bake/);
  return true;
});

await check('the tier manifest names every tier, sizes or gaps', () => {
  const manifest = tierManifest([
    { name: 'vector', file: 'base.pmtiles', bytes: 12345 },
    { name: 'raster', gap: true, reason: 'no tiler' },
    { name: 'bake:island-brochure', file: 'x.png', bytes: 99, meta: { kit: 'island-brochure' } },
  ]);
  assert.equal(manifest.tiers.vector.bytes, 12345);
  assert.deepEqual(manifest.tiers.raster, { gap: true, reason: 'no tiler' });
  assert.equal(manifest.tiers['bake:island-brochure'].kit, 'island-brochure');
  return true;
});

await check('the LDtk debug export mirrors the model exactly', async () => {
  const { ldtkProject } = await import('../../packages/venue-builder/lib/display-ldtk.mjs');
  const model = bakeModel(BAKE_MAP, FIXTURE_POIS, { maxCols: 60 });
  const project = ldtkProject(model);
  const level = project.levels[0];
  const terrain = level.layerInstances.find((l) => l.__identifier === 'Terrain');
  assert.equal(terrain.__cWid, model.cols);
  assert.equal(terrain.intGridCsv.length, model.cols * model.rows, 'every cell exported');
  assert.ok(terrain.intGridCsv.every((v) => v >= 1), 'IntGrid values are 1-based');
  assert.equal(new Set(terrain.intGridCsv).size <= 8, true, 'only real terrain classes');
  const entities = level.layerInstances.find((l) => l.__identifier === 'Entities').entityInstances;
  const badgeCount = entities.filter((e) => e.__identifier === 'Badge').length;
  assert.equal(badgeCount, model.badges.length, 'one entity per badge');
  const trackVertices = entities.filter((e) => e.__identifier === 'TrackVertex');
  assert.equal(trackVertices.length, model.tracks.reduce((n, t) => n + t.pts.length, 0));
  assert.equal(JSON.stringify(project), JSON.stringify(ldtkProject(model)), 'byte-identical rerun');
  JSON.parse(JSON.stringify(project)); // round-trips as plain JSON
  return true;
});

await check('everything truth places inside the bbox stays in the model', () => {
  // The mirror of the case above. Cutting the picture to the boundary also cut
  // the content: a footprint or a pin beyond the ring left the model entirely,
  // and the plan still claimed the whole bbox. Both now survive, at the cell
  // the projector puts them in.
  const withOutsider = {
    ...BAKE_MAP,
    boundary: [[0.004, 0.004], [0.009, 0.004], [0.009, 0.009], [0.004, 0.009]],
    building: [
      { r: [[0.005, 0.005], [0.006, 0.005], [0.006, 0.006]] }, // inside the ring
      { r: [[0.0005, 0.0005], [0.001, 0.0005], [0.001, 0.001]] }, // a neighboring business
    ],
  };
  const outsidePoi = { i: 'far-gate', n: 'Far Gate', c: 'gate', lat: 0.0005, lng: 0.0005 };
  const insidePoi = { i: 'near-food', n: 'Near Food', c: 'food', lat: 0.006, lng: 0.006 };
  const model = bakeModel(withOutsider, [outsidePoi, insidePoi], { maxCols: 60 });
  assert.equal(model.buildings.length, 2, 'both footprints are in the picture the plan describes');
  assert.deepEqual(model.badges.map((b) => b.kind).sort(), ['food', 'gate'], 'and both pins');
  // Positions are the projector's, unshifted: there is no window origin left to
  // subtract. The in-ring footprint's first vertex is lng/lat 0.005 — halfway
  // across a bbox spanning 0..0.01 at 60 cells — so it belongs at column 30. Its
  // row is not 30, and that is the projector being right rather than a fudge: a
  // degree of latitude is 110574 m against longitude's 111320 at the equator,
  // and one square cell is sized off the longer axis, so 30 x 110574/111320.
  const [x, y] = model.buildings[0].ring[0];
  assert.ok(Math.abs(x - 30) < 1e-6, `column 30 expected, got ${x}`);
  assert.ok(Math.abs(y - 29.798958) < 1e-6, `row 29.798958 expected, got ${y}`);
  return true;
});

await check('badge declutter thins clusters, gate pins first', () => {
  const cluster = [
    { kind: 'food', x: 10, y: 10 },
    { kind: 'shop', x: 10.5, y: 10.4 },
    { kind: 'gate', x: 10.8, y: 10.8 }, // listed last, still wins its cluster
    { kind: 'restroom', x: 30, y: 30 }, // far away, untouched
  ];
  const kept = declutterBadges(cluster);
  assert.equal(kept.length, 2, 'the cluster thins to one pin');
  assert.ok(kept.some((b) => b.kind === 'gate'), 'the gate keeps its pin over earlier cluster-mates');
  assert.ok(kept.some((b) => b.kind === 'restroom'), 'isolated pins survive');
  assert.deepEqual(kept, declutterBadges(cluster), 'deterministic');
  return true;
});

await check('parking rows close into one lot, per aerial ground truth', () => {
  const rows = {
    meta: { id: 'lot-park', bounds: { n: 0.01, s: 0, e: 0.01, w: 0 } },
    boundary: null,
    parking: [
      { r: [[0.001, 0.004], [0.0044, 0.004], [0.0044, 0.006], [0.001, 0.006]] },
      { r: [[0.0056, 0.004], [0.009, 0.004], [0.009, 0.006], [0.0056, 0.006]] },
    ],
  };
  const model = bakeModel(rows, [], { maxCols: 50, margin: 0 });
  const name = (t) => model.terrains[t];
  const mid = model.cells[Math.floor(0.5 * model.rows) * model.cols + Math.floor(0.5 * model.cols)];
  assert.equal(name(mid), 'lot', 'the gap between lot rows must close to lot');
  const far = model.cells[Math.floor(0.1 * model.rows) * model.cols + Math.floor(0.5 * model.cols)];
  assert.notEqual(name(far), 'lot', 'closing must not flood beyond the rows');
  return true;
});

await check('buildings grow no trees', () => {
  const wooded = {
    meta: { id: 'wood-park', bounds: { n: 0.01, s: 0, e: 0.01, w: 0 } },
    boundary: null,
    wood: [{ r: [[0.001, 0.001], [0.009, 0.001], [0.009, 0.009], [0.001, 0.009]] }],
    building: [{ r: [[0.003, 0.003], [0.007, 0.003], [0.007, 0.007], [0.003, 0.007]] }],
  };
  const model = bakeModel(wooded, [], { maxCols: 40, margin: 0 });
  assert.ok(model.trees.length > 0, 'the woods must still grow trees');
  const ring = model.buildings[0].ring;
  const xs = ring.map(([x]) => x); const ys = ring.map(([, y]) => y);
  const inside = model.trees.filter((t) =>
    t.x > Math.min(...xs) && t.x < Math.max(...xs) && t.y > Math.min(...ys) && t.y < Math.max(...ys));
  assert.equal(inside.length, 0, `trees inside the building footprint: ${inside.length}`);
  return true;
});

/* ---------------------------------------- ADR-0019 clause 1: per-band content
 * A band is a ground resolution, and the cell grid is the SAME at all three
 * (display-bands.mjs: finer bands draw the same cells larger). So without a
 * generalization pass every band would carry identical content at different
 * sharpness — the "one ultra-res bake, tiled" ADR-0019 rejected. These pin the
 * pass that makes content differ: overview drops the marks 2.4 m/px cannot
 * draw, mid stays exactly today's bake, and nothing a band keeps ever moves. */

// A wood for trees, a lot for aisle marks, POIs of three badge kinds.
const BAND_MAP = {
  meta: { id: 'band-park', bounds: { n: 0.006, s: 0, e: 0.006, w: 0 } },
  boundary: [[0.0005, 0.0005], [0.0055, 0.0005], [0.0055, 0.0055], [0.0005, 0.0055]],
  wood: [{ r: [[0.001, 0.001], [0.003, 0.001], [0.003, 0.003], [0.001, 0.003]] }],
  parking: [{ r: [[0.0035, 0.0035], [0.0053, 0.0035], [0.0053, 0.0053], [0.0035, 0.0053]] }],
  path: [{ r: [[0.001, 0.004], [0.005, 0.004]] }],
  building: [{ r: [[0.0035, 0.001], [0.005, 0.001], [0.005, 0.0025], [0.0035, 0.0025]] }],
  slide: [{ r: [[0.001, 0.0045], [0.002, 0.005]] }],
};
const BAND_POIS = [
  { i: 'gate-n', n: 'North Gate', c: 'gate', lat: 0.0052, lng: 0.001 },
  { i: 'gate-s', n: 'South Gate', c: 'gate', lat: 0.001, lng: 0.005 },
  { i: 'burgers', n: 'Burgers', c: 'food', lat: 0.004, lng: 0.002 },
  { i: 'loo', n: 'Restrooms', c: 'restroom', lat: 0.002, lng: 0.0045 },
];
// One tileMetres for all three bands: the plan derives it from the coarsest
// band, so the grid a band bakes on is band-independent (display-bands.mjs).
const BAND_TILE_METRES = 2.4;
const bandBake = (band) => bakeModel(BAND_MAP, BAND_POIS, { tileMetres: BAND_TILE_METRES, band });

await check('the mid band is today’s bake, unchanged — and no band means no stamp', () => {
  const plain = bakeModel(BAND_MAP, BAND_POIS, { tileMetres: BAND_TILE_METRES });
  assert.ok(!('band' in plain), 'a bake nobody asked a band of must not grow a band stamp');
  assert.ok(!('generalization' in plain), 'nor a generalization stamp');
  const mid = bandBake('mid');
  assert.equal(mid.band, 'mid');
  const { band, generalization, ...content } = mid;
  assert.equal(JSON.stringify(content), JSON.stringify(plain),
    'ADR-0019 clause 1: mid is today’s bake, unchanged');
  assert.equal(generalization.drops.length, 0, 'mid drops nothing');
  assert.equal(generalization.badgeKinds, null, 'mid pins every badge kind');
  return true;
});

await check('the overview band drops the marks 2.4 m/px cannot draw', () => {
  const mid = bandBake('mid');
  const overview = bandBake('overview');
  assert.ok(mid.trees.length > 0 && mid.lotRows.length > 0,
    `fixture must grow trees (${mid.trees.length}) and aisle marks (${mid.lotRows.length}) to prove anything`);
  assert.deepEqual(overview.trees, [], 'a crown under the legibility floor is a stipple, not a tree');
  assert.deepEqual(overview.lotRows, [], 'an aisle dash under the floor is a speck');
  assert.ok(!('scatterNotes' in overview), 'scatter notes describe trees this band does not draw');
  assert.deepEqual(overview.generalization.drops, ['trees', 'lotRows']);
  return true;
});

await check('the overview band pins landmarks only; every other kind stays in truth', () => {
  const mid = bandBake('mid');
  const overview = bandBake('overview');
  const kinds = (m) => [...new Set(m.badges.map((b) => b.kind))].sort();
  assert.deepEqual(kinds(mid), ['food', 'gate', 'restroom'], 'mid pins every kind it has');
  assert.deepEqual(kinds(overview), ['gate'], 'ADR-0019 clause 1: landmarks only');
  assert.deepEqual(overview.generalization.badgeKinds, ['gate']);
  assert.ok(overview.badges.length > 0, 'landmarks-only must thin, not empty');
  return true;
});

await check('generalization removes, never moves (ADR-0021 clause 3)', () => {
  const mid = bandBake('mid');
  const overview = bandBake('overview');
  const close = bandBake('close');
  // Cells and every kept mark are bit-identical across bands: a band may drop
  // a feature, and anything it does draw sits where Truth says it sits.
  assert.equal(JSON.stringify(overview.cells), JSON.stringify(mid.cells), 'terrain never shifts');
  assert.equal(JSON.stringify(close.cells), JSON.stringify(mid.cells));
  for (const kind of ['buildings', 'tracks', 'roads']) {
    assert.equal(JSON.stringify(overview[kind]), JSON.stringify(mid[kind]), `${kind} must not move`);
  }
  const byId = (b) => `${b.kind}@${b.x},${b.y}`;
  const midGates = mid.badges.filter((b) => b.kind === 'gate').map(byId);
  assert.deepEqual(overview.badges.map(byId), midGates, 'kept pins keep their truth positions');
  const { band: cb, generalization: cg, ...closeContent } = close;
  const { band: mb, generalization: mg, ...midContent } = mid;
  assert.equal(JSON.stringify(closeContent), JSON.stringify(midContent),
    'the finest band removes nothing — generalization only ever removes');
  return true;
});

await check('an unknown band is refused at the bake, not silently ignored', () => {
  assert.throws(() => bandBake('gigantic'), /unknown band/i);
  return true;
});

await check('roads are placed by the projector, on the grid the plan asked for', () => {
  // The corner boundary is what makes this a claim: a trim would have moved
  // the grid origin onto it and re-expressed every road point against that.
  const model = bakeModel(CORNER_BOUNDED, [], { maxCols: 60 });
  assert.ok(model.roads.length >= 1, 'path polyline expected');
  for (const road of model.roads) {
    for (const [x, y] of road.pts) {
      assert.ok(x >= 0 && x <= model.cols && y >= 0 && y <= model.rows,
        `road point ${x},${y} must live on the planned grid`);
    }
  }
  // BAKE_MAP's path runs at lat 0.005 — the middle of a bbox 0.01 tall — so on
  // the planned grid it crosses at mid height, corner boundary or not.
  const [, y] = model.roads[0].pts[0];
  assert.ok(Math.abs(y - model.rows / 2) < 1, `the path should cross mid-grid, got row ${y}`);
  return true;
});

/* ------------------------------------------------------------ the stage -- */

await check('runDisplayStage writes spec + certification, twice byte-identical', async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'display-'));
  const first = await runDisplayStage('test-park', {
    map: FIXTURE_MAP,
    pois: FIXTURE_POIS,
    outDir,
  });
  assert.equal(first.certified, true);
  assert.ok(first.written.length >= 3, 'spec per skin + certification expected');
  const snapshot = new Map(
    readdirSync(outDir).map((f) => [f, readFileSync(path.join(outDir, f), 'utf8')]),
  );
  const second = await runDisplayStage('test-park', { map: FIXTURE_MAP, pois: FIXTURE_POIS, outDir });
  assert.equal(second.certified, true);
  for (const [f, body] of snapshot) {
    assert.equal(readFileSync(path.join(outDir, f), 'utf8'), body, `${f} changed on a no-op rerun`);
  }
  return true;
});

await check('runDisplayStage threads injected landCover into every skin spec', async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'display-'));
  const result = await runDisplayStage('test-park', {
    map: FIXTURE_MAP_TWO_LANDS,
    pois: FIXTURE_POIS,
    outDir,
    landCover: { Midway: { code: 50, name: 'built_up' } },
  });
  assert.equal(result.certified, true);
  assert.equal(result.packs.trail.spec.landTones.Midway.day, LAND_COVER_STYLE.built_up.tone.day);
  return true;
});

await check('runDisplayStage with bakes: folds certs, binds the primary kit via skins', async () => {
  const { writeFileSync } = await import('node:fs');
  const outDir = mkdtempSync(path.join(tmpdir(), 'display-'));
  const bakeDir = mkdtempSync(path.join(tmpdir(), 'bakes-'));
  // Two baked kits; alphabetical order would pick island-brochure, but the
  // first active Skin bakeKit binding (park-midnight → rpg-overworld) wins.
  for (const kit of ['island-brochure', 'rpg-overworld']) {
    writeFileSync(path.join(bakeDir, `test-park--${kit}.style-cert.json`), JSON.stringify({
      certified: true,
      signature: `sig-${kit}`,
      bounds: { west: 0, south: 0, east: 0.01, north: 0.01 },
      checks: [{ key: 'style_terrain_palette', pass: true, evidence: 'fixture' }],
    }));
    writeFileSync(path.join(bakeDir, `test-park--${kit}.png`), 'png-bytes');
    writeFileSync(path.join(bakeDir, `test-park--${kit}.credits.json`), '{"assets":[]}');
  }
  // Iso-tier outputs share the bake dir but must not fold as a pseudo-kit
  // or land as manifest tiers (iso pack-tier integration is Phase C). The
  // fixture cert is FAILING so an accidental fold would trip bake_certs.
  writeFileSync(path.join(bakeDir, 'test-park--rpg-overworld--iso-r0.style-cert.json'), JSON.stringify({
    certified: false,
    signature: 'sig-iso',
    checks: [{ key: 'style_terrain_palette', pass: false, evidence: 'iso fixture' }],
  }));
  writeFileSync(path.join(bakeDir, 'test-park--rpg-overworld--iso-r0.png'), 'png-bytes');
  const result = await runDisplayStage('test-park', {
    map: FIXTURE_MAP, pois: FIXTURE_POIS, outDir, bake: { dir: bakeDir },
  });
  assert.deepEqual(Object.keys(result.bakes).sort(), ['island-brochure', 'rpg-overworld'],
    'iso certs never register as a pseudo-kit');
  assert.equal(result.bakes['rpg-overworld'].signature, 'sig-rpg-overworld');
  const cert = JSON.parse(readFileSync(path.join(outDir, 'display-certification.json'), 'utf8'));
  assert.ok(cert.checks.some((c) => c.key === 'bake:island-brochure:style_terrain_palette'));
  assert.equal(cert.checks.find((c) => c.key === 'bake_certs').pass, true,
    'the failing iso fixture cert is excluded from the fold');
  assert.ok(!cert.checks.some((c) => c.key.includes('iso-r0')), 'no iso rows fold into the pack cert');
  const manifest = JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.tiers.credits.kit, 'rpg-overworld', 'skins bakeKit binding beats directory order');
  assert.ok(manifest.tiers['bake:island-brochure'].bytes > 0);
  assert.ok(!Object.keys(manifest.tiers).some((k) => k.includes('iso-r0')), 'iso bakes are not pack tiers');
  // ADR-0016 world tier: every bakeKit-bound Skin gets a world row — placed
  // when its kit baked, a recorded gap otherwise. The raster-PMTiles tier is
  // retired (its permanent gap is what the world tier closes).
  assert.ok(!manifest.tiers.raster, 'the raster tier is retired in favor of worlds');
  assert.equal(manifest.tiers['world:trail'].kit, 'island-brochure');
  assert.equal(manifest.tiers['world:trail'].projection, 'top-down');
  assert.ok(manifest.tiers['world:trail'].bytes > 0);
  assert.equal(manifest.tiers['world:park-midnight'].kit, 'rpg-overworld');
  const trailWorld = JSON.parse(readFileSync(path.join(outDir, 'trail.world.json'), 'utf8'));
  assert.equal(trailWorld.file, 'trail.world.png');
  assert.deepEqual(trailWorld.bounds, { west: 0, south: 0, east: 0.01, north: 0.01 }, 'sidecar echoes the bake bounds');
  assert.equal(readFileSync(path.join(outDir, 'trail.world.png'), 'utf8'), 'png-bytes', 'the bake PNG lands in the pack');
  assert.equal(result.worlds.trail.kit, 'island-brochure');
  const empty = await runDisplayStage('test-park', {
    map: FIXTURE_MAP, pois: FIXTURE_POIS, outDir: mkdtempSync(path.join(tmpdir(), 'display-')), bake: { dir: mkdtempSync(path.join(tmpdir(), 'nobakes-')) },
  });
  assert.equal(empty.certified, false, 'no bakes = recorded gap, stage fails honestly');
  return true;
});

/* ------------------------------------------------ the pyramid tier -- */

/*
 * ADR-0019 clause 5 / ADR-0021 clause 5. The mid band ships inside the venue
 * download as the world tier; overview and close are cut into raster PMTiles
 * that stream by viewport from the deployed origin, and the automatic prefetch
 * that would have blurred the two was withdrawn. So the pack has to do three
 * things these cases hold it to: cut a pyramid for every band bake, refuse to
 * guess a band for a bake that does not declare one, and name the archive
 * WITHOUT pinning it into the offline bundle.
 */

/** A flat-colour PNG of known size — a stand-in band bake sharp can really read. */
async function paintBake(file, width, height, rgb) {
  const sharp = (await import('sharp')).default;
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    raw[i * 3] = rgb[0]; raw[i * 3 + 1] = rgb[1]; raw[i * 3 + 2] = rgb[2];
  }
  await sharp(raw, { raw: { width, height, channels: 3 } }).png().toFile(file);
  return file;
}

const BAND_BOUNDS = { west: 0, south: 0, east: 0.01, north: 0.01 };

/** A bake dir holding one bake per named kit, each cert as given. */
async function bakeDirWith(certs) {
  const { writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(tmpdir(), 'bandbakes-'));
  for (const [kit, spec] of Object.entries(certs)) {
    const { band, png = 'real', bounds = BAND_BOUNDS } = spec;
    writeFileSync(path.join(dir, `test-park--${kit}.style-cert.json`), JSON.stringify({
      certified: true,
      signature: `sig-${kit}`,
      bounds,
      ...(band ? { band } : {}),
      checks: [{ key: 'style_terrain_palette', pass: true, evidence: 'fixture' }],
    }));
    writeFileSync(path.join(dir, `test-park--${kit}.credits.json`), '{"assets":[]}');
    const bakePng = path.join(dir, `test-park--${kit}.png`);
    if (png === 'real') await paintBake(bakePng, 640, 384, [40, 90, 160]);
    else writeFileSync(bakePng, png);
  }
  return dir;
}

const stageWithBakes = async (bakeDir, outDir) => runDisplayStage('test-park', {
  map: FIXTURE_MAP, pois: FIXTURE_POIS, outDir, bake: { dir: bakeDir },
});

await check('an absent sharp is a pyramid gap; a band that will not cut is a failure', () => {
  // Driven through the exported gate rather than a local restatement of it, for
  // the reason the sibling tiles case gives: a test that re-implements the rule
  // drifts from the rule the pack applies and passes anyway.
  assert.equal(pyramidGatePasses([{ ok: false, gap: true, reason: 'sharp not installed' }]), true,
    'an absent native module says nothing about this venue');
  assert.equal(pyramidGatePasses([{ ok: false, reason: 'close pyramid failed: bake not found' }]), false,
    'a cutter that ran and failed is a fact about this venue');
  assert.equal(pyramidGatePasses([{ ok: true }, { ok: false, reason: 'boom' }]), false,
    'one broken band fails the set');
  assert.equal(pyramidGatePasses([{ ok: true }, { ok: false, gap: true, reason: 'no sharp' }]), true);
  assert.equal(pyramidGatePasses([]), true, 'a venue owed no pyramid is not a failing one');
  return true;
});

await check('a band bake is cut into a pyramid the shipped reader can address', async () => {
  const { existsSync, openSync, readSync, fstatSync } = await import('node:fs');
  const outDir = mkdtempSync(path.join(tmpdir(), 'display-'));
  const bakeDir = await bakeDirWith({ 'island-brochure': { band: 'overview' } });
  const result = await stageWithBakes(bakeDir, outDir);

  const manifest = JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  const row = manifest.tiers['pyramid:trail:overview'];
  assert.ok(row && !row.gap, `expected a pyramid tier, got ${JSON.stringify(row)}`);
  assert.equal(row.stream, 'pyramid/trail/overview.pmtiles', 'streamed, so addressed by url path');
  assert.equal(row.band, 'overview');
  assert.equal(row.kit, 'island-brochure');
  assert.ok(row.bytes > 0, 'the archive has bytes');
  // 640x384 at 512 px tiles is two levels: z1 is the bake (2x1 tiles), z0 the
  // whole band halved into one. Three tiles, and the row must say so.
  assert.equal(row.minzoom, 0);
  assert.equal(row.maxzoom, 1);
  assert.equal(row.tiles, 3, '2x1 at native plus 1 overview tile');

  const file = path.join(outDir, 'pyramid', 'trail', 'overview.pmtiles');
  assert.ok(existsSync(file), 'the archive is on disk where the manifest says');
  // Round-trip through the SHIPPED reader: a row that names an archive the
  // client cannot open is the failure this tier exists to prevent.
  const { PMTiles } = await import('pmtiles');
  const fd = openSync(file, 'r');
  const size = fstatSync(fd).size;
  const archive = new PMTiles({
    getKey: () => file,
    getBytes: async (offset, length) => {
      const len = Math.max(0, Math.min(length, size - offset));
      const buf = Buffer.alloc(len);
      if (len) readSync(fd, buf, 0, len, offset);
      return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    },
  });
  const header = await archive.getHeader();
  assert.equal(header.maxZoom, 1);
  assert.equal(header.minLon, BAND_BOUNDS.west, 'georeferenced on the bake bounds');
  assert.equal(header.maxLat, BAND_BOUNDS.north);
  const tile = await archive.getZxy(1, 0, 0);
  assert.ok(tile && tile.data.byteLength > 0, 'the native-level tile reads back');
  assert.equal(Buffer.from(tile.data).subarray(1, 4).toString('ascii'), 'PNG', 'and it is a PNG');

  const cert = JSON.parse(readFileSync(path.join(outDir, 'display-certification.json'), 'utf8'));
  const gate = cert.checks.find((c) => c.key === 'pyramids');
  assert.ok(gate, 'the pack certifies its pyramids');
  assert.equal(gate.pass, true, gate.evidence);
  assert.match(gate.evidence, /trail:overview/, gate.evidence);
  assert.ok(result.written.includes(file), 'the stage reports the archive it wrote');
  return true;
});

await check('an unbanded bake gets no guessed band — it is a recorded gap', async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'display-'));
  const bakeDir = await bakeDirWith({ 'island-brochure': { band: null } });
  const result = await stageWithBakes(bakeDir, outDir);
  const manifest = JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  const row = manifest.tiers['pyramid:trail'];
  assert.ok(row?.gap, `expected a gap row, got ${JSON.stringify(row)}`);
  assert.match(row.reason, /band/i, row.reason);
  assert.ok(!Object.values(manifest.tiers).some((t) => typeof t.stream === 'string'),
    'nothing is offered for streaming');
  // A venue that has only ever baked the one-band world still certifies: the
  // missing pyramid costs prettiness, not function (ADR-0021 clause 1).
  const cert = JSON.parse(readFileSync(path.join(outDir, 'display-certification.json'), 'utf8'));
  assert.equal(cert.checks.find((c) => c.key === 'pyramids').pass, true);
  assert.equal(result.certified, true, 'an unbanded pack is not a broken pack');
  return true;
});

await check('a band bake that will not cut fails the pack', async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'display-'));
  // Declares a band, so a pyramid is owed; the bytes are not a PNG, so sharp
  // runs and fails. That is a fact about this venue, not an absent toolchain.
  const bakeDir = await bakeDirWith({ 'island-brochure': { band: 'close', png: 'not-a-png' } });
  const result = await stageWithBakes(bakeDir, outDir);
  const cert = JSON.parse(readFileSync(path.join(outDir, 'display-certification.json'), 'utf8'));
  const gate = cert.checks.find((c) => c.key === 'pyramids');
  assert.equal(gate.pass, false, gate.evidence);
  assert.match(gate.evidence, /close/, gate.evidence);
  assert.equal(result.certified, false, 'a band the guest can never sharpen fails the gate');
  return true;
});

await check('the streamed pyramid is named by the pack and not pinned into the download', async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'display-'));
  const bakeDir = await bakeDirWith({ 'island-brochure': { band: 'overview' } });
  await stageWithBakes(bakeDir, outDir);
  const manifest = JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  assert.ok(manifest.tiers['pyramid:trail:overview'].stream, 'the manifest names it');
  // ADR-0021 clause 5 withdrew automatic prefetch: bands stream and cache, and
  // offline coverage is a guest-chosen download. A pyramid inside bundle.json
  // is that prefetch by another name.
  const bundle = JSON.parse(readFileSync(path.join(outDir, 'bundle.json'), 'utf8'));
  const pinned = bundle.files.map((f) => f.path);
  assert.ok(!pinned.some((f) => f.endsWith('.pmtiles') && f.includes('/pyramid/')),
    `the offline download must not carry a streamed pyramid: ${pinned.filter((f) => f.includes('pyramid'))}`);
  // The world tier is the offline floor and does stay pinned.
  assert.ok(pinned.some((f) => f.endsWith('/trail.world.png')), 'the mid-band world still ships offline');
  return true;
});

/* ------------------------------------------- style-pass kit vocabulary -- */

await check('style-pass switches validate: road/service styles, rim, displacement, wash', () => {
  const atlas = resolveKit({
    id: 'atlas',
    terrain: { road: { style: 'double' }, service: { style: 'dashed' }, water: { rim: { color: '#123456', alpha: 0.4, reach: 2 } } },
    sprites: { building: { style: 'plan' }, coaster: { style: 'schematic' } },
  });
  assert.equal(atlas.terrain.road.style, 'double');
  assert.equal(atlas.sprites.building.style, 'plan');
  assert.throws(() => resolveKit({ terrain: { road: { style: 'triple' } } }), /Unknown road style/);
  assert.throws(() => resolveKit({ terrain: { service: { style: 'dotted' } } }), /Unknown service style/);
  assert.throws(() => resolveKit({ terrain: { water: { rim: { color: '#123', alpha: 0.4, reach: 9 } } } }), /rim.reach/);
  assert.throws(() => resolveKit({ terrain: { water: { rim: { color: '#123', alpha: 2, reach: 2 } } } }), /rim.alpha/);
  const wobbly = resolveKit({ id: 'w', strokes: { displacement: { amplitude: 2, wavelength: 3 } }, wash: { mode: 'multiply', paper: '#F7F2E4' } });
  assert.equal(wobbly.strokes.displacement.amplitude, 2);
  assert.equal(wobbly.wash.paper, '#F7F2E4');
  assert.throws(() => resolveKit({ strokes: { displacement: { amplitude: 99 } } }), /amplitude/);
  assert.throws(() => resolveKit({ wash: { mode: 'screen', paper: '#fff' } }), /wash mode/);
  return true;
});

await check('kit material refs resolve against the MaterialSet ledger or fail loudly', () => {
  const materials = readMaterials();
  const kit = resolveKit({
    id: 'm',
    terrain: { grass: { material: { id: 'grass--meadow', mix: 0.3 } } },
    sprites: { building: { material: { id: 'roofing--shingle', mix: 0.35 } } },
  }, { materials });
  assert.equal(kit.terrain.grass.material.id, 'grass--meadow');
  assert.throws(() => resolveKit({ terrain: { grass: { material: { id: 'lava--fake' } } } }, { materials }), /unknown material/);
  assert.throws(() => resolveKit({ terrain: { grass: { material: { id: 'grass--meadow', mix: 3 } } } }, { materials }), /mix/);
  assert.throws(() => resolveKit({ terrain: { grass: { material: { id: 'grass--meadow' } } } }), /needs the materials ledger/);
  return true;
});

await check('boundaryDistanceField: interior distance saturates, other classes carry 0', async () => {
  const { boundaryDistanceField } = await import('../../packages/venue-builder/lib/display-bake.mjs');
  // 5x5: water block in the middle 3x3, ground frame.
  const W = 4; const G = 1;
  const grid = [
    G, G, G, G, G,
    G, W, W, W, G,
    G, W, W, W, G,
    G, W, W, W, G,
    G, G, G, G, G,
  ];
  const field = boundaryDistanceField(grid, 5, 5, W, 3);
  assert.equal(field[0], 0, 'ground cells carry 0');
  assert.equal(field[6], 1, 'water touching the shore is distance 1');
  assert.equal(field[12], 2, 'the centre cell is 2 from the shore');
  assert.deepEqual(field, boundaryDistanceField(grid, 5, 5, W, 3), 'deterministic');
  return true;
});

/* ------------------------------------------------------------ materials -- */

await check('compiled material pins verify; gaps are recorded, drift fails', async () => {
  const { verifyCompiledMaterials, materialTexturesRow } = await import(
    '../../packages/venue-builder/lib/display-materials.mjs'
  );
  const materials = readMaterials();
  const report = verifyCompiledMaterials(materials);
  assert.deepEqual(report.problems, [], report.problems.join('; '));
  assert.ok(report.resolved.includes('grass--meadow'), 'fetched materials verify');
  assert.match(report.gaps['water--calm'] || '', /material-maker/, 'authored graphs are recorded gaps');
  // A row claiming bytes that do not exist is a problem, not a gap.
  const broken = verifyCompiledMaterials({
    'ghost--tex': { compiled: { basecolor: { path: 'assets/vendor/materials/ghost.jpg', sha256: '0'.repeat(64) } } },
  });
  assert.equal(broken.problems.length, 1);
  assert.match(broken.problems[0], /missing/);
  // The certification row: bound gaps pass on the record; bound problems fail.
  const spec = { surfaces: { vegetation: { material: 'grass--meadow' }, water: { material: 'water--calm' } } };
  const row = materialTexturesRow({ spec, report });
  assert.equal(row.key, 'material_textures_resolve');
  assert.equal(row.pass, true);
  assert.match(row.evidence, /water--calm/);
  const failRow = materialTexturesRow({
    spec: { surfaces: { x: { material: 'ghost--tex' } } },
    report: broken,
  });
  assert.equal(failRow.pass, false);
  return true;
});

await check('the display stage carries material_textures_resolve on every skin', async () => {
  const cert = certified();
  assert.equal(cert.checks.some((c) => c.key === 'material_textures_resolve'), false,
    'pure certify without an injected report carries no row');
  const outDir = mkdtempSync(path.join(tmpdir(), 'display-'));
  const staged = await runDisplayStage('test-park', { map: FIXTURE_MAP, pois: FIXTURE_POIS, outDir });
  for (const [skinId, pack] of Object.entries(staged.packs)) {
    const row = pack.certification.checks.find((c) => c.key === 'material_textures_resolve');
    assert.ok(row, `${skinId} lacks the textures row`);
    assert.equal(row.pass, true, row.evidence);
  }
  return true;
});

/* ----------------------------------------------------------- world tier -- */

await check('every bakeKit-bound Skin gets a world row — placed or a recorded gap', async () => {
  const { buildWorldTier } = await import('../../packages/venue-builder/lib/display-world.mjs');
  const { writeFileSync } = await import('node:fs');
  const bakeDir = mkdtempSync(path.join(tmpdir(), 'bakes-'));
  const outDir = mkdtempSync(path.join(tmpdir(), 'world-'));
  writeFileSync(path.join(bakeDir, 'test-park--kit-a.png'), 'png-a');
  const templates = {
    'skin-a': { id: 'skin-a', status: 'active', bakeKit: 'kit-a' },
    'skin-b': { id: 'skin-b', status: 'active', bakeKit: 'kit-b' }, // never baked
    'skin-c': { id: 'skin-c', status: 'active' }, // no bakeKit — no world row
  };
  const bakeCerts = [{ kit: 'kit-a', cert: { certified: true, bounds: { west: 1, south: 2, east: 3, north: 4 } } }];
  const tier = buildWorldTier({ id: 'test-park', templates, bakeDir, bakeCerts, outDir });
  const byName = Object.fromEntries(tier.entries.map((e) => [e.name, e]));
  assert.ok(byName['world:skin-a'].bytes > 0, 'baked kit places its world');
  assert.equal(byName['world:skin-a'].meta.kit, 'kit-a');
  assert.ok(byName['world:skin-b'].gap, 'an unbaked kit is a recorded gap, never silent');
  assert.match(byName['world:skin-b'].reason, /venues:bake/);
  assert.ok(!byName['world:skin-c'], 'a Skin without a bakeKit claims no world');
  assert.equal(tier.worlds['skin-a'].projection, 'top-down');
  assert.equal(readFileSync(path.join(outDir, 'skin-a.world.png'), 'utf8'), 'png-a');
  // A cert without bounds cannot place an image on truth — recorded gap.
  const noBounds = buildWorldTier({
    id: 'test-park', templates, bakeDir, outDir: mkdtempSync(path.join(tmpdir(), 'world-')),
    bakeCerts: [{ kit: 'kit-a', cert: { certified: true } }],
  });
  assert.ok(noBounds.entries.find((e) => e.name === 'world:skin-a').gap);
  return true;
});

await check('worldSidecar echoes bounds and rejects unknown projections', async () => {
  const { worldSidecar } = await import('../../packages/venue-builder/lib/display-world.mjs');
  const bounds = { west: -84.28, south: 39.33, east: -84.25, north: 39.35 };
  const side = worldSidecar({ skin: 's', kit: 'k', bounds, file: 's.world.png', credits: 'c.json' });
  assert.equal(side.projection, 'top-down');
  assert.deepEqual(side.bounds, bounds);
  assert.throws(() => worldSidecar({ skin: 's', kit: 'k', bounds, file: 'f', projection: 'oblique' }), /projection/);
  assert.throws(() => worldSidecar({ skin: 's', kit: 'k', bounds: { west: 1 }, file: 'f' }), /bounds/);
  return true;
});

await check('publishWorlds copies exactly the named worlds to the app, and names what is missing', async () => {
  const { buildWorldTier, publishWorlds } = await import('../../packages/venue-builder/lib/display-world.mjs');
  const { writeFileSync, existsSync } = await import('node:fs');
  const bakeDir = mkdtempSync(path.join(tmpdir(), 'bakes-'));
  const outDir = mkdtempSync(path.join(tmpdir(), 'world-'));
  const publicDir = mkdtempSync(path.join(tmpdir(), 'public-'));
  writeFileSync(path.join(bakeDir, 'test-park--kit-a.png'), 'png-a');
  buildWorldTier({
    id: 'test-park',
    templates: { 'skin-a': { id: 'skin-a', status: 'active', bakeKit: 'kit-a' } },
    bakeDir,
    bakeCerts: [{ kit: 'kit-a', cert: { certified: true, bounds: { west: 1, south: 2, east: 3, north: 4 } } }],
    outDir,
  });
  const res = publishWorlds('test-park', ['skin-a', 'skin-x'], { outDir, publicDir });
  assert.ok(existsSync(path.join(publicDir, 'skin-a.world.png')));
  assert.ok(existsSync(path.join(publicDir, 'skin-a.world.json')));
  assert.deepEqual(res.missing, ['skin-x'], 'a world that is not in the pack is named, not invented');
  assert.equal(res.published.length, 2);
  return true;
});

await check('runDisplayStage with an iso sweep: a class starved at every rotation fails the pack (#521)', async () => {
  const { writeFileSync } = await import('node:fs');
  const flatCert = JSON.stringify({
    certified: true,
    signature: 'sig-flat',
    bounds: { west: 0, south: 0, east: 0.01, north: 0.01 },
    checks: [{ key: 'style_terrain_palette', pass: true, evidence: 'fixture' }],
  });
  const isoCert = (starved) => JSON.stringify({
    certified: true,
    signature: 'sig-iso',
    checks: [{ key: 'style_terrain_palette', pass: true, evidence: 'iso fixture' }],
    ...(starved.length ? {
      skips: [{
        key: 'occlusion_starved',
        reason: 'fixture',
        count: 9,
        byClass: Object.fromEntries(starved.map((cls) => [cls, { kept: 1, culled: 8 }])),
      }],
    } : {}),
  });
  const stage = async (writeCerts) => {
    const bakeDir = mkdtempSync(path.join(tmpdir(), 'bakes-iso-'));
    writeFileSync(path.join(bakeDir, 'test-park--rpg-overworld.style-cert.json'), flatCert);
    writeFileSync(path.join(bakeDir, 'test-park--rpg-overworld.png'), 'png-bytes');
    writeCerts(bakeDir);
    return runDisplayStage('test-park', {
      map: FIXTURE_MAP, pois: FIXTURE_POIS, outDir: mkdtempSync(path.join(tmpdir(), 'display-iso-')), bake: { dir: bakeDir },
    });
  };
  const starvedEverywhere = await stage((dir) => {
    writeFileSync(path.join(dir, 'test-park--rpg-overworld--iso-r0.style-cert.json'), isoCert(['road']));
    writeFileSync(path.join(dir, 'test-park--rpg-overworld--iso-r2.style-cert.json'), isoCert(['road']));
  });
  const row = (r) => r.written
    .filter((f) => f.endsWith('display-certification.json'))
    .flatMap((f) => JSON.parse(readFileSync(f, 'utf8')).checks)
    .find((c) => c.key === 'bake:rpg-overworld:style_occlusion_cross_rotation');
  const failing = row(starvedEverywhere);
  assert.ok(failing, 'the sweep rule folds into the venue certification');
  assert.equal(failing.pass, false);
  assert.match(failing.evidence, /road/);
  assert.equal(starvedEverywhere.certified, false, 'a class no rotation ever certified fails the pack');
  const covered = await stage((dir) => {
    writeFileSync(path.join(dir, 'test-park--rpg-overworld--iso-r0.style-cert.json'), isoCert(['road']));
    writeFileSync(path.join(dir, 'test-park--rpg-overworld--iso-r2.style-cert.json'), isoCert([]));
  });
  assert.equal(row(covered).pass, true, 'surviving one rotation covers the class');
  assert.equal(covered.certified, true, row(covered).evidence);
  return true;
});

/* ------------------------------ ADR-0021 clause 1: nothing readable bakes -- */

// "The painted band carries no information that is not recoverable from
// Truth." No band bakes legible text: "signage" means sign OBJECTS — frames,
// marquees, silhouettes — never readable words, and every string on the map
// comes from pois.json. `visual.json` may style a label (ink, halo, the zoom
// it appears at) but never supplies the string. Clause 1 names two
// certification rows; both live in lib/display-style-contract.mjs.

const { certifyStyleContract, visualLabelStringsRow } = await import(
  '../../packages/venue-builder/lib/display-style-contract.mjs'
);
const KIT_DIR = new URL('../../packages/venue-builder/data/display/kits/', import.meta.url);
const BADGE_KINDS = Object.values(POI_BADGES);

// The clause-1 badge row reads the model's badge kinds and the resolved
// kit's icon ledger — never the sampled pixels — so an empty sample plan is
// the honest fixture: nothing about painted colour is claimed here.
const CLAUSE1_PROFILE = {
  version: 1, id: 'clause1-profile', kit: 'clause1-kit', style: 'test', colorFamilies: {},
};
const clause1Model = (badges) => ({ cols: 4, rows: 4, cells: new Array(16).fill(1), badges });
const clause1Cert = (badges, extra = {}) => certifyStyleContract({
  model: clause1Model(badges),
  points: [],
  samples: [],
  profile: CLAUSE1_PROFILE,
  kit: resolveKit({ id: 'clause1-kit' }),
  ...extra,
});
const rowOf = (cert, key) => cert.checks.find((c) => c.key === key);

await check('a badge kind with no icon fails style_no_baked_text, naming the kind', () => {
  const bad = clause1Cert([{ kind: 'gate', x: 1, y: 1 }, { kind: 'first-aid', x: 2, y: 2 }]);
  const row = rowOf(bad, 'style_no_baked_text');
  assert.ok(row, 'clause 1 needs a style_no_baked_text row on every style cert');
  assert.equal(row.pass, false, 'a badge kind with no glyph must fail loudly, not be lettered');
  assert.match(row.evidence, /first-aid/, 'the row must name the unresolvable kind');
  assert.equal(bad.certified, false, 'an unglyphed badge must fail the whole certification');
  return true;
});

await check('every POI badge kind resolves to a glyph — style_no_baked_text is not always red', () => {
  const good = clause1Cert(BADGE_KINDS.map((kind, i) => ({ kind, x: i, y: i })));
  const row = rowOf(good, 'style_no_baked_text');
  assert.equal(row.pass, true, JSON.stringify(row));
  // Known answer: the six glyph ids SPRITE_PIECES pins, kinds in sort order.
  assert.equal(
    row.evidence,
    '6 painted badge kind(s) resolve to icon glyphs: food→parkbound-badge-food, '
    + 'gate→parkbound-badge-gate, restroom→parkbound-badge-restroom, '
    + 'service→parkbound-badge-service, shop→parkbound-badge-shop, '
    + 'show→parkbound-badge-show',
  );
  assert.equal(
    rowOf(clause1Cert([]), 'style_no_baked_text').pass, true,
    'a model with no badges has nothing to letter',
  );
  return true;
});

await check('the six shipped kits still certify clause 1 — every kind glyphs', async () => {
  const { readAssetLedger, assetPath } = await import('../../packages/venue-builder/lib/display-assets.mjs');
  const { existsSync } = await import('node:fs');
  const assets = readAssetLedger();
  const materials = readMaterials();
  const files = readdirSync(KIT_DIR).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(files, [
    'blueprint-survey.json', 'island-brochure.json', 'layered-atlas.json',
    'midnight-carnival.json', 'rpg-overworld.json', 'watercolor-quest.json',
  ], 'the shipped kit set changed — re-check clause 1 against the new kit');
  for (const file of files) {
    const kit = resolveKit(
      JSON.parse(readFileSync(new URL(file, KIT_DIR), 'utf8')),
      { assets, materials },
    );
    const cert = certifyStyleContract({
      model: clause1Model(BADGE_KINDS.map((kind, i) => ({ kind, x: i, y: i }))),
      points: [],
      samples: [],
      profile: { ...CLAUSE1_PROFILE, kit: kit.id },
      kit,
    });
    const row = rowOf(cert, 'style_no_baked_text');
    assert.equal(row.pass, true, `${file} would now bake a letter: ${row.evidence}`);
    // The row proves the kit NAMES a glyph; this proves the painter will
    // find one. `sheetImages[BD.icons[kind].asset]` is only truthy when the
    // ledger serves real bytes, and a falsy one is exactly what used to be
    // lettered — so the removed fallback cannot have been load-bearing.
    for (const kind of BADGE_KINDS) {
      const id = kit.sprites.badge.icons[kind].asset;
      assert.equal(assets[id]?.kind, 'icon', `${file}: badge ${kind} → ${id} is not a ledger icon`);
      assert.ok(existsSync(assetPath(assets[id])), `${file}: badge ${kind} glyph missing on disk`);
    }
  }
  return true;
});

// EVERY painter, not just the flat one. The iso page carried a byte-identical
// copy of the letter fallback — same LETTER map, same fillText — and it
// certifies through the same certifyStyleContract, so the row governed it while
// the paint contradicted it. Checking one painter would have let the next copy
// through; ADR-0021 clause 1 says "no band bakes legible text", and a band is
// whatever a painter emits.
for (const painter of ['display-bake-page.html', 'display-iso-page.html']) {
  await check(`the ${painter} painter carries no text call at all`, () => {
    const page = readFileSync(
      new URL(`../../packages/venue-builder/bin/${painter}`, import.meta.url),
      'utf8',
    );
    for (const call of ['fillText', 'strokeText', 'measureText', 'textAlign', 'textBaseline', 'LETTER']) {
      assert.equal(page.includes(call), false, `${painter} still paints text: ${call}`);
    }
    assert.doesNotMatch(page, /\bfont\s*=/, 'a canvas font assignment means a word is coming');
    assert.match(page, /BD\.icons/, 'the badge glyph must still come from the icon ledger');
    return true;
  });
}

const CLEAN_SPEC = {
  version: 1,
  venue: 'test-park',
  skin: 'trail',
  // Label STYLING is exactly what the clause allows: the ink and the halo.
  tokens: { labelHalo: true, colors: { label: '#2C2416', path: '#8B7355' } },
  // District keys are selectors matched against a name the tiles already
  // carry from truth — not copy this file supplies.
  landTones: { 'Coney Mall': { day: '#F1EAE4', night: '#2A231D' } },
  surfaces: { walkway: { material: 'paving-stones--warm', layers: ['path'] } },
};

await check('a visual.json carrying a label string fails style_no_label_strings', () => {
  const ok = visualLabelStringsRow(CLEAN_SPEC);
  assert.equal(ok.key, 'style_no_label_strings');
  assert.equal(ok.pass, true, ok.evidence);

  const renamed = JSON.parse(JSON.stringify(CLEAN_SPEC));
  renamed.landTones['Coney Mall'].label = 'Sweet Street';
  const bad = visualLabelStringsRow(renamed);
  assert.equal(bad.pass, false, 'a Skin must never supply the words on a Place');
  assert.match(bad.evidence, /landTones\.Coney Mall\.label/, 'the row must name the leaking path');
  assert.match(bad.evidence, /Sweet Street/, 'the row must quote the string it found');

  // The exemption is colour-shaped, not key-shaped: `tokens.colors.label` is
  // the ink a label is drawn in, but a word parked in that slot is still copy.
  const smuggled = JSON.parse(JSON.stringify(CLEAN_SPEC));
  smuggled.tokens.colors.label = 'Coney Mall';
  assert.equal(visualLabelStringsRow(smuggled).pass, false, 'a word under a colour key is still a word');

  for (const key of ['text', 'title', 'name', 'caption', 'text-field']) {
    const leak = { ...CLEAN_SPEC, tokens: { ...CLEAN_SPEC.tokens, [key]: 'Millennium Force' } };
    assert.equal(visualLabelStringsRow(leak).pass, false, `${key} smuggles copy past the row`);
  }
  return true;
});

await check('every shipped visual.json passes clause 1 — no Skin supplies a word', () => {
  const venues = new URL('../../packages/venue-builder/data/venues/', import.meta.url);
  const specs = [];
  for (const venue of readdirSync(venues).sort()) {
    const display = new URL(`${venue}/display/`, venues);
    let entries = [];
    try { entries = readdirSync(display); } catch { continue; }
    for (const f of entries.filter((n) => n.endsWith('.visual.json')).sort()) {
      specs.push([`${venue}/${f}`, JSON.parse(readFileSync(new URL(f, display), 'utf8'))]);
    }
  }
  assert.ok(specs.length >= 16, `expected the four shipped venues × four Skins, found ${specs.length}`);
  for (const [name, spec] of specs) {
    const row = visualLabelStringsRow(spec);
    assert.equal(row.pass, true, `${name}: ${row.evidence}`);
  }
  return true;
});

await check('the style cert carries the label row when a spec rides along', () => {
  const renamed = JSON.parse(JSON.stringify(CLEAN_SPEC));
  renamed.landTones['Coney Mall'].label = 'Sweet Street';
  const withSpec = clause1Cert([], { visual: renamed });
  assert.equal(rowOf(withSpec, 'style_no_label_strings').pass, false);
  assert.equal(withSpec.certified, false, 'a label string in the spec must fail the cert');
  assert.equal(rowOf(clause1Cert([], { visual: CLEAN_SPEC }), 'style_no_label_strings').pass, true);
  // No spec, no row: bin/display-bake.mjs does not read visual.json, so on
  // the bake path this row is the display pack's to carry.
  assert.equal(rowOf(clause1Cert([]), 'style_no_label_strings'), undefined);
  return true;
});

/* --------------------------------------------------------------- wiring -- */

await check('display is a pipeline stage after certify, opt-in via --display', () => {
  assert.deepEqual(STAGES, [
    'sources', 'geometry', 'research', 'aliases', 'heights', 'rebuild',
    'attractions', 'agent', 'certify', 'display',
  ]);
  const args = parseCatalogArgs(['--pipeline', '--display']);
  assert.equal(args.display, true);
  // Unset rather than false without the flag: runVenuePipeline's own default
  // (on for big-kahunas, off elsewhere — issue #527) only applies when this
  // is undefined, not when a caller forces it false for every park.
  assert.equal(parseCatalogArgs(['--pipeline']).display, undefined);
  assert.equal(pipelineOptsFromCatalogArgs(args).display, true);
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
