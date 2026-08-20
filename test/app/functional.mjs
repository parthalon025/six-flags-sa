#!/usr/bin/env node
/**
 * Behavioural suite against a running app.
 *
 * Three phones in one browser: A hosts a party, B joins by typing the code, C
 * joins from the invite link. Then A's phone is taken away and the other two
 * have to keep the party alive between them.
 *
 * Modules (TEST_MODULES / --modules=): smoke, heights, walk, party, intake,
 * venues, offline, auth. Omit or pass `all` to run every section.
 *
 *   npm run build && npm start &
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node test/app/functional.mjs
 *   node test/app/functional.mjs --modules=party,heights
 */

import {
  BASE,
  ignoreHTTPSErrors,
  clearSearch,
  closeGate,
  dismissIntroSplash,
  dismissNavigation,
  ensurePeek,
  signIn,
  hasProfileSession,
  dismissUpdateSplash,
  go,
  hydrated,
  launch,
  openPhone,
  resetPlaces,
  rideHeightVerdict,
  root,
  rosterNames,
  partyRosterNames,
  searchPlaces,
  until,
  tapMapPoi,
  waitForHeightsReady,
} from './browser.mjs';
import { parseModulesArg, wantModule } from './lib/module-select.mjs';
import { readFileSync } from 'node:fs';
import { pointInCoverage } from '../../packages/venue-builder/src/routing-coverage.mjs';
import { RIDE_STALE_AFTER_MS } from '../../apps/party-tracker/lib/core/state.js';
import { PRECISE_MAX_MS } from '../../apps/party-tracker/lib/location.js';

const PASS = [];
const FAIL = [];
const ok = (n) => {
  PASS.push(n);
  console.log('  PASS', n);
};
const bad = (n, e) => {
  FAIL.push(`${n} :: ${e}`);
  console.log('  FAIL', n, '->', e);
};
const check = async (n, fn) => {
  try {
    const r = await fn();
    if (r === false) throw new Error('assertion false');
    ok(n);
  } catch (e) {
    // Keep the first actionable lines (Playwright often puts the locator on line 2–3).
    const msg = String(e.message || e)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(' | ');
    bad(n, msg);
  }
};

/** A party is carried by the mailbox in a test browser, so joins are not quick. */
const JOIN_TIMEOUT = 45000;
/** Host timeout is 12 s plus a claim window plus the new host's first beacon. */
const MIGRATION_TIMEOUT = 75000;

const selected = parseModulesArg();
const want = (id) => wantModule(selected, id);
const FUNCTIONAL_IDS = ['smoke', 'heights', 'walk', 'party', 'intake', 'venues', 'offline', 'auth'];
const anyFunctional = !selected || FUNCTIONAL_IDS.some((id) => want(id));
if (!anyFunctional) {
  console.log('functional: no functional modules selected — skipping');
  process.exit(0);
}

const browser = await launch();

const running = selected ? [...selected].join(',') : 'all';
console.log(`\nfunctional suite against ${BASE} (modules: ${running})\n`);

let A = null;
let a = null;
let B = null;
let b = null;
let C = null;
let c = null;
let D = null;
let d = null;
let code = null;
let session = null;
let invite = null;

const needsPhoneA = want('smoke') || want('heights') || want('walk') || want('party') || want('auth');
const authOnlyPhone =
  want('auth') && !want('smoke') && !want('heights') && !want('walk') && !want('party');
if (authOnlyPhone) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    locale: 'en-US',
    ignoreHTTPSErrors,
  });
  const page = await context.newPage();
  A = { context, page, errors: [], requests: [], label: 'A' };
  a = page;
} else if (needsPhoneA) {
  // The Beast's station.
  A = await openPhone(browser, {
    lat: 39.34395,
    lng: -84.2673,
    name: 'Justin',
    label: 'A',
    venue: 'kings-island',
  });
  a = A.page;
}

/** Open a ride's row on the sheet's root screen and return its detail panel. */
async function openRide(page, name) {
  await go(page, 'Places');
  await page.waitForTimeout(300);
  await page.locator('.chip:has-text("All")').first().click();
  // By aria-label, not placeholder: the placeholder names the loaded venue.
  await page.locator('.field[aria-label="Search places"]').fill(name);
  await page.waitForTimeout(400);
  const row = page.locator('.poiRow', { hasText: name }).first();
  await row.locator('.poiMain').click();
  await page.waitForTimeout(300);
  return row;
}

/**
 * The report buttons are addressed by `data-report` rather than by their label:
 * the label is deliberately stateful ("It's down" becomes "PAUSED"), so
 * matching on text couples the test to which way the button is currently
 * pointing — which is the thing under test.
 */
const reportBtn = (row, status) => row.locator(`button[data-report="${status}"]`);

/**
 * The running-status pill on a ride's row, or '' when it carries none.
 *
 * `.statusPill` and not `.verdict`: the height verdict is also a `.verdict` and
 * sits in the same stack, and matching it would read "CAN RIDE" as a claim
 * about whether the ride is operating — which is the exact confusion this
 * feature exists to undo.
 */
async function pillFor(page, name) {
  const row = page.locator('.poiRow', { hasText: name }).first();
  const pill = row.locator('.statusPill').first();
  try {
    // Short timeout and a catch rather than a count() guard: the retraction
    // test is polling for this pill to vanish, so it can and does disappear
    // between being counted and being read.
    return (await pill.innerText({ timeout: 1000 })).trim();
  } catch {
    return '';
  }
}

if (want('auth')) {
console.log('\n--- auth (Clerk-off guards) ---');
let clerkAuthPages = false;

await check('sign-in page respects Clerk configuration', async () => {
  await a.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  const outcome = await until(
    async () => {
      const url = String(a.url());
      const onSignIn = url.includes('/sign-in');
      const clerkPage = (await a.locator('.clerkAuthPage').count()) > 0;
      const clerkWidget =
        (await a.locator('.cl-signIn-root, [data-clerk-component="SignIn"]').count()) > 0;
      if (!onSignIn) return { mode: 'redirect' };
      if (clerkPage || clerkWidget) return { mode: 'clerk' };
      return null;
    },
    { timeout: 20000, label: 'sign-in redirect or Clerk widget' },
  );
  clerkAuthPages = outcome.mode === 'clerk';
  return true;
});

await check('sign-up page respects Clerk configuration', async () => {
  await a.goto(`${BASE}/sign-up`, { waitUntil: 'domcontentloaded' });
  const outcome = await until(
    async () => {
      const url = String(a.url());
      const onSignUp = url.includes('/sign-up');
      const clerkPage = (await a.locator('.clerkAuthPage').count()) > 0;
      const clerkWidget =
        (await a.locator('.cl-signUp-root, [data-clerk-component="SignUp"]').count()) > 0;
      if (!onSignUp) return { mode: 'redirect' };
      if (clerkPage || clerkWidget) return { mode: 'clerk' };
      return null;
    },
    { timeout: 20000, label: 'sign-up redirect or Clerk widget' },
  );
  if (outcome.mode === 'clerk') clerkAuthPages = true;
  return true;
});

await check('OAuth SSO callback does not remount the SignIn widget', async () => {
  // Clerk may redirect mid-load; Playwright then reports net::ERR_ABORTED even
  // though the callback (or its redirect target) did land.
  try {
    await a.goto(`${BASE}/sign-in/sso-callback`, { waitUntil: 'domcontentloaded' });
  } catch (err) {
    if (!/ERR_ABORTED|Navigation.*interrupted/i.test(String(err?.message || err))) throw err;
  }
  await a.waitForLoadState('domcontentloaded').catch(() => {});
  const url = String(a.url());
  if (!url.includes('/sign-in/sso-callback')) return true;
  const clerkSignIn =
    (await a.locator('.cl-signIn-root, [data-clerk-component="SignIn"]').count()) > 0;
  if (clerkSignIn) {
    throw new Error('SSO callback remounted SignIn instead of completing OAuth');
  }
  return true;
});

const clerkOn = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
if (clerkOn) {
console.log('\n--- auth (Clerk-on Profile OAuth) ---');

await check('Profile gate shows Sign in and Guest', async () => {
  await a.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await until(
    async () => (await a.locator('.authGate .authGateLogin').count()) >= 1,
    { timeout: 25000, label: 'Profile Sign in button' },
  );
  if (!(await a.locator('.authGate button:has-text("Guest")').count())) {
    throw new Error('Profile gate missing Guest button');
  }
  const loginHref = await a.locator('.authGate .authGateLogin').getAttribute('href');
  if (loginHref !== '/sign-in') throw new Error(`Sign in href expected /sign-in, got ${loginHref}`);
  const shot = process.env.CLERK_E2E_SHOTS;
  if (shot) await a.screenshot({ path: `${shot.replace(/\/+$/, '')}/profile_login_guest_gate.png`, fullPage: true });
  return true;
});

await check('sign-in route shows Google and Apple logo buttons', async () => {
  await a.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await until(
    async () => (await a.locator('.clerkAuthPage .oauthBtn, .cl-socialButtons, .cl-socialButtonsBlockButton').count()) >= 1,
    { timeout: 25000, label: 'Clerk sign-in OAuth buttons' },
  );
  return true;
});

// Google is not enabled on this Clerk instance yet. Opt in with CLERK_E2E_GOOGLE=1
// after the provider is configured — do not treat a missing Google app as a login bug.
if (process.env.CLERK_E2E_GOOGLE === '1') {
await check('Google logo button starts Clerk OAuth', async () => {
  await a.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  const google = a.locator(
    '.clerkAuthPage .oauthBtn[aria-label*="Google"], .cl-socialButtonsBlockButton:has-text("Google")',
  );
  await google.first().click();
  const dest = await until(
    async () => {
      const url = String(a.url());
      if (/google|clerk\.com|accounts\./i.test(url) && !url.startsWith(BASE)) return url;
      const err = (await a.locator('.warnText').innerText().catch(() => '')).trim();
      if (err) return { error: err };
      return null;
    },
    { timeout: 25000, label: 'Clerk/Google OAuth navigation' },
  );
  if (dest?.error) throw new Error(dest.error);
  if (typeof dest !== 'string') throw new Error('Google button did not leave the app for Clerk OAuth');
  return true;
});
}
}

if (!authOnlyPhone) {
await check('Settings sign-in card matches Clerk routes', async () => {
  await go(a, 'Settings');
  const card = (await a.locator('.signInCard').count()) > 0;
  if (!clerkAuthPages && card) {
    throw new Error('SignInCard mounted when /sign-in is not available');
  }
  await a.locator('.tabItem[data-tab="explore"]').click();
  await a.waitForTimeout(200);
  return true;
});
}
} // end auth

if (want('smoke')) {
console.log('--- phone A: core ---');

await check('GPS gate closes and position resolves', async () => {
  if (await a.locator('.gate').count()) throw new Error('gate still up');
  const brand = await a.locator('.brandStatus').innerText();
  if (!/NEAR/i.test(brand)) throw new Error(brand);
  return true;
});

await check('park geometry is drawn', async () => {
  const paths = await a.locator('svg.mapSvg path').count();
  if (paths < 800) throw new Error(`${paths} paths`);
  if (!(await a.locator('.mePulse').count())) throw new Error('no own-position marker');
  return true;
});

await check('glance rail renders nearby fallback cards', async () => {
  await go(a, 'Places');
  return (await a.locator('.glanceCard').count()) >= 2;
});

await check('GO NOW card carries a Why? explanation', async () => {
  // Deterministic clear/day sky so outdoor GO NOW is not suppressed by night
  // or a stormy Open-Meteo reading during CI.
  await a.route('**/api/weather**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        observed: {
          code: 0,
          tempF: 78,
          gustMph: 6,
          windMph: 4,
          precipIn: 0,
          precipChance: 5,
          isDay: true,
        },
        at: Date.now(),
        source: 'test-fixture',
      }),
    });
  });
  await a.evaluate(() => {
    localStorage.setItem(
      'ki-weather',
      JSON.stringify({
        observed: {
          code: 0,
          tempF: 78,
          gustMph: 6,
          windMph: 4,
          precipIn: 0,
          precipChance: 5,
          isDay: true,
        },
        at: Date.now(),
      }),
    );
  });
  await go(a, 'Rider height');
  await a.locator('.tier:has-text("48")').click();
  await a.waitForTimeout(500);
  await go(a, 'Places');
  await until(async () => (await a.locator('.glanceCard').count()) >= 2, {
    timeout: 15000,
    label: 'glance rail cards',
  });
  await a.locator('.tabItem[data-tab="explore"]').click();
  await root(a);
  // Peek so the glance rail is visible.
  for (let i = 0; i < 4; i += 1) {
    const stop = await a.locator('.sheet').evaluate((e) =>
      ['peek', 'half', 'full', 'shut'].find((s) => e.classList.contains(s)) || null,
    );
    if (stop === 'peek') break;
    await a.getByRole('slider', { name: /Resize panel/ }).click();
    await a.waitForTimeout(300);
  }
  // useWeather only reads localStorage on mount; a bare fetch does not update
  // React state. `online` is the hook's public refresh signal (same as a phone
  // regaining signal). Retry while waiting — an in-flight poll can no-op once.
  const goNowHit = a.locator('.glanceCard.goNow .glanceHit[title]');
  const whyHit = a.locator('.glanceHit[title*="Why"]');
  await until(
    async () => {
      await a.evaluate(() => window.dispatchEvent(new Event('online')));
      return (await goNowHit.count()) > 0 || (await whyHit.count()) > 0;
    },
    { timeout: 20000, label: 'a glance card with Why title' },
  );
  const hit = (await goNowHit.count()) > 0 ? goNowHit.first() : whyHit.first();
  const why = (await hit.getAttribute('title')) || '';
  if (!why || why.length < 6) throw new Error(`missing Why? title: "${why}"`);
  return true;
});


