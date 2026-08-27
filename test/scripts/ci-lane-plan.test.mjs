#!/usr/bin/env node
/**
 * Canon CI lane plan — static steps and GitHub job flags from vertical lanes.
 *
 *   node test/scripts/ci-lane-plan.test.mjs
 */
import assert from 'node:assert/strict';
import {
  canonLanePlan,
  jobsRequiredByCanon,
  jobsProvenByStamp,
  staticStepsForFiles,
  stampProvesCanonJobs,
} from '../../scripts/lib/ci-lane-plan.mjs';

assert.deepEqual(
  staticStepsForFiles(['scripts/lib/vertical-e2e.mjs']),
  ['test:ci-gate'],
  'backside-only owes ci-gate, not app build',
);

assert.deepEqual(
  staticStepsForFiles(['packages/venue-builder/venue-adapters.mjs']),
  [],
  'builder-only owes no static floor — test:builder is the vertical',
);

const guestSteps = staticStepsForFiles(['apps/party-tracker/components/Sheet.jsx']);
assert.ok(guestSteps.includes('build'), 'guest UI owes full static floor including build');
assert.ok(guestSteps.includes('lint'));

const agentPolicy = canonLanePlan(['.scratch/factories-to-app/map.md']);
assert.deepEqual(agentPolicy.verticals, []);
assert.deepEqual(agentPolicy.staticSteps, []);

const builderPlan = canonLanePlan(['packages/venue-builder/lib/map-factory/foo.mjs']);
assert.equal(builderPlan.runBuilder, true);
assert.equal(builderPlan.runMapFactory, true);

const requiredBackside = jobsRequiredByCanon(['scripts/lib/matt-review.mjs']);
assert.deepEqual(requiredBackside, [], 'ci-gate proves no skippable GitHub jobs alone');

const requiredGuest = jobsRequiredByCanon(['apps/party-tracker/components/Sheet.jsx']);
assert.ok(requiredGuest.includes('app-build'));
assert.ok(requiredGuest.includes('ui'));

const stamp = {
  staticSteps: ['test:ci-gate'],
  verticals: ['backside'],
  factoryLegs: [],
};
const ctx = {
  files: ['scripts/lib/vertical-e2e.mjs'],
  staticSteps: ['test:ci-gate'],
  verticals: ['backside'],
};
assert.equal(jobsProvenByStamp(stamp).length, 0, 'ci-gate alone proves no skippable jobs');
assert.equal(stampProvesCanonJobs(stamp, ctx), true, 'backside-only needs no GitHub job skips');

const fullStamp = {
  staticSteps: ['test:ci-gate', 'test:unit', 'lint', 'test:module-select', 'build'],
  verticals: ['app'],
  browserVertical: true,
  factoryLegs: [],
};
const guestCtx = {
  files: ['apps/party-tracker/components/Sheet.jsx'],
  staticSteps: fullStamp.staticSteps,
  verticals: ['app'],
};
assert.equal(stampProvesCanonJobs(fullStamp, guestCtx), true);

console.log('ci-lane-plan: ok');
