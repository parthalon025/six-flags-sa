#!/usr/bin/env node
/**
 * Terrain — elevation grid, DEM resolution, hillshade, prop scatter, and the
 * constraint solver. Height is a Display input: nothing here may reach truth.
 *
 *   node test/builder/terrain.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ElevationGrid, gridFromBounds } from '../../packages/venue-builder/lib/terrain/elevation-grid.mjs';
import { shadeField, shadeRgba, encodePng } from '../../packages/venue-builder/lib/terrain/hillshade.mjs';
import { fitness, resolveDem } from '../../packages/venue-builder/lib/terrain/dem-source.mjs';
import { ConstraintGrid } from '../../packages/venue-builder/lib/terrain/constraints.mjs';
import { meshFromGrid } from '../../packages/venue-builder/lib/terrain/mesh-export.mjs';
import { makeNoise2D, makeRng } from '../../packages/venue-builder/lib/terrain/noise.mjs';
import { scatterPoints, densityFromSpecies, fillRows } from '../../packages/venue-builder/lib/display-scatter.mjs';
import { exportTileGeoJson } from '../../packages/venue-builder/lib/tiles-export.mjs';
import { tileNameFor as tile3dep } from '../../packages/venue-builder/lib/adapters/usgs-3dep.mjs';
import { tileNameFor as tileCop } from '../../packages/venue-builder/lib/adapters/copernicus-dem.mjs';
import {
  compileVisualSpec, certifyDisplayPack, readMaterials, readSkinTemplates,
  readLandCover, readGrounding,
  styleFromSpec, mixHex, tilesGatePasses, DEFAULT_MATERIAL_MIX,
} from '../../packages/venue-builder/lib/display-pack.mjs';
import { crownStipple, seedFromString, resolveKit, TERRAIN_PIECES, bakeModel } from '../../packages/venue-builder/lib/display-bake.mjs';
import { buildMattReviewContext } from '../../scripts/lib/matt-review.mjs';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
import { parseCatalogArgs, pipelineOptsFromCatalogArgs } from '../../packages/venue-builder/lib/build-pipeline.mjs';

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

const ramp = (cols, rows, cell = 1) => {
  const v = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) v[r * cols + c] = c * cell;
  return new ElevationGrid({ cols, rows, cellSize: cell, values: v });
};

console.log('\nterrain\n');

/* ------------------------------------------------------- elevation grid -- */

await check('a 1:1 ramp measures exactly 45 degrees', () => {
  assert.equal(Math.round(ramp(8, 8).slopeAt(3.2, 3.2) * 1e6) / 1e6, 45);
  return true;
});

await check('flat ground has no slope and a straight-up normal', () => {
  const g = new ElevationGrid({ cols: 6, rows: 6, cellSize: 4, values: new Float32Array(36) });
  assert.equal(g.slopeAt(2.5, 2.5), 0);
  assert.equal(g.normalAt(2.5, 2.5).z, 1);
  return true;
});

await check('sampling is exact at cell centres and along an edge', () => {
  const g = ramp(8, 8);
  assert.equal(g.elevationAt(3, 2), 3);
  assert.equal(g.elevationAt(3.5, 2), 3.5);
  return true;
});

await check('both triangles of a cell agree on their shared diagonal', () => {
  const v = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const g = new ElevationGrid({ cols: 3, rows: 3, cellSize: 1, values: v });
  // Points either side of the split must not jump.
  const a = g.elevationAt(0.5 - 1e-7, 0.5 - 1e-7);
  const b = g.elevationAt(0.5 + 1e-7, 0.5 + 1e-7);
  assert.ok(Math.abs(a - b) < 1e-4, `discontinuity ${a} vs ${b}`);
  return true;
});

await check('out-of-range samples clamp instead of wrapping', () => {
  const g = ramp(5, 5);
  assert.equal(g.at(-3, -3), g.at(0, 0));
  assert.equal(g.at(99, 99), g.at(4, 4));
  return true;
});

await check('gridFromBounds samples cell centres north-first', () => {
  const g = gridFromBounds({
    bounds: { north: 1, south: 0, east: 1, west: 0 },
    cols: 4, rows: 4,
    sample: (lat) => lat * 100,
  });
  assert.ok(g.at(0, 0) > g.at(0, 3), 'north row should be higher');
  return true;
});