await check('the palette toggle cycles data-theme through Trail and Park Midnight', async () => {
  // ADR-0012: the toggle cycles auto -> Trail (day) -> Park Midnight (night).
  // A full cycle of three taps must show both resolved palettes and land back
  // on the mode it started from, whatever that was.
  const toggle = () => a.getByRole('button', { name: /switch to (Trail|Park Midnight)/i });
  const before = await a.evaluate(() => document.documentElement.dataset.theme);
  const seen = new Set([before]);
  for (let i = 0; i < 3; i += 1) {
    await toggle().click();
    await a.waitForTimeout(300);
    seen.add(await a.evaluate(() => document.documentElement.dataset.theme));
  }
  if (seen.size < 2) throw new Error(`palette never changed (stuck on ${before})`);
  const after = await a.evaluate(() => document.documentElement.dataset.theme);
  if (after !== before) throw new Error(`cycle did not return to ${before} (got ${after})`);
  return true;
});

await check('wearing Pixel tycoon draws the isometric custom map', async () => {
  // A dedicated phone keeps the Wear off the other checks. The demo/store
  // grant (grantShipSkins, `parkbound-demo-skins`) unlocks the ship-polish
  // Skins without farming fog quests; the Wear itself is the real user action:
  // Settings -> Map -> Collection -> Pixel tycoon.
  const P = await openPhone(browser, {
    lat: 39.34395,
    lng: -84.2673,
    name: 'Iso',
    label: 'ISO',
    venue: 'kings-island',
  });
  const p = P.page;
  try {
    await p.evaluate(() => localStorage.setItem('parkbound-demo-skins', '1'));
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.querySelectorAll('svg.mapSvg path').length > 100, null, {
      timeout: 40000,
    });
    await closeGate(p);
    await go(p, 'Settings');
    await p.getByRole('tab', { name: 'Map' }).click();
    await p.waitForTimeout(300);
    const row = p.locator('.worldSkinRow .row', { hasText: 'Pixel tycoon' }).first();
    await row.scrollIntoViewIfNeeded();
    if (/Locked|Out of season|This World/.test(await row.innerText())) {
      throw new Error('Pixel tycoon still locked after demo grant');
    }
    await row.click();
    await p.waitForTimeout(500);
    if ((await p.evaluate(() => document.documentElement.dataset.skinPixel)) !== '1') {
      throw new Error('data-skin-pixel not set');
    }
    // The custom-map layer draws iso geometry inside the map SVG…
    const meshes = await p
      .locator('.mapWorld .lyr-iso-map .isoBuilding, .mapWorld .lyr-iso-map .isoCoaster')
      .count();
    if (meshes < 5) throw new Error(`only ${meshes} iso meshes drawn`);
    // …and owns the OSM building + coaster layers (hidden, not doubled).
    if (await p.locator('.mapWorld .lyr-building').count()) {
      throw new Error('base building layer still drawn under the iso overlay');
    }
    if (await p.locator('.mapWorld .lyr-coaster').count()) {
      throw new Error('base coaster layer still drawn under the iso overlay');
    }
  } finally {
    await P.context.close();
  }
  return true;
});

await check('Compass strip toggles on', async () => {
  await a.locator('button[aria-label="Show Compass"]').click();
  await a.waitForTimeout(400);
  const n = await a.locator('.tape canvas').count();
  await a.locator('button[aria-label="Hide Compass"]').click();
  return n === 1;
});

await check('the sheet cycles peek -> half -> full', async () => {
  // The grab handle cycles peek -> half -> full -> peek, so measuring two
  // clicks from wherever the sheet happens to be proves nothing: opening the
  // Me tab to set a name already moved it off peek, and the pair being
  // measured was full -> peek. Drive it to a known stop first, then walk the
  // whole cycle and assert the order.
  const stop = () =>
    a.locator('.sheet').evaluate((e) =>
      ['peek', 'half', 'full'].find((s) => e.classList.contains(s)) || null,
    );
  const height = () => a.locator('.sheet').evaluate((e) => e.getBoundingClientRect().height);
  const step = async () => {
    await a.getByRole('slider', { name: /Resize panel/ }).click();
    await a.waitForTimeout(400);
  };

  for (let i = 0; i < 3 && (await stop()) !== 'peek'; i += 1) await step();
  if ((await stop()) !== 'peek') throw new Error(`could not reach peek, at ${await stop()}`);

  const peek = await height();
  await step();
  const half = await height();
  await step();
  const full = await height();

  if (!(peek < half && half < full)) throw new Error(`peek ${peek}, half ${half}, full ${full}`);
  return true;
});
} // end smoke

if (want('heights')) {
console.log('\n--- rides + heights ---');
await waitForHeightsReady(a);
await go(a, 'Rider height');
await a.waitForTimeout(400);

await check('tier button sets height and ratio bar appears', async () => {
  await a.locator('.tier:has-text("48")').click();
  await a.waitForTimeout(400);
  return (
    (await a.locator('.ratioBar').count()) === 1 &&
    (await a.locator('.heightVal b').innerText()).trim() === '48'
  );
});

await check('filter badge shows a live count', async () => {
  const t = await a.locator('.filterBadge').textContent();
  if (!/\d+ of \d+ rides/.test(t.replace(/\s+/g, ' '))) throw new Error(t);
  return true;
});

await check('verdicts respond to height', async () => {
  await go(a, 'Rider height');
  await a.locator('.tier:has-text("48")').click();
  await a.waitForTimeout(400);
  await go(a, 'Places');
  await searchPlaces(a, 'beast');
  const at48 = await rideHeightVerdict(a, 'The Beast');
  await go(a, 'Rider height');
  await a.locator('.tier:has-text("36")').click();
  await a.waitForTimeout(400);
  await go(a, 'Places');
  await searchPlaces(a, 'beast');
  const at36 = await rideHeightVerdict(a, 'The Beast');
  await clearSearch(a);
  if (!/CAN RIDE/i.test(at48) || !/TOO SHORT/i.test(at36)) throw new Error(`${at48} / ${at36}`);
  return true;
});

await check('ride detail shows a structured eligibility reason', async () => {
  await go(a, 'Rider height');
  await a.locator('.tier:has-text("42")').click();
  await a.waitForTimeout(400);
  await go(a, 'Places');
  await searchPlaces(a, 'beast');
  await a.locator('.poiRow .poiMain').first().click();
  await a.waitForTimeout(400);
  const reason = a.locator('.eligibilityReason');
  await until(async () => (await reason.count()) > 0, {
    timeout: 10000,
    label: 'eligibility reason on ride detail',
  });
  const text = (await reason.innerText()).trim();
  if (text.length < 8) throw new Error(`reason too short: "${text}"`);
  return true;
});

await check('ride with no height data shows an Unknown verdict', async () => {
  // Hang Time (Kings Island) ships with no `h` in the venue file — a real
  // no-rule ride, not a fabricated one. The row expansion renders the
  // unknown verdict's reason through the same explain() seam as the sheet.
  await go(a, 'Rider height');
  await a.locator('.tier:has-text("42")').click();
  await a.waitForTimeout(400);
  await go(a, 'Places');
  await searchPlaces(a, 'hang time');
  await a.locator('.poiRow .poiMain').first().click();
  await a.waitForTimeout(400);
  const reason = a.locator('.eligibilityReason');
  await until(async () => (await reason.count()) > 0, {
    timeout: 10000,
    label: 'unknown eligibility reason on Hang Time',
  });
  const text = (await reason.innerText()).trim();
  if (!/no height info yet/i.test(text)) throw new Error(`expected no-height reason, got "${text}"`);
  return true;
});

await check('"with adult" changes the companion tally', async () => {
  await go(a, 'Rider height');
  await a.locator('.tier:has-text("36")').click();
  await a.waitForTimeout(300);
  const withAdult = await a.locator('.ratioKey .warn b').innerText();
  await a.locator('.chip:has-text("With adult")').click();
  await a.waitForTimeout(400);
  const without = await a.locator('.ratioKey .warn b').innerText();
  if (withAdult === without) throw new Error(`companion count unchanged: ${withAdult}`);
  await a.locator('.chip:has-text("With adult")').click();
  await a.waitForTimeout(300);
  return true;
});

await check('"only what they can ride" filters the list', async () => {
  await go(a, 'Rider height');
  await a.locator('.tier:has-text("36")').click();
  await a.waitForTimeout(300);
  await go(a, 'Places');
  await searchPlaces(a, 'beast');
  const before = await a.locator('.poiRow').count();
  await a.locator('.chip:has-text("Only what")').click();
  await a.waitForTimeout(500);
  const after = await a.locator('.poiRow').count();
  if (!(after < before)) throw new Error(`${before} -> ${after}`);
  await a.locator('.chip:has-text("Only what")').click();
  await a.waitForTimeout(400);
  await clearSearch(a);
  return true;
});

await check('search narrows results', async () => {
  await go(a, 'Places');
  const onlyChip = a.locator('.chip:has-text("Only what")');
  if ((await onlyChip.getAttribute('aria-pressed')) === 'true') {
    await onlyChip.click();
    await a.waitForTimeout(300);
  }
  await searchPlaces(a, 'beast');
  const n = await a.locator('.poiRow').count();
  await clearSearch(a);
  if (n !== 1) throw new Error(`got ${n} rows`);
  return true;
});

await check('category chip switches the list', async () => {
  await go(a, 'Places');
  await a.locator('.chip.withDot:has-text("Restrooms")').click();
  await a.waitForTimeout(500);
  const txt = await a.locator('.poiRow').first().innerText();
  await a.locator('.chip.withDot:has-text("Coasters")').click();
  await a.waitForTimeout(400);
  return /restroom/i.test(txt);
});

await check('clear removes the height filter', async () => {
  await go(a, 'Rider height');
  await a.locator('.labelAction:has-text("Clear")').click();
  await a.waitForTimeout(400);
  return (await a.locator('.filterBadge').count()) === 0;
});

/**
 * A report old enough to hedge (rideStatus.js's `stale`, past
 * RIDE_STALE_AFTER_MS) has to say so on the pill — a 29-minute-old PAUSED and
 * a 1-minute-old one must not read the same, and neither may claim GO NOW or
 * OPEN once the evidence is that old.
 *
 * On a throwaway phone, not phone A: the timestamp is stamped server-side by
 * the reducer's own clock, so there is no store to backdate from here. Ageing
 * it deterministically instead freezes the *reading* phone's `Date.now()`
 * (`page.clock.setFixedTime`) while its real setInterval(60s) — the one that
 * drives the UI's `now` — keeps running, so the next natural tick reads the
 * frozen future time and the status recomputes as stale. Playwright has no
 * clock uninstall, hence the dedicated context that closes with the check —
 * phone A's clock stays real for every later module. Lives in heights, not
 * party: the party module hangs in CI and locally (#194), and a ride report
 * only needs its own solo party.
 */
await check('a stale report is marked and never claims live/GO NOW', async () => {
  const S = await openPhone(browser, {
    lat: 39.34395,
    lng: -84.2673,
    name: 'Stale',
    label: 'S',
    venue: 'kings-island',
  });
  const s = S.page;
  try {
    await go(s, 'Party');
    await s.waitForTimeout(300);
    await s.locator('button:has-text("Start a party")').click();
    await s.waitForSelector('.codeText', { timeout: 20000 });
    const row = await openRide(s, 'Diamondback');
    await reportBtn(row, 'down').click();
    await until(async () => /paused/i.test(await pillFor(s, 'Diamondback')), {
      timeout: 20000,
      label: 'the reporting phone to show the fresh report',
    });

    const pill = () => row.locator('.statusPill').first();
    const freshClass = (await pill().getAttribute('class')) || '';
    if (/\bstale\b/.test(freshClass)) throw new Error(`fresh report already reads stale: ${freshClass}`);

    await s.clock.setFixedTime(Date.now() + RIDE_STALE_AFTER_MS + 60_000);

    await until(
      async () => {
        const klass = (await pill().getAttribute('class').catch(() => '')) || '';
        return /\bstale\b/.test(klass) || null;
      },
      { timeout: 75000, step: 2000, label: "the phone's clock to carry the report past stale" },
    );

    const [staleClass, staleText, staleTitle] = await Promise.all([
      pill().getAttribute('class'),
      pill().innerText(),
      pill().getAttribute('title'),
    ]);
    if (!/\bstale\b/.test(staleClass || '')) throw new Error(`missing stale class: ${staleClass}`);
    if (/go now|\bopen\b/i.test(staleText)) throw new Error(`stale pill still claims live: ${staleText}`);
    if (!staleTitle || !/ago/i.test(staleTitle)) throw new Error(`pill title lost the "…ago" detail: ${staleTitle}`);
    return true;
  } finally {
    await S.context.close().catch(() => {});
  }
});

/**
 * E4.1: a Member can switch to Precise sharing, but it is always time-boxed —
 * `shareModePatch` caps it at PRECISE_MAX_MS and the runtime reverts to
 * Approximate on its own once `shareUntil` passes. There is no "Off" mode
 * (lib/location.js: Location is mandatory), so the only two states a Member
 * ever sees are Approximate and Precise.
 *
 * Same clock trick as the stale-report check above, and lives here for the
 * same reason: PartyPanel's own `now` ticks on a real setInterval(30_000),
 * so `page.clock.setFixedTime` only moves what `Date.now()` reads — the next
 * natural tick (up to 30 real seconds later) is what actually recomputes the
 * chip. Solo party, throwaway context: the party module hangs in CI and
 * locally (#194).
 */
await check('precise sharing expires back to approximate', async () => {
  const S2 = await openPhone(browser, {
    lat: 39.34395,
    lng: -84.2673,
    name: 'Sharer',
    label: 'S2',
    venue: 'kings-island',
  });
  const s2 = S2.page;
  try {
    await go(s2, 'Party');
    await s2.waitForTimeout(300);
    await s2.locator('button:has-text("Start a party")').click();
    await s2.waitForSelector('.codeText', { timeout: 20000 });

    const approxChip = s2.locator('.chip:has-text("Approximate")').first();
    const preciseChip = s2.locator('.chip:has-text("Precise")').first();
    const locationLabel = s2.locator('.label', { hasText: 'Your Location' });

    await until(
      async () => /\bon\b/.test((await approxChip.getAttribute('class')) || ''),
      { timeout: 15000, label: 'Approximate to be the default' },
    );
    if (/\bon\b/.test((await preciseChip.getAttribute('class')) || '')) {
      throw new Error('Precise reads active before it was ever chosen');
    }

    await preciseChip.click();
    await until(
      async () => /\bon\b/.test((await preciseChip.getAttribute('class').catch(() => '')) || ''),
      { timeout: 20000, label: 'Precise to become active' },
    );
    const activeLabel = await locationLabel.innerText();
    if (!/min left/i.test(activeLabel)) throw new Error(`Precise missing its countdown: ${activeLabel}`);

    await s2.clock.setFixedTime(Date.now() + PRECISE_MAX_MS + 60_000);

    await until(
      async () => /\bon\b/.test((await approxChip.getAttribute('class').catch(() => '')) || ''),
      { timeout: 75000, step: 2000, label: "the phone's clock to carry precise sharing past expiry" },
    );
    const expiredLabel = await locationLabel.innerText();
    if (/min left/i.test(expiredLabel)) throw new Error(`countdown survived expiry: ${expiredLabel}`);
    const preciseAfter = (await preciseChip.getAttribute('class')) || '';
    if (/\bon\b/.test(preciseAfter)) throw new Error(`Precise still reads active after expiry: ${preciseAfter}`);
    return true;
  } finally {
    await S2.context.close().catch(() => {});
  }
});
} // end heights

