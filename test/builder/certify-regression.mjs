#!/usr/bin/env node
/**
 * Fleet certification regression gate — only fails when a previously certified
 * venue no longer certifies (#402).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CERT_VERSION,
  certificationFile,
  certifyFleetRegression,
} from '../../packages/venue-builder/lib/venue-certify.mjs';
import { venueSidecar } from '../../packages/venue-builder/lib/venue-io.mjs';

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

console.log('\ncertify regression gate\n');

try {
  const gate = certifyFleetRegression({ write: false });
  if (gate.ok) ok('fleet has no certification regressions against committed certification.json');
  else bad('fleet certification regression', gate.regressions.map((r) => `${r.id}: ${r.failedChecks.join(', ')}`).join('; '));
} catch (e) {
  bad('certifyFleetRegression', e.message);
}

// A venue that was never certified must not count as a regression.
{
  const file = certificationFile('big-kahunas');
  const prior = JSON.parse(fs.readFileSync(file, 'utf8'));
  const backup = fs.readFileSync(file);
  try {
    fs.writeFileSync(file, JSON.stringify({ ...prior, certified: false }, null, 2));
    const gate = certifyFleetRegression({ write: false });
    assert.equal(gate.ok, true, 'uncertified prior state should not fail the regression gate');
    ok('uncertified venues do not fail the regression gate');
  } finally {
    fs.writeFileSync(file, backup);
  }
}

// A venue that was certified but no longer passes must surface failing check keys.
{
  const venueId = 'kings-island';
  const file = certificationFile(venueId);
  const cacheFile = venueSidecar(venueId, 'llm-research-cache.json');
  const prior = JSON.parse(fs.readFileSync(file, 'utf8'));
  const certBackup = fs.readFileSync(file);
  const cacheBackup = fs.readFileSync(cacheFile);
  try {
    fs.unlinkSync(cacheFile);
    fs.writeFileSync(
      file,
      JSON.stringify({ ...prior, version: CERT_VERSION, certified: true }, null, 2),
    );
    const gate = certifyFleetRegression({ write: false });
    assert.equal(gate.ok, false, 'de-certification must fail the regression gate');
    assert.equal(gate.regressions.length, 1);
    assert.equal(gate.regressions[0].id, venueId);
    assert.ok(gate.regressions[0].failedChecks.length >= 1, 'regression names failing check keys');
    ok('de-certified venue reports id and failing check keys');
  } finally {
    fs.writeFileSync(file, certBackup);
    fs.writeFileSync(cacheFile, cacheBackup);
  }
}

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
