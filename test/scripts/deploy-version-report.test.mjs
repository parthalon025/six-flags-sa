#!/usr/bin/env node
/**
 * Deploy version matrix formatter + poll
 *
 *   node test/scripts/deploy-version-report.test.mjs
 */
import assert from 'node:assert/strict';
import { compareVersions } from '../../apps/party-tracker/lib/version.js';
import {
  formatDeployVersionBrief,
  formatDeployVersionOneline,
  waitForProductionVersion,
} from '../../scripts/lib/deploy-version-report.mjs';

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
      lag: 'STALE',
      deployWait: { matched: false, elapsedMs: 120_000 },
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

const oneline = formatDeployVersionOneline(sample);
assert.match(oneline, /^main 1\.12\.1 \(from 1\.12\.0\)/);
assert.match(oneline, /vercel:prod 1\.7\.0 STALE/);
assert.match(oneline, /store:tag none/);

const brief = formatDeployVersionBrief(sample);
assert.match(brief, /Deploy poll timed out/);
assert.match(brief, /Version matrix/);

const poll = await waitForProductionVersion('99.99.99', {
  timeoutMs: 500,
  intervalMs: 100,
});
assert.equal(poll.matched, false);
assert.ok(poll.elapsedMs >= 100);

console.log('deploy-version-report.test.mjs: ok');
console.log('oneline sample:', oneline);
