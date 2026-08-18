#!/usr/bin/env node
/**
 * Vendor display assets — fetch the ledger's pinned bytes, once, by hand.
 *
 * Never runs in CI: CI consumes the committed bytes and verifies their
 * sha256 pins (lib/display-assets.mjs#verifyAssetHashes). This script
 * re-fetches from each row's pinned mirror commit over raw.githubusercontent
 * and refuses any byte that does not match the pin — provenance on assets,
 * exactly like provenance on coordinates.
 *
 *   node packages/venue-builder/bin/vendor-assets.mjs           # verify only
 *   node packages/venue-builder/bin/vendor-assets.mjs --fetch   # fetch missing
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readAssetLedger, verifyAssetHashes, assetPath } from '../lib/display-assets.mjs';
import { verifyReferenceImages } from '../lib/display-references.mjs';

const fetchMissing = process.argv.includes('--fetch');
const ledger = readAssetLedger();

if (fetchMissing) {
  for (const row of Object.values(ledger)) {
    const file = assetPath(row);
    if (existsSync(file)) continue;
    const m = /github\.com\/([^/]+\/[^/]+)\/tree\/[^/]+/.exec(row.source.mirror || '');
    if (!m || !row.source.commit || !row.source.file) {
      console.error(`${row.id}: no pinned mirror to fetch from — vendor by hand`);
      process.exitCode = 1;
      continue;
    }
    const url = `https://raw.githubusercontent.com/${m[1]}/${row.source.commit}/${row.source.file}`;
    console.error(`${row.id}: fetching ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`${row.id}: HTTP ${res.status}`);
      process.exitCode = 1;
      continue;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== row.sha256) {
      console.error(`${row.id}: REFUSED — fetched sha ${sha.slice(0, 12)}… does not match the pin`);
      process.exitCode = 1;
      continue;
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    console.error(`${row.id}: vendored (${bytes.length} bytes, pin verified)`);
  }
}

const problems = verifyAssetHashes(ledger);
if (problems.length) {
  for (const p of problems) console.error(`! ${p}`);
  process.exitCode = 1;
} else {
  console.log(`asset ledger green: ${Object.keys(ledger).length} asset(s), all pins verified`);
}

// Reference images ride the same pin discipline: committed rows must match,
// hand-vendored rows are reported when absent and refused when drifted.
const refs = verifyReferenceImages();
for (const r of refs.reports) console.error(`  ${r}`);
if (refs.problems.length) {
  for (const p of refs.problems) console.error(`! ${p}`);
  process.exitCode = 1;
} else {
  console.log(`reference images green (${refs.reports.length} awaiting hand-vendoring)`);
}
