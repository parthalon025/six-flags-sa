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
  /ERR_CERT|fonts\.(googleapis|gstatic)|net::ERR_(FAILED|BLOCKED)_BY_CLIENT|\/_vercel\/(insights|speed-insights)\/|favicon\.ico/;

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
    // Name-before-join: /join asks what the family should call this phone.
    const joinName = page.locator('.gateCard input[aria-label="Your name"]');
    try {
      await joinName.waitFor({ state: 'visible', timeout: 15000 });
      if (name) await joinName.fill(name);
      await page.locator('.gateCard .btn.primary').click();
    } catch {
      /* legacy handoff without the name card */
    }
    await page.waitForURL((u) => !String(u).includes('/join'), { timeout: 30000 }).catch(() => {});
  }
  await hydrated(page);
  await closeGate(page);
  const waitForReady = async () => {
    if (requireGps) {
      await until(
        async () => {
          if ((await page.locator('.gate').count()) > 0) return false;
          const paths = await page.locator('.mapSvg path').count();
          if (paths < 100) return false;
          if ((await page.locator('.mePulse').count()) > 0) return true;
          const brand = await page.locator('.brandStatus').innerText().catch(() => '');
          return /near/i.test(brand);
        },
        { timeout: 40000, label: 'GPS fix and gates dismissed' },
      );
    } else {
      await until(async () => {
        if ((await page.locator('.gate').count()) > 0) return false;
        return (await page.locator('.mapSvg path').count()) >= 100;
      }, {
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
    const splash = page.locator('#update-splash-title');
    if (await splash.count()) {
      await page.locator('.gate:has(#update-splash-title) .btn.primary').click().catch(() => {});
      await page.waitForTimeout(600);
      return true;
    }
    if (timeout === 0) break;
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  return false;
}

/**
 * Dismiss the logo intro splash if it is up. Polls because React may not have painted it yet.
 */
export async function dismissIntroSplash(page, { timeout = 12000 } = {}) {
  const deadline = Date.now() + timeout;
  do {
    const intro = page.locator('#intro-splash-title');
    if (await intro.count()) {
      const primary = page.locator(
        '.gate:has(#intro-splash-title) .btn.primary, .gate .btn.primary:has-text("Get started")',
      );
      await primary.first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(600);
      if (!(await intro.count())) return true;
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
  await dismissIntroSplash(page);
  await dismissUpdateSplash(page);
  const nearest = page.locator('button:has-text("Go to nearest park")');
  const allow = page.locator('button:has-text("Allow location")');
  const yes = page.locator('.gate .btn.primary:has-text("set up")');
  const quiet = page.locator(
    'button:has-text("Just browsing"), button:has-text("Just look around"), button:has-text("Just show me"), button:has-text("Just show me the map"), button:has-text("Skip for now"), button:has-text("Not now")',
  );
  if (await nearest.count()) await nearest.click().catch(() => {});
  else if (await allow.count()) await allow.click().catch(() => {});
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await dismissIntroSplash(page, { timeout: 250 });
    await dismissUpdateSplash(page, { timeout: 250 });
    const paths = await page.locator('.mapSvg path').count();
    const gates = await page.locator('.gate').count();
    if (!gates && paths > 100) return;
    if (await yes.count()) await yes.click().catch(() => {});
    else if (await nearest.count()) await nearest.click().catch(() => {});
    else if (await allow.count()) await allow.click().catch(() => {});
    if (await quiet.count() && !(await yes.count()) && !(await allow.count()) && !(await nearest.count())) {
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
 * row inside Day — tap the row.
 *
 *   'Places'         the Explore tab: search, the rail and the list
 *   'Party'          the Party tab
 *   'Rider height',
 *   'Rides', 'Plan'  the Plan tab, where the venue publishes height rules
 *   'Settings', 'Me',
 *   'Day'            the Day tab
 *   'Which map', 'Which park',
 *   'Show on the map', 'On the map',
 *   'Diagnostics'    a row inside Day
 */
const TAB_OF = {
  Places: 'explore',
  Explore: 'explore',
  Party: 'party',
  Rides: 'rides',
  Plan: 'rides',
  'Rider height': 'rides',
  Settings: 'settings',
  Me: 'settings',
  Day: 'settings',
};
const SETTINGS_ROWS = new Set([
  'Which map',
  'Which park',
  'Show on the map',
  'On the map',
  'Diagnostics',
]);

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
  const rowLabel =
    dest === 'Which map'
      ? 'Which park'
      : dest === 'Show on the map'
        ? 'On the map'
        : dest;
  await page.locator(`.row:has-text("${rowLabel}")`).first().click();
  await page.waitForTimeout(350);
}

/** Type into the Explore search field and wait for the list to settle. */
export async function searchPlaces(page, query) {
  const field = page.locator('.field[aria-label="Search places"]');
  await field.fill(query);
  await page.waitForTimeout(500);
}

/** Clear Explore search back to the full list. */
export async function clearSearch(page) {
  const field = page.locator('.field[aria-label="Search places"]');
  await field.fill('');
  await page.waitForTimeout(400);
}

/** Rider-height verdict on one row — not the running-status pill beside it. */
export async function rideHeightVerdict(page, rideName) {
  const row = page.locator('.poiRow', { hasText: rideName }).first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  return row.locator('.verdict:not(.statusPill)').innerText();
}

/**
 * Tap a drawn map icon by name. Pointer capture lives on the map wrapper, so
 * the hit has to land as a real mouse click at the marker's screen point —
 * clicking the `<g>` itself never reaches ParkMap's picker.
 */
export async function tapMapPoi(page, name = null) {
  const hit = await page.evaluate((want) => {
    const wrap = document.querySelector('.mapWrap');
    const sheet = document.querySelector('.sheet');
    if (!wrap) return null;
    const sheetTop = sheet ? sheet.getBoundingClientRect().top : Infinity;
    const markers = [...document.querySelectorAll('g.poiMarker')];
    const pick = markers.find((g) => {
      const title = g.querySelector('title')?.textContent || '';
      if (want && title !== want) return false;
      const r = g.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const y = r.top + r.height / 2;
      return y > 40 && y < sheetTop - 24;
    });
    if (!pick) return null;
    const r = pick.getBoundingClientRect();
    return {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      name: pick.querySelector('title')?.textContent || '',
    };
  }, name);
  if (!hit) throw new Error(name ? `no visible map marker for ${name}` : 'no visible map marker');
  await page.mouse.click(hit.x, hit.y);
  await page.waitForTimeout(400);
  return hit.name;
}

/** Set the roster name through Me, as a visitor would, and come back to Explore. */
export async function setName(page, name) {
  await closeGate(page);
  await go(page, 'Settings');
  const field = page.locator('.field[placeholder="Name"]');
  await field.fill(name);
  await field.blur();
  await page.waitForTimeout(300);
  // Back to the map. Pop any settings sub-screen first — leaving Me on a
  // pushed row leaves the map unmounted when Explore is tapped.
  await page.locator('.tabItem[data-tab="explore"]').click();
  await page.waitForTimeout(250);
  await root(page);
  await page.waitForFunction(() => document.querySelectorAll('svg.mapSvg path').length > 100, null, {
    timeout: 40000,
  });
}


export async function signIn(page, email = 'guest@parkbound.example', { keepName = true } = {}) {
  await closeGate(page);
  await go(page, 'Settings');
  const priorName = keepName
    ? await page.locator('.field[placeholder="Name"]').inputValue().catch(() => '')
    : '';
  const card = page.locator('.signInCard');
  if ((await card.locator('text=Signed in').count()) > 0) {
    await page.locator('.tabItem[data-tab="explore"]').click();
    await page.waitForTimeout(200);
    return;
  }
  await card.locator('input[type="email"]').fill(email);
  await card.locator('button:has-text("Email me a link")').click();
  await until(async () => (await card.locator('text=Signed in').count()) > 0, {
    timeout: 10000,
    label: 'signed-in card',
  });
  // Soft-gate session defaults displayName from the email local-part; restore the
  // park-day name the harness already chose (Ava/Sam/Justin) when present.
  if (keepName && priorName && priorName !== 'Guest') {
    await setName(page, priorName);
  } else {
    await page.locator('.tabItem[data-tab="explore"]').click();
    await page.waitForTimeout(200);
  }
}

/** The roster names one phone can see, uppercased by CSS but not by the DOM. */
export async function rosterNames(page) {
  const rows = await page.locator('.memberRow .memberText b').allInnerTexts();
  return rows.map((t) => t.replace(/\s*(you|host|help)\s*/gi, '').trim()).filter(Boolean);
}

export { chromium };
