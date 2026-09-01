#!/usr/bin/env node
/* Skin-distinctness instrument (issues #577, #578; the gate in
   docs/goals/design-language-axes.md).

   Metrics are checked against SYNTHETIC images with known answers, not against
   the shipped bakes — a metric that only ever sees two real worlds cannot be
   shown to discriminate. Each case below isolates one axis: two images that
   differ on exactly that axis must move that metric and leave the others
   comparatively still. */
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { readFileSync, readdirSync } from 'node:fs';
import {
  SCHEMA_ONLY_KNOBS,
  ENCODE_NULL,
  THRESHOLDS,
  HEAVY_AXES,
  AXIS_KNOBS,
  UNMAPPED_AXES,
  PIXEL_MEASURED,
  REQUIRED_AXES,
  REQUIRED_HEAVY,
  MIN_SHIP_SKINS,
  specAxesDiffering,
  pixelAxisDeltas,
  verdict,
  skinSetPairs,
  setVerdict,
} from '../../packages/venue-builder/lib/skin-distinct.mjs';
/* The shipped set is declared once, in the app, because the app is what ships
   it. This suite reaches across rather than restating the list — a second copy
   here would be the one that drifted, and the gate would then be judging a set
   nobody ships. The module is plain ESM with no imports of its own. */
import { PREVIEW_SKINS } from '../../apps/party-tracker/lib/bandedWorldPreview.js';

const W = 256;

/** Flat field of one colour. */
async function flat([r, g, b]) {
  return sharp({ create: { width: W, height: W, channels: 3, background: { r, g, b } } })
    .png().toBuffer();
}

/** Same mid grey, but with deterministic per-pixel noise — grain, nothing else. */
async function grainy(amp) {
  const px = Buffer.alloc(W * W * 3);
  let seed = 1;
  for (let i = 0; i < W * W; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff; // deterministic LCG
    const n = ((seed % 1000) / 1000 - 0.5) * 2 * amp;
    const v = Math.max(0, Math.min(255, Math.round(128 + n)));
    px[i * 3] = v; px[i * 3 + 1] = v; px[i * 3 + 2] = v;
  }
  return sharp(px, { raw: { width: W, height: W, channels: 3 } }).png().toBuffer();
}

/** Mid grey with hard stripes — edges, at the same mean value. */
async function striped(period) {
  const px = Buffer.alloc(W * W * 3);
  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const v = Math.floor(x / period) % 2 === 0 ? 96 : 160;
      const i = (y * W + x) * 3;
      px[i] = v; px[i + 1] = v; px[i + 2] = v;
    }
  }
  return sharp(px, { raw: { width: W, height: W, channels: 3 } }).png().toBuffer();
}

// --- A1 palette: two flat fields of different hue must move palette, not edge.
{
  const d = await pixelAxisDeltas(await flat([200, 120, 90]), await flat([90, 160, 120]));
  assert.ok(d.A1 > 0.15, `hue change must move palette, got ${d.A1.toFixed(4)}`);
  assert.ok(d.A3 < 0.02, `flat fields have no edges either way, got ${d.A3.toFixed(4)}`);
  assert.ok(d.A4 < 0.02, `flat fields have no grain either way, got ${d.A4.toFixed(4)}`);
}

// --- A1 must NOT fire on identical images.
{
  const same = await flat([140, 140, 140]);
  const d = await pixelAxisDeltas(same, same);
  for (const axis of Object.keys(d)) {
    assert.ok(d[axis] < 1e-9, `identical images move nothing; ${axis} was ${d[axis]}`);
  }
}

// --- A4 grain: same mean, different noise amplitude.
{
  const d = await pixelAxisDeltas(await grainy(2), await grainy(40));
  assert.ok(d.A4 > 0.1, `grain amplitude must move A4, got ${d.A4.toFixed(4)}`);
  assert.ok(d.A1 < 0.05, `grain must barely move palette, got ${d.A1.toFixed(4)}`);
}

