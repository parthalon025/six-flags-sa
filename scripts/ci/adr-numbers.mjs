#!/usr/bin/env node
/**
 * ADR number drift gate — fails when one number names two ADRs.
 *
 * Thin CLI over `scripts/lib/adr-numbers.mjs`; the decision lives there.
 * Runs in the gate via `test/scripts/adr-numbers.test.mjs`
 * (`scripts/ci/manifest.mjs`), which is the `gate` job on every PR.
 *
 *   node scripts/ci/adr-numbers.mjs
 *
 * Interface:
 *   runAdrNumbersCheck({ dir, log })
 */
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adrDriftReport, formatAdrDrift } from '../lib/adr-numbers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const ADR_DIR = join(root, 'docs/adr');

/**
 * @param {{dir?: string, log?: (message: string) => void}} [options]
 * @returns {0|1} process exit code — 0 when every ADR number names one file.
 */
export function runAdrNumbersCheck({ dir = ADR_DIR, log = console.error } = {}) {
  const report = adrDriftReport(readdirSync(dir));
  if (report.ok) return 0;
  log(formatAdrDrift(report));
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = runAdrNumbersCheck();
  if (code !== 0) process.exit(code);
  console.log('adr-numbers: ok');
}
