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
  tapBareGround,
  tapMapPoi,
  waitForHeightsReady,
} from './browser.mjs';
import { parseModulesArg, wantModule } from './lib/module-select.mjs';
import { checkMapDecisions } from './lib/map-decisions.mjs';
import { checkMarkerFade, startFadeWatch, stopFadeWatch } from './lib/marker-fade.mjs';
import {
  assertContributionConsolidatePipelineHttp,
  contributionOperatorPathAvailable,
  contributionPostAvailable,
} from './lib/contribution-pipeline-vertical.mjs';
import { readFileSync } from 'node:fs';
import { pointInCoverage } from '../../packages/venue-builder/src/routing-coverage.mjs';
import { INTRO_CLAIMS } from '../../apps/party-tracker/lib/brand.js';
import { distance, formatDistance } from '../../apps/party-tracker/lib/geo.js';
import { FOLLOW_RESUME_MS } from '../../apps/party-tracker/lib/parkMapView.js';
import { RIDE_STALE_AFTER_MS } from '../../apps/party-tracker/lib/core/state.js';
import { PRECISE_MAX_MS } from '../../apps/party-tracker/lib/location.js';
import { labelZoomFor, LABEL_ZOOM_HYSTERESIS } from '../../packages/shared/mapSymbols.js';
import { zoomForResolution } from '../../packages/shared/zoomBands.js';

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
const FUNCTIONAL_IDS = [
  'smoke',
  'heights',
  'walk',
  'party',
  'intake',
  'venues',
  'offline',
  'auth',
  'contribution-pipeline',
];
const anyFunctional = !selected || FUNCTIONAL_IDS.some((id) => want(id));
if (!anyFunctional) {
  console.log('functional: no functional modules selected — skipping');
  process.exit(0);
}

const browser = await launch();

const running = selected ? [...selected].join(',') : 'all';
console.log(`\nfunctional suite against ${BASE} (modules: ${running})\n`);

if (want('contribution-pipeline')) {
  console.log('\n--- contribution pipeline (HTTP + consolidate dry-run) ---');
  const postOk = await contributionPostAvailable(BASE);
  const operatorOk = await contributionOperatorPathAvailable(BASE);
  if (postOk === true && operatorOk === true) {
    await check(
      'POST → accept → consolidate dry-run names venue, action, and contribution id',
      async () => {
        const { plan, contributionId } = await assertContributionConsolidatePipelineHttp(BASE);
        if (!contributionId?.startsWith('c_')) throw new Error(`bad id ${contributionId}`);
        if (plan.venueId !== 'kings-island' || plan.action !== 'heights') {
          throw new Error(`unexpected plan: ${JSON.stringify(plan)}`);
        }
        return true;
      },
    );
  } else if (postOk !== true) {
    console.log(
      `  SKIP HTTP contribution pipeline — POST returned ${postOk.status} (memory backend or test Postgres with profiles; see #438)`,
    );
  } else {
    console.log(
      `  SKIP HTTP contribution pipeline — ${operatorOk.reason ?? `operator probe ${operatorOk.status}`} (#774)`,
    );
  }
  if (!want('smoke') && !want('heights') && !want('walk') && !want('party') && !want('intake') && !want('venues') && !want('offline') && !want('auth')) {
    await browser.close();
    console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
    process.exit(FAIL.length ? 1 : 0);
  }
}

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

