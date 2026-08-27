#!/usr/bin/env node
/**
 * stamp-coverage CLI — manifest-driven default venue list (#416).
 *
 *   node test/builder/stamp-coverage.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  resolveStampCoverageIds,
  stampCoverage,
} from '../../packages/venue-builder/lib/stamp-coverage-run.mjs';

const PASS = [];
const FAIL = [];

function check(name, fn) {
  try {
    fn();
    PASS.push(name);
    console.log('  PASS', name);
  } catch (e) {
    FAIL.push(`${name} :: ${e.message.split('\n')[0]}`);
    console.log('  FAIL', name, '->', e.message.split('\n')[0]);
  }
}

console.log('\nstamp-coverage\n');

check('no explicit ids enumerates every venue package', () => {
  const ids = resolveStampCoverageIds([], () => ['alpha-park', 'beta-park', 'cedar-point']);
  assert.deepEqual(ids, ['alpha-park', 'beta-park', 'cedar-point']);
});

check('explicit ids are passed through unchanged', () => {
  const ids = resolveStampCoverageIds(['only-one'], () => ['alpha-park', 'beta-park']);
  assert.deepEqual(ids, ['only-one']);
});

check('missing map file is skipped with a notice, not a crash', () => {
  const venueDir = mkdtempSync(path.join(tmpdir(), 'stamp-cov-'));
  writeFileSync(
    path.join(venueDir, 'has-map.map.json'),
    JSON.stringify({
      meta: { name: 'Has Map' },
      paths: [{ r: [[0, 0], [0.001, 0]], f: 0, l: 0 }],
    }),
  );
  const logs = [];
  const result = stampCoverage({
    ids: ['has-map', 'no-map'],
    venueDir,
    existsSync,
    readFileSync,
    writeFileSync: (file, data) => writeFileSync(file, data),
    log: (msg) => logs.push(msg),
  });
  assert.deepEqual(result.stamped, ['has-map']);
  assert.deepEqual(result.skipped, ['no-map']);
  assert.ok(logs.some((l) => l.includes('no-map') && l.includes('skip')));
});

check('explicit id without map file throws', () => {
  const venueDir = mkdtempSync(path.join(tmpdir(), 'stamp-cov-'));
  assert.throws(
    () =>
      stampCoverage({
        ids: ['missing'],
        venueDir,
        explicit: true,
        existsSync,
        readFileSync,
        writeFileSync: () => {},
        log: () => {},
      }),
    /missing.*map\.json/,
  );
});

check('re-stamping a venue is idempotent', () => {
  const venueDir = mkdtempSync(path.join(tmpdir(), 'stamp-cov-'));
  const mapFile = path.join(venueDir, 'demo.map.json');
  const seed = {
    meta: { name: 'Demo' },
    paths: [{ r: [[-82.7, 41.4], [-82.699, 41.401]], f: 0, l: 0 }],
  };
  writeFileSync(mapFile, `${JSON.stringify(seed)}\n`);

  const first = stampCoverage({
    ids: ['demo'],
    venueDir,
    existsSync,
    readFileSync,
    writeFileSync: (file, data) => writeFileSync(file, data),
    log: () => {},
  });
  const afterFirst = readFileSync(mapFile, 'utf8');
  const second = stampCoverage({
    ids: ['demo'],
    venueDir,
    existsSync,
    readFileSync,
    writeFileSync: (file, data) => writeFileSync(file, data),
    log: () => {},
  });
  const afterSecond = readFileSync(mapFile, 'utf8');
  assert.equal(first.stamped.length, 1);
  assert.equal(second.stamped.length, 1);
  assert.equal(afterFirst, afterSecond);
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
