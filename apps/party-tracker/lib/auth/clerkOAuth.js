/** Clerk OAuth redirect — shared by AuthGate and SignInCard (Clerk custom flow). */

export const CLERK_OAUTH_CALLBACK_PATH = '/sign-in/sso-callback';
/** After Clerk OAuth completes, land on the Park Bound map (same origin). */
export const CLERK_OAUTH_COMPLETE_PATH = '/';
export const CLERK_SIGN_IN_PATH = '/sign-in';

/**
 * Start Google / Apple OAuth via Clerk's documented custom redirect flow.
 * @see Clerk MCP custom-flows / SignIn.authenticateWithRedirect
 */
export async function clerkOAuthRedirect(signIn, strategy) {
  if (!signIn) throw new Error('Clerk is not ready');
  await signIn.authenticateWithRedirect({
    strategy,
    redirectUrl: CLERK_OAUTH_CALLBACK_PATH,
    redirectUrlComplete: CLERK_OAUTH_COMPLETE_PATH,
  });
}