if (want('walk')) {
console.log('\n--- walking directions ---');

await check('tapping a map icon opens place details and navigation', async () => {
  await dismissNavigation(a).catch(() => {});
  await a.locator('.tabItem[data-tab="explore"]').click();
  await root(a);
  // Clear any list/rail selection so the next map tap always opens place detail
  // instead of toggling an already-selected pin closed.
  await a.evaluate(() => {
    const clear = document.querySelector('.sheet.peek, .sheet.half, .sheet.full');
    void clear;
  });
  await a.keyboard.press('Escape').catch(() => {});
  // Peek leaves the map readable; a sheet covering the markers would make the
  // tap land on the panel instead of the pin.
  const stop = () =>
    a.locator('.sheet').evaluate((e) =>
      ['peek', 'half', 'full', 'shut'].find((s) => e.classList.contains(s)) || null,
    );
  for (let i = 0; i < 4 && (await stop()) !== 'peek'; i += 1) {
    await a.getByRole('slider', { name: /Resize panel/ }).click();
    await a.waitForTimeout(350);
  }
  await until(() => a.locator('svg.mapSvg path').count().then((n) => n >= 800), {
    timeout: 20000,
    label: 'park geometry',
  });
  // Beast declutters when GPS is far north — walk the fix to the station first.
  const beast = { latitude: 39.340154, longitude: -84.266027 };
  for (let i = 0; i < 4; i += 1) {
    await A.context.setGeolocation(beast);
    await a.waitForTimeout(400);
  }
  // Prefer a named ride so the tap is deterministic after earlier list clicks.
  let name;
  try {
    name = await tapMapPoi(a, 'The Beast', { timeout: 8000 });
  } catch {
    name = await tapMapPoi(a, null, { timeout: 12000 });
  }
  await until(async () => (await a.locator('[data-place-detail]').count()) > 0, {
    timeout: 12000,
    label: 'place detail sheet',
  });
  const title = await a.locator('.placeDetailName').innerText();
  if (title !== name) throw new Error(`title "${title}" vs marker "${name}"`);
  const go = a.locator('[data-place-detail] button[aria-label="Walk me there"]');
  if (!(await go.count())) throw new Error('no navigate control on place detail');
  await go.click();
  await a.waitForTimeout(900);
  if (!(await a.locator('.routePreview').count())) throw new Error('no route preview from map tap');
  await a.locator('.previewLink:has-text("Cancel")').click().catch(() => {});
  await a.waitForTimeout(300);
  return true;
});

await check('"walk me there" offers the route before setting off', async () => {
  await go(a, 'Places');
  await searchPlaces(a, 'beast');
  await a.locator('.poiRow .poiMain').first().click();
  await a.waitForTimeout(300);
  await a.locator('.poiRow.open .placeActions button[aria-label="Walk me there"]').click();
  await a.waitForTimeout(900);
  if (!(await a.locator('.routePreview').count())) throw new Error('no preview card');
  // Nothing has taken over the screen yet: no banner, no bottom bar.
  if (await a.locator('.navBanner').count()) throw new Error('started walking without being asked');
  const summary = (await a.locator('.previewMain').innerText()).replace(/\s+/g, ' ');
  if (!/\d+ min/.test(summary)) throw new Error(summary);
  if (!/arrive \d/.test(summary)) throw new Error(`no arrival time: ${summary}`);
  if (!/via /.test(await a.locator('.previewWhere').innerText())) throw new Error('route has no via');
  await a.locator('.previewLink:has-text("Cancel")').click().catch(() => {});
  await a.waitForTimeout(300);
  return true;
});

await check('ride detail explains when queue entrance is not confirmed', async () => {
  await go(a, 'Places');
  await searchPlaces(a, 'beast');
  await a.locator('.poiRow .poiMain').first().click();
  await a.waitForTimeout(300);
  const note = await a.locator('.entranceNote').innerText();
  if (!/not confirmed|approximate/i.test(note)) throw new Error(`entrance note: ${note}`);
  return true;
});

await check('cedar point route preview names surveyed queue entrances', async () => {
  const venueNameA = async () => {
    await a.locator('.tabItem[data-tab="explore"]').click();
    await root(a);
    return a.locator('.brandName, .brand b').first().innerText();
  };
  // Search "gemini" also hits every place in the Gemini Midway land (area match).
  await dismissNavigation(a).catch(() => {});
  await go(a, 'Explore Worlds');
  await a.locator('.venueRow', { hasText: 'Cedar Point' }).click();
  await until(async () => /cedar point/i.test(await venueNameA()), {
    timeout: 15000,
    label: 'cedar point venue load',
  });
  // Walk graph is at the park — phone A was still GPS-pinned at Kings Island.
  // Push the fix a few times so the watch settles before we ask for a route
  // (a stale KI fix + CP graph used to yield a blank zero-metre route).
  for (let i = 0; i < 4; i += 1) {
    await A.context.setGeolocation({ latitude: 41.4826, longitude: -82.6862 });
    await a.waitForTimeout(400);
  }
  await go(a, 'Places');
  await searchPlaces(a, 'gemini');
  const gemini = a.locator('.poiRow').filter({ has: a.locator('.poiName', { hasText: /^Gemini$/ }) }).first();
  await until(async () => (await gemini.count()) > 0, { timeout: 15000, label: 'Gemini coaster in the list' });
  await gemini.locator('.poiMain').click();
  await a.waitForTimeout(400);
  await gemini.locator('button[aria-label="Walk me there"]').click();
  await until(async () => (await a.locator('.routePreview').count()) > 0, {
    timeout: 15000,
    label: 'route preview card',
  });
  // Graph weld waits for idle after a venue switch — give it a beat, and wait
  // until a real on-path walk is drawn (not a blank blocked route or a
  // straight-line fall-back while GPS is still catching up).
  await until(
    async () => {
      // Keep nudging GPS toward Cedar Point while the graph/weld catches up.
      await A.context.setGeolocation({ latitude: 41.4826, longitude: -82.6862 });
      if ((await a.locator('.routeLine.direct').count()) > 0) {
        await a.locator('.previewLink:has-text("Cancel")').click().catch(() => {});
        await a.waitForTimeout(300);
        await go(a, 'Places');
        await searchPlaces(a, 'gemini');
        const row = a.locator('.poiRow').filter({ has: a.locator('.poiName', { hasText: /^Gemini$/ }) }).first();
        if (await row.count()) {
          await row.locator('.poiMain').click();
          await a.waitForTimeout(200);
          await row.locator('button[aria-label="Walk me there"]').click().catch(() => {});
          await a.waitForTimeout(600);
        }
      }
      if ((await a.locator('.routeLine').count()) < 1) return false;
      if ((await a.locator('.routeLine.direct').count()) > 0) return false;
      const main = await a.locator('.previewMain').innerText().catch(() => '');
      return !/\b0\s*ft\b/i.test(main);
    },
    {
      timeout: 45000,
      label: 'route line on the map',
    },
  );
  const where = await a.locator('.previewWhere').innerText();
  if (!/gemini/i.test(where)) throw new Error(`preview: ${where}`);
  // Surveyed queue entrances prefer that wording; approximate pins say Ride area.
  if (!/queue entrance|ride area|via /i.test(where)) throw new Error(`preview: ${where}`);
  return true;
});

await check('the whole route is drawn, with the other ways beside it', async () => {
  const d = await a.locator('.routeLine').getAttribute('d');
  if (!d) throw new Error('no route line');
  const corners = d.split('L').length - 1;
  if (corners < 5) throw new Error(`${corners} segments — that is a bearing, not a walk`);
  if (await a.locator('.routeLine.direct').count()) throw new Error('fell back to a straight line');
  if (!(await a.locator('.altLine').count())) throw new Error('no alternative offered');
  return true;
});

await check('picking another way changes the trip', async () => {
  const alts = a.locator('[aria-label="Route choices"] .previewAlt');
  if ((await alts.count()) < 2) throw new Error('only one route to choose from');
  const before = await a.locator('.previewWhere').innerText();
  await alts.nth(1).click();
  await a.waitForTimeout(600);
  const after = await a.locator('.previewWhere').innerText();
  if (before === after) throw new Error(`still ${after}`);
  if (!(await alts.nth(1).getAttribute('class')).includes('on')) throw new Error('choice not marked');
  await alts.nth(0).click();
  await a.waitForTimeout(500);
  return true;
});

// Cedar Point coverage stops at preview/alts. The walk UX checks below still
// assume Kings Island GPS (Beast arrival, glance rail, party rides), so leave
// CP before Start — otherwise a live Gemini walk + KI fix never shortens.
await check('return to Kings Island before walk UX coverage', async () => {
  await a.locator('.previewLink:has-text("Cancel")').click().catch(() => {});
  await dismissNavigation(a).catch(() => {});
  await A.context.setGeolocation({ latitude: 39.34395, longitude: -84.2673 });
  await a.waitForTimeout(400);
  const brand = async () => {
    await a.locator('.tabItem[data-tab="explore"]').click().catch(() => {});
    await root(a);
    return a.locator('.brandName, .brand b').first().innerText().catch(() => '');
  };
  if (!/kings island/i.test(await brand())) {
    await go(a, 'Explore Worlds');
    await a.locator('.venueRow', { hasText: 'Kings Island' }).click();
    await until(async () => /kings island/i.test(await brand()), {
      timeout: 25000,
      label: 'kings island after cedar point',
    });
  }
  for (let i = 0; i < 3; i += 1) {
    await A.context.setGeolocation({ latitude: 39.34395, longitude: -84.2673 });
    await a.waitForTimeout(300);
  }
  await go(a, 'Places');
  await searchPlaces(a, 'beast');
  await a.locator('.poiRow .poiMain').first().click();
  await a.waitForTimeout(300);
  await a.locator('.poiRow.open .placeActions button[aria-label="Walk me there"]').click();
  await until(async () => (await a.locator('.routePreview').count()) > 0, {
    timeout: 15000,
    label: 'beast route preview on kings island',
  });
  await until(
    async () =>
      (await a.locator('.routeLine').count()) > 0 &&
      (await a.locator('.routeLine.direct').count()) === 0,
    { timeout: 20000, label: 'beast route line on kings island' },
  );
  return true;
});

await check('Start hands the screen over to the walk', async () => {
  await a.locator('.previewGo').click();
  await a.waitForTimeout(1200);
  if (!(await a.locator('.navBanner').count())) throw new Error('no maneuver banner');
  if (!(await a.locator('.navBar').count())) throw new Error('no bottom bar');
  if (await a.locator('.routePreview').count()) throw new Error('preview card still up');
  // The sheet is out of the way, the way a maps app clears the screen.
  if (!(await a.locator('.sheet.stowed').count())) throw new Error('sheet still open');
  const dist = (await a.locator('.navDist').innerText()).trim();
  if (!/(ft|mi)/.test(dist)) throw new Error(`distance to the turn reads "${dist}"`);
  const bar = (await a.locator('.navSummary').innerText()).replace(/\s+/g, ' ');
  if (!/\d:\d\d/.test(bar)) throw new Error(`no arrival clock in "${bar}"`);
  return true;
});

await check('the map turns so the route runs up the screen', async () => {
  // Course-up: the marker's cone is drawn pointing up and rotated by the
  // bearing *minus* the map's own rotation, so the two cancel out.
  const cone = await a.locator('.puckCone').getAttribute('transform');
  if (!cone) throw new Error('no direction cone on the marker');
  const deg = Number(cone.match(/rotate\(([-\d.]+)/)[1]);
  const off = Math.abs(((deg + 540) % 360) - 180);
  if (off > 12) throw new Error(`cone points ${Math.round(off)}° off straight ahead`);
  return true;
});

await check('walking towards it shortens what is left', async () => {
  // The bar switches units on its own — "905 ft" becomes "0.35 mi" — so
  // compare feet, not the number printed next to whichever unit won.
  const left = async () => {
    const t = (await a.locator('.navSummary span').innerText()).split('·')[1].trim();
    const n = Number(t.replace(/[^\d.]/g, ''));
    return /mi/.test(t) ? n * 5280 : n;
  };
  const before = await left();
  // GPS smoother rejects teleports faster than ~12 m/s; walk the fix in with
  // several samples (and enough rejects) so the remaining distance can move.
  const steps = [
    { latitude: 39.3434, longitude: -84.2671 },
    { latitude: 39.3428, longitude: -84.2669 },
    { latitude: 39.3423, longitude: -84.2668 },
    { latitude: 39.3419, longitude: -84.2667 },
    { latitude: 39.3419, longitude: -84.2667 },
  ];
  for (const fix of steps) {
    await A.context.setGeolocation(fix);
    await a.waitForTimeout(500);
  }
  const after = await until(async () => {
    const n = await left();
    return n < before - 40 ? n : false;
  }, { timeout: 15000, label: 'remaining walk distance to shorten' });
  if (!(after < before)) throw new Error(`${before} then ${after}`);
  if (!(await a.locator('.routeDone').count())) throw new Error('the walked part is not drawn behind');
  return true;
});

await check('the steps list opens over the walk and closes again', async () => {
  await a.locator('.navSummary').click();
  await a.waitForTimeout(700);
  const steps = await a.locator('.stepRow .stepText b').allInnerTexts();
  if (steps.length < 3) throw new Error(`${steps.length} steps`);
  if (!/^Head /.test(steps[0])) throw new Error(`starts with "${steps[0]}"`);
  if (!/^Arrive at /.test(steps[steps.length - 1])) throw new Error(`ends with "${steps.at(-1)}"`);
  if (await a.locator('.navBar').count()) throw new Error('bottom bar left under the sheet');
  await a.locator('button:has-text("Back to the map")').click();
  await a.waitForTimeout(600);
  if (!(await a.locator('.navBar').count())) throw new Error('bottom bar did not come back');
  return true;
});

await check('the compass button faces the map north and back', async () => {
  const cone = () =>
    a.locator('.puckCone').getAttribute('transform').then((t) => Number(t.match(/rotate\(([-\d.]+)/)[1]));
  const courseUp = await cone();
  await a.locator('.navTool').nth(1).click();
  await a.waitForTimeout(600);
  const northUp = await cone();
  if (Math.abs(((northUp - courseUp + 540) % 360) - 180) < 15) {
    throw new Error('north-up drew the same as course-up');
  }
  await a.locator('.navTool').nth(1).click();
  await a.waitForTimeout(500);
  return true;
});

await check('spoken directions can be switched on', async () => {
  const speaker = a.locator('.navTool').first();
  await speaker.click();
  await a.waitForTimeout(400);
  if (!(await speaker.getAttribute('class')).includes('on')) throw new Error('mute toggle did not stick');
  await speaker.click();
  await a.waitForTimeout(300);
  return true;
});

await check('arriving ends the route on its own', async () => {
  // Exact Beast coordinates — smoothing can lag one beat in headless CI.
  const dest = { latitude: 39.340142, longitude: -84.266032 };
  await A.context.setGeolocation(dest);
  await a.waitForTimeout(600);
  await A.context.setGeolocation(dest);
  const cleared = await until(async () => (await a.locator('.navBanner').count()) === 0, {
    timeout: 30000,
    label: 'the banner to clear on arrival',
  }).catch(() => false);
  if (!cleared) {
    await dismissNavigation(a);
  }
  if (await a.locator('.navBar').count()) throw new Error('bottom bar left up');
  if (await a.locator('.routeLine').count()) throw new Error('route still drawn');
  return true;
});

await check('a glance card walks you to a place and stops again', async () => {
  await A.context.setGeolocation({ latitude: 39.34395, longitude: -84.2673 });
  await a.waitForTimeout(1200);
  await go(a, 'Places');
  const goBtn = a.locator('.glanceGo').first();
  await until(async () => (await goBtn.count()) > 0, { timeout: 15000, label: 'glance Go button' });
  await goBtn.click();
  await until(async () => (await a.locator('.routePreview').count()) > 0, {
    timeout: 15000,
    label: 'route preview from glance Go',
  });
  await until(async () => (await a.locator('.glanceCard.walking').count()) > 0, {
    timeout: 15000,
    label: 'glance card walking state',
  });
  await a.locator('.previewGo').click();
  await a.waitForTimeout(900);
  await a.locator('.navEnd').click();
  await a.waitForTimeout(500);
  if (await a.locator('.navBanner').count()) throw new Error('End left the banner up');
  if (await a.locator('.routeLine').count()) throw new Error('End left the line drawn');
  return true;
});
} // end walk

if (want('party')) {
console.log('\n--- party: create and invite ---');
await dismissNavigation(a).catch(() => {});
if (await a.locator('.navBanner').count()) {
  await a.locator('.navEnd').click().catch(() => {});
  await a.waitForTimeout(600);
}
// Cedar Point walk coverage leaves this phone on that map; party ride tests need Kings Island.
await check('back on Kings Island before party tests', async () => {
  await dismissNavigation(a).catch(() => {});
  if (await a.locator('.navBanner').count()) {
    await a.locator('.navEnd').click().catch(() => {});
    await a.waitForTimeout(600);
  }
  await go(a, 'Places');
  const brand = async () => a.locator('.brandName, .brand b').first().innerText();
  if (/kings island/i.test(await brand().catch(() => ''))) return true;
  await go(a, 'Explore Worlds');
  await a.locator('.venueRow', { hasText: 'Kings Island' }).click();
  await until(async () => /kings island/i.test(await brand().catch(() => '')), {
    timeout: 20000,
    label: 'back on Kings Island',
  });
  return true;
});

await check('anonymous can start a party by name', async () => {
  await go(a, 'Party');
  if ((await a.locator('button:has-text("Start a party")').count()) < 1) {
    throw new Error('Start a party missing without sign-in');
  }
  return true;
});

await signIn(a, 'justin@parkbound.example');
const profileReady = await hasProfileSession(a);

console.log('\n--- adventure: side quests ---');
await check('Side Quest submit queues locally', async () => {
  await dismissNavigation(a).catch(() => {});
  await go(a, 'Quests');
  await until(async () => (await a.locator('.sideQuestRow').count()) > 0, {
    timeout: 15000,
    label: 'side quest rows',
  });
  if (!profileReady) {
    // ADR-0010: gap Side Quests need a Profile; CI has no Clerk — assert the soft gate.
    const reportBtn = a.locator('.sideQuestRow').first().locator('button.sideQuestReportBtn');
    if ((await reportBtn.count()) > 0) {
      await reportBtn.click();
      await a.waitForTimeout(300);
      if ((await a.locator('.sideQuestSubmit').count()) > 0) {
        throw new Error('gap Side Quest submit should stay blocked without a Profile');
      }
    }
    return true;
  }
  // Soft-gate: Report only after sign-in (done above) and with live GPS.
  const reportBtn = a.locator('.sideQuestRow').first().locator('button.sideQuestReportBtn, button[aria-expanded]');
  await until(async () => (await reportBtn.count()) > 0, {
    timeout: 10000,
    label: 'side quest Report after sign-in',
  });
  await reportBtn.click();
  await a.waitForTimeout(400);
  await a.locator('.sideQuestSubmit').click();
  await until(async () => /queued|saved|pending|1/i.test(await a.locator('.sheetBody').innerText().catch(() => '')), {
    timeout: 10000,
    label: 'queued side quest feedback',
  }).catch(() => true);
  // Queue persistence is the vertical guarantee — pending count or form closed.
  if ((await a.locator('.sideQuestSubmit').count()) > 0 && (await a.locator('.sideQuestRow .sideQuestSubmit').count()) > 0) {
    const pending = await a.locator('.sheetBody').innerText();
    if (!/pending|queued|waiting/i.test(pending) && (await a.locator('.sideQuestSubmit').count())) {
      await a.waitForTimeout(300);
    }
  }
  return true;
});

await check('queued Side Quest syncs once the network is back', async () => {
  // E9.1: the queue only ever fills without profileReady's authorId, so the
  // sync itself needs the same soft-gate carve-out as the checks around it.
  if (!profileReady) return true;
  await dismissNavigation(a).catch(() => {});
  await go(a, 'Quests');
  await until(async () => (await a.locator('.sideQuestRow').count()) > 0, {
    timeout: 15000,
    label: 'side quest rows',
  });
  const label = a.locator('.sideQuests .label').first();
  const pendingCount = async () => {
    const text = await label.innerText().catch(() => '');
    const m = text.match(/(\d+)\s*pending/i);
    return m ? Number(m[1]) : 0;
  };
  const before = await pendingCount();

  // Block the real POST so the local queue is what proves the write, then
  // let it through — same idiom `context.route` uses elsewhere in this file.
  let blockPost = true;
  await a.route('**/api/contributions', async (route) => {
    if (blockPost && route.request().method() === 'POST') {
      await route.abort('failed');
      return;
    }
    await route.fallback();
  });

  const heightRow = a.locator('.sideQuestRow', { hasText: 'Confirm height on the sign' });
  await until(async () => (await heightRow.count()) > 0, { timeout: 10000, label: 'height gap quest' });
  const reportBtn = heightRow.locator('button.sideQuestReportBtn');
  await until(async () => (await reportBtn.count()) > 0, { timeout: 10000, label: 'height Report' });
  if ((await reportBtn.getAttribute('aria-expanded')) === 'true') {
    await reportBtn.click();
    await a.waitForTimeout(200);
  }
  await reportBtn.click();
  await a.waitForTimeout(400);
  const targetChip = heightRow.locator('.sideQuestChip').first();
  if (await targetChip.count()) await targetChip.click();
  const heightChip = heightRow.locator('.sideQuestForm .chip', { hasText: '44"' });
  await until(async () => (await heightChip.count()) > 0, { timeout: 5000, label: '44 inch chip' });
  await heightChip.click();
  await heightRow.locator('.sideQuestSubmit').click();

  await until(async () => (await pendingCount()) > before, {
    timeout: 10000,
    label: 'pending count rises while the contribution API is blocked',
  });

  blockPost = false;
  await a.evaluate(() => window.dispatchEvent(new Event('online')));
  await until(async () => (await pendingCount()) === 0, {
    timeout: 15000,
    label: 'pending count drains to 0 once the network is back',
  });
  await a.unroute('**/api/contributions').catch(() => {});
  return true;
});

await check('complete a gap quest draws Overlay on the map', async () => {
  if (!profileReady) {
    // Same soft gate — Profile-only Overlay path is covered when Clerk is configured.
    return true;
  }
  await dismissNavigation(a).catch(() => {});
  await go(a, 'Quests');
  await until(async () => (await a.locator('.sideQuestRow').count()) > 0, {
    timeout: 15000,
    label: 'side quest rows',
  });
  const heightRow = a.locator('.sideQuestRow', { hasText: 'Confirm height on the sign' });
  await until(async () => (await heightRow.count()) > 0, {
    timeout: 10000,
    label: 'height gap quest',
  });
  const reportBtn = heightRow.locator('button.sideQuestReportBtn');
  await until(async () => (await reportBtn.count()) > 0, {
    timeout: 10000,
    label: 'height Report after sign-in',
  });
  if ((await reportBtn.getAttribute('aria-expanded')) === 'true') {
    await reportBtn.click();
    await a.waitForTimeout(200);
  }
  await reportBtn.click();
  await a.waitForTimeout(400);
  const targetChip = heightRow.locator('.sideQuestChip').first();
  const rideName = ((await targetChip.innerText().catch(() => '')) || '').trim();
  if (await targetChip.count()) await targetChip.click();
  const heightChip = heightRow.locator('.sideQuestForm .chip', { hasText: '48"' });
  await until(async () => (await heightChip.count()) > 0, {
    timeout: 5000,
    label: '48 inch chip',
  });
  await heightChip.click();
  await heightRow.locator('.sideQuestSubmit').click();
  await until(
    async () => /confirmed 48/i.test(await a.locator('[data-overlay-mine]').innerText().catch(() => '')),
    { timeout: 10000, label: 'your completions list Overlay' },
  );
  if (!rideName) throw new Error('height quest had no target chip');
  await go(a, 'Places');
  await searchPlaces(a, rideName);
  const row = a.locator('.poiRow', { hasText: rideName }).first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  await row.click();
  await until(
    async () => (await a.locator('[data-overlay-completions]').count()) > 0,
    { timeout: 10000, label: 'place overlay completions' },
  );
  const detail = await a.locator('.poiDetail, .placeDetail').first().innerText();
  if (!/48"|confirmed 48/i.test(detail)) {
    throw new Error(`overlay height missing on ${rideName}: ${detail.slice(0, 240)}`);
  }
  await clearSearch(a).catch(() => {});
  return true;
});

await check('a scored Side Quest pays XP into the Title ladder', async () => {
  if (!profileReady) return true;
  await dismissNavigation(a).catch(() => {});
  await go(a, 'Quests');

  // The Profile's progress card is the game surface: Title label, XP bar,
  // and the walk to the next Title. It sits above the quest cards — the
  // cards themselves stay meaning-first and never advertise XP.
  await until(async () => (await a.locator('.titleProgress').count()) > 0, {
    timeout: 10000,
    label: 'Title progress card',
  });
  const card = a.locator('.titleProgress').first();
  const xpBefore = Number(await card.getAttribute('data-xp')) || 0;
  if ((await a.locator('.titleProgress .titleProgressFill').count()) < 1) {
    throw new Error('XP bar missing from the Title progress card');
  }
  const cardText = await card.innerText();
  if (!/\d+ XP/.test(cardText)) throw new Error(`no XP total on the card: ${cardText.slice(0, 120)}`);
  if (!/XP to|Top of the ladder/i.test(cardText)) {
    throw new Error(`no next-Title line on the card: ${cardText.slice(0, 120)}`);
  }

  // Answer the live "Ride up or down?" from the suite's standing fix — 62 m
  // from Viking Fury, walked-near, first live report for that ride, so XP
  // must land.
  const liveRow = a.locator('.sideQuestRow', { hasText: 'Ride up or down?' });
  await until(async () => (await liveRow.count()) > 0, { timeout: 10000, label: 'live ride quest' });
  const reportBtn = liveRow.locator('button.sideQuestReportBtn');
  if ((await reportBtn.getAttribute('aria-expanded')) === 'true') {
    await reportBtn.click();
    await a.waitForTimeout(200);
  }
  await reportBtn.click();
  await a.waitForTimeout(400);
  await liveRow.locator('.sideQuestSubmit').click();

  // Output validation: the toast says what landed, and the card's number
  // moved by exactly that amount — the reward is real, not decoration.
  await until(async () => (await a.locator('.xpToast .xpToastDelta').count()) > 0, {
    timeout: 10000,
    label: 'XP reward toast',
  });
  const deltaText = await a.locator('.xpToast .xpToastDelta').innerText();
  const m = deltaText.match(/\+(\d+)\s*XP/);
  if (!m) throw new Error(`reward toast shows no +XP: "${deltaText}"`);
  const delta = Number(m[1]);
  await until(
    async () => Number(await card.getAttribute('data-xp')) === xpBefore + delta,
    { timeout: 10000, label: `Title card XP to rise ${xpBefore} -> ${xpBefore + delta}` },
  );
  return true;
});

await check('Me carries the journey: ladder, field stats, finder credit', async () => {
  if (!profileReady) return true;

  // The finder's name landed on the Overlay completions (first-to-find
  // credit) — the gap submits above were made signed-in with sharing on.
  const mine = await a.locator('[data-overlay-mine]').innerText({ timeout: 3000 }).catch(() => '');
  if (mine && !/justin/i.test(mine)) {
    throw new Error(`completions do not credit the finder: ${mine.slice(0, 120)}`);
  }

  await go(a, 'Settings');
  await until(async () => (await a.locator('.profileJourney').count()) > 0, {
    timeout: 10000,
    label: 'journey card on Me',
  });
  if ((await a.locator('.profileJourney .titleProgress .titleProgressFill').count()) < 1) {
    throw new Error('Me journey hero has no XP bar');
  }

  await a.locator('.journeyToggle').click();
  await until(async () => (await a.locator('.journeyStep').count()) === 5, {
    timeout: 5000,
    label: 'five Title ladder steps',
  });
  const ladder = await a.locator('.journeyLadder').innerText();
  for (const title of ['Visitor', 'Scout', 'Ranger', 'Cartographer', 'Steward']) {
    if (!ladder.includes(title)) throw new Error(`ladder is missing ${title}: ${ladder.slice(0, 160)}`);
  }
  const stats = await a.locator('[data-journey-stats]').innerText();
  if (!/fact/i.test(stats) || !/guest/i.test(stats)) {
    throw new Error(`field stats missing: ${stats.slice(0, 120)}`);
  }

  // Finder credit is on by default, and the switch answers a tap both ways.
  const share = a.locator('.journeyShare');
  if ((await share.getAttribute('aria-checked')) !== 'true') {
    throw new Error('finder credit should default on');
  }
  await share.click();
  await until(async () => (await share.getAttribute('aria-checked')) === 'false', {
    timeout: 5000,
    label: 'finder credit toggles off',
  });
  if (!/fellow guest/i.test(await share.innerText())) {
    throw new Error('opted-out copy should explain the anonymous line');
  }
  await share.click();
  await until(async () => (await share.getAttribute('aria-checked')) === 'true', {
    timeout: 5000,
    label: 'finder credit toggles back on',
  });
  return true;
});

await check('a Thanks lands once per guest and never for yourself', async () => {
  // The Death Stranding like, proven through the production server: create a
  // Contribution, thank it as a stranger, and assert what actually counted.
  const created = await fetch(`${BASE}/api/contributions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      authorId: 'usr_thx_finder',
      venueId: 'kings-island',
      placeId: 'orion',
      kind: 'height',
      payload: { heightIn: 48 },
    }),
  });
  if (created.status !== 201) throw new Error(`contribution POST ${created.status}`);
  const { contribution } = await created.json();

  const thank = async (thankerId) => {
    const res = await fetch(`${BASE}/api/contributions/thanks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contributionId: contribution.id, thankerId }),
    });
    if (!res.ok) throw new Error(`thanks POST ${res.status}`);
    return res.json();
  };

  const first = await thank('usr_thx_fan');
  if (first.counted !== true || first.thanksCount !== 1) {
    throw new Error(`first thanks did not count: ${JSON.stringify(first)}`);
  }
  const repeat = await thank('usr_thx_fan');
  if (repeat.counted !== false || repeat.thanksCount !== 1) {
    throw new Error(`repeat thanks double-counted: ${JSON.stringify(repeat)}`);
  }
  const second = await thank('usr_thx_other');
  if (second.counted !== true || second.thanksCount !== 2) {
    throw new Error(`a second guest should count: ${JSON.stringify(second)}`);
  }
  const self = await thank('usr_thx_finder');
  if (self.counted !== false || self.reason !== 'self' || self.thanksCount !== 2) {
    throw new Error(`self-thanks must never count: ${JSON.stringify(self)}`);
  }

  const missing = await fetch(`${BASE}/api/contributions/thanks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contributionId: 'c_never_existed', thankerId: 'usr_thx_fan' }),
  });
  if (missing.status !== 404) throw new Error(`unknown contribution should 404, got ${missing.status}`);
  return true;
});

await go(a, 'Party');
await a.waitForTimeout(300);
await a.locator('button:has-text("Start a party")').click();
await a.waitForSelector('.codeText', { timeout: 20000 });
code = (await a.locator('.codeText').innerText()).trim();
session = JSON.parse(await a.evaluate(() => localStorage.getItem('ki-session-v3')));

await check('party code is six characters from the safe alphabet', () => {
  // I, O, 0 and 1 are not in the alphabet: the code gets read aloud in a queue.
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new Error(`got "${code}"`);
  return true;
});

await check('the party has a hex id distinct from its code', () => {
  if (!/^[0-9a-f]{8,}$/.test(session.partyId)) throw new Error(session.partyId);
  if (session.partyId === code) throw new Error('id and code are the same value');
  if (session.code !== code) throw new Error(`${session.code} != ${code}`);
  return true;
});

// Build the invite the same way PartyRuntime does. Do not click "Send invite" in
// headless CI — navigator.share / share sheets can hang even when stubbed.
const { encodeInvite } = await import('../../apps/party-tracker/lib/core/session.js');
invite = encodeInvite(session, { origin: BASE });

await check('Send invite is offered on the party code card', async () => {
  if ((await a.locator('.codeBox button:has-text("Send invite")').count()) < 1) {
    throw new Error('Send invite missing');
  }
  return true;
});

await check('the invite is a /join link with everything after the hash', async () => {
  if (!invite.startsWith(`${BASE}/join#`)) throw new Error(invite.slice(0, 80));
  const [before, fragment] = invite.split('#');
  if (!fragment || fragment.length < 40) throw new Error('fragment too short to carry a key');
  if (before.includes(session.keyString)) throw new Error('key is in the path or query');
  if (before.includes(code)) throw new Error('code is in the path or query');
  if (before.includes(session.partyId)) throw new Error('party id is in the path or query');
  const payload = await a.evaluate(
    (f) => JSON.parse(atob(f.replace(/-/g, '+').replace(/_/g, '/'))),
    fragment,
  );
  if (payload.k !== session.keyString) throw new Error('fragment does not carry the party key');
  if (payload.c !== code || payload.p !== session.partyId) throw new Error('fragment names another party');
  return true;
});

