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
