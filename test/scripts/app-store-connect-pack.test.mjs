#!/usr/bin/env node
/**
 * App Store Connect version-submit pack: routing GeoJSON, export
 * compliance, review info, IAP policy, and manual release.
 *
 *   node test/scripts/app-store-connect-pack.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_POLYGONS,
  PAD_DEG,
  ROUTING_COVERAGE_REL,
  coverageFromVenues,
  pointInCoverage,
  routingCoverageIssues,
} from '../../scripts/lib/routing-app-coverage.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

const venues = readJson('apps/party-tracker/public/venues/manifest.json').venues;
assert.ok(venues.length >= 1, 'shipped venues feed routing coverage');
assert.ok(
  venues.every((v) => v.bounds?.west != null && v.bounds?.north != null),
  'every shipped venue has a bounding box',
);

const coverage = coverageFromVenues(venues);
assert.equal(coverage.type, 'MultiPolygon');
assert.equal(coverage.coordinates.length, venues.length);
assert.ok(coverage.coordinates.length <= MAX_POLYGONS);
assert.deepEqual(routingCoverageIssues(coverage), []);

const firstRing = coverage.coordinates[0][0];
assert.ok(firstRing.length >= 5, 'closed rectangle is 5 positions (4 corners + close)');
assert.deepEqual(firstRing[0], firstRing.at(-1), 'ring must close');
assert.equal(firstRing[0].length, 2, 'positions are [lng, lat]');

const sortedIds = [...venues].map((v) => v.id).sort();
const ki = venues.find((v) => v.id === 'kings-island');
assert.ok(ki);
const kiIndex = sortedIds.indexOf('kings-island');
const kiRing = coverage.coordinates[kiIndex][0];
const lngs = kiRing.map((p) => p[0]);
const lats = kiRing.map((p) => p[1]);
assert.ok(Math.min(...lngs) < ki.bounds.west, 'pad west');
assert.ok(Math.max(...lngs) > ki.bounds.east, 'pad east');
assert.ok(Math.min(...lats) < ki.bounds.south, 'pad south');
assert.ok(Math.max(...lats) > ki.bounds.north, 'pad north');
assert.ok(Math.abs(Math.min(...lngs) - (ki.bounds.west - PAD_DEG)) < 1e-9);

assert.equal(
  pointInCoverage(coverage, ki.center),
  true,
  'Kings Island center is inside its padded box',
);
assert.equal(pointInCoverage(coverage, { lat: 0, lng: 0 }), false);

assert.deepEqual(
  routingCoverageIssues({ type: 'Polygon', coordinates: [] }),
  ['type must be MultiPolygon'],
);
assert.match(
  routingCoverageIssues({
    type: 'MultiPolygon',
    coordinates: [[[ [0, 0], [1, 0], [1, 1], [0, 1] ]]],
  }).join('\n'),
  /closed ring/i,
);

const committed = readJson(ROUTING_COVERAGE_REL);
assert.deepEqual(
  committed,
  coverage,
  `${ROUTING_COVERAGE_REL} must match coverageFromVenues(manifest) — run npm run store:scaffold-metadata`,
);

const declarations = readJson('fastlane/store-declarations.json');
const exportCompliance = declarations.appleExportCompliance;
assert.equal(exportCompliance.usesEncryption, true);
assert.equal(exportCompliance.exempt, true);
assert.equal(exportCompliance.itsAppUsesNonExemptEncryption, false);
assert.equal(exportCompliance.uploadDocumentation, false);

const plist = read('ios/App/App/Info.plist');
assert.match(plist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);

const review = declarations.appleAppReview;
assert.equal(review.signInRequired, false);
assert.equal(review.attachment, null);

const release = declarations.appleVersionRelease;
assert.equal(release.mode, 'manual');
assert.equal(release.automaticRelease, false);

const iap = declarations.appleInAppPurchases;
assert.equal(iap.submitWithThisVersion, false);
assert.equal(iap.productId, 'parkbound_profile_annual');
assert.equal(iap.firstIapMustSubmitWithAppVersion, true);

const identifiers = readJson('fastlane/store-identifiers.json');
assert.equal(identifiers.ios.pricing.profile.productId, iap.productId);
assert.equal(read('fastlane/metadata/ios/primary_category.txt').trim(), 'NAVIGATION');
assert.equal(read('fastlane/metadata/ios/secondary_category.txt').trim(), 'TRAVEL');

const notes = read('fastlane/metadata/ios/review_information/notes.txt');
assert.ok(notes.length <= 4000, 'App Review notes cap is 4,000 characters');
assert.match(notes, /Sign-in required/i);
assert.match(notes, /not required/i);
assert.match(notes, /HTTPS/i);
assert.match(notes, /parkbound_profile_annual/);
assert.match(notes, /Manually release/i);
assert.match(notes, /routing_app_coverage\.geojson/);
assert.match(notes, /tap Guest/i);

const fastfile = read('fastlane/Fastfile');
assert.match(fastfile, /routing_app_coverage:/);
assert.match(fastfile, /export_compliance_is_exempt:\s*true/);
assert.match(fastfile, /export_compliance_uses_encryption:\s*true/);
assert.match(fastfile, /IOS_AUTOMATIC_RELEASE.*false/);
assert.match(fastfile, /def ios_submission_information/);
assert.match(fastfile, /def ios_routing_app_coverage/);
// Store binaries → ios must not require Google Play secrets (Actions sets iOS only).
assert.match(fastfile, /def load_ios_deployment_env!/);
assert.match(fastfile, /def load_android_deployment_env!/);
assert.match(
  fastfile,
  /SharedValues::PLATFORM_NAME/,
  'before_all must pick iOS vs Android env from the active platform',
);
// gym/build_app has no api_key — ASC key is for upload_to_testflight / deliver only.
const betaBuild = fastfile.slice(fastfile.indexOf('desc "Build and upload a TestFlight beta"'));
assert.doesNotMatch(
  betaBuild.slice(0, betaBuild.indexOf('upload_to_testflight')),
  /build_app\([\s\S]*api_key:/,
  'ios beta build_app must not pass api_key',
);
assert.match(
  fastfile,
  /DEVELOPMENT_TEAM=#\{ENV\.fetch\("IOS_TEAM_ID"\)\}/,
  'CI automatic signing needs the team id on gym xcargs',
);

const productionBlock = fastfile.slice(fastfile.indexOf('lane :production'));
assert.match(
  productionBlock,
  /ios_submission_information/,
  'production deliver must send export-compliance answers, not IDFA-only',
);
assert.match(productionBlock, /ios_routing_app_coverage/);
assert.match(productionBlock, /automatic_release:/);

const sections = read('fastlane/metadata/ios/SECTIONS.md');
assert.match(sections, /routing_app_coverage\.geojson/);
assert.match(sections, /Sign-in required/);
assert.match(sections, /Manually release/);

console.log('app-store-connect-pack.test.mjs: ok');