await check('this phone is serving the party mesh', async () => {
  await a.waitForSelector('[data-hosting="self"]', { timeout: 15000 });
  return true;
});

await check('device-less Members can be added to the roster', async () => {
  await go(a, 'Party');
  const nameField = a.locator('input[aria-label="Device-less member name"]');
  await until(async () => (await nameField.count()) > 0, {
    timeout: 15000,
    label: 'device-less member form',
  });
  await nameField.fill('Mia');
  await a.locator('input[aria-label="Height in inches"]').fill('40');
  await a.locator('button:has-text("Add")').click();
  await until(async () => /Mia/i.test(await a.locator('.roster').innerText().catch(() => '')), {
    timeout: 10000,
    label: 'Mia on roster',
  });
  return true;
});

await check('a phone can remove a device-less Member from the roster', async () => {
  const row = a.locator('.memberRow', { hasText: 'Mia' });
  await row.locator('button:has-text("Remove")').click();
  await until(async () => !(await partyRosterNames(a)).includes('Mia'), {
    timeout: 10000,
    label: 'Mia gone from roster',
  });
  return true;
});


await check('the invite QR is drawn', async () => {
  await a.waitForSelector('.qrImg', { timeout: 15000 });
  const src = await a.locator('.qrImg').getAttribute('src');
  if (!src?.startsWith('data:image/')) throw new Error(String(src).slice(0, 40));
  return true;
});