// --- A3 edges: stripes vs flat at a comparable mean.
{
  const d = await pixelAxisDeltas(await striped(8), await flat([128, 128, 128]));
  assert.ok(d.A3 > 0.1, `stripes vs flat must move edge density, got ${d.A3.toFixed(4)}`);
}

// --- A2 value structure: dark vs light, same hue family.
{
  const d = await pixelAxisDeltas(await flat([40, 40, 40]), await flat([210, 210, 210]));
  assert.ok(d.A2 > 0.3, `a value shift must move A2, got ${d.A2.toFixed(4)}`);
}

// --- Spec side reads the kit, and only counts a knob that actually differs.
{
  const a = { sprites: { tree: { style: 'round', canopy: '#111111' } }, wash: { mode: 'multiply' } };
  const b = { sprites: { tree: { style: 'dot', canopy: '#111111' } } };
  const diff = specAxesDiffering(a, b);
  assert.ok(diff.B3.differs, 'tree style is a B3 knob and differs');
  assert.ok(diff.B3.knobs.includes('sprites.tree.style'), 'names the knob that moved');
  assert.ok(!diff.B3.knobs.includes('sprites.tree.canopy'), 'an identical knob is not counted');
  assert.ok(diff.A4.differs, 'wash present on one side only is an A4 difference');
  const same = specAxesDiffering(a, a);
  for (const axis of Object.keys(same)) {
    assert.equal(same[axis].differs, false, `${axis} cannot differ from itself`);
  }
}

// --- A gate that cannot pass is not a gate. Only A1-A4 are measured, and the
// document asks for 6 distinct axes, so a verdict that reports FAIL on the
// total can never be right — proven on a genuinely contrasting pair
// (watercolor-quest vs midnight-carnival) that clears all three heavy axes and
// still could not reach 6. The verdict reports what is PROVABLE: a lower bound
// from axes measured distinct, an upper bound that also allows every unmeasured
// axis whose spec declares a difference, and INDETERMINATE in between.
{
  const axes = Object.keys(AXIS_KNOBS);
  // Everything declared; only A1-A4 painted. Unmeasured axes might still differ.
  const spec = Object.fromEntries(axes.map((a) => [a, { differs: true, knobs: ['k'] }]));
  const pixel = { A1: 1, A2: 1, A3: 1, A4: 1 };
  const thresholds = { A1: 0.05, A2: 0.09, A3: 0.07, A4: 0.02 };
  const v = verdict({ spec, pixel, thresholds });
  assert.equal(v.outcome, 'INDETERMINATE', 'cannot claim fail while 7 axes are unseen');
  assert.equal(v.distinct.length, 4, 'four axes proven distinct');
  assert.ok(v.upperBound >= 6, 'and the unmeasured ones could carry it over the line');
}
{
  // Nothing declared anywhere: the upper bound cannot reach 6, so FAIL is provable.
  const axes = Object.keys(AXIS_KNOBS);
  const spec = Object.fromEntries(axes.map((a) => [a, { differs: false, knobs: [] }]));
  const v = verdict({ spec, pixel: { A1: 0, A2: 0, A3: 0, A4: 0 }, thresholds: { A1: 0.05, A2: 0.09, A3: 0.07, A4: 0.02 } });
  assert.equal(v.outcome, 'FAIL', 'with nothing declared and nothing painted, fail is provable');
}

