'use client';

import { useState } from 'react';
import { completeMagicSignIn, signOutLocal } from '@/lib/auth/session';

/**
 * Soft-gate sign-in (EP.3) — magic-link shaped; map stays usable without it.
 * Local stand-in completes immediately until Auth.js email delivery is wired.
 */
export default function SignInCard({ session = null, onSession = null }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  if (session?.userId) {
    return (
      <div className="signInCard">
        <div className="label">Signed in</div>
        <p className="fine block">
          {session.displayName || session.email}
          {session.fromCache ? ' · offline profile' : ''}
        </p>
        <button
          type="button"
          className="btn ghost"
          onClick={async () => {
            await signOutLocal();
            onSession?.(null);
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="signInCard">
      <div className="label">Sign in to save family heights</div>
      <p className="fine block">
        Browse the map and join a party by name anytime. Sign in to save Managed Guests, submit gap
        Side Quests, and fan out park-wide Observations.
      </p>
      <div className="label">Email</div>
      <input
        className="field"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        aria-label="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {err ? <p className="fine block warnText">{err}</p> : null}
      <button
        type="button"
        className="btn primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const next = await completeMagicSignIn({ email });
            onSession?.(next);
          } catch (e) {
            setErr(e.message || 'Sign-in failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Signing in…' : 'Email me a link'}
      </button>
    </div>
  );
}
