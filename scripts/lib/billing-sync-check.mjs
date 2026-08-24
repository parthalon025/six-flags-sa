/**
 * Assert Clerk (identity), Capacitor shell, fastlane ASC, and shared billing constants agree.
 * Prevents double-charge rails and bundle / SKU drift between Apple and the web app.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  iosBundleId,
  loadStoreProductConfig,
  profileProductId,
} from './store-product-config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function readJson(rel) {
  return JSON.parse(readFileSync(join(root, rel), 'utf8'));
}

function readText(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

/**
 * @returns {{ ok: boolean, issues: string[] }}
 */
export function billingSyncIssues() {
  const issues = [];
  const store = loadStoreProductConfig();
  const capacitor = readJson('capacitor.config.json');
  const billing = readText('packages/shared/billing.js');
  const entitlements = readText('ios/App/App/App.entitlements');

  const bundleId = iosBundleId();
  const productId = profileProductId();

  if (capacitor.appId !== bundleId) {
    issues.push(`capacitor.config.json appId (${capacitor.appId}) != fastlane bundleId (${bundleId})`);
  }

  if (!billing.includes(`PROFILE_PRODUCT_ID = '${productId}'`)) {
    issues.push(`packages/shared/billing.js PROFILE_PRODUCT_ID must be '${productId}'`);
  }

  if (!billing.includes(`STORE_APP_ID = '${bundleId}'`)) {
    issues.push(`packages/shared/billing.js STORE_APP_ID must be '${bundleId}'`);
  }

  if (!billing.includes('Clerk is identity only')) {
    issues.push('packages/shared/billing.js must document Clerk as identity-only (no Clerk Billing)');
  }

  if (!entitlements.includes('applinks:parkbound.kurat0r.ai')) {
    issues.push('ios/App/App/App.entitlements missing applinks:parkbound.kurat0r.ai');
  }

  if (!entitlements.includes('webcredentials:clerk.parkbound.kurat0r.ai')) {
    issues.push('ios/App/App/App.entitlements missing webcredentials:clerk.parkbound.kurat0r.ai');
  }

  if (!entitlements.includes('webcredentials:accounts.parkbound.kurat0r.ai')) {
    issues.push('ios/App/App/App.entitlements missing webcredentials:accounts.parkbound.kurat0r.ai');
  }

  const allowNav = capacitor.server?.allowNavigation || [];
  for (const host of ['clerk.parkbound.kurat0r.ai', 'accounts.parkbound.kurat0r.ai']) {
    if (!allowNav.includes(host)) {
      issues.push(`capacitor.config.json allowNavigation missing ${host}`);
    }
  }

  const profilePrice = store.ios.profile.priceUsd;
  if (profilePrice !== 10) {
    issues.push(`fastlane profile priceUsd is ${profilePrice}; shared copy assumes $10/yr`);
  }

  const clerkSetup = readText('scripts/clerk-setup.mjs');
  if (!clerkSetup.includes(`${bundleId}://callback`)) {
    issues.push(`scripts/clerk-setup.mjs missing native redirect ${bundleId}://callback`);
  }

  return { ok: issues.length === 0, issues };
}
