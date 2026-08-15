'use client';

import { useEffect, useState } from 'react';

/** Official Google G — brand colors stay as-is (Google branding). */
function GoogleMark() {
  return (
    <svg className="oauthMark" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

/** Apple mark — currentColor so it follows the dark/light gate. */
function AppleMark() {
  return (
    <svg className="oauthMark" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.37 12.23c-.03-2.27 1.85-3.36 1.94-3.41-1.06-1.55-2.7-1.76-3.28-1.78-1.4-.14-2.72.82-3.43.82-.71 0-1.8-.8-2.97-.78-1.53.02-2.94.89-3.73 2.26-1.59 2.76-.41 6.84 1.14 9.08.76 1.1 1.66 2.32 2.84 2.28 1.14-.05 1.57-.74 2.95-.74 1.37 0 1.76.74 2.97.71 1.23-.02 2-1.12 2.75-2.22.87-1.27 1.23-2.5 1.25-2.56-.03-.01-2.4-.92-2.43-3.66zM14.7 5.88c.63-.76 1.05-1.82.93-2.88-.9.04-1.99.6-2.63 1.36-.58.67-1.08 1.76-.95 2.8 1 .08 2.03-.51 2.65-1.28z"
      />
    </svg>
  );
}

const PROVIDERS = [
  { strategy: 'oauth_google', name: 'Google', Mark: GoogleMark },
  { strategy: 'oauth_apple', name: 'Apple', Mark: AppleMark },
];

function detectPlatform() {
  if (typeof navigator === 'undefined') return 'default';
  const ua = navigator.userAgent || '';
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios ? 'ios' : 'android';
}

/**
 * Google + Apple as equal-weight logo buttons (ADR-0010 App Store 4.8).
 * Apple leads on iOS; Google leads on Android and desktop.
 */
export default function OAuthButtons({ isLoaded = false, busy = null, onStart = null }) {
  const [platform, setPlatform] = useState('default');

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const providers =
    platform === 'ios'
      ? [PROVIDERS[1], PROVIDERS[0]]
      : platform === 'android'
        ? PROVIDERS
        : PROVIDERS;

  return (
    <div className={`oauthActions oauthActions-${platform}`}>
      {providers.map(({ strategy, name, Mark }) => {
        const opening = busy === strategy;
        return (
          <button
            key={strategy}
            type="button"
            className={`oauthBtn oauthBtn-${strategy}`}
            disabled={!isLoaded || Boolean(busy)}
            aria-label={opening ? `Opening ${name}` : `Continue with ${name}`}
            onClick={() => onStart?.(strategy)}
          >
            <Mark />
            <span className="oauthBtnName">{opening ? 'Opening…' : name}</span>
          </button>
        );
      })}
    </div>
  );
}
