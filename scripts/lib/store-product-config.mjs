/**
 * Canonical store + Profile product ids — read from fastlane/store-identifiers.json.
 * Clerk (identity), Capacitor (shell), and App Store Connect must match these values.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const storePath = join(root, 'fastlane/store-identifiers.json');

/** @typedef {{ productId: string, displayName: string, duration: string, priceUsd: number, notes?: string }} ProfileProduct */
/** @typedef {{ bundleId: string, teamId?: string, sku: string, profile: ProfileProduct }} IosStoreConfig */

let cached = null;

export function loadStoreProductConfig() {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(storePath, 'utf8'));
  const ios = raw.ios || {};
  const profile = ios.pricing?.profile;
  if (!profile?.productId) {
    throw new Error('fastlane/store-identifiers.json missing ios.pricing.profile.productId');
  }
  if (!ios.bundleId) throw new Error('fastlane/store-identifiers.json missing ios.bundleId');
  cached = {
    ios: {
      bundleId: ios.bundleId,
      teamId: ios.teamId || null,
      sku: ios.sku || null,
      profile: {
        productId: profile.productId,
        displayName: profile.displayName || 'Profile',
        duration: profile.duration || '1 year',
        priceUsd: Number(profile.priceUsd) || 10,
        notes: profile.notes || '',
      },
    },
    android: {
      packageName: raw.android?.packageName || ios.bundleId,
    },
    urls: raw.urls || {},
  };
  return cached;
}

export function profileProductId() {
  return loadStoreProductConfig().ios.profile.productId;
}

export function iosBundleId() {
  return loadStoreProductConfig().ios.bundleId;
}

export function clerkAppleBundleId() {
  return iosBundleId();
}

export function clerkAppleServicesId() {
  return `${iosBundleId()}.web`;
}