await check('a non-finite DEM sample becomes zero, never NaN in the grid', () => {
  const g = gridFromBounds({
    bounds: { north: 1, south: 0, east: 1, west: 0 },
    cols: 3, rows: 3, sample: () => NaN,
  });
  assert.ok(g.values.every(Number.isFinite));
  return true;
});

/* ------------------------------------------------------------ hillshade -- */

await check('hillshade is byte-identical across runs', () => {
  const g = ramp(24, 24, 5);
  const a = encodePng(24, 24, shadeRgba(shadeField(g), 24, 24));
  const b = encodePng(24, 24, shadeRgba(shadeField(g), 24, 24));
  assert.ok(a.equals(b));
  return true;
});

await check('genuinely flat ground emits no relief rather than amplified noise', () => {
  const g = new ElevationGrid({ cols: 16, rows: 16, cellSize: 5, values: new Float32Array(256) });
  const rgba = shadeRgba(shadeField(g), 16, 16);
  const opaque = [...rgba].filter((_, i) => i % 4 === 3).some((a) => a > 0);
  assert.equal(opaque, false);
  return true;
});

await check('the PNG is a real PNG', () => {
  const png = encodePng(4, 4, new Uint8Array(64).fill(128));
  assert.equal(png.slice(1, 4).toString('ascii'), 'PNG');
  assert.ok(png.includes(Buffer.from('IHDR')) && png.includes(Buffer.from('IEND')));
  return true;
});

/* ----------------------------------------------------------- dem source -- */

await check('DEM tile names match the buckets that actually serve them', () => {
  // Verified live against prd-tnm and copernicus-dem-30m.
  assert.equal(tile3dep(39.3434, -84.267), 'n40w085');
  assert.equal(tile3dep(41.4822, -82.6832), 'n42w083');
  assert.equal(tileCop(39.3434, -84.267), 'N39_00_W085_00');
  assert.equal(tileCop(41.4822, -82.6832), 'N41_00_W083_00');
  return true;
});

await check('fitness reports whether a source resolves the grid it paints', () => {
  assert.equal(fitness(1, 6.5), 'resolves');
  assert.equal(fitness(10, 6.5), 'marginal');
  assert.equal(fitness(30, 6.5), 'coarse');
  return true;
});

await check('the resolver falls back, and null is an allowed answer', async () => {
  const bounds = { north: 1, south: 0, east: 1, west: 0 };
  const dead = () => { throw new Error('no coverage'); };
  assert.equal(await resolveDem(bounds, { openTiff: dead }), null);
  return true;
});

/* -------------------------------------------------------------- scatter -- */

await check('scatter is deterministic and seed-sensitive', () => {
  const cells = [];
  for (let y = 0; y < 30; y += 1) for (let x = 0; x < 30; x += 1) cells.push([x, y]);
  const species = [{ id: 'a', radius: 0.8, probability: 1 }];
  const a = scatterPoints({ cells, species, seed: 7 });
  const b = scatterPoints({ cells, species, seed: 7 });
  const c = scatterPoints({ cells, species, seed: 8 });
  assert.deepEqual(a.placed, b.placed);
  assert.notDeepEqual(a.placed, c.placed);
  return true;
});

await check('scattered sprites never overlap', () => {
  const cells = [];
  for (let y = 0; y < 24; y += 1) for (let x = 0; x < 24; x += 1) cells.push([x, y]);
  const { placed } = scatterPoints({
    cells, seed: 11, species: [{ id: 'a', radius: 0.9, probability: 1 }],
  });
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const d = Math.hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y);
      assert.ok(d > placed[i].radius + placed[j].radius, `overlap ${d}`);
    }
  }
  return true;
});

await check('noise sampling clusters more than uniform sampling', () => {
  const cells = [];
  for (let y = 0; y < 40; y += 1) for (let x = 0; x < 40; x += 1) cells.push([x, y]);
  const species = [{ id: 'a', radius: 0.9, probability: 1 }];
  const spread = (pts) => {
    const q = [0, 0, 0, 0];
    for (const p of pts) q[(p.y < 20 ? 0 : 2) + (p.x < 20 ? 0 : 1)] += 1;
    const m = pts.length / 4;
    return Math.sqrt(q.reduce((s, v) => s + (v - m) ** 2, 0) / 4) / m;
  };
  const noisy = scatterPoints({ cells, species, seed: 3 }).placed;
  const flat = scatterPoints({ cells, species, seed: 3, noise: null }).placed;
  assert.ok(spread(noisy) > spread(flat), 'noise should clump');
  return true;
});

