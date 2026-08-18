'use client';

import { useClerk, useSignIn } from '@clerk/nextjs';
import { useCallback, useState } from 'react';
import { clerkOAuthReady, clerkOAuthRedirect, resolveClerkSignIn } from '@/lib/auth/clerkOAuth';

/** Shared OAuth state for AuthGate and SignInCard. */
export function useClerkOAuth() {
  const clerk = useClerk();
  const { signIn } = useSignIn();
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  const clientSignIn = clerk.client?.signIn;
  const activeSignIn = resolveClerkSignIn(signIn, clientSignIn);
  const ready = clerkOAuthReady({
    clerkLoaded: clerk.loaded,
    signIn,
    clientSignIn,
  });

  const startOAuth = useCallback(
    async (strategy) => {
      if (!activeSignIn) return;
      setBusy(strategy);
      setErr(null);
      try {
        await clerkOAuthRedirect(activeSignIn, strategy);
      } catch (e) {
        setErr(e?.errors?.[0]?.message || e?.message || 'Sign-in failed');
        setBusy(null);
      }
    },
    [activeSignIn],
  );

  return { ready, busy, err, startOAuth };
}
