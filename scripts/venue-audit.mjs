#!/usr/bin/env node
/**
 * Cross-park audit for the universal venue builder.
 *
 *   node scripts/venue-audit.mjs
 *   node scripts/venue-audit.mjs cedar-point --json
 *   node scripts/venue-audit.mjs --scaffold-sources cedar-point
 */

import fs from 'node:fs';
import path from 'node:path';
import { VENUE_DIR, readJson } from './lib/venue-io.mjs';
import {
  auditAll,
  auditVenue,
  renderAuditMarkdown,
  scaffoldSourcesCatalogue,
} from './lib/venue-audit.mjs';
import { sourcesFile } from './lib/venue-sources.mjs';
import { enrichOfficialFromSidecar, loadOfficialData, compareOfficialToBundle } from './lib/venue-official-site.mjs';
import { readSources } from './lib/venue-sources.mjs';
import { OVERRIDE_DIR } from './lib/venue-io.mjs';

const USAGE = `
Cross-park audit — weaknesses and which builder tool fixes each.

  node scripts/venue-audit.mjs [venue id] [options]

  --json                 structured output
  --fetch                refresh official-site caches while auditing
  --scaffold-sources <id>  write data/venues/<id>.sources.json from known URLs
`;

function parseArgs(argv) {
  const out = { _: [], json: false, fetch: false, scaffold: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--fetch') out.fetch = true;
    else if (a === '--scaffold-sources') {
      out.scaffold = argv[i + 1] || argv[i].split('=')[1];
      if (!out.scaffold?.startsWith('--')) i += 1;
      else out.scaffold = null;
    } else if (!a.startsWith('--')) out._.push(a);
    else throw new Error(`Unknown flag: ${a}`);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.scaffold) {
    const manifest = readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] });
    const venue = manifest.venues.find((v) => v.id === args.scaffold);
    if (!venue) throw new Error(`No venue "${args.scaffold}" in manifest.`);
    const file = sourcesFile(args.scaffold);
    if (fs.existsSync(file)) throw new Error(`${file} already exists.`);
    const catalog = scaffoldSourcesCatalogue(args.scaffold, venue);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`);
    console.error(`Wrote ${file}`);
    console.error(`Next: npm run venues:research -- ${args.scaffold} --fetch`);
    return;
  }

  if (args._.length === 1) {
    const id = args._[0];
    const manifest = readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] });
    const venue = manifest.venues.find((v) => v.id === id);
    if (!venue) throw new Error(`No venue "${id}" in manifest.`);
    const map = readJson(path.join(VENUE_DIR, `${id}.map.json`), {});
    const pois = readJson(path.join(VENUE_DIR, `${id}.pois.json`), []);
    const overrides = readJson(path.join(OVERRIDE_DIR, `${id}.overrides.json`), null);
    const heightsSidecar = readJson(path.join(OVERRIDE_DIR, `${id}.heights.json`), null);
    const { data: catalog } = readSources(id);
    const officialRaw = enrichOfficialFromSidecar(
      await loadOfficialData(id, catalog, { fetch: args.fetch, offline: !args.fetch }),
      heightsSidecar,
      catalog,
    );
    const official = compareOfficialToBundle({ official: officialRaw, pois, heightsSidecar });
    const report = auditVenue({
      venue, map, pois, overrides, heightsSidecar, official, catalog,
    });
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(renderAuditMarkdown({ generated: new Date().toISOString().slice(0, 10), parks: [report] }));
    return;
  }

  const report = await auditAll({ fetchOfficial: args.fetch, offline: !args.fetch });
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(renderAuditMarkdown(report));
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
