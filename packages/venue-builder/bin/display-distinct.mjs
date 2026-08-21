#!/usr/bin/env node
/** Is Skin B a different world from Skin A, or the same drawing recoloured?
 *
 *   node packages/venue-builder/bin/display-distinct.mjs <venue> <skinA> <skinB> [--json]
 *
 * Reads the two kit specs and the two baked worlds, scores every design axis
 * from both sides, and requires them to agree before crediting an axis. Exits
 * 1 when the pair does not clear the gate in docs/goals/design-language-axes.md.
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
  THRESHOLDS,
  pixelAxisDeltas,
  specAxesDiffering,
  verdict,
} from '../lib/skin-distinct.mjs';

const BUILDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(BUILDER, '../..');

const [venue, skinA, skinB] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const asJson = process.argv.includes('--json');
if (!venue || !skinA || !skinB) {
  console.error('usage: display-distinct <venue> <skinA> <skinB> [--json]');
  process.exit(2);
}

const kitPath = (skin) => path.join(BUILDER, 'data/display/kits', `${skin}.json`);
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
const result = verdict({ spec, pixel, thresholds: THRESHOLDS });

if (asJson) {
  console.log(JSON.stringify({ venue, skinA, skinB, spec, pixel, ...result }, null, 2));
  process.exit(result.pass ? 0 : 1);
}

const MARK = {
  DISTINCT: '✓',
  'DECLARED-NOT-PAINTED': '!',
  'PAINTED-NOT-DECLARED': '?',
  'DECLARED-UNMEASURED': '·',
  SAME: ' ',
};

console.log(`\n  ${venue}: ${skinA} vs ${skinB}\n`);
console.log('  axis        state                  spec                              pixel');
console.log('  ' + '─'.repeat(84));
for (const axis of Object.keys(AXIS_KNOBS)) {
  const heavy = HEAVY_AXES.includes(axis) ? '*' : ' ';
  const state = result.states[axis];
  const knobs = spec[axis].knobs.length
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
console.log(`\n  * heavy axis. ✓ both sides agree · ! declared, not painted · ? painted, not declared\n`);
console.log(`  distinct: ${result.distinct.length}/${REQUIRED_AXES}   heavy: ${result.heavyDistinct.length}/${REQUIRED_HEAVY}`);

const notPainted = Object.entries(result.states).filter(([, s]) => s === 'DECLARED-NOT-PAINTED');
if (notPainted.length) {
  console.log(`\n  Declared but not painted — the kit claims these and the bake does not show them:`);
  for (const [axis] of notPainted) console.log(`    ${axis}: ${spec[axis].knobs.join(', ')}`);
}
const unmeasured = Object.keys(AXIS_KNOBS).filter((a) => !PIXEL_MEASURED.includes(a));
console.log(`\n  Not measured in pixels, so never earned: ${unmeasured.join(', ')}`);
console.log(`  These need per-class segmentation; until then they cannot count toward the gate.\n`);
console.log(`  ${result.pass ? 'PASS' : 'FAIL'}\n`);
process.exit(result.pass ? 0 : 1);