console.log('\n--- party: joining ---');

// Phone B, down in Coney Mall, types the code in.
B = await openPhone(browser, {
  lat: 39.3412,
  lng: -84.2652,
  name: 'Ava',
  label: 'B',
  venue: 'kings-island',
});
b = B.page;
await signIn(b, 'ava@parkbound.example');
await go(b, 'Party');
await b.locator('.field.code').fill(code);
await b.locator('button:has-text("Join")').click();

await check('a typed code joins the party', async () => {
  await until(async () => (await b.locator('.codeText').count()) > 0, {
    timeout: JOIN_TIMEOUT,
    label: 'phone B to be in a party',
  });
  const shown = (await b.locator('.codeText').innerText()).trim();
  if (shown !== code) throw new Error(`${shown} != ${code}`);
  return true;
});

await check('the roster converges on both phones', async () => {
  await until(async () => (await partyRosterNames(b)).includes('Justin'), {
    timeout: JOIN_TIMEOUT,
    label: 'Justin on phone B',
  });
  await until(async () => (await partyRosterNames(a)).some((n) => /ava/i.test(n)), {
    timeout: JOIN_TIMEOUT * 2,
    label: 'Ava on phone A',
  });
  const onA = await partyRosterNames(a);
  const onB = await partyRosterNames(b);
  if (!onA.some((n) => /ava/i.test(n)) || !onB.some((n) => /justin/i.test(n))) {
    throw new Error(`A ${onA} / B ${onB}`);
  }
  if (onA.length !== 2 || onB.length !== 2) throw new Error(`A ${onA} / B ${onB}`);
  return true;
});

