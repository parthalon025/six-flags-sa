#!/usr/bin/env node
/**
 * Build or check the generated design-system bundle.
 *
 *   node scripts/design-bundle.mjs build
 *   node scripts/design-bundle.mjs check
 *   npm run design:build
 *   npm run design:check
 *
 * `--build` / `--check` work too: a generator whose whole job is preventing
 * drift is a poor place to be strict about which spelling someone reached for.
 *
 * The bundle under docs/design/system/ is derived from the app on every build.
 * `check` fails when the committed bundle no longer matches what the sources
 * would produce, so a token edited in globals.css and not regenerated is caught
 * in CI rather than in a design session three weeks later.
 */
import { writeDesignBundle, checkDesignBundle, OUT_DIR } from './lib/design-bundle/compose.mjs';

const arg = process.argv[2] || 'check';
const mode = arg.replace(/^--/, '');

/* The cross-checks the build runs against the app. They never fail the build:
   they describe the app, and the app is allowed to have problems the mirror
   is not allowed to hide. Echoing them is how they get noticed. */
const plain = (html) => html.replace(/<\/?code>/g, '`').replace(/<[^>]+>/g, '');

function echoFindings(model) {
  if (!model.findings.length) return;
  console.log(`\ndesign-bundle: ${model.findings.length} cross-check finding(s) in the app:`);
  for (const f of model.findings) console.log(`  - ${plain(f)}`);
}

if (mode === 'build') {
  const { written, model } = await writeDesignBundle();
  console.log(`design-bundle: wrote ${written.length} files to ${OUT_DIR}/`);
  for (const p of written) console.log(`  ${p}`);
  echoFindings(model);
  process.exit(0);
}

if (mode === 'check') {
  const { drift, model } = await checkDesignBundle();
  if (drift.length) {
    console.error('design-bundle: the committed bundle is stale. Run: npm run design:build');
    for (const d of drift) console.error(`  ${d.path} (${d.reason})`);
    process.exit(1);
  }
  console.log('design-bundle: ok');
  echoFindings(model);
  process.exit(0);
}

console.error('Usage: node scripts/design-bundle.mjs <build|check>');
process.exit(1);
