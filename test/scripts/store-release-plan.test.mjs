#!/usr/bin/env node
/**
 * Store release tier classifier
 *
 *   node test/scripts/store-release-plan.test.mjs
 */
import assert from 'node:assert/strict';
import {
  classifyStoreRelease,
  pathMatchesPrefix,
  storeReleaseCommands,
  tiersForFile,
} from '../../scripts/lib/store-release-plan.mjs';

const prefixes = {
  native_binary: ['ios/', 'android/', 'capacitor.config.json'],
  metadata: ['fastlane/metadata/'],
  web: ['apps/party-tracker/'],
};

assert.equal(pathMatchesPrefix('apps/party-tracker/app/page.js', 'apps/party-tracker/'), true);
assert.equal(pathMatchesPrefix('ios/App/AppDelegate.swift', 'ios/'), true);
assert.equal(pathMatchesPrefix('docs/guide/foo.md', 'apps/party-tracker/'), false);

assert.deepEqual(
  tiersForFile('fastlane/metadata/ios/en-US/description.txt', prefixes),
  ['metadata'],
);
assert.deepEqual(
  tiersForFile('apps/party-tracker/components/Map.js', prefixes),
  ['web'],
);
assert.deepEqual(tiersForFile('ios/App/Podfile', prefixes), ['native_binary']);
assert.deepEqual(tiersForFile('README.md', prefixes), ['none']);

const webOnly = classifyStoreRelease(
  ['apps/party-tracker/app/map/page.js', 'packages/shared/ontology.js'],
  prefixes,
);
assert.equal(webOnly.recommended, 'web');
assert.ok(webOnly.tiers.includes('web'));
assert.ok(!webOnly.tiers.includes('native_binary'));

const native = classifyStoreRelease(['ios/App/AppDelegate.swift'], prefixes);
assert.equal(native.recommended, 'native_binary');

const mixed = classifyStoreRelease(
  ['apps/party-tracker/app/page.js', 'ios/App/AppDelegate.swift'],
  prefixes,
);
assert.equal(mixed.recommended, 'native_binary');
assert.ok(mixed.tiers.includes('web'));

const metadataOnly = classifyStoreRelease(
  ['fastlane/metadata/ios/en-US/release_notes.txt'],
  prefixes,
);
assert.equal(metadataOnly.recommended, 'metadata');
assert.ok(storeReleaseCommands(metadataOnly).some((c) => c.tier === 'metadata'));

const none = classifyStoreRelease(['docs/guide/store-releases.md'], prefixes);
assert.equal(none.recommended, 'none');

console.log('store-release-plan.test.mjs: ok');
