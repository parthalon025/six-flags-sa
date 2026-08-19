#!/usr/bin/env node
/**
 * Per-land ESA WorldCover classification — samples the raster over each
 * district's own bounding box (not the venue-wide bbox `venues:sync-sources`
 * uses) so districts can land on different classes: a built-up midway, a
 * wooded backcountry, a lake. Feeds display-pack.mjs's WorldCover-derived
 * land tones — run this before `venues:display` to pick them up.
 *
 *   npm run venues:worldcover-lands -- <venueId> [--fetch] [--json]
 *
 *   --fetch   hit the live ESA WorldCover S3 bucket (default: read cache only)
 *   --json    structured output
 */

import path from 'node:path';
import { VENUE_DIR, readJson } from '../lib/venue-io.mjs';
import { classifyVenueLands } from '../lib/adapters/esa-worldcover.mjs';

const argv = process.argv.slice(2);
const fetchLive = argv.includes('--fetch');
const json = argv.includes('--json');
const ids = argv.filter((a) => !a.startsWith('--'));

if (!ids.length) {
  console.error('usage: worldcover-lands.mjs <venueId>… [--fetch] [--json]');
  process.exit(2);
}

const results = [];
for (const id of ids) {
  const map = readJson(path.join(VENUE_DIR, `${id}.map.json`), null);
  if (!map) {
    results.push({ venue: id, ok: false, error: 'missing map.json' });
    continue;
  }
  const result = await classifyVenueLands(id, map.lands || [], { offline: !fetchLive });
  results.push({ venue: id, ...result });
}

if (json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    if (r.error) {
      console.log(`${r.venue}: ERROR — ${r.error}`);
    } else if (!r.ok) {
      console.log(`${r.venue}: no cached classification — rerun with --fetch`);
    } else {
      const names = Object.keys(r.data.lands || {});
      console.log(`${r.venue}: ${names.length} land(s) classified`);
      for (const name of names) {
        console.log(`  ${name}: ${r.data.lands[name].name} (class ${r.data.lands[name].code})`);
      }
    }
  }
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