await check('first paint is the splash, not an in-place OAuth wall', async () => {
  await a.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await until(
    async () =>
      (await a.locator('#intro-splash-title').count()) > 0 ||
      (await a.locator('.mapSvg path').count()) > 100,
    { timeout: 25000, label: 'splash or map, not a Clerk OAuth wall' },
  );
  if (await a.locator('.authGate .oauthBtn').count()) {
    throw new Error('in-place Profile OAuth must not block first paint');
  }
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
  // The card mounting is half the capability; the other half is that it still
  // offers the way in. AuthGate — the old Profile gate that carried Sign in and
  // Guest together — is no longer mounted anywhere (in-place OAuth broke live),
  // so this card is the shipped entry point to a Profile, and nothing asserted
  // it had a Sign in on it (#24).
  if (card) {
    const login = a.locator('.signInCard .authGateLogin');
    if ((await login.count()) < 1) {
      throw new Error('sign-in card offers no Sign in action');
    }
    const href = await login.first().getAttribute('href');
    if (href !== '/sign-in') {
      throw new Error(`Sign in points at ${href ?? 'nothing'}, not the Clerk route`);
    }
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
  const canvas = await a.locator('[data-testid="park-map-gl"]:not(.mapMissing) canvas').count();
  if (!canvas) throw new Error('map not drawn (no MapLibre canvas)');
  if (!(await a.locator('.mePulse').count())) throw new Error('no own-position marker');
  return true;
});

await check('the map still draws the decisions it was asked for', async () => {
  /* The registry in test/app/map-decisions.json, against the style a real
     MapLibre is drawing on a real phone — not against the module that built
     it. Those are two different things whenever the renderer, a Skin's custom
     map, or the adapter has a hand in the final style, and "the module says
     the track is six pixels" is worth nothing if the glass disagrees.

     map-decisions.test.mjs runs the same checker over every shipped venue
     without a browser. This is the vertical: Kings Island, loaded, drawn, and
     required to still have coaster track and a parking lot in it — so a green
     result here cannot mean the layers were simply absent. */
  await until(async () => {
    const ids = await a.evaluate(() => (globalThis.__parkMapLibre?.getStyle?.()?.layers || []).map((l) => l.id));
    return ids.includes('world-coaster');
  }, { timeout: 20000, label: 'the World tier drawn by MapLibre' });

  const style = await a.evaluate(() => {
    const s = globalThis.__parkMapLibre?.getStyle?.();
    // Only what the checker reads. The whole style carries every source's
    // data, which is a park's worth of geometry across the CDP bridge.
    return { layers: (s?.layers || []).map((l) => ({ id: l.id, type: l.type, paint: l.paint, layout: l.layout })) };
  });

  const { failures, checked } = checkMapDecisions(style, { require: ['coaster', 'parking', 'path', 'building'] });
  if (failures.length) throw new Error(failures.join(' | '));
  if (!checked.includes('coaster') || !checked.includes('parking')) {
    throw new Error(`nothing checked the layers this was about (checked: ${checked.join(', ') || 'none'})`);
  }
  return true;
});

/** A zoom, at this latitude, whose zPlan — the px/m scale `labelWantedAtZoom`
 *  reads, via `overlayMarks.js`'s `labelPlanZoom` and `mapVisual.js`'s
 *  `markerWantsLabel` — sits comfortably under every LABEL_ZOOM rank's enter
 *  threshold, hysteresis included. Below it, every zoom-gated .poiPin loses
 *  its pin. Derived rather than a fixed zoom delta: a raw zoom offset only
 *  ever "dwarfed LABEL_ZOOM's max" by accident, since a zoom level and a
 *  zPlan unit are not the same space — `zoomForResolution` is the actual
 *  inverse of the metres-per-pixel math `labelPlanZoom` runs forward. */
function zoomClearOfEveryLabelRank(latitude) {
  const lowestEnter = Math.min(...[1, 2, 3, 4, 5].map(labelZoomFor));
  const safeZPlan = (lowestEnter - LABEL_ZOOM_HYSTERESIS) / 2;
  return zoomForResolution(1 / safeZPlan, { latitude });
}

await check('a Place that enters on a pinch or a pan fades in rather than snapping', async () => {
  /* The snap this fixes lives on the disc, not the wrapper: ParkMapGl mounts
     one <g> per Place under a stable `kind:id` key that lasts the life of the
     overlay, and it is the .poiPin inside that unmounts and remounts as a
     pinch crosses `markerWantsLabel`'s zoom rank — or as a pan carries its
     label box on- or off-screen, since `tryLabel`'s `visible(box)` gate
     (overlayMarks.js) feeds the same `mark.pin`. A marker that has just
     mounted has no previous opacity for a transition to animate from, so it
     painted at full strength on its first frame — that is the snap. Checking
     .poiMarker instead would prove nothing: it never remounts, so it could
     not tell a fixed bug from a still-broken one.

     First read off the glass rather than off the stylesheet text — a real
     .poiPin in a real document resolves to an animation, and the keyframes
     it names actually start from transparent. That catches a rule deleted,
     renamed, or quietly re-pointed at something that does not fade, but not
     a rule sitting on an element the app never remounts, which is exactly
     the first bug. So then force the remount for real, twice — once by
     zoom, once by pan — and catch a freshly-inserted .poiPin each time with
     a MutationObserver installed before the jump, recording its opacity the
     instant it lands in the document. Every `until()` below polls the real
     .poiPin count rather than sleeping a guessed duration, so a phase that
     stalls says which one rather than false-failing under load. */
  const entry = await a.evaluate(checkMarkerFade, ['.poiPin', '.poiLabel']);
  for (const got of entry) {
    if (!got.found) throw new Error(`no ${got.selector} on the map to check`);
    if (!got.seconds) throw new Error(`${got.selector} enters with no animation (${got.name})`);
    if (!got.fades) throw new Error(`${got.selector} animates "${got.name}", which does not start transparent`);
  }

  const home = await a.evaluate(() => {
    const map = globalThis.__parkMapLibre;
    return { zoom: map.getZoom(), center: map.getCenter() };
  });

  // --- by zoom: drop below every rank's threshold, then zoom back in -----
  const lowZoom = zoomClearOfEveryLabelRank(home.center.lat);
  const zoomHomeCount = await a.locator('.poiPin').count();
  await a.evaluate((zoom) => {
    const map = globalThis.__parkMapLibre;
    map.jumpTo({ zoom, center: map.getCenter() });
  }, lowZoom);
  await until(async () => (await a.locator('.poiPin').count()) < zoomHomeCount, {
    timeout: 8000,
    label: `.poiPin count dropping below ${zoomHomeCount} after zooming out`,
  });
  const zoomAwayCount = await a.locator('.poiPin').count();

  await a.evaluate(startFadeWatch, '.poiPin');
  await a.evaluate((cam) => {
    const map = globalThis.__parkMapLibre;
    map.jumpTo({ zoom: cam.zoom, center: cam.center });
  }, home);
  await until(async () => (await a.locator('.poiPin').count()) > zoomAwayCount, {
    timeout: 8000,
    label: `.poiPin count rising above ${zoomAwayCount} after zooming back in`,
  });
  const zoomBackCount = await a.locator('.poiPin').count();
  const zoomSamples = await a.evaluate(stopFadeWatch);

  if (!zoomSamples.length) {
    throw new Error(
      `zooming ${zoomHomeCount} -> ${zoomAwayCount} -> ${zoomBackCount} mounted no new .poiPin — the remount this bug depends on did not happen`,
    );
  }
  if (!zoomSamples.every((opacity) => opacity < 1)) {
    throw new Error(`a .poiPin mounted by a zoom was already at full opacity (${zoomSamples.join(', ')}) — it snapped`);
  }

  // --- by pan: shift a full screen width off the current view, then back -
  const away = await a.evaluate(() => {
    const map = globalThis.__parkMapLibre;
    const el = map.getContainer();
    const shifted = map.unproject([el.clientWidth * 2, el.clientHeight / 2]);
    return { lng: shifted.lng, lat: shifted.lat };
  });
  const panHomeCount = await a.locator('.poiPin').count();
  await a.evaluate((there) => {
    const map = globalThis.__parkMapLibre;
    map.jumpTo({ center: [there.lng, there.lat], zoom: map.getZoom() });
  }, away);
  await until(async () => (await a.locator('.poiPin').count()) !== panHomeCount, {
    timeout: 8000,
    label: `.poiPin count changing from ${panHomeCount} after panning away`,
  });
  const panAwayCount = await a.locator('.poiPin').count();

  await a.evaluate(startFadeWatch, '.poiPin');
  await a.evaluate((cam) => {
    const map = globalThis.__parkMapLibre;
    map.jumpTo({ zoom: cam.zoom, center: cam.center });
  }, home);
  await until(async () => (await a.locator('.poiPin').count()) !== panAwayCount, {
    timeout: 8000,
    label: `.poiPin count changing from ${panAwayCount} after panning back`,
  });
  const panBackCount = await a.locator('.poiPin').count();
  const panSamples = await a.evaluate(stopFadeWatch);

  if (!panSamples.length) {
    throw new Error(
      `panning ${panHomeCount} -> ${panAwayCount} -> ${panBackCount} mounted no new .poiPin — panning does not remount Places here`,
    );
  }
  if (!panSamples.every((opacity) => opacity < 1)) {
    throw new Error(`a .poiPin mounted by a pan was already at full opacity (${panSamples.join(', ')}) — it snapped`);
  }
  return true;
});

await check('the camera follows this phone and snaps back after a free look', async () => {
  const here = { lat: 39.34395, lng: -84.2673 };
  await ensurePeek(a);
  const map = a.locator('[data-testid="park-map-gl"]');
  await until(async () => (await map.getAttribute('data-follow')) === '1', {
    timeout: 8000,
    label: 'Follow on after the fix',
  });
  await until(async () => (await map.getAttribute('data-map-ready')) === '1', {
    timeout: 15000,
    label: 'MapLibre ready',
  });
  const cameraOf = () =>
    a.evaluate(() => {
      const c = globalThis.__parkMapLibre?.getCenter?.();
      return c ? { lng: c.lng, lat: c.lat } : null;
    });
  const before = await until(async () => {
    const c = await cameraOf();
    if (!c) return null;
    return distance(here.lat, here.lng, c.lat, c.lng) < 80 ? c : null;
  }, { timeout: 8000, label: 'camera on this phone' });

  const box = await map.boundingBox();
  if (!box) throw new Error('map has no box');
  const startX = box.x + box.width * 0.5;
  const startY = box.y + box.height * 0.28;
  await a.mouse.move(startX, startY);
  await a.mouse.down();
  await a.mouse.move(startX + 140, startY + 90, { steps: 10 });
  await a.mouse.up();

  await until(async () => (await map.getAttribute('data-follow')) === '0', {
    timeout: 4000,
    label: 'free look paused Follow',
  });
  const panned = await cameraOf();
  if (!panned) throw new Error('no camera after the pan');
  const moved = distance(before.lat, before.lng, panned.lat, panned.lng);
  if (moved < 25) throw new Error(`pan did not move the camera (${moved.toFixed(0)} m)`);

  await until(async () => (await map.getAttribute('data-follow')) === '1', {
    timeout: FOLLOW_RESUME_MS + 2500,
    label: 'Follow snaps back after free look',
  });
  await until(async () => {
    const c = await cameraOf();
    return c && distance(here.lat, here.lng, c.lat, c.lng) < 80;
  }, { timeout: 4000, label: 'camera back on this phone' });
  return true;
});

await check('park-wide rest shows Zone names and ride names, not every Place', async () => {
  await until(() => a.locator('[data-testid="park-map-gl"][data-map-ready="1"]').count().then((n) => n >= 1), {
    timeout: 20000,
    label: 'map ready',
  });
  const names = await a.locator('svg.mapSvg .poiLabel').allTextContents();
  const zones = await a.locator('svg.mapSvg .landLabel').allTextContents();
  const discs = await a.locator('svg.mapSvg .poiMarker circle').count();
  const glyphs = await a.locator('svg.mapSvg .poiMarker path').count();
  const places = await a.locator('svg.mapSvg .poiMarker').count();
  if (discs < 1) throw new Error(`expected ride discs after declutter, got ${discs}`);
  if (glyphs < discs) throw new Error(`place icons missing glyphs (${glyphs} paths for ${discs} discs)`);
  if (zones.length < 1) throw new Error('park-wide map printed no Zone names');
  if (names.length < 1) throw new Error('park-wide map printed no ride names');
  if (names.some((n) => /restroom/i.test(n))) {
    throw new Error(`park-wide map named a restroom: ${names.filter((n) => /restroom/i.test(n)).join(', ')}`);
  }
  if (names.length >= places) {
    throw new Error(`park-wide map printed every place name (${names.length}/${places})`);
  }
  const typeRank = await a.evaluate(() => {
    const zone = document.querySelector('svg.mapSvg .landLabel');
    const labels = [...document.querySelectorAll('svg.mapSvg .poiLabel')];
    if (!zone || !labels.length) return { missing: true };
    const px = (el) => parseFloat(getComputedStyle(el).fontSize);
    const fills = [...new Set(labels.map((el) => el.style.fill || getComputedStyle(el).fill).filter(Boolean))];
    return {
      zonePx: px(zone),
      poiPx: Math.max(...labels.map(px)),
      zoneCase: getComputedStyle(zone).textTransform,
      zoneTracking: parseFloat(getComputedStyle(zone).letterSpacing) || 0,
      categoryFills: fills.length,
    };
  });
  if (typeRank.missing) throw new Error('park-wide map printed no Zone or Place names to rank');
  if (typeRank.zoneCase !== 'uppercase') throw new Error(`Zone names should be tracked caps, got ${typeRank.zoneCase}`);
  if (!(typeRank.zoneTracking > 0)) throw new Error('Zone names need letter-spacing the way Apple districts do');
  if (!(typeRank.zonePx > typeRank.poiPx)) {
    throw new Error(`Zone ${typeRank.zonePx}px should outrank Place ${typeRank.poiPx}px`);
  }
  if (typeRank.categoryFills < 2) {
    throw new Error(`Place names should wear more than one category ink, got ${typeRank.categoryFills}`);
  }
  const restLod = await a.evaluate(() => {
    const map = globalThis.__parkMapLibre;
    if (!map?.getLayer?.('world-building')) return { missing: true };
    return {
      zoom: map.getZoom(),
      building: map.getLayoutProperty('world-building', 'visibility'),
      service: map.getLayoutProperty('world-service', 'visibility'),
    };
  });
  if (restLod.missing) throw new Error('kings-island has buildings, so the layer must exist');
  if (restLod.zoom >= 15.3) {
    throw new Error(`park-wide zoom ${restLod.zoom} already past the SVG detail enter`);
  }
  if (restLod.building !== 'none') {
    throw new Error(`buildings drawn at park-wide z${restLod.zoom}`);
  }
  if (restLod.service !== 'none') {
    throw new Error(`service roads drawn at park-wide z${restLod.zoom}`);
  }
  await a.evaluate(() => {
    const map = globalThis.__parkMapLibre;
    map.jumpTo({ zoom: 16.2, center: map.getCenter() });
  });
  await until(async () => {
    const vis = await a.evaluate(() => globalThis.__parkMapLibre?.getLayoutProperty?.('world-building', 'visibility'));
    return vis === 'visible' ? true : false;
  }, { timeout: 10000, label: 'buildings after pinch' });
  await a.evaluate((zoom) => {
    const map = globalThis.__parkMapLibre;
    map.jumpTo({ zoom, center: map.getCenter() });
  }, restLod.zoom);
  return true;
});

await check('park-wide Zone labels do not overlap or clip at the viewport edge', async () => {
  await until(() => a.locator('[data-testid="park-map-gl"][data-map-ready="1"]').count().then((n) => n >= 1), {
    timeout: 20000,
    label: 'map ready',
  });
  const layout = await a.evaluate(() => {
    const svg = document.querySelector('svg.mapSvg');
    const labels = [...svg.querySelectorAll('.landLabel')];
    const rects = labels.map((el) => {
      const r = el.getBoundingClientRect();
      const root = svg.getBoundingClientRect();
      return {
        name: el.textContent?.trim() || '',
        x0: r.left - root.left,
        x1: r.right - root.left,
        y0: r.top - root.top,
        y1: r.bottom - root.top,
        width: root.width,
        height: root.height,
      };
    });
    const overlaps = [];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const one = rects[i];
        const two = rects[j];
        if (one.x0 < two.x1 && two.x0 < one.x1 && one.y0 < two.y1 && two.y0 < one.y1) {
          overlaps.push(`${one.name}/${two.name}`);
        }
      }
    }
    const clipped = rects.filter((r) => (
      r.x0 < 1 || r.y0 < 1 || r.x1 > r.width - 1 || r.y1 > r.height - 1
    ));
    return { overlaps, clipped: clipped.map((r) => r.name), count: rects.length };
  });
  if (layout.count < 1) throw new Error('park-wide map printed no Zone names');
  if (layout.overlaps.length) throw new Error(`Zone labels overlap: ${layout.overlaps.join(', ')}`);
  if (layout.clipped.length) throw new Error(`Zone labels clip viewport: ${layout.clipped.join(', ')}`);

  const before = await a.locator('svg.mapSvg .landLabel').count();
  await a.evaluate(() => {
    const map = globalThis.__parkMapLibre;
    map.panBy([36, 18], { duration: 0 });
  });
  await a.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const after = await a.locator('svg.mapSvg .landLabel').count();
  if (before > 0 && after === 0) throw new Error('Zone labels vanished on a small pan');
  const afterPan = await a.evaluate(() => {
    const svg = document.querySelector('svg.mapSvg');
    const labels = [...svg.querySelectorAll('.landLabel')];
    const rects = labels.map((el) => {
      const r = el.getBoundingClientRect();
      const root = svg.getBoundingClientRect();
      return {
        name: el.textContent?.trim() || '',
        x0: r.left - root.left,
        x1: r.right - root.left,
        y0: r.top - root.top,
        y1: r.bottom - root.top,
        width: root.width,
        height: root.height,
      };
    });
    const overlaps = [];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const one = rects[i];
        const two = rects[j];
        if (one.x0 < two.x1 && two.x0 < one.x1 && one.y0 < two.y1 && two.y0 < one.y1) {
          overlaps.push(`${one.name}/${two.name}`);
        }
      }
    }
    const clipped = rects.filter((r) => (
      r.x0 < 1 || r.y0 < 1 || r.x1 > r.width - 1 || r.y1 > r.height - 1
    ));
    return { overlaps, clipped: clipped.map((r) => r.name) };
  });
  if (afterPan.overlaps.length) throw new Error(`Zone labels overlap after pan: ${afterPan.overlaps.join(', ')}`);
  if (afterPan.clipped.length) throw new Error(`Zone labels clip after pan: ${afterPan.clipped.join(', ')}`);
  return true;
});

