#!/usr/bin/env node
/**
 * Band bake plans — the seam between the shared band table
 * (`packages/shared/zoomBands.js`, which the phone also reads) and the
 * builder's projector, which is the only thing that knows how this repo turns
 * a venue's degree bounds into metres.
 *
 * The two disagreed silently before this module existed. `bandPixels` takes a
 * ground span from its caller and knows nothing about projection; the
 * projector carries its own constants (111320·cos(lat) per degree of longitude,
 * 110574 per degree of latitude). Feed `bandPixels` a span computed with the
 * spherical 111319.5 instead and kings-island's close band comes out
 * 10336x8544 while the bake produces 10336x8480 — 64 px of disagreement
 * between the picture and the table describing it, with no error anywhere.
 * One owner for "the ground span of this venue" is the fix.
 *
 *   node test/builder/display-bands.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

console.log('\ndisplay bands\n');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { bandBakePlan, bandPlansFor, venueSpanMetres, CANVAS_MAX_AXIS_PX } = await import(
  '../../packages/venue-builder/lib/display-bands.mjs'
);
const { BANDS, bandResolution } = await import('../../packages/shared/zoomBands.js');

const mapMetaFor = (id) =>
  JSON.parse(readFileSync(path.join(REPO, 'apps/party-tracker/public/venues', `${id}.map.json`), 'utf8')).meta;

/* A venue whose ground span can be worked out on paper: sat on the equator so
 * cos(latMid) is exactly 1, the span is 0.004 * 111320 = 445.28 m across and
 * 0.002 * 110574 = 221.148 m down. The boundary is a rectangle covering the
 * middle half across and middle half down, so a bake that trimmed itself to
 * the boundary would be visibly smaller than one that does not. Used by the
 * projector and bakeModel cases below. */
const EQUATOR_MAP = {
  meta: { id: 'equator', bounds: { n: 0.001, s: -0.001, e: 0.002, w: -0.002 } },
  boundary: [
    [-0.001, 0.0005], [0.001, 0.0005], [0.001, -0.0005], [-0.001, -0.0005], [-0.001, 0.0005],
  ],
};

/* Known answers for every shipped venue x every band.
 *
 * These are literals on purpose — recomputing them from the module under test
 * would assert only that it agrees with itself. kings-island's close row is
 * corroborated by an actual bake: `venues:bake -- kings-island --max-cols 646`
 * emitted a 46.7 MB PNG whose IHDR reads 10336 x 8480. */
const EXPECTED = {
  'big-kahunas': { overview: [244, 276], mid: [976, 1104], close: [3904, 4416] },
  'kings-island': { overview: [646, 530], mid: [2584, 2120], close: [10336, 8480] },
  'six-flags-fiesta-texas': { overview: [663, 704], mid: [2652, 2816], close: [10608, 11264] },
  'cedar-point': { overview: [744, 797], mid: [2976, 3188], close: [11904, 12752] },
};

await check('every shipped venue plans to its known band dimensions', () => {
  for (const [id, bands] of Object.entries(EXPECTED)) {
    const meta = mapMetaFor(id);
    for (const [bandId, [width, height]] of Object.entries(bands)) {
      const plan = bandBakePlan(meta, bandId);
      assert.equal(plan.width, width, `${id}/${bandId} width`);
      assert.equal(plan.height, height, `${id}/${bandId} height`);
    }
  }
  return true;
});

await check('every shipped venue’s bands fit inside the canvas ceiling', () => {
  // The bake paints a band into ONE Chromium <canvas> sized cols*px by
  // rows*px, and a canvas asked for more than the browser gives does not
  // throw — it clamps or loses its context and the PNG comes out blank or
  // truncated. So the cost of not trimming the bake is measured here rather
  // than assumed: it roughly doubled the emitted picture at the three venues
  // whose boundary leaves slack inside their bbox (cedar-point's close band
  // was ~79 Mpx cropped and is 152 Mpx whole), and this says the doubled
  // pictures still fit.
  //
  // The live assertion is that planning SUCCEEDS: `bandBakePlan` refuses an
  // over-ceiling plan, so a venue whose bounds grow — or a fourth, finer band
  // — fails right here with the ceiling's own message rather than at bake
  // time. Nothing is read back out of EXPECTED; these are the real bounds.
  const measured = [];
  for (const id of Object.keys(EXPECTED)) {
    const meta = mapMetaFor(id);
    for (const band of BANDS) {
      let plan;
      try {
        plan = bandBakePlan(meta, band.id);
      } catch (e) {
        throw new Error(`${id}/${band.id}: ${e.message}`);
      }
      measured.push({ id, band: band.id, width: plan.width, height: plan.height });
    }
  }
  // The widest plan the repo makes, reported so the headroom is a number
  // someone can read rather than a claim: cedar-point at close.
  const worst = measured.reduce((a, b) => (Math.max(b.width, b.height) > Math.max(a.width, a.height) ? b : a));
  const long = Math.max(worst.width, worst.height);
  console.log(`      widest shipped plan: ${worst.id}/${worst.band} ${worst.width}x${worst.height}`
    + ` = ${((worst.width * worst.height) / 1e6).toFixed(0)} Mpx, ${CANVAS_MAX_AXIS_PX - long} px of headroom`);
  assert.equal(`${worst.id}/${worst.band} ${worst.width}x${worst.height}`, 'cedar-point/close 11904x12752',
    'the widest shipped plan moved — recheck the ceiling headroom deliberately');
  return true;
});

