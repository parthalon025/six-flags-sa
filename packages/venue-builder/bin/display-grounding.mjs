#!/usr/bin/env node
/**
 * Harvest one World's grounding — its real material and colour relationships —
 * from NAIP aerial imagery into its reference profile.
 *
 *   node packages/venue-builder/bin/display-grounding.mjs <venueId> [--dry-run]
 *   node packages/venue-builder/bin/display-grounding.mjs --report [<venueId>…]
 *
 * Network, run by hand, never in CI — exactly like `display-swatches.mjs`. CI
 * consumes the committed record, and `test/builder/display-grounding.mjs`
 * proves the harvest itself against a painted orthophoto rather than a fetch.
 *
 * What it writes is `data/venues/<id>/display/grounding.json`: the grounding
 * section of that World's reference profile (ADR-0020's consequence). What it
 * does *not* write is truth. The rings it samples are the ones the Map factory
 * already settled; a harvest that disagreed with OSM about where a path runs
 * would raise a Gap through the evidence lane (Train I's other half), never
 * move a line here.
 *
 * The raster stays in memory. `lib/adapters/naip-planetary.mjs` deliberately
 * leaves the ledger row and not the pixels, and the pixels a park needs are the
 * ~50k samples this run takes, not the 4-band window they came out of.
 */

import path from 'node:path';
import {
  ID as NAIP, searchItems, rankItems, readNaipWindow, provenanceFor, sha256OfRaster, naipProbe,
} from '../lib/adapters/naip-planetary.mjs';
import { harvestGrounding, regionsFromMap } from '../lib/display-grounding.mjs';
import { groundingFile, readVenueGrounding, validateGrounding } from '../lib/display-references.mjs';
import { zoneCharacterProblemsForWorld } from '../lib/display-zone-character.mjs';
import { VENUE_DIR, readJson, writeJson } from '../lib/venue-io.mjs';

const argv = process.argv.slice(2);
const KNOWN = new Set(['--dry-run', '--report']);
const unknown = argv.filter((a) => a.startsWith('--') && !KNOWN.has(a));
if (unknown.length) {
  console.error(`display-grounding.mjs: unknown flag(s) ${unknown.join(', ')}`);
  process.exit(2);
}
const dryRun = argv.includes('--dry-run');
const report = argv.includes('--report');
const ids = argv.filter((a) => !a.startsWith('--'));

const builtMap = (id) => readJson(path.join(VENUE_DIR, `${id}.map.json`), null);

function describe(id) {
  const record = readVenueGrounding(id);
  if (!record) return console.log(`  ${id}: no grounding harvested yet`);
  const problems = validateGrounding(record);
  const zoneProblems = zoneCharacterProblemsForWorld(id);
  const groups = Object.entries(record.groups || {})
    .map(([cls, block]) => `${cls}×${block.groups.length}`)
    .join(' ');
  console.log(`  ${id}: ${record.source.tile} (${record.source.captured}) — ${groups}`);
  for (const p of problems) console.log(`    ! ${p}`);
  for (const p of zoneProblems) console.log(`    ! ${p}`);
  return problems.length + zoneProblems.length;
}

/**
 * Read one frame and harvest from it, or say why it could not be used.
 * `null` means "try the next frame": an empty or featureless quarter-quad is
 * a bad frame, not a bad park.
 */
async function harvestFrom(id, map, item) {
  const read = await readNaipWindow(item, map.meta.bounds);
  if (!read.window.complete) {
    console.warn(`  ${id}: ${item.id} only partially covers this World — harvesting what it does cover`);
  }
  try {
    return harvestGrounding({
      venue: id,
      regions: regionsFromMap(map),
      probe: naipProbe({ item, window: read.window, bands: read.bands }),
      provenance: { ...provenanceFor(item), sha256: sha256OfRaster(read.bands) },
    });
  } catch (err) {
    console.warn(`  ${id}: ${item.id} unusable — ${err.message}`);
    return null;
  }
}

async function harvestOne(id) {
  const map = builtMap(id);
  if (!map?.meta?.bounds) {
    console.error(`  ${id}: no built map.json — run venues:build first`);
    return 1;
  }
  const { items } = await searchItems(map.meta.bounds);
  const ranked = rankItems(items, map.meta.bounds);
  if (!ranked.length) {
    console.error(`  ${id}: no NAIP frame covers this World — grounding stays unharvested`);
    return 1;
  }

  // Down the ranking until one frame reads. The top frame is not always the
  // one with pixels in it: big-kahunas' newest quarter-quad is nodata over the
  // whole park, and its 2019 one is fine.
  let record = null;
  for (const candidate of ranked) {
    record = await harvestFrom(id, map, candidate.item);
    if (record) break;
  }
  if (!record) {
    console.error(`  ${id}: none of ${ranked.length} NAIP frame(s) read this World — grounding stays unharvested`);
    return 1;
  }

  const problems = validateGrounding(record);
  if (problems.length) {
    console.error(`  ${id}: harvest did not validate`);
    for (const p of problems) console.error(`    ! ${p}`);
    return 1;
  }

  const classes = Object.keys(record.classes).length;
  const groups = Object.values(record.groups).reduce((s, b) => s + b.groups.length, 0);
  console.log(`  ${id}: ${classes} classes, ${groups} groups, from ${record.source.tile}`);
  if (dryRun) {
    console.log(`    (dry run — would write ${path.relative(process.cwd(), groundingFile(id))})`);
    return 0;
  }
  writeJson(groundingFile(id), record, true);
  console.log(`    wrote ${path.relative(process.cwd(), groundingFile(id))}`);
  return 0;
}

if (report) {
  console.log(`\ngrounding (${NAIP})\n`);
  for (const id of ids.length ? ids : []) describe(id);
  if (!ids.length) console.error('  name at least one World to report on');
  process.exit(0);
}

if (!ids.length) {
  console.error('usage: display-grounding.mjs <venueId> [--dry-run] | --report <venueId>…');
  process.exit(2);
}

let failures = 0;
console.log(`\ngrounding harvest (${NAIP})\n`);
for (const id of ids) failures += await harvestOne(id);
process.exit(failures ? 1 : 0);
