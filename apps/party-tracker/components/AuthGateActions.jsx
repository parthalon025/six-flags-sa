'use client';

import Link from 'next/link';
import { AUTH_COPY } from '@/lib/auth/authCopy';

/**
 * Last working Profile gate — Sign in opens Clerk (/sign-in), Guest continues.
 * In-place OAuth on this card is what broke on live.
 */
export default function AuthGateActions({ onGuest = null }) {
  return (
    <div className="authGateActions signInActions signInActionsStack">
      <Link href="/sign-in" className="btn primary authGateLogin">
        {AUTH_COPY.loginLabel}
      </Link>
      {onGuest ? (
        <button type="button" className="btn ghost authGateGuest" onClick={onGuest}>
          {AUTH_COPY.guestLabel}
        </button>
      ) : null}
    </div>
  );
}
