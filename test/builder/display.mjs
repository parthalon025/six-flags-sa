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
  readSkinTemplates,
  readMaterials,
  compileVisualSpec,
  certifyDisplayPack,
  styleFromSpec,
  anchorsFromTruth,
  runDisplayStage,
  foldBakeCerts,
  tierManifest,
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

const { bakeModel, declutterBadges, resolveKit, TERRAIN_PIECES, TEXTURE_KINDS } = await import(
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

await check('the crop window is integral and tightens to the boundary', () => {
  const tight = {
    ...BAKE_MAP,
    boundary: [[0.004, 0.004], [0.006, 0.004], [0.006, 0.006], [0.004, 0.006]],
  };
  const full = bakeModel({ ...tight, boundary: null }, [], { maxCols: 60 });
  const cropped = bakeModel(tight, [], { maxCols: 60, margin: 2 });
  assert.ok(Number.isInteger(cropped.cols) && Number.isInteger(cropped.rows), 'grid dims must be integers');
  assert.equal(cropped.cells.length, cropped.cols * cropped.rows, 'cells must fill the grid exactly');
  assert.ok(cropped.cols < full.cols && cropped.rows < full.rows, 'crop must tighten to the boundary');
  assert.equal(JSON.stringify(cropped), JSON.stringify(bakeModel(tight, [], { maxCols: 60, margin: 2 })));
  return true;
});

await check('the bake model carries geo bounds of its crop window', () => {
  const full = bakeModel({ ...BAKE_MAP, boundary: null }, [], { maxCols: 60 });
  const cropped = bakeModel(BAKE_MAP, [], { maxCols: 60, margin: 1 });
  for (const m of [full, cropped]) {
    assert.ok(m.bounds, 'bounds ride every model');
    assert.ok(m.bounds.west < m.bounds.east && m.bounds.south < m.bounds.north, 'WSEN ordering');
    assert.ok(m.bounds.west >= -0.001 && m.bounds.east <= 0.011, 'inside the map bbox');
  }
  const span = (b) => (b.east - b.west) * (b.north - b.south);
  assert.ok(span(cropped.bounds) < span(full.bounds), 'the crop window tightens the geo bounds');
  assert.deepEqual(cropped.bounds, bakeModel(BAKE_MAP, [], { maxCols: 60, margin: 1 }).bounds, 'deterministic');
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

await check('entities outside the crop window leave the model', () => {
  const withOutsider = {
    ...BAKE_MAP,
    boundary: [[0.004, 0.004], [0.009, 0.004], [0.009, 0.009], [0.004, 0.009]],
    building: [
      { r: [[0.005, 0.005], [0.006, 0.005], [0.006, 0.006]] }, // inside the window
      { r: [[0.0005, 0.0005], [0.001, 0.0005], [0.001, 0.001]] }, // a neighboring business
    ],
  };
  const outsidePoi = { i: 'far-gate', n: 'Far Gate', c: 'gate', lat: 0.0005, lng: 0.0005 };
  const insidePoi = { i: 'near-food', n: 'Near Food', c: 'food', lat: 0.006, lng: 0.006 };
  const model = bakeModel(withOutsider, [outsidePoi, insidePoi], { maxCols: 60, margin: 1 });
  assert.equal(model.buildings.length, 1, 'the off-window footprint is not part of this world');
  assert.deepEqual(model.badges.map((b) => b.kind), ['food'], 'the off-window pin is dropped');
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

await check('crop shifts roads with the window', () => {
  const model = bakeModel(BAKE_MAP, [], { maxCols: 60, margin: 2 });
  assert.ok(model.roads.length >= 1, 'path polyline expected');
  for (const road of model.roads) {
    for (const [x, y] of road.pts) {
      assert.ok(x >= -2 && x <= model.cols + 2 && y >= -2 && y <= model.rows + 2,
        'road points must live in the cropped window');
    }
  }
  return true;
});

/* ------------------------------------------------------------ the stage -- */

await check('runDisplayStage writes spec + certification, twice byte-identical', () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'display-'));
  const first = runDisplayStage('test-park', {
    map: FIXTURE_MAP,
    pois: FIXTURE_POIS,
    outDir,
  });
  assert.equal(first.certified, true);
  assert.ok(first.written.length >= 3, 'spec per skin + certification expected');
  const snapshot = new Map(
    readdirSync(outDir).map((f) => [f, readFileSync(path.join(outDir, f), 'utf8')]),
  );
  const second = runDisplayStage('test-park', { map: FIXTURE_MAP, pois: FIXTURE_POIS, outDir });
  assert.equal(second.certified, true);
  for (const [f, body] of snapshot) {
    assert.equal(readFileSync(path.join(outDir, f), 'utf8'), body, `${f} changed on a no-op rerun`);
  }
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
  assert.equal(parseCatalogArgs(['--pipeline']).display, false);
  assert.equal(pipelineOptsFromCatalogArgs(args).display, true);
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
