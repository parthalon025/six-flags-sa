'use client';

import BrandLockup from '@/components/BrandLockup';
import ProfileAuthActions from '@/components/ProfileAuthActions';
import { BRAND } from '@/lib/brand';
import { clerkBrowserConfigured } from '@/lib/clerkConfigured';

/**
 * First screen when the app opens without a Profile — Clerk sign-in (Google / Apple)
 * or continue as a guest. Map and Party stay name-first after guest continues.
 */
export default function AuthGate(props) {
  if (!clerkBrowserConfigured()) return null;
  return <AuthGateLive {...props} />;
}

function AuthGateLive({ onGuest = null }) {
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
        <ProfileAuthActions onGuest={onGuest} />
        <p className="gateFine">Guests browse and join parties by name. Sign in later from Me.</p>
      </div>
    </div>
  );
}