await check('the on-map OSM notice opens Settings straight to Credits, listing sourced attributions', async () => {
  const notice = a.locator('.mapAttribution');
  if (!(await notice.count())) throw new Error('no on-map OSM attribution notice');
  const text = (await notice.textContent())?.trim() || '';
  if (!/OpenStreetMap contributors/i.test(text)) throw new Error(`unexpected notice text: ${text}`);
  await notice.click();
  await until(
    async () => (await a.locator('.settingsTopic.on', { hasText: 'Credits' }).count()) > 0,
    { timeout: 8000, label: 'Credits topic selected after tap-through' },
  );
  const osmRow = a.locator('.rowList a.row', { hasText: 'OpenStreetMap contributors' });
  if (!(await osmRow.count())) throw new Error('Credits screen missing the OpenStreetMap row');
  const license = (await osmRow.locator('.rowValue').innerText()).trim();
  if (!/ODbL/.test(license)) throw new Error(`OpenStreetMap row missing its license: ${license}`);

  // A `credits-screen` row's credit line is the whole reason that row is on this
  // screen, so it has to be legible here — the generator emitting it into
  // credits.json is not the same as a guest being able to read it. The aerial
  // imagery Big Kahuna's paths are surveyed from is served through Esri, and the
  // owner's call is that the chain gets named rather than quietly re-pointed at a
  // compliant channel after the fact.
  const imageryRow = a.locator('.rowList a.row', { hasText: 'Okaloosa County' });
  if (!(await imageryRow.count())) throw new Error('Credits screen missing the aerial imagery row');
  const imageryText = (await imageryRow.first().innerText()).trim();
  if (!/served via Esri World Imagery/i.test(imageryText)) {
    throw new Error(`imagery row does not name its serving channel: ${imageryText}`);
  }
  if (!/Pictometry/i.test(imageryText)) {
    throw new Error(`imagery row does not name who flew it: ${imageryText}`);
  }
  // CC BY 4.0 requires the credit line, so ESA's must render for the same reason.
  // Unconditional on purpose: guarding this on the row existing would let the
  // check quietly pass if ESA ever fell out of the registry, which is the case
  // where a required attribution silently stops shipping.
  const esaRow = a.locator('.rowList a.row', { hasText: 'ESA WorldCover' });
  if (!(await esaRow.count())) throw new Error('Credits screen missing the ESA WorldCover row');
  const esaText = (await esaRow.first().innerText()).trim();
  if (!/©\s*ESA WorldCover project/i.test(esaText)) {
    throw new Error(`ESA WorldCover row missing its required CC BY credit line: ${esaText}`);
  }

  await a.locator('.tabItem[data-tab="explore"]').click();
  await a.waitForTimeout(200);
  return true;
});

// The rail's fallback cards were "nearest food / nearest toilet" over the map.
// Explore is search -> context -> list now (D24), so the browse list is what
// has to come up with something nearby when nothing has been asked for.
await check('the browse list opens on nearby places with no query typed', async () => {
  await go(a, 'Places');
  await until(async () => (await a.locator('.poiRow').count()) >= 2, {
    timeout: 15000,
    label: 'nearby rows in the browse list',
  });
  const rows = await a.locator('.poiRow').allInnerTexts();
  // A row without a walking time is a name in a list, not a nearby place.
  if (!rows.some((r) => /\bmin\b|\bft\b|\bmi\b|\bm\b/.test(r))) {
    throw new Error(`no ranges in the list: ${rows[0]?.replace(/\n/g, ' / ')}`);
  }
  return true;
});

await check('a GO NOW verdict in the list carries a Why? explanation', async () => {
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
  await until(async () => (await a.locator('.poiRow').count()) >= 2, {
    timeout: 15000,
    label: 'the browse list',
  });
  // useWeather only reads localStorage on mount; a bare fetch does not update
  // React state. `online` is the hook's public refresh signal (same as a phone
  // regaining signal). Retry while waiting — an in-flight poll can no-op once.
  //
  // The rail's GO NOW card carried the reason in a `title` on its hit area.
  // The status pill in the browse list is where that verdict is read now, and
  // it takes the same `st.detail` string from the same `liveFor` result — see
  // components/PlaceList.jsx.
  const goNowPill = a.locator('.poiRow .liveBadge.goNow[title]');
  const anyPill = a.locator('.poiRow .liveBadge[title]');
  await until(
    async () => {
      await a.evaluate(() => window.dispatchEvent(new Event('online')));
      return (await goNowPill.count()) > 0 || (await anyPill.count()) > 0;
    },
    { timeout: 20000, label: 'a live status pill carrying its reason' },
  );
  const pill = (await goNowPill.count()) > 0 ? goNowPill.first() : anyPill.first();
  const why = (await pill.getAttribute('title')) || '';
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

await check('wearing Pixel tycoon keeps the MapLibre map (OSM until a bake exists)', async () => {
  // A dedicated phone keeps the Wear off the other checks. The demo/store
  // grant (grantShipSkins, `parkbound-demo-skins`) unlocks the ship-polish
  // Skins without farming fog quests; the Wear itself is the real user action:
  // Me -> Settings -> Map -> Collection -> Pixel tycoon.
  // ADR-0021 clause 6 converted the kit off iso; guests see OSM until a
  // certified kings-island bake ships. Do not invent one.
  const P = await openPhone(browser, {
    lat: 39.34395,
    lng: -84.2673,
    name: 'Tycoon',
    label: 'TYCOON',
    venue: 'kings-island',
  });
  const p = P.page;
  try {
    await p.evaluate(() => localStorage.setItem('parkbound-demo-skins', '1'));
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => Boolean(document.querySelector('[data-testid="park-map-gl"]:not(.mapMissing) canvas')), null, {
      timeout: 40000,
    });
    await closeGate(p);
    await go(p, 'Collection');
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
    if (await p.locator('.lyr-iso-map').count()) {
      throw new Error('iso layer still drawn after pixel-tycoon conversion');
    }
    const canvas = await p.locator('[data-testid="park-map-gl"]:not(.mapMissing) canvas').count();
    if (!canvas) throw new Error('MapLibre canvas gone after Wear');
  } finally {
    await P.context.close();
  }
  return true;
});

await check('wearing Watercolor quest draws the baked world image under the overlay', async () => {
  // ADR-0016 slice 2: a worn Skin whose CUSTOM_MAPS entry declares a baked
  // world draws the display pack's world image on truth bounds, under the
  // live overlay — and hides no base layers, so the map survives a missing
  // image. Same demo-grant + Wear flow as the Pixel tycoon check above.
  const P = await openPhone(browser, {
    lat: 39.34395,
    lng: -84.2673,
    name: 'Baked',
    label: 'BW',
    venue: 'kings-island',
  });
  const p = P.page;
  try {
    await p.evaluate(() => localStorage.setItem('parkbound-demo-skins', '1'));
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => Boolean(document.querySelector('[data-testid="park-map-gl"] canvas') || document.querySelectorAll('svg.mapSvg circle').length), null, {
      timeout: 40000,
    });
    await closeGate(p);
    await go(p, 'Collection');
    const row = p.locator('.worldSkinRow .row', { hasText: 'Watercolor quest' }).first();
    await row.scrollIntoViewIfNeeded();
    if (/Locked|Out of season|This World/.test(await row.innerText())) {
      throw new Error('Watercolor quest still locked after demo grant');
    }
    await row.click();
    await p.waitForTimeout(500);
    if ((await p.evaluate(() => document.documentElement.dataset.skinMap)) !== 'watercolor-quest') {
      throw new Error('data-skin-map not set');
    }
    // data-baked-world is a React prop and can land before MapLibre's load.
    // The vector building layer is the proof the bake sat on top, not instead.
    await p.waitForSelector('[data-testid="park-map-gl"][data-baked-world$="watercolor-quest.world.png"][data-map-ready="1"]', { timeout: 20000 });
    const href = await p.locator('[data-testid="park-map-gl"]').getAttribute('data-baked-world');
    if (!href?.endsWith('watercolor-quest.world.png')) {
      throw new Error(`world image href is ${href}`);
    }
    const natural = await p.evaluate(async (src) => {
      const img = new Image();
      await new Promise((ok, fail) => {
        img.onload = ok;
        img.onerror = () => fail(new Error('world PNG failed to decode'));
        img.src = src;
      });
      return { w: img.naturalWidth, h: img.naturalHeight };
    }, href);
    if (!(natural.w > 0 && natural.h > 0)) throw new Error('world PNG has no pixels');
    await until(async () => {
      const layers = await p.evaluate(() => (globalThis.__parkMapLibre?.getStyle?.()?.layers || []).map((l) => l.id));
      return layers.includes('world-building') ? true : false;
    }, { timeout: 20000, label: 'vector building layer under the bake' });
  } finally {
    await P.context.close();
  }
  return true;
});

