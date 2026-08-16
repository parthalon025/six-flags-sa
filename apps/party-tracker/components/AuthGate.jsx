'use client';

import BrandLockup from '@/components/BrandLockup';
import AuthGateActions from '@/components/AuthGateActions';
import { BRAND } from '@/lib/brand';
import { AUTH_COPY } from '@/lib/auth/authCopy';
import { clerkBrowserConfigured } from '@/lib/clerkConfigured';
/**
 * First screen when the app opens without a Profile — Login (Clerk) or Guest.
 * Map and Party stay name-first after guest continues.
 */
export default function AuthGate(props) {
  if (!clerkBrowserConfigured()) return null;
  return <AuthGateLive {...props} />;
}

function AuthGateLive({ onGuest = null }) {
  return (
    <div className="gate authGate" role="dialog" aria-labelledby="auth-gate-title">
      <div className="gateCard authGateCard">
        <div className="gateEyebrow">{AUTH_COPY.eyebrow}</div>
        <BrandLockup
          size="md"
          stacked
          className="gateBrandLockup"
          markTitle={BRAND.name}
          nameId="auth-gate-title"
        />
        <p>{AUTH_COPY.gateLead}</p>
        <AuthGateActions onGuest={onGuest} />
        <p className="gateFine">{AUTH_COPY.gateFine}</p>
      </div>
    </div>
  );
}
