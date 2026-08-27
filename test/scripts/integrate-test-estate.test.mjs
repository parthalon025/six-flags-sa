#!/usr/bin/env node
/**
 * Integrator audit — the checklist catches the same gaps as the three guards.
 *
 *   node test/scripts/integrate-test-estate.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditTestIntegration,
  gateManifestProblems,
  suggestIntegrationFixes,
  suiteWiringProblems,
} from '../../scripts/lib/integrate-test-estate.mjs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

assert.deepEqual(
  auditTestIntegration(ROOT).estate,
  [],
  'the live repo estate audits clean — run with --suggest on a broken integrator branch',
);

// Gate manifest: orphan and bad entry
{
  const gateTests = ['test/scripts/ok.test.mjs', 'not-a-path'];
  const gateExcluded = {};
  const dir = mkdtempSync(join(tmpdir(), 'integrate-gate-'));
  mkdirSync(join(dir, 'test/scripts'), { recursive: true });
  writeFileSync(join(dir, 'test/scripts/ok.test.mjs'), '');
  writeFileSync(join(dir, 'test/scripts/orphan.test.mjs'), '');
  const problems = gateManifestProblems(dir, gateTests, gateExcluded);
  assert.ok(problems.some((p) => p.includes('orphan.test.mjs')), 'orphan script test is caught');
  assert.ok(problems.some((p) => p.includes('not-a-path')), 'bad manifest path is caught');
}

// Suite wiring: builder orphan
{
  const dir = mkdtempSync(join(tmpdir(), 'integrate-wire-'));
  mkdirSync(join(dir, 'test/builder'), { recursive: true });
  mkdirSync(join(dir, 'test/app'), { recursive: true });
  writeFileSync(join(dir, 'test/builder/orphan.mjs'), '');
  writeFileSync(join(dir, 'test/app/modules.json'), '[]');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    scripts: { 'test:builder': 'node test/builder/other.mjs' },
  }));
  const problems = suiteWiringProblems(dir);
  assert.ok(problems.some((p) => p.includes('orphan.mjs')), 'unwired builder suite is caught');
}

// Suggestions name the three-file fix
{
  const hints = suggestIntegrationFixes({
    estate: ['test/builder/foo.mjs is in neither TEST_ESTATE nor TEST_ESTATE_EXCLUDED — x'],
    gate: ['test/scripts/bar.test.mjs is in neither GATE_SCRIPT_TESTS nor GATE_EXCLUDED_TESTS'],
    wiring: ['test/builder/baz.mjs is in no npm script — x'],
  });
  assert.ok(hints.some((h) => h.includes('test-estate.mjs') && h.includes('foo.mjs')));
  assert.ok(hints.some((h) => h.includes('manifest.mjs') && h.includes('bar.test.mjs')));
  assert.ok(hints.some((h) => h.includes('test:builder') && h.includes('baz.mjs')));
}

console.log('integrate-test-estate: ok');
