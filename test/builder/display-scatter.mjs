#!/usr/bin/env node
/**
 * Prop scatter — the placements are frozen, and the cost is bounded.
 *
 * Two things about `scatterPoints` are contractual and pull against each other.
 *
 * Determinism: a bake is certified byte-identical across reruns, so for a fixed
 * seed and inputs the placement list may never move. Every list below was
 * captured from the implementation as it stood before the scaling work in #563
 * and pasted in as a literal. They are known answers, not expectations
 * re-derived from the module: if the module and the fixture disagree, the
 * module changed, and every shipped venue's art changed with it.
 *
 * Cost: ADR-0021 clause 2's close band asks for 646 columns at kings-island,
 * which projects to a 646 x 530 grid — 342,380 cells, about four times the
 * largest bake the repo had produced before it. The dart count is pinned by the
 * determinism contract (it is a function of the seed and of which darts landed),
 * so the one thing an implementation may improve is what a dart costs.
 * `stays within budget of the sampling floor` prices a dart against the
 * irreducible work it cannot avoid on this machine, and fails if the per-dart
 * overhead comes back.
 *
 *   node test/builder/display-scatter.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { scatterPoints, densityFromSpecies, PACKING } from '../../packages/venue-builder/lib/display-scatter.mjs';
import { makeNoise2D, makeRng } from '../../packages/venue-builder/lib/terrain/noise.mjs';

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

console.log('\ndisplay-scatter\n');

/** display-bake.mjs's wood mix, copied so a retune there cannot rewrite a fixture. */
const WOOD = [
  { id: 'big', radius: 0.85, probability: 0.55, big: true },
  { id: 'small', radius: 0.6, probability: 0.45 },
];
/** Three species, so the probability wheel has an interior entry to fall through. */
const MIXED = [
  { id: 'oak', radius: 1.1, probability: 0.3, big: true },
  { id: 'pine', radius: 0.7, probability: 0.5 },
  { id: 'shrub', radius: 0.35, probability: 0.2 },
];

/** A solid w x h rectangle of candidate cells, row-major — what a meadow looks like. */
function block(w, h) {
  const out = [];
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) out.push([x, y]);
  return out;
}

const tuples = (placed) => placed.map((p) => [p.x, p.y, p.radius, p.id, p.big]);
const digestOf = (placed) => {
  const h = createHash('sha256');
  for (const p of placed) h.update(`${p.x} ${p.y} ${p.radius} ${p.id} ${p.big}\n`);
  return h.digest('hex');
};

// ---------------------------------------------------------------------------
// Frozen placements. Captured before the #563 scaling work; never regenerated.
// ---------------------------------------------------------------------------

