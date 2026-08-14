'use client';

import { Show, UserButton, useClerk, useSignIn } from '@clerk/nextjs';
import { useState } from 'react';
import { rankReward } from '@party-tracker/shared/questScore.js';
import { clerkOAuthRedirect } from '@/lib/auth/clerkOAuth';
import { clearGuestChoice } from '@/lib/auth/guestChoice';
/**
 * Soft-gate sign-in (EP.3) — Google / Apple only via Clerk OAuth.
 * Map and Party stay usable without a Profile; no email or password UI.
 */
export default function SignInCard({ session = null, onSession = null }) {
  const { signOut } = useClerk();
  const { isLoaded, signIn } = useSignIn();
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  async function startOAuth(strategy) {
    if (!signIn) return;
    setBusy(strategy);
    setErr(null);
    try {
      await clerkOAuthRedirect(signIn, strategy);
    } catch (e) {
      setErr(e?.errors?.[0]?.message || e?.message || 'Sign-in failed');
      setBusy(null);
    }
  }
  if (session?.userId) {
    const title = rankReward(session.rank || 'visitor').title;
    return (
      <div className="signInCard">
        <div className="label">Signed in</div>
        <p className="fine block">
          {session.displayName || 'Guest'}
          {session.fromCache ? ' · offline profile' : ''}
        </p>
        {title ? (
          <p className="fine block signInTitle">{title}</p>
        ) : null}
        <div className="signInActions">
          <UserButton afterSignOutUrl="/" />
          <button
            type="button"
            className="btn ghost"
            onClick={async () => {
              clearGuestChoice();
              await signOut();
              onSession?.(null);
            }}          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="signInCard">
      <div className="label">Save progress on your Profile</div>
      <p className="fine block">
        Browse the map and join a party by name anytime. Continue with Google or Apple to keep XP,
        Managed Guests, and gap Side Quests on this phone.
      </p>
      <div className="signInActions signInActionsStack">
        <Show when="signed-out">
          <button
            type="button"
            className="btn primary"
            disabled={!isLoaded || busy}
            onClick={() => startOAuth('oauth_google')}
          >
            {busy === 'oauth_google' ? 'Opening Google…' : 'Continue with Google'}
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={!isLoaded || busy}
            onClick={() => startOAuth('oauth_apple')}
          >
            {busy === 'oauth_apple' ? 'Opening Apple…' : 'Continue with Apple'}
          </button>
        </Show>
        <Show when="signed-in">
          <UserButton afterSignOutUrl="/" />
        </Show>
      </div>
      {err ? <p className="fine block warnText">{err}</p> : null}
    </div>
  );
}