await check("wearing a Skin repaints the World's Zones from its own display pack", async () => {
  /* The approved principle, on a phone: a Skin restyles a Zone. Before the
     Visual factory owned Zone tone, every Skin of a World painted its Zones
     identically — the tints came from map truth (`meta.lands`) and the Skin
     was not an input at all. This asserts the output of the run: the same
     `world-lands` source, under two different worn looks, carries different
     feature tints, and the tints are the ones this World's published
     `<skin>.visual.json` says — not a table in app code and not a colour out
     of truth.

     The shipped renderer is MapLibre (ADR-0019/h18) — `svg.mapSvg path` and
     `.mapWorld .lyr-land path` are ParkMapSvg.jsx's retired DOM and never
     exist on this branch, so the assertion reads the real mechanism instead:
     the `world-lands` GeoJSON source's `tint` feature property, which
     `mapViewStyle.js`'s `lands` layer paints with
     `['coalesce', ['get','tint'], grassFill]`. */
  const P = await openPhone(browser, {
    lat: 39.34395,
    lng: -84.2673,
    name: 'Tones',
    label: 'TZ',
    venue: 'kings-island',
  });
  const p = P.page;
  try {
    await p.evaluate(() => localStorage.setItem('parkbound-demo-skins', '1'));
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => Boolean(document.querySelector('[data-testid="park-map-gl"] canvas')), null, {
      timeout: 40000,
    });
    await closeGate(p);
    await until(async () => {
      const layers = await p.evaluate(() => (globalThis.__parkMapLibre?.getStyle?.()?.layers || []).map((l) => l.id));
      return layers.includes('world-lands');
    }, { timeout: 20000, label: 'world-lands layer built' });

    // Zone tints as the source actually holds them, keyed by Zone name so a
    // feature reordered by a later `setData` still matches its own before.
    const zoneTints = () => p.evaluate(async () => {
      const source = globalThis.__parkMapLibre?.getSource?.('world-lands');
      if (!source) return null;
      const data = await source.getData();
      return Object.fromEntries(
        (data.features || [])
          .filter((f) => f.properties?.name)
          .map((f) => [f.properties.name, String(f.properties.tint || '').toUpperCase()]),
      );
    });
    const before = await zoneTints();
    if (!before || Object.keys(before).length < 5) {
      throw new Error(`expected Kings Island's Zones on world-lands, got ${JSON.stringify(before)}`);
    }

    await go(p, 'Collection');
    const row = p.locator('.worldSkinRow .row', { hasText: 'Watercolor quest' }).first();
    await row.scrollIntoViewIfNeeded();
    if (/Locked|Out of season|This World/.test(await row.innerText())) {
      throw new Error('Watercolor quest still locked after demo grant');
    }
    // Read the spec before wearing, because it is what the wait below waits
    // FOR. Waiting on "any tint changed" instead races the thing under test:
    // switching Skin re-runs landTint immediately, and with no tones in hand
    // yet that already repaints every Zone in the generated name-hue. The
    // wait would then fire on that fallback repaint and `worn` would be read
    // before the spec's fetch — and, before the app fix, before the retint
    // that pushes it into the already-built map — landed at all, reporting 0
    // Zone tints from the Skin on a build where the Skin paints all ten.
    const spec = await p.evaluate(async () => {
      const res = await fetch('/venues/kings-island/display/watercolor-quest.visual.json');
      return res.ok ? res.json() : null;
    });
    if (!spec) throw new Error('the World never published watercolor-quest.visual.json');
    const mode = spec.tokens?.mode === 'night' ? 'night' : 'day';
    const declared = [
      ...new Set(Object.values(spec.landTones || {}).map((byMode) => byMode?.[mode]?.fill).filter(Boolean)),
    ];
    if (declared.length < 5) throw new Error(`spec declares ${declared.length} Zone fills`);

    await row.click();
    // Wait for the tones the spec declares to be the ones on the source. A
    // Skin that never pushes its own palette into the live map — because the
    // mount race stuck it with the fallback and nothing corrected it after —
    // times out here instead of passing, which is the failure this check
    // exists to catch.
    const declaredUpper = declared.map((f) => f.toUpperCase());
    await until(async () => {
      const now = await zoneTints();
      if (!now) return false;
      const set = new Set(declaredUpper);
      return Object.values(now).filter((tint) => set.has(tint)).length >= 5;
    }, { timeout: 20000, label: "world-lands tints matching the Skin's declared spec" });
    const worn = await zoneTints();

    // Every tint the Skin painted is one its own published spec declares.
    const declaredSet = new Set(declaredUpper);
    const fromSpec = Object.values(worn).filter((tint) => declaredSet.has(tint));
    if (fromSpec.length < 5) {
      throw new Error(`only ${fromSpec.length} Zone tints came from the Skin's own spec`);
    }
    // …and they are genuinely a restyle, not the palette's own answer.
    const changed = Object.keys(worn).filter((name) => worn[name] !== before[name]).length;
    if (changed < 5) throw new Error(`wearing the Skin repainted only ${changed} Zones`);
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

/* ---- the anchored spot: bare ground -> capsule -> Side Quests / Marks ---- */

/* Its own phone, with a Profile written straight into the session the app
   reads (`resolveSession`). Not a shortcut around the sign-in: Clerk is off on
   CI and sandbox boxes, and without a Profile `stateOf` in WorldMarks answers
   "Sign in" before it ever reaches "Pick a spot" — the anchor gate this
   section exists to prove would be invisible behind the auth one. The id is
   minted per run because the Marks it drops land in the venue's world store,
   which outlives the browser this suite opens. */
console.log('\n--- phone SP: anchored spots ---');
const SPOT_FIX = { lat: 39.34395, lng: -84.2673 };
const spotAuthor = `usr_spot_${Date.now().toString(36)}`;
const SP = await openPhone(browser, {
  lat: SPOT_FIX.lat,
  lng: SPOT_FIX.lng,
  name: 'Spot',
  label: 'SP',
  venue: 'kings-island',
});
const sp = SP.page;
try {
  await sp.evaluate((userId) => {
    sessionStorage.setItem(
      'parkbound.session',
      JSON.stringify({ userId, email: `${userId}@parkbound.example`, displayName: 'Spot', rank: 'visitor', title: null, xp: 0 }),
    );
  }, spotAuthor);
  await sp.reload({ waitUntil: 'domcontentloaded' });
  await hydrated(sp);
  await closeGate(sp);

  /* Every check below reads the capsule for itself and holds the strings it
     read. The claim being tested is that the screen the capsule opens says the
     same thing about the same patch of ground, so the two readings have to
     come from one tap — never from a remembered one. */
  const readCapsule = async () => {
    const capsule = sp.locator('.spotCapsule');
    await capsule.waitFor({ state: 'visible', timeout: 10000 });
    // name, then "Zone · nearest named thing", then "N min walk · N ft" —
    // the last two are dropped by SpotCapsule when it has nothing to say.
    const context = (await capsule.locator('.spotZone').innerText().catch(() => '')).trim();
    const reach = (await capsule.locator('.spotReach').innerText().catch(() => '')).trim();
    return {
      name: (await capsule.locator('.spotName').innerText()).trim(),
      context,
      zone: context.split(' · ')[0] || '',
      near: context.split(' · ')[1] || '',
      dist: reach.split(' · ')[1] || '',
      reach,
    };
  };

  await check('tapping bare ground names the spot from the venue data', async () => {
    await ensurePeek(sp);
    await tapBareGround(sp);
    const spot = await readCapsule();

    // `spotAt` has two words for a tap and no third: inside SPOT_NEAR_M it is
    // "By <the Place>", beyond it the ground is open.
    if (!/^(By .+|Open ground)$/.test(spot.name)) throw new Error(`spot name reads "${spot.name}"`);
    if (!spot.zone) throw new Error(`no Zone on the capsule: "${spot.context}"`);
    if (!spot.dist) throw new Error(`no walk on the capsule: "${spot.reach}"`);

    /* The name and the Zone have to be the venue's, not a placeholder that
       happens to be a string. The nearest named thing is the one record this
       capsule and the Explore list both read, so ask the list: its row for
       that Place must stand in the Zone the capsule just claimed. */
    const neighbour = spot.name.startsWith('By ')
      ? spot.name.slice(3)
      : spot.near.replace(/^.*\bfrom\s+/, '');
    if (!neighbour) throw new Error(`capsule named nothing nearby: "${spot.context}"`);
    await go(sp, 'Places');
    await searchPlaces(sp, neighbour);
    const row = sp.locator('.poiRow', { hasText: neighbour }).first();
    await row.waitFor({ state: 'visible', timeout: 15000 });
    const rowText = (await row.innerText()).replace(/\n/g, ' ');
    if (!rowText.includes(`· ${spot.zone}`)) {
      throw new Error(`the list puts ${neighbour} somewhere else: "${rowText}" vs capsule "${spot.context}"`);
    }
    await clearSearch(sp);
    await ensurePeek(sp);
    return true;
  });

  await check('Side Quest here carries the spot into Side Quests', async () => {
    // Tabbing away and back leaves the capsule up, so the one the last check
    // dropped is usually still here; drop another if anything took it away.
    if (!(await sp.locator('.spotCapsule').count())) {
      await ensurePeek(sp);
      await tapBareGround(sp);
    }
    const spot = await readCapsule();
    await sp.locator('.spotCapsule button:has-text("Side Quest here")').click();
    await until(async () => (await sp.evaluate(() => document.querySelector('.tabItem.on')?.dataset.tab)) === 'quests', {
      timeout: 10000,
      label: 'Side Quests to open from the capsule',
    });
    const banner = sp.locator('[aria-label="Quest spot"]');
    await banner.waitFor({ state: 'visible', timeout: 10000 });
    const line = (await banner.locator('b').innerText()).trim();
    // SpotBanner says the same spot in one line: name · Zone.
    if (line !== `${spot.name} · ${spot.zone}`) {
      throw new Error(`Side Quests is anchored to "${line}", the capsule said "${spot.name} · ${spot.zone}"`);
    }
    if (await sp.locator('.spotCapsule').count()) throw new Error('the capsule stayed up behind the screen it opened');
    return true;
  });

  await check('Marks stay inert until a spot anchors them', async () => {
    // Arrived by the tab bar rather than by a tap on the ground: no anchor,
    // and placement is the one thing this screen must not offer.
    await go(sp, 'Collection');
    await sp.locator('.worldCloset .row:has-text("Marks")').click();
    const rows = sp.locator('.markList.placeable .markRow');
    await rows.first().waitFor({ state: 'visible', timeout: 10000 });
    const states = await sp.locator('.markList.placeable .markState').allInnerTexts();
    if (states.length !== 2 || states.some((s) => s.trim() !== 'Pick a spot')) {
      throw new Error(`un-anchored rows read ${JSON.stringify(states)}`);
    }
    const disabled = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('aria-disabled')));
    if (disabled.some((d) => d !== 'true')) throw new Error(`rows announce as ${JSON.stringify(disabled)}`);
    // Forced, because Playwright honours aria-disabled and would never let a
    // real thumb through either — the point is what happens if one does.
    await rows.first().click({ force: true });
    await sp.waitForTimeout(400);
    if (await sp.locator('.markPhrases').count()) throw new Error('a sign phrase list opened with no spot to stand on');
    const after = await sp.locator('.markList.placeable .markState').allInnerTexts();
    if (after.some((s) => /Placed/.test(s))) throw new Error(`an un-anchored row placed a Mark: ${JSON.stringify(after)}`);

    /* The other four Marks are inert by design — a tally of what this Profile
       earned (`marksByType`), with nothing to tap. Signed in they are numbers;
       the em dash belongs to a phone with no Profile to count for. */
    const earned = await sp.locator('.earnedList .markCount').allInnerTexts();
    if (earned.length !== 4 || earned.some((n) => !/^\d+$/.test(n.trim()))) {
      throw new Error(`the earned tally reads ${JSON.stringify(earned)}`);
    }
    return true;
  });

  await check('Leave a Mark places a Mark at the tapped spot', async () => {
    await ensurePeek(sp);
    await tapBareGround(sp);
    const spot = await readCapsule();
    await sp.locator('.spotCapsule button:has-text("Leave a Mark")').click();
    const marks = sp.locator('.worldMarks');
    await marks.waitFor({ state: 'visible', timeout: 15000 });
    const line = (await marks.locator('.spotBanner b').innerText()).trim();
    if (line !== `${spot.name} · ${spot.zone}`) {
      throw new Error(`Marks is anchored to "${line}", the capsule said "${spot.name} · ${spot.zone}"`);
    }

    // The gate the whole feature turns on: the same two rows, now placeable.
    const states = await sp.locator('.markList.placeable .markState').allInnerTexts();
    if (states.length !== 2 || states.some((s) => s.trim() !== 'Place')) {
      throw new Error(`anchored rows read ${JSON.stringify(states)}`);
    }
    if (((await sp.locator('.markList.placeable').getAttribute('class')) || '').includes('unanchored')) {
      throw new Error('the anchored list still draws as unanchored');
    }

    const beacon = sp.locator('.markList.placeable .markRow', { hasText: 'Beacon' }).first();
    await beacon.click();
    await until(async () => /Placed/.test((await beacon.locator('.markState').innerText()) || ''), {
      timeout: 10000,
      label: 'the beacon to read Placed',
    });
    const foot = (await sp.locator('.markFoot').innerText()).trim();
    if (!foot.includes('Beacon standing') || !foot.includes(spot.zone)) {
      throw new Error(`the screen does not say where the Beacon stands: "${foot}"`);
    }

    /* And it stands where the visitor tapped, not where the phone is. The
       venue's world store is the far end of the chain that started with a tap
       on bare ground, so read the Mark back out of it and measure: the same
       range the capsule printed, from the same fix, to the coordinate the
       Mark was filed at. */
    const world = await (await fetch(`${BASE}/api/world/kings-island`)).json();
    const mine = (world?.world?.marks || []).filter((m) => m.authorId === spotAuthor);
    if (mine.length !== 1) throw new Error(`world store holds ${mine.length} Marks for this run`);
    const [mark] = mine;
    if (mark.type !== 'beacon') throw new Error(`filed a ${mark.type}`);
    const away = formatDistance(distance(SPOT_FIX.lat, SPOT_FIX.lng, mark.lat, mark.lng));
    if (away !== spot.dist) {
      throw new Error(`the Mark is ${away} from the phone, the capsule said the spot was ${spot.dist}`);
    }
    // "By …" is spotAt's word for a tap inside SPOT_NEAR_M of a Place, and
    // only that spot carries a Place id for the Mark to be filed against.
    if (spot.name.startsWith('By ') && !mark.placeId) {
      throw new Error(`"${spot.name}" filed with no Place id`);
    }
    return true;
  });
} finally {
  await SP.context.close().catch(() => {});
}

