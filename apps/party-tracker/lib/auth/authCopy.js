/** Shared Profile auth copy — gate, standalone routes, and Settings. */

import { profilePriceLabel } from '@party-tracker/shared/billing.js';

const PROFILE_PRICE = profilePriceLabel({ priceUsd: 10, duration: 'year' });

export const AUTH_COPY = {
  eyebrow: 'Profile',
  gateLead:
    'Log in to save XP and Side Quest progress, or continue as a guest — the map and party work either way.',
  gateFine: `Guests browse and join parties by name. Profile subscription (${PROFILE_PRICE}) is billed through the App Store or Play — not Clerk. Login does not charge you.`,
  loginLabel: 'Login',
  guestLabel: 'Guest',
  signInLead:
    'Choose Google or Apple to log in. You will return to Park Bound when finished. Login is free.',
  signUpLead:
    'Choose Google or Apple to create a Profile. You will return to Park Bound when finished.',
  profilePriceLine: `Profile · ${PROFILE_PRICE} via App Store or Play`,
  billingNote:
    'Clerk handles login only. Paid Profile is one subscription through Apple, Google Play, or web checkout — never twice.',
  ssoLead: 'Finishing login…',
  ssoFine: 'You will land back on Park Bound in a moment.',
};
