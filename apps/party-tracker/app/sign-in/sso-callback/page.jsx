import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';
import { redirect } from 'next/navigation';
import { clerkBrowserConfigured } from '@/lib/clerkConfigured';

export const dynamic = 'force-dynamic';

/**
 * Completes Google / Apple OAuth started from ProfileAuthActions.
 * @see https://clerk.com/docs/reference/components/authentication/authenticate-with-redirect-callback
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
      <div id="clerk-captcha" />
    </main>
  );
}
