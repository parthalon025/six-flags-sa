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
 *
 * Phones opened here are HERMETIC by default: every request that would leave
 * the app's origin is aborted in the browser (see hermeticize), because a
 * sandboxed network that resets a TLS handshake mid-suite has taken the whole
 * browser process down with it (#534). HERMETIC=0 opts back into real egress.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const executablePath = process.env.CHROMIUM_PATH || undefined;
const APP_VERSION = JSON.parse(readFileSync(new URL('../../apps/party-tracker/package.json', import.meta.url))).version;

export const launch = (opts = {}) =>
  chromium.launch({ ...opts, ...(executablePath ? { executablePath } : {}) });

export const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

/** Local TLS stand-in for the production host (Clerk live FAPI rejects localhost). */
export const ignoreHTTPSErrors = BASE.startsWith('https://') || process.env.CLERK_E2E_TLS === '1';

/**
 * Console noise that is about the sandbox rather than the app: a webfont that
 * cannot be fetched with no outbound network, and a certificate the test
 * browser has never been told to trust. Everything else is a real error and the
 * suites assert on it — this list must not grow to make a failure go away.
 *
 * /api/weather no longer emits 502/503/504 for an upstream outage (#502) — a
 * cold cache with no upstream reachable degrades to a 200 gap body instead,
 * so there is nothing here for the browser to log as a failed resource load.
 * That gateway-class allowlist entry was removed with the fix; do not re-add
 * it to paper over a future regression in that route.
 */
export const IGNORABLE_CONSOLE =
  /ERR_CERT|fonts\.(googleapis|gstatic)|net::ERR_(FAILED|BLOCKED)_BY_CLIENT|\/_vercel\/(insights|speed-insights)\/|favicon\.ico|Failed to load resource.*\b404\b|Refused to execute script.*(text\/plain|application\/json)|Blocked call to navigator\.vibrate/;

/** Cross-origin egress is aborted in-test unless HERMETIC=0 says otherwise. */
export const HERMETIC = process.env.HERMETIC !== '0';

/**
 * Abort every request that would leave the app's origin (#534).
 *
 * The functional suites depend on no third-party host: weather is a
 * same-origin API route that degrades to a 200 gap body when its upstream is
 * unreachable (#502/#544), GPS is mocked, and the map is venue files. What
 * live egress DID contribute was flakes — in an agent sandbox the proxy reset
 * an outbound TLS handshake and Chromium took the whole browser context down
 * mid-suite, failing every test behind it. Aborting at the route layer makes
 * the abort a clean, ignorable resource error (net::ERR_BLOCKED_BY_CLIENT is
 * already in IGNORABLE_CONSOLE) instead of a browser crash.
 *
 * Context-level, so every page the phone opens inherits it; page-level route
 * stubs (e.g. a weather fulfil) are checked first and keep working. Non-http
 * schemes (data:, blob:) never leave the machine and fall through.
 */
export async function hermeticize(context, appUrl = BASE) {
  const origin = new URL(appUrl).origin;
  await context.route('**/*', (route) => {
    let target = null;
    try {
      target = new URL(route.request().url());
    } catch {
      return route.abort('blockedbyclient');
    }
    if (!/^https?:$/.test(target.protocol) || target.origin === origin) return route.fallback();
    return route.abort('blockedbyclient');
  });
}

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
    viewport = { width: 390, height: 844 },
    deviceScaleFactor = 2,
    isMobile = true,
  } = {},
) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor,
    hasTouch: true,
    isMobile,
    permissions: ['geolocation', 'clipboard-read', 'clipboard-write'],
    geolocation: { latitude: lat, longitude: lng },
    colorScheme,
    locale: 'en-US',
    ignoreHTTPSErrors,
  });
  if (HERMETIC) await hermeticize(context, url);
  // The update splash is driven by a client effect that runs after hydration,
  // so seed the seen-version key before the first paint rather than racing it.
  await context.addInitScript(({ version, venueId }) => {
    localStorage.setItem('tracker-release-notes-seen', version);
    localStorage.setItem('tracker-intro-seen', '1');
    // Confirmed is the intake answer; pinned is tracker-venue, which would block
    // the map from following the party host.
    if (venueId) localStorage.setItem('tracker-venue-confirmed', venueId);
    // Headless Chromium implements navigator.share but never resolves the picker —
    // force the clipboard fallback shareInvite already has for CI.
    try {
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    } catch {
      /* ignore */
    }
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
  const fromInvite = String(url).includes('/join');
  if (fromInvite) {
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
  if (fromInvite) {
    // Finish name-first invite join before Me/setName tab churn can race it.
    await go(page, 'Party');
    try {
      await until(async () => (await page.locator('.codeText').count()) > 0, {
        timeout: 60000,
        label: 'invite join landed',
      });
    } catch (err) {
      const diag = await page
        .evaluate(() => ({
          path: location.pathname,
          hash: location.hash?.slice(0, 12) || '',
          pending: Boolean(sessionStorage.getItem('ki-pending-invite')),
          session: Boolean(localStorage.getItem('ki-session-v3')),
          toast: document.querySelector('.toast')?.textContent || '',
        }))
        .catch(() => ({}));
      throw new Error(`${err.message}; diag=${JSON.stringify(diag)}`);
    }
  } else if (name) {
    await setName(page, name);
  }

  return { context, page, errors, requests, label };
}

export const hydrated = (page) =>
  page.waitForFunction(() => document.querySelectorAll('svg.mapSvg path').length > 100, null, {
    timeout: 40000,
  });

/**
 * Dismiss the Profile auth gate (Login / Guest) when Clerk is configured.
 */
export async function dismissAuthGate(page, { timeout = 12000 } = {}) {
  const deadline = Date.now() + timeout;
  do {
    const guest = page.locator('.authGate button:has-text("Guest"), .authGate button:has-text("Continue as guest")');
    if (await guest.count()) {
      await guest.first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(400);
      if (!(await page.locator('.authGate').count())) return true;
    } else if (!(await page.locator('.authGate').count())) {
      return true;
    }
    if (timeout === 0) break;
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  return false;
}

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
    // No gate of any kind up: this splash is not forming either, so stop polling
    // instead of burning the full timeout on every call (functional#194).
    if (!(await page.locator('.gate').count())) return true;
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
    } else if (!(await page.locator('.gate').count())) {
      // No gate of any kind up: this splash is not forming either, so stop
      // polling instead of burning the full timeout on every call (#194).
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
  await dismissAuthGate(page);
  await dismissIntroSplash(page);
  await dismissUpdateSplash(page);
  const nearest = page.locator('button:has-text("Go to nearest World"), button:has-text("Go to nearest park")');
  const allow = page.locator('button:has-text("Allow location")');
  const yes = page.locator('.gate .btn.primary:has-text("Enter"), .gate .btn.primary:has-text("set up")');
  const quiet = page.locator(
    'button:has-text("Just browsing"), button:has-text("Just look around"), button:has-text("Just show me"), button:has-text("Just show me the map"), button:has-text("Skip for now"), button:has-text("Not now")',
  );
  if (await nearest.count()) await nearest.click().catch(() => {});
  else if (await allow.count()) await allow.click().catch(() => {});
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await dismissAuthGate(page, { timeout: 250 });
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
 *   'Quests',
 *   'Side Quests'    the Side Quests tab
 *   'Rider height',
 *   'Rides', 'Plan'  the Plan tab, where the venue publishes height rules
 *   'Settings', 'Me',
 *   'Day'            the Day tab
 *   'Explore Worlds',
 *   'Show on the map', 'On the map',
 *   'Diagnostics'    a row inside Day (Map / More topic tabs)
 */
const TAB_OF = {
  Places: 'explore',
  Explore: 'explore',
  Party: 'party',
  Quests: 'quests',
  'Side Quests': 'quests',
  Rides: 'rides',
  Plan: 'rides',
  'Rider height': 'rides',
  Settings: 'settings',
  Me: 'settings',
  Day: 'settings',
  Collection: 'settings',
};
const SETTINGS_ROWS = new Set([
  'Explore Worlds',
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

/**
 * Peek the Explore sheet so map FABs stay actionable.
 * A half/full sheet sets data-crowded and zeros .fabs pointer-events.
 */
export async function ensurePeek(page) {
  await dismissNavigation(page).catch(() => {});
  const explore = page.locator('.tabItem[data-tab="explore"]');
  if (await explore.count()) {
    await explore.click({ force: true });
    await page.waitForTimeout(300);
  }
  await root(page);
  const stop = () =>
    page.locator('.sheet').evaluate((e) =>
      ['peek', 'half', 'full', 'shut'].find((s) => e.classList.contains(s)) || null,
    );
  for (let i = 0; i < 4 && (await stop()) !== 'peek'; i += 1) {
    await page.getByRole('slider', { name: /Resize panel/ }).click();
    await page.waitForTimeout(350);
  }
}

/** POI heights gate the Plan/Rides tab — wait before Rider height navigation. */
export async function waitForHeightsReady(page, { timeout = 45000 } = {}) {
  await until(
    async () => {
      if ((await page.locator('.gate').count()) > 0) return false;
      if ((await page.locator('svg.mapSvg path').count()) < 100) return false;
      return (await page.locator('.tabItem[data-tab="rides"]').count()) > 0;
    },
    { timeout, label: 'rides tab after POI load' },
  );
}

export async function go(page, dest) {
  await closeGate(page);
  await dismissNavigation(page);
  const tab = SETTINGS_ROWS.has(dest) ? 'settings' : TAB_OF[dest];
  if (!tab) throw new Error(`go: nothing called "${dest}"`);
  const tabSel = `.tabItem[data-tab="${tab}"]`;
  await until(async () => (await page.locator(tabSel).count()) > 0, {
    timeout: tab === 'rides' ? 45000 : 30000,
    label: `${dest} tab`,
  });
  await page.locator(tabSel).click({ force: true });
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
  /* Me is the tab root now; Settings is a screen pushed under it, and so is
     Collection. Anything asking for a preference has to walk through that row
     first — "Me" itself is the only destination that stays on the root. */
  if (tab === 'settings' && dest !== 'Me') {
    const settingsRow = page.locator('.mePanel .row', { hasText: 'Settings' }).first();
    // The Me root is a lazily imported panel, so it can arrive a frame or two
    // after the tab does — wait for the row rather than reading a count of 0
    // and walking on to a screen that is not up yet.
    await settingsRow.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    if (await settingsRow.count()) {
      await settingsRow.scrollIntoViewIfNeeded().catch(() => {});
      await settingsRow.click();
      await page.locator('.settingsPanel').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(250);
    }
  }
  if (dest === 'Rider height') {
    const heightsTab = page.locator('.settingsTopic', { hasText: 'Heights' });
    if (await heightsTab.count()) await heightsTab.click();
    await page.waitForTimeout(300);
  }
  if (
    dest === 'Explore Worlds' ||
    dest === 'On the map' ||
    dest === 'Show on the map' ||
    dest === 'Collection'
  ) {
    const mapTab = page.locator('.settingsTopic', { hasText: 'Map' });
    if (await mapTab.count()) await mapTab.click();
    await page.waitForTimeout(300);
  }
  if (dest === 'Collection') {
    const closetRow = page.locator('.settingsPanel .row', { hasText: 'Collection' }).first();
    if (await closetRow.count()) {
      await closetRow.click();
      await page.waitForTimeout(350);
    }
  }
  if (dest === 'Diagnostics') {
    const moreTopic = page.locator('.settingsTopic', { hasText: 'More' });
    if (await moreTopic.count()) {
      await moreTopic.click();
      await page.waitForTimeout(300);
    }
  }
  if (!SETTINGS_ROWS.has(dest)) return;
  const rowLabel = dest === 'Show on the map' ? 'On the map' : dest;
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
export async function tapMapPoi(page, name = null, { timeout = 15000 } = {}) {
  const hit = await until(
    () =>
      page.evaluate((want) => {
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
      }, name),
    { timeout, label: name ? `map marker for ${name}` : 'map marker' },
  );
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
  // CI / local boxes often have no Clerk key — SignInCard stays unmounted (AuthBridge seam).
  // ADR-0010: no email magic-link UI; Profile-gated tests must soft-assert the gate instead.
  if ((await card.count()) === 0) {
    await page.locator('.tabItem[data-tab="explore"]').click();
    await page.waitForTimeout(200);
    return false;
  }
  if ((await card.locator('text=Signed in').count()) > 0) {
    await page.locator('.tabItem[data-tab="explore"]').click();
    await page.waitForTimeout(200);
    return true;
  }
  // Legacy email magic-link UI (optional); OAuth-only cards cannot complete in this harness.
  const emailField = card.locator('input[type="email"]');
  if ((await emailField.count()) === 0) {
    await page.locator('.tabItem[data-tab="explore"]').click();
    await page.waitForTimeout(200);
    return false;
  }
  await emailField.fill(email);
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
  return true;
}

/** True when the soft-gate Profile session is present on this phone. */
export async function hasProfileSession(page) {
  return page.evaluate(() => {
    try {
      const raw = sessionStorage.getItem('parkbound.session');
      const s = raw ? JSON.parse(raw) : null;
      return Boolean(s?.userId);
    } catch {
      return false;
    }
  });
}

/**
 * Roster display names as the DOM stores them (first text node in the heading).
 * Prefer textContent over innerText — chip <em>s use text-transform and flex
 * layout, so innerText is a brittle side channel for the name.
 */
/** Party tab first — roster rows are not on Explore/Places (#party flake). */
export async function partyRosterNames(page) {
  await go(page, 'Party');
  return rosterNames(page);
}

export async function rosterNames(page) {
  return page.locator('.memberRow .memberText b').evaluateAll((els) =>
    els
      .map((el) => {
        const node = [...el.childNodes].find(
          (n) => n.nodeType === Node.TEXT_NODE && String(n.textContent || '').trim(),
        );
        return String(node?.textContent || '').trim();
      })
      .filter(Boolean),
  );
}

export { chromium };