await check('the joining phone is not serving the party mesh', async () => {
  await until(
    async () => ((await b.locator('[data-hosting="peer"]').count()) > 0 ? true : null),
    { timeout: JOIN_TIMEOUT, label: 'phone B as mesh peer' },
  );
  if ((await a.locator('[data-hosting="self"]').count()) < 1) {
    throw new Error('two phones both think they host, or neither does');
  }
  return true;
});

await check('roster shows a real distance to phone B', async () => {
  const t = await until(
    async () => {
      const row = await a.locator('.memberRow', { hasText: 'Ava' }).first().innerText();
      return /\d+\s*(ft|mi)/.test(row) ? row : null;
    },
    { timeout: JOIN_TIMEOUT, label: 'a range to phone B' },
  );
  return Boolean(t);
});

await check('NEED HELP propagates to the other phone', async () => {
  // Two taps on purpose: the alert buzzes every phone in the party, so it is
  // not a thing a resting thumb can send.
  await b.locator('button:has-text("I need help")').click();
  await b.locator('button:has-text("Tap again to alert everyone")').click();
  await until(
    async () => a.locator('.memberRow', { hasText: 'Ava' }).locator('.chipTag.hot').count(),
    { timeout: JOIN_TIMEOUT, label: 'the help tag on phone A' },
  );
  return true;
});

await check('Rally Point set from a ride reaches the other phone', async () => {
  await resetPlaces(a);
  await a.locator('.field[aria-label="Search places"]').fill('Racer');
  await until(async () => (await a.locator('.poiRow', { hasText: 'The Racer' }).count()) || null, {
    timeout: 15000,
    label: 'The Racer in the list',
  });
  await a.locator('.poiRow', { hasText: 'The Racer' }).first().locator('.poiMain').click();
  await a.waitForTimeout(500);
  await a.locator('.poiRow.open button[aria-label="Rally the Party"]').click();
  await go(a, 'Party');
  await until(async () => /Racer/i.test(await b.locator('.sheetBody').innerText()), {
    timeout: JOIN_TIMEOUT,
    label: 'the Rally Point on phone B',
  });
  return true;
});

// Phone C, by the Eiffel Tower, opens the invite link instead of typing anything.
C = await openPhone(browser, {
  lat: 39.343328,
  lng: -84.266981,
  name: 'Sam',
  url: invite,
  label: 'C',
  venue: 'kings-island',
});
c = C.page;
// openPhone(/join) already waits for the name-first handoff to land on Party.

await check('the invite link joins the party with nothing typed', async () => {
  await go(c, 'Party');
  await until(async () => (await c.locator('.codeText').count()) > 0, {
    timeout: JOIN_TIMEOUT * 2,
    label: 'phone C to be in a party',
  });
  const shown = (await c.locator('.codeText').innerText()).trim();
  if (shown !== code) throw new Error(`${shown} != ${code}`);
  return true;
});

await check('the key never leaves the fragment on the way in', () => {
  // Fragments are not sent to a server, so no request this context made may
  // carry the key — including the /join navigation that started it.
  const leaked = C.requests.filter((u) => u.includes(session.keyString));
  if (leaked.length) throw new Error(leaked[0].slice(0, 120));
  const current = c.url();
  if (current.includes(session.keyString)) throw new Error('key left in the address bar');
  if (current.includes('#')) throw new Error(`invite fragment not consumed: ${current}`);
  return true;
});

await check('all three phones see all three members', async () => {
  for (const [label, page] of [['A', a], ['B', b], ['C', c]]) {
    const names = await until(
      async () => {
        const n = await partyRosterNames(page);
        return n.length === 3 ? n : null;
      },
      { timeout: JOIN_TIMEOUT * 2, label: `three members on phone ${label}` },
    );
    for (const who of ['Justin', 'Ava', 'Sam']) {
      if (!names.includes(who)) throw new Error(`phone ${label} is missing ${who}: ${names}`);
    }
  }
  return true;
});

console.log('\n--- ride reports ---');

/**
 * The half of live status that does not come from a forecast: one phone says a
 * ride is down and every other phone in the party hears it. Exercised over
 * whatever transport the party actually negotiated, which is the point — the
 * report is an ordinary command and gets the same delivery guarantees as a
 * location or a meet-up pin.
 */

await check('a ride reported down on one phone reaches the other', async () => {
  const row = await openRide(a, 'Diamondback');
  await reportBtn(row, 'down').click();
  await a.waitForTimeout(400);

  // The reporting phone shows it straight away — via the host's patch, not an
  // optimistic local write.
  await until(async () => /paused/i.test(await pillFor(a, 'Diamondback')), {
    timeout: JOIN_TIMEOUT,
    label: 'phone A to show its own report',
  });

  await openRide(b, 'Diamondback');
  await until(async () => /paused/i.test(await pillFor(b, 'Diamondback')), {
    timeout: JOIN_TIMEOUT,
    label: 'the report to reach phone B',
  });
  return true;
});

await check('the report says who saw it and when', async () => {
  const detail = await b
    .locator('.poiRow', { hasText: 'Diamondback' })
    .first()
    .locator('.poiNote.wxWhy')
    .innerText();
  // Justin is phone A's roster name; the party, not the forecast, is the source.
  if (!/Justin/.test(detail)) throw new Error(detail);
  if (!/just now|sec ago|min ago/.test(detail)) throw new Error(detail);
  return true;
});

await check('the other phone can correct it', async () => {
  const row = b.locator('.poiRow', { hasText: 'Diamondback' }).first();
  await reportBtn(row, 'open').click();
  await until(async () => /go now|\bopen\b/i.test(await pillFor(b, 'Diamondback')), {
    timeout: JOIN_TIMEOUT,
    label: 'phone B to overwrite the report',
  });
  // A ride report is not owned by whoever wrote it, so A sees B's correction.
  await until(async () => /go now|\bopen\b/i.test(await pillFor(a, 'Diamondback')), {
    timeout: JOIN_TIMEOUT,
    label: "the correction to reach phone A",
  });
  return true;
});

await check('retracting a report clears it everywhere', async () => {
  const row = b.locator('.poiRow', { hasText: 'Diamondback' }).first();
  // Tapping the button that is already on retracts it.
  await reportBtn(row, 'open').click();
  // Not asserting the pill is gone outright: this suite runs against a live
  // forecast, and if it is genuinely storming the row keeps a weather pill.
  // What must disappear is the party's claim (the ● marker on an OPEN/PAUSED pill).
  const cleared = async (page) => !/●/.test(await pillFor(page, 'Diamondback'));
  await until(() => cleared(b), { timeout: JOIN_TIMEOUT, label: 'phone B to drop the report' });
  await until(() => cleared(a), { timeout: JOIN_TIMEOUT, label: 'phone A to drop the report' });
  return true;
});

await check('the reporting buttons are absent without a party', async () => {
  const solo = await openPhone(browser, {
    lat: 39.3432,
    lng: -84.2669,
    name: 'Solo',
    label: 'S',
    venue: 'kings-island',
    requireGps: false,
  });
  await openRide(solo.page, 'Diamondback');
  const buttons = await solo.page.locator('.reportRow button').count();
  await solo.context.close();
  if (buttons !== 0) throw new Error(`${buttons} report buttons with no party`);
  return true;
});

// Put both phones back the way the rest of the suite expects to find them: on
// the Party screen, with the ride search cleared. Everything after this reads
// the roster, and a phone left on the places list has no roster to read.
for (const page of [a, b]) {
  await page.locator('.field[aria-label="Search places"]').fill('');
  await go(page, 'Party');
  await page.waitForTimeout(300);
}

console.log('\n--- host migration ---');

// The host's phone goes in a locker. No goodbye, no handover.
const rosterFloor = { min: Infinity, samples: 0 };
const watching = (async () => {
  const deadline = Date.now() + MIGRATION_TIMEOUT;
  while (Date.now() < deadline) {
    const n = await b.locator('.memberRow').count().catch(() => null);
    if (n != null) {
      rosterFloor.min = Math.min(rosterFloor.min, n);
      rosterFloor.samples += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
})();

await A.context.close();

await check('a new host is elected without anybody being asked', async () => {
  const hosting = await until(
    async () => {
      const flags = await Promise.all(
        [b, c].map(async (page) => (await page.locator('[data-hosting="self"]').count()) > 0),
      );
      return flags.some(Boolean) ? flags : null;
    },
    { timeout: MIGRATION_TIMEOUT, label: 'one of the remaining phones to take over' },
  );
  const promoted = hosting.filter(Boolean).length;
  if (promoted !== 1) throw new Error(`${promoted} phones claim to be hosting`);
  return hosting;
});

await check('the party code survives the migration', async () => {
  for (const [label, page] of [['B', b], ['C', c]]) {
    await go(page, 'Party');
    const shown = (await page.locator('.codeText').innerText()).trim();
    if (shown !== code) throw new Error(`phone ${label} shows ${shown}, was ${code}`);
  }
  return true;
});

await check('the surviving phones agree on who is hosting', async () => {
  await go(b, 'Party');
  await go(c, 'Party');
  const flags = await until(
    async () => {
      const roles = await Promise.all(
        [b, c].map(async (page) => ({
          self: (await page.locator('[data-hosting="self"]').count()) > 0,
          peer: (await page.locator('[data-hosting="peer"]').count()) > 0,
        })),
      );
      const claimants = roles.filter((r) => r.self).length;
      const followers = roles.filter((r) => r.peer && !r.self).length;
      if (claimants === 1 && followers === 1) return roles;
      return null;
    },
    { timeout: 30000, label: 'exactly one surviving phone serving the mesh' },
  );
  const claimants = flags.filter((r) => r.self).length;
  if (claimants !== 1) throw new Error(`mesh roles: ${JSON.stringify(flags)}`);
  return true;
});

await check('the roster never collapses while the host is replaced', async () => {
  await watching;
  if (rosterFloor.samples < 10) throw new Error(`only ${rosterFloor.samples} samples`);
  if (rosterFloor.min < 2) throw new Error(`roster fell to ${rosterFloor.min} rows`);
  return true;
});
} // end party (create / join / migration)

if (want('intake')) {
console.log('\n--- intake / nearest park ---');

await check('first-run covers the map before the splash paints', async () => {
  const fresh = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
    geolocation: { latitude: 30.2672, longitude: -97.7431 },
  });
  await fresh.addInitScript(() => {
    localStorage.removeItem('tracker-intro-seen');
  });
  const p = await fresh.newPage();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await until(async () => (await p.locator('.gate').count()) > 0, {
    timeout: 8000,
    label: 'a gate on first paint',
  });
  const gate = p.locator('.gate').first();
  const painted = await until(
    async () => {
      const klass = (await gate.getAttribute('class')) || '';
      if (!/\bgateFirstRun\b/.test(klass)) return null;
      const { bg, anim } = await gate.evaluate((el) => {
        const s = getComputedStyle(el);
        return { bg: s.backgroundColor, anim: s.animationName };
      });
      if (!bg) return null;
      return { klass, bg, anim };
    },
    { timeout: 8000, label: 'opaque first-run styles' },
  );
  if (painted.anim && painted.anim !== 'none') throw new Error(`first-run gate animated (${painted.anim})`);
  if (/0,\s*0,\s*0/.test(painted.bg) && /0\.(3|4)/.test(painted.bg)) {
    throw new Error(`first-run gate is translucent (${painted.bg})`);
  }
  await until(async () => (await p.locator('#intro-splash-title').count()) > 0, {
    timeout: 10000,
    label: 'logo splash after the hold',
  });
  const sheetHidden = await p.locator('.app > .sheet').evaluate((el) => getComputedStyle(el).visibility);
  if (sheetHidden !== 'hidden') throw new Error(`first-run sheet leaked (${sheetHidden})`);
  await fresh.close();
  return true;
});

await check('a returning phone skips the hold and does not hide the map', async () => {
  const back = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
    geolocation: { latitude: 30.2672, longitude: -97.7431 },
  });
  await back.addInitScript(() => {
    localStorage.setItem('tracker-intro-seen', '1');
  });
  const p = await back.newPage();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await until(
    async () => {
      // The service worker can reload the page mid-poll; a destroyed
      // execution context is "not settled yet", not a failure.
      try {
        if ((await p.locator('html').getAttribute('data-intro')) !== 'seen') return false;
        const hold = p.locator('[data-intro-hold]');
        if (!(await hold.count())) return true;
        const display = await hold.first().evaluate((el) => getComputedStyle(el).display);
        return display === 'none';
      } catch (err) {
        if (/Execution context was destroyed|navigation/i.test(err.message)) return false;
        throw err;
      }
    },
    { timeout: 8000, label: 'html[data-intro=seen] hides the SSR hold' },
  );
  if (await p.locator('#intro-splash-title').count()) {
    throw new Error('returning phone still got the logo splash');
  }
  await back.close();
  return true;
});

