/** Shared Profile auth copy — gate, standalone routes, and Settings. */

import { profilePriceLabel } from '@party-tracker/shared/billing.js';

const PROFILE_PRICE = profilePriceLabel({ priceUsd: 10, duration: 'year' });

export const AUTH_COPY = {
  eyebrow: 'Profile',
  gateLead:
    'Sign in with Google or Apple to save XP and Side Quest progress — free. Or continue as a guest; the map and party work either way.',
  gateFine: `Guests browse and join parties by name. Profile subscription (${PROFILE_PRICE}) is billed through the App Store or Play — not Clerk. Sign in does not charge you.`,
  signInLead:
    'Sign in with Google or Apple to save XP, Side Quests, and your Plan on this phone. Sign-in is free.',
  signUpLead:
    'Create a Profile with Google or Apple to save progress and pick up where you left off. Sign-in is free.',
  profilePriceLine: `Profile · ${PROFILE_PRICE} via App Store or Play`,
  billingNote:
    'Clerk handles sign-in only. Paid Profile is one subscription through Apple, Google Play, or web checkout — never twice.',
  ssoLead: 'Finishing sign-in…',
  ssoFine: 'You will land back on the map in a moment.',
  guestLabel: 'Continue as guest',
};
