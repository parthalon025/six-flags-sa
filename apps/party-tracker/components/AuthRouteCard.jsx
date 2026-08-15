'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/AuthShell';
import ProfileAuthActions from '@/components/ProfileAuthActions';
import { AUTH_COPY } from '@/lib/auth/authCopy';
import { markGuestChoice } from '@/lib/auth/guestChoice';

/**
 * Standalone /sign-in and /sign-up — same lockup, palette, and OAuth buttons as the gate.
 */
export default function AuthRouteCard({
  mode = 'sign-in',
  showGuest = true,
}) {
  const router = useRouter();
  const description = mode === 'sign-up' ? AUTH_COPY.signUpLead : AUTH_COPY.signInLead;
  const alternate =
    mode === 'sign-up'
      ? { href: '/sign-in', label: 'Already have a Profile? Sign in' }
      : { href: '/sign-up', label: 'New here? Create a Profile' };

  const onGuest = () => {
    markGuestChoice();
    router.push('/');
  };

  return (
    <AuthShell
      variant="page"
      description={description}
      finePrint={showGuest ? AUTH_COPY.gateFine : null}
      nameId={mode === 'sign-up' ? 'auth-sign-up-title' : 'auth-sign-in-title'}
    >
      <ProfileAuthActions
        onGuest={showGuest ? onGuest : null}
        guestLabel={AUTH_COPY.guestLabel}
        showGuest={showGuest}
      />
      <p className="authRouteAlt">
        <Link href={alternate.href}>{alternate.label}</Link>
      </p>
    </AuthShell>
  );
}
