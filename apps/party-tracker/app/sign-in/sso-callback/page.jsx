import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';
import { redirect } from 'next/navigation';
import { clerkBrowserConfigured } from '@/lib/clerkConfigured';

export const dynamic = 'force-dynamic';

/**
 * Completes Google / Apple OAuth started from AuthGate and SignInCard.
 * The catch-all /sign-in/[[...sign-in]] page mounts the SignIn widget and
 * cannot finish authenticateWithRedirect — this more-specific route must win.
 */
export default function SsoCallbackPage() {
  if (!clerkBrowserConfigured()) redirect('/');
  return (
    <main className="clerkAuthPage">
      <AuthenticateWithRedirectCallback
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
        signInFallbackRedirectUrl="/"
        signUpFallbackRedirectUrl="/"
      />
      {/* Clerk bot sign-up protection is on by default for new OAuth Profiles. */}
      <div id="clerk-captcha" />
    </main>
  );
}
