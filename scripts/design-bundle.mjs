#!/usr/bin/env node
/**
 * Build or check the generated design-system bundle.
 *
 *   node scripts/design-bundle.mjs build
 *   node scripts/design-bundle.mjs check
 *   node scripts/design-bundle.mjs plan [--json]
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
import {
  writeDesignBundle,
  checkDesignBundle,
  composeDesignBundle,
  designSyncPlan,
  auditPushReadiness,
  DESIGN_SYNC_LIMITS,
  OUT_DIR,
} from './lib/design-bundle/compose.mjs';

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

/* `plan` prints the bundle exactly as DesignSync would push it, and exits
   non-zero if any of its limits is breached. It exists so the push wizard and
   the test can both read the real paths off the generator instead of each
   keeping a copy of them — a list of nine filenames written down twice is a
   list that is wrong once. */
if (mode === 'plan') {
  const plan = await designSyncPlan();
  const { model, pages } = await composeDesignBundle();
  const problems = auditPushReadiness(plan, pages, model.pageIndex);
  const asJson = process.argv.includes('--json');

  /* --json puts NOTHING but JSON on stdout. The wizard pipes this straight into
     JSON.parse, and an earlier version printed the human "pushable" line after
     the object — which parsed fine by eye and threw on line 90. Anything for a
     human goes to stderr in this mode. */
  if (asJson) {
    console.log(
      JSON.stringify({ pushRoot: OUT_DIR, limits: DESIGN_SYNC_LIMITS, files: plan, problems }, null, 2),
    );
  } else {
    console.log(`push root: ${OUT_DIR}/  (${plan.length} files)\n`);
    const width = Math.max(...plan.map((f) => f.projectPath.length));
    for (const f of plan) {
      const kb = (f.bytes / 1024).toFixed(1).padStart(7);
      console.log(`  ${f.projectPath.padEnd(width)}  ${kb} KiB  ${f.mimeType}`);
    }
    const total = plan.reduce((n, f) => n + f.bytes, 0);
    console.log(`\n  ${'total'.padEnd(width)}  ${(total / 1024).toFixed(1).padStart(7)} KiB`);
  }

  if (problems.length) {
    console.error('\ndesign-bundle: this bundle is NOT pushable:');
    for (const o of problems) console.error(`  ${o}`);
    process.exit(1);
  }
  if (!asJson) {
    console.log('\ndesign-bundle: pushable — every reference resolves inside the push root.');
  }
  process.exit(0);
}

console.error('Usage: node scripts/design-bundle.mjs <build|check|plan>');
process.exit(1);
