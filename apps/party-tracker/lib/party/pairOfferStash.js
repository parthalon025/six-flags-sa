/**
 * Where /pair parks an offer fragment for the map page to finish QR pairing.
 * Session storage, not local — consumed once by the tab that opened the link.
 */

export const PENDING_PAIR_OFFER_KEY = 'ki-pending-pair-offer';

/** Read the offer /pair left behind, if there is one (does not clear). */
export function takePendingPairOffer() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_PAIR_OFFER_KEY);
    if (!raw) return null;
    return String(raw);
  } catch {
    return null;
  }
}

/** Drop the stash after pairing succeeds or the visitor abandons. */
export function clearPendingPairOffer() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PENDING_PAIR_OFFER_KEY);
  } catch {
    /* private mode */
  }
}

/** Stash an offer fragment for the map page to pick up during hotspot pairing. */
export function stashPendingPairOffer(payload) {
  if (typeof window === 'undefined' || !payload) return false;
  try {
    window.sessionStorage.setItem(PENDING_PAIR_OFFER_KEY, String(payload));
    return true;
  } catch {
    return false;
  }
}