await check('density falls out of sprite size, not a magic number', () => {
  const big = densityFromSpecies([{ id: 'a', radius: 2, probability: 1 }]);
  const small = densityFromSpecies([{ id: 'a', radius: 0.5, probability: 1 }]);
  assert.ok(small > big * 8, 'smaller sprites pack denser');
  return true;
});

await check('scatter reports what it could not place instead of silently capping', () => {
  const cells = [[0, 0], [0, 1], [1, 0], [1, 1]];
  const r = scatterPoints({
    cells, seed: 5, density: 50, species: [{ id: 'a', radius: 1.5, probability: 1 }],
  });
  assert.ok(r.dropped > 0 && r.requested > r.placed.length);
  return true;
});

await check('the RNG does not collapse along a diagonal', () => {
  // The trap: seeding on x+y gives every anti-diagonal one stream.
  const seen = new Set();
  for (let i = 0; i < 40; i += 1) seen.add(makeRng(i * 2654435761 % 2 ** 31).call());
  assert.ok(seen.size > 30, `only ${seen.size} distinct streams`);
  return true;
});

await check('noise is reproducible for a seed and different across seeds', () => {
  const a = makeNoise2D(42);
  const b = makeNoise2D(42);
  const c = makeNoise2D(43);
  assert.equal(a(1.5, 2.5), b(1.5, 2.5));
  assert.notEqual(a(1.5, 2.5), c(1.5, 2.5));
  return true;
});

/* ---------------------------------------------------------- constraints -- */

await check('a level cross-section flattens a path without flattening the park', () => {
  const cols = 30; const rows = 30;
  const v = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) v[r * cols + c] = 100 + 3 * Math.sin(c / 2);
  const g = new ElevationGrid({ cols, rows, cellSize: 5, values: v });
  const far = g.elevationAt(4, 4);
  const cg = new ConstraintGrid(g);
  const chain = [];
  for (let c = 5; c < 25; c += 0.5) {
    const n = cg.nodeHard(c, 15);
    chain.push(n);
    n.mustEqual(cg.nodeHard(c, 14.5));
    n.mustEqual(cg.nodeHard(c, 15.5));
  }
  cg.addSmoothSegment(chain, 8);
  const rough = (a) => a.slice(1).reduce((s, z, i) => s + Math.abs(z - a[i]), 0) / (a.length - 1);
  const before = []; for (let c = 6; c < 24; c += 1) before.push(g.elevationAt(c, 15));
  cg.solveAndApply({ iterations: 6 });
  const after = []; for (let c = 6; c < 24; c += 1) after.push(g.elevationAt(c, 15));
  assert.ok(rough(after) < rough(before), `${rough(after)} !< ${rough(before)}`);
  assert.ok(Math.abs(g.elevationAt(4, 4) - far) < 0.001, 'distant terrain must not move');
  return true;
});

await check('a lower-than chain runs downhill', () => {
  const g = new ElevationGrid({ cols: 10, rows: 10, cellSize: 5, values: new Float32Array(100).fill(50) });
  const cg = new ConstraintGrid(g);
  const a = cg.nodeSoft(2, 2); const b = cg.nodeSoft(4, 2); const c = cg.nodeSoft(6, 2);
  a.initial = 10; b.initial = 30; c.initial = 20;
  b.mustBeLowerThan(a); c.mustBeLowerThan(b);
  cg.solve();
  assert.ok(b.elevation <= a.elevation + 1e-9, `${b.elevation} !<= ${a.elevation}`);
  assert.ok(c.elevation <= b.elevation + 1e-9, `${c.elevation} !<= ${b.elevation}`);
  return true;
});

await check('a constraint cycle degrades to measurement instead of hanging', () => {
  const g = new ElevationGrid({ cols: 8, rows: 8, cellSize: 5, values: new Float32Array(64).fill(20) });
  const cg = new ConstraintGrid(g);
  const a = cg.nodeHard(1, 1); const b = cg.nodeHard(3, 1);
  a.mustBeLowerThan(b); b.mustBeLowerThan(a);
  cg.solve();
  assert.ok(Number.isFinite(a.elevation) && Number.isFinite(b.elevation));
  return true;
});

