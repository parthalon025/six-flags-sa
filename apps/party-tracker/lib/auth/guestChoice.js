/** Session-only — guest bypass for the startup auth gate (ADR-0030). */

export const AUTH_GUEST_KEY = 'parkbound.authGuest';

export function readGuestChoice() {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(AUTH_GUEST_KEY) === '1';
  } catch {
    return false;
  }
}

export function markGuestChoice() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(AUTH_GUEST_KEY, '1');
  } catch {
    /* private mode */
  }
}

export function clearGuestChoice() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(AUTH_GUEST_KEY);
  } catch {
    /* private mode */
  }
}