// --- The gate: an axis counts only when spec AND pixel agree it moved.
{
  const specOnly = { A1: { differs: true, knobs: ['x'] }, A3: { differs: true, knobs: ['y'] } };
  const pixelNone = { A1: 0, A3: 0 };
  const v = verdict({ spec: specOnly, pixel: pixelNone, thresholds: { A1: 0.05, A3: 0.05 } });
  assert.notEqual(v.outcome, 'PASS', 'declared-but-unpainted cannot pass');
  assert.equal(v.states.A1, 'DECLARED-NOT-PAINTED', 'the #577 shape gets its own state');
  assert.deepEqual(v.distinct, [], 'no axis is earned by the spec alone');
}
{
  const pixelOnly = { spec: { A1: { differs: false, knobs: [] } }, pixel: { A1: 0.9 }, thresholds: { A1: 0.05 } };
  const v = verdict(pixelOnly);
  assert.equal(v.states.A1, 'PAINTED-NOT-DECLARED', 'unattributable difference is flagged, not credited');
  assert.deepEqual(v.distinct, [], 'no axis is earned by pixels alone');
}
{
  const both = {
    spec: Object.fromEntries(Object.keys(AXIS_KNOBS).map((a) => [a, { differs: true, knobs: ['k'] }])),
    pixel: Object.fromEntries(Object.keys(AXIS_KNOBS).map((a) => [a, 1])),
    thresholds: Object.fromEntries(Object.keys(AXIS_KNOBS).map((a) => [a, 0.05])),
  };
  const v = verdict(both);
  assert.equal(v.outcome, 'PASS', 'agreement on every axis passes');
  assert.ok(v.heavyDistinct.length >= 3, 'and clears the heavy-axis floor');
  assert.ok(HEAVY_AXES.every((a) => AXIS_KNOBS[a]), 'every heavy axis has knobs mapped');
}

// --- A threshold below its own noise floor reports encoding as style. A3's
// was originally 0.02 against a 0.0232 null; this makes that unrepeatable.
for (const axis of Object.keys(THRESHOLDS)) {
  assert.ok(
    THRESHOLDS[axis] >= ENCODE_NULL[axis] * 3,
    `${axis} threshold ${THRESHOLDS[axis]} must clear 3x its ${ENCODE_NULL[axis]} encode null`,
  );
}

// --- And the null must hold in practice on representative content: a lossy
// re-encode is not a style difference on any measured axis.
{
  const original = await grainy(20); // broad luma histogram, like a real bake
  const reencoded = await sharp(original).webp({ quality: 90 }).toBuffer();
  const d = await pixelAxisDeltas(original, reencoded);
  for (const axis of Object.keys(d)) {
    assert.ok(
      d[axis] < THRESHOLDS[axis],
      `re-encoding must not read as an ${axis} difference: ${d[axis].toFixed(4)} vs ${THRESHOLDS[axis]}`,
    );
  }
}

// --- A known limitation, pinned so it is a documented property rather than a
// surprise: A2 is a luma-histogram distance, so an image with a near-degenerate
// histogram (a couple of exact values, as flat synthetic art has) is maximally
// sensitive to the smoothing any lossy encoder applies. Real bakes have broad
// histograms and null at ~0.03; a two-value image nulls at ~0.38. If a Skin
// ever ships large exactly-flat regions, A2 must not be trusted for it.
{
  const original = await striped(6);
  const reencoded = await sharp(original).webp({ quality: 90 }).toBuffer();
  const d = await pixelAxisDeltas(original, reencoded);
  assert.ok(d.A2 > THRESHOLDS.A2, 'the degenerate-histogram case is known to exceed the A2 bar');
  assert.ok(d.A1 < THRESHOLDS.A1, 'and it is specific to A2 — palette is unaffected');
  assert.ok(d.A4 < THRESHOLDS.A4, 'and grain is unaffected');
}

