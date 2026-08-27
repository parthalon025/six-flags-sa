#!/usr/bin/env node
/**
 * Certification freshness — committed certification.json must pin the bundle it certified.
 *
 *   node test/scripts/compare-cert-freshness.test.mjs
 */
import assert from 'node:assert/strict';
import {
  bundleFingerprint,
  certificationFreshnessDecision,
  compareCertificationFreshness,
} from '../../packages/venue-builder/src/compare.mjs';

/* ---------------------------------------- certificationFreshnessDecision */

{
  const fresh = certificationFreshnessDecision({
    certification: { bundleFingerprint: 'abc123' },
    currentFingerprint: 'abc123',
  });
  assert.equal(fresh.fresh, true);

  const stale = certificationFreshnessDecision({
    certification: { bundleFingerprint: 'old' },
    currentFingerprint: 'new',
  });
  assert.equal(stale.fresh, false);
  assert.equal(stale.reason, 'stale');

  const unpinned = certificationFreshnessDecision({
    certification: {},
    currentFingerprint: 'abc123',
  });
  assert.equal(unpinned.fresh, false);
  assert.equal(unpinned.reason, 'unpinned');

  const noCert = certificationFreshnessDecision({
    certification: null,
    currentFingerprint: 'abc123',
  });
  assert.equal(noCert.fresh, true);
  assert.equal(noCert.reason, 'no-cert');
}

/* --------------------------------------------------------- the repo gate */

{
  const gate = compareCertificationFreshness();
  const explain = gate.issues.join('\n');
  assert.ok(
    gate.ok,
    `a venue's bundle changed without re-certification — run npm run venues:certify:\n${explain}`,
  );

  // Every shipped venue with a certification artifact pins its current bundle.
  const kingsIsland = bundleFingerprint('kings-island');
  assert.match(kingsIsland, /^[0-9a-f]{64}$/, 'bundle fingerprint is a sha256 hex digest');
}

console.log('compare-cert-freshness: ok (certification artifacts pin current bundles)');