await check('a band plan past the canvas ceiling is refused, not baked', () => {
  // The guard has to be reachable, so drive it: a ~10 km square venue. Its
  // overview band is a comfortable 4175 px and plans fine; its close band is
  // 66792 px, four times the ceiling, and must be refused at plan time rather
  // than handed to a canvas that will quietly clamp it.
  const huge = { id: 'too-big', bounds: { n: 0.09, s: 0, e: 0.09, w: 0 } };
  const overview = bandBakePlan(huge, 'overview');
  assert.ok(overview.width < CANVAS_MAX_AXIS_PX, `overview ${overview.width} should still plan`);
  assert.throws(() => bandBakePlan(huge, 'close'), /canvas ceiling/, 'close must be refused');
  assert.throws(() => bandPlansFor(huge), /canvas ceiling/, 'and refused through bandPlansFor too');
  return true;
});

await check('each band is exactly 4x its parent, at every venue', () => {
  // ADR-0021 clause 2: power-of-two steps, so the tiler's parent-band
  // placeholder upscales pixel-for-pixel and no seam appears in the picture.
  for (const id of Object.keys(EXPECTED)) {
    const plans = bandPlansFor(mapMetaFor(id));
    assert.equal(plans.length, BANDS.length);
    for (let i = 1; i < plans.length; i += 1) {
      assert.equal(plans[i].width, plans[i - 1].width * 4, `${id} ${plans[i].bandId} width chain`);
      assert.equal(plans[i].height, plans[i - 1].height * 4, `${id} ${plans[i].bandId} height chain`);
    }
  }
  return true;
});

await check('a plan resolves the ground metres its band promises', () => {
  for (const id of Object.keys(EXPECTED)) {
    const span = venueSpanMetres(mapMetaFor(id));
    for (const band of BANDS) {
      const plan = bandBakePlan(mapMetaFor(id), band.id);
      assert.equal(plan.metresPerPixel, bandResolution(band.id));
      // Only the coarsest band rounds; finer bands multiply, so realised
      // resolution is identical at all three and the whole error is the
      // coarsest band's rounding to a whole cell. That bounds it structurally
      // at half a cell — assert that rather than a magic percentage.
      //
      // ADR-0021 clause 2 puts the drift "well under a tenth of a percent".
      // Measured, that is true of three shipped venues (kings-island 0.048%,
      // fiesta-texas 0.065%, cedar-point 0.054%) and false of the smallest:
      // big-kahunas is 0.137% across and 0.176% down, because half a cell is a
      // larger share of a 585 m park. The half-cell bound holds everywhere and
      // tightens automatically as a venue grows.
      for (const [axis, spanM, pixels, cells] of [
        ['x', span.spanXMetres, plan.width, plan.cols],
        ['y', span.spanYMetres, plan.height, plan.rows],
      ]) {
        const realised = spanM / pixels;
        const drift = Math.abs(realised - plan.metresPerPixel) / plan.metresPerPixel;
        assert.ok(
          drift <= 0.5 / cells,
          `${id}/${band.id} ${axis} drift ${(drift * 100).toFixed(4)}% exceeds half a cell (${(50 / cells).toFixed(4)}%)`,
        );
      }
    }
  }
  return true;
});

