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
import { readFileSync } from 'node:fs';
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
const { bandBakePlan, bandPlansFor, venueSpanMetres } = await import(
  '../../packages/venue-builder/lib/display-bands.mjs'
);
const { BANDS, bandResolution } = await import('../../packages/shared/zoomBands.js');

const mapMetaFor = (id) =>
  JSON.parse(readFileSync(path.join(REPO, 'apps/party-tracker/public/venues', `${id}.map.json`), 'utf8')).meta;

/* A venue whose ground span can be worked out on paper: sat on the equator so
 * cos(latMid) is exactly 1, the span is 0.004 * 111320 = 445.28 m across and
 * 0.002 * 110574 = 221.148 m down. The boundary is a rectangle covering the
 * middle half across and middle half down, so the crop window is computable
 * too. Used by the projector and bakeModel cases below. */
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
} = await import('../../packages/venue-builder/lib/display-bake.mjs');

const mapFor = (id) =>
  JSON.parse(readFileSync(path.join(REPO, 'apps/party-tracker/public/venues', `${id}.map.json`), 'utf8'));

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
  // The end-to-end one: a real venue, the real painter, no column budget
  // anywhere. `margin: Infinity` opens the crop window to the whole grid so
  // this measures the projector's answer rather than the venue's boundary.
  const map = mapFor('big-kahunas');
  const plan = bandBakePlan(map.meta, 'overview');
  const model = bakeModel(map, [], { tileMetres: plan.tileMetres, margin: Infinity });
  assert.equal(model.cols, plan.cols, 'cols');
  assert.equal(model.rows, plan.rows, 'rows');
  assert.equal(model.cols, 244);
  assert.equal(model.rows, 276);
  return true;
});

await check('bakeModel crops to the venue; the plan describes the uncropped World', () => {
  // Worth pinning because it is the one place a band bake and its plan part
  // company. `cropModel` trims to the boundary ring's box plus a margin, so
  // the PNG a venue with slack bounds emits is SMALLER than plan.width. The
  // crop depends only on the boundary and the cell grid, both of which are
  // band-independent, so the 4x chain between bands survives it intact.
  const open = bakeModel(EQUATOR_MAP, [], { tileMetres: 3.7, margin: Infinity });
  const cropped = bakeModel(EQUATOR_MAP, [], { tileMetres: 3.7 }); // default margin 6
  assert.equal(open.cols, 120);
  assert.equal(open.rows, 60);
  // Hand-computed: the boundary spans cells x 30.0865..90.2595 and
  // y 14.9424..44.8273, so a 6-cell margin gives x 24..97 and y 8..51.
  assert.equal(cropped.cols, 74, 'cropped cols');
  assert.equal(cropped.rows, 44, 'cropped rows');
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
