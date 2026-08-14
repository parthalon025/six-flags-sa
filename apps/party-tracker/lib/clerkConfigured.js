/**
 * Clerk is optional at boot: CI and Cloud Agent boxes often have no keys, and
 * a missing/placeholder key handshake-redirects the document off the map.
 * Production Vercel has both keys; the provider and middleware stay on.
 */

/** Publishable key alone is enough to mount <ClerkProvider> / useAuth. */
export function clerkBrowserConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

/** Full server + client Clerk (provider, middleware, webhooks). */
export function clerkConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
  );
}
