#!/usr/bin/env node
/**
 * Delivery bundle revision gate — shipped seed bundles pin PostDB revision ids.
 *
 *   node test/builder/delivery-bundle-revision-gate.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const VENUE_DIR = path.join('apps', 'party-tracker', 'public', 'venues');
const manifestPath = path.join(VENUE_DIR, 'manifest.json');

assert.ok(existsSync(manifestPath), 'venue manifest.json must exist');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const venues = manifest.venues || [];

assert.ok(venues.length > 0, 'manifest must list shipped venues');

const missing = [];
for (const row of venues) {
  const bundlePath = path.join(VENUE_DIR, `${row.id}.bundle.json`);
  assert.ok(existsSync(bundlePath), `${row.id}: bundle manifest missing`);
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
  if (!bundle?.basedOn?.revisionId) {
    missing.push(row.id);
  }
  assert.ok(bundle?.basedOn?.map, `${row.id}: bundle must pin basedOn.map`);
}

assert.equal(
  missing.length,
  0,
  `seed bundles missing basedOn.revisionId: ${missing.join(', ')} — run npm run venues:export -- --all with DATABASE_URL`,
);

const orphans = readdirSync(VENUE_DIR)
  .filter((f) => f.endsWith('.bundle.json'))
  .map((f) => f.slice(0, -'.bundle.json'.length))
  .filter((id) => !venues.some((v) => v.id === id));
assert.equal(orphans.length, 0, `unexpected bundle files not in manifest: ${orphans.join(', ')}`);

console.log(`delivery-bundle-revision-gate: ok (${venues.length} venue(s))`);