await check('the plan carries a tileMetres the projector can actually use', () => {
  // The projector divides BOTH axes by one tileMetres. bandPixels rounds each
  // axis independently against the nominal 2.4, so for some venues no integer
  // maxCols reproduces its answer: six-flags-fiesta-texas needs tileMetres in
  // (2.39949, 2.40001], and maxCols 704 gives 2.3977 while 703 gives 2.4011.
  // That is why a plan carries tileMetres rather than a column count.
  for (const id of Object.keys(EXPECTED)) {
    const meta = mapMetaFor(id);
    const span = venueSpanMetres(meta);
    const plan = bandBakePlan(meta, 'overview');
    assert.ok(plan.tileMetres > 0, `${id} tileMetres must be positive`);
    assert.equal(Math.max(1, Math.round(span.spanXMetres / plan.tileMetres)), plan.cols, `${id} cols`);
    assert.equal(Math.max(1, Math.round(span.spanYMetres / plan.tileMetres)), plan.rows, `${id} rows`);
  }
  return true;
});

await check('fiesta-texas is the venue no integer maxCols could express', () => {
  // Pinned because it is the whole reason for the tileMetres interface. If a
  // future bounds edit makes it expressible, this test should fail and be
  // deleted deliberately rather than the interface quietly losing its reason.
  const meta = mapMetaFor('six-flags-fiesta-texas');
  const { spanXMetres, spanYMetres } = venueSpanMetres(meta);
  const want = bandBakePlan(meta, 'overview');
  const long = Math.max(spanXMetres, spanYMetres);
  let solved = null;
  for (let c = Math.round(long / 2.4) - 8; c <= Math.round(long / 2.4) + 8; c += 1) {
    if (c < 1) continue;
    const t = Math.max(2, spanXMetres / c, spanYMetres / c);
    if (Math.round(spanXMetres / t) === want.cols && Math.round(spanYMetres / t) === want.rows) {
      solved = c;
      break;
    }
  }
  assert.equal(solved, null, `maxCols ${solved} now expresses this plan — the interface can simplify`);
  return true;
});

await check('the venue span uses the projector’s constants, not a sphere', () => {
  // The 64 px bug, pinned. A spherical earth radius gives kings-island a
  // 1280.6 m north-south span; the projector's 110574 m/degree gives 1272.0.
  const { spanXMetres, spanYMetres } = venueSpanMetres(mapMetaFor('kings-island'));
  assert.ok(Math.abs(spanXMetres - 1549.7) < 0.5, `spanX ${spanXMetres}`);
  assert.ok(Math.abs(spanYMetres - 1272.0) < 0.5, `spanY ${spanYMetres}`);
  assert.ok(Math.abs(spanYMetres - 1280.6) > 5, 'spanY must not be the spherical value');
  return true;
});

await check('an unknown band and malformed bounds both fail loudly', () => {
  const meta = mapMetaFor('kings-island');
  assert.throws(() => bandBakePlan(meta, 'gigantic'), /unknown band/i);
  assert.throws(() => bandBakePlan({ bounds: { n: 1, s: 0, e: 'x', w: 0 } }, 'mid'), /bounds/i);
  assert.throws(() => bandBakePlan({}, 'mid'), /bounds/i);
  return true;
});

await check('planning is deterministic', () => {
  const meta = mapMetaFor('cedar-point');
  assert.equal(JSON.stringify(bandPlansFor(meta)), JSON.stringify(bandPlansFor(meta)));
  return true;
});

/* ------------------------------------------------------------------ *
 * Driving the painter from a plan.
 *
 * A plan is only worth having if the painter can be pointed at it. The
 * projector used to derive its own `tileMetres` from an integer column
 * budget, which — per the fiesta-texas case above — cannot express every
 * band. These cases prove the explicit-tileMetres path all the way from
 * the projector to `bakeModel` to the bin's `--band` flag.
 * ------------------------------------------------------------------ */

const {
  bakeModel, projector, resolveBakeGrid, assertBakeGridFlags, DEFAULT_MAX_COLS, DEFAULT_PX,
  bandGeneralization,
} = await import('../../packages/venue-builder/lib/display-bake.mjs');
const { bandGeneralizationRow, bandNestingRow } = await import(
  '../../packages/venue-builder/lib/display-style-contract.mjs'
);

const mapFor = (id) =>
  JSON.parse(readFileSync(path.join(REPO, 'apps/party-tracker/public/venues', `${id}.map.json`), 'utf8'));

