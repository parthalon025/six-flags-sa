/**
 * Unified venue build pipeline — one path for a single park or a batch run.
 *
 * Stages (in order):
 *   1. sources   — scaffold data/venues/<id>.sources.json with official URLs
 *   2. geometry  — build-venue from OpenStreetMap (--allow-no-heights)
 *   3. research  — official site + ParksAPI via the build-agent research stack
 *   4. heights   — write heights.json from official cache matched to bundle rides
 *   5. rebuild   — build-venue --rebuild (imagery, trace, merge wired from sources)
 *   6. attractions — entrance inventory and evidence sidecar
 *   7. agent     — QA, GIS, vision, validation (--apply publishes entrances)
 *   8. certify   — report + compare + route-qa + ask; writes certification.json
 *   9. display   — per-Skin visual specs + display-certify (opt-in, --display)
 */

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readJson, VENUE_DIR } from './venue-io.mjs';
import { recipeFile } from './venue-recipe.mjs';
import { ensureSourcesCatalogue, syncHeightsFromOfficial } from './heights-from-official.mjs';
import { runResearchAgent } from './agents/research.mjs';
import { runBuildOrchestrator } from './agents/orchestrator.mjs';
import { certifyVenue } from './venue-certify.mjs';
import { proposeAliases, applyAliasClaims } from './auto-alias.mjs';
import { loadParksApiData } from './adapters/parks-api.mjs';
import { readSources } from './venue-sources.mjs';
import { loadOfficialData } from './venue-official-site.mjs';

const BUILDER_ROOT = path.dirname(fileURLToPath(import.meta.url));
const BUILDER_BIN = path.join(BUILDER_ROOT, '..', 'bin', 'build-venue.mjs');
const ATTRACTIONS_BIN = path.join(BUILDER_ROOT, '..', 'bin', 'attractions.mjs');

export const STAGES = [
  'sources',
  'geometry',
  'research',
  'aliases',
  'heights',
  'rebuild',
  'attractions',
  'agent',
  'certify',
  'display',
];

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