// --- No invented knobs. Every mapped path must either resolve on a shipped kit
// or be one the builder genuinely reads and no kit populates yet. Anything else
// is a path pointing at a vocabulary that does not exist, which makes its axis
// permanently SAME — a false negative the gate cannot see. Caught `palette`,
// `landmarks` and `sprites.landmark.asset`, all invented.
{
  const dir = 'packages/venue-builder/data/display/kits/';
  const kits = readdirSync(dir).map((f) => JSON.parse(readFileSync(dir + f, 'utf8')));
  const resolves = (kit, path) => {
    const parts = path.replace(/^!/, '').split('.');
    let node = kit;
    for (let i = 0; i < parts.length; i += 1) {
      if (node === undefined || node === null) return false;
      if (parts[i] === '*') {
        if (typeof node !== 'object') return false;
        const rest = parts.slice(i + 1).join('.');
        return Object.values(node).some((v) => (rest ? resolves(v, rest) : v !== undefined));
      }
      node = node[parts[i]];
    }
    return node !== undefined;
  };
  for (const bare of SCHEMA_ONLY_KNOBS) {
    assert.ok(
      !kits.some((k) => resolves(k, bare)),
      `SCHEMA_ONLY_KNOBS lists '${bare}', but a shipped kit populates it — the escape `
        + 'hatch is for unpopulated slots, and a stale entry silences the invented-knob '
        + 'check for a path that no longer needs exempting',
    );
  }
  for (const [axis, paths] of Object.entries(AXIS_KNOBS)) {
    for (const path of paths) {
      const bare = path.replace(/^!/, '');
      const live = kits.some((k) => resolves(k, bare));
      assert.ok(
        live || SCHEMA_ONLY_KNOBS.includes(bare),
        `${axis} maps '${bare}', which no kit populates and the builder does not read — `
          + 'either it is invented, or add it to SCHEMA_ONLY_KNOBS with the reader that proves it real',
      );
    }
  }
}

// --- An axis the kit schema cannot express must say so, not report SAME.
// C1 (landmark iconography) is a heavy axis with no kit-level field at all;
// calling it SAME would claim it was checked and found identical.
{
  const spec = specAxesDiffering({}, {});
  assert.equal(spec.C1.representable, false, 'C1 has no kit-level knob today');
  const v = verdict({ spec, pixel: {}, thresholds: {} });
  assert.equal(v.states.C1, 'NO-KIT-KNOB', 'and the state says so rather than SAME');
  assert.ok(!v.heavyPossible.includes('C1'), 'an inexpressible axis can never be earned');
}

// --- The instrument must account for every axis the document defines.
// Six axes (A5, A6, A7, B6, C3, C4) were absent from AXIS_KNOBS entirely, and
// because the "never earned" banner is derived from AXIS_KNOBS' own keys, they
// were not even reported as missing — the tool read as having checked eleven of
// eleven when the document defines seventeen. Parse the document rather than
// restating its list here, so the two cannot drift apart again.
{
  const doc = readFileSync(
    new URL('../../docs/goals/design-language-axes.md', import.meta.url),
    'utf8',
  );
  // Scope to the scored-axis table. The document carries a second table with
  // the same shape — the v1 -> v2 mapping — and matching both would let a typo
  // there satisfy this check while a real omission in Tier 1 went unnoticed.
  const start = doc.indexOf('## Tier 1');
  const end = doc.indexOf('## Distinctness gate');
  assert.ok(start >= 0 && end > start, 'the axis table headings moved; rescope this test');
  const table = doc.slice(start, end);
  const declared = new Set([...table.matchAll(/^\| ([A-C]\d) \|/gm)].map((m) => m[1]));
  assert.equal(declared.size, 17, `parsed ${declared.size} axes from Tier 1, expected 17`);

  const modelled = new Set([...Object.keys(AXIS_KNOBS), ...Object.keys(UNMAPPED_AXES)]);
  const missing = [...declared].filter((a) => !modelled.has(a));
  const invented = [...modelled].filter((a) => !declared.has(a));
  assert.deepEqual(missing, [], 'every documented axis must be mapped or declared unmapped');
  assert.deepEqual(invented, [], 'the instrument must not name an axis the document does not');

  const both = Object.keys(AXIS_KNOBS).filter((a) => a in UNMAPPED_AXES);
  assert.deepEqual(both, [], 'an axis is either mapped or unmapped, never both');

  for (const [axis, why] of Object.entries(UNMAPPED_AXES)) {
    assert.ok(
      typeof why === 'string' && why.length > 40,
      `${axis} is unmapped without a reason a reader can act on`,
    );
  }
}

// --- Pixel-measured axes must be a subset of the mapped ones, or the "never
// earned" banner would omit an axis that is in fact measured.
{
  const mapped = Object.keys(AXIS_KNOBS);
  const stray = PIXEL_MEASURED.filter((a) => !mapped.includes(a));
  assert.deepEqual(stray, [], 'PIXEL_MEASURED names an axis AXIS_KNOBS does not map');
}