await check('the only committed bake keeps its placement', () => {
  // Dropping the crop changes no committed venue placement, and that is worth
  // a test rather than a memory. kings-island is the ONLY venue with a baked
  // artifact in the tree, and its boundary fills its bbox, so the crop was
  // already a no-op there: the same 240x197 cells and the same four corners
  // before and after. Pois are not read — badges cannot move a grid or its
  // bounds — so this is the extent and the georeference, nothing else.
  const venuesDir = path.join(REPO, 'packages/venue-builder/data/venues');
  const worldsIn = (id) => {
    const dir = path.join(venuesDir, id, 'display');
    return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.world.json')) : [];
  };
  const baked = readdirSync(venuesDir).filter((id) => worldsIn(id).length > 0);
  assert.deepEqual(baked, ['kings-island'], 'kings-island is the only venue with a committed bake');

  const model = bakeModel(mapFor('kings-island'), [], {});
  assert.equal(model.cols, 240, 'cols, cropped or not');
  assert.equal(model.rows, 197, 'rows, cropped or not');
  for (const file of worldsIn('kings-island')) {
    const world = JSON.parse(readFileSync(path.join(venuesDir, 'kings-island/display', file), 'utf8'));
    assert.deepEqual(world.bounds, model.bounds, `${file} bounds must still be what the bake states`);
  }
  return true;
});

await check('the projector lands on the plan grid, every venue, every band', () => {
  for (const id of Object.keys(EXPECTED)) {
    const map = mapFor(id);
    for (const band of BANDS) {
      const plan = bandBakePlan(map.meta, band.id);
      const grid = projector(map, { tileMetres: plan.tileMetres });
      assert.equal(grid.cols, plan.cols, `${id}/${band.id} cols`);
      assert.equal(grid.rows, plan.rows, `${id}/${band.id} rows`);
      // The painter page sizes its canvas cols*px, so this is the pixel
      // dimension the bake actually emits.
      assert.equal(grid.cols * plan.px, plan.width, `${id}/${band.id} width`);
      assert.equal(grid.rows * plan.px, plan.height, `${id}/${band.id} height`);
    }
  }
  return true;
});

await check('kings-island close is the 646x530 grid a real 10336x8480 PNG was cut from', () => {
  // Known answer, not derived: the IHDR of the 46.7 MB PNG this repo emitted
  // from `venues:bake -- kings-island --max-cols 646`.
  const map = mapFor('kings-island');
  const plan = bandBakePlan(map.meta, 'close');
  const grid = projector(map, { tileMetres: plan.tileMetres });
  assert.equal(grid.cols, 646, 'cols');
  assert.equal(grid.rows, 530, 'rows');
  assert.equal(plan.px, 16, 'px');
  assert.equal(grid.cols * plan.px, 10336, 'width px');
  assert.equal(grid.rows * plan.px, 8480, 'height px');
  return true;
});

await check('a projector divides by the tileMetres it is handed', () => {
  // Hand-computed fixture. At the equator cos(latMid) is exactly 1, so the
  // span is 0.004 * 111320 = 445.28 m across and 0.002 * 110574 = 221.148 m
  // down. At 3.7 m a cell that is 120.345946 -> 120 columns and 59.769730 ->
  // 60 rows. None of these numbers comes back out of the module.
  const grid = projector(EQUATOR_MAP, { tileMetres: 3.7 });
  assert.equal(grid.tileMetres, 3.7);
  assert.equal(grid.cols, 120);
  assert.equal(grid.rows, 60);
  const [x, y] = grid.toCell([0.002, -0.001]); // the south-east corner
  assert.ok(Math.abs(x - 120.345946) < 1e-4, `corner x ${x}`);
  assert.ok(Math.abs(y - 59.769730) < 1e-4, `corner y ${y}`);
  return true;
});

await check('a column budget still works, in both the old and new spelling', () => {
  // Every caller that predates band plans passes a bare number. maxCols caps
  // the LONGER axis, so this venue's 661.2 m down is what 244 divides.
  const map = mapFor('big-kahunas');
  const legacy = projector(map, 244);
  const spelled = projector(map, { maxCols: 244 });
  assert.equal(legacy.cols, 216);
  assert.equal(legacy.rows, 244);
  assert.equal(spelled.cols, legacy.cols);
  assert.equal(spelled.rows, legacy.rows);
  assert.equal(projector(map).cols, projector(map, DEFAULT_MAX_COLS).cols, 'default budget');
  return true;
});

await check('an explicit tileMetres overrules a column budget', () => {
  const map = mapFor('big-kahunas');
  const both = projector(map, { tileMetres: 3.7, maxCols: 244 });
  assert.equal(both.tileMetres, 3.7, 'tileMetres wins');
  assert.equal(both.cols, projector(map, { tileMetres: 3.7 }).cols);
  assert.notEqual(both.cols, projector(map, { maxCols: 244 }).cols, 'the budget must not be what ran');
  return true;
});

