#!/usr/bin/env node
/**
 * Capture README gallery stills and the capability walkthrough video.
 *
 * Waits for real SVG map geometry (not the "Drawing the map…" placeholder).
 * Writes docs/images/readme/*.png and walkthrough.mp4.
 *
 *   npm run start   # or npm run dev
 *   npm run readme:shots
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
import { recordCapture } from './lib/readme-shots.mjs';
import {
  closeGate,
  dismissNavigation,
  go,
  hydrated,
  launch,
  openPhone,
  searchPlaces,
  setName,
  tapMapPoi,
  until,
} from './browser.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(root, 'docs/images/readme');
const BEAST = { latitude: 39.340154, longitude: -84.266027 };
const TOWER = { latitude: 39.343328, longitude: -84.266981 };

fs.mkdirSync(OUT, { recursive: true });

async function stubWeather(page) {
  await page.route('**/api/weather**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        current: { temperature: 78, weathercode: 1, windspeed: 6 },
      }),
    }),
  );
}

async function stillCss(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after { animation: none !important; transition: none !important; }
      .wxChip { visibility: hidden !important; }
    `,
  });
}

async function mapReady(page, minPaths = 700) {
  await until(async () => (await page.locator('svg.mapSvg path').count()) >= minPaths, {
    timeout: 45000,
    label: `map geometry (>= ${minPaths} paths)`,
  });
  const drawing = page.locator('text=Drawing the map');
  if (await drawing.count()) {
    await until(async () => (await drawing.count()) === 0, {
      timeout: 20000,
      label: 'drawing placeholder gone',
    }).catch(() => {});
  }
  await page.waitForTimeout(800);
}

async function setTheme(page, theme) {
  // The palette control cycles auto -> Trail -> Park Midnight, so click until
  // the resolved palette lands on the one asked for (ADR-0012).
  const btn = page.locator('button[aria-label*="Trail"], button[aria-label*="Park Midnight"]').first();
  await btn.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  for (let i = 0; i < 3; i += 1) {
    const got = await page.evaluate(() => document.documentElement.dataset.theme);
    if (got === theme || !(await btn.isVisible().catch(() => false))) return;
    await btn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
}

async function setSheet(page, stop) {
  const slider = page.getByRole('slider', { name: /Resize panel/ });
  if (!(await slider.count())) return;
  if (stop === 'shut') {
    await slider.press('Home');
    await page.waitForTimeout(450);
    return;
  }
  if (stop === 'full') {
    await slider.press('End');
    await page.waitForTimeout(450);
    return;
  }
  for (let i = 0; i < 8; i += 1) {
    const cls = (await page.locator('.sheet').getAttribute('class')) || '';
    if (cls.split(/\s+/).includes(stop)) return;
    await slider.click();
    await page.waitForTimeout(400);
  }
}

/* Freshness manifest (#550): the harness is deterministic, so a recapture
   after a pixel-neutral source change writes byte-identical PNGs that never
   land in the branch diff — captured.json records the recapture out-of-band
   (shot → the HEAD commit and time it was taken) so readme-shots-check can
   see it. Written only for shots this run actually captured. */
const CAPTURED_FILE = path.join(OUT, 'captured.json');
const CAPTURED_COMMIT = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      // Scrubbed: an inherited GIT_DIR outranks `cwd`. See scripts/lib/git-env.mjs.
      env: scrubGitEnv(),
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
})();

function recordShot(name) {
  const entries = fs.existsSync(CAPTURED_FILE)
    ? JSON.parse(fs.readFileSync(CAPTURED_FILE, 'utf8'))
    : {};
  const next = recordCapture(entries, name, {
    commit: CAPTURED_COMMIT,
    capturedAt: new Date().toISOString(),
    sha256: createHash('sha256').update(fs.readFileSync(path.join(OUT, name))).digest('hex'),
  });
  fs.writeFileSync(CAPTURED_FILE, `${JSON.stringify(next, null, 2)}\n`);
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  const paths = await page.locator('svg.mapSvg path').count();
  console.log(`  ${name}  (${paths} map paths)`);
  if (paths < 200) throw new Error(`${name}: map not drawn (${paths} paths)`);
  recordShot(name);
}

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

/** True when FFMPEG_BIN resolves to a runnable ffmpeg. Video encoding is
 * best-effort (#469): agent containers may not have ffmpeg installed, and
 * that must not fail a run where every still already captured fine. */
function ffmpegAvailable() {
  const probe = spawnSync(FFMPEG_BIN, ['-version'], { stdio: 'ignore' });
  return !probe.error && probe.status === 0;
}

function encodeWalkthrough(webmPath) {
  const mp4 = path.join(OUT, 'walkthrough.mp4');
  const r = spawnSync(
    FFMPEG_BIN,
    [
      '-y',
      '-i',
      webmPath,
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-crf',
      '28',
      '-vf',
      'setpts=0.35*PTS,scale=390:-2',
      mp4,
    ],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) throw new Error('ffmpeg failed to encode walkthrough.mp4');
  console.log(`  walkthrough.mp4`);
}

async function main() {
  const videoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parkbound-walkthrough-'));
  const browser = await launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    permissions: ['geolocation', 'clipboard-read', 'clipboard-write'],
    geolocation: BEAST,
    colorScheme: 'light',
    locale: 'en-US',
    recordVideo: { dir: videoDir, size: { width: 390, height: 844 } },
  });
  const version = JSON.parse(
    fs.readFileSync(path.join(root, 'apps/party-tracker/package.json'), 'utf8'),
  ).version;
  await context.addInitScript(
    ({ ver }) => {
      localStorage.setItem('tracker-release-notes-seen', ver);
      localStorage.setItem('tracker-intro-seen', '1');
      localStorage.setItem('tracker-venue-confirmed', 'kings-island');
    },
    { ver: version },
  );

  const page = await context.newPage();
  await stubWeather(page);
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:3000', { waitUntil: 'domcontentloaded' });
  await closeGate(page);
  await hydrated(page);
  await mapReady(page);
  await stillCss(page);
  await setName(page, 'Ava');
  await setTheme(page, 'day');
  await setSheet(page, 'shut');
  await page.locator('button[aria-label="Zoom out"]').click().catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('button[aria-label="Zoom out"]').click().catch(() => {});
  await page.waitForTimeout(800);

  await shot(page, 'map-day.png');
  fs.copyFileSync(path.join(OUT, 'map-day.png'), path.join(OUT, 'walkthrough-poster.png'));

  await setTheme(page, 'night');
  await page.waitForTimeout(700);
  await shot(page, 'map-night.png');
  await setTheme(page, 'day');
  await page.waitForTimeout(500);

  await setSheet(page, 'peek');
  try {
    await tapMapPoi(page, 'The Beast');
  } catch {
    await go(page, 'Places');
    await searchPlaces(page, 'beast');
    await page.locator('.poiRow .poiMain').first().click();
  }
  await until(async () => (await page.locator('[data-place-detail], .mapCallout, .poiRow.open').count()) > 0, {
    timeout: 12000,
    label: 'ride selected',
  }).catch(() => {});
  await page.waitForTimeout(900);
  await shot(page, 'ride-callout.png');

  await dismissNavigation(page).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await go(page, 'Plan');
  await setSheet(page, 'full');
  const heightsTab = page.locator('.settingsTopic', { hasText: 'Heights' });
  if (await heightsTab.count()) await heightsTab.click();
  const tier46 = page.locator('.tier', { hasText: '46' });
  await tier46.click();
  await page.waitForTimeout(700);
  await go(page, 'Places');
  await setSheet(page, 'shut');
  await page.waitForTimeout(700);
  await shot(page, 'height-filter.png');

  await go(page, 'Plan');
  if (await heightsTab.count()) await heightsTab.click();
  const clear = page.locator('.labelAction:has-text("Clear")');
  if (await clear.count()) await clear.click();
  await page.waitForTimeout(400);
  await go(page, 'Places');
  await setSheet(page, 'full');
  await searchPlaces(page, '');
  await searchPlaces(page, 'beast');
  const rowMain = page.locator('.poiRow .poiMain').first();
  await rowMain.waitFor({ state: 'visible', timeout: 15000 });
  if (!(await page.locator('.poiRow.open').count())) await rowMain.click();
  await page.waitForTimeout(500);
  if (!(await page.locator('.poiRow.open .placeActions').count())) await rowMain.click();
  await page.waitForTimeout(400);
  const walk = page.locator('.poiRow.open button[aria-label="Walk me there"]');
  if (!(await walk.count())) {
    await page.screenshot({ path: '/tmp/walk-fail.png' });
    console.log('walk fail html', (await page.locator('.poiRow').first().innerHTML().catch(() => 'none')).slice(0, 800));
    throw new Error('Walk me there not on open row');
  }
  await walk.click();
  await until(async () => (await page.locator('.routePreview, .navBanner, .navBar').count()) > 0, {
    timeout: 15000,
    label: 'route preview',
  });
  await page.waitForTimeout(1500);
  await shot(page, 'walking.png');
  console.log('  dismissing route preview');
  await page.locator('.previewLink:has-text("Cancel")').click().catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await dismissNavigation(page).catch(() => {});
  await page.waitForTimeout(600);

  console.log('  opening Party');
  try {
    await page.locator('.tabItem[data-tab="party"]').click({ force: true });
    await page.waitForTimeout(500);
    await setSheet(page, 'full');
    const startParty = page.getByRole('button', { name: 'Start a party' });
    await startParty.waitFor({ state: 'visible', timeout: 15000 });
    await startParty.click();
    await page.waitForTimeout(1800);
    const code = (await page.locator('.codeText').innerText().catch(() => '')).trim();
    console.log('  party code', code || '(none)');
    if (/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
      const guest = await openPhone(browser, {
        lat: TOWER.latitude,
        lng: TOWER.longitude,
        name: 'Sam',
        venue: 'kings-island',
        label: 'readme-guest',
      });
      await stubWeather(guest.page);
      await stillCss(guest.page);
      await go(guest.page, 'Party');
      await setSheet(guest.page, 'full');
      await guest.page.locator('input.code').fill(code);
      await guest.page.getByRole('button', { name: 'Join' }).click();
      await until(() => page.locator('.memberRow').count().then((n) => n >= 2), {
        timeout: 40000,
        label: 'guest joined host roster',
      }).catch(() => {});
      await go(page, 'Places');
      await setSheet(page, 'peek');
      await page.waitForTimeout(1200);
      await shot(page, 'party.png');
      await guest.context.close();
    } else {
      await shot(page, 'party.png');
    }
  } catch (err) {
    console.warn('  party shot fallback:', err.message);
    await shot(page, 'party.png');
  }

  await page.waitForTimeout(800);
  await context.close();
  await browser.close();

  const webm = fs.readdirSync(videoDir).find((f) => f.endsWith('.webm'));
  if (!webm) throw new Error('Playwright did not write a walkthrough video');
  if (ffmpegAvailable()) {
    encodeWalkthrough(path.join(videoDir, webm));
  } else {
    console.log('  walkthrough.mp4: skipped (no ffmpeg)');
  }
  fs.rmSync(videoDir, { recursive: true, force: true });
  console.log('\nreadme shots written to docs/images/readme/\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