await check('nodes at the same spot merge, and hard beats soft', () => {
  const g = new ElevationGrid({ cols: 8, rows: 8, cellSize: 5, values: new Float32Array(64) });
  const cg = new ConstraintGrid(g);
  const soft = cg.nodeSoft(2, 2);
  const hard = cg.nodeHard(2.01, 2.01);
  assert.equal(soft, hard);
  assert.equal(hard.soft, false);
  return true;
});

/* ----------------------------------------------------------------- mesh -- */

await check('the mesh has one vertex per grid point and two faces per cell', () => {
  const g = ramp(6, 5, 10);
  const { obj } = meshFromGrid(g, { name: 't' });
  const count = (p) => obj.split('\n').filter((l) => l.startsWith(p)).length;
  assert.equal(count('v '), 30);
  assert.equal(count('f '), (6 - 1) * (5 - 1) * 2);
  return true;
});

await check('the mesh rests on zero and is deterministic', () => {
  const g = ramp(4, 4, 10);
  const a = meshFromGrid(g, { name: 't' }).obj;
  assert.equal(a, meshFromGrid(g, { name: 't' }).obj);
  const ys = a.split('\n').filter((l) => l.startsWith('v ')).map((l) => Number(l.split(' ')[2]));
  assert.equal(Math.min(...ys), 0);
  return true;
});

/* -------------------------------------------- regression: tiles-export -- */

await check('tiles-export emits features from the shipped ring shape (issue #504)', () => {
  const map = JSON.parse(readFileSync('apps/party-tracker/public/venues/kings-island.map.json', 'utf8'));
  const pois = JSON.parse(readFileSync('apps/party-tracker/public/venues/kings-island.pois.json', 'utf8'));
  const dir = '/tmp/parkbound-tiles-export-test';
  rmSync(dir, { recursive: true, force: true });
  exportTileGeoJson(dir, map, pois);
  let total = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.geojson'))) {
    total += JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')).features.length;
  }
  rmSync(dir, { recursive: true, force: true });
  // It read `way.p`, which shipped bundles have never carried, so this was 0.
  assert.ok(total > 500, `expected features, got ${total}`);
  return true;
});

await check('areas export as closed polygons, not open lines', () => {
  const map = { building: [{ r: [[0, 0], [1, 0], [1, 1], [0, 1]], n: 'hall' }] };
  const dir = '/tmp/parkbound-tiles-export-area';
  rmSync(dir, { recursive: true, force: true });
  exportTileGeoJson(dir, map, []);
  const j = JSON.parse(readFileSync(`${dir}/building.geojson`, 'utf8'));
  rmSync(dir, { recursive: true, force: true });
  assert.equal(j.features[0].geometry.type, 'Polygon');
  const ring = j.features[0].geometry.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1], 'ring must close');
  return true;
});

/* ------------------------------------------- truth/display separation --- */

await check('terrain rides in the spec without moving a Place', () => {
  const map = JSON.parse(readFileSync('apps/party-tracker/public/venues/kings-island.map.json', 'utf8'));
  const materials = readMaterials();
  const template = readSkinTemplates().trail;
  const b = map.meta.bounds;
  const terrain = {
    source: 'usgs-3dep', resolution: 10, cellMetres: 6.45, fitness: 'marginal',
    relief: { min: 1, max: 2 }, grid: { cols: 4, rows: 4 }, surfaceModel: false,
    hillshade: { file: 'hillshade.png', azimuth: 315, altitude: 45 },
    bounds: { north: b.north, south: b.south, east: b.east, west: b.west },
    steepDegrees: 18,
  };
  const spec = compileVisualSpec({ map, template, materials, terrain });
  const gate = certifyDisplayPack({ spec, map, template, materials })
    .checks.find((c) => c.key === 'no_repositioning');
  assert.equal(gate.pass, true, gate.evidence);
  return true;
});

await check('nudging a bound by a metre fails the gate', () => {
  const map = JSON.parse(readFileSync('apps/party-tracker/public/venues/kings-island.map.json', 'utf8'));
  const materials = readMaterials();
  const template = readSkinTemplates().trail;
  const b = map.meta.bounds;
  const spec = compileVisualSpec({
    map,
    template,
    materials,
    terrain: { bounds: { north: b.north + 0.00001, south: b.south, east: b.east, west: b.west } },
  });
  const gate = certifyDisplayPack({ spec, map, template, materials })
    .checks.find((c) => c.key === 'no_repositioning');
  assert.equal(gate.pass, false);
  return true;
});

