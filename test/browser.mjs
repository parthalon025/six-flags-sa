/**
 * Shared browser plumbing for the test harnesses.
 *
 * By default `launch` is just `chromium.launch()` against the browser Playwright
 * downloaded for itself. Set CHROMIUM_PATH to point at a Chromium that is
 * already on the machine (a CI image, a sandbox, a distro package) and the
 * tests use that instead of insisting on their own copy:
 *
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node test/functional.mjs
 *
 * BASE_URL points the suites at an app on another port:
 *
 *   BASE_URL=http://127.0.0.1:3711 node test/functional.mjs
 */
import { chromium } from 'playwright';

const executablePath = process.env.CHROMIUM_PATH || undefined;

export const launch = (opts = {}) =>
  chromium.launch({ ...opts, ...(executablePath ? { executablePath } : {}) });

export const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

/**
 * Console noise that is about the sandbox rather than the app: a webfont that
 * cannot be fetched with no outbound network, and a certificate the test
 * browser has never been told to trust. Everything else is a real error and the
 * suites assert on it — this list must not grow to make a failure go away.
 */
export const IGNORABLE_CONSOLE =
  /ERR_CERT|fonts\.(googleapis|gstatic)|net::ERR_(FAILED|BLOCKED)_BY_CLIENT/;

/** Poll `fn` until it returns something truthy. Returns that value. */
export async function until(fn, { timeout = 30000, step = 500, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label} (last: ${last})`);
    await new Promise((resolve) => setTimeout(resolve, step));
  }
}

/**
 * Boot one phone: a context with a faked GPS position, the page loaded, React
 * hydrated and the location gate out of the way.
 *
 * Deliberately never `waitUntil: 'networkidle'`. A phone in a party polls its
 * mailbox forever, so the network never goes idle and every wait on it hangs
 * until the timeout. Hydration is detected from the map instead: the geometry
 * is fetched and drawn by a client effect, so paths on the canvas mean React is
 * running and clicks will land on handlers rather than on static markup.
 */
export async function openPhone(
  browser,
  { lat, lng, name = null, colorScheme = 'light', url = BASE, label = 'phone' } = {},
) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    permissions: ['geolocation', 'clipboard-read', 'clipboard-write'],
    geolocation: { latitude: lat, longitude: lng },
    colorScheme,
    locale: 'en-US',
  });
  const page = await context.newPage();

  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    // A blocked resource logs "Failed to load resource: …" with no URL in the
    // text — the URL is on the message location, so test both.
    const where = `${m.text()} ${m.location()?.url ?? ''}`;
    if (m.type() === 'error' && !IGNORABLE_CONSOLE.test(where)) {
      errors.push(`${label} console: ${where.slice(0, 200)}`);
    }
  });
  page.on('request', (r) => requests.push(r.url()));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await hydrated(page);
  await closeGate(page);
  if (name) await setName(page, name);

  return { context, page, errors, requests, label };
}

export const hydrated = (page) =>
  page.waitForFunction(() => document.querySelectorAll('svg.mapSvg path').length > 100, null, {
    timeout: 40000,
  });

/**
 * Take the location gate down the way a visitor would. Granting is enough on
 * its own once the fix lands; the fallbacks cover a phone whose mocked GPS
 * never resolves, so a gate bug fails its own assertion rather than every test
 * behind it.
 */
export async function closeGate(page) {
  const allow = page.locator('button:has-text("Allow location")');
  if (await allow.count()) await allow.click();
  for (let i = 0; i < 2; i += 1) {
    if (!(await page.locator('.gate').count())) return;
    await page.waitForTimeout(1500);
    if (!(await page.locator('.gate').count())) return;
    await allow.click().catch(() => {});
  }
  const quiet = page.locator('button:has-text("Just show me")');
  if (await quiet.count()) await quiet.click();
  await page.waitForSelector('.gate', { state: 'detached', timeout: 10000 });
}

/**
 * The sheet is a navigation stack, so getting somewhere means popping back to
 * the root screen and then opening a destination — the same two moves a visitor
 * makes. `root` is idempotent: call it from anywhere.
 */
export async function root(page) {
  for (let i = 0; i < 5; i += 1) {
    if (!(await page.locator('.navHead').count())) return;
    await page.locator('.navBack').click();
    await page.waitForTimeout(250);
  }
}

/**
 * Open one of the sheet's destinations from wherever you are.
 *
 *   'Places'        the root screen — search, the rail and the list
 *   'Settings'      behind the avatar beside the search field
 *   'Which map',
 *   'Show on the map',
 *   'Diagnostics'   a row inside Settings
 *   anything else   a row on the root screen: 'Party', 'Rider height', …
 */
const SETTINGS_ROWS = new Set(['Which map', 'Show on the map', 'Diagnostics']);

export async function go(page, dest) {
  await root(page);
  // Everything below the search field is below the peek fold, so pull the sheet
  // up first — the way a thumb would.
  if (await page.locator('.sheet.peek').count()) {
    await page.locator('.grab').click();
    await page.waitForTimeout(350);
  }
  if (dest === 'Places') return;
  if (dest === 'Settings' || SETTINGS_ROWS.has(dest)) {
    await page.locator('.avatarBtn').click();
    await page.waitForTimeout(350);
    if (dest === 'Settings') return;
  }
  await page.locator(`.row:has-text("${dest}")`).first().click();
  await page.waitForTimeout(350);
}

/** Set the roster name through Settings, as a visitor would. */
export async function setName(page, name) {
  await go(page, 'Settings');
  const field = page.locator('.field[placeholder="Name"]');
  await field.fill(name);
  await field.blur();
  await page.waitForTimeout(300);
  await root(page);
}

/** The roster names one phone can see, uppercased by CSS but not by the DOM. */
export async function rosterNames(page) {
  const rows = await page.locator('.memberRow .memberText b').allInnerTexts();
  return rows.map((t) => t.replace(/\s*(you|host|help)\s*/gi, '').trim()).filter(Boolean);
}

export { chromium };
