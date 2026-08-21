#!/usr/bin/env node
/** Is Skin B a different world from Skin A, or the same drawing recoloured?
 *
 *   node packages/venue-builder/bin/display-distinct.mjs <venue> <skinA> <skinB> [--json]
 *   node packages/venue-builder/bin/display-distinct.mjs <venue> <skin> --null
 *
 * Reads the two kit specs and the two baked worlds, scores every AXIS_KNOBS-
 * mapped axis from both sides, and requires them to agree before crediting an
 * axis. The axes in UNMAPPED_AXES are not scored at all and are listed on every
 * run. Exits 0 when the gate in docs/goals/design-language-axes.md is cleared,
 * 1 when it provably cannot be, and 3 when the instrument cannot tell.
 *
 * Deterministic: same inputs, same verdict. No sampling, no clock.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AXIS_KNOBS,
  HEAVY_AXES,
  PIXEL_MEASURED,
  REQUIRED_AXES,
  REQUIRED_HEAVY,
  ENCODE_NULL,
  THRESHOLDS,
  UNMAPPED_AXES,
  assertPixelMeasuredMatches,
  pixelAxisDeltas,
  specAxesDiffering,
  verdict,
} from '../lib/skin-distinct.mjs';

const BUILDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(BUILDER, '../..');

const [venue, skinA, skinB] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const asJson = process.argv.includes('--json');
const asNull = process.argv.includes('--null');
if (!venue || !skinA || (!skinB && !asNull)) {
  console.error('usage: display-distinct <venue> <skinA> <skinB> [--json]');
  console.error('       display-distinct <venue> <skin> --null');
  process.exit(2);
}

// 0 pass, 1 fail, 3 indeterminate: a gate that cannot see an axis must not
// report a clean pass, and must not claim a failure it has not proven. --json
// and the human table are the same gate, so they exit the same way.
const exitFor = (outcome) => (outcome === 'PASS' ? 0 : outcome === 'FAIL' ? 1 : 3);

const kitPath = (skin) => path.join(BUILDER, 'data/display/kits', `${skin}.json`);
const bakeOnly = (skin) =>
  path.join(REPO, 'apps/party-tracker/public/venues', venue, 'display', `${skin}.world.png`);

// --null: what one world scores against a lossy re-encode of itself. This is
// the floor every threshold must clear, and it is what ENCODE_NULL records —
// runnable rather than a number somebody measured once by hand.
if (asNull) {
  const { default: sharp } = await import('sharp');
  const file = bakeOnly(skinA);
  if (!existsSync(file)) {
    console.error(`missing ${path.relative(REPO, file)}`);
    process.exit(2);
  }
  const reencoded = await sharp(file).webp({ quality: 90 }).toBuffer();
  const measured = await pixelAxisDeltas(file, reencoded);
  assertPixelMeasuredMatches(measured);
  console.log(`\n  encode null for ${venue}/${skinA} (webp q90)\n`);
  console.log('  axis   measured    checked in    threshold   ratio');
  for (const axis of Object.keys(measured)) {
    const ratio = measured[axis] > 0 ? (THRESHOLDS[axis] / measured[axis]).toFixed(1) : 'inf';
    console.log(
      `  ${axis}     ${measured[axis].toFixed(4)}      ${String(ENCODE_NULL[axis]).padEnd(9)}     `
        + `${String(THRESHOLDS[axis]).padEnd(9)}   ${ratio}x`,
    );
  }
  console.log('\n  A threshold must clear 3x its null, or encoding reads as style.\n');
  process.exit(0);
}
const bakePath = (skin) =>
  path.join(REPO, 'apps/party-tracker/public/venues', venue, 'display', `${skin}.world.png`);

for (const skin of [skinA, skinB]) {
  for (const f of [kitPath(skin), bakePath(skin)]) {
    if (!existsSync(f)) {
      console.error(`missing ${path.relative(REPO, f)} — cannot compare soundly`);
      process.exit(2);
    }
  }
}

const spec = specAxesDiffering(
  JSON.parse(readFileSync(kitPath(skinA), 'utf8')),
  JSON.parse(readFileSync(kitPath(skinB), 'utf8')),
);
const pixel = await pixelAxisDeltas(bakePath(skinA), bakePath(skinB));
// The "never earned" banner below is only true if PIXEL_MEASURED still names
// exactly what pixelAxisDeltas returns. Assert it on every run, not just --null.
assertPixelMeasuredMatches(pixel);
const result = verdict({ spec, pixel, thresholds: THRESHOLDS });

if (asJson) {
  console.log(JSON.stringify({ venue, skinA, skinB, spec, pixel, unmapped: UNMAPPED_AXES, ...result }, null, 2));
  process.exit(exitFor(result.outcome));
}

const MARK = {
  DISTINCT: '✓',
  'DECLARED-NOT-PAINTED': '!',
  'PAINTED-NOT-DECLARED': '?',
  'DECLARED-UNMEASURED': '·',
  'NO-KIT-KNOB': '×',
  SAME: ' ',
};

console.log(`\n  ${venue}: ${skinA} vs ${skinB}\n`);
console.log('  axis        state                  spec                              pixel');
console.log('  ' + '─'.repeat(84));
for (const axis of Object.keys(AXIS_KNOBS)) {
  const heavy = HEAVY_AXES.includes(axis) ? '*' : ' ';
  const state = result.states[axis];
  const knobs = spec[axis].representable === false
    ? 'the kit schema cannot express this'
    : spec[axis].knobs.length
      ? `${spec[axis].knobs.length} knob${spec[axis].knobs.length > 1 ? 's' : ''}: ${spec[axis].knobs.slice(0, 2).join(', ')}`
      : 'no knob differs';
  const measured = PIXEL_MEASURED.includes(axis)
    ? `${pixel[axis].toFixed(4)} / ${THRESHOLDS[axis]}`
    : 'not measured';
  console.log(
    `  ${axis}${heavy}  ${MARK[state]} ${state.padEnd(21)} ${knobs.slice(0, 33).padEnd(33)} ${measured}`,
  );
}
console.log('  ' + '─'.repeat(84));
console.log(
  `\n  * heavy axis. ✓ both sides agree · ! declared, not painted · ? painted, not declared`
    + `\n  × the kit schema has no field for this axis at all\n`,
);
console.log(
  `  proven distinct: ${result.lowerBound}/${REQUIRED_AXES}   heavy: ${result.heavyDistinct.length}/${REQUIRED_HEAVY}`,
);
console.log(
  `  could still reach: ${result.upperBound}/${REQUIRED_AXES}   heavy: ${result.heavyPossible.length}/${REQUIRED_HEAVY}`
    + `   (unmeasured axes that declare a difference)`,
);

const notPainted = Object.entries(result.states).filter(([, s]) => s === 'DECLARED-NOT-PAINTED');
if (notPainted.length) {
  console.log(`\n  Declared but not painted — the kit claims these and the bake does not show them:`);
  for (const [axis] of notPainted) console.log(`    ${axis}: ${spec[axis].knobs.join(', ')}`);
}
const unmeasured = Object.keys(AXIS_KNOBS).filter((a) => !PIXEL_MEASURED.includes(a));
console.log(`\n  Not measured in pixels, so never earned: ${unmeasured.join(', ')}`);
console.log(`  These need per-class segmentation; until then they cannot count toward the gate.`);

// Axes the design language defines and this instrument does not model at all.
// Printed on every run: a tool that silently drops six of seventeen axes reads
// as having checked them.
const unmapped = Object.keys(UNMAPPED_AXES);
console.log(`\n  Not modelled by this tool at all: ${unmapped.join(', ')}`);
for (const axis of unmapped) console.log(`    ${axis}: ${UNMAPPED_AXES[axis]}`);
console.log('');
const EXPLAIN = {
  PASS: 'the proven axes already clear the gate',
  FAIL: 'even crediting every spec-mapped unmeasured axis, the gate cannot be '
    + 'reached — the axes this tool does not model at all sit outside this bound',
  INDETERMINATE:
    'the proven axes do not clear the gate, but the spec-mapped unmeasured ones '
    + 'could — this is a statement about the instrument, not about the art',
};
console.log(`  ${result.outcome} — ${EXPLAIN[result.outcome]}\n`);
process.exit(exitFor(result.outcome));
