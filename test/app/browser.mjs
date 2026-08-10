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
import { readFileSync } from 'node:fs';

const executablePath = process.env.CHROMIUM_PATH || undefined;
const APP_VERSION = JSON.parse(readFileSync(new URL('../../apps/party-tracker/package.json', import.meta.url))).version;

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
  {
    lat,
    lng,
    name = null,
    colorScheme = 'light',
    url = BASE,
    label = 'phone',
    venue = null,
    requireGps = true,
  } = {},
) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    permissions: ['geolocation', 'clipboard-read', 'clipboard-write'],
    geolocation: { latitude: lat, longitude: lng },
    colorScheme,
    locale: 'en-US',
  });
  // The update splash is driven by a client effect that runs after hydration,
  // so seed the seen-version key before the first paint rather than racing it.
  await context.addInitScript(({ version, venueId }) => {
    localStorage.setItem('tracker-release-notes-seen', version);
    localStorage.setItem('tracker-intro-seen', '1');
    // Confirmed is the intake answer; pinned is tracker-venue, which would block
    // the map from following the party host.
    if (venueId) localStorage.setItem('tracker-venue-confirmed', venueId);
  }, { version: APP_VERSION, venueId: venue });
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
  if (url.includes('/join')) {
    await page.waitForURL((u) => !String(u).includes('/join'), { timeout: 30000 }).catch(() => {});
  }
  await hydrated(page);
  await closeGate(page);
  const waitForReady = async () => {
    if (requireGps) {
      await until(
        async () => {
          if ((await page.locator('.gate').count()) > 0) return false;
          if ((await page.locator('.mePulse').count()) > 0) return true;
          const brand = await page.locator('.brand span').innerText().catch(() => '');
          return /near/i.test(brand);
        },
        { timeout: 40000, label: 'GPS fix and gates dismissed' },
      );
    } else {
      await until(async () => (await page.locator('.gate').count()) === 0, {
        timeout: 40000,
        label: 'gates dismissed',
      });
    }
  };
  try {
    await waitForReady();
  } catch {
    await closeGate(page);
    await waitForReady();
  }
  if (name) await setName(page, name);

  return { context, page, errors, requests, label };
}

export const hydrated = (page) =>
  page.waitForFunction(() => document.querySelectorAll('svg.mapSvg path').length > 100, null, {
    timeout: 40000,
  });

/**
 * Dismiss the one-time update splash if it is up. Polls because React may not
 * have painted it yet when `goto` returns.
 */
export async function dismissUpdateSplash(page, { timeout = 12000 } = {}) {
  const deadline = Date.now() + timeout;
  do {
    const continueBtn = page.locator('button:has-text("Continue")');
    if (await continueBtn.count()) {
      await continueBtn.click().catch(() => {});
      await page.waitForTimeout(600);
      return true;
    }
    if (timeout === 0) break;
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  return false;
}

/**
 * Take the intake down the way a visitor would: grant location, then say yes to
 * the park the fix lands nearest — which is the one every phone in these tests
 * is standing in. The fallbacks cover a phone whose mocked GPS never resolves,
 * so an intake bug fails its own assertion rather than every test behind it.
 */
export async function closeGate(page) {
  await dismissUpdateSplash(page);
  const allow = page.locator('button:has-text("Allow location")');
  const yes = page.locator('.gate .btn.primary:has-text("Yes — set up")');
  const quiet = page.locator(
    'button:has-text("Just look around"), button:has-text("Just show me"), button:has-text("Just show me the map"), button:has-text("Not now — just show me the map")',
  );
  if (await allow.count()) await allow.click().catch(() => {});
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await dismissUpdateSplash(page, { timeout: 250 });
    const paths = await page.locator('.mapSvg path').count();
    const gates = await page.locator('.gate').count();
    if (!gates && paths > 100) return;
    if (await yes.count()) await yes.click().catch(() => {});
    else if (await allow.count()) await allow.click().catch(() => {});
    if (await quiet.count() && !(await yes.count()) && !(await allow.count())) {
      await quiet.first().click().catch(() => {});
    }
    if (!(await page.locator('.gate').count()) && paths > 100) return;
    await page.waitForTimeout(750);
  }
  if (await quiet.count()) await quiet.first().click().catch(() => {});
  await page.waitForSelector('.gate', { state: 'detached', timeout: 10000 }).catch(() => {});
  await hydrated(page).catch(() => {});
}