await check('a coordinate smuggled under a non-obvious key still fails', () => {
  const map = JSON.parse(readFileSync('apps/party-tracker/public/venues/kings-island.map.json', 'utf8'));
  const materials = readMaterials();
  const template = readSkinTemplates().trail;
  const spec = compileVisualSpec({ map, template, materials });
  spec.tokens = { ...spec.tokens, center: [39.34, -84.26] };
  const gate = certifyDisplayPack({ spec, map, template, materials })
    .checks.find((c) => c.key === 'no_repositioning');
  assert.equal(gate.pass, false, 'a bare key blacklist would have passed this');
  return true;
});

/* ------------------------------------------------- material colour blend -- */

await check('mixHex blends, clamps, and leaves non-hex colours alone', () => {
  assert.equal(mixHex('#000000', '#FFFFFF', 0.5), '#808080');
  assert.equal(mixHex('#000000', '#FFFFFF', 0), '#000000');
  assert.equal(mixHex('#000000', '#FFFFFF', 1), '#FFFFFF');
  // Over- and under-shooting must not wrap round.
  assert.equal(mixHex('#000000', '#FFFFFF', 5), '#FFFFFF');
  assert.equal(mixHex('#FFFFFF', '#000000', 5), '#000000');
  // A skin using rgba() or a named colour keeps what it authored.
  assert.equal(mixHex('rgba(0,0,0,0.5)', '#FFFFFF', 0.5), 'rgba(0,0,0,0.5)');
  assert.equal(mixHex('#000000', 'nonsense', 0.5), '#000000');
  return true;
});

await check('a surface takes its material colour, blended toward the skin', () => {
  const map = JSON.parse(readFileSync('apps/party-tracker/public/venues/kings-island.map.json', 'utf8'));
  const materials = readMaterials();
  const template = readSkinTemplates().trail;
  const spec = compileVisualSpec({ map, template, materials });
  const veg = spec.surfaces.vegetation;
  const expected = mixHex(
    template.tokens.colors.grass,
    materials[veg.material].avgColor,
    template.materialMix ?? DEFAULT_MATERIAL_MIX,
  );
  assert.equal(veg.color, expected);
  assert.notEqual(veg.color, template.tokens.colors.grass, 'the material must actually move it');
  return true;
});

await check('a material with no harvested swatch leaves the skin token alone', () => {
  const map = JSON.parse(readFileSync('apps/party-tracker/public/venues/kings-island.map.json', 'utf8'));
  const template = readSkinTemplates().trail;
  const materials = readMaterials();
  const bare = Object.fromEntries(
    Object.entries(materials).map(([k, v]) => [k, { ...v, avgColor: undefined }]),
  );
  const spec = compileVisualSpec({ map, template, materials: bare });
  assert.equal(spec.surfaces.vegetation.color, template.tokens.colors.grass);
  return true;
});

await check('the style paints surface colours and falls back per layer', () => {
  const map = JSON.parse(readFileSync('apps/party-tracker/public/venues/kings-island.map.json', 'utf8'));
  const materials = readMaterials();
  const template = readSkinTemplates().trail;
  // The Zone wash needs the World's relationships — its land cover and its
  // grounding harvest. Truth no longer carries a tint to fall back on.
  const spec = compileVisualSpec({
    map,
    template,
    materials,
    landCover: readLandCover('kings-island'),
    grounding: readGrounding('kings-island'),
  });
  const style = styleFromSpec(spec);
  const paintOf = (id) => style.layers.find((l) => l.id === id)?.paint;
  assert.equal(paintOf('grass')['fill-color'], spec.surfaces.vegetation.color);
  assert.equal(paintOf('water')['fill-color'], spec.surfaces.water.color);
  // `lands` is a Zone wash, not a surface class — it keeps its own expression.
  assert.ok(Array.isArray(paintOf('lands')['fill-color']));
  // background is a token, never a material.
  assert.equal(paintOf('background')['background-color'], template.tokens.colors.ground);
  return true;
});