await check('a tileMetres that is not a positive number is refused', () => {
  assert.throws(() => projector(EQUATOR_MAP, { tileMetres: 0 }), /tileMetres/);
  assert.throws(() => projector(EQUATOR_MAP, { tileMetres: -1 }), /tileMetres/);
  assert.throws(() => projector(EQUATOR_MAP, { tileMetres: 'close' }), /tileMetres/);
  assert.throws(() => projector(EQUATOR_MAP, { tileMetres: NaN }), /tileMetres/);
  return true;
});

await check('bakeModel bakes the plan grid when handed a tileMetres', () => {
  // The end-to-end one: a real venue, the real painter, no column budget and
  // no escape hatch anywhere. big-kahunas is the venue whose boundary leaves
  // slack inside its bbox, so it is the one that used to plan 244x276 and emit
  // 157x191 — the mismatch ADR-0021's crop answer closed.
  const map = mapFor('big-kahunas');
  const plan = bandBakePlan(map.meta, 'overview');
  const model = bakeModel(map, [], { tileMetres: plan.tileMetres });
  assert.equal(model.cols, plan.cols, 'cols');
  assert.equal(model.rows, plan.rows, 'rows');
  assert.equal(model.cols, 244);
  assert.equal(model.rows, 276);
  return true;
});

await check('a boundary decides paint, not extent — the bake is never trimmed to it', () => {
  // Worth pinning because this is where a band bake and its plan used to part
  // company: the bake trimmed itself to the boundary ring's box plus a margin,
  // so a venue with slack bounds emitted a SMALLER picture than plan.width.
  // ADR-0021's crop question was closed "don't trim, use the large tiles"
  // (2026-08-22), and this venue's boundary covers only the middle half of its
  // bbox in each axis — the shape that used to shrink hardest.
  const bounded = bakeModel(EQUATOR_MAP, [], { tileMetres: 3.7 });
  // Hand-computed from the fixture's own span, not read back out of the
  // module: 445.28 m / 3.7 = 120.35 -> 120 columns, 221.148 / 3.7 = 59.77 -> 60.
  assert.equal(bounded.cols, 120, 'cols');
  assert.equal(bounded.rows, 60, 'rows');
  // The boundary's own box is 60x30 cells — nowhere near the picture size.
  const open = bakeModel({ ...EQUATOR_MAP, boundary: null }, [], { tileMetres: 3.7 });
  assert.equal(bounded.cols, open.cols, 'a boundary must not shrink the extent');
  assert.equal(bounded.rows, open.rows, 'a boundary must not shrink the extent');
  assert.deepEqual(bounded.bounds, open.bounds, 'a boundary must not move the geo footprint');
  return true;
});

/* ------------------------------------------------------------------ *
 * The clause-3 alignment budget, over a real venue.
 *
 * ADR-0021 clause 3 budgets how far a drawn feature may sit from Truth, and
 * clause 2 is what makes that budget a ground distance: close 0.15 m, mid
 * 0.6 m, overview unconstrained. The unit cases in
 * test/builder/display-style.mjs drive the rule from a synthetic 12x12 world;
 * these drive it from real OSM truth, the real plan, and the real projector,
 * because the numbers that matter here are the ones a real bake produces.
 *
 * big-kahunas only. A band grid is the coarsest band's pixel grid, so every
 * venue bakes 2.4 m cells whatever its size — and every venue but this one is
 * a 646-to-797 column model that takes a minute and a half to build. The band
 * does not change the model at all (same tileMetres, same cells, same badges);
 * it changes `px`, and therefore what a pixel is worth on the ground. One
 * model, certified three times, is exactly the comparison the clause is about.
 * ------------------------------------------------------------------ */

const { certifyStyleContract, alignmentBudgetMetres } = await import(
  '../../packages/venue-builder/lib/display-style-contract.mjs'
);
const poisFor = (id) =>
  JSON.parse(readFileSync(path.join(REPO, 'apps/party-tracker/public/venues', `${id}.pois.json`), 'utf8'));
// The geo row reads model, pois, px and band; the colour rows need a profile
// to exist but not to say anything, and no samples at all.
const BARE_PROFILE = { version: 1, id: 'band-budget', kit: 'band-budget-kit', style: 'test', colorFamilies: {} };

