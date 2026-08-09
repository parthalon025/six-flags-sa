#!/usr/bin/env node
/**
 * Comprehensive visual audit — captures every major UI state for human review.
 *   npm start &
 *   node test/audit-visual.mjs
 */
import { BASE, go, launch } from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'test', 'audit');
fs.mkdirSync(OUT, { recursive: true });

const KI = { latitude: 39.34395, longitude: -84.2673 };

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  ${name}`);
}

async function dismissIntake(page) {
  // Update splash
  const continueBtn = page.locator('button:has-text("Continue")');
  if (await continueBtn.count()) {
    await continueBtn.click();
    await page.waitForTimeout(800);
  }
  const allow = page.locator('button:has-text("Allow location")');
  if (await allow.count()) {
    await allow.click();
    await page.waitForTimeout(2500);
  }
  const setup = page.locator('button:has-text("Yes — set up")');
  if (await setup.count()) {
    await setup.click();
    await page.waitForTimeout(1800);
  }
  const dismiss = page.locator('button:has-text("Just show me")');
  if (await dismiss.count()) await dismiss.click();
  await page.waitForTimeout(1000);
}

async function setTheme(page, theme) {
  const want = theme === 'day' ? 'daylight map' : 'night map';
  const btn = page.locator(`button[aria-label*="${want}"]`);
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(600);
  }
}

async function sheetStop(page, stop) {
  for (let i = 0; i < 5; i++) {
    const cls = await page.locator('.sheet').evaluate((e) => e.className);
    if (cls.includes(stop)) return;
    await page.locator('.grab').click();
    await page.waitForTimeout(400);
  }
}

const browser = await launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  permissions: ['geolocation'],
  geolocation: KI,
  locale: 'en-US',
});
const page = await ctx.newPage();

console.log('\nVisual audit — capturing states to test/audit/\n');

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await shot(page, '01-update-splash-or-gate');

await dismissIntake(page);
await shot(page, '02-map-peek-night');

await setTheme(page, 'day');
await shot(page, '03-map-peek-day');

await sheetStop(page, 'shut');
await shot(page, '04-sheet-shut');

await sheetStop(page, 'peek');
await shot(page, '05-sheet-peek');

await sheetStop(page, 'half');
await shot(page, '06-sheet-half');

await sheetStop(page, 'full');
await shot(page, '07-sheet-full');

// Tabs
await go(page, 'Party');
await page.waitForTimeout(600);
await shot(page, '08-party-tab');

await go(page, 'Rider height');
await page.waitForTimeout(600);
await shot(page, '09-rides-tab');

await go(page, 'Me');
await page.waitForTimeout(600);
await shot(page, '10-settings-tab');

// Weather expanded
await go(page, 'Explore');
await page.waitForTimeout(400);
const wx = page.locator('.wxChip');
if (await wx.count()) {
  await wx.click();
  await page.waitForTimeout(500);
  await shot(page, '11-weather-expanded');
  await wx.click();
}

// Map key — only when the sheet leaves enough map visible
await sheetStop(page, 'peek');
const keyToggle = page.locator('.mapKeyToggle');
if (await keyToggle.count()) {
  await keyToggle.click();
  await page.waitForTimeout(500);
  await shot(page, '12-map-key-open');
}

// Search focused
const search = page.locator('.field[aria-label="Search places"]');
if (await search.count()) {
  await search.click();
  await page.waitForTimeout(300);
  await search.fill('food');
  await page.waitForTimeout(800);
  await shot(page, '13-search-food');
}

// Route preview
await search.fill('');
await page.waitForTimeout(300);
await page.locator('.poiRow .poiMain').first().click().catch(() => {});
await page.waitForTimeout(800);
const walkBtn = page.getByText('Walk me there', { exact: false }).first();
if (await walkBtn.count()) {
  await walkBtn.click();
  await page.waitForTimeout(2000);
  await shot(page, '14-route-preview');
}

// GPS gate welcome (fresh context)
const ctx2 = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: 'en-US',
});
await ctx2.addInitScript(() => {
  localStorage.removeItem('tracker-intro-seen');
  localStorage.removeItem('tracker-release-notes-seen');
});
const page2 = await ctx2.newPage();
await page2.goto(BASE, { waitUntil: 'domcontentloaded' });
await page2.waitForTimeout(1500);
const continue2 = page2.locator('button:has-text("Continue")');
if (await continue2.count()) await continue2.click();
await page2.waitForTimeout(500);
await shot(page2, '15-gps-gate-welcome');

await browser.close();
console.log('\nDone — review test/audit/*.png\n');
