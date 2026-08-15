'use client';

import { Show, UserButton, useClerk } from '@clerk/nextjs';
import { rankReward } from '@party-tracker/shared/questScore.js';
import ProfileAuthActions from '@/components/ProfileAuthActions';
import { AUTH_COPY } from '@/lib/auth/authCopy';
import { clearGuestChoice } from '@/lib/auth/guestChoice';
import { clerkBrowserConfigured } from '@/lib/clerkConfigured';

/**
 * Soft-gate sign-in (EP.3) — same Clerk login + guest pattern as the Profile gate.
 * Map and Party stay usable without a Profile; no email or password UI.
 */
export default function SignInCard(props) {
  // Same seam as layout / AuthBridge / AuthGate: no ClerkProvider without a key.
  if (!clerkBrowserConfigured()) return null;
  return <SignInCardLive {...props} />;
}

function SignInCardLive({ session = null, onSession = null, onGuest = null }) {
  const { signOut } = useClerk();

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
      <div className="label">Save progress on your Profile</div>
      <p className="fine block">{AUTH_COPY.signInLead}</p>
      <p className="fine block">{AUTH_COPY.billingNote}</p>
      <ProfileAuthActions
        onGuest={onGuest}
        showGuest={Boolean(onGuest)}
        guestClassName=""
        stackActions
      />
      <Show when="signed-in">
        <div className="signInActions">
          <UserButton afterSignOutUrl="/" />
        </div>
      </Show>
    </div>
  );
}
