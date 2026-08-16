#!/usr/bin/env node
/**
 * Apple Developer inventory: Identifiers vs Xcode vs Keys vs Connect.
 *
 *   node test/scripts/apple-developer.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  laterIdentifierIds,
  loadAppleDeveloper,
  neverCreate,
  shellGaps,
  siwaWeb,
  surfaces,
} from '../../scripts/lib/apple-developer.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const spec = loadAppleDeveloper();

function item(id) {
  const found = spec.items.find((row) => row.id === id);
  assert.ok(found, id);
  return found;
}

assert.equal(spec.teamId, 'CDHJC4MH4G');
assert.equal(spec.bundleId, 'ai.kurat0r.parkbound');
assert.equal(spec.appleId, '269608486');

assert.deepEqual(surfaces(item('background-modes')), ['xcode']);
assert.deepEqual(item('background-modes').plistKeys, [
  'location',
  'remote-notification',
]);
assert.equal(item('background-modes').status, 'now');

assert.deepEqual(surfaces(item('push-notifications')), ['identifiers']);
assert.deepEqual(surfaces(item('associated-domains')), ['identifiers', 'xcode']);
assert.equal(item('associated-domains').applinksHost, 'parkbound.kurat0r.ai');

assert.equal(item('services-id').value, 'ai.kurat0r.parkbound.web');
assert.deepEqual(surfaces(item('services-id')), ['identifiers']);

assert.deepEqual(siwaWeb(spec), {
  domain: 'clerk.parkbound.kurat0r.ai',
  returnUrl: 'https://clerk.parkbound.kurat0r.ai/v1/oauth_callback',
});

assert.equal(item('siwa-key').keyId, 'ZZNS5TWZ74');
assert.deepEqual(surfaces(item('siwa-key')), ['keys']);
assert.equal(item('asc-api-key').keyId, '45W483PCTK');
assert.deepEqual(surfaces(item('asc-api-key')), ['keys']);
assert.equal(item('asc-api-key').portal, 'users-and-access');

assert.equal(item('iap-profile').productId, 'parkbound_profile_annual');
assert.deepEqual(surfaces(item('iap-profile')), ['connect']);
assert.equal(item('iap-profile').status, 'later');

assert.deepEqual(
  laterIdentifierIds(spec).sort(),
  [
    'app-clip',
    'app-group',
    'nfc-tag-reading',
    'watch-app-id',
    'widget-app-id',
  ].sort(),
);
assert.equal(item('sign-in-with-apple-entitlement').status, 'later');
assert.deepEqual(surfaces(item('sign-in-with-apple-entitlement')), ['xcode']);
assert.equal(item('apns-auth-key').status, 'later');

assert.deepEqual(
  neverCreate(spec).sort(),
  [
    'game-center',
    'healthkit',
    'icloud',
    'merchant-id',
    'pass-type-id',
    'website-push-id',
  ].sort(),
);

const plist = readFileSync(join(root, 'ios/App/App/Info.plist'), 'utf8');
const entitlements = readFileSync(join(root, 'ios/App/App/App.entitlements'), 'utf8');
assert.deepEqual(shellGaps(plist, entitlements, spec), []);

assert.ok(!entitlements.includes('com.apple.developer.applesignin'));
assert.ok(!entitlements.includes('com.apple.security.application-groups'));
