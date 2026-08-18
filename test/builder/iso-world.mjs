#!/usr/bin/env node
/**
 * Shared iso world module — template registry, deterministic mesh assembly,
 * ground-space culling, dedup pickers, and the four quarter-turn views.
 *
 *   node test/builder/iso-world.mjs
 */
import assert from 'node:assert/strict';

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

console.log('\niso world\n');

const {
  ISO_ROTATIONS,
  ISO_MAP_TEMPLATES,
  assembleIsoMeshes,
  pickCoasterLines,
  pickWalkways,
  resolveIsoMapTemplate,
} = await import('../../packages/shared/isoWorld.js');

await check('rct-classic resolves with its documented defaults', () => {
  const recipe = resolveIsoMapTemplate('rct-classic');
  assert.equal(recipe.id, 'rct-classic');
  assert.equal(recipe.coasterBaseM, 3);
  assert.equal(recipe.coasterHeightAmp, 9);
  assert.equal(recipe.coasterStepM, 6);
  assert.equal(recipe.buildingTrackPadM, 10);
  assert.equal(recipe.liftedTrackPadM, 8);
  assert.equal(typeof recipe.buildingHeightM, 'function');
  assert.equal(resolveIsoMapTemplate('no-such-skin'), ISO_MAP_TEMPLATES['rct-classic'], 'unknown id falls back');
  return true;
});

await check('an object template overrides fields without losing the base recipe', () => {
  const recipe = resolveIsoMapTemplate({ id: 'sparse-demo', coasterStepM: 30 });
  assert.equal(recipe.id, 'sparse-demo');
  assert.equal(recipe.coasterStepM, 30, 'override wins');
  assert.equal(recipe.coasterBaseM, 3, 'unset fields inherit rct-classic');
  assert.equal(typeof recipe.buildingHeightM, 'function');
  return true;
});

const stallRing = [
  [200, 200],
  [204, 200],
  [204, 204],
  [200, 204],
];
const hallRing = [
  [120, 40],
  [140, 40],
  [140, 56],
  [124, 62],
];
const rideLine = [
  [0, 0],
  [20, 4],
  [40, 0],
  [60, 6],
];

await check('assembleIsoMeshes is deterministic — two identical calls match deeply', () => {
  const opts = { maxBuildings: 10, maxTracks: 5 };
  const first = assembleIsoMeshes([stallRing, hallRing], [rideLine], opts);
  const second = assembleIsoMeshes([stallRing, hallRing], [rideLine], opts);
  assert.deepEqual(first, second);
  assert.equal(first.buildings.length, 2);
  assert.equal(first.tracks.length, 1);
  return true;
});

await check('a ride-envelope ring is culled, the free-standing stall survives', () => {
  const envelope = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ];
  const covered = [
    [10, 10],
    [20, 10],
    [30, 10],
    [40, 10],
    [50, 10],
  ];
  const meshes = assembleIsoMeshes([envelope, stallRing], [covered]);
  assert.equal(meshes.buildings.length, 1);
  assert.equal(meshes.buildings[0].i, 1);
  return true;
});

await check('a building beside a rail is culled, the far stall survives', () => {
  const hallAlong = [
    [20, 3],
    [40, 3],
    [40, 20],
    [20, 20],
  ];
  const longRail = [
    [0, 0],
    [100, 0],
  ];
  const meshes = assembleIsoMeshes([hallAlong, stallRing], [longRail]);
  assert.equal(meshes.buildings.length, 1);
  assert.equal(meshes.buildings[0].i, 1);
  return true;
});

await check('pickCoasterLines drops the hugging rail and keeps the far stretch', () => {
  const picked = pickCoasterLines([
    { r: [[0, 1], [40, 1]], n: 'The Beast', i: 0 },
    { r: [[0, 0], [40, 0], [80, 0]], n: 'The Beast', i: 1 },
    { r: [[200, 0], [240, 0], [280, 0]], n: 'The Beast', i: 2 },
  ]);
  assert.equal(picked.length, 2);
  assert.ok(picked.some((p) => p.i === 1));
  assert.ok(picked.some((p) => p.i === 2));
  assert.ok(!picked.some((p) => p.i === 0));
  return true;
});

await check('pickWalkways collapses parallel footways to one line', () => {
  const walks = pickWalkways([
    [[0, 0], [50, 0]],
    [[0, 1], [50, 1]],
    [[0, 30], [50, 30]],
  ]);
  assert.equal(walks.length, 2);
  assert.ok(walks.some((w) => w.i === 0));
  assert.ok(walks.some((w) => w.i === 2));
  assert.ok(!walks.some((w) => w.i === 1));
  return true;
});

await check('four rotations paint distinct geometry while culling stays put', () => {
  const views = [];
  for (let r = 0; r < ISO_ROTATIONS; r += 1) {
    views.push(assembleIsoMeshes([stallRing, hallRing], [rideLine], { rotation: r }));
  }
  const [base] = views;
  for (const view of views) {
    assert.equal(view.buildings.length, base.buildings.length, 'building count is rotation-invariant');
    assert.equal(view.tracks.length, base.tracks.length, 'track count is rotation-invariant');
  }
  const roofs = new Set(views.map((v) => v.buildings[0].roof.d));
  const rails = new Set(views.map((v) => v.tracks[0].track.d));
  assert.equal(roofs.size, ISO_ROTATIONS, 'each rotation draws a distinct roof');
  assert.equal(rails.size, ISO_ROTATIONS, 'each rotation draws a distinct rail');
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
