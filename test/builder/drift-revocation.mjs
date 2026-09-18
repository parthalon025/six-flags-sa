#!/usr/bin/env node
/**
 * Drift report → certification revocation mapping (#400).
 *
 *   node test/builder/drift-revocation.mjs
 */
import assert from 'node:assert/strict';
import {
  DRIFT_REVOCATION_REASON,
  applyDriftRevocations,
  attachDriftRevocation,
  revokeCertificationFromDrift,
} from '../../packages/venue-builder/lib/drift-revocation.mjs';

const DETECTED = '2026-09-18T00:36:00.000Z';

// ---- pure revoke transform ----
{
  const prior = {
    version: 1,
    venue: { id: 'kings-island', name: 'Kings Island', locality: 'Mason, Ohio' },
    certified: true,
    certifiedAt: '2026-08-01T12:00:00.000Z',
    checks: [{ key: 'route', pass: true }],
  };
  const next = revokeCertificationFromDrift(prior, {
    id: 'kings-island',
    detectedAt: DETECTED,
    detail: 'Rebuild dry-run would change shipped bundle',
  });
  assert.equal(next.certified, false, 'drift revoke forces certified false');
  assert.equal(next.certifiedAt, prior.certifiedAt, 'last certifiedAt is preserved');
  assert.equal(next.revocation.reason, DRIFT_REVOCATION_REASON);
  assert.equal(next.revocation.detectedAt, DETECTED);
  assert.match(next.revocation.detail, /would change/);
  assert.deepEqual(next.checks, prior.checks, 'checks are preserved for review');
}

// ---- applyDriftRevocations touches only drifted ids ----
{
  const store = new Map([
    ['alpha', { version: 1, venue: { id: 'alpha' }, certified: true, checks: [] }],
    ['beta', { version: 1, venue: { id: 'beta' }, certified: true, checks: [] }],
    ['gamma', { version: 1, venue: { id: 'gamma' }, certified: true, checks: [] }],
  ]);
  const report = {
    generated: DETECTED,
    rows: [
      { id: 'alpha', changed: true, log: 'would change map.json' },
      { id: 'beta', changed: false },
      { id: 'gamma', changed: true, log: 'would change pois.json' },
    ],
  };
  const result = applyDriftRevocations(report, {
    detectedAt: DETECTED,
    readCert: (id) => store.get(id) ?? null,
    writeCert: (id, doc) => store.set(id, doc),
  });
  assert.deepEqual(result.revoked.sort(), ['alpha', 'gamma']);
  assert.deepEqual(result.skipped.sort(), ['beta']);
  assert.equal(store.get('beta').certified, true, 'stable venue unchanged');
  assert.equal(store.get('alpha').certified, false);
  assert.equal(store.get('gamma').revocation.detectedAt, DETECTED);
}

// ---- attachDriftRevocation clears on pass, preserves on fail ----
{
  const prior = {
    revocation: {
      reason: DRIFT_REVOCATION_REASON,
      detectedAt: DETECTED,
      detail: 'stale',
    },
  };
  const passing = attachDriftRevocation(prior, { certified: true, checks: [] });
  assert.equal(passing.revocation, undefined, 'passing certify omits drift revocation');
  const failing = attachDriftRevocation(prior, { certified: false, checks: [] });
  assert.deepEqual(failing.revocation, prior.revocation, 'failed certify keeps drift revocation');
}

console.log('ok drift-revocation');
