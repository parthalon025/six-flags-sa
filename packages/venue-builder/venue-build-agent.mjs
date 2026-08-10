#!/usr/bin/env node
/**
 * Universal Venue Builder — LLM agent orchestrator.
 *
 * Runs QA, research, GIS, vision, and validation agents; each invokes wrapped
 * adapter capabilities (Playwright, ParksAPI, route QA, evidence graph, etc.).
 *
 *   npm run venues:build-agent -- cedar-point
 *   npm run venues:build-agent -- cedar-point --ai
 *   npm run venues:build-agent -- cedar-point --apply --json
 *   npm run venues:build-agent -- --all --offline
 */

import path from 'node:path';
import { runBuildOrchestrator, renderOrchestratorMarkdown } from './lib/agents/orchestrator.mjs';
import { readJson, VENUE_DIR } from './lib/venue-io.mjs';

const USAGE = `
Universal Venue Builder — multi-agent orchestrator.

  node scripts/venue-build-agent.mjs <venue id> [options]
  node scripts/venue-build-agent.mjs --all

  --ai            LLM review per agent + orchestrator summary (VENUE_LLM_API_KEY)
  --apply         validation agent refreshes attractions + publishes entrances
  --fetch         network fetch for official site + ParksAPI
  --browser       Playwright when fetch returns empty HTML
  --tiles         GIS agent exports Tippecanoe GeoJSON layers
  --offline       sidecars only; no network
  --json          structured output
  --skip <roles>  comma list: qa,research,gis,vision,validation
`;

function parseArgs(argv) {
  const out = {
    _: [],
    all: false,
    ai: false,
    apply: false,
    fetch: true,
    browser: true,
    tiles: false,
    offline: false,
    json: false,
    skip: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--all') out.all = true;
    else if (a === '--ai') out.ai = true;
    else if (a === '--apply') out.apply = true;
    else if (a === '--fetch') out.fetch = true;
    else if (a === '--no-fetch') out.fetch = false;
    else if (a === '--browser') out.browser = true;
    else if (a === '--no-browser') out.browser = false;
    else if (a === '--tiles') out.tiles = true;
    else if (a === '--offline') out.offline = true;
    else if (a === '--json') out.json = true;
    else if (a === '--skip') out.skip = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (!a.startsWith('--')) out._.push(a);
    else throw new Error(`Unknown flag: ${a}`);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] });
  const ids = args.all ? manifest.venues.map((v) => v.id) : args._;

  if (!ids.length) {
    console.error(USAGE.trim());
    process.exit(1);
  }

  const traces = [];
  for (const id of ids) {
    console.error(`\n▶ build-agent ${id}`);
    const trace = await runBuildOrchestrator(id, {
      ai: args.ai,
      apply: args.apply,
      fetch: args.fetch,
      browser: args.browser,
      tiles: args.tiles,
      offline: args.offline,
      skip: args.skip,
    });
    traces.push(trace);
  }

  if (args.json) {
    console.log(JSON.stringify(traces.length === 1 ? traces[0] : traces, null, 2));
    return;
  }

  console.log(traces.map(renderOrchestratorMarkdown).join('\n---\n\n'));
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