const REAL = (() => {
  const map = mapFor('big-kahunas');
  const pois = poisFor('big-kahunas');
  const plans = bandPlansFor(map.meta);
  const model = bakeModel(map, pois, { tileMetres: plans[0].tileMetres });
  return { map, pois, plans, model };
})();

const realGeoRow = (plan, kit) => certifyStyleContract({
  model: REAL.model,
  points: [],
  samples: [],
  profile: BARE_PROFILE,
  kit,
  map: REAL.map,
  pois: REAL.pois,
  px: plan.px,
  band: plan.bandId,
}).checks.find((c) => c.key === 'style_world_geo');

await check('one real model, three bands, three ground-metre budgets', () => {
  // The model is band-independent: if this ever stops holding, the three rows
  // below stop being a comparison of budgets and become a comparison of bakes.
  assert.equal(new Set(REAL.plans.map((p) => p.tileMetres)).size, 1, 'one cell size across the bands');
  assert.deepEqual(REAL.plans.map((p) => p.px), [1, 4, 16], 'pixels per cell, coarsest first');
  assert.ok(REAL.model.badges.length > 0, 'the venue must contribute truth anchors to measure');
  const plain = { id: 'band-budget-kit' }; // a kit that declares no stroke wobble
  for (const plan of REAL.plans) {
    const row = realGeoRow(plan, plain);
    assert.ok(row, `${plan.bandId}: pois + bounds must produce the geo row`);
    assert.equal(row.pass, true, `${plan.bandId}: ${row.evidence}`);
    const budget = alignmentBudgetMetres(plan.bandId);
    assert.match(
      row.evidence,
      Number.isFinite(budget)
        ? new RegExp(`alignment budget ${String(budget).replace('.', '\\.')} m from ${plan.bandId} band`)
        : new RegExp(`alignment budget unconstrained from ${plan.bandId} band`),
      `${plan.bandId}: the row must quote its own band’s budget — ${row.evidence}`,
    );
  }
  return true;
});

await check('a real 2 px kit clears the overview band and fails the two that are budgeted', () => {
  // watercolor-quest is the one shipped kit that declares stroke displacement,
  // and it declares 2 bake pixels. That was inside the pre-ADR-0021 budget of
  // 3 px at any venue. Clause 3 allows one pixel of GROUND: 0.3 m of wobble
  // against a 0.15 m close-band budget, 1.2 m against mid’s 0.6 m. The kit
  // needs a band-aware amplitude before a banded bake of it can certify.
  const kit = JSON.parse(readFileSync(
    path.join(REPO, 'packages/venue-builder/data/display/kits/watercolor-quest.json'), 'utf8',
  ));
  assert.equal(kit.strokes.displacement.amplitude, 2, 'the shipped amplitude this case is about');
  const [overview, mid, close] = REAL.plans.map((plan) => realGeoRow(plan, kit));
  assert.equal(overview.pass, true, `overview is unbudgeted: ${overview.evidence}`);
  assert.match(overview.evidence, /displacement 2 px = 4\.8 m/);
  assert.equal(mid.pass, false, `2 px is 1.2 m at the mid band: ${mid.evidence}`);
  assert.match(mid.evidence, /displacement 2 px = 1\.2 m/);
  assert.equal(close.pass, false, `2 px is 0.3 m at the close band: ${close.evidence}`);
  assert.match(close.evidence, /displacement 2 px = 0\.3 m/);
  return true;
});

