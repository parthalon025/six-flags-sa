#!/usr/bin/env node
/**
 * Batch-build the top 100 US theme parks from the curated catalog.
 *
 *   npm run venues:build-top100
 *   npm run venues:build-top100 -- --dry-run
 *   npm run venues:build-top100 -- --from 21 --to 30
 *   npm run venues:build-top100 -- --skip-existing --delay 30
 *   npm run venues:build-top100 -- magic-kingdom cedar-point
 */

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCatalog, selectParks } from '../lib/top-parks-catalog.mjs';

const BUILDER_BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build-venue.mjs');
const ATTRACTIONS_BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'attractions.mjs');

const USAGE = `
Build the top 100 US theme parks from the curated catalog.

  node packages/venue-builder/bin/build-top-parks.mjs [options] [venue-id ...]

  --from <rank>         start at this catalog rank (inclusive)
  --to <rank>           stop at this catalog rank (inclusive)
  --skip-existing       skip parks that already have a recipe on disk (default)
  --no-skip-existing    rebuild even when a recipe exists
  --dry-run             print the build commands without running them
  --delay <seconds>     pause between parks (default: 5) to respect Overpass rate limits
  --retries <n>         attempts per park before giving up (default: 3)
  --allow-no-heights    pass through to build-venue for parks with no height rules yet
  --no-attractions      skip the attractions inventory step after each build
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
    attractions: true,
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
    else if (a === '--no-attractions') out.attractions = false;
    else if (a === '--json') out.json = true;
    else if (!a.startsWith('--')) out._.push(a);
    else throw new Error(`Unknown flag: ${a}`);
  }
  return out;
}

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function runNode(script, args) {
  const res = spawnSync(process.execPath, [script, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  return res.status === 0;
}

function buildArgsFor(park, extra = []) {
  const args = [
    '--place', park.place,
    '--name', park.name,
    '--id', park.id,
    '--locality', park.locality,
    '--kind', park.kind || 'theme-park',
  ];
  return args.concat(extra);
}

async function buildPark(park, { dryRun, retries, allowNoHeights, attractions }) {
  const extra = allowNoHeights ? ['--allow-no-heights'] : [];
  const buildArgs = buildArgsFor(park, extra);

  if (dryRun) {
    console.log(`# [${park.rank}] ${park.id}: node build-venue.mjs ${buildArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
    return { id: park.id, rank: park.rank, status: 'dry-run' };
  }

  let built = false;
  let lastError = '';
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    console.error(`\n▶ [${park.rank}/100] ${park.name} (${park.id}) — attempt ${attempt}/${retries}`);
    if (runNode(BUILDER_BIN, buildArgs)) {
      built = true;
      break;
    }
    lastError = `build failed on attempt ${attempt}`;
    if (attempt < retries) {
      const wait = attempt * 60;
      console.error(`  waiting ${wait}s before retry…`);
      await sleep(wait);
    }
  }

  if (!built) {
    return { id: park.id, rank: park.rank, status: 'failed', error: lastError };
  }

  if (attractions) {
    runNode(ATTRACTIONS_BIN, [park.id, '--report']);
  }

  return { id: park.id, rank: park.rank, status: 'built' };
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

  console.error(`Building ${parks.length} of ${catalog.parks.length} catalog parks…`);
  const results = [];

  for (const [i, park] of parks.entries()) {
    const result = await buildPark(park, args);
    results.push(result);
    if (result.status === 'failed') {
      console.error(`  ! ${park.id} failed — continuing with the next park`);
    }
    if (i < parks.length - 1 && !args.dryRun && args.delay > 0) {
      await sleep(args.delay);
    }
  }

  const built = results.filter((r) => r.status === 'built');
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
      console.log('Failed:', failed.map((r) => r.id).join(', '));
    }
  }

  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