/** 12x12 cells, MIXED, seed 7, default noise (8 importance samples per dart). */
const FROZEN_DEFAULT = [
  [5.608076630393043, 0.06251333723776042, 0.35, 'shrub', false],
  [2.37192317773588, 0.12279674061574042, 0.7, 'pine', false],
  [6.714359838748351, 0.27558709401637316, 0.35, 'shrub', false],
  [8.184993466129526, 0.36766998074017465, 1.1, 'oak', true],
  [5.0887538401875645, 0.6036026552319527, 0.35, 'shrub', false],
  [3.6448947943281382, 0.6896364381536841, 0.35, 'shrub', false],
  [4.395248944638297, 1.009635251481086, 0.35, 'shrub', false],
  [2.7610908665228635, 1.141659754095599, 0.35, 'shrub', false],
  [3.723644240293652, 1.4697678538504988, 0.35, 'shrub', false],
  [10.535572233609855, 1.805370662594214, 1.1, 'oak', true],
  [5.956387361045927, 1.885167526314035, 1.1, 'oak', true],
  [4.478171826805919, 1.9701502886600792, 0.35, 'shrub', false],
  [3.41794462245889, 2.330254068830982, 0.35, 'shrub', false],
  [2.724040014203638, 2.4733756706118584, 0.35, 'shrub', false],
  [8.090433485340327, 2.747161532752216, 1.1, 'oak', true],
  [4.11230604769662, 2.864523067837581, 0.35, 'shrub', false],
  [9.653411271050572, 3.1605779849924147, 0.35, 'shrub', false],
  [4.923516778508201, 3.453034321544692, 0.35, 'shrub', false],
  [3.2428627877961844, 3.462115537840873, 0.35, 'shrub', false],
  [10.388693621149287, 3.5524721504189074, 0.35, 'shrub', false],
  [3.9463574499823153, 3.8469198003876954, 0.35, 'shrub', false],
  [6.117708145175129, 3.8840856859460473, 0.7, 'pine', false],
  [9.62267108191736, 3.8929507054854184, 0.35, 'shrub', false],
  [10.17982589546591, 4.541128649841994, 0.35, 'shrub', false],
  [5.0224775390233845, 4.770222004270181, 0.35, 'shrub', false],
  [9.400203851051629, 4.849927912000567, 0.35, 'shrub', false],
  [7.238526364555582, 4.860459601972252, 0.35, 'shrub', false],
  [8.440482709556818, 4.882320130243897, 0.35, 'shrub', false],
  [3.964285474969074, 4.899502569111064, 0.7, 'pine', false],
  [5.999153743730858, 5.246687891660258, 0.35, 'shrub', false],
  [7.878841396188363, 5.4678436471149325, 0.35, 'shrub', false],
  [8.71673466451466, 5.580622617388144, 0.35, 'shrub', false],
  [6.743398948572576, 6.038108337670565, 0.7, 'pine', false],
  [9.752306575654075, 6.5659368629567325, 0.7, 'pine', false],
  [4.850795663194731, 6.679124583024532, 1.1, 'oak', true],
  [7.9081555106677115, 6.997726188506931, 0.7, 'pine', false],
  [0.395970058394596, 8.168820906197652, 0.7, 'pine', false],
  [6.837132463464513, 8.582591983489692, 0.7, 'pine', false],
  [7.228668107651174, 10.673857687739655, 0.7, 'pine', false],
  [8.953300768742338, 11.08706968324259, 0.7, 'pine', false],
];

/** Same cells and seed with `noise: null` — one sample per dart, so a different stream. */
const FROZEN_NO_NOISE = [
  [6.154981157043949, 0.157522636000067, 0.35, 'shrub', false],
  [11.509924964280799, 0.34747824538499117, 0.7, 'pine', false],
  [2.375630375929177, 0.4498677847441286, 0.7, 'pine', false],
  [7.844750924734399, 0.5059689916670322, 0.35, 'shrub', false],
  [4.182519550668076, 0.6758243327494711, 1.1, 'oak', true],
  [0.10952103300951421, 0.9038964069914073, 0.7, 'pine', false],
  [8.859856206923723, 1.545019539538771, 0.7, 'pine', false],
  [7.360340042971075, 1.7771688867360353, 0.7, 'pine', false],
  [3.100289969239384, 1.8381423007231206, 0.35, 'shrub', false],
  [5.541160609573126, 1.9159619405400008, 0.7, 'pine', false],
  [0.8087792182341218, 2.2066770400851965, 0.7, 'pine', false],
  [11.731920273043215, 2.713843063218519, 1.1, 'oak', true],
  [3.905517118284479, 3.000432098750025, 0.7, 'pine', false],
  [8.653321459889412, 3.0004956321790814, 0.35, 'shrub', false],
  [2.493103184038773, 3.200743627967313, 0.7, 'pine', false],
  [5.439231106778607, 3.611850354121998, 0.7, 'pine', false],
  [0.4543369081802666, 3.632529426831752, 0.35, 'shrub', false],
  [6.583729535108432, 3.8787052591796964, 0.35, 'shrub', false],
  [1.5345232060644776, 4.309790482278913, 0.35, 'shrub', false],
  [10.17982589546591, 4.541128649841994, 0.7, 'pine', false],
  [4.0803089761175215, 4.896197497146204, 1.1, 'oak', true],
  [1.5411590333096683, 5.378542558522895, 0.35, 'shrub', false],
  [7.9677247072104365, 5.625639932230115, 0.7, 'pine', false],
  [0.07698127208277583, 5.91325105773285, 0.7, 'pine', false],
  [9.451723705977201, 6.16663321130909, 0.7, 'pine', false],
  [6.6818880387581885, 6.632468896917999, 0.7, 'pine', false],
  [1.7323387798387557, 6.695515172090381, 0.7, 'pine', false],
  [11.488514815457165, 7.060258610639721, 1.1, 'oak', true],
  [0.3617533091455698, 7.7575540884863585, 0.7, 'pine', false],
  [4.441608759807423, 7.930383872939274, 1.1, 'oak', true],
  [9.894874504301697, 8.450811161659658, 0.7, 'pine', false],
  [8.513148966478184, 8.702089515281841, 0.35, 'shrub', false],
  [11.599074952537194, 8.790947016561404, 0.35, 'shrub', false],
  [7.832806434715167, 9.12124329037033, 0.35, 'shrub', false],
  [1.512239160714671, 9.78174581611529, 1.1, 'oak', true],
  [10.801004093373194, 9.833221807377413, 0.7, 'pine', false],
  [4.584787534084171, 10.235842000693083, 1.1, 'oak', true],
  [7.625602716580033, 10.705342808039859, 0.7, 'pine', false],
  [8.392275820020586, 11.684709719847888, 0.35, 'shrub', false],
  [10.20087815867737, 11.78122591599822, 0.7, 'pine', false],
];

