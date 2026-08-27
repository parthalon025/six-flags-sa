/**
 * Stamp meta.coverage onto shipped venue maps (#416).
 *
 * Public seam for the stamp-coverage CLI and its tests.
 */

import { existsSync as fsExists, readFileSync as fsRead, writeFileSync as fsWrite } from 'node:fs';
import path from 'node:path';
import { tagCoverageFromMap } from './tag-coverage.mjs';
import { listVenuePackages } from './venue-io.mjs';
import { VENUE_DIR } from '../src/paths.mjs';

/** Resolve which venue ids to stamp: explicit argv wins; otherwise every package. */
export function resolveStampCoverageIds(explicitIds, listPackages = listVenuePackages) {
  if (explicitIds.length) return explicitIds;
  return listPackages();
}

/**
 * Stamp coverage for each id. Skips packages with no map unless `explicit` is set.
 * @returns {{ stamped: string[], skipped: string[] }}
 */
export function stampCoverage({
  ids,
  venueDir = VENUE_DIR,
  explicit = false,
  existsSync = fsExists,
  readFileSync = fsRead,
  writeFileSync = fsWrite,
  log = console.error,
}) {
  const stamped = [];
  const skipped = [];

  for (const id of ids) {
    const file = path.join(venueDir, `${id}.map.json`);
    if (!existsSync(file)) {
      if (explicit) throw new Error(`${id}: no map file at ${file}`);
      log(`${id}: no map file — skipped`);
      skipped.push(id);
      continue;
    }
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const { meta, ...map } = raw;
    const coverage = tagCoverageFromMap(map);
    const next = { meta: { ...meta, coverage }, ...map };
    writeFileSync(file, `${JSON.stringify(next)}\n`);
    log(`${id}: coverage stamped — ${coverage.ways} ways, ${coverage.walkable_km} km`);
    stamped.push(id);
  }

  return { stamped, skipped };
}
