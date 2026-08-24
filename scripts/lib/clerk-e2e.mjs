/**
 * Auth UI changes need a Clerk-on browser pass before merge.
 * Clerk-off CI guards stay in the `auth` module; they do not prove login.
 * Google OAuth redirect is opt-in (`CLERK_E2E_GOOGLE=1`) until that provider is enabled.
 */

import { clerkEnvFileHasPublishableKey } from './cloud-agent-clerk-env.mjs';

export const AUTH_E2E_PATH_NEEDLES = [
  'apps/party-tracker/app/page.js',
  'apps/party-tracker/components/ClerkSetupRequired.jsx',
  'apps/party-tracker/components/AuthGate.jsx',
  'apps/party-tracker/components/AuthGateActions.jsx',
  'apps/party-tracker/components/SignInCard.jsx',
  'apps/party-tracker/components/OAuthButtons.jsx',
  'apps/party-tracker/lib/auth/clerkOAuth.js',
  'apps/party-tracker/lib/auth/useClerkOAuth.js',
  'apps/party-tracker/lib/clerkConfigured.js',
  'apps/party-tracker/app/sign-in/',
];

export function authUiRequiresClerkE2e(files = []) {
  return files.some((file) => {
    const f = String(file);
    return AUTH_E2E_PATH_NEEDLES.some((needle) => f === needle || f.startsWith(needle) || f.includes(needle));
  });
}

export function clerkPublishableKeyPresent(env = process.env) {
  return Boolean(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

/** @returns {string | null} blocker, or null when merge e2e may proceed */
export function clerkE2eBlockReason({
  files = [],
  env = process.env,
  skipBrowser = false,
  cwd = process.cwd(),
} = {}) {
  if (!authUiRequiresClerkE2e(files)) return null;
  if (skipBrowser) {
    return 'auth UI changed — Clerk-on browser e2e is required (do not --skip-browser)';
  }
  if (clerkPublishableKeyPresent(env)) return null;
  if (clerkEnvFileHasPublishableKey(cwd)) {
    return null;
  }
  return 'auth UI changed — set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and run the auth module against a Clerk-on build';
}
