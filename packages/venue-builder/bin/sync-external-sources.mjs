#!/usr/bin/env node
/**
 * Sync open-source external research caches for a venue.
 *
 *   npm run venues:sync-sources -- cedar-point
 *   npm run venues:sync-sources -- cedar-point --fetch
 *   npm run venues:sync-sources -- --all --fetch
 */

import path from 'node:path';
import { readJson, VENUE_DIR } from '../lib/venue-io.mjs';
import { syncExternalSources, EXTERNAL_ADAPTER_IDS } from '../lib/external-research.mjs';

const USAGE = `
Sync external open-source research adapters (builder-side only).

  npm run venues:sync-sources -- <venue id> [options]
  npm run venues:sync-sources -- --all [options]

  --fetch       hit live APIs (default: read cache only)
  --json        structured output
  --sources     comma-separated adapter ids (default: all)
  --list        print adapter ids and exit

Adapters: ${EXTERNAL_ADAPTER_IDS.join(', ')}
`;

function parseArgs(argv) {
  const out = { _: [], all: false, fetch: false, json: false, list: false, sources: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--all') out.all = true;
    else if (a === '--fetch') out.fetch = true;
    else if (a === '--json') out.json = true;
    else if (a === '--list') out.list = true;
    else if (a === '--sources') out.sources = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (!a.startsWith('--')) out._.push(a);
    else throw new Error(`Unknown flag: ${a}`);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    console.log(EXTERNAL_ADAPTER_IDS.join('\n'));
    return;
  }

  const ids = args.all
    ? readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] }).venues.map((v) => v.id)
    : args._;

  if (!ids.length) {
    console.error(USAGE.trim());
    process.exit(1);
  }

  const results = {};
  for (const id of ids) {
    results[id] = await syncExternalSources(id, {
      fetch: args.fetch,
      sources: args.sources || undefined,
      onProgress: (msg) => {
        if (!args.json) process.stderr.write(`${id}: ${msg}\n`);
      },
    });
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  for (const id of ids) {
    const runs = results[id];
    console.log(`\n# ${id}`);
    for (const [adapterId, result] of Object.entries(runs)) {
      const status = result.ok ? 'ok' : 'skip';
      const detail = result.error || result.meta ? JSON.stringify(result.meta || result.error) : '';
      console.log(`- ${adapterId}: ${status}${detail ? ` — ${detail}` : ''}`);
    }
  }
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
