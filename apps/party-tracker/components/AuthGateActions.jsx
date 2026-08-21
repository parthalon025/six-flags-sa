'use client';

import { Show } from '@clerk/nextjs';
import OAuthButtons from '@/components/OAuthButtons';
import { AUTH_COPY } from '@/lib/auth/authCopy';
import { useClerkOAuth } from '@/lib/auth/useClerkOAuth';

/**
 * First-run Profile gate — Google or Apple in one row, Guest as a quiet line.
 *
 * The providers start OAuth here rather than bouncing to /sign-in first. That
 * route still exists and is still where the redirect lands: useClerkOAuth sends
 * the browser through /sign-in/sso-callback and back to /. Cutting the extra
 * page out only removes a screen that said the same thing twice.
 *
 * Guest is a text button, not a second filled button. Both paths work, but only
 * one of them is the one being offered — a matched pair made the choice look
 * heavier than it is.
 */
export default function AuthGateActions({ onGuest = null }) {
  const { ready, busy, err, startOAuth } = useClerkOAuth();

  return (
    <div className="authGateActions signInActions">
      <Show when="signed-out">
        <OAuthButtons isLoaded={ready} busy={busy} onStart={startOAuth} />
      </Show>
      {err ? <p className="fine block warnText authGateError">{err}</p> : null}
      {onGuest ? (
        <button type="button" className="btnQuiet muted authGateGuest" onClick={onGuest}>
          {AUTH_COPY.guestLabel}
        </button>
      ) : null}
    </div>
  );
}
