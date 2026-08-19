/**
 * Daylight and night, through the real toggle rather than a CSS override, so
 * React state and the custom properties stay in step.
 *
 * Both palettes get the map and the rides list, because a marker colour that
 * works on a dark ground can vanish on paper and the other way round.
 *
 *   npm start &
 *   npm run test:theme
 */
import { BASE, closeGate, go, launch, root } from './browser.mjs';

const b = await launch();
const c = await b.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  permissions: ['geolocation'],
  geolocation: { latitude: 39.34395, longitude: -84.2673 },
});
const p = await c.newPage();
const problems = [];
p.on('pageerror', (e) => problems.push(`PAGEERROR: ${e.message}`));

await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

// The whole first-run intake — splash, location, nearest World — in one place,
// so the palette toggle is actually on screen before the audit reaches for it.
await closeGate(p);
await p.waitForTimeout(1500);

const themeNow = () => p.evaluate(() => document.documentElement.dataset.theme);

/* The palette control cycles auto -> Trail -> Park Midnight (ADR-0012), so
   click until the resolved palette lands on the one asked for. */
async function wear(theme) {
  const button = p.locator('button[aria-label*="Trail"], button[aria-label*="Park Midnight"]').first();
  // The toggle lives in the map chrome, which fades in after the venue loads.
  await button.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  for (let i = 0; i < 3; i += 1) {
    if ((await themeNow()) === theme || !(await button.isVisible().catch(() => false))) break;
    await button.click({ timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(700);
  }
  const got = await themeNow();
  if (got !== theme) problems.push(`asked for ${theme}, got ${got}`);
  return got;
}

async function capture(theme, mapShot, ridesShot) {
  await wear(theme);
  await root(p);
  await p.waitForTimeout(700);
  await p.screenshot({ path: `test/shots/${mapShot}` });
  await go(p, 'Rider height');
  await p.waitForTimeout(700);
  await p.screenshot({ path: `test/shots/${ridesShot}` });
  console.log(`  ${theme}: ${mapShot}, ${ridesShot}`);
}

await capture('day', '11-daylight-map.png', '12-daylight-rides.png');
await capture('night', '13-night-recheck.png', '14-night-rides-recheck.png');

await b.close();
if (problems.length) {
  problems.forEach((m) => console.log(` ! ${m}`));
  process.exitCode = 1;
} else {
  console.log('shots done');
}