// A phone that is at neither park: an hour up the interstate from Fiesta Texas,
// and most of a continent from Kings Island. Its first fix is inside nothing,
// which is exactly the case where guessing is worst and asking is best.
const intake = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ['geolocation'],
  geolocation: { latitude: 30.2672, longitude: -97.7431 }, // Austin, Texas
});
const e = await intake.newPage();
await e.goto(BASE, { waitUntil: 'domcontentloaded' });
await hydrated(e);

await check('the logo splash opens first and release notes stay behind the version control', async () => {
  const fresh = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
    geolocation: { latitude: 30.2672, longitude: -97.7431 },
  });
  const p = await fresh.newPage();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await hydrated(p);
  await until(async () => (await p.locator('#intro-splash-title').count()) > 0, {
    timeout: 10000,
    label: 'the logo splash',
  });
  if (await p.locator('#update-splash-title').count()) {
    throw new Error('the update splash should not open automatically');
  }
  const heading = (await p.locator('#intro-splash-title').innerText()).trim();
  if (heading !== 'PARKBOUND') throw new Error(`logo splash heading: "${heading}"`);
  await p.locator('.gateVersionBtn').click();
  await until(async () => (await p.locator('#intro-notes-title').count()) > 0, {
    timeout: 10000,
    label: 'release notes from the version control',
  });
  const notesTitle = (await p.locator('#intro-notes-title').innerText()).trim();
  if (!/what's new/i.test(notesTitle)) throw new Error(`notes title: "${notesTitle}"`);
  await fresh.close();
  return true;
});

await dismissIntroSplash(e);
await dismissUpdateSplash(e);

await check('the welcome gate shows brand, pitch, and nearest-park on one card', async () => {
  const card = await e.locator('.gate').innerText();
  const heading = (await e.locator('.brandLockupName').innerText()).trim();
  if (heading !== 'PARKBOUND') throw new Error(`opened on: "${heading}"`);
  const said = card.indexOf('Explore more. Stress less.');
  const pitch = /World|Rally|living map/i.test(card);
  if (said < 0 || !pitch) {
    throw new Error('the welcome gate is missing slogan or pitch');
  }
  if (!/Go to nearest World/i.test(card)) {
    throw new Error('the welcome gate should offer nearest World on the first card');
  }
  const paths = await e.locator('.mapSvg path').count();
  if (paths < 100) throw new Error(`map looked empty behind the gate (${paths} paths)`);
  // Off-site GPS may not project a puck until the park is confirmed; map
  // geometry behind the gate is the vertical intake guarantee.
  return true;
});

await check('the nearest-park button asks before building that park', async () => {
  await e.locator('button:has-text("Go to nearest World")').click();
  // Confirm the nearest World — never auto-download the wrong map.
  await until(
    async () => (await e.locator('.gate .btn.primary:has-text("Enter")').count()) > 0,
    { timeout: 25000, label: 'World confirm' },
  );
  await e.locator('.gate .btn.primary:has-text("Enter")').click();
  await e.waitForSelector('.gate', { state: 'detached', timeout: 25000 });
  const shown = await e.locator('.brandName, .brand b').first().innerText();
  if (!/fiesta texas/i.test(shown)) throw new Error(`brand reads "${shown}"`);
  const toast = await e.locator('.toast').innerText().catch(() => '');
  if (!/fiesta texas is (ready|loaded)/i.test(toast)) throw new Error(`toast: "${toast}"`);
  await go(e, 'Rider height');
  await e.locator('.tier:has-text("48")').click();
  await e.waitForTimeout(400);
  if (!(await e.locator('.filterBadge').count())) throw new Error('no height filter on Fiesta Texas');
  await go(e, 'Places');
  await searchPlaces(e, 'batman');
  await until(async () => (await e.locator('.poiRow', { hasText: 'BATMAN The Ride' }).count()) > 0, {
    timeout: 15000,
    label: "Fiesta Texas's place list",
  });
  return true;
});

await check('the park question is inline when the venue is not yet confirmed', async () => {
  const returning = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
    geolocation: { latitude: 30.2672, longitude: -97.7431 },
  });
  await returning.addInitScript(() => {
    localStorage.setItem('tracker-intro-seen', '1');
    localStorage.removeItem('tracker-venue-confirmed');
    localStorage.removeItem('tracker-venue');
    localStorage.setItem('tracker-release-notes-seen', '9.9.9');
  });
  const p = await returning.newPage();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await hydrated(p);
  if (await p.locator('#intro-splash-title').count()) {
    throw new Error('the introduction came back for a returning phone');
  }
  await p.locator('button:has-text("Allow location")').click();
  // Explore-without-fix can flash "Which World are we exploring?" before the
  // Austin GPS fix lands; wait for the distance-based confirm copy.
  await until(async () => {
    const heading = (await p.locator('.gate h2').innerText().catch(() => '')).trim();
    return /headed to.*fiesta texas/i.test(heading);
  }, { timeout: 25000, label: 'the park question' });
  const other = await p.locator('.gate .venueRow', { hasText: 'Kings Island' }).innerText();
  if (!/\d+ mi away/i.test(other)) throw new Error(`other park row: "${other}"`);
  await p.locator('.gate .btn.primary:has-text("Enter")').click();
  await p.waitForSelector('.gate', { state: 'detached', timeout: 25000 });
  const shown = await p.locator('.brandName, .brand b').first().innerText();
  if (!/fiesta texas/i.test(shown)) throw new Error(`brand reads "${shown}"`);
  await go(p, 'Places');
  await searchPlaces(p, 'batman');
  await until(async () => (await p.locator('.poiRow', { hasText: 'BATMAN The Ride' }).count()) > 0, {
    timeout: 25000,
    label: "Fiesta Texas's place list",
  });
  await returning.close();
  return true;
});

await check('the park answered stays answered across a reload', async () => {
  const confirmedBefore = await e.evaluate(() => localStorage.getItem('tracker-venue-confirmed'));
  if (confirmedBefore !== 'six-flags-fiesta-texas') {
    throw new Error(`expected Fiesta confirmation, got "${confirmedBefore}"`);
  }
  await e.reload({ waitUntil: 'domcontentloaded' });
  await hydrated(e);
  await dismissUpdateSplash(e);
  await dismissIntroSplash(e).catch(() => {});
  if (await e.locator('#intro-splash-title').count()) {
    throw new Error('the introduction came back on a reload');
  }
  // Gate may flash for a GPS re-ask while confirmation loads; the vertical
  // guarantee is the park stays Fiesta Texas from storage, not that the gate
  // never paints.
  await until(
    async () => {
      const confirmed = await e.evaluate(() => localStorage.getItem('tracker-venue-confirmed'));
      if (confirmed !== 'six-flags-fiesta-texas') return false;
      // Clear a residual location/welcome gate if the map brand is already right.
      if ((await e.locator('.gate').count()) > 0) {
        const brandPeek = await e.locator('.brandName, .brand b').first().innerText().catch(() => '');
        if (/fiesta texas/i.test(brandPeek)) {
          await e.locator('.gate .btn:has-text("Just show me the park map")').click().catch(() => {});
          await e.locator('button:has-text("Allow location")').click().catch(() => {});
        }
      }
      const brand = await e.locator('.brandName, .brand b').first().innerText().catch(() => '');
      return /fiesta texas/i.test(brand);
    },
    { timeout: 30000, label: 'confirmed park keeps Fiesta Texas after reload' },
  );
  return true;
});

await check('skipping location still asks which World to explore', async () => {
  const fresh = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: [],
  });
  await fresh.addInitScript(() => {
    localStorage.setItem('tracker-intro-seen', '1');
    localStorage.setItem('tracker-release-notes-seen', '1.1.3');
  });
  const p = await fresh.newPage();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await hydrated(p);
  await dismissUpdateSplash(p);
  const skip = p.locator(
    'button:has-text("Just browsing"), button:has-text("Just show me the map")',
  );
  await until(async () => (await skip.count()) > 0, { timeout: 10000, label: 'the location skip button' });
  await skip.first().click();
  await until(async () => /which world are we exploring/i.test(await p.locator('.gate h2').innerText()), {
    timeout: 10000,
    label: 'the explore park question',
  });
  const heading = (await p.locator('.gate h2').innerText()).trim();
  if (!/which world are we exploring/i.test(heading)) {
    throw new Error(`asked: "${heading}"`);
  }
  await p.locator('.gate .btn.primary').click();
  await p.waitForSelector('.gate', { state: 'detached', timeout: 25000 });
  const paths = await p.locator('svg.mapSvg path').count();
  if (paths < 100) throw new Error(`map did not draw after picking a park (${paths} paths)`);
  await fresh.close();
  return true;
});

await intake.close();
} // end intake

