#!/usr/bin/env node
/**
 * App bundle delta contract — shipped seed bundles expose revision cursors (ticket 17).
 *
 * PostDB head→delta filtering is proven in `test/builder/delivery-delta.mjs`.
 * `syncVenueBundle` revision-cursor behaviour is in `test/app/venue-download.test.mjs`.
 * The HTTP route is exercised in `test/app/functional.mjs` (venues module).
 *
 *   node test/app/venue-delta-api.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleSyncUrl, BUNDLE_SINCE_QUERY } from '../../apps/party-tracker/lib/venue/download.js';

const PUBLIC_VENUES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../apps/party-tracker/public/venues',
);

const manifest = JSON.parse(readFileSync(path.join(PUBLIC_VENUES, 'manifest.json'), 'utf8'));
const venues = manifest.venues || [];
assert.ok(venues.length > 0, 'manifest lists shipped venues');

for (const row of venues) {
  const bundlePath = path.join(PUBLIC_VENUES, `${row.id}.bundle.json`);
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
  assert.ok(bundle.basedOn?.revisionId, `${row.id}: bundle pins basedOn.revisionId`);
  const syncUrl = bundleSyncUrl({ id: row.id, bundle: `/venues/${row.id}.bundle.json` }, bundle.basedOn.revisionId);
  assert.match(syncUrl, new RegExp(`/api/venues/${row.id}/bundle\\?`));
  assert.equal(new URLSearchParams(syncUrl.split('?')[1]).get(BUNDLE_SINCE_QUERY), bundle.basedOn.revisionId);
}

const orphans = readdirSync(PUBLIC_VENUES)
  .filter((f) => f.endsWith('.bundle.json'))
  .map((f) => f.slice(0, -'.bundle.json'.length))
  .filter((id) => !venues.some((v) => v.id === id));
assert.equal(orphans.length, 0, `unexpected bundle files: ${orphans.join(', ')}`);

console.log(`venue-delta-api: ok (${venues.length} venue(s))`);