await check('a layer no surface claims still gets a colour', () => {
  const map = JSON.parse(readFileSync('apps/party-tracker/public/venues/kings-island.map.json', 'utf8'));
  const template = readSkinTemplates().trail;
  const spec = compileVisualSpec({ map, template, materials: {} });
  const style = styleFromSpec(spec);
  for (const layer of style.layers) {
    const paint = layer.paint || {};
    const colour = paint['fill-color'] ?? paint['line-color'] ?? paint['background-color'];
    if (colour === undefined) continue;
    assert.ok(colour !== null, `${layer.id} has a null colour`);
  }
  return true;
});

/* ------------------------------------------------------------ bake bits -- */

await check('crownStipple spills vegetation onto open ground, never onto a path', () => {
  const T = { outside: 0, ground: 1, grass: 2, wood: 3, water: 4, lot: 5, road: 6, service: 7 };
  const cols = 20; const rows = 20;
  const cells = new Array(cols * rows).fill(T.ground);
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < 8; x += 1) cells[y * cols + x] = T.wood;
  // A road hard against the wood edge must survive untouched.
  for (let y = 0; y < rows; y += 1) cells[y * cols + 9] = T.road;
  const before = cells.slice();
  crownStipple(cells, cols, rows);
  const roadKept = cells.every((v, i) => (before[i] === T.road ? v === T.road : true));
  assert.ok(roadKept, 'stipple must not paint over a road');
  const spilled = cells.filter((v, i) => before[i] === T.ground && v === T.wood).length;
  assert.ok(spilled > 0, 'expected some spill onto open ground');
  const deep = cells[10 * cols + 18];
  assert.equal(deep, T.ground, 'ground far from vegetation is untouched');
  return true;
});

await check('crownStipple is deterministic', () => {
  const cols = 12; const rows = 12;
  const seed = () => {
    const c = new Array(cols * rows).fill(1);
    for (let y = 0; y < rows; y += 1) for (let x = 0; x < 5; x += 1) c[y * cols + x] = 3;
    return c;
  };
  const a = seed(); crownStipple(a, cols, rows);
  const b = seed(); crownStipple(b, cols, rows);
  assert.deepEqual(a, b);
  return true;
});

await check('seedFromString separates the strings the bake actually uses', () => {
  const seeds = ['kings-island:wood', 'kings-island:grass', 'cedar-point:wood', 'cedar-point:grass']
    .map(seedFromString);
  assert.equal(new Set(seeds).size, seeds.length, 'adjacent kind strings must not collide');
  assert.equal(seedFromString('a'), seedFromString('a'));
  assert.ok(seeds.every(Number.isInteger));
  return true;
});

/* --------------------------------------------------- review gate plumbing -- */

await check('the standards-review context survives a diff larger than 1 MB', () => {
  // It buffered the whole branch patch with node's 1 MB default, so any branch
  // big enough (or carrying one binary asset) died on `spawnSync git ENOBUFS`
  // after the app build had already run.
  //
  // Built on a scratch repo whose diff is deliberately over that line. Pointing
  // this at the ambient branch proved nothing — it passes on any small diff, and
  // it needs an `origin/main` ref that a shallow CI checkout does not have, which
  // is exactly how it failed on GitHub while passing everywhere else.
  const dir = mkdtempSync(join(tmpdir(), 'review-enobufs-'));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: dir,
      env: scrubGitEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  try {
    git('init', '-q', '-b', 'base');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(dir, 'seed.txt'), 'seed\n');
    git('add', '.');
    git('commit', '-qm', 'base');

    git('checkout', '-qb', 'feature');
    // ~2.9 MB of distinct text lines, so the *patch* clears 1 MB rather than
    // just the blob — the patch is what gets buffered.
    const lines = Array.from({ length: 60_000 }, (_, i) => `line ${i} ${'x'.repeat(40)}`);
    writeFileSync(join(dir, 'big.txt'), `${lines.join('\n')}\n`);
    git('add', '.');
    git('commit', '-qm', 'big');

    const ctx = buildMattReviewContext({ baseRef: 'base', cwd: dir });
    assert.deepEqual(ctx.files, ['big.txt']);
    assert.equal(ctx.diffHash.length, 16);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return true;
});

await check('natural surfaces carry a steep variant; made ones do not', () => {
  // The bake computes a `steep` channel per cell whenever a venue has a DEM.
  // If no piece declares a steep variant the channel is dead weight, so the
  // vocabulary carries the default and kits inherit it.
  for (const name of ['grass', 'wood', 'ground']) {
    assert.ok(TERRAIN_PIECES[name].steep?.base, `${name} should have a steep variant`);
    assert.notEqual(TERRAIN_PIECES[name].steep.base, TERRAIN_PIECES[name].base);
  }
  // A road on a slope is still a road.
  for (const name of ['road', 'service', 'water', 'lot']) {
    assert.equal(TERRAIN_PIECES[name].steep, undefined, `${name} should not vary by slope`);
  }
  return true;
});

