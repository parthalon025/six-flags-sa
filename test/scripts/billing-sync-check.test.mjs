#!/usr/bin/env node
/**
 * Billing constants + Apple/Clerk/Capacitor identifier sync.
 *
 *   node test/scripts/billing-sync-check.test.mjs
 */
import assert from 'node:assert/strict';
import {
  ENTITLEMENT_SOURCES,
  PAID_PROFILE_ACTIONS,
  PROFILE_PRODUCT_ID,
  STORE_APP_ID,
  allowedPaymentChannel,
  billingModeFromEnv,
  profilePriceLabel,
  requiresPaidProfile,
  webCheckoutAllowed,
} from '../../packages/shared/billing.js';
import { billingSyncIssues } from '../../scripts/lib/billing-sync-check.mjs';
import {
  clerkAppleServicesId,
  iosBundleId,
  loadStoreProductConfig,
  profileProductId,
} from '../../scripts/lib/store-product-config.mjs';

assert.equal(PROFILE_PRODUCT_ID, 'parkbound_profile_annual');
assert.equal(STORE_APP_ID, 'ai.kurat0r.parkbound');
assert.equal(profileProductId(), PROFILE_PRODUCT_ID);
assert.equal(iosBundleId(), STORE_APP_ID);
assert.equal(clerkAppleServicesId(), 'ai.kurat0r.parkbound.web');

const store = loadStoreProductConfig();
assert.equal(store.ios.profile.productId, PROFILE_PRODUCT_ID);
assert.equal(store.ios.profile.priceUsd, 10);

assert.equal(profilePriceLabel({ priceUsd: 10, duration: 'year' }), '$10.00 / year');
assert.equal(billingModeFromEnv({ PROFILE_BILLING_MODE: 'enforce' }), 'enforce');
assert.equal(billingModeFromEnv({}), 'prelaunch');
assert.equal(allowedPaymentChannel({ isNative: true, platform: 'ios' }), 'apple');
assert.equal(webCheckoutAllowed({ isNative: true }), false);
assert.equal(webCheckoutAllowed({ isNative: false }), true);
assert.equal(requiresPaidProfile(null, 'managed-guest'), true);
assert.equal(requiresPaidProfile({ active: true }, 'managed-guest'), false);
assert.equal(requiresPaidProfile({ active: true }, 'unknown'), false);
assert.ok(PAID_PROFILE_ACTIONS.includes('managed-guest'));
assert.ok(ENTITLEMENT_SOURCES.apple === 'apple');

const { ok, issues } = billingSyncIssues();
if (!ok) {
  console.error(issues.join('\n'));
  process.exit(1);
}
assert.equal(ok, true);

console.log('billing-sync-check.test.mjs: ok');
