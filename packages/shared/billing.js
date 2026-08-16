/**
 * Profile billing — Clerk is identity only; stores sell the Profile subscription.
 * One entitlement ledger prevents paying twice across Apple / Google / web.
 */

/** Auto-renewable Profile SKU (must match fastlane/store-identifiers.json). */
export const PROFILE_PRODUCT_ID = 'parkbound_profile_annual';

/** iOS bundle / Android package (must match capacitor.config.json appId). */
export const STORE_APP_ID = 'ai.kurat0r.parkbound';

export const ENTITLEMENT_SOURCES = Object.freeze({
  apple: 'apple',
  google: 'google',
  stripe: 'stripe',
  grant: 'grant',
  /** Pre-StoreKit: signed-in Profile features without a store charge. */
  prelaunch: 'prelaunch',
});

/** Paid features that need an active Profile entitlement (not just Clerk sign-in). */
export const PAID_PROFILE_ACTIONS = Object.freeze([
  'managed-guest',
  'planner-sync',
  'multi-device',
]);

/**
 * Billing mode:
 * - prelaunch: sign-in mints a complimentary entitlement until StoreKit ships
 * - enforce: paid features require store/web entitlement (no double-charge rails)
 */
export function billingModeFromEnv(env = process.env) {
  const raw = String(env.PROFILE_BILLING_MODE || 'prelaunch').trim().toLowerCase();
  return raw === 'enforce' ? 'enforce' : 'prelaunch';
}

/**
 * @param {{ active?: boolean, source?: string } | null | undefined} entitlement
 * @param {'managed-guest'|'planner-sync'|'multi-device'} action
 */
export function requiresPaidProfile(entitlement, action) {
  if (!PAID_PROFILE_ACTIONS.includes(action)) return false;
  return !entitlement?.active;
}

/**
 * Store apps must use native IAP only — never Clerk Billing or web checkout in the shell.
 * @param {{ isNative?: boolean }} ctx
 */
export function allowedPaymentChannel(ctx = {}) {
  if (ctx.isNative) return ctx.platform === 'ios' ? 'apple' : 'google';
  return 'web';
}

/** Block in-app web checkout inside the Capacitor shell (Guideline 3.1.1 / double-pay). */
export function webCheckoutAllowed(ctx = {}) {
  return !ctx.isNative;
}

/** Human-readable Profile price for auth / paywall copy. */
export function profilePriceLabel({ priceUsd = 10, duration = 'year' } = {}) {
  const usd = Number(priceUsd);
  const amount = Number.isFinite(usd) ? `$${usd.toFixed(2)}` : '$10.00';
  return `${amount} / ${duration}`;
}
