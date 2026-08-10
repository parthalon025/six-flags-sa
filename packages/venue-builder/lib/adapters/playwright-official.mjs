/**
 * Playwright adapter — fetch official park pages when plain fetch yields empty HTML.
 */

const UA = 'six-flags-sa-venue-research/1.0 (+https://github.com/parthalon025/six-flags-sa)';

/**
 * Load a URL in headless Chromium and return rendered HTML.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number, waitFor?: string }} opts
 */
export async function fetchWithBrowser(url, { timeoutMs = 30000, waitFor = 'body' } = {}) {
  const { chromium } = await import('playwright');
  const launchOpts = { headless: true };
  if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH;

  const browser = await chromium.launch(launchOpts);
  try {
    const page = await browser.newPage({ userAgent: UA });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout: Math.min(timeoutMs, 15000) }).catch(() => {});
    }
    await page.waitForTimeout(800);
    return await page.content();
  } finally {
    await browser.close();
  }
}

export async function run(ctx = {}) {
  const url = ctx.url;
  if (!url) {
    return { adapterId: 'playwright', ok: false, error: 'url_required' };
  }
  try {
    const html = await fetchWithBrowser(url, { timeoutMs: ctx.timeoutMs || 30000 });
    return {
      adapterId: 'playwright',
      ok: true,
      meta: { url, bytes: html.length },
      artifacts: [],
      html,
    };
  } catch (err) {
    return { adapterId: 'playwright', ok: false, error: err.message };
  }
}
