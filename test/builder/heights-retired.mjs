#!/usr/bin/env node
/**
 * Heights sidecar must not carry rules for places that left the shipped map.
 * Ticket 30: Snake River Falls closed permanently Sept 2024; the map drop was
 * correct — the stale heights.json rule was not.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addressBook, resolveOverride } from '../../packages/venue-builder/lib/venue-ids.mjs';
import { readJson, venueSidecar } from '../../packages/venue-builder/lib/venue-io.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');
const VENUE_DIR = path.join(ROOT, 'apps/party-tracker/public/venues');

const PASS = [];
const FAIL = [];
const ok = (n) => {
  PASS.push(n);
  console.log('  PASS', n);
};
const bad = (n, e) => {
  FAIL.push(`${n} :: ${e}`);
  console.log('  FAIL', n, '->', e);
};

console.log('\nheights retired gate\n');

try {
  const manifest = readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] });
  const stale = [];
  for (const venue of manifest.venues) {
    const heights = readJson(venueSidecar(venue.id, 'heights.json'), null);
    if (!heights?.rules) continue;
    const pois = readJson(path.join(VENUE_DIR, `${venue.id}.pois.json`), []);
    const book = addressBook(pois);
    for (const [name, rule] of Object.entries(heights.rules)) {
      if (!resolveOverride(book, name, rule)?.length) {
        stale.push(`${venue.id}: ${name}`);
      }
    }
  }
  assert.deepEqual(
    stale,
    [],
  );
  ok('every heights sidecar rule lands on a live shipped place');
} catch (e) {
  bad('heights sidecar rules for retired places', e.message);
}

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
