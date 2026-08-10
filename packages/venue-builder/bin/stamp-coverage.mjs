#!/usr/bin/env node
/** Stamp meta.coverage onto venue maps already on disk (no Overpass). */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tagCoverageFromMap } from '../lib/tag-coverage.mjs';
import { VENUE_DIR } from '../lib/venue-io.mjs';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : [
  'cedar-point',
  'kings-island',
  'six-flags-fiesta-texas',
  'big-kahunas',
];

for (const id of ids) {
  const file = path.join(VENUE_DIR, `${id}.map.json`);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const { meta, ...map } = raw;
  const coverage = tagCoverageFromMap(map);
  const next = { meta: { ...meta, coverage }, ...map };
  writeFileSync(file, `${JSON.stringify(next)}\n`);
  console.error(`${id}: coverage stamped — ${coverage.ways} ways, ${coverage.walkable_km} km`);
}
