/**
 * Clerk is mandatory for Park Bound (ADR-0010). Deployed and local dev must
 * supply both keys in apps/party-tracker/.env.local. Keyless boot is only for
 * unit tests that stub env vars — the app shows ClerkSetupRequired instead of
 * skipping the Profile gate.
 */

/** Publishable key — required to mount <ClerkProvider> and auth UI. */
export function clerkBrowserConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

/** Full server + client Clerk (provider, middleware, webhooks, profile/sync). */
export function clerkConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
  );
}

/** Park Bound always ships with Clerk — never a no-auth deployment. */
export function clerkMandatory() {
  return true;
}

/** CI browser vertical may boot the map without Clerk keys baked into the build. */
export function clerkCiKeylessOk() {
  return process.env.NEXT_PUBLIC_CLERK_CI_KEYLESS_OK === '1';
}

/** @returns {{ ok: boolean, missing: string[] }} */
export function clerkConfigStatus() {
  /** @type {string[]} */
  const missing = [];
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    missing.push('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY');
  }
  if (!process.env.CLERK_SECRET_KEY) {
    missing.push('CLERK_SECRET_KEY');
  }
  return { ok: missing.length === 0, missing };
}
