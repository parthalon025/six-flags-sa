'use client';

import Link from 'next/link';
import { UserButton, useClerk } from '@clerk/nextjs';
import { rankReward } from '@party-tracker/shared/questScore.js';
import { AUTH_COPY } from '@/lib/auth/authCopy';
import { clearGuestChoice } from '@/lib/auth/guestChoice';
import { clerkBrowserConfigured } from '@/lib/clerkConfigured';
/**
 * Soft-gate sign-in (EP.3) — Sign in opens Clerk (/sign-in).
 * In-place OAuth on this card is what broke on live.
 */
export default function SignInCard(props) {
  if (!clerkBrowserConfigured()) return null;
  return <SignInCardLive {...props} />;
}

function SignInCardLive({ session = null, onSession = null }) {
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
      <p className="fine block">
        Browse the map and join a party by name anytime. Sign in to keep XP,
        Managed Guests, and gap Side Quests on this phone.
      </p>
      <div className="signInActions">
        <Link href="/sign-in" className="btn primary">
          {AUTH_COPY.loginLabel}
        </Link>
      </div>
    </div>
  );
}
