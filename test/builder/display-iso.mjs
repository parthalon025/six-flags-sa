#!/usr/bin/env node
/**
 * Iso bake tier — pure geometry assembly, the cell→pixel projection seam,
 * the iso sample plan (with on-the-record skips), and the profile iso
 * block. No browser: the painter page consumes what these functions emit.
 *
 *   node test/builder/display-iso.mjs
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

console.log('\niso bake tier\n');

const {
  isoCellMap, isoCellToPixel, isoBakeGeometry, buildingHeightsM, trackVertexHeightsM, cellToWorld, shade,
  buildingScreenHulls, occludedByBuilding,
} = await import('../../packages/venue-builder/lib/display-iso.mjs');
const { isoLocal, isoInverse, ISO_ROTATIONS } = await import('../../packages/shared/isoWorld.js');
const { stylePoints, isoStylePoints, certifyStyleContract, hexToRgb, STARVED_MIN_KEPT } = await import(
  '../../packages/venue-builder/lib/display-style-contract.mjs'
);
const { resolveKit } = await import('../../packages/venue-builder/lib/display-bake.mjs');
const { profileForKit, validateProfile } = await import(
  '../../packages/venue-builder/lib/display-references.mjs'
);

// Synthetic model in the bakeModel shape: 12x12 grid, 4 m cells, one
// building, one long slide (long enough to climb and drop), badges.
const T = { outside: 0, ground: 1, grass: 2, wood: 3, water: 4, lot: 5, road: 6, service: 7 };
const COLS = 12;
const ROWS = 12;
const cells = new Array(COLS * ROWS).fill(T.ground);
for (let y = 0; y < ROWS; y += 1) {
  for (let x = 0; x < COLS; x += 1) {
    if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) cells[y * COLS + x] = T.outside;
  }
}
for (let y = 7; y <= 10; y += 1) for (let x = 7; x <= 10; x += 1) cells[y * COLS + x] = T.water;
const slidePts = [];
for (let i = 0; i <= 9; i += 1) slidePts.push([1 + i, 2 + (i % 2) * 0.2]); // ~36 m travelled at 4 m cells
const model = {
  cols: COLS,
  rows: ROWS,
  tileMetres: 4,
  cells,
  terrains: { 0: 'outside', 1: 'ground', 2: 'grass', 3: 'wood', 4: 'water', 5: 'lot', 6: 'road', 7: 'service' },
  buildings: [{ ring: [[3, 5], [6, 5], [6, 8], [3, 8]], roof: 1 }],
  tracks: [{ kind: 'slide', idx: 0, pts: slidePts }],
  roads: [{ kind: 'path', pts: [[1, 10], [10, 10]] }],
  trees: [{ x: 2.3, y: 6.4, big: true }, { x: 9.1, y: 3.2, big: false }],
  badges: [{ kind: 'gate', x: 5, y: 10 }, { kind: 'food', x: 8, y: 4 }],
};
const kit = resolveKit({ id: 'test-kit' });

await check('cell→pixel agrees with isoLocal and round-trips at every rotation', () => {
  const t = model.tileMetres;
  for (let r = 0; r < ISO_ROTATIONS; r += 1) {
    const map = isoCellMap(model, { rotation: r, px: 16 });
    for (const [cx, cy] of [[0, 0], [COLS, 0], [3.25, 7.5], [COLS, ROWS]]) {
      const iso = isoLocal(cx * t, -cy * t, r);
      const [sx, sy] = isoCellToPixel(map, cx, cy, 0);
      assert.ok(Math.abs(sx - (map.ox + iso.x * map.hs)) < 1e-9, `x agrees with isoLocal at r${r}`);
      assert.ok(Math.abs(sy - (map.oy - iso.y * map.hs)) < 1e-9, `y agrees with isoLocal at r${r}`);
      // round trip: pixel → iso metres → isoInverse → world → cell
      const { dx, dy } = isoInverse((sx - map.ox) / map.hs, (map.oy - sy) / map.hs, r);
      assert.ok(Math.abs(dx / t - cx) < 1e-9 && Math.abs(-dy / t - cy) < 1e-9, `round trip at r${r}`);
      assert.ok(sx >= 0 && sx <= map.width && sy >= 0 && sy <= map.height, `grid inside canvas at r${r}`);
    }
    // a metre of lift moves the pixel straight up by hs
    const [, syGround] = isoCellToPixel(map, 4, 4, 0);
    const [, syUp] = isoCellToPixel(map, 4, 4, 10);
    assert.ok(Math.abs((syGround - syUp) - 10 * map.hs) < 1e-9, 'lift is vertical, hs px per metre');
  }
  const pixels = new Set();
  for (let r = 0; r < ISO_ROTATIONS; r += 1) {
    const map = isoCellMap(model, { rotation: r, px: 16 });
    const [sx, sy] = isoCellToPixel(map, 3, 7, 0);
    pixels.add(`${(sx - map.ox).toFixed(4)},${(sy - map.oy).toFixed(4)}`);
  }
  assert.equal(pixels.size, ISO_ROTATIONS, 'an asymmetric cell projects distinctly per rotation');
  return true;
});

await check('heights: buildings from world-metre area, tracks from the shared sin-hill', () => {
  const heights = buildingHeightsM(model);
  assert.equal(heights.length, 1);
  // 3x3 cells at 4 m = 144 m² → the 50..250 m² band = 10 m
  assert.equal(heights[0], 10);
  const vh = trackVertexHeightsM(model);
  assert.equal(vh[0].length, slidePts.length);
  assert.ok(vh[0].every((h) => h >= 3 && h <= 12), 'rct-classic base 3, amp 9');
  assert.ok(new Set(vh[0].map((h) => h.toFixed(3))).size > 1, 'the hill actually varies');
  assert.deepEqual(vh, trackVertexHeightsM(model), 'deterministic');
  return true;
});

await check('isoBakeGeometry is deterministic, depth-sorted, and rotation-distinct', () => {
  const a = isoBakeGeometry(model, kit, { rotation: 0, px: 16 });
  const b = isoBakeGeometry(model, kit, { rotation: 0, px: 16 });
  assert.deepEqual(a, b, 'same model, same kit, same bytes');
  assert.equal(a.items.filter((i) => i.type === 'building').length, model.buildings.length);
  assert.equal(a.items.filter((i) => i.type === 'track').length, model.tracks.length);
  assert.equal(a.items.filter((i) => i.type === 'tree').length, model.trees.length);
  for (let i = 1; i < a.items.length; i += 1) {
    assert.ok(a.items[i - 1].depth >= a.items[i].depth, 'items paint far → near');
  }
  assert.equal(a.badges.length, model.badges.length);
  const roofs = new Set();
  for (let r = 0; r < ISO_ROTATIONS; r += 1) {
    roofs.add(isoBakeGeometry(model, kit, { rotation: r, px: 16 }).items.find((i) => i.type === 'building').roof.d);
  }
  assert.equal(roofs.size, ISO_ROTATIONS, 'each rotation extrudes a distinct roof');
  return true;
});

await check('track items carry kit styling and climb/drop emphasis from isoTrack', () => {
  const geo = isoBakeGeometry(model, kit, { rotation: 0, px: 16 });
  const track = geo.items.find((i) => i.type === 'track');
  assert.equal(track.kind, 'slide');
  assert.equal(track.color, kit.sprites.slide.colors[0]);
  assert.equal(track.casing, kit.sprites.slide.casing);
  assert.ok(track.supports.length > 0, 'posts hold the rail up');
  assert.ok(track.emphasis.length > 0, '36 m of rct-classic hill must climb and drop');
  assert.ok(track.emphasis.every((e) => e.kind === 'climb' || e.kind === 'drop'));
  assert.ok(track.emphasis.every((e) => e.d.startsWith('M')), 'emphasis paths are path data');
  assert.ok(track.w.emphasis > track.w.fill, 'emphasis reads heavier than the fill');
  return true;
});

await check('shade darkens hex deterministically for wall faces', () => {
  assert.equal(shade('#808080', 0.5), '#404040');
  assert.equal(shade('#fff', 1), '#FFFFFF');
  assert.deepEqual(cellToWorld([2, 3], 4), [8, -12], 'cell y flips to north-up metres');
  return true;
});

await check('isoStylePoints keeps the truth-derived plan, re-projected', () => {
  const points = stylePoints(model, { perClass: 8 });
  const plan = isoStylePoints(model, points, { rotation: 0, px: 16 });
  assert.deepEqual(plan, isoStylePoints(model, points, { rotation: 0, px: 16 }), 'deterministic');
  for (const p of plan.points) {
    assert.ok(Number.isFinite(p.sx) && Number.isFinite(p.sy), `${p.cls} maps to pixels`);
    assert.ok(p.sx >= 0 && p.sx <= plan.map.width && p.sy >= 0 && p.sy <= plan.map.height, `${p.cls} inside canvas`);
  }
  // terrain points project on the ground plane, exactly the cell map
  const ground = plan.points.find((p) => p.cls === 'ground');
  const [gx, gy] = isoCellToPixel(plan.map, ground.x, ground.y, 0);
  assert.ok(Math.abs(ground.sx - gx) < 0.01 && Math.abs(ground.sy - gy) < 0.01);
  // track points ride the lifted rail: higher on screen than their ground point
  const trackPt = plan.points.find((p) => p.cls === 'track');
  assert.ok(trackPt, 'track sampled');
  const [, tGroundY] = isoCellToPixel(plan.map, trackPt.x, trackPt.y, 0);
  assert.ok(trackPt.sy < tGroundY, 'the rail sample sits above its ground point');
  // structure interior points ride the roof plane
  const structPt = plan.points.find((p) => p.cls === 'structure');
  assert.equal(structPt.mode, 'interior');
  const [, sGroundY] = isoCellToPixel(plan.map, structPt.x, structPt.y, 0);
  assert.ok(Math.abs((sGroundY - structPt.sy) - 10 * plan.map.hs) < 0.02, 'roof plane = ground + heightM');
  // badge offsets apply in screen pixels around the projected anchor
  const badgePts = plan.points.filter((p) => p.cls === 'badge' && p.idx === 0);
  assert.equal(badgePts.length, 2);
  assert.ok(Math.abs((badgePts[0].sx - badgePts[1].sx) - 0.64 * 16) < 0.01, 'the ±0.32-cell moat is ±0.32·px on screen');
  assert.equal(badgePts[0].sy, badgePts[1].sy);
  return true;
});

await check('unsound rows skip on the record, never silently', () => {
  const points = stylePoints(model, { perClass: 8 });
  const plan = isoStylePoints(model, points, { rotation: 0, px: 16 });
  assert.ok(!plan.points.some((p) => p.cls === 'trackedge'), 'casing-edge samples leave the plan');
  assert.ok(!plan.points.some((p) => p.cls === 'structure' && p.mode === 'edge'), 'outline-edge samples leave the plan');
  const edge = plan.skips.find((s) => s.key === 'trackedge');
  assert.ok(edge && edge.count > 0 && /casing-edge/.test(edge.reason));
  const structEdge = plan.skips.find((s) => s.key === 'structure_edge');
  assert.ok(structEdge && structEdge.count > 0);
  assert.equal(plan.points.length + plan.skips.reduce((n, s) => n + s.count, 0), points.length, 'every point kept or skipped');
  return true;
});

await check('ground samples behind an extrusion are occlusion-skipped', () => {
  const hulls = buildingScreenHulls(model, { rotation: 0 });
  assert.equal(hulls.length, 1);
  const t = model.tileMetres;
  const at = (cx, cy) => isoLocal(cx * t, -cy * t, 0);
  const inside = at(4.5, 6.5); // the building's own footprint center
  assert.ok(occludedByBuilding(inside.x, inside.y, hulls), 'the footprint hides its ground');
  const behind = at(4.5, 5.6); // just north of the foot, under the extruded mass
  assert.ok(occludedByBuilding(behind.x, behind.y, hulls), 'the extrusion hides the ground behind it');
  const far = at(1, 1);
  assert.ok(!occludedByBuilding(far.x, far.y, hulls), 'open ground stays sampled');
  // and the plan records any such skip under one named key, with counts
  const plan = isoStylePoints(model, stylePoints(model, { perClass: 48 }), { rotation: 0, px: 16 });
  const occl = plan.skips.find((s) => s.key === 'occluded');
  if (occl) {
    assert.ok(occl.count > 0 && /extrusion/.test(occl.reason));
    assert.ok(occl.byClass, 'per-class culled/kept counts ride the skip entry');
    for (const c of Object.values(occl.byClass)) {
      assert.ok(c.culled > 0 && c.kept >= STARVED_MIN_KEPT && c.culled <= c.kept, 'occluded covers only healthy classes');
    }
  }
  for (const p of plan.points) {
    if (p.cls === 'structure' || p.cls === 'track' || p.cls === 'badge') continue;
    const iso = { x: (p.sx - plan.map.ox) / plan.map.hs, y: (plan.map.oy - p.sy) / plan.map.hs };
    assert.ok(!occludedByBuilding(iso.x, iso.y, hulls), `kept ${p.cls} point is not occluded`);
  }
  return true;
});

await check('a class starved by occlusion withdraws its sliver, on the record', () => {
  // A 2x2 lot patch entirely inside the building's screen shadow: every
  // lot sample is culled, so the class must not just vanish from the plan.
  const starveCells = cells.slice();
  for (const [x, y] of [[5, 3], [6, 3], [5, 4], [6, 4]]) starveCells[y * COLS + x] = T.lot;
  const starveModel = { ...model, cells: starveCells };
  const points = stylePoints(starveModel);
  assert.ok(points.some((p) => p.cls === 'lot'), 'the flat plan samples the lot');
  const plan = isoStylePoints(starveModel, points, { rotation: 0, px: 16 });
  assert.ok(!plan.points.some((p) => p.cls === 'lot'), 'no sliver median: starved samples are withdrawn');
  const starved = plan.skips.find((s) => s.key === 'occlusion_starved');
  assert.ok(starved, 'starvation is a named skip, never a silent absence');
  assert.ok(starved.byClass.lot, 'the starved class is named');
  assert.equal(starved.byClass.lot.kept, 0, 'fully occluded');
  assert.ok(starved.byClass.lot.culled >= 4);
  assert.ok(new RegExp(`fewer than ${STARVED_MIN_KEPT}`).test(starved.reason));
  assert.equal(
    plan.points.length + plan.skips.reduce((n, s) => n + s.count, 0),
    points.length,
    'every point is kept or accounted for in a skip',
  );
  // the cert renders the starved row with its per-class counts
  const profile = {
    id: 'p', kit: 'test-kit', style: 'test',
    colorFamilies: { ground: { anchor: '#EBDDA8', deltaE: 12 }, lot: { anchor: '#B3AC9D', deltaE: 12 } },
    roads: { vsGround: { minDeltaE: 1, polarity: 'darker' } },
    agentReview: [{ key: 'k', prompt: 'q' }],
  };
  const samples = plan.points.map(() => [235, 221, 168, 255]);
  const cert = certifyStyleContract({
    model: starveModel, points: plan.points, samples, profile, kit: { id: 'test-kit' }, target: 'iso', skips: plan.skips,
  });
  const row = cert.checks.find((c) => c.key === 'style_skip_occlusion_starved');
  assert.ok(row && row.pass, 'the starved row is an explicit disclosure');
  assert.match(row.evidence, /lot: 0 kept \/ \d+ culled/, 'per-class counts render into the cert evidence');
  const palette = cert.checks.find((c) => c.key === 'style_terrain_palette');
  assert.ok(!/lot ΔE/.test(palette.evidence), 'the starved class never renders as a normal palette entry');
  return true;
});

await check('certifyStyleContract turns skips into explicit pass rows', () => {
  const profile = {
    id: 'p', kit: 'test-kit', style: 'test',
    colorFamilies: { ground: { anchor: '#EBDDA8', deltaE: 12 } },
    roads: { vsGround: { minDeltaE: 1, polarity: 'darker' } },
    agentReview: [{ key: 'k', prompt: 'q' }],
  };
  const points = stylePoints(model, { perClass: 4 });
  const plan = isoStylePoints(model, points, { rotation: 2, px: 16 });
  const samples = plan.points.map(() => [235, 221, 168, 255]);
  const cert = certifyStyleContract({
    model, points: plan.points, samples, profile, kit: { id: 'test-kit' }, target: 'iso', skips: plan.skips,
  });
  assert.equal(cert.target, 'iso');
  const row = cert.checks.find((c) => c.key === 'style_skip_trackedge');
  assert.ok(row && row.pass && /skipped/.test(row.evidence));
  assert.ok(cert.checks.find((c) => c.key === 'style_skip_structure_edge'));
  return true;
});

await check('iso tolerance overrides apply only on the iso target', () => {
  const profile = {
    id: 'p', kit: 'test-kit', style: 'test',
    colorFamilies: { ground: { anchor: '#C8B888', deltaE: 5 } }, // ΔE ~13.2 to the sample
    iso: { toleranceOverrides: { ground: 30 } },
    roads: {},
    agentReview: [{ key: 'k', prompt: 'q' }],
  };
  const points = stylePoints(model, { perClass: 4 }).filter((p) => p.cls === 'ground');
  const samples = points.map(() => [...hexToRgb('#EBDDA8'), 255]);
  const flat = certifyStyleContract({ model, points, samples, profile, kit: { id: 'test-kit' } });
  assert.equal(flat.checks.find((c) => c.key === 'style_terrain_palette').pass, false, 'flat keeps deltaE 5');
  const iso = certifyStyleContract({ model, points, samples, profile, kit: { id: 'test-kit' }, target: 'iso', skips: [] });
  assert.equal(iso.checks.find((c) => c.key === 'style_terrain_palette').pass, true, 'iso widens to 30');
  return true;
});

console.log('\nprofile iso block\n');

await check('rpg-overworld ships a valid iso block; malformed blocks fail loudly', () => {
  const base = profileForKit('rpg-overworld');
  assert.ok(base.iso, 'rpg-overworld carries the iso block');
  assert.deepEqual(validateProfile(base), [], 'the committed block validates');
  const clone = () => JSON.parse(JSON.stringify(base));
  let p = clone();
  p.iso.hologram = true;
  assert.ok(validateProfile(p).some((x) => /unknown iso key/.test(x)));
  p = clone();
  p.iso.appliesUnchanged = ['style_not_a_check'];
  assert.ok(validateProfile(p).some((x) => /unknown check/.test(x)));
  p = clone();
  p.iso.toleranceOverrides = { lava: 10 };
  assert.ok(validateProfile(p).some((x) => /unknown family/.test(x)));
  p = clone();
  p.iso.toleranceOverrides = { ground: 99 };
  assert.ok(validateProfile(p).some((x) => /out of range/.test(x)));
  p = clone();
  p.iso.structures = { coasterVsUnderlay: { minDeltaE: 0 } };
  assert.ok(validateProfile(p).some((x) => /minDeltaE out of range/.test(x)));
  p = clone();
  p.iso = 'yes';
  assert.ok(validateProfile(p).some((x) => /must be an object/.test(x)));
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
