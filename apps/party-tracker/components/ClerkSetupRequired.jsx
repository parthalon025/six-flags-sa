'use client';

import AuthShell from '@/components/AuthShell';
import { BRAND } from '@/lib/brand';

/**
 * Blocks the map when Clerk keys are missing. Clerk is mandatory for Park Bound.
 */
export default function ClerkSetupRequired() {
  return (
    <div className="gate authGate clerkSetupRequired" role="alert">
      <AuthShell
        variant="gate"
        eyebrow="Setup"
        description="Clerk sign-in is required for Park Bound but the publishable key is not configured on this build."
        finePrint={`Add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY to apps/party-tracker/.env.local, then restart. Production uses ${BRAND.canonicalUrl} with Clerk middleware active.`}
        showTagline
        nameId="clerk-setup-title"
      />
    </div>
  );
}
