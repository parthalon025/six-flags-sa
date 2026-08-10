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
import { BASE, go, launch, root } from './browser.mjs';

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

const allow = p.locator('button:has-text("Share my location"), button:has-text("Allow location")');
if (await allow.count()) {
  await allow.click();
  await p.waitForTimeout(2500);
}
const dismiss = p.locator('button:has-text("Just browsing"), button:has-text("Just show me"), button:has-text("Skip for now")');
if (await dismiss.count()) await dismiss.click();
await p.waitForTimeout(1500);

const themeNow = () => p.evaluate(() => document.documentElement.dataset.theme);

/* The toggle names the palette it will switch *to*, so asking for one by name
   is the same as asking for it — and a second click would take it away again. */
async function wear(theme) {
  const want = theme === 'day' ? 'daylight map' : 'night map';
  const button = p.locator(`button[aria-label*="${want}"]`);
  if (await button.count()) {
    await button.click();
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
