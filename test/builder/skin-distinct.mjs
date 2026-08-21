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
import {
  ENCODE_NULL,
  THRESHOLDS,
  HEAVY_AXES,
  AXIS_KNOBS,
  specAxesDiffering,
  pixelAxisDeltas,
  verdict,
} from '../../packages/venue-builder/lib/skin-distinct.mjs';

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

console.log('skin-distinct: ok');