await check('every shipped venue generalizes the same way — a metre means the same at every park', () => {
  // ADR-0021 clause 2 bought exactly this: ground resolution is fixed and
  // pixel dimensions float, so what a band can draw is a property of the band
  // rather than of the park. If that ever stopped holding, per-band content
  // would become a per-venue guess and "mechanical repeats" (ADR-0021 clause 6)
  // would be a per-venue authoring job instead.
  for (const id of Object.keys(EXPECTED)) {
    const meta = mapMetaFor(id);
    for (const band of BANDS) {
      const plan = bandBakePlan(meta, band.id);
      const policy = bandGeneralization(band.id, { tileMetres: plan.tileMetres });
      // Not `policy.metresPerPixel === band.metresPerPixel`: the policy reads
      // that off the same row of the same table this line would compare it
      // against, so it cannot disagree. What hangs off the resolution is worth
      // pinning — every mark's drawn size is its ground size measured in the
      // BAND TABLE's metres per pixel, so a policy that measured against
      // anything else (the cell size, a second copy of the table that drifted)
      // fails here. Tolerance is the policy's own rounding: drawnPx to 2 dp.
      for (const m of policy.marks) {
        const measured = m.drawnPx * band.metresPerPixel;
        assert.ok(
          Math.abs(measured - m.sizeMetres) <= 0.01 * band.metresPerPixel,
          `${id}/${band.id} ${m.kind}: ${m.drawnPx} px at ${band.metresPerPixel} m/px is ${measured.toFixed(3)} m of ground, not the ${m.sizeMetres} m the mark measures`,
        );
      }
      const px = Object.fromEntries(policy.marks.map((m) => [m.kind, m.drawnPx]));
      if (band.id === 'overview') {
        // Literals, not a re-derivation: every mark is a sub-2px smudge here.
        assert.ok(px.trees < 2 && px.lotRows < 2 && px.badges < 2,
          `${id}/overview must draw every generalizable mark under 2 px, got ${JSON.stringify(px)}`);
        assert.deepEqual([...policy.drops], ['trees', 'lotRows'], `${id}/overview drops`);
        assert.deepEqual([...policy.badgeKinds], ['gate'], `${id}/overview pins landmarks only`);
      } else {
        assert.ok(px.trees > 4 && px.lotRows > 4 && px.badges > 4,
          `${id}/${band.id} must draw every mark over 4 px, got ${JSON.stringify(px)}`);
        assert.deepEqual([...policy.drops], [], `${id}/${band.id} drops nothing`);
        assert.equal(policy.badgeKinds, null, `${id}/${band.id} pins every kind`);
      }
    }
  }
  return true;
});

await check('a band policy without a real cell size is refused, not guessed at', () => {
  assert.throws(() => bandGeneralization('overview', { tileMetres: 0 }), /ground metres per cell/);
  assert.throws(() => bandGeneralization('overview', {}), /ground metres per cell/);
  assert.throws(() => bandGeneralization('gigantic', { tileMetres: 2.4 }), /unknown band/i);
  return true;
});

await check('end to end on a real venue: a band bake generalizes, and certifies that it did', () => {
  // The bin's whole non-painting path, on committed truth rather than a
  // fixture: plan the band, bake it and the band above it, then run the two
  // rows the cert carries. Everything the painter adds after this is pixels;
  // what a band LEAVES OUT is decided here.
  //
  // big-kahunas because it is the small one — kings-island's overview grid is
  // 646x530 and takes ~90 s to bake twice, which is a slow test rather than a
  // better one. The generalization decision is venue-independent by ADR-0021
  // clause 2, and the case above proves that across all four venues.
  const id = 'big-kahunas';
  const map = mapFor(id);
  const pois = JSON.parse(readFileSync(path.join(REPO, 'apps/party-tracker/public/venues', `${id}.pois.json`), 'utf8'));
  const grid = resolveBakeGrid(map.meta, { band: 'mid' });
  const mid = bakeModel(map, pois, { tileMetres: grid.tileMetres, band: 'mid' });
  const overview = bakeModel(map, pois, { tileMetres: grid.tileMetres, band: 'overview' });

  // The bake really had something to remove — otherwise the rows below would
  // certify an empty claim.
  assert.ok(mid.trees.length > 1000, `mid must grow a real canopy, got ${mid.trees.length}`);
  const midKinds = new Set(mid.badges.map((b) => b.kind));
  assert.ok(midKinds.size > 1 && midKinds.has('gate'), `mid must pin more than gates, got ${[...midKinds]}`);

  assert.deepEqual(overview.trees, [], 'overview drops the canopy');
  assert.deepEqual([...new Set(overview.badges.map((b) => b.kind))], ['gate'], 'overview pins landmarks only');
  assert.ok(overview.badges.length > 0, 'and thins rather than empties');
  assert.equal(overview.buildings.length, mid.buildings.length, 'bold shapes survive the coarsest band');

  const generalization = bandGeneralizationRow(overview);
  assert.equal(generalization.pass, true, generalization.evidence);
  assert.match(generalization.evidence, /overview \(floor 3 px\)/, generalization.evidence);
  const nesting = bandNestingRow({ coarse: overview, fine: mid });
  assert.equal(nesting.pass, true, nesting.evidence);
  // 74, not the 32 this pinned while the bake trimmed itself to the boundary:
  // big-kahunas' map.json carries 74 footprints inside its bbox and the crop
  // used to drop the 42 that sit beyond the park's own ring. Nothing outside
  // the boundary leaves the model any more (ADR-0021 crop, 2026-08-22).
  assert.match(nesting.evidence, /buildings 74\/74/, nesting.evidence);
  // The same row on the mid band's own bake: mid removes nothing, so it must
  // nest in the overview's SUPERSET rather than the other way round — running
  // it backwards is the sanity check that the row is directional at all.
  assert.equal(bandNestingRow({ coarse: mid, fine: overview }).pass, false,
    'the finer band cannot nest inside the coarser one — that is the direction of the rule');
  return true;
});

