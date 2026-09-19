#!/usr/bin/env node
/**
 * Drift report → certification revocation mapping (#400).
 *
 *   node test/builder/drift-revocation.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DRIFT_REVOCATION_REASON,
  applyDriftRevocations,
  attachDriftRevocation,
  revokeCertificationFromDrift,
} from '../../packages/venue-builder/lib/drift-revocation.mjs';
import { certificationFile } from '../../packages/venue-builder/lib/venue-certify.mjs';
import { readJson, writeJson } from '../../packages/venue-builder/lib/venue-io.mjs';

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

// ---- attachDriftRevocation clears on pass, preserves osm_drift on fail ----
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
  const otherReason = attachDriftRevocation(
    { revocation: { reason: 'manual_review', detectedAt: DETECTED, detail: 'human' } },
    { certified: false, checks: [] },
  );
  assert.equal(otherReason.revocation, undefined, 'non-osm revocations are not preserved');
}

// ---- certification.json file seam (read/write via certificationFile) ----
{
  const id = 'big-kahunas';
  const file = certificationFile(id);
  const backup = fs.readFileSync(file);
  try {
    writeJson(file, {
      version: 1,
      venue: { id },
      certified: true,
      certifiedAt: '2026-08-01T12:00:00.000Z',
      checks: [{ key: 'route', pass: true }],
    }, true);
    const result = applyDriftRevocations({
      generated: DETECTED,
      rows: [{ id, changed: true, log: 'would change pois.json' }],
    }, {
      detectedAt: DETECTED,
      readCert: (vid) => readJson(certificationFile(vid), null),
      writeCert: (vid, doc) => writeJson(certificationFile(vid), doc, true),
    });
    assert.deepEqual(result.revoked, [id]);
    const onDisk = readJson(file, null);
    assert.equal(onDisk.certified, false);
    assert.equal(onDisk.revocation.reason, DRIFT_REVOCATION_REASON);
  } finally {
    fs.writeFileSync(file, backup);
  }
}

// ---- applyDriftRevocations is idempotent for existing osm_drift revocations ----
{
  const store = new Map([
    ['alpha', {
      version: 1,
      venue: { id: 'alpha' },
      certified: false,
      checks: [],
      revocation: {
        reason: DRIFT_REVOCATION_REASON,
        source: 'venues:drift-watch',
        detectedAt: '2026-09-01T00:00:00.000Z',
        detail: 'already revoked',
      },
    }],
  ]);
  const report = {
    generated: DETECTED,
    rows: [{ id: 'alpha', changed: true, log: 'still drifting' }],
  };
  const result = applyDriftRevocations(report, {
    detectedAt: DETECTED,
    readCert: (id) => store.get(id) ?? null,
    writeCert: (id, doc) => store.set(id, doc),
  });
  assert.deepEqual(result.revoked, [], 'already-revoked venue is not re-stamped');
  assert.deepEqual(result.alreadyRevoked, ['alpha']);
  assert.equal(
    store.get('alpha').revocation.detectedAt,
    '2026-09-01T00:00:00.000Z',
    'prior revocation timestamp is preserved',
  );
}

console.log('ok drift-revocation');