// --- An unset knob does not make its axis dead, and a comment claiming
// otherwise sends a maintainer to stop measuring a live axis. B3 and C2 each
// carry a SCHEMA_ONLY_KNOBS path no kit sets, and each has other knobs that do
// vary: both differ on every pair of the shipped catalogue. A5's only knob is
// unset everywhere, so it reads SAME — checked and identical, which is true —
// rather than being hidden as unmodelled.
{
  const dir = new URL('../../packages/venue-builder/data/display/kits/', import.meta.url);
  const kits = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
  assert.equal(kits.length, 7, 'the shipped catalogue is seven kits');

  const pairs = [];
  for (let i = 0; i < kits.length; i += 1) {
    for (let j = i + 1; j < kits.length; j += 1) pairs.push(specAxesDiffering(kits[i], kits[j]));
  }
  assert.equal(pairs.length, 21);

  for (const axis of ['B3', 'C2']) {
    const n = pairs.filter((s) => s[axis]?.differs).length;
    assert.equal(n, 21, `${axis} differs on ${n}/21 shipped pairs, not 0 — it is not a dead axis`);
  }

  const a5 = pairs.filter((s) => s.A5?.differs).length;
  assert.equal(a5, 0, 'no kit overrides a steep variant yet, so A5 is SAME across the catalogue');
  assert.equal(pairs[0].A5.representable, true, 'A5 is mapped, not inexpressible');
}

/* --- The set gate. The pairwise instrument answers "is B a different world
   from A". ADR-0021 clause 6 asks a different question of the first ship: are
   these Skins EACH their own world? It is explicit about why the count is
   load-bearing — "One Skin cannot fail the beyond-palette distinctness gate,
   so it cannot tell you the kit is wrong"; two can fail it, but a pair that
   passes may be passing on a single axis, and three is the smallest set where
   that cannot hide. So the set gate is every unordered pair, and a set below
   the minimum cannot report PASS at all however clean its one pair looks. */
{
  assert.deepEqual(
    skinSetPairs(['a', 'b', 'c']),
    [['a', 'b'], ['a', 'c'], ['b', 'c']],
    'unordered pairs, in declaration order',
  );
  assert.deepEqual(skinSetPairs(['a']), [], 'one Skin makes no pair');
  assert.throws(() => skinSetPairs(['a', 'b', 'a']), /twice|duplicate/i, 'a Skin is not distinct from itself');

  const at = (outcome) => ({ outcome, pass: outcome === 'PASS' });
  const three = [['a', 'b'], ['a', 'c'], ['b', 'c']];
  const of = (outcomes) => three.map(([a, b], i) => ({ a, b, verdict: at(outcomes[i]) }));

  assert.equal(setVerdict(of(['PASS', 'PASS', 'PASS'])).outcome, 'PASS');
  assert.equal(setVerdict(of(['PASS', 'PASS', 'PASS'])).pass, true);

  const oneFail = setVerdict(of(['PASS', 'FAIL', 'PASS']));
  assert.equal(oneFail.outcome, 'FAIL', 'a set is only as distinct as its closest pair');
  assert.equal(oneFail.pass, false);
  assert.deepEqual(oneFail.failing, [['a', 'c']], 'and it names which pair');

  assert.equal(setVerdict(of(['PASS', 'INDETERMINATE', 'PASS'])).outcome, 'INDETERMINATE');
  assert.deepEqual(setVerdict(of(['PASS', 'INDETERMINATE', 'PASS'])).unproven, [['a', 'c']]);
  assert.equal(
    setVerdict(of(['FAIL', 'INDETERMINATE', 'PASS'])).outcome,
    'FAIL',
    'a proven failure outranks an unproven one — the set is wrong whatever the instrument cannot see',
  );

  // The clause-6 floor. Two Skins whose one pair passes is exactly the
  // near-miss the ADR rejected: it is a real pass on a real pair and still not
  // evidence the kit vocabulary is right. INDETERMINATE and not FAIL is the
  // load-bearing half — the floor withholds a PASS, it does not manufacture a
  // failure out of a short set, which is what keeps the shipped two from
  // becoming a red build.
  const two = setVerdict([{ a: 'a', b: 'b', verdict: at('PASS') }]);
  assert.equal(two.outcome, 'INDETERMINATE', `${MIN_SHIP_SKINS} Skins is the smallest set that can decide`);
  assert.equal(two.pass, false);
  assert.match(two.reason, /three|3/i, 'and it says why rather than reporting a bare unknown');
  assert.equal(setVerdict([]).outcome, 'INDETERMINATE', 'no pairs decides nothing');
  // A failing pair still fails a set too small to pass: the floor withholds a
  // PASS, it does not launder a proven FAIL into "cannot tell" either.
  assert.equal(setVerdict([{ a: 'a', b: 'b', verdict: at('FAIL') }]).outcome, 'FAIL');
}

