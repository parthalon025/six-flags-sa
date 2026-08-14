/** Clerk OAuth redirect — shared by AuthGate and SignInCard. */

export async function clerkOAuthRedirect(signIn, strategy) {
  if (!signIn) throw new Error('Clerk is not ready');
  await signIn.authenticateWithRedirect({
    strategy,
    redirectUrl: '/sign-in/sso-callback',
    redirectUrlComplete: '/',
  });
}
