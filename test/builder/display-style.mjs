#!/usr/bin/env node
/**
 * Style contract — truth-derived sampling holds bakes to their profiles.
 * All pure: a synthetic model and fabricated samples, no Chromium.
 *
 *   node test/builder/display-style.mjs
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

console.log('\nstyle contract\n');

const {
  stylePoints, certifyStyleContract, harvestProfileDraft, deltaE, hexToRgb, signature,
} = await import('../../packages/venue-builder/lib/display-style-contract.mjs');

// A 12x12 synthetic world: outside frame, ground floor, quadrant patches of
// grass / water / lot / road, one building, one track, two badges.
const T = { outside: 0, ground: 1, grass: 2, wood: 3, water: 4, lot: 5, road: 6, service: 7 };
const COLS = 12;
const ROWS = 12;
const cells = new Array(COLS * ROWS).fill(T.ground);
for (let y = 0; y < ROWS; y += 1) {
  for (let x = 0; x < COLS; x += 1) {
    if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) cells[y * COLS + x] = T.outside;
  }
}
const patch = (x0, y0, x1, y1, t) => {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) cells[y * COLS + x] = t;
};
// quadrant patches leave a 2-wide ground cross so every class has interior cells
patch(1, 1, 4, 4, T.grass);
patch(7, 1, 10, 4, T.road);
patch(1, 7, 4, 10, T.lot);
patch(7, 7, 10, 10, T.water);
const model = {
  cols: COLS,
  rows: ROWS,
  cells,
  terrains: { 0: 'outside', 1: 'ground', 2: 'grass', 3: 'wood', 4: 'water', 5: 'lot', 6: 'road', 7: 'service' },
  buildings: [{ ring: [[2, 2], [4, 2], [4, 4], [2, 4]], roof: 0 }],
  tracks: [{ kind: 'slide', idx: 0, pts: [[7, 2], [8, 2], [9, 3], [10, 3]] }],
  roads: [{ kind: 'path', pts: [[6, 2], [7, 2], [8, 3], [9, 3]] }],
  badges: [{ kind: 'gate', x: 3, y: 8 }, { kind: 'food', x: 8, y: 8 }],
};

const PALETTE = {
  outside: '#6B4E9B', ground: '#EBD9A4', grass: '#8CBE74', water: '#4FB8D4',
  lot: '#B3AC9D', road: '#5A5F6E', structure: '#CFC2A8', badge: '#D84B4B',
  track: '#F4C542', trackedge: '#FFFFFF', roadline: '#D3D7DE',
};

const paint = (points, overrides = {}) => points.map((p) => {
  const key = overrides[p.cls] !== undefined ? null : p.cls;
  const hex = key ? PALETTE[key] : overrides[p.cls];
  return [...hexToRgb(hex ?? PALETTE[p.cls]), 255];
});

const profile = {
  version: 1,
  id: 'test-profile',
  kit: 'test-kit',
  style: 'test',
  colorFamilies: {
    ground: { anchor: '#EBD9A4', deltaE: 10 },
    grass: { anchor: '#8CBE74', deltaE: 10 },
    water: { anchor: '#4FB8D4', deltaE: 10 },
    lot: { anchor: '#B3AC9D', deltaE: 10 },
    road: { anchor: '#5A5F6E', deltaE: 10 },
    outside: { anchor: '#6B4E9B', deltaE: 10 },
    structure: { anchor: '#CFC2A8', deltaE: 12 },
    badge: { anchor: '#D84B4B', deltaE: 10 },
  },
  roads: { vsGround: { minDeltaE: 15, polarity: 'darker' } },
  ground: { outsideVsInside: { minDeltaE: 15 }, waterVsVegetation: { minDeltaE: 15 } },
  structures: { buildingStyle: 'drop', coasterVsUnderlay: { minDeltaE: 10 } },
  hierarchy: { annotationOnTop: true, oneBadgePerPoi: true },
  agentReview: ['same genre as the reference?'],
};
const kit = { id: 'test-kit' };

await check('stylePoints is deterministic, interior-only, class-correct', () => {
  const a = stylePoints(model, { perClass: 8 });
  const b = stylePoints(model, { perClass: 8 });
  assert.deepEqual(a, b, 'same plan every run');
  const at = (x, y) => model.cells[Math.floor(y) * COLS + Math.floor(x)];
  for (const p of a.filter((q) => q.cls in T)) {
    assert.equal(model.terrains[at(p.x, p.y)], p.cls, `point class mismatch at ${p.x},${p.y}`);
  }
  const grassCount = a.filter((p) => p.cls === 'grass').length;
  assert.ok(grassCount > 0 && grassCount <= 8, 'perClass respected');
  assert.ok(a.some((p) => p.cls === 'structure' && p.mode === 'interior'), 'building interior sampled');
  assert.ok(a.some((p) => p.cls === 'track'), 'track sampled');
  assert.ok(a.some((p) => p.cls === 'badge'), 'badge sampled');
  return true;
});

await check('a faithful bake certifies; palette drift fails with the worst class named', () => {
  const points = stylePoints(model, { perClass: 8 });
  const good = certifyStyleContract({ model, points, samples: paint(points), profile, kit });
  assert.equal(good.certified, true, JSON.stringify(good.checks.filter((c) => !c.pass)));
  const drifted = certifyStyleContract({
    model, points, samples: paint(points, { water: '#88CC88' }), profile, kit,
  });
  const palette = drifted.checks.find((c) => c.key === 'style_terrain_palette');
  assert.equal(palette.pass, false);
  assert.match(palette.evidence, /water/);
  return true;
});

await check('road-hierarchy polarity flips fail', () => {
  const points = stylePoints(model, { perClass: 8 });
  const light = certifyStyleContract({
    model,
    points,
    samples: paint(points, { road: '#F8F4E4' }),
    profile: { ...profile, colorFamilies: { ...profile.colorFamilies, road: { anchor: '#F8F4E4', deltaE: 10 } } },
    kit,
  });
  assert.equal(light.checks.find((c) => c.key === 'style_road_hierarchy').pass, false, 'lighter-than-ground road with polarity darker');
  return true;
});

await check('an under-painted badge fails annotation-on-top', () => {
  const points = stylePoints(model, { perClass: 8 });
  const buried = certifyStyleContract({
    model, points, samples: paint(points, { badge: PALETTE.lot }), profile, kit,
  });
  assert.equal(buried.checks.find((c) => c.key === 'style_annotation_on_top').pass, false);
  return true;
});

await check('near-monochrome styles certify via the centerline rule', () => {
  const paper = '#FBF7EC';
  const inkProfile = {
    ...profile,
    colorFamilies: {
      ...profile.colorFamilies,
      ground: { anchor: paper, deltaE: 8 },
      road: { anchor: paper, members: ['#39567E'], deltaE: 8 },
    },
    roads: { centerlineVsPaper: { minDeltaE: 25 } },
    ground: { outsideVsInside: { minDeltaE: 2 }, waterVsVegetation: { minDeltaE: 2 } },
  };
  const points = stylePoints(model, { perClass: 8 });
  const res = certifyStyleContract({
    model,
    points,
    samples: paint(points, { road: paper, ground: paper, roadline: '#39567E', outside: '#EFEAD9' }),
    profile: { ...inkProfile, colorFamilies: { ...inkProfile.colorFamilies, outside: { anchor: '#EFEAD9', deltaE: 8 } } },
    kit,
  });
  const road = res.checks.find((c) => c.key === 'style_road_hierarchy');
  assert.equal(road.pass, true, road.evidence);
  return true;
});

await check('agent items ride review, never checks; certified ignores them', () => {
  const points = stylePoints(model, { perClass: 8 });
  const res = certifyStyleContract({ model, points, samples: paint(points), profile, kit });
  assert.equal(res.review.length, 1);
  assert.equal(res.review[0].key, 'style_reference_resemblance');
  assert.ok(!res.checks.some((c) => c.key === 'style_reference_resemblance'));
  return true;
});

await check('signature and harvest are stable and honest', () => {
  const points = stylePoints(model, { perClass: 8 });
  const samples = paint(points);
  assert.equal(signature(samples), signature(paint(points)), 'same pixels, same signature');
  assert.notEqual(signature(samples), signature(paint(points, { water: '#88CC88' })));
  const draft = harvestProfileDraft({ points, samples });
  assert.equal(draft.draft, true);
  assert.ok(deltaE(hexToRgb(draft.water.anchor), hexToRgb(PALETTE.water)) < 1, 'harvested anchor is the measured median');
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
