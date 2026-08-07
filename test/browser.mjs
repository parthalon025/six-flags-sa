/**
 * Shared browser launcher for the test harnesses.
 *
 * By default this is just `chromium.launch()` against the browser Playwright
 * downloaded for itself. Set CHROMIUM_PATH to point at a Chromium that is
 * already on the machine (a CI image, a sandbox, a distro package) and the
 * tests use that instead of insisting on their own copy:
 *
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node test/functional.mjs
 */
import { chromium } from 'playwright';

const executablePath = process.env.CHROMIUM_PATH || undefined;

export const launch = (opts = {}) =>
  chromium.launch({ ...opts, ...(executablePath ? { executablePath } : {}) });

export { chromium };