/* The sheet is pulled by its whole surface, not only by its handle — see
   components/useSheetDrag.js. That makes the list inside it and the sheet
   itself two things one finger could mean, so the drag asks, once per
   gesture, which of them the swipe belongs to: the list keeps it while the
   list can still scroll that way, and the sheet takes it at the ends of the
   travel. Both halves are asserted here because only the second one can
   regress quietly — a sheet that moves when the list should have scrolled
   still looks like a working sheet. */
console.log('\n--- pulling the sheet ---');

const sheetHeight = () =>
  a.evaluate(() => Math.round(document.querySelector('.sheet').getBoundingClientRect().height));

async function swipeSheetBody(dy, steps = 12) {
  const box = await a.locator('.sheetBody').boundingBox();
  if (!box) throw new Error('the sheet body is not on screen to swipe');
  const x = box.x + box.width / 2;
  const y = box.y + 40;
  await a.mouse.move(x, y);
  await a.mouse.down();
  for (let i = 1; i <= steps; i++) await a.mouse.move(x, y + (dy * i) / steps);
  await a.mouse.up();
  await a.waitForTimeout(700);
}

await check('a swipe on the body pulls the sheet, not just the handle', async () => {
  await a.evaluate(() => {
    document.querySelector('.sheetBody').scrollTop = 0;
  });
  await a.waitForTimeout(200);
  const before = await sheetHeight();
  await swipeSheetBody(160); // downwards: the sheet should shrink
  const after = await sheetHeight();
  if (after >= before) throw new Error(`the sheet held at ${after}px instead of shrinking from ${before}px`);
  return true;
});

await check('a swipe part-way down the list scrolls the list and leaves the sheet where it is', async () => {
  // Back to a middle height, so the sheet has somewhere to go if it wrongly
  // takes the gesture: a test run at the end of the travel would pass on a
  // sheet that was simply clamped.
  await a.locator('.grab').focus();
  await a.keyboard.press('End');
  await a.waitForTimeout(500);
  for (let i = 0; i < 4; i++) await a.keyboard.press('ArrowDown');
  await a.waitForTimeout(700);
  await a.evaluate(() => {
    document.querySelector('.sheetBody').scrollTop = 400;
  });
  await a.waitForTimeout(200);
  const scrolled = await a.evaluate(() => document.querySelector('.sheetBody').scrollTop);
  if (scrolled <= 0) throw new Error('the list did not scroll, so there is nothing to arbitrate');
  const before = await sheetHeight();
  await swipeSheetBody(160); // downwards, with the list able to scroll back up
  const after = await sheetHeight();
  if (after !== before) throw new Error(`the sheet moved ${before}px -> ${after}px on a swipe the list owned`);
  return true;
});

// Leave the sheet where the rest of the run expects to find it.
await a.locator('.grab').focus();
await a.keyboard.press('End');
await a.waitForTimeout(500);
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
  // "With an adult along" — the chip says the whole sentence now; "With adult"
  // is the section label above it, and is not a chip.
  await a.locator('.chip:has-text("With an adult along")').click();
  await a.waitForTimeout(400);
  const without = await a.locator('.ratioKey .warn b').innerText();
  if (withAdult === without) throw new Error(`companion count unchanged: ${withAdult}`);
  // "With an adult along" — the chip says the whole sentence now; "With adult"
  // is the section label above it, and is not a chip.
  await a.locator('.chip:has-text("With an adult along")').click();
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

await check('a narrow phone opens place detail tall enough for two action rows', async () => {
  const { sheetPlacePx } = await import('../../apps/party-tracker/lib/sheet.js');
  const beast = { latitude: 39.340154, longitude: -84.266027 };
  const phone = await openPhone(browser, {
    lat: beast.latitude,
    lng: beast.longitude,
    label: 'NARROW',
    venue: 'kings-island',
    viewport: { width: 375, height: 844 },
  });
  const p = phone.page;
  try {
    for (let i = 0; i < 4; i += 1) {
      const form = await p.locator('.sheet').evaluate((e) =>
        ['peek', 'half', 'full', 'shut'].find((s) => e.classList.contains(s)) || null,
      );
      if (form === 'peek') break;
      await p.getByRole('slider', { name: /Resize panel/ }).click();
      await p.waitForTimeout(350);
    }
    await until(() => p.locator('[data-testid="park-map-gl"] canvas').count().then((n) => n >= 1), {
      timeout: 20000,
      label: 'park geometry',
    });
    try {
      await tapMapPoi(p, 'The Beast', { timeout: 8000 });
    } catch {
      await tapMapPoi(p, null, { timeout: 12000 });
    }
    await until(async () => (await p.locator('[data-place-detail]').count()) > 0, {
      timeout: 12000,
      label: 'place detail sheet',
    });
    const budget = sheetPlacePx(375);
    const sheetH = Number(
      await p.locator('.app').evaluate((el) =>
        parseFloat(getComputedStyle(el).getPropertyValue('--sheetH')),
      ),
    );
    if (sheetH < budget) throw new Error(`sheet ${sheetH}px < narrow budget ${budget}px`);
    const rally = p.locator('[data-place-detail]').getByRole('button', { name: 'Rally here', exact: true });
    if (!(await rally.isVisible())) throw new Error('Rally here not visible without scroll');
    const rallyBox = await rally.boundingBox();
    const sheetBox = await p.locator('.sheet').boundingBox();
    if (!rallyBox || !sheetBox) throw new Error('missing layout boxes');
    if (rallyBox.y + rallyBox.height > sheetBox.y + sheetBox.height + 2) {
      throw new Error('Rally here sits below the sheet stop');
    }
    return true;
  } finally {
    await phone.context.close();
  }
});

