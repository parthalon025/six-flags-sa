'use client';

import { useAuth, useSignIn } from '@clerk/nextjs';
import { useState } from 'react';
import OAuthButtons from '@/components/OAuthButtons';
import { clerkOAuthRedirect } from '@/lib/auth/clerkOAuth';

/**
 * Clerk Google / Apple sign-in plus optional guest bypass (ADR-0010).
 * Uses Clerk v7 signIn.sso() custom OAuth flow.
 */
export default function ProfileAuthActions({
  onGuest = null,
  guestLabel = 'Continue as guest',
  showGuest = Boolean(onGuest),
  guestClassName = 'authGateGuest',
  stackActions = false,
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const { signIn } = useSignIn();
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  async function startOAuth(strategy) {
    if (!signIn) return;
    setBusy(strategy);
    setErr(null);
    try {
      await clerkOAuthRedirect(signIn, strategy);
    } catch (e) {
      setErr(e?.errors?.[0]?.message || e?.message || e?.longMessage || 'Sign-in failed');
      setBusy(null);
    }
  }

  return (
    <>
      {!isSignedIn ? (
        <div className={`signInActions${stackActions ? ' signInActionsStack' : ''}`}>
          <OAuthButtons isLoaded={isLoaded} busy={busy} onStart={startOAuth} />
        </div>
      ) : null}
      {err ? <p className="fine block warnText">{err}</p> : null}
      {showGuest ? (
        <button
          type="button"
          className={`btn ghost ${guestClassName}`.trim()}
          disabled={Boolean(busy)}
          onClick={onGuest}
        >
          {guestLabel}
        </button>
      ) : null}
    </>
  );
}
