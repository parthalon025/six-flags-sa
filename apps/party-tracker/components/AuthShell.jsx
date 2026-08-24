'use client';

import BrandLockup from '@/components/BrandLockup';
import { BRAND } from '@/lib/brand';
import { AUTH_COPY } from '@/lib/auth/authCopy';

/**
 * Branded Profile auth chrome — lockup, palette, and gate sheet pattern.
 * `variant="gate"` renders the card for overlays; `variant="page"` is a full route.
 */
export default function AuthShell({
  variant = 'gate',
  eyebrow = AUTH_COPY.eyebrow,
  description = AUTH_COPY.gateLead,
  finePrint = AUTH_COPY.gateFine,
  showTagline = true,
  nameId = 'auth-gate-title',
  className = '',
  children,
}) {
  const card = (
    <div className={`gateCard authGateCard authShellCard ${variant === 'page' ? 'authShellCard-page' : ''} ${className}`.trim()}>
      <div className="gateEyebrow">{eyebrow}</div>
      <BrandLockup
        size="md"
        stacked
        showTagline={showTagline}
        className="gateBrandLockup"
        markTitle={BRAND.name}
        nameId={nameId}
      />
      {description ? <p>{description}</p> : null}
      {children}
      {finePrint ? <p className="gateFine">{finePrint}</p> : null}
    </div>
  );

  if (variant === 'page') {
    return (
      <main className="clerkAuthPage authShellPage" role="main">
        {card}
      </main>
    );
  }

  return card;
}
