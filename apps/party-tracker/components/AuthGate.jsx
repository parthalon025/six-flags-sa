'use client';

import BrandLockup from '@/components/BrandLockup';
import AuthGateActions from '@/components/AuthGateActions';
import { BRAND } from '@/lib/brand';
import { AUTH_COPY } from '@/lib/auth/authCopy';
import { clerkBrowserConfigured } from '@/lib/clerkConfigured';
/**
 * First screen when the app opens without a Profile — Google, Apple, or Guest.
 * Map and Party stay name-first after guest continues.
 *
 * Reading order is mark, PROFILE, PARKBOUND, slogan, then the ask. The brand
 * arrives before the request does: someone who just tapped an unfamiliar icon
 * needs to know whose app is asking to sign them in.
 */
export default function AuthGate(props) {
  // No ClerkProvider without a key, so nothing here can mount. page.js treats an
  // unconfigured Clerk as already past this gate — returning null is what keeps
  // a keyless dev build from hard-gating on a sign-in that cannot run.
  if (!clerkBrowserConfigured()) return null;
  return <AuthGateLive {...props} />;
}

function AuthGateLive({ onGuest = null }) {
  return (
    <div className="gate authGate" role="dialog" aria-labelledby="auth-gate-title">
      <div className="gateCard authGateCard">
        <BrandLockup
          size="md"
          stacked
          className="gateBrandLockup"
          eyebrow={AUTH_COPY.eyebrow}
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
