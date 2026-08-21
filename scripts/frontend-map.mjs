#!/usr/bin/env node
/**
 * Build or check the generated front-end map, and gate the app's contrast.
 *
 *   node scripts/frontend-map.mjs build
 *   node scripts/frontend-map.mjs check
 *   node scripts/frontend-map.mjs contrast
 *   npm run frontend:map
 *   npm run frontend:map:check
 *   npm run frontend:contrast
 *
 * `--build` / `--check` / `--contrast` work too, the same way design-bundle.mjs
 * accepts both spellings: a generator whose whole job is preventing drift is a
 * poor place to be strict about which one somebody reached for.
 *
 * The map under docs/agents/ is derived from the app on every build. `check`
 * fails when the committed map no longer matches what the sources produce — a
 * screen that moved, a class that became shared, a component that lost its
 * importer — and when a CSS token and the JS constant its own comment names
 * have come apart. That last one is not staleness, it is a bug: `--peek` shipped
 * at 308px against a SHEET_PEEK_PX of 236 and no test failed.
 */
import { writeMap, checkMap, OUT_PATH } from './lib/frontend-map/compose.mjs';
import { measureContrast } from './lib/frontend-map/contrast.mjs';

const arg = process.argv[2] || 'check';
const mode = arg.replace(/^--/, '');

/** Gaps and diverged pairs, in the same voice whichever mode found them. */
function echoModel(model) {
  for (const p of model.pairs.diverged) {
    console.error(
      `  ${p.css} is ${p.cssValue} in globals.css (${p.palette}) but ${p.js} is ` +
        `${JSON.stringify(p.value)} in ${p.file} — the stylesheet and the app disagree.`,
    );
  }
  if (model.gaps.length) {
    console.log(`\nfrontend-map: ${model.gaps.length} thing(s) this map could not derive:`);
    for (const g of model.gaps) console.log(`  - ${g}`);
  }
}

const fmt = (r) => (r === null ? '  —  ' : `${r.toFixed(2)}:1`.padStart(7));

/** Non-zero only on something new. A gate nobody can run is not a gate. */
function contrastReport() {
  const c = measureContrast();
  console.log('frontend-contrast: token pairings the app paints, both palettes\n');
  for (const r of c.rows) {
    const state = !r.judged ? r.status : r.worst >= r.floor ? 'ok' : 'BELOW FLOOR';
    console.log(
      `  ${state.padEnd(11)} ${`${r.fg} on ${r.bg}`.padEnd(26)} floor ${r.floor}:1  ` +
        `night ${fmt(r.night)}  day ${fmt(r.day)}  ${r.where}`,
    );
  }
  for (const t of c.tracked) {
    console.log(
      `\nfrontend-contrast: known — ${t.key} at ${t.worst.toFixed(2)}:1 ` +
        `(${t.issue ? `#${t.issue}` : 'NO ISSUE YET — file one'}). ${t.why}`,
    );
  }
  for (const f of c.fixed) {
    console.log(
      `\nfrontend-contrast: ${f.pair} is no longer failing. Remove its entry from ` +
        `scripts/lib/frontend-map/contrast-known.mjs so the next regression on it is caught.`,
    );
  }
  if (c.regressions.length) {
    console.error(`\nfrontend-contrast: ${c.regressions.length} pairing(s) newly below their floor:`);
    for (const r of c.regressions) {
      console.error(
        `  ${r.fg} on ${r.bg} (${r.where}) reads ${r.worst.toFixed(2)}:1 in ${r.worstPalette}, ` +
          `under its ${r.floor}:1 floor.`,
      );
    }
    console.error(
      '\nFix the pairing, or — if it is being accepted for now — add it to ' +
        'scripts/lib/frontend-map/contrast-known.mjs with the issue tracking it.',
    );
    return 1;
  }
  console.log('\nfrontend-contrast: no new failures.');
  return 0;
}

if (mode === 'build') {
  const { written, model } = await writeMap();
  console.log(`frontend-map: wrote ${written.join(', ')}`);
  echoModel(model);
  process.exit(model.pairs.diverged.length ? 1 : 0);
}

if (mode === 'check') {
  const { drift, model } = await checkMap();
  if (drift.length) {
    console.error(`frontend-map: ${OUT_PATH} is stale. Run: npm run frontend:map`);
    for (const d of drift) console.error(`  ${d.path} (${d.reason})`);
  }
  if (model.pairs.diverged.length) {
    console.error('frontend-map: a token and the JS constant its comment names have come apart:');
  }
  if (drift.length || model.pairs.diverged.length) {
    echoModel(model);
    process.exit(1);
  }
  console.log('frontend-map: ok');
  echoModel(model);
  process.exit(0);
}

if (mode === 'contrast') process.exit(contrastReport());

console.error('Usage: node scripts/frontend-map.mjs <build|check|contrast>');
process.exit(1);
