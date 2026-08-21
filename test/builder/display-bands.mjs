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

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
