/**
 * PWA install surface helpers — detect already-installed, remember soft dismissals.
 *
 * Never pitch "Add to Home Screen" when the session is already running as the
 * installed app (duplicate icon / confusing CTA). Gate prompts also cool down
 * after "Not now" so we do not nag every open.
 */

export const INSTALL_DISMISS_KEY = 'tracker-install-dismissed';
/** Soft dismiss on the welcome gate — re-offer after a week. */
export const INSTALL_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

/** True when this document is already the installed home-screen app. */
export function isRunningAsInstalledApp() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.navigator?.standalone === true) return true;
    const modes = ['standalone', 'fullscreen', 'minimal-ui'];
    for (const mode of modes) {
      if (window.matchMedia?.(`(display-mode: ${mode})`)?.matches) return true;
    }
  } catch {
    /* matchMedia unavailable */
  }
  return false;
}

/** Optional Chromium check for related installed PWAs (same origin). */
export async function hasInstalledRelatedApp() {
  if (typeof navigator === 'undefined' || typeof navigator.getInstalledRelatedApps !== 'function') {
    return false;
  }
  try {
    const apps = await navigator.getInstalledRelatedApps();
    return Array.isArray(apps) && apps.length > 0;
  } catch {
    return false;
  }
}

export function readInstallDismissed(now = Date.now()) {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(INSTALL_DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return now - at < INSTALL_DISMISS_MS;
  } catch {
    return false;
  }
}

export function markInstallDismissed(now = Date.now()) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(now));
  } catch {
    /* private mode */
  }
}

export function clearInstallDismissed() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(INSTALL_DISMISS_KEY);
  } catch {
    /* private mode */
  }
}
