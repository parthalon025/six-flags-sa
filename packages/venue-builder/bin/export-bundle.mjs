#!/usr/bin/env node
/**
 * Delivery export — PostDB head → hash-addressed phone bundle.
 *
 *   npm run venues:export -- <venueId> [<venueId>…]
 *   npm run venues:export -- --all
 *
 * Factory program only. The app reads the exported `/venues/<id>.bundle.json`.
 */

import path from 'node:path';
import { assertPostdbAvailable } from '../lib/postdb-io.mjs';
import { publishBundle } from '../lib/delivery/publish-bundle.mjs';
import { VENUE_DIR, readJson } from '../lib/venue-io.mjs';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const all = argv.includes('--all');
const ids = argv.filter((a) => !a.startsWith('--'));

assertPostdbAvailable();

const manifest = readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] });
const targets = all ? (manifest.venues || []).map((v) => v.id) : ids;

if (!targets.length) {
  console.error('usage: export-bundle.mjs <venueId>… | --all [--json]');
  process.exit(2);
}

const results = [];
for (const id of targets) {
  try {
    const published = await publishBundle(id);
    results.push(published);
    if (!json) {
      const n = published.bundle?.files?.length ?? 0;
      console.log(`${id}: exported ${n} file(s) revision ${published.revisionId || 'none'}`);
    }
  } catch (err) {
    results.push({ id, certified: false, error: err.message });
    if (!json) console.error(`${id}: ERROR — ${err.message}`);
  }
}

if (json) console.log(JSON.stringify(results, null, 2));
process.exitCode = results.every((r) => r.certified && !r.error) ? 0 : 1;
