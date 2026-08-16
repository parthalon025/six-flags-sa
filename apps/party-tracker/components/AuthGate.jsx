'use client';

import AuthGateActions from '@/components/AuthGateActions';
import AuthShell from '@/components/AuthShell';
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
      <AuthShell variant="gate">
        <AuthGateActions onGuest={onGuest} />
      </AuthShell>
    </div>
  );
}
