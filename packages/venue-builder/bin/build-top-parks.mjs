#!/usr/bin/env node
/**
 * Batch-build the top 100 US theme parks through the unified venue pipeline.
 *
 * Each park runs the same stages as a hand-built venue:
 *   sources → geometry → research → heights → rebuild → attractions → agent
 *
 * Imagery, trace, and merge datasets wired in sources.json are picked up on rebuild.
 *
 *   npm run venues:build-top100
 *   npm run venues:build-top100 -- --dry-run
 *   npm run venues:build-top100 -- --from 21 --to 30
 *   npm run venues:build-top100 -- --skip-existing --delay 30
 *   npm run venues:build-top100 -- magic-kingdom cedar-point
 *   npm run venues:build-top100 -- --allow-no-heights   # geometry only
 */

import { loadCatalog, resolveAllowNoHeights, selectParks } from '../lib/top-parks-catalog.mjs';
import { runVenuePipeline } from '../lib/build-pipeline.mjs';

const USAGE = `
Build the top 100 US theme parks through the unified venue pipeline.

  node packages/venue-builder/bin/build-top-parks.mjs [options] [venue-id ...]

  --from <rank>         start at this catalog rank (inclusive)
  --to <rank>           stop at this catalog rank (inclusive)
  --skip-existing       skip parks that already have a recipe on disk (default)
  --no-skip-existing    rebuild even when a recipe exists
  --dry-run             print pipeline stages without running them
  --delay <seconds>     pause between parks (default: 5)
  --retries <n>         attempts per build step (default: 3)
  --allow-no-heights    geometry only for every selected park (overrides catalog)
  --strict-heights      force heights gate even for zoo/water-park catalog entries
  --no-browser          skip Playwright for JS-rendered park sites
  --no-attractions      skip attractions inventory
  --no-agent            skip build-agent (QA, GIS, vision, validation)
  --json                structured summary on stdout
`;

function parseArgs(argv) {
  const out = {
    _: [],
    from: null,
    to: null,
    skipExisting: true,
    dryRun: false,
    delay: 5,
    retries: 3,
    allowNoHeights: false,
    strictHeights: false,
    browser: true,
    attractions: true,
    agent: true,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--from') out.from = Number(argv[++i]);
    else if (a === '--to') out.to = Number(argv[++i]);
    else if (a === '--skip-existing') out.skipExisting = true;
    else if (a === '--no-skip-existing') out.skipExisting = false;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--delay') out.delay = Number(argv[++i]);
    else if (a === '--retries') out.retries = Number(argv[++i]);
    else if (a === '--allow-no-heights') out.allowNoHeights = true;
    else if (a === '--strict-heights') out.strictHeights = true;
    else if (a === '--no-browser') out.browser = false;
    else if (a === '--no-attractions') out.attractions = false;
    else if (a === '--no-agent') out.agent = false;
    else if (a === '--json') out.json = true;
    else if (!a.startsWith('--')) out._.push(a);
    else throw new Error(`Unknown flag: ${a}`);
  }
  return out;
}

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalog = loadCatalog();
  const parks = selectParks(catalog.parks, {
    skipExisting: args.skipExisting,
    from: args.from ?? undefined,
    to: args.to ?? undefined,
    only: args._.length ? args._ : undefined,
  });

  if (!parks.length) {
    console.error('Nothing to build — every selected park already has a recipe, or the filter matched nothing.');
    console.error(USAGE.trim());
    process.exit(0);
  }

  const anyHeightless = parks.some((p) =>
    resolveAllowNoHeights(p, {
      cliAllowNoHeights: args.allowNoHeights,
      cliStrictHeights: args.strictHeights,
    }),
  );
  const mode = anyHeightless
    ? 'mixed (catalog height-less kinds + per-park resolution)'
    : 'full pipeline (OSM + research + heights + agent)';
  console.error(`Building ${parks.length} of ${catalog.parks.length} catalog parks (${mode})…`);

  const sharedOpts = {
    dryRun: args.dryRun,
    retries: args.retries,
    browser: args.browser,
    attractions: args.attractions,
    agent: args.agent,
    rebuildOnly: args.skipExisting,
  };

  const results = [];
  for (const [i, park] of parks.entries()) {
    const allowNoHeights = resolveAllowNoHeights(park, {
      cliAllowNoHeights: args.allowNoHeights,
      cliStrictHeights: args.strictHeights,
    });
    const pipelineOpts = {
      ...sharedOpts,
      allowNoHeights,
      skip: allowNoHeights ? ['research', 'heights', 'rebuild', 'agent'] : [],
    };
    const result = await runVenuePipeline(park, pipelineOpts);
    results.push(result);
    if (result.status === 'failed') {
      console.error(`  ! ${park.id} failed: ${result.error || 'unknown error'} — continuing`);
    }
    if (i < parks.length - 1 && !args.dryRun && args.delay > 0) {
      await sleep(args.delay);
    }
  }

  const built = results.filter((r) => r.status === 'built' || r.status === 'dry-run');
  const failed = results.filter((r) => r.status === 'failed');
  const skipped = catalog.parks.length - parks.length;

  const summary = {
    catalog: catalog.parks.length,
    selected: parks.length,
    built: built.length,
    failed: failed.length,
    skippedExisting: args.skipExisting ? skipped : 0,
    results,
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`\n==== ${built.length} built, ${failed.length} failed, ${skipped} skipped (already on disk) ====`);
    if (failed.length) {
      for (const row of failed) {
        console.log(`  ${row.id}: ${row.error || 'failed'}`);
      }
    }
  }

  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
