import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';
import { redirect } from 'next/navigation';
import AuthShell from '@/components/AuthShell';
import { AUTH_COPY } from '@/lib/auth/authCopy';
import { clerkBrowserConfigured } from '@/lib/clerkConfigured';

export const dynamic = 'force-dynamic';

/**
 * Completes Google / Apple OAuth started from ProfileAuthActions.
 * @see https://clerk.com/docs/reference/components/authentication/authenticate-with-redirect-callback
 */
export default function SsoCallbackPage() {
  if (!clerkBrowserConfigured()) redirect('/');
  return (
    <AuthShell
      variant="page"
      description={AUTH_COPY.ssoLead}
      finePrint={AUTH_COPY.ssoFine}
      showTagline={false}
      nameId="auth-sso-title"
    >
      <AuthenticateWithRedirectCallback
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
        signInFallbackRedirectUrl="/"
        signUpFallbackRedirectUrl="/"
      />
      <div id="clerk-captcha" />
    </AuthShell>
  );
}
