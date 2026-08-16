/** Clerk OAuth redirect — shared by AuthGate and SignInCard. */

export const CLERK_OAUTH_CALLBACK_PATH = '/sign-in/sso-callback';
export const CLERK_OAUTH_COMPLETE_PATH = '/';

/** Prefer hook signIn; fall back to Clerk.client.signIn when useSignIn stays unloaded. */
export function resolveClerkSignIn(signIn, clientSignIn) {
  return signIn ?? clientSignIn ?? null;
}

/** OAuth buttons are tappable once Clerk JS is loaded and a sign-in client exists. */
export function clerkOAuthReady({ clerkLoaded, signIn, clientSignIn }) {
  return Boolean(clerkLoaded && resolveClerkSignIn(signIn, clientSignIn));
}

export async function clerkOAuthRedirect(signIn, strategy) {
  if (!signIn) throw new Error('Clerk is not ready');
  await signIn.authenticateWithRedirect({
    strategy,
    redirectUrl: CLERK_OAUTH_CALLBACK_PATH,
    redirectUrlComplete: CLERK_OAUTH_COMPLETE_PATH,
  });
}
