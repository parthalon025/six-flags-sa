#!/usr/bin/env node
/**
 * venues:report CLI — all-venues summary exits 0 after workspace install.
 *
 * Gate runs before `npm ci` links @party-tracker/shared; the checklist gate
 * lives in venue-report-gate.test.mjs. This file runs in test:unit where the
 * workspace exists, so the CLI can load external-claims for the summary path.
 *
 *   node test/scripts/venues-report-cli.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

{
  const res = spawnSync('npm', ['run', 'venues:report'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(
    res.status,
    0,
    `venues:report exited ${res.status}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
  );
  assert.match(res.stdout, /What every location here is carrying/);
}

console.log('venues-report-cli: ok (npm run venues:report exits 0 for every shipped venue)');
