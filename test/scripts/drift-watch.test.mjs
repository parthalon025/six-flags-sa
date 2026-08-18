#!/usr/bin/env node
/**
 * Fleet drift watch CLI — --help/-h short-circuit.
 *
 *   node test/scripts/drift-watch.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const script = join(root, 'packages/venue-builder/bin/drift-watch.mjs');

for (const flag of ['--help', '-h']) {
  const res = spawnSync(process.execPath, [script, flag], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, `${flag} exits 0 (stderr: ${res.stderr})`);
  assert.match(res.stdout, /Fleet drift watch/, `${flag} prints the usage banner`);
  assert.match(
    res.stdout,
    /npm run venues:drift-watch/,
    `${flag} shows the npm invocation`,
  );
  // --help must short-circuit before the manifest read / builder rebuild —
  // no drift summary line should ever appear alongside the usage text.
  assert.doesNotMatch(
    res.stdout,
    /venues would change on rebuild/,
    `${flag} does not run the drift check`,
  );
}

console.log('ok drift-watch --help/-h');