/** 14x14 cells, WOOD, seed 31, with a reject() that vetoes every third dart.
 *  A vetoed dart skips the species draw, so this pins the stream's branchiest path. */
const FROZEN_REJECTED = [
  [1.2606243351474404, 0.0253389747813344, 0.6, 'small', false],
  [3.321157692698762, 0.46587796485982835, 0.6, 'small', false],
  [13.917646687012166, 0.47486196109093726, 0.85, 'big', true],
  [13.269909204449505, 1.9169512153603137, 0.6, 'small', false],
  [7.179216783028096, 4.186167043633759, 0.85, 'big', true],
  [13.981382992817089, 4.284376168856397, 0.6, 'small', false],
  [10.153621908975765, 4.728942916961387, 0.85, 'big', true],
  [10.655445146141574, 6.2093908418901265, 0.6, 'small', false],
  [6.478187776403502, 6.41113118478097, 0.85, 'big', true],
  [13.96072540921159, 6.431041253497824, 0.85, 'big', true],
  [12.31134518631734, 6.464239372871816, 0.6, 'small', false],
  [8.93183693755418, 6.824013138888404, 0.85, 'big', true],
  [3.8398754296358675, 7.222084099659696, 0.85, 'big', true],
  [10.640860490733758, 7.4521204847842455, 0.6, 'small', false],
  [12.659270223230124, 7.712515584426001, 0.6, 'small', false],
  [7.448490889277309, 8.075539940502495, 0.6, 'small', false],
  [13.722419342724606, 8.299607542809099, 0.6, 'small', false],
  [4.509871188784018, 8.638556987745687, 0.6, 'small', false],
  [10.899593325098976, 8.651763683650643, 0.6, 'small', false],
  [6.066140944371, 8.67591043189168, 0.85, 'big', true],
  [9.365079360781237, 9.078191050561145, 0.85, 'big', true],
  [3.10043704463169, 9.122006280813366, 0.85, 'big', true],
  [12.288860747823492, 9.20279096858576, 0.85, 'big', true],
  [7.820520399603993, 9.373764955205843, 0.6, 'small', false],
  [4.964856046019122, 10.218551445519552, 0.85, 'big', true],
  [10.870467758504674, 10.239604251692072, 0.85, 'big', true],
  [7.084822250530124, 10.8540060184896, 0.85, 'big', true],
  [8.670374721987173, 10.857750904979184, 0.6, 'small', false],
  [3.512806391576305, 11.114228852791712, 0.85, 'big', true],
  [1.5331820065621287, 11.136148152174428, 0.85, 'big', true],
  [9.963123418856412, 11.788495130604133, 0.6, 'small', false],
  [5.918660055380315, 12.124958282802254, 0.6, 'small', false],
  [8.261532943462953, 12.173400013707578, 0.6, 'small', false],
  [2.584715839009732, 12.38307780935429, 0.6, 'small', false],
  [0.7794001295696944, 12.994534579338506, 0.85, 'big', true],
  [5.067666759947315, 13.027752126799896, 0.6, 'small', false],
  [3.277458976022899, 13.386361710028723, 0.6, 'small', false],
  [7.762344682589173, 13.57438480341807, 0.85, 'big', true],
  [6.107971793971956, 13.7739130591508, 0.6, 'small', false],
  [1.9456956719513983, 13.877351592062041, 0.6, 'small', false],
];

