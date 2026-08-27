#!/usr/bin/env node
/**
 * Builder CI fleet certification — builder-path PRs re-check every shipped venue.
 *
 * Seam: `.github/workflows/test-app.yml` `builder` job runs `venues:certify --all`
 * offline after `test:builder`, so a builder change cannot silently de-certify
 * committed bundles (#402).
 *
 *   node test/scripts/builder-certify-ci.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jobBody } from '../../scripts/lib/test-estate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(join(root, '.github/workflows/test-app.yml'), 'utf8');
const builder = jobBody(workflow, 'builder');

assert.ok(builder, 'test-app.yml declares a builder job');

assert.match(
  builder,
  /npm run test:builder/,
  'builder job runs the builder test suite',
);

assert.match(
  builder,
  /npm run venues:certify -- --all --regression-only --no-write/,
  'builder job runs the offline fleet certification regression gate after test:builder',
);

// certify must follow test:builder so unit/compare failures short-circuit first.
const testIdx = builder.indexOf('npm run test:builder');
const certifyIdx = builder.indexOf('npm run venues:certify -- --all --regression-only --no-write');
assert.ok(
  certifyIdx > testIdx,
  'venues:certify runs after test:builder in the builder job',
);

// Only the builder job pays for fleet certify — not lint, map-factory, etc.
for (const job of ['lint:', 'map-factory:', 'visual-factory:', 'delivery:']) {
  const body = jobBody(workflow, job.replace(':', ''));
  if (body) {
    assert.doesNotMatch(
      body,
      /venues:certify -- --all --regression-only/,
      `${job} job must not run fleet certify (module selection keeps it on builder only)`,
    );
  }
}

console.log('builder-certify-ci: ok (builder job runs offline venues:certify --all after test:builder)');