/**
 * Pop whichever tab is showing back to its root screen. Idempotent: call it
 * from anywhere.
 */
export async function root(page) {
  for (let i = 0; i < 5; i += 1) {
    if (!(await page.locator('.navHead').count())) return;
    await page.locator('.navBack').click();
    await page.waitForTimeout(250);
  }
}

/**
 * Open one of the app's destinations from wherever you are.
 *
 * The bottom tab bar carries the four top-level screens, and each of them keeps
 * its own navigation stack, so getting somewhere is: tap the tab, unwind
 * whatever that tab was left on, and — for the three screens that live behind a
 * row inside Me — tap the row.
 *
 *   'Places'         the Explore tab: search, the rail and the list
 *   'Party'          the Party tab
 *   'Rider height',
 *   'Rides'          the Rides tab, where the venue publishes height rules
 *   'Settings', 'Me' the Me tab
 *   'Which map',
 *   'Show on the map',
 *   'Diagnostics'    a row inside Me
 */
const TAB_OF = {
  Places: 'explore',
  Explore: 'explore',
  Party: 'party',
  Rides: 'rides',
  'Rider height': 'rides',
  Settings: 'settings',
  Me: 'settings',
};
const SETTINGS_ROWS = new Set(['Which map', 'Show on the map', 'Diagnostics']);

/** Clear search and category filters on the places list. */
export async function resetPlaces(page) {
  await go(page, 'Places');
  await page.locator('.field[aria-label="Search places"]').fill('');
  const all = page.locator('.chip:has-text("All")').first();
  if (await all.count()) await all.click();
  const only = page.locator('.chip:has-text("Only what")');
  if (await only.count()) {
    const on = await only.getAttribute('class');
    if (on?.includes('on')) await only.click();
  }
  await page.waitForTimeout(400);
}

/** End an active walk so the tab bar is clickable again. */
export async function dismissNavigation(page) {
  if (!(await page.locator('.navBar, .navBanner').count())) return;
  const end = page.locator('.navEnd');
  if (await end.count()) {
    await end.click();
  } else {
    const back = page.locator('button:has-text("Back to the map")');
    if (await back.count()) await back.click();
  }
  await until(async () => (await page.locator('.navBar, .navBanner').count()) === 0, {
    timeout: 15000,
    label: 'navigation to dismiss',
  }).catch(() => {});
  await page.waitForTimeout(300);
}

export async function go(page, dest) {
  await closeGate(page);
  await dismissNavigation(page);
  const tab = SETTINGS_ROWS.has(dest) ? 'settings' : TAB_OF[dest];
  if (!tab) throw new Error(`go: nothing called "${dest}"`);
  await page.locator(`.tabItem[data-tab="${tab}"]`).click({ force: true });
  await page.waitForTimeout(300);
  // Tapping the tab you are already on pops it, but arriving from another tab
  // lands on whatever that one was left showing.
  await root(page);
  // Everything below the fold at the peek stop needs the sheet pulled up first
  // — the way a thumb would.
  if (await page.locator('.sheet.peek').count()) {
    await page.getByRole('slider', { name: /Resize panel/ }).click();
    await page.waitForTimeout(350);
  }
  if (!SETTINGS_ROWS.has(dest)) return;
  await page.locator(`.row:has-text("${dest}")`).first().click();
  await page.waitForTimeout(350);
}

/** Set the roster name through Me, as a visitor would, and come back to Explore. */
export async function setName(page, name) {
  await closeGate(page);
  await go(page, 'Settings');
  const field = page.locator('.field[placeholder="Name"]');
  await field.fill(name);
  await field.blur();
  await page.waitForTimeout(300);
  // Back to the map. The tab bar means leaving a phone on the Me tab leaves it
  // there, and everything downstream of a fresh phone expects Explore.
  await go(page, 'Places');
}

/** The roster names one phone can see, uppercased by CSS but not by the DOM. */
export async function rosterNames(page) {
  const rows = await page.locator('.memberRow .memberText b').allInnerTexts();
  return rows.map((t) => t.replace(/\s*(you|host|help)\s*/gi, '').trim()).filter(Boolean);
}

export { chromium };
