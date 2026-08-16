'use client';

import { Show } from '@clerk/nextjs';
import BrandLockup from '@/components/BrandLockup';
import OAuthButtons from '@/components/OAuthButtons';
import { BRAND } from '@/lib/brand';
import { useClerkOAuth } from '@/lib/auth/useClerkOAuth';
import { clerkBrowserConfigured } from '@/lib/clerkConfigured';
/**
 * First screen when the app opens without a Profile — sign in (Google / Apple)
 * or continue as a guest. Map and Party stay name-first after guest continues.
 */
export default function AuthGate(props) {
  if (!clerkBrowserConfigured()) return null;
  return <AuthGateLive {...props} />;
}

function AuthGateLive({ onGuest = null }) {
  const { ready, busy, err, startOAuth } = useClerkOAuth();

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
        <div className="signInActions">
          <Show when="signed-out">
            <OAuthButtons isLoaded={ready} busy={busy} onStart={startOAuth} />
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
