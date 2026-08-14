/**
 * Where /join parks an invite for the map page to open. Session storage, not
 * local: an invite is consumed once, by the tab that was handed the link.
 *
 * Kept out of `partyRuntime.js` so the invite landing page does not pull the
 * whole party runtime (WebRTC / Bluetooth / host service) into its first load.
 */

export const PENDING_INVITE_KEY = 'ki-pending-invite';

/**
 * Read and clear the invite /join left behind, if there is one.
 * Payload shapes:
 *   - legacy string: raw invite hash or code
 *   - JSON `{ payload, name }`: invite plus optional display name from /join
 */
export function takePendingInvite() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_INVITE_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(PENDING_INVITE_KEY);
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.payload) {
        return {
          payload: String(parsed.payload),
          name: typeof parsed.name === 'string' ? parsed.name.trim() : '',
        };
      }
    } catch {
      /* legacy bare string */
    }
    return { payload: raw, name: '' };
  } catch {
    return null;
  }
}

/** Stash an invite for the map page to open once (optionally with a name). */
export function stashPendingInvite(payload, name = '') {
  if (typeof window === 'undefined' || !payload) return false;
  try {
    window.sessionStorage.setItem(
      PENDING_INVITE_KEY,
      JSON.stringify({ payload: String(payload), name: String(name || '').trim() }),
    );
    return true;
  } catch {
    return false;
  }
}
