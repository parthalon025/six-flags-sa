/**
 * Train H perf gate — regression-only CI throttle (ADR-0021 decision b).
 *
 * Absolute bars and a pinned device are out of scope. A missing page or a
 * missing frame trace is a failed sweep, not a passing floor: inventing 30 fps
 * is how a gate that cannot go red ships.
 */

import { appOrigin } from './app-test-origin.mjs';

/** Floor a throttled phone must hold. ADR-0019's 30 fps low-end row. */
export const MIN_FPS_FLOOR = 30;

async function applyCpuThrottle(page, rate) {
  const ctx = typeof page.context === 'function' ? page.context() : null;
  const session = ctx?.newCDPSession ? await ctx.newCDPSession(page).catch(() => null) : null;
  if (!session?.send) return false;
  try {
    await session.send('Emulation.setCPUThrottlingRate', { rate });
  } catch {
    return false;
  }
  return true;
}

/**
 * Scripted pan/zoom/pitch sweep against a live page.
 *
 * Throttle is applied before the camera moves so the samples cover the
 * loaded window, not the idle wait that happened before CDP attached.
 *
 * @param {{ minFps?: number, throttle?: number, page?: { evaluate?: Function, context?: Function } }} opts
 */
export async function zoomSweep({
  minFps = MIN_FPS_FLOOR,
  throttle = 4,
  page = null,
} = {}) {
  if (!page || typeof page.evaluate !== 'function') {
    return {
      ok: false,
      fps: null,
      minFps,
      throttle,
      reason: 'no-page',
    };
  }

  const throttled = await applyCpuThrottle(page, throttle);

  let measured = null;
  try {
    measured = await page.evaluate(async () => {
      const map = globalThis.__parkMapLibre;
      if (map && typeof map.easeTo === 'function') {
        const start = typeof map.getZoom === 'function' ? map.getZoom() : 14;
        const run = (opts) => new Promise((resolve) => {
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          if (typeof map.once === 'function') map.once('idle', done);
          map.easeTo({ duration: 280, ...opts });
          setTimeout(done, 700);
        });
        await run({ zoom: Math.min(start + 2, 18), pitch: 40 });
        await run({ zoom: Math.max(start - 1, 11), pitch: 0 });
      }
      const samples = globalThis.__parkMapFps;
      if (!Array.isArray(samples) || samples.length === 0) return null;
      return samples.reduce((a, b) => a + b, 0) / samples.length;
    });
  } catch {
    measured = null;
  }

  if (typeof measured !== 'number' || !Number.isFinite(measured)) {
    return {
      ok: false,
      fps: null,
      minFps,
      throttle,
      throttled,
      reason: 'no-samples',
    };
  }

  return {
    ok: measured >= minFps,
    fps: measured,
    minFps,
    throttle,
    throttled,
    reason: measured >= minFps ? null : 'below-floor',
  };
}

export async function timeToFirstMap({ warm = false, elapsedMs = 0 } = {}) {
  const budget = warm ? 2000 : 4000;
  return { ok: elapsedMs <= budget, elapsedMs, budget, warm };
}

const SWEEP_FIX = { lat: 39.34395, lng: -84.2673, venue: 'kings-island' };

/**
 * Drive the sweep against a server that is already up.
 * Reuses the phone harness so GPS, intro, and gates are actually dismissed.
 * The missing-world stub (`[data-testid=park-map-gl].mapMissing`) is not a map.
 */
export async function runLiveZoomSweep({
  baseUrl = appOrigin(),
  minFps = MIN_FPS_FLOOR,
  throttle = 4,
} = {}) {
  let openPhone;
  let launch;
  try {
    ({ openPhone, launch } = await import('../../test/app/browser.mjs'));
  } catch {
    return { ok: false, fps: null, minFps, throttle, reason: 'no-playwright' };
  }
  const browser = await launch({ headless: true });
  try {
    const { page } = await openPhone(browser, {
      lat: SWEEP_FIX.lat,
      lng: SWEEP_FIX.lng,
      venue: SWEEP_FIX.venue,
      url: baseUrl,
      label: 'zoom-sweep',
    });
    const ready = page.locator('[data-testid="park-map-gl"]:not(.mapMissing)[data-map-ready="1"] canvas');
    await ready.waitFor({ timeout: 40000 });
    return await zoomSweep({ page, minFps, throttle });
  } finally {
    await browser.close();
  }
}
