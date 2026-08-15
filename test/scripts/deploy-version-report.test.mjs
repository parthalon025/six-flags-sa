#!/usr/bin/env node
/**
 * Deploy version matrix formatter
 *
 *   node test/scripts/deploy-version-report.test.mjs
 */
import assert from 'node:assert/strict';
import { compareVersions } from '../../apps/party-tracker/lib/version.js';
import { formatDeployVersionBrief } from '../../scripts/lib/deploy-version-report.mjs';

assert.equal(compareVersions('1.12.1', '1.7.0') > 0, true);

const sample = {
  repo: {
    version: '1.12.1',
    bump: { from: '1.12.0', to: '1.12.1', skipped: false },
    lastStoreTag: null,
  },
  web: {
    production: {
      ok: true,
      version: '1.7.0',
      built: '2026-08-14T17:18:59.152Z',
      sha: 'ad02355',
      url: 'https://parkbound.kurat0r.ai/api/version',
      lag: 'deploy pending (repo ahead)',
    },
    preview: {
      skipped: true,
      reason: 'Previews deploy only on user directive',
    },
  },
  stores: {
    ios: { skipped: true, reason: 'App Store Connect API key not configured' },
    android: { skipped: true, reason: 'Play version query not wired in CI yet' },
  },
};

const brief = formatDeployVersionBrief(sample);
assert.match(brief, /Version matrix/);
assert.match(brief, /1\.12\.1/);
assert.match(brief, /1\.7\.0/);
assert.match(brief, /deploy pending/);
assert.match(brief, /preview/i);

console.log('deploy-version-report.test.mjs: ok');