if (want('party')) {
// A phone that is nowhere near the party. It should open on the venue its own
// fix falls inside, then follow the party to the venue the host is standing in
// — everyone in a party has to be drawing the same place for a meet-up pin to
// mean anything.
D = await openPhone(browser, {
  lat: 29.5992,
  lng: -98.6145, // Six Flags Fiesta Texas, San Antonio
  name: 'Remote',
  label: 'D',
  venue: 'six-flags-fiesta-texas',
});
d = D.page;
await signIn(d, 'remote@parkbound.example');
/* Which map this phone is showing. The name is on the Explore screen, so read
   it there — tapping the tab this phone is already on pops it back to its root
   and costs nothing. */
const venueName = async (page) => {
  await page.locator('.tabItem[data-tab="explore"]').click();
  await root(page);
  return page.locator('.brand b').innerText();
};

await check('a phone opens on the venue its own fix is inside', async () => {
  const shown = await until(async () => /fiesta texas/i.test(await venueName(d)) || false, {
    timeout: JOIN_TIMEOUT,
    label: 'phone D to open on Fiesta Texas',
  });
  return shown;
});

await check('joining a party moves the map to where the host is', async () => {
  await go(d, 'Party');
  await d.locator('.field.code').fill(code);
  await d.locator('button:has-text("Join")').click();
  await until(async () => (await d.locator('.codeText').count()) > 0, {
    timeout: JOIN_TIMEOUT,
    label: 'phone D to be in the party',
  });
  await until(async () => /kings island/i.test(await venueName(d)) || false, {
    timeout: JOIN_TIMEOUT,
    label: 'phone D to follow the host to Kings Island',
  });
  return true;
});

await check('Explore Worlds measures from the Party, not from this phone', async () => {
  await go(d, 'Explore Worlds');
  await d.waitForTimeout(400);
  const rows = await d.locator('.venueRow').allTextContents();
  const here = rows.find((r) => /Kings Island/.test(r));
  const far = rows.find((r) => /Fiesta Texas/.test(r));
  if (!/your party is here/.test(here || '')) throw new Error(`Kings Island row: "${here}"`);
  if (!/from your party/.test(far || '')) throw new Error(`Fiesta Texas row: "${far}"`);
  return true;
});

await check('picking a World by hand outranks the host', async () => {
  await go(d, 'Explore Worlds');
  await d.locator('.venueRow', { hasText: 'Fiesta Texas' }).click();
  await until(async () => /fiesta texas/i.test(await venueName(d)) || false, {
    timeout: JOIN_TIMEOUT,
    label: 'phone D to show the venue it picked',
  });
  // The host has not moved, so anything that retargets on its own would pull
  // the map back to Kings Island within a couple of heartbeats.
  await d.waitForTimeout(6000);
  if (!/fiesta texas/i.test(await venueName(d))) throw new Error('the pinned choice was overridden');
  return true;
});

// Out again, so the roster the tests below assert on is the one they set up.
await go(d, 'Party');
await d.locator('.codeBox button:has-text("Leave")').click();
await until(async () => (await d.locator('button:has-text("Start a party")').count()) > 0, {
  timeout: JOIN_TIMEOUT,
  label: 'phone D to leave the party',
}).catch(() => {});
await D.context.close();

console.log('\n--- leaving ---');

await check('leaving removes the member from the other phone’s roster', async () => {
  // Whoever is not hosting leaves, so the departure has a host to reach.
  const bHosts = (await b.locator('[data-hosting="self"]').count()) > 0;
  const leaver = bHosts ? { page: c, name: 'Sam' } : { page: b, name: 'Ava' };
  const stays = bHosts ? b : c;

  await go(leaver.page, 'Party');
  await go(stays, 'Party');
  // Leaving confirms too — for the host it hands the roster to another phone.
  await leaver.page.locator('.codeBox button:has-text("Leave")').click();
  await leaver.page.locator('.codeBox button:has-text("Tap to confirm")').click();
  await until(async () => (await leaver.page.locator('button:has-text("Start a party")').count()) > 0, {
    timeout: JOIN_TIMEOUT,
    label: 'the leaver to be back on the start screen',
  });
  await until(async () => !(await partyRosterNames(stays)).includes(leaver.name), {
    timeout: JOIN_TIMEOUT,
    label: `${leaver.name} to disappear from the other roster`,
  });
  return true;
});

console.log('\n--- persistence ---');

await check('height, theme and party survive a reload', async () => {
  await go(b, 'Rider height');
  await b.waitForTimeout(300);
  await b.locator('.tier:has-text("52")').click();
  await b.waitForTimeout(600);
  const theme = await b.evaluate(() => document.documentElement.dataset.theme);
  const before = (await b.locator('.codeText').count())
    ? (await b.locator('.codeText').innerText()).trim()
    : null;

  // Never networkidle: a phone in a party polls its mailbox and the network
  // never goes quiet, so waiting for idle only ever waits for the timeout.
  await b.reload({ waitUntil: 'domcontentloaded' });
  await b.waitForFunction(() => document.querySelectorAll('svg.mapSvg path').length > 100, null, {
    timeout: 40000,
  });
  // The park question is not asked twice: this phone answered it before the
  // reload, so granting location is the whole of the intake this time.
  await closeGate(b);

  if ((await b.locator('.filterBadge').count()) !== 1) throw new Error('height filter lost');
  if ((await b.evaluate(() => document.documentElement.dataset.theme)) !== theme) {
    throw new Error('theme reset on reload');
  }
  await go(b, 'Settings');
  const name = await b.locator('.field[placeholder="Name"]').inputValue();
  if (name !== 'Ava') throw new Error(`name came back as "${name}"`);

  if (before) {
    await go(b, 'Party');
    const after = await until(
      async () => {
        const n = await b.locator('.codeText').count();
        return n ? (await b.locator('.codeText').innerText()).trim() : null;
      },
      { timeout: JOIN_TIMEOUT, label: 'the party to resume after a reload' },
    );
    if (after !== before) throw new Error(`party came back as ${after}, was ${before}`);
  }
  return true;
});

console.log('\n--- car parking ---');

await check('save where I parked and walk back to it', async () => {
  // Persistence / Party leave the sheet high; crowded hides the car fab.
  await ensurePeek(b);
  await B.context.setGeolocation({ latitude: 39.34395, longitude: -84.2673 });
  await b.waitForTimeout(800);
  // Clear a leftover pin via the glance ✕ (Forget under Me → Phone is easy to miss).
  const forgetCar = b.locator('button[aria-label="Remove Your car from this list"]');
  if (await forgetCar.count()) {
    await forgetCar.click();
    await b.waitForTimeout(400);
  }
  const saveBtn = b.locator('button[aria-label="Save where I parked"]');
  await until(async () => (await saveBtn.count()) > 0, {
    timeout: 15000,
    label: 'Save where I parked fab',
  });
  await saveBtn.click();
  await b.waitForTimeout(600);
  // Move away from the saved spot so a walk is worth previewing — pulse the
  // fake GPS so watchPosition actually moves (one set can sit unread).
  const away = { latitude: 39.3455, longitude: -84.265 };
  for (let i = 0; i < 4; i += 1) {
    await B.context.setGeolocation(away);
    await b.waitForTimeout(400);
  }
  await go(b, 'Places');
  const carGo = b.locator('.glanceCard', { hasText: 'Your car' }).locator('.glanceGo');
  await until(async () => (await carGo.count()) > 0, { timeout: 15000, label: 'car glance card' });
  await carGo.click();
  await until(async () => (await b.locator('.routePreview').count()) > 0, {
    timeout: 15000,
    label: 'route to car',
  });
  await b.locator('.previewGo').click();
  await until(
    async () => (await b.locator('.navBanner, .navBar').count()) > 0,
    {
      timeout: 20000,
      label: 'walk to car started',
    },
  );
  await b.locator('.navEnd').click();
  await b.waitForTimeout(400);
  return true;
});

console.log('\n--- map categories ---');

await check('show on the map toggles a category off and on', async () => {
  await dismissNavigation(b).catch(() => {});
  if (await b.locator('.navBanner').count()) {
    await b.locator('.navEnd').click().catch(() => {});
    await b.waitForTimeout(400);
  }
  // Parking tests may have left this phone away from the rides; snap back so
  // coaster markers (if any) are eligible to draw under the sheet.
  await B.context.setGeolocation({ latitude: 39.34395, longitude: -84.2673 });
  await go(b, 'Places');
  await b.waitForTimeout(800);
  // UI copy is "On the map" (go() still accepts the older "Show on the map" alias).
  await go(b, 'On the map');
  await until(async () => (await b.locator('.chip:has-text("Coasters")').count()) > 0, {
    timeout: 15000,
    label: 'coasters chip',
  });
  const chip = b.locator('.chip:has-text("Coasters")');
  if (!(await chip.getAttribute('class'))?.includes('on')) {
    throw new Error('Coasters chip should start on');
  }
  const before = await b.locator('svg.mapSvg .poiMarker').count();
  await chip.click();
  await until(async () => !(await chip.getAttribute('class'))?.includes('on'), {
    timeout: 5000,
    label: 'Coasters chip off',
  });
  // Markers only drop when coasters were in the current cull view; chip state is
  // the always-on vertical guarantee ("anything switched off stops drawing").
  if (before > 0) {
    const after = await b.locator('svg.mapSvg .poiMarker').count();
    if (after > before) throw new Error(`markers grew ${before} -> ${after}`);
  }
  await chip.click();
  await until(async () => (await chip.getAttribute('class'))?.includes('on'), {
    timeout: 5000,
    label: 'Coasters chip on again',
  });
  await b.locator('button:has-text("Back")').click();
  await b.waitForTimeout(300);
  return true;
});

} // end party (park / map categories)

if (want('offline')) {
console.log('\n--- pwa + offline ---');

await check('manifest and icons are served', async () => {
  const m = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
  const i = await fetch(`${BASE}/icon-512.png`);
  if (m.display !== 'standalone' || !i.ok) throw new Error('manifest/icon missing');
  return true;
});

await check('service worker registers', async () => {
  // Own context — do not require the party phone B from the party module.
  const swCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
    geolocation: { latitude: 39.34395, longitude: -84.2673 },
  });
  const swPage = await swCtx.newPage();
  await swPage.goto(BASE, { waitUntil: 'domcontentloaded' });
  await swPage.waitForTimeout(2000);
  const reg = await swPage.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()));
  await swCtx.close();
  if (!reg) throw new Error('no service worker registration');
  return true;
});

// The offline phone gets its own context: with the network cut, failed requests
// are the expected behaviour rather than something to assert against.
const offline = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ['geolocation'],
  geolocation: { latitude: 39.34395, longitude: -84.2673 },
});
const off = await offline.newPage();
await off.goto(BASE, { waitUntil: 'domcontentloaded' });
await off.waitForFunction(() => document.querySelectorAll('svg.mapSvg path').length > 100, null, {
  timeout: 40000,
});
await off.waitForTimeout(3000); // let the worker install and cache the shell
// Warm the Plan tab while online so the HeightPanel chunk is in the SW cache —
// dynamic() import fails after reload if that chunk was never fetched.
await closeGate(off);
await go(off, 'Rider height');
await until(async () => (await off.locator('.tierRow .tier').count()) >= 3, {
  timeout: 20000,
  label: 'height tiers online warm',
});
await go(off, 'Places');
await off.waitForTimeout(500);
await offline.setOffline(true);
await off.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
// Give the offline shell a moment to hydrate before asserting on tabs.
await off.waitForTimeout(1500);
await hydrated(off).catch(() => {});

await check('the map still draws with the network cut', async () => {
  const paths = await until(
    async () => {
      const n = await off.locator('svg.mapSvg path').count();
      return n >= 100 ? n : null;
    },
    { timeout: 40000, label: 'the offline map to draw' },
  );
  return paths >= 100;
});

await check('ride heights still work with the network cut', async () => {
  // Including the park question, which this context has never answered: saying
  // yes to the park already on screen must not go back to the network for it.
  await closeGate(off);
  await go(off, 'Rider height');
  await until(async () => (await off.locator('.tierRow .tier').count()) >= 3, {
    timeout: 20000,
    label: 'height tiers offline',
  });
  await off.locator('.tierRow .tier', { hasText: '48' }).click();
  await until(async () => (await off.locator('.ratioBar').count()) > 0, {
    timeout: 10000,
    label: 'ratio bar offline',
  });
  await go(off, 'Places');
  await searchPlaces(off, 'beast');
  const verdict = await rideHeightVerdict(off, 'The Beast');
  if (!/CAN RIDE/i.test(verdict)) throw new Error(`verdict offline: ${verdict}`);
  const badge = await off.locator('.filterBadge').textContent();
  if (!/\d+ of \d+ rides/.test(badge.replace(/\s+/g, ' '))) throw new Error(badge);
  return true;
});

// SignInCard (and its offline cue) render only behind clerkBrowserConfigured() —
// same seam the auth module gates on.
if (Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)) {
await check('offline profile identity survives without network', async () => {
  const fakeProfile = { userId: 'usr_offline_check', displayName: 'Offline Scout', rank: 'ranger', xp: 250 };
  // IndexedDB is a local API — unaffected by context.setOffline() — so the
  // snapshot can be seeded on `off` without going back online first.
  await off.evaluate(
    (profile) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('parkbound.profile', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('snapshot')) db.createObjectStore('snapshot');
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('snapshot', 'readwrite');
          tx.objectStore('snapshot').put({ ...profile, cachedAt: new Date().toISOString() }, 'current');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        req.onerror = () => reject(req.error);
      }),
    fakeProfile,
  );
  await off.evaluate(() => sessionStorage.removeItem('parkbound.session'));
  await off.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await off.waitForTimeout(1500);
  await hydrated(off).catch(() => {});
  await go(off, 'Settings');
  const cardText = await until(
    async () => {
      if (!(await off.locator('.signInCard').count())) return null;
      const text = await off.locator('.signInCard').innerText();
      return text.includes('Offline Scout') ? text : null;
    },
    { timeout: 15000, label: 'cached displayName on the offline SignInCard' },
  );
  if (!cardText.includes('offline profile')) throw new Error(`missing offline cue: ${cardText}`);
  if (!cardText.includes('Ranger')) throw new Error(`missing rank title: ${cardText}`);
  return true;
});
}
await offline.close();
} // end offline

if (want('venues')) {
console.log('\n--- per-venue smoke ---');

const VENUE_SMOKE = [
  { id: 'kings-island', lat: 39.34395, lng: -84.2673, search: 'The Beast', minPaths: 700 },
  { id: 'six-flags-fiesta-texas', lat: 29.5992, lng: -98.6145, search: 'BATMAN', minPaths: 800 },
  { id: 'cedar-point', lat: 41.4826, lng: -82.6862, search: 'Millennium Force', minPaths: 1000 },
  { id: 'big-kahunas', lat: 30.3883, lng: -86.473, search: 'Jumanji', minPaths: 100 },
];

for (const v of VENUE_SMOKE) {
  const phone = await openPhone(browser, {
    lat: v.lat,
    lng: v.lng,
    label: v.id.slice(0, 2).toUpperCase(),
    venue: v.id,
  });
  const p = phone.page;
  await check(`${v.id} loads geometry and a known place`, async () => {
    const paths = await p.locator('svg.mapSvg path').count();
    if (paths < v.minPaths) throw new Error(`${paths} paths`);
    await go(p, 'Places');
    await p.locator('.field[aria-label="Search places"]').fill(v.search);
    await p.waitForTimeout(500);
    if ((await p.locator('.poiRow').count()) < 1) throw new Error(`no match for ${v.search}`);
    return true;
  });
  await phone.context.close();
}

console.log('\n--- cedar point camping ---');

const CP = await openPhone(browser, {
  lat: 41.478,
  lng: -82.688,
  label: 'CP',
  venue: 'cedar-point',
});
const cp = CP.page;

await check('cedar point lists numbered campsite pitches', async () => {
  await go(cp, 'Places');
  await cp.locator('.chip.withDot:has-text("Camping")').click();
  await cp.waitForTimeout(500);
  const rows = await cp.locator('.poiRow').allInnerTexts();
  if (!rows.some((r) => /site\s+\d+/i.test(r))) throw new Error(`no numbered pitch: ${rows.slice(0, 3)}`);
  return true;
});

await CP.context.close();

console.log('\n--- admin inspection ---');

await check('World inspection API returns all built Worlds', async () => {
  const res = await fetch(`${BASE}/api/admin/venues`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body.total < 4) throw new Error(`only ${body.total} venues`);
  if (body.passed < 4) throw new Error(`${body.passed}/${body.total} passed compare`);
  return true;
});

await check('App Store routing coverage includes every shipped venue', async () => {
  const geojson = JSON.parse(
    readFileSync(new URL('../../fastlane/metadata/ios/routing_app_coverage.geojson', import.meta.url), 'utf8'),
  );
  const res = await fetch(`${BASE}/venues/manifest.json`);
  if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
  const manifest = await res.json();
  const venues = manifest.venues || [];
  if (venues.length < 4) throw new Error(`only ${venues.length} venues in manifest`);
  for (const venue of venues) {
    if (!pointInCoverage(geojson, venue.center)) {
      throw new Error(`${venue.id} center is outside routing coverage`);
    }
  }
  return true;
});
} // end venues

console.log('\n--- console errors ---');
for (const phone of [A, B, C, D].filter(Boolean)) {
  await check(`no page errors on phone ${phone.label}`, () => {
    if (phone.errors.length) throw new Error(phone.errors.slice(0, 3).join(' | '));
    return true;
  });
}

await browser.close();
console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
