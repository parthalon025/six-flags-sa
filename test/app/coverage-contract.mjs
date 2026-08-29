#!/usr/bin/env node
/**
 * Gate: every critical-path row names a check that exists in its suite file.
 *
 *   node test/app/coverage-contract.mjs
 *   node test/app/coverage-contract.mjs --stamp   # restamp context fingerprint
 *
 * Covers suites listed in critical-paths.json `suites` (functional, grandma).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CONTRACT = new URL('./critical-paths.json', import.meta.url);
const contract = JSON.parse(readFileSync(CONTRACT, 'utf8'));

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

function extractChecks(src) {
  const checks = new Set();
  const re = /await\s+check\s*\(\s*(['"])([\s\S]*?)\1/gm;
  for (const m of src.matchAll(re)) checks.add(m[2]);
  return checks;
}

function suiteSource(suite) {
  const rel = contract.suites?.[suite];
  assert.ok(rel, `unknown suite "${suite}" — add it to critical-paths.json suites or exclude the row`);
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

if (process.argv.includes('--stamp')) {
  const files = contract.context?.files || [];
  const hash = createHash('sha256');
  for (const rel of files) {
    hash.update(readFileSync(path.join(ROOT, rel)));
  }
  contract.context.sha256 = hash.digest('hex');
  writeFileSync(CONTRACT, `${JSON.stringify(contract, null, 2)}\n`);
  console.log(`restamped context sha256: ${contract.context.sha256}`);
  process.exit(0);
}

console.log('\ncritical-path coverage contract\n');

for (const row of contract.paths || []) {
  const { id, suite } = row;
  if (!suite) continue;
  const src = suiteSource(suite);

  if (row.check) {
    check(`${id}: functional check exists verbatim in ${contract.suites[suite]}`, () => {
      const checks = extractChecks(src);
      assert.ok(
        checks.has(row.check),
        `critical-path "${id}" names check "${row.check}" but ${contract.suites[suite]} has no matching await check(...)`,
      );
    });
  } else if (row.check_includes) {
    check(`${id}: grandma check_includes appears in ${contract.suites[suite]}`, () => {
      assert.ok(
        src.includes(row.check_includes),
        `critical-path "${id}" expects check_includes "${row.check_includes}" in ${contract.suites[suite]}`,
      );
    });
  } else {
    check(`${id}: row names check or check_includes`, () => {
      assert.fail(`critical-path "${id}" has neither check nor check_includes`);
    });
  }
}

console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) {
  for (const f of FAIL) console.log('  -', f);
  process.exit(1);
}