await check('--band and --max-cols are refused together, not silently resolved', () => {
  // Two ways to say the same thing, and one of them cannot always say what
  // the other can. Picking a winner would make the losing flag a lie.
  assert.throws(
    () => assertBakeGridFlags({ band: 'close', maxCols: 646 }),
    /--max-cols/,
  );
  assert.throws(() => assertBakeGridFlags({ band: 'close', px: 16 }), /--px/);
  assert.throws(() => assertBakeGridFlags({ band: 'huge' }), /unknown band/i);
  assert.doesNotThrow(() => assertBakeGridFlags({ band: 'close' }));
  assert.doesNotThrow(() => assertBakeGridFlags({ maxCols: 646, px: 16 }));
  return true;
});

await check('--band resolves to the plan tileMetres and px, per venue', () => {
  for (const id of Object.keys(EXPECTED)) {
    const meta = mapMetaFor(id);
    for (const band of BANDS) {
      const plan = bandBakePlan(meta, band.id);
      const grid = resolveBakeGrid(meta, { band: band.id });
      assert.equal(grid.tileMetres, plan.tileMetres, `${id}/${band.id} tileMetres`);
      assert.equal(grid.px, plan.px, `${id}/${band.id} px`);
      assert.equal(grid.maxCols, null, `${id}/${band.id} must carry no column budget`);
    }
  }
  const plain = resolveBakeGrid(mapMetaFor('kings-island'), {});
  assert.equal(plain.tileMetres, null, 'no band, no tileMetres');
  assert.equal(plain.maxCols, DEFAULT_MAX_COLS);
  assert.equal(plain.px, DEFAULT_PX);
  return true;
});

await check('legacy --max-cols/--px past the canvas ceiling is refused, not baked', () => {
  const huge = { id: 'too-big', bounds: { n: 0.09, s: 0, e: 0.09, w: 0 } };
  assert.doesNotThrow(() => resolveBakeGrid(huge, { maxCols: 500, px: 16 }), 'a modest grid still plans');
  assert.throws(
    () => resolveBakeGrid(huge, { maxCols: 5000, px: 32 }),
    /canvas ceiling/,
    'an oversized legacy grid must be refused at plan time',
  );
  return true;
});

await check('the bin survives one over-ceiling legacy grid in a batch', () => {
  const BIN = path.join(REPO, 'packages/venue-builder/bin/display-bake.mjs');
  const run = (args) => {
    try {
      execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { status: 0, stderr: '' };
    } catch (err) {
      return { status: err.status, stderr: err.stderr ?? '' };
    }
  };
  const batch = run([
    'kings-island', 'cedar-point', '--kit', 'rpg-overworld', '--max-cols', '5000', '--px', '32',
  ]);
  assert.equal(batch.status, 1, 'one refusal should fail the run, not abort it');
  assert.match(batch.stderr, /canvas ceiling/);
  assert.match(batch.stderr, /kings-island/);
  assert.match(batch.stderr, /cedar-point/, 'the batch must continue past the first refusal');
  return true;
});

await check('the bin refuses --band with --max-cols, as a process', () => {
  // display-distinct-cli.mjs is here because a CLI contract nothing spawned
  // shipped broken. Spawn this one: a library that throws is no use if the
  // bin catches it and bakes the wrong grid anyway.
  const BIN = path.join(REPO, 'packages/venue-builder/bin/display-bake.mjs');
  const run = (args) => {
    try {
      execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { status: 0, stderr: '' };
    } catch (err) {
      return { status: err.status, stderr: err.stderr ?? '' };
    }
  };
  const clash = run(['kings-island', '--kit', 'rpg-overworld', '--band', 'close', '--max-cols', '646']);
  assert.equal(clash.status, 2, `exit code (stderr: ${clash.stderr.trim().split('\n')[0]})`);
  assert.match(clash.stderr, /--max-cols/);
  assert.match(clash.stderr, /--band/);
  const unknown = run(['kings-island', '--kit', 'rpg-overworld', '--band', 'gigantic']);
  assert.equal(unknown.status, 2, 'unknown band exit code');
  assert.match(unknown.stderr, /unknown band/i);
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
