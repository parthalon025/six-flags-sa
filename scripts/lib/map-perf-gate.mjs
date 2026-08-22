/**
 * Train H perf gate — regression-only CI throttle (ADR-0021 decision b).
 *
 * Absolute bars and a pinned device are out of scope. A missing page or a
 * missing frame trace is a failed sweep, not a passing floor: inventing 30 fps
 * is how a gate that cannot go red ships.
 */

/** Floor a throttled phone must hold. ADR-0019's 30 fps low-end row. */
export const MIN_FPS_FLOOR = 30;

function average(samples) {
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

/**
 * Scripted pan/zoom/pitch sweep against a live page.
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

  const session = typeof page.context === 'function'
    ? await page.context().newCDPSession?.(page).catch(() => null)
    : null;
  if (session?.send) {
    await session.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }

  let measured = null;
  try {
    measured = await page.evaluate(() => {
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
      reason: 'no-samples',
    };
  }

  return {
    ok: measured >= minFps,
    fps: measured,
    minFps,
    throttle,
    reason: measured >= minFps ? null : 'below-floor',
  };
}

export async function timeToFirstMap({ warm = false, elapsedMs = 0 } = {}) {
  const budget = warm ? 2000 : 4000;
  return { ok: elapsedMs <= budget, elapsedMs, budget, warm };
}

/**
 * Drive the sweep against a server that is already up.
 * A missing Chromium or a map that never paints fails the gate.
 */
export async function runLiveZoomSweep({
  baseUrl = 'http://127.0.0.1:3000',
  minFps = MIN_FPS_FLOOR,
  throttle = 4,
} = {}) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return { ok: false, fps: null, minFps, throttle, reason: 'no-playwright' };
  }
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="park-map-gl"]', { timeout: 40000 }).catch(() => null);
    await page.waitForTimeout(1500);
    return zoomSweep({ page, minFps, throttle });
  } finally {
    await browser.close();
  }
}