/* --- The shipped set, spec side. Only two Skins have a certified kings-island
   bake — pixel-tycoon's kit ships and its world PNG does not, and inventing one
   to reach three is the thing this repo refuses to do. So the set the app
   actually ships sits below the clause-6 floor, and this pins both halves of
   that: the one pair it does contain declares enough difference for the gate to
   be reachable at all, and the set verdict is a withheld PASS rather than a
   failure. A Skin whose distinctness lived in its projection, converted to a
   kit that is the same drawing recoloured, would fall under REQUIRED_AXES here
   and be a provable FAIL before a single pixel was baked. */
{
  assert.ok(
    PREVIEW_SKINS.length < MIN_SHIP_SKINS,
    'the shipped set has reached the clause-6 floor — score it with --set and assert the PASS, '
      + `not this holding pattern (${PREVIEW_SKINS.length} Skins ship, floor is ${MIN_SHIP_SKINS})`,
  );

  const dir = new URL('../../packages/venue-builder/data/display/kits/', import.meta.url);
  const kitOf = (id) => JSON.parse(readFileSync(new URL(`${id}.json`, dir), 'utf8'));
  const pairs = skinSetPairs(PREVIEW_SKINS).map(([a, b]) => {
    const spec = specAxesDiffering(kitOf(a), kitOf(b));
    return { a, b, spec, verdict: verdict({ spec, pixel: {}, thresholds: THRESHOLDS }) };
  });
  assert.equal(pairs.length, 1, 'two shipped Skins make one unordered pair');

  for (const { a, b, spec, verdict: v } of pairs) {
    const differing = Object.entries(spec).filter(([, s]) => s.differs).map(([axis]) => axis);
    const heavy = differing.filter((axis) => HEAVY_AXES.includes(axis));
    assert.ok(
      differing.length >= REQUIRED_AXES,
      `${a} vs ${b} declares ${differing.length} differing axes (${differing.join(',')}), under the ${REQUIRED_AXES} the gate needs`,
    );
    assert.ok(
      heavy.length >= REQUIRED_HEAVY,
      `${a} vs ${b} declares ${heavy.length} heavy axes (${heavy.join(',')}), under the ${REQUIRED_HEAVY} the gate needs`,
    );
    assert.notEqual(v.outcome, 'FAIL', `${a} vs ${b} cannot reach the gate from its spec alone`);
  }
  // Below the floor the set is unproven, never failed. Asserted so nobody reads
  // the block above as the gate having been cleared, and so shipping two Skins
  // can never be turned into a red build by this instrument.
  const set = setVerdict(pairs);
  assert.equal(set.outcome, 'INDETERMINATE', 'a set below the floor is unproven, not failed');
  assert.equal(set.pass, false);
  assert.deepEqual(set.failing, [], 'and no pair of it is proven wrong');
  assert.match(set.reason, /fewer than 3 Skins/, 'the withheld PASS names the clause that withholds it');
}

console.log('skin-distinct: ok');