/** The saturated case: 100x100 cells of wood at the shipped density.
 *  Too long to paste, so it is pinned by digest plus its endpoints and counts. */
const SATURATED = {
  placed: 2564,
  requested: 3130,
  dropped: 566,
  darts: 2097100,
  digest: '0b2c7846aebe5737df0a275015ef6a4c1af9359b853ee3e175a2f4f01c163e8e',
  first: [7.770265109138563, 0.0011098096147179604, 0.6, 'small', false],
  last: [92.0061397922691, 99.99104963219725, 0.6, 'small', false],
};

/** Hand arithmetic, not a call into the module: 0.55/pi/r^2 summed over the mix.
 *  display-bake.mjs passes exactly this as `density` for wood. */
const WOOD_DENSITY = 0.3129750836220512;

// One saturated run, timed, shared by the digest, invariant and cost checks
// below. Warm the JIT first so the cost figure is steady state and not tier-up.
scatterPoints({ cells: block(24, 24), species: WOOD, seed: 1, density: WOOD_DENSITY });
const SAT_CELLS = block(100, 100);
let satDarts = 0;
const satStart = process.hrtime.bigint();
const saturated = scatterPoints({
  cells: SAT_CELLS,
  species: WOOD,
  seed: 7,
  density: WOOD_DENSITY,
  reject: () => { satDarts += 1; return false; },
});
const satSeconds = Number(process.hrtime.bigint() - satStart) / 1e9;

/**
 * What one dart costs at minimum on this machine: `samples` draws of three rng
 * values and one noise lookup, which every implementation must do before it can
 * know where the dart landed. Priced here rather than assumed, so the budget
 * below survives a slow or loaded box — both sides scale with the hardware.
 */
function samplingFloorSeconds(darts, samples, cells) {
  const count = cells.length;
  const cellX = new Float64Array(count);
  const cellY = new Float64Array(count);
  for (let i = 0; i < count; i += 1) { cellX[i] = cells[i][0]; cellY[i] = cells[i][1]; }
  const rng = makeRng(999);
  const noiseAt = makeNoise2D(0x5bf03635);
  let sink = 0;
  const start = process.hrtime.bigint();
  for (let d = 0; d < darts; d += 1) {
    for (let s = 0; s < samples; s += 1) {
      const i = Math.floor(rng() * count);
      const qx = cellX[i] + rng();
      const qy = cellY[i] + rng();
      sink += noiseAt(qx * 0.09, qy * 0.09);
    }
  }
  const seconds = Number(process.hrtime.bigint() - start) / 1e9;
  return { seconds, sink };
}

await check('densityFromSpecies matches the hand-computed packing fraction', () => {
  assert.equal(PACKING, 0.55);
  assert.equal(densityFromSpecies(WOOD), WOOD_DENSITY);
  // 144 and 196 are the cell counts of the two small fixture blocks; 10000 is
  // the saturated one. These three counts are what the fixtures were sized at.
  assert.equal(Math.ceil(144 * densityFromSpecies(MIXED)), 40);
  assert.equal(Math.ceil(196 * WOOD_DENSITY), 62);
  assert.equal(Math.ceil(10000 * WOOD_DENSITY), SATURATED.requested);
  return true;
});

await check('frozen placements — 12x12 mixed species, seed 7, default noise', () => {
  const r = scatterPoints({ cells: block(12, 12), species: MIXED, seed: 7 });
  assert.equal(r.requested, 40);
  assert.equal(r.dropped, 0);
  assert.equal(r.placed.length, FROZEN_DEFAULT.length);
  assert.deepEqual(tuples(r.placed), FROZEN_DEFAULT);
  return true;
});

await check('frozen placements — noise off draws a different stream', () => {
  const r = scatterPoints({ cells: block(12, 12), species: MIXED, seed: 7, noise: null });
  assert.deepEqual(tuples(r.placed), FROZEN_NO_NOISE);
  // Guards the fixture itself: if these two lists were ever the same, the
  // noise-off path would be frozen against the wrong answer and prove nothing.
  assert.notDeepEqual(FROZEN_NO_NOISE, FROZEN_DEFAULT);
  return true;
});

