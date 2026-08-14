'use client';

import { SignInButton, SignUpButton, Show, UserButton, useClerk } from '@clerk/nextjs';
import { rankReward } from '@party-tracker/shared/questScore.js';

/**
 * Soft-gate sign-in (EP.3) — Clerk Google / Apple via dashboard config.
 * Map and Party stay usable without a Profile.
 */
export default function SignInCard({ session = null, onSession = null }) {
  const { signOut } = useClerk();

  if (session?.userId) {
    const title = rankReward(session.rank || 'visitor').title;
    return (
      <div className="signInCard">
        <div className="label">Signed in</div>
        <p className="fine block">
          {session.displayName || session.email}
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
              await signOut();
              onSession?.(null);
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="signInCard">
      <div className="label">Sign in to save progress</div>
      <p className="fine block">
        Browse the map and join a party by name anytime. Sign in with Google or Apple to keep XP on
        your Profile, save Managed Guests, and submit gap Side Quests.
      </p>
      <div className="signInActions">
        <Show when="signed-out">
          <SignInButton mode="redirect" forceRedirectUrl="/">
            <button type="button" className="btn primary">
              Sign in
            </button>
          </SignInButton>
          <SignUpButton mode="redirect" forceRedirectUrl="/">
            <button type="button" className="btn ghost">
              Create Profile
            </button>
          </SignUpButton>
        </Show>
        <Show when="signed-in">
          <UserButton afterSignOutUrl="/" />
        </Show>
      </div>
    </div>
  );
}
