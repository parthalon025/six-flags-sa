'use client';

import ProfileAuthActions from '@/components/ProfileAuthActions';
import AuthShell from '@/components/AuthShell';
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
      <AuthShell variant="gate">
        <ProfileAuthActions onGuest={onGuest} />
      </AuthShell>
    </div>
  );
}