await check('tapping a map icon opens place details and navigation', async () => {
  // After smoke/heights, phone A is mid-filter and mid-sheet. A tap on its
  // overlay pin misses MapLibre's hit-test. A fresh phone at the station
  // is the walk this check owns.
  const beast = { latitude: 39.340154, longitude: -84.266027 };
  const phone = await openPhone(browser, {
    lat: beast.latitude,
    lng: beast.longitude,
    label: 'WALK',
    venue: 'kings-island',
  });
  const p = phone.page;
  try {
    const stop = () =>
      p.locator('.sheet').evaluate((e) =>
        ['peek', 'half', 'full', 'shut'].find((s) => e.classList.contains(s)) || null,
      );
    for (let i = 0; i < 4 && (await stop()) !== 'peek'; i += 1) {
      await p.getByRole('slider', { name: /Resize panel/ }).click();
      await p.waitForTimeout(350);
    }
    await until(() => p.locator('[data-testid="park-map-gl"] canvas').count().then((n) => n >= 1), {
      timeout: 20000,
      label: 'park geometry',
    });
    let name;
    try {
      name = await tapMapPoi(p, 'The Beast', { timeout: 8000 });
    } catch {
      name = await tapMapPoi(p, null, { timeout: 12000 });
    }
    await until(async () => (await p.locator('[data-place-detail]').count()) > 0, {
      timeout: 12000,
      label: 'place detail sheet',
    });
    const title = await p.locator('.placeDetailName').innerText();
    if (title !== name) throw new Error(`title "${title}" vs marker "${name}"`);
    const goBtn = p
      .locator('[data-place-detail]')
      .getByRole('button', { name: 'Walk me there', exact: true });
    if (!(await goBtn.count())) throw new Error('no navigate control on place detail');
    await goBtn.click();
    await p.waitForTimeout(900);
    if (!(await p.locator('.routePreview').count())) throw new Error('no route preview from map tap');
    await p.locator('.previewLink:has-text("Cancel")').click().catch(() => {});
    return true;
  } finally {
    await phone.context.close();
  }
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
// assume Kings Island GPS (Beast arrival, browse list, party rides), so leave
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

// The rail's Go button started a walk and the card then wore `.walking`. The
// list row's own `Walk me there` is that button now, and the walking state is
// the nav chrome itself — NavBanner at the top, NavBar at the foot (D11).
await check('a list row walks you to a place and stops again', async () => {
  await A.context.setGeolocation({ latitude: 39.34395, longitude: -84.2673 });
  await a.waitForTimeout(1200);
  await go(a, 'Places');
  await until(async () => (await a.locator('.poiRow .poiMain').count()) > 0, {
    timeout: 15000,
    label: 'the browse list',
  });
  await a.locator('.poiRow .poiMain').first().click();
  const goBtn = a.locator('.poiRow.open button[aria-label="Walk me there"]').first();
  await until(async () => (await goBtn.count()) > 0, { timeout: 15000, label: 'the row’s Walk button' });
  await goBtn.click();
  await until(async () => (await a.locator('.routePreview').count()) > 0, {
    timeout: 15000,
    label: 'route preview from the row’s Walk button',
  });
  await a.locator('.previewGo').click();
  await until(async () => (await a.locator('.navBanner, .navBar').count()) > 0, {
    timeout: 20000,
    label: 'the walking chrome',
  });
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
  await until(async () => (await a.locator('.questCard').count()) > 0, {
    timeout: 15000,
    label: 'side quest rows',
  });
  if (!profileReady) {
    // ADR-0010: gap Side Quests need a Profile; CI has no Clerk — assert the soft gate.
    const reportBtn = a.locator('.questCard').first().locator('button.questAction');
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
  const reportBtn = a.locator('.questCard').first().locator('button.questAction, button[aria-expanded]');
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
  if ((await a.locator('.sideQuestSubmit').count()) > 0 && (await a.locator('.questCard .sideQuestSubmit').count()) > 0) {
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
  await until(async () => (await a.locator('.questCard').count()) > 0, {
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

  const heightRow = a.locator('.questCard', { hasText: 'Confirm height on the sign' });
  await until(async () => (await heightRow.count()) > 0, { timeout: 10000, label: 'height gap quest' });
  const reportBtn = heightRow.locator('button.questAction');
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
  await until(async () => (await a.locator('.questCard').count()) > 0, {
    timeout: 15000,
    label: 'side quest rows',
  });
  const heightRow = a.locator('.questCard', { hasText: 'Confirm height on the sign' });
  await until(async () => (await heightRow.count()) > 0, {
    timeout: 10000,
    label: 'height gap quest',
  });
  const reportBtn = heightRow.locator('button.questAction');
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
  const liveRow = a.locator('.questCard', { hasText: 'Ride up or down?' });
  await until(async () => (await liveRow.count()) > 0, { timeout: 10000, label: 'live ride quest' });
  const reportBtn = liveRow.locator('button.questAction');
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

  // Me is a root now: the journey is the screen, not a card three blocks
  // inside Settings, and the ladder is open rather than behind a toggle.
  await go(a, 'Me');
  await until(async () => (await a.locator('.profileJourney').count()) > 0, {
    timeout: 10000,
    label: 'journey on the Me root',
  });
  if ((await a.locator('.profileJourney .titleProgress .titleProgressFill').count()) < 1) {
    throw new Error('Me journey hero has no XP bar');
  }

  await until(async () => (await a.locator('.journeyStep').count()) === 5, {
    timeout: 5000,
    label: 'five Title ladder steps',
  });
  const ladder = await a.locator('.journeyLadder').innerText();
  for (const title of ['Visitor', 'Scout', 'Ranger', 'Cartographer', 'Steward']) {
    if (!ladder.includes(title)) throw new Error(`ladder is missing ${title}: ${ladder.slice(0, 160)}`);
  }
  const stats = await a.locator('[data-journey-stats]').innerText();
  if (!/contribution/i.test(stats) || !/guest/i.test(stats)) {
    throw new Error(`field stats missing: ${stats.slice(0, 120)}`);
  }

  // Finder credit is on by default, and the switch answers a tap both ways.
  // It moved to Settings -> You, under the name field it is about.
  await go(a, 'Settings');
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

/* The card leads with the walk, not the range, and carries the compass point
   beside the Place. Asserted as two separate things on purpose: the old
   `/\d+\s*(ft|mi)/` still passes against "3 min" — "mi" is inside "min" — so it
   would have gone on reporting green after the rail stopped showing a distance
   at all. */
await check('roster shows a real walk and bearing to phone B', async () => {
  const t = await until(
    async () => {
      const row = await a.locator('.memberRow', { hasText: 'Ava' }).first().innerText();
      const walk = /(\d+|<1)\s*min\b/.test(row);
      const bearingShown = /(^|\s|·)(N|NE|E|SE|S|SW|W|NW)(\s|$)/.test(row);
      return walk && bearingShown ? row : null;
    },
    { timeout: JOIN_TIMEOUT, label: 'a walk and a bearing to phone B' },
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

await check('the logo splash opens first and a tap moves to the welcome gate', async () => {
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
  if (await p.locator('.authGate').count()) {
    throw new Error('Profile gate must not sit in front of the splash');
  }
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
  await p.locator('.gate:has(#intro-notes-title) .btn').click();
  await until(async () => (await p.locator('#intro-splash-title').count()) > 0, {
    timeout: 8000,
    label: 'back to the splash',
  });
  // Fresh open: nothing has been scrolled yet, so the footer's move-on
  // control is still labelled Skip intro.
  const advance = p.locator('.gate:has(#intro-splash-title) .introSkip');
  if ((await advance.innerText()).trim() !== 'Skip intro') {
    throw new Error('unread intro should offer Skip intro, not Get started');
  }
  await advance.click();
  await until(
    async () =>
      (await p.locator('#intro-splash-title').count()) === 0 &&
      (await p.locator('.gate h2').count()) > 0,
    { timeout: 10000, label: 'welcome after skipping the intro' },
  );
  const next = (await p.locator('.gate h2').innerText()).trim();
  if (next !== 'Plan your day') throw new Error(`tap advanced to: "${next}"`);
  await fresh.close();
  return true;
});

await check('GPS already granted still reaches the welcome gate after the splash', async () => {
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
  await hydrated(p);
  await until(async () => (await p.locator('#intro-splash-title').count()) > 0, {
    timeout: 10000,
    label: 'the logo splash',
  });
  // A returning phone — often already signed in — usually has GPS on before
  // the splash yields; closing the gate on 'live' used to skip the welcome step.
  await p.locator('.gate:has(#intro-splash-title) .introSkip').click();
  await until(
    async () => {
      if (!(await p.locator('.gate h2').count())) return false;
      const heading = (await p.locator('.gate h2').innerText()).trim();
      return heading === 'Plan your day';
    },
    { timeout: 10000, label: 'welcome gate after splash with GPS already on' },
  );
  await fresh.close();
  return true;
});

await check('the welcome gate greets a signed-in Profile by name after the intro', async () => {
  const fresh = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
    geolocation: { latitude: 30.2672, longitude: -97.7431 },
  });
  await fresh.addInitScript(() => {
    localStorage.removeItem('tracker-intro-seen');
    sessionStorage.setItem(
      'parkbound.session',
      JSON.stringify({
        userId: 'usr_test',
        email: 'ava@parkbound.example',
        displayName: 'Ava',
        rank: 'visitor',
        xp: 0,
      }),
    );
  });
  const p = await fresh.newPage();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await hydrated(p);
  await until(async () => (await p.locator('#intro-splash-title').count()) > 0, {
    timeout: 10000,
    label: 'the logo splash',
  });
  // The intro is the same brand story for every guest — the personal
  // greeting belongs to the welcome gate one screen later, not this one.
  const heading = (await p.locator('#intro-splash-title').innerText()).trim();
  if (heading !== 'PARKBOUND') throw new Error(`intro heading should stay generic: "${heading}"`);
  await p.locator('.gate:has(#intro-splash-title) .introSkip').click();
  await until(
    async () => {
      if (!(await p.locator('.gate h2').count())) return false;
      const heading = (await p.locator('.gate h2').innerText()).trim();
      return heading === 'Plan your day, Ava';
    },
    { timeout: 10000, label: 'welcome gate with Profile name' },
  );
  await fresh.close();
  return true;
});

await check(
  'the intro is a scroll story: Skip becomes Get started once read, and a returning guest never sees it',
  async () => {
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
    await hydrated(p);
    await until(async () => (await p.locator('#intro-splash-title').count()) > 0, {
      timeout: 10000,
      label: 'the intro',
    });

    // The scroll story itself: the three claims from lib/brand.js, unread.
    const scroll = p.locator('.introScroll');
    const firstClaim = INTRO_CLAIMS[0];
    const claimTitle = (
      await p.locator('.introClaimTitle').first().innerText()
    ).trim();
    if (claimTitle !== firstClaim.title) {
      throw new Error(`first claim reads "${claimTitle}", expected "${firstClaim.title}"`);
    }
    const before = p.locator('.gate:has(#intro-splash-title) .introSkip');
    if (!(await before.count())) throw new Error('unread intro should show Skip intro');
    if (await p.locator('.gate:has(#intro-splash-title) .introStart').count()) {
      throw new Error('Get started should not be offered before the story is read');
    }

    // The progress dots: one per claim, lighting in order as each claim is
    // reached. Thresholds are measured from real layout (not a formula on
    // claim count), so this drives the assertion off the actual DOM —
    // scrolling each claim to centre and checking its own dot lights, with
    // no dot for a claim further down the story lit early — rather than
    // hardcoding the fractions at which that happens.
    const claimCount = await p.locator('.introClaim').count();
    if (claimCount !== INTRO_CLAIMS.length) {
      throw new Error(`expected ${INTRO_CLAIMS.length} claims, found ${claimCount}`);
    }
    const dotsAtRest = await p
      .locator('.introDot')
      .evaluateAll((els) => els.map((el) => el.classList.contains('on')));
    if (dotsAtRest.length !== claimCount) {
      throw new Error(`expected ${claimCount} dots, found ${dotsAtRest.length}`);
    }
    if (dotsAtRest.every(Boolean)) {
      throw new Error('every dot is already lit before any scrolling happened');
    }
    for (let i = 0; i < claimCount; i++) {
      // scrollIntoView centres the claim exactly — which can land within a
      // sub-pixel of the app's own measured threshold for that same centred
      // position (two independent centring calculations rounding a hair
      // apart). An 8px nudge past centre clears that without meaningfully
      // risking the next claim's own threshold: the gap between successive
      // claims measures in the hundreds of pixels on a phone-sized story.
      await p.locator('.introClaim').nth(i).evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await p.locator('.introScroll').evaluate((el) => {
        el.scrollTop = Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + 8);
      });
      await until(
        async () => {
          const states = await p
            .locator('.introDot')
            .evaluateAll((els) => els.map((el) => el.classList.contains('on')));
          return states[i] === true;
        },
        { timeout: 4000, label: `dot ${i + 1} lights once claim ${i + 1} is centred` },
      );
      const states = await p
        .locator('.introDot')
        .evaluateAll((els) => els.map((el) => el.classList.contains('on')));
      for (let j = i + 1; j < claimCount; j++) {
        if (states[j]) {
          throw new Error(
            `dot ${j + 1} lit before claim ${j + 1} was reached (states: ${JSON.stringify(states)})`,
          );
        }
      }
    }

    // The flip trails the last dot rather than coinciding with it: right at
    // the scroll position where the last claim's own dot just lit (still
    // inside the read-margin buffer), Skip intro must still be the offer —
    // this fails if the flip ever regresses to firing on the same frame as
    // the last dot.
    if (!(await p.locator('.gate:has(#intro-splash-title) .introSkip').count())) {
      throw new Error('Get started appeared at the same scroll position the last dot lit');
    }

    // The flip must not linger near the very bottom either: sample a point
    // derived from where the last claim's own centre actually measured
    // (not a hardcoded scroll fraction) — comfortably past that centre, but
    // comfortably short of the end of the story. 50px clears the read
    // margin with room to spare against sub-pixel rounding, and this
    // viewport leaves tens of pixels of story after the last claim's
    // centre for the sample to land short of the floor. This is what a
    // threshold drifting back toward "only flips essentially at the floor"
    // — the defect this suite exists to guard against — would catch.
    await p.locator('.introClaim').last().evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const lastClaimCentreTop = await scroll.evaluate((el) => el.scrollTop);
    const midReadPoint = await scroll.evaluate((el, base) => {
      const scrollable = el.scrollHeight - el.clientHeight;
      return { scrollTop: Math.min(scrollable, base + 50), scrollable };
    }, lastClaimCentreTop);
    if (midReadPoint.scrollable - midReadPoint.scrollTop < 15) {
      throw new Error(
        `sample point ${midReadPoint.scrollTop} leaves only ${midReadPoint.scrollable - midReadPoint.scrollTop}px ` +
          'before the floor — too close to distinguish this check from the full-scroll one below',
      );
    }
    await scroll.evaluate((el, st) => {
      el.scrollTop = st;
      el.dispatchEvent(new Event('scroll'));
    }, midReadPoint.scrollTop);
    await until(
      async () => (await p.locator('.gate:has(#intro-splash-title) .introStart').count()) > 0,
      {
        timeout: 4000,
        label: `Get started well short of the floor (scrollTop=${midReadPoint.scrollTop} of ${midReadPoint.scrollable})`,
      },
    );

    // Scroll to the end of the story — the footer should flip on its own,
    // with no click needed.
    await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event('scroll'));
    });
    await until(
      async () => (await p.locator('.gate:has(#intro-splash-title) .introStart').count()) > 0,
      { timeout: 10000, label: 'Get started once the story is read' },
    );
    if (await p.locator('.gate:has(#intro-splash-title) .introSkip').count()) {
      throw new Error('Skip intro should be gone once the story is read');
    }

    await p.locator('.gate:has(#intro-splash-title) .introStart').click();
    await until(async () => (await p.locator('#intro-splash-title').count()) === 0, {
      timeout: 10000,
      label: 'Get started moves on',
    });
    await fresh.close();

    // A returning guest — intro already marked seen — never sees any of this.
    const back = await browser.newContext({
      viewport: { width: 390, height: 844 },
      permissions: ['geolocation'],
      geolocation: { latitude: 30.2672, longitude: -97.7431 },
    });
    await back.addInitScript(() => {
      localStorage.setItem('tracker-intro-seen', '1');
    });
    const p2 = await back.newPage();
    await p2.goto(BASE, { waitUntil: 'domcontentloaded' });
    await hydrated(p2);
    await p2.waitForTimeout(1500);
    if (await p2.locator('#intro-splash-title').count()) {
      throw new Error('a returning guest saw the intro again');
    }
    await back.close();
    return true;
  },
);

await dismissIntroSplash(e);
await dismissUpdateSplash(e);

await check('the welcome gate is step one of two: what the app is for, and the ask', async () => {
  const card = await e.locator('.gate').innerText();
  const heading = (await e.locator('.gate h2').innerText()).trim();
  // The brand lockup moved to the intro, which is the screen before this one.
  // This card leads with what the day looks like and what it needs to do it.
  if (heading !== 'Plan your day') throw new Error(`opened on: "${heading}"`);
  if (!/1 OF 2/.test(card)) {
    throw new Error('the welcome gate should say it is the first of two steps');
  }
  const pitch = /World|Party|plan/i.test(card);
  if (!pitch) throw new Error('the welcome gate is missing its pitch');
  if (!/m ready/.test(card)) {
    throw new Error('the welcome gate should offer the nearest World on the first card');
  }
  if (!/stays on your phone/i.test(card)) {
    throw new Error('the gate that asks for GPS must still say where the fix goes');
  }
  const drawn = await e.locator('[data-testid="park-map-gl"] canvas, svg.mapSvg circle').count();
  if (!drawn) throw new Error('map looked empty behind the gate');
  // Off-site GPS may not project a puck until the park is confirmed; map
  // geometry behind the gate is the vertical intake guarantee.
  return true;
});

await check('the nearest-park button asks before building that park', async () => {
  await e.locator('button:has-text("m ready")').click();
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
  // Distance is its own column in the row now, so it reads bare: the word
  // "away" was carrying a column heading's worth of meaning inside the text.
  const row = p.locator('.gate .venueRow', { hasText: 'Kings Island' });
  const other = await row.innerText();
  if (!/\d+ mi/i.test(other)) throw new Error(`other park row: "${other}"`);
  const away = (await row.locator('.venueAway').innerText()).trim();
  if (!/^[\d,]+ mi$/.test(away)) throw new Error(`distance column: "${away}"`);
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
      // Clear a residual location/welcome gate. Read the brand with
      // textContent, not innerText: the intake gate hides the chrome behind it
      // (.app[data-gate-map] in globals.css, because the design draws the gate
      // over the park and nothing else), and innerText returns '' for anything
      // not rendered. The old peek used innerText and so could never satisfy
      // its own guard once that landed — it waited for text it had just made
      // invisible, and the gate it was meant to dismiss stayed up.
      if ((await e.locator('.gate').count()) > 0) {
        const brandPeek = await e
          .locator('.brandName, .brand b')
          .first()
          .evaluate((el) => el.textContent || '')
          .catch(() => '');
        if (/fiesta texas/i.test(brandPeek)) {
          await e.locator('.gate button:has-text("Just browsing")').click().catch(() => {});
          await e.locator('.gate button:has-text("Just show me the map")').click().catch(() => {});
          await e.locator('button:has-text("Allow location")').click().catch(() => {});
        }
      }
      // Both halves, so this still proves what it always did: the venue survived
      // the reload AND it is on screen rather than merely in the DOM.
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
  const drawn = await p.locator('[data-testid="park-map-gl"] canvas, svg.mapSvg circle').count();
  if (!drawn) throw new Error('map did not draw after picking a park');
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
// Best-effort teardown, not an assertion under test: this phone is about to
// have its whole context closed regardless, so a click that times out here
// (#596) must become a swallowed rejection, not an uncaught one that kills
// the entire suite process before the checks below ever run.
await go(d, 'Party');
await d.locator('.codeBox button:has-text("Leave")').click().catch(() => {});
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
  await b.waitForFunction(() => Boolean(document.querySelector('[data-testid="park-map-gl"] canvas') || document.querySelectorAll('svg.mapSvg circle').length), null, {
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
  /* Clear a leftover pin. The rail's ✕ used to do this; with the rail gone the
     only forget is the Phone row under Me → Settings, which says "Saved · tap
     to forget" while there is something to forget. */
  await go(b, 'Settings');
  const phoneTopic = b.locator('.settingsTopic', { hasText: 'Phone' });
  if (await phoneTopic.count()) {
    await phoneTopic.click();
    await b.waitForTimeout(400);
  }
  const forgetCar = b.locator('.settingsPanel .row', { hasText: 'Where I parked' }).first();
  if ((await forgetCar.count()) && /tap to forget/i.test(await forgetCar.innerText())) {
    await forgetCar.click();
    await b.waitForTimeout(400);
    if (/tap to forget/i.test(await forgetCar.innerText())) {
      throw new Error('the Phone row would not forget the car');
    }
  }
  await go(b, 'Places');
  await ensurePeek(b);
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
  /* The walk back. The rail card's Go used to start it; the Party panel's
     worded button is the only thing that calls startNav({kind:'car'}) now —
     the map FAB takes the camera to the pin but does not route to it. */
  await go(b, 'Party');
  const carGo = b.locator('button:has-text("Where I parked")').first();
  await until(async () => (await carGo.count()) > 0, {
    timeout: 15000,
    label: 'the Party panel’s Where I parked button',
  });
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
await off.waitForFunction(() => Boolean(document.querySelector('[data-testid="park-map-gl"] canvas') || document.querySelectorAll('svg.mapSvg circle').length), null, {
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
      const n = await off.locator('[data-testid="park-map-gl"] canvas, svg.mapSvg circle').count();
      return n >= 1 ? n : null;
    },
    { timeout: 40000, label: 'the offline map to draw' },
  );
  return paths >= 1;
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
    const drawn = await p.locator('[data-testid="park-map-gl"] canvas, svg.mapSvg circle').count();
    if (!drawn) throw new Error(`${v.id} map did not draw`);
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

console.log('\n--- zoom band crossfade ---');

await check('crossing each band boundary keeps a parent placeholder drawn, ramps added content across the crossfade, and holds the pitch ease off the boundary', async () => {
  const P = await openPhone(browser, {
    lat: 39.34395,
    lng: -84.2673,
    name: 'Bands',
    label: 'ZB',
    venue: 'kings-island',
  });
  const p = P.page;
  try {
    await p.evaluate(() => localStorage.setItem('parkbound-demo-skins', '1'));
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => Boolean(document.querySelector('[data-testid="park-map-gl"] canvas')), null, {
      timeout: 40000,
    });
    await closeGate(p);
    await go(p, 'Collection');
    const row = p.locator('.worldSkinRow .row', { hasText: 'Watercolor quest' }).first();
    await row.scrollIntoViewIfNeeded();
    if (/Locked|Out of season|This World/.test(await row.innerText())) {
      throw new Error('Watercolor quest still locked after demo grant');
    }
    await row.click();
    await p.waitForTimeout(500);
    await p.waitForSelector('[data-testid="park-map-gl"][data-map-ready="1"]', { timeout: 20000 });
    await until(async () => {
      const ready = await p.evaluate(() => typeof globalThis.__parkMapView?.state === 'function');
      return ready ? true : false;
    }, { timeout: 15000, label: 'map view seam ready' });

    const staged = await p.evaluate(() => {
      const view = globalThis.__parkMapView;
      const map = globalThis.__parkMapLibre;
      if (!view?.setCamera || !view?.setAvailableBands || !map) {
        return { error: 'map view or MapLibre missing' };
      }
      const centre = map.getCenter();
      const lat = (39.3364963 + 39.348) / 2;
      const handoffs = [14.622402608729475, 16.622402608729477];
      const ease = { startZoom: 15.022402608729475, endZoom: 16.222402608729478 };

      view.setCamera({ center: { lng: centre.lng, lat: centre.lat }, zoom: 17, bearing: 0 });
      const beforeClose = view.state().plan;
      const midVisibleBefore = map.getLayer('band-mid')
        ? map.getLayoutProperty('band-mid', 'visibility')
        : null;

      view.setAvailableBands(['mid', 'close']);
      const afterClose = view.state().plan;
      const midVisibleAfter = map.getLayer('band-mid')
        ? map.getLayoutProperty('band-mid', 'visibility')
        : null;

      view.setCamera({ center: { lng: centre.lng, lat: centre.lat }, zoom: 15, bearing: 0 });
      const midPitch = view.state().camera.pitch;
      view.setCamera({ center: { lng: centre.lng, lat: centre.lat }, zoom: 17, bearing: 0 });
      const closePitch = view.state().camera.pitch;

      return {
        lat,
        handoffs,
        ease,
        beforeClose,
        midVisibleBefore,
        afterClose,
        midVisibleAfter,
        midPitch,
        closePitch,
      };
    });
    if (staged.error) throw new Error(staged.error);

    if (staged.beforeClose.primary !== 'close') {
      throw new Error(`expected close band at z17, got ${staged.beforeClose.primary}`);
    }
    if (staged.beforeClose.placeholder !== 'mid') {
      throw new Error(`expected mid placeholder before close streams, got ${staged.beforeClose.placeholder}`);
    }
    if (!staged.beforeClose.draw.includes('mid')) {
      throw new Error(`mid must stay drawn as placeholder: ${staged.beforeClose.draw.join(',')}`);
    }
    if (staged.beforeClose.primaryReady) {
      throw new Error('close band must not be ready before it streams in');
    }
    if (staged.midVisibleBefore !== 'visible') {
      throw new Error(`band-mid must be visible during placeholder crossfade, got ${staged.midVisibleBefore}`);
    }

    if (!staged.afterClose.draw.includes('mid') || !staged.afterClose.draw.includes('close')) {
      throw new Error(`crossfade draws parent + child: ${staged.afterClose.draw.join(',')}`);
    }
    if (staged.midVisibleAfter !== 'visible') {
      throw new Error(`band-mid must stay visible under close: ${staged.midVisibleAfter}`);
    }

    const gap = staged.handoffs[1] - staged.ease.endZoom;
    if (!(gap > 0.35)) {
      throw new Error(`pitch ease must finish before the mid→close handoff (gap ${gap})`);
    }
    if (!(staged.ease.startZoom > staged.handoffs[0])) {
      throw new Error('pitch ease must start after the overview→mid handoff');
    }
    if (!(staged.closePitch > staged.midPitch)) {
      throw new Error(`pitch must ease up into close band (${staged.midPitch}° → ${staged.closePitch}°)`);
    }
  } finally {
    await P.context.close();
  }
  return true;
});

console.log('\n--- offline pyramid download ---');

await check("the offline action states its size, runs only on the guest's choice, and no pyramid downloads on Skin wear", async () => {
  const bundleRes = await fetch(`${BASE}/venues/kings-island.bundle.json`);
  if (!bundleRes.ok) throw new Error(`bundle HTTP ${bundleRes.status}`);
  const baseManifest = await bundleRes.json();
  const overviewBytes = 1_500_000;
  const closeBytes = 2_500_000;
  const overviewBody = 'overview-pmtiles-fixture';
  const closeBody = 'close-pmtiles-fixture';
  const { createHash } = await import('node:crypto');
  const sha = (text) => createHash('sha256').update(text).digest('hex');
  const augmentedManifest = {
    ...baseManifest,
    files: [
      ...baseManifest.files,
      {
        path: '/venues/kings-island/display/overview.pmtiles',
        bytes: overviewBytes,
        sha256: sha(overviewBody),
      },
      {
        path: '/venues/kings-island/display/close.pmtiles',
        bytes: closeBytes,
        sha256: sha(closeBody),
      },
    ],
  };
  const pyramidFetches = [];
  const pyramidCached = () =>
    p.evaluate(async () => {
      const cache = await caches.open('tracker-venue-bundles-v1');
      const overview = await cache.match('/venues/kings-island/display/overview.pmtiles');
      const close = await cache.match('/venues/kings-island/display/close.pmtiles');
      return { overview: Boolean(overview), close: Boolean(close) };
    });

  const P = await openPhone(browser, {
    lat: 39.34395,
    lng: -84.2673,
    name: 'Offline',
    label: 'OD',
    venue: 'kings-island',
  });
  const p = P.page;
  const ctx = P.context;
  try {
    const fulfillManifest = async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(augmentedManifest),
      });
    };
    await ctx.route('**/venues/kings-island.bundle.json**', fulfillManifest);
    await ctx.route('**/api/venues/kings-island/bundle**', fulfillManifest);
    await ctx.route('**/*overview.pmtiles**', async (route) => {
      pyramidFetches.push(route.request().url());
      await route.fulfill({ status: 200, body: overviewBody });
    });
    await ctx.route('**/*close.pmtiles**', async (route) => {
      pyramidFetches.push(route.request().url());
      await route.fulfill({ status: 200, body: closeBody });
    });

    await p.evaluate(() => localStorage.setItem('parkbound-demo-skins', '1'));
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => Boolean(document.querySelector('[data-testid="park-map-gl"] canvas')), null, {
      timeout: 40000,
    });
    await closeGate(p);
    await go(p, 'Collection');
    const row = p.locator('.worldSkinRow .row', { hasText: 'Watercolor quest' }).first();
    await row.scrollIntoViewIfNeeded();
    if (/Locked|Out of season|This World/.test(await row.innerText())) {
      throw new Error('Watercolor quest still locked after demo grant');
    }
    await row.click();
    await p.waitForTimeout(1500);
    const beforeOptIn = await pyramidCached();
    if (beforeOptIn.overview || beforeOptIn.close) {
      throw new Error('pyramid bands cached before guest opt-in');
    }
    if (pyramidFetches.length) {
      throw new Error(`pyramid band network fetches on Skin wear: ${pyramidFetches.join(', ')}`);
    }

    await until(
      async () =>
        p.evaluate(async () => {
          const cache = await caches.open('tracker-venue-bundles-v1');
          const hit = await cache.match('/venues/kings-island.bundle.json');
          if (!hit) return false;
          const manifest = await hit.json();
          return manifest.files?.some((f) => f.path?.includes('overview.pmtiles'));
        }),
      { timeout: 60000, label: 'floor sync to cache augmented manifest' },
    );

    await go(p, 'Settings');
    await p.locator('.settingsTopic', { hasText: 'Map' }).click();
    const card = p.locator('[data-testid="offline-park-download"]');
    await card.waitFor({ state: 'visible', timeout: 15000 });
    const bytesLabel = await p.locator('[data-testid="offline-park-bytes"]').innerText();
    if (!/3\.8\s*MB/i.test(bytesLabel) && !/4(\.0)?\s*MB/i.test(bytesLabel)) {
      throw new Error(`size must match manifest pyramid bytes (expected ~4 MB, got ${bytesLabel})`);
    }
    const beforeClick = await pyramidCached();
    await p.locator('[data-testid="offline-park-download-btn"]').click();
    await until(async () => {
      const cached = await pyramidCached();
      return cached.overview && cached.close;
    }, {
      timeout: 30000,
      label: 'guest opt-in pyramid download lands in VENUE_BUNDLE_CACHE',
    });
    if (beforeClick.overview || beforeClick.close) {
      throw new Error('pyramid bands were already cached before the button was tapped');
    }
  } finally {
    await ctx.unroute('**/venues/kings-island.bundle.json**').catch(() => {});
    await ctx.unroute('**/api/venues/kings-island/bundle**').catch(() => {});
    await ctx.unroute('**/*overview.pmtiles**').catch(() => {});
    await ctx.unroute('**/*close.pmtiles**').catch(() => {});
    await P.context.close();
  }
  return true;
});

console.log('\n--- delivery delta sync ---');

await check('revision-cursor bundle sync returns a delta manifest with fewer files when since lags head', async () => {
  const fullRes = await fetch(`${BASE}/api/venues/kings-island/bundle`);
  if (!fullRes.ok) throw new Error(`full bundle HTTP ${fullRes.status}`);
  const full = await fullRes.json();
  const headRev = full.basedOn?.revisionId;
  if (!headRev) throw new Error('full manifest missing basedOn.revisionId');
  if (!full.files?.length) throw new Error('full manifest has no files');

  const upToDateRes = await fetch(
    `${BASE}/api/venues/kings-island/bundle?since=${encodeURIComponent(headRev)}`,
  );
  if (!upToDateRes.ok) throw new Error(`delta bundle HTTP ${upToDateRes.status}`);
  const upToDate = await upToDateRes.json();
  if (upToDate.files.length === 0) {
    if (!(upToDate.files.length < full.files.length)) {
      throw new Error('up-to-date delta must list fewer files than the full manifest');
    }
  } else if (upToDate.files.length !== full.files.length) {
    throw new Error(`unexpected partial delta size ${upToDate.files.length} vs full ${full.files.length}`);
  }

  const unknownRes = await fetch(
    `${BASE}/api/venues/kings-island/bundle?since=${encodeURIComponent('00000000-0000-0000-0000-000000000000')}`,
  );
  if (!unknownRes.ok) throw new Error(`unknown-since bundle HTTP ${unknownRes.status}`);
  const unknown = await unknownRes.json();
  if (unknown.files.length !== full.files.length) {
    throw new Error('unknown since must fall back to the full manifest file list');
  }
  return true;
});

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
