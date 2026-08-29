/**
 * First-run overlay. The live map and the sheet both wear PARKBOUND, so painting
 * them for a frame and then fading a 40% gate over the top ghosts the wordmark
 * and looks like a broken load. Hold an opaque cover until localStorage has
 * answered, then splash → welcome inside that same opaque shell.
 *
 * `null` is the SSR / pre-hydration answer — storage cannot be read on the
 * server, and guessing either way flashes the wrong card.
 *
 * @param {{ introSeen: boolean | null, logoSplashDismissed: boolean }} state
 * @returns {'hold' | 'splash' | 'welcome' | 'none'}
 */
export function firstRunOverlay({ introSeen, logoSplashDismissed }) {
  if (introSeen === null) return 'hold';
  if (introSeen === true) return 'none';
  if (!logoSplashDismissed) return 'splash';
  return 'welcome';
}

/** Same key `page.js` reads after hydration. Exported so the boot script cannot drift. */
export const INTRO_KEY = 'tracker-intro-seen';

/**
 * Blocking head script: stamp `html[data-intro=seen|new]` before the body paints
 * so returning phones never see the SSR hold, and first visits never leak the
 * map through a streaming sheet.
 */
export const INTRO_SEEN_BOOT_SCRIPT = `(function(){try{var k=${JSON.stringify(INTRO_KEY)};document.documentElement.setAttribute("data-intro",localStorage.getItem(k)==="1"?"seen":"new");}catch(e){document.documentElement.setAttribute("data-intro","new");}})();`;

/**
 * Display name for a signed-in Profile on the welcome intro — null when anonymous
 * or the account has no real name yet.
 *
 * @param {{ userId?: string, displayName?: string } | null} session
 * @returns {string | null}
 */
export function profileWelcomeName(session) {
  if (!session?.userId) return null;
  const name = String(session.displayName || '').trim();
  if (!name || name === 'Guest') return null;
  return name;
}

/** @param {string | null | undefined} visitorName */
export function welcomeEyebrow(visitorName) {
  const name = String(visitorName || '').trim();
  if (!name) return 'Welcome';
  return `Welcome, ${name}`;
}

/** @param {string | null | undefined} visitorName */
export function planYourDayTitle(visitorName) {
  const name = String(visitorName || '').trim();
  if (!name) return 'Plan your day';
  return `Plan your day, ${name}`;
}

/**
 * Scroll-fraction thresholds for the intro's progress dots, one per claim in
 * `INTRO_CLAIMS`. Evenly spaced at `i / (count + 1)` so a claim never lands
 * exactly at the top or bottom of the story — the first dot lights partway
 * in, the last partway before the end, the same way the claims themselves
 * sit inside the scroll rather than flush against its edges.
 *
 * @param {number} count usually `INTRO_CLAIMS.length`
 * @returns {number[]}
 */
export function introDotThresholds(count) {
  if (!Number.isFinite(count) || count <= 0) return [];
  return Array.from({ length: count }, (_, i) => (i + 1) / (count + 1));
}

/**
 * Scroll fraction past which the footer swaps "Skip intro" for "Get
 * started" — half a dot-interval beyond the last claim, so the footer
 * flips once the story is behind the reader rather than the instant the
 * last claim scrolls past. Falls out of the same `1 / (count + 1)` spacing
 * as {@link introDotThresholds} rather than a threshold picked by eye, so
 * it moves if the claim count ever does.
 *
 * @param {number} count usually `INTRO_CLAIMS.length`
 * @returns {number}
 */
export function introReadFraction(count) {
  if (!Number.isFinite(count) || count <= 0) return 1;
  return (count + 0.5) / (count + 1);
}