await check('frozen placements — a rejected dart skips the species draw', () => {
  let darts = 0;
  const r = scatterPoints({
    cells: block(14, 14),
    species: WOOD,
    seed: 31,
    reject: () => { darts += 1; return darts % 3 === 0; },
  });
  assert.equal(darts, 4216);
  assert.equal(r.requested, 62);
  assert.equal(r.dropped, 22);
  assert.deepEqual(tuples(r.placed), FROZEN_REJECTED);
  return true;
});

await check('frozen digest — 100x100 saturated wood scatter', () => {
  assert.equal(saturated.placed.length, SATURATED.placed);
  assert.equal(saturated.requested, SATURATED.requested);
  assert.equal(saturated.dropped, SATURATED.dropped);
  assert.equal(satDarts, SATURATED.darts);
  assert.deepEqual(tuples(saturated.placed)[0], SATURATED.first);
  assert.deepEqual(tuples(saturated.placed).at(-1), SATURATED.last);
  assert.equal(digestOf(saturated.placed), SATURATED.digest);
  return true;
});

await check('the digest cannot be satisfied by an empty or truncated list', () => {
  // A hash check over nothing passes forever. Prove this one has something in it.
  assert.ok(SATURATED.placed > 2000, 'fixture should pin a few thousand placements');
  assert.notEqual(digestOf([]), SATURATED.digest);
  assert.notEqual(digestOf(saturated.placed.slice(0, -1)), SATURATED.digest);
  assert.notEqual(digestOf(saturated.placed.slice().reverse()), SATURATED.digest);
  return true;
});

await check('no two placed discs overlap', () => {
  // The whole point of the neighbour search. At this density the tightest pair
  // clears by about 6e-5 cells, so a search that looks at too few buckets does
  // not squeak by — it produces a real overlap.
  const p = saturated.placed;
  let tightest = Infinity;
  for (let i = 0; i < p.length; i += 1) {
    for (let j = i + 1; j < p.length; j += 1) {
      const gap = Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y) - (p[i].radius + p[j].radius);
      if (gap < tightest) tightest = gap;
    }
  }
  assert.ok(tightest > 0, `discs overlap by ${-tightest}`);
  return true;
});

await check('scatter stays within budget of the sampling floor', () => {
  // The dart count is fixed by the output contract — the frozen digest above
  // pins it at ~2.1M for this input — so cost per dart is the only thing an
  // implementation controls, and the floor is what one dart cannot avoid.
  //
  // Budget 4x. Measured on this fixture: the bucket-scan implementation this
  // replaced ran 8.6x the floor at 3,600 cells and 12.2x at 14,400 (it got
  // worse as the map grew, because every neighbour query built a string key per
  // bucket and probed a Map that kept growing); the current one holds 1.6-1.75x
  // flat across the same range. 4x sits 2.3x above the fixed cost and 2.2x
  // below the broken one, which is the widest gap on offer: a CI box that
  // stalls for a moment still passes, and the old per-dart overhead still
  // fails. Both numbers are measured in this process, so a slow box moves them
  // together and the ratio holds.
  //
  // Flat over this fixture's range, not forever: at the close band's own scale
  // a dart costs more again, because 27,000 placed discs and their bucket grid
  // stop fitting in cache. This is a regression guard on the per-dart overhead,
  // not a claim that the bake is linear — the dart count is not, and cannot be.
  const BUDGET = 4;
  let ratio = Infinity;
  let floor = 0;
  // Re-measure once on failure: one stolen timeslice should not fail a build.
  for (let attempt = 0; attempt < 2 && ratio > BUDGET; attempt += 1) {
    const f = samplingFloorSeconds(satDarts, 8, SAT_CELLS);
    assert.ok(Number.isFinite(f.sink), 'floor loop must not be optimised away');
    assert.ok(f.seconds > 0, 'floor must take measurable time');
    floor = f.seconds;
    const scatter = attempt === 0 ? satSeconds : (() => {
      let d = 0;
      const t = process.hrtime.bigint();
      scatterPoints({
        cells: SAT_CELLS, species: WOOD, seed: 7, density: WOOD_DENSITY, reject: () => { d += 1; return false; },
      });
      return Number(process.hrtime.bigint() - t) / 1e9;
    })();
    ratio = scatter / floor;
  }
  assert.ok(
    ratio <= BUDGET,
    `scatter ran ${ratio.toFixed(2)}x the ${floor.toFixed(2)}s sampling floor for `
    + `${satDarts} darts, budget ${BUDGET}x`,
  );
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
