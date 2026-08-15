/** Clerk OAuth redirect — shared by AuthGate and SignInCard. */

export const CLERK_OAUTH_CALLBACK_PATH = '/sign-in/sso-callback';
export const CLERK_OAUTH_COMPLETE_PATH = '/';

export async function clerkOAuthRedirect(signIn, strategy) {
  if (!signIn) throw new Error('Clerk is not ready');
  await signIn.authenticateWithRedirect({
    strategy,
    redirectUrl: CLERK_OAUTH_CALLBACK_PATH,
    redirectUrlComplete: CLERK_OAUTH_COMPLETE_PATH,
  });
}