await check('a kit inherits steep variants and can override them', () => {
  const assets = JSON.parse(readFileSync('packages/venue-builder/data/display/assets.json', 'utf8')).assets;
  const kit = JSON.parse(readFileSync('packages/venue-builder/data/display/kits/rpg-overworld.json', 'utf8'));
  assert.equal(resolveKit(kit, { assets }).terrain.grass.steep.base, TERRAIN_PIECES.grass.steep.base);
  const overridden = resolveKit(
    { ...kit, terrain: { ...kit.terrain, grass: { ...kit.terrain.grass, steep: { base: '#123456' } } } },
    { assets },
  );
  assert.equal(overridden.terrain.grass.steep.base, '#123456');
  return true;
});

await check('terrain and the solver default on, and --no-* still turns them off', () => {
  // The flag used to be parsed and then dropped, so it ran the whole pipeline
  // and produced flat venues without ever saying it had ignored you. Now the
  // capability is the default and the *opt-out* is the thing that must survive
  // the trip — a dropped --no-terrain would silently do more, not less.
  const bare = pipelineOptsFromCatalogArgs(parseCatalogArgs(['--display']));
  assert.equal(bare.terrain, true, 'a bare --display run should produce what ships');
  assert.equal(bare.constrain, true);
  assert.equal(bare.display, true);

  const off = pipelineOptsFromCatalogArgs(parseCatalogArgs(['--display', '--no-terrain', '--no-constrain']));
  assert.equal(off.terrain, false);
  assert.equal(off.constrain, false);

  // The positive forms still parse, so older invocations keep working.
  const explicit = pipelineOptsFromCatalogArgs(parseCatalogArgs(['--display', '--terrain', '--constrain']));
  assert.equal(explicit.terrain, true);
  assert.equal(explicit.constrain, true);

  // Mesh defaults by scale, not by which CLI was typed: one venue gets a mesh
  // (matching venues:display for that same venue), a 100-park catalog batch
  // does not. Keying this off the CLI meant build-venue --pipeline built one
  // venue with mesh off while venues:display built it with mesh on.
  const one = parseCatalogArgs(['--display']);
  assert.equal(pipelineOptsFromCatalogArgs(one).mesh, true, 'a single venue gets a mesh');
  assert.equal(pipelineOptsFromCatalogArgs(one, { batch: true }).mesh, false,
    'a catalog batch does not');

  // An explicit flag beats the scale default in both directions.
  const forced = parseCatalogArgs(['--display', '--mesh']);
  assert.equal(pipelineOptsFromCatalogArgs(forced, { batch: true }).mesh, true);
  const refused = parseCatalogArgs(['--display', '--no-mesh']);
  assert.equal(pipelineOptsFromCatalogArgs(refused).mesh, false);
  return true;
});

