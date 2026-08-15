#!/usr/bin/env node
/**
 * Event-driven release cycle classifier
 *
 *   node test/scripts/release-cycle.test.mjs
 */
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyStoreRelease } from '../../scripts/lib/store-release-plan.mjs';
import {
  buildReleaseCycleReport,
  releaseCycleChecklist,
} from '../../scripts/lib/release-cycle.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const webOnly = classifyStoreRelease(['apps/party-tracker/app/page.js']);
assert.equal(webOnly.recommended, 'web');

const report = buildReleaseCycleReport({ repoRoot });
assert.ok(report.appVersion);
assert.ok(['web_continuous', 'native_pending', 'first_store_submit'].includes(report.mode));
assert.ok(report.modeLabel);
assert.ok(Array.isArray(releaseCycleChecklist(report)));

const nativeFiles = buildReleaseCycleReport({
  repoRoot,
  sinceRef: null,
});
assert.ok(nativeFiles.classification);

console.log('release-cycle.test.mjs: ok');
