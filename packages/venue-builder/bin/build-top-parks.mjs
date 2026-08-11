#!/usr/bin/env node
/**
 * Batch-build the top 100 US theme parks from the curated catalog.
 *
 * By default each park is built with height rules fetched from its official website:
 *   1. Scaffold sources.json with the park's official URL
 *   2. Build geometry from OpenStreetMap (--allow-no-heights for the first pass)
 *   3. Fetch official attraction listings and write heights.json
 *   4. Rebuild with height rules applied
 *   5. Run attractions inventory
 *
 *   npm run venues:build-top100
 *   npm run venues:build-top100 -- --dry-run
 *   npm run venues:build-top100 -- --from 21 --to 30
 *   npm run venues:build-top100 -- --skip-existing --delay 30
 *   npm run venues:build-top100 -- magic-kingdom cedar-point
 *   npm run venues:build-top100 -- --allow-no-heights   # geometry only, no height fetch
 */

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadCatalog, selectParks } from '../lib/top-parks-catalog.mjs';
import { syncHeightsFromOfficial } from '../lib/heights-from-official.mjs';
import { readJson, VENUE_DIR } from '../lib/venue-io.mjs';

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
  --allow-no-heights    build geometry only; skip official height fetch and final rebuild
  --no-browser          do not use Playwright when the park site is JS-rendered
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
    browser: true,
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
    else if (a === '--no-browser') out.browser = false;
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

function readBuiltPois(id) {
  const file = path.join(VENUE_DIR, `${id}.pois.json`);
  if (!existsSync(file)) return null;
  return readJson(file);
}

async function runBuild(park, extra, { dryRun, retries, label }) {
  const buildArgs = buildArgsFor(park, extra);
  if (dryRun) {
    console.log(`# [${park.rank}] ${label}: node build-venue.mjs ${buildArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
    return true;
  }
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    console.error(`  · ${label} — attempt ${attempt}/${retries}`);
    if (runNode(BUILDER_BIN, buildArgs)) return true;
    if (attempt < retries) {
      const wait = attempt * 60;
      console.error(`    waiting ${wait}s before retry…`);
      await sleep(wait);
    }
  }
  return false;
}

async function buildPark(park, opts) {
  const {
    dryRun, retries, allowNoHeights, browser, attractions,
  } = opts;

  if (dryRun) {
    await runBuild(park, allowNoHeights ? ['--allow-no-heights'] : ['--allow-no-heights'], { dryRun, retries, label: 'geometry' });
    if (!allowNoHeights) {
      console.log(`# [${park.rank}] ${park.id}: fetch official heights → data/venues/${park.id}.heights.json`);
      await runBuild(park, [], { dryRun, retries, label: 'final' });
    }
    return { id: park.id, rank: park.rank, status: 'dry-run' };
  }

  console.error(`\n▶ [${park.rank}/100] ${park.name} (${park.id})`);

  if (!await runBuild(park, ['--allow-no-heights'], { dryRun, retries, label: 'geometry from OpenStreetMap' })) {
    return { id: park.id, rank: park.rank, status: 'failed', error: 'geometry build failed' };
  }

  if (!allowNoHeights) {
    const pois = readBuiltPois(park.id);
    if (!pois?.length) {
      return { id: park.id, rank: park.rank, status: 'failed', error: 'no POIs after geometry build' };
    }

    console.error('  · fetching height rules from the park website…');
    let heights;
    try {
      heights = await syncHeightsFromOfficial(park, pois, { browser, fetchDetails: true });
    } catch (err) {
      return { id: park.id, rank: park.rank, status: 'failed', error: `height fetch failed: ${err.message}` };
    }

    console.error(
      `  · heights: ${heights.ruleCount} rule(s) for ${heights.matched}/${heights.rideCount} rides `
        + `(site listed ${heights.siteCount} attraction(s))`,
    );
    if (heights.officialErrors?.length) {
      console.error(`  · official fetch warnings: ${heights.officialErrors.join('; ')}`);
    }
    if (!heights.ruleCount) {
      return {
        id: park.id,
        rank: park.rank,
        status: 'failed',
        error: 'no height rules could be sourced from the official website',
      };
    }

    if (!await runBuild(park, [], { dryRun, retries, label: 'final build with height rules' })) {
      return { id: park.id, rank: park.rank, status: 'failed', error: 'final build failed' };
    }
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

  const mode = args.allowNoHeights ? 'geometry only' : 'with official height rules';
  console.error(`Building ${parks.length} of ${catalog.parks.length} catalog parks (${mode})…`);
  const results = [];

  for (const [i, park] of parks.entries()) {
    const result = await buildPark(park, args);
    results.push(result);
    if (result.status === 'failed') {
      console.error(`  ! ${park.id} failed: ${result.error || 'unknown error'} — continuing`);
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