await check('a typo\'d capability flag is rejected, not silently ignored', () => {
  // With capabilities on by default, an ignored `--no-tile` does *more* than
  // asked while looking like it obeyed. Unknown flags must stop the run.
  const run = (args) => {
    try {
      execFileSync(process.execPath, ['packages/venue-builder/bin/display-pack.mjs', ...args], {
        env: scrubGitEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, stderr: '' };
    } catch (e) {
      return { status: e.status, stderr: String(e.stderr || '') };
    }
  };
  const typo = run(['big-kahunas', '--no-tile']);
  assert.equal(typo.status, 2, 'a typo must exit non-zero');
  assert.match(typo.stderr, /unknown flag\(s\) --no-tile/);
  assert.match(typo.stderr, /--no-tiles/, 'the error should name the real flag');

  // A run with no targets still prints usage rather than the unknown-flag error.
  assert.equal(run(['--no-tiles']).status, 2);
  return true;
});

await check('an absent tiler is a gap; a broken one is still a failure', () => {
  // Defaulting --tiles on would have failed certification for every venue on
  // every machine without tippecanoe — a `wrap` dependency CI does not install.
  // The gate now distinguishes "the toolchain cannot answer" from "this venue's
  // tiles are wrong", so softening it must not have cost it its teeth. Driven
  // through the exported gate, not a local restatement of it: the first version
  // of this test hardcoded an 8 MB budget while the real one is 15 MB, and
  // passed anyway.
  assert.equal(tilesGatePasses({ ok: false, gap: true, reason: 'tippecanoe not installed' }), true,
    'a missing tiler is a recorded gap');
  assert.equal(tilesGatePasses({ ok: false, reason: 'tippecanoe exited 1: bad geometry' }), false,
    'a tiler that ran and failed is still a failure');
  assert.equal(tilesGatePasses({ ok: true, sizeKb: 16 * 1024 }), false,
    'an archive over the 15 MB budget is still a failure');
  assert.equal(tilesGatePasses({ ok: true, sizeKb: 15 * 1024 }), true, 'exactly at budget passes');
  assert.equal(tilesGatePasses({ ok: true, sizeKb: 512 }), true);
  return true;
});

await check('a typo\'d capability flag is rejected, not silently ignored', () => {
  // With capabilities on by default, an ignored `--no-tile` does *more* than
  // asked while looking like it obeyed. Unknown flags must stop the run.
  const run = (args) => {
    try {
      execFileSync(process.execPath, ['packages/venue-builder/bin/display-pack.mjs', ...args], {
        env: scrubGitEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, stderr: '' };
    } catch (e) {
      return { status: e.status, stderr: String(e.stderr || '') };
    }
  };
  const typo = run(['big-kahunas', '--no-tile']);
  assert.equal(typo.status, 2, 'a typo must exit non-zero');
  assert.match(typo.stderr, /unknown flag\(s\) --no-tile/);
  assert.match(typo.stderr, /--no-tiles/, 'the error should name the real flag');

  // A run with no targets still prints usage rather than the unknown-flag error.
  assert.equal(run(['--no-tiles']).status, 2);
  return true;
});

await check('rows follow the long axis, stay inside, and report that axis', () => {
  const ring = [[0, 0], [40, 0], [40, 8], [0, 8]];
  const { placed, axis } = fillRows({ ring, rowSpacing: 3, itemSpacing: 5, id: 'aisle' });
  assert.ok(placed.length > 0);
  assert.ok(placed.every((p) => p.x >= 0 && p.x <= 40 && p.y >= 0 && p.y <= 8));
  // The long axis of a 40x8 box is horizontal.
  assert.ok(Math.abs(axis.ax) > Math.abs(axis.ay), 'axis should follow the long side');
  return true;
});

await check('rows honour a reject, so a lot cannot stripe over a building', () => {
  const ring = [[0, 0], [30, 0], [30, 12], [0, 12]];
  const all = fillRows({ ring, rowSpacing: 3, itemSpacing: 3, id: 'a' }).placed.length;
  const half = fillRows({
    ring, rowSpacing: 3, itemSpacing: 3, id: 'a', reject: (x) => x > 15,
  }).placed.length;
  assert.ok(half > 0 && half < all, `${half} should be a strict subset of ${all}`);
  return true;
});

await check('parking aisles land on lot cells and nowhere else', () => {
  const map = JSON.parse(readFileSync('apps/party-tracker/public/venues/kings-island.map.json', 'utf8'));
  const pois = JSON.parse(readFileSync('apps/party-tracker/public/venues/kings-island.pois.json', 'utf8'));
  const model = bakeModel(map, pois);
  assert.ok(model.lotRows.length > 0, 'Kings Island has parking; it should have aisles');
  const lotId = Number(Object.entries(model.terrains).find(([, n]) => n === 'lot')[0]);
  for (const r of model.lotRows) {
    const cx = Math.round(r.x);
    const cy = Math.round(r.y);
    assert.equal(model.cells[cy * model.cols + cx], lotId, `aisle mark off-lot at ${cx},${cy}`);
    assert.ok(Math.abs(Math.hypot(r.dx, r.dy) - 1) < 1e-6, 'direction must be a unit vector');
  }
  return true;
});

await check('a venue with no parking gets no aisles, not an empty-array crash', () => {
  const map = JSON.parse(readFileSync('apps/party-tracker/public/venues/big-kahunas.map.json', 'utf8'));
  const model = bakeModel(map, []);
  assert.equal((map.parking || []).length, 0);
  assert.deepEqual(model.lotRows, []);
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
