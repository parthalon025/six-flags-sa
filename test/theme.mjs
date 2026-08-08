import { BASE, launch } from './browser.mjs';
const b = await launch();
const c = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2,
  permissions:['geolocation'], geolocation:{latitude:39.34395,longitude:-84.26730} });
const p = await c.newPage();
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
await p.goto(BASE, {waitUntil:'domcontentloaded'});
await p.waitForTimeout(1500);
// dismiss the gps gate by granting
const allow = p.locator('button:has-text("Allow location")');
if (await allow.count()) { await allow.click(); await p.waitForTimeout(2500); }
const dismiss = p.locator('button:has-text("Just show me")');
if (await dismiss.count()) { await dismiss.click(); }
await p.waitForTimeout(1500);
// force daylight
// use the real control, not a CSS override, so React state and vars stay in step
const toggle = p.locator('button[aria-label*="night map"]');
if (await toggle.count()) { await toggle.click(); await p.waitForTimeout(500); }
console.log('theme attr =', await p.evaluate(() => document.documentElement.dataset.theme));
await p.screenshot({ path:'test/shots/13-night-recheck.png' });
// open the rider-height screen in daylight
await p.locator('.row:has-text("Rider height")').first().click().catch(()=>{});
await p.waitForTimeout(600);
await p.screenshot({ path:'test/shots/14-night-rides-recheck.png' });
await b.close();
console.log('shots done');
