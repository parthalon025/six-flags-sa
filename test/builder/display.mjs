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
  runDisplayStage,
} = await import('../../packages/venue-builder/lib/display-pack.mjs');
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
  water: [{ r: [[2, 2], [3, 3]] }],
  building: [],
};
const FIXTURE_POIS = [
  { i: 'front-gate', n: 'Front Gate', c: 'gate', lat: 1, lng: 2 },
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
