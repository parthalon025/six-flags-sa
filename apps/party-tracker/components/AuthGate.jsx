'use client';

import { Show, useSignIn } from '@clerk/nextjs';
import { useState } from 'react';
import BrandLockup from '@/components/BrandLockup';
import { BRAND } from '@/lib/brand';
import { clerkOAuthRedirect } from '@/lib/auth/clerkOAuth';
/**
 * First screen when the app opens without a Profile — sign in (Google / Apple)
 * or continue as a guest. Map and Party stay name-first after guest continues.
 */
export default function AuthGate({ onGuest = null }) {
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

  return (
    <div className="gate authGate" role="dialog" aria-labelledby="auth-gate-title">
      <div className="gateCard authGateCard">
        <div className="gateEyebrow">Profile</div>
        <BrandLockup
          size="md"
          stacked
          className="gateBrandLockup"
          markTitle={BRAND.name}
          nameId="auth-gate-title"
        />
        <p>
          Sign in to save XP and Side Quest progress on this phone, or continue as a guest —
          the map and party work either way.
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
        </div>
        {err ? <p className="fine block warnText">{err}</p> : null}
        <button type="button" className="btn ghost authGateGuest" disabled={Boolean(busy)} onClick={onGuest}>
          Continue as guest
        </button>
        <p className="gateFine">Guests browse and join parties by name. Sign in later from Me.</p>
      </div>
    </div>
  );
}