function readBuiltPois(id) {
  const file = path.join(VENUE_DIR, `${id}.pois.json`);
  if (!existsSync(file)) return null;
  return readJson(file);
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

async function runBuildWithRetries(label, args, { retries = 3, dryRun = false } = {}) {
  if (dryRun) {
    console.log(`# ${label}: node build-venue.mjs ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
    return true;
  }
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    console.error(`  · ${label} — attempt ${attempt}/${retries}`);
    if (runNode(BUILDER_BIN, args)) return true;
    if (attempt < retries) {
      const wait = attempt * 60;
      console.error(`    waiting ${wait}s before retry…`);
      await sleep(wait);
    }
  }
  return false;
}

/**
 * Run the full builder pipeline for one park.
 *
 * @param {object} park catalog row with id, name, place, locality
 * @param {object} opts
 */
export async function runVenuePipeline(park, opts = {}) {
  const {
    dryRun = false,
    retries = 3,
    allowNoHeights = false,
    applyAliases = true,
    browser = true,
    attractions = true,
    agent = true,
    certify = true,
    display = false,
    skip = [],
  } = opts;

  const stages = {};
  const logStage = (name, detail) => {
    stages[name] = detail;
  };

  if (dryRun) {
    console.log(`# [${park.rank ?? '?'}] ${park.id} — unified pipeline`);
    if (!skip.includes('sources')) console.log(`#   sources → data/venues/${park.id}.sources.json`);
    if (!skip.includes('geometry')) {
      await runBuildWithRetries('geometry', buildArgsFor(park, ['--allow-no-heights']), { dryRun: true });
    }
    if (!skip.includes('research')) console.log(`#   research → official cache + ParksAPI`);
    if (!skip.includes('aliases') && applyAliases) console.log(`#   aliases → official name claims`);
    if (!skip.includes('heights') && !allowNoHeights) {
      console.log(`#   heights → data/venues/${park.id}.heights.json`);
    }
    if (!skip.includes('rebuild') && !allowNoHeights) {
      await runBuildWithRetries('rebuild', ['--rebuild', park.id], { dryRun: true });
    }
    if (!skip.includes('attractions') && attractions) {
      console.log(`#   attractions → inventory + evidence`);
    }
    if (!skip.includes('agent') && agent) {
      console.log(`#   agent → QA, GIS, vision, validation --apply`);
    }
    if (!skip.includes('certify') && certify) {
      console.log(`#   certify → report + compare + route-qa + ask`);
    }
    if (!skip.includes('display') && display) {
      console.log(`#   display → visual specs + display-certify`);
    }
    return { id: park.id, rank: park.rank, status: 'dry-run', stages };
  }

  console.error(`\n▶ ${park.name} (${park.id})`);

  if (!skip.includes('sources')) {
    console.error('  · sources: catalogue');
    const catalog = ensureSourcesCatalogue(park);
    logStage('sources', {
      file: `data/venues/${park.id}.sources.json`,
      imagery: catalog.datasets?.imagery?.length || 0,
      trace: catalog.datasets?.trace?.length || 0,
      merge: catalog.datasets?.merge?.length || 0,
    });
  }

  const hasRecipe = existsSync(recipeFile(park.id));

  if (!skip.includes('geometry')) {
    if (hasRecipe && opts.rebuildOnly) {
      logStage('geometry', { skipped: 'recipe on disk' });
    } else {
      const ok = await runBuildWithRetries(
        'geometry from OpenStreetMap',
        buildArgsFor(park, ['--allow-no-heights']),
        { retries },
      );
      if (!ok) {
        return { id: park.id, rank: park.rank, status: 'failed', error: 'geometry build failed', stages };
      }
      logStage('geometry', { built: true });
    }
  }

  if (!allowNoHeights) {
    if (!skip.includes('research')) {
      console.error('  · research: official site + ParksAPI');
      try {
        const research = await runResearchAgent(park.id, {
          fetch: true,
          browser,
          parksApi: true,
          fetchDetails: true,
          offline: false,
          openResearch: true,
          ai: opts.ai ?? false,
          applyAliases: false,
        });
        logStage('research', {
          officialMatched: research.packet?.official?.matched ?? null,
          siteCount: research.packet?.official?.siteCount ?? null,
          parksApiMatched: research.packet?.parksApi?.matched ?? null,
          openResearchMode: research.openResearch?.research?.mode ?? null,
          openResearchGaps: research.openResearch?.research?.inventoryGaps?.length ?? null,
        });
      } catch (err) {
        return { id: park.id, rank: park.rank, status: 'failed', error: `research failed: ${err.message}`, stages };
      }
    }

    if (!skip.includes('aliases') && applyAliases) {
      const pois = readBuiltPois(park.id);
      if (pois?.length) {
        console.error('  · aliases: official name pairing');
        try {
          const { data: catalog } = readSources(park.id);
          const official = await loadOfficialData(park.id, catalog, { fetch: false, offline: true });
          const parksApi = await loadParksApiData(park.id, { fetch: false, offline: true });
          const { claims } = proposeAliases({
            venueId: park.id,
            pois,
            officialNames: (official?.attractions || []).map((a) => a.name),
            parksApiNames: (parksApi?.attractions || []).map((a) => a.name),
          });
          const { applied } = applyAliasClaims(park.id, claims);
          logStage('aliases', { claims: claims.length, applied });
        } catch (err) {
          console.error(`    alias pass skipped: ${err.message}`);
          logStage('aliases', { skipped: err.message });
        }
      }
    }

    if (!skip.includes('heights')) {
      const pois = readBuiltPois(park.id);
      if (!pois?.length) {
        return { id: park.id, rank: park.rank, status: 'failed', error: 'no POIs after geometry build', stages };
      }
      console.error('  · heights: official site → sidecar');
      let heights;
      try {
        heights = await syncHeightsFromOfficial(park, pois, {
          fetch: false,
          browser: false,
          fetchDetails: false,
        });
      } catch (err) {
        return { id: park.id, rank: park.rank, status: 'failed', error: `height sync failed: ${err.message}`, stages };
      }
      console.error(
        `    ${heights.ruleCount} rule(s) for ${heights.matched}/${heights.rideCount} rides `
          + `(site listed ${heights.siteCount})`,
      );
      if (heights.officialErrors?.length) {
        console.error(`    warnings: ${heights.officialErrors.join('; ')}`);
      }
      if (!heights.ruleCount) {
        return {
          id: park.id,
          rank: park.rank,
          status: 'failed',
          error: 'no height rules could be sourced from the official website',
          stages,
        };
      }
      logStage('heights', {
        ruleCount: heights.ruleCount,
        matched: heights.matched,
        rideCount: heights.rideCount,
      });
    }

    if (!skip.includes('rebuild')) {
      const ok = await runBuildWithRetries(
        'rebuild with heights, imagery, and trace',
        ['--rebuild', park.id],
        { retries },
      );
      if (!ok) {
        return { id: park.id, rank: park.rank, status: 'failed', error: 'rebuild failed', stages };
      }
      logStage('rebuild', { rebuilt: true });
    }
  }

  if (!skip.includes('attractions') && attractions) {
      console.error('  · attractions: inventory + external evidence ingest');
      if (!runNode(ATTRACTIONS_BIN, [park.id, '--report'])) {
        return { id: park.id, rank: park.rank, status: 'failed', error: 'attractions inventory failed', stages };
      }
      logStage('attractions', { ran: true, externalIngest: true });
    }

  if (!skip.includes('agent') && agent) {
    console.error('  · agent: QA, GIS, vision, validation');
    try {
      const trace = await runBuildOrchestrator(park.id, {
        apply: true,
        fetch: false,
        browser: false,
        parksApi: false,
        offline: true,
      });
      const errors = trace.errors?.length || 0;
      logStage('agent', { agents: trace.agents?.length || 0, errors });
      if (errors) {
        console.error(`    agent reported ${errors} error(s) — venue still on disk`);
      }
    } catch (err) {
      return { id: park.id, rank: park.rank, status: 'failed', error: `build-agent failed: ${err.message}`, stages };
    }
  }

  if (!skip.includes('certify') && certify) {
    console.error('  · certify: report + compare + route-qa + ask');
    try {
      const cert = certifyVenue(park.id);
      logStage('certify', {
        certified: cert.certified,
        failed: cert.checks.filter((c) => !c.pass).map((c) => c.key),
      });
      if (!cert.certified) {
        const failed = cert.checks.filter((c) => !c.pass).map((c) => c.key).join(', ');
        return {
          id: park.id,
          rank: park.rank,
          status: 'uncertified',
          error: `certification failed: ${failed}`,
          certification: cert,
          stages,
        };
      }
    } catch (err) {
      return { id: park.id, rank: park.rank, status: 'failed', error: `certify failed: ${err.message}`, stages };
    }
  }

  if (!skip.includes('display') && display) {
    console.error('  · display: visual specs + display-certify');
    try {
      const { runDisplayStage } = await import('./display-pack.mjs');
      const disp = runDisplayStage(park.id);
      logStage('display', { certified: disp.certified, skins: Object.keys(disp.packs).length });
      if (!disp.certified) {
        return {
          id: park.id,
          rank: park.rank,
          status: 'uncertified',
          error: 'display certification failed',
          display: disp,
          stages,
        };
      }
    } catch (err) {
      return { id: park.id, rank: park.rank, status: 'failed', error: `display failed: ${err.message}`, stages };
    }
  }

  return { id: park.id, rank: park.rank, status: 'built', stages };
}

/**
 * Run the universal builder over many catalog parks — a loop over runVenuePipeline.
 *
 * @param {object[]} parks catalog rows from selectParks()
 * @param {object} opts same options as runVenuePipeline, plus batchDelay, openPr, catalogSize
 */
export async function runVenueBatch(parks, opts = {}) {
  const {
    batchDelay = 5,
    openPr = false,
    catalogSize = parks.length,
    dryRun = false,
    ...pipelineOpts
  } = opts;

  const results = [];
  for (const [i, park] of parks.entries()) {
    const result = await runVenuePipeline(park, { ...pipelineOpts, dryRun });
    results.push(result);

    if (openPr && result.status === 'built' && !dryRun) {
      try {
        const { openVenueDraftPr } = await import('./venue-pr.mjs');
        const pr = openVenueDraftPr(park.id, { runId: Date.now() });
        result.pr = pr;
        if (pr.prUrl) console.error(`  → draft PR: ${pr.prUrl}`);
        else if (pr.skipped) console.error(`  → PR skipped: ${pr.reason}`);
      } catch (err) {
        console.error(`  ! PR failed for ${park.id}: ${err.message}`);
      }
    }

    if (i < parks.length - 1 && !dryRun && batchDelay > 0) {
      await sleep(batchDelay);
    }
  }

  const built = results.filter((r) => r.status === 'built' || r.status === 'dry-run');
  const uncertified = results.filter((r) => r.status === 'uncertified');
  const failed = results.filter((r) => r.status === 'failed');

  return {
    catalog: catalogSize,
    selected: parks.length,
    built: built.length,
    uncertified: uncertified.length,
    failed: failed.length,
    skippedExisting: catalogSize - parks.length,
    results,
    ok: failed.length === 0 && uncertified.length === 0,
  };
}

/** Parse batch/catalog flags shared by the universal builder CLI. */
export function parseCatalogArgs(argv) {
  const out = {
    _: [],
    catalog: false,
    pipeline: false,
    from: null,
    to: null,
    skipExisting: true,
    dryRun: false,
    delay: 5,
    retries: 3,
    allowNoHeights: false,
    browser: true,
    attractions: true,
    agent: true,
    certify: true,
    display: false,
    applyAliases: true,
    openPr: false,
    json: false,
  };
  const withValue = new Set(['--from', '--to', '--delay', '--retries']);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--catalog') out.catalog = true;
    else if (a === '--pipeline') out.pipeline = true;
    else if (a === '--from') out.from = Number(argv[++i]);
    else if (a === '--to') out.to = Number(argv[++i]);
    else if (a === '--skip-existing') out.skipExisting = true;
    else if (a === '--no-skip-existing') out.skipExisting = false;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--delay') out.delay = Number(argv[++i]);
    else if (a === '--retries') out.retries = Number(argv[++i]);
    else if (a === '--allow-no-heights') out.allowNoHeights = true;
    else if (a === '--no-browser') out.browser = false;
    else if (a === '--no-attractions') out.attractions = false;
    else if (a === '--no-agent') out.agent = false;
    else if (a === '--no-certify') out.certify = false;
    else if (a === '--display') out.display = true;
    else if (a === '--no-aliases') out.applyAliases = false;
    else if (a === '--pr') out.openPr = true;
    else if (a === '--json') out.json = true;
    else if (!a.startsWith('--')) out._.push(a);
    else if (withValue.has(a) && argv[i + 1] && !argv[i + 1].startsWith('--')) i += 1;
    else if (a.includes('=')) { /* inline value — skip */ }
    /* else: build-venue flags (--place, --bbox, …) — ignore here */
  }
  return out;
}

export function pipelineOptsFromCatalogArgs(args) {
  return {
    dryRun: args.dryRun,
    retries: args.retries,
    allowNoHeights: args.allowNoHeights,
    applyAliases: args.applyAliases,
    browser: args.browser,
    attractions: args.attractions,
    agent: args.agent,
    certify: args.certify,
    display: args.display,
    rebuildOnly: args.skipExisting,
    skip: args.allowNoHeights ? ['research', 'aliases', 'heights', 'rebuild', 'agent'] : [],
  };
}
