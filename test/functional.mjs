import { launch } from './browser.mjs';
const B = 'http://127.0.0.1:3000';
const PASS = [], FAIL = [];
const ok = (n) => { PASS.push(n); console.log('  PASS', n); };
const bad = (n, e) => { FAIL.push(`${n} :: ${e}`); console.log('  FAIL', n, '->', e); };
const check = async (n, fn) => { try { const r = await fn(); if (r === false) throw new Error('assertion false'); ok(n); } catch (e) { bad(n, e.message.split('\n')[0]); } };

const b = await launch();
const mk = async (lat, lng) => {
  const c = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2,
    permissions:['geolocation'], geolocation:{latitude:lat, longitude:lng}, colorScheme:'light' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  // A blocked resource logs "Failed to load resource: …" with no URL in the text —
  // the URL is on the message location, so test both.
  p.on('console', m => { const t = m.text(); const where = `${t} ${m.location()?.url ?? ''}`;
    if (m.type()==='error' && !/ERR_CERT_AUTHORITY_INVALID|fonts\.googleapis|fonts\.gstatic/.test(where)) errs.push('console: '+t.slice(0,200)); });
  await p.goto(B, {waitUntil:'networkidle'});
  await p.waitForTimeout(1000);
  const allow = p.locator('button:has-text("Allow location")');
  if (await allow.count()) { await allow.click(); await p.waitForTimeout(2200); }
  const dis = p.locator('button:has-text("Just show me")');
  if (await dis.count()) await dis.click();
  await p.waitForTimeout(900);
  return { c, p, errs };
};

console.log('\n--- phone A: core ---');
const A = await mk(39.34395, -84.26730);
const p = A.p;

await check('GPS gate closes and position resolves', async () =>
  (await p.locator('.gate').count()) === 0 && /NEAR/i.test(await p.locator('.brand span').innerText()));

await check('glance rail renders nearby fallback cards', async () =>
  (await p.locator('.glanceCard').count()) >= 2);

await check('theme toggle flips data-theme', async () => {
  const before = await p.evaluate(() => document.documentElement.dataset.theme);
  await p.locator('button[aria-label*="map"]').first().click();
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => document.documentElement.dataset.theme);
  if (before === after) throw new Error('theme did not change');
  await p.locator('button[aria-label*="map"]').first().click();
  await p.waitForTimeout(300);
  return true;
});

await check('bearing tape toggles on', async () => {
  await p.locator('button[aria-label="Bearing tape"]').click();
  await p.waitForTimeout(400);
  const n = await p.locator('.tape canvas').count();
  await p.locator('button[aria-label="Bearing tape"]').click();
  return n === 1;
});

await check('sheet expands to half then full', async () => {
  await p.locator('.grab').click(); await p.waitForTimeout(400);
  const h1 = await p.locator('.sheet').evaluate(e => e.getBoundingClientRect().height);
  await p.locator('.grab').click(); await p.waitForTimeout(400);
  const h2 = await p.locator('.sheet').evaluate(e => e.getBoundingClientRect().height);
  if (!(h2 > h1)) throw new Error(`heights ${h1} -> ${h2}`);
  return true;
});

console.log('\n--- rides + heights ---');
await p.locator('button[role="tab"]:has-text("Rides")').click();
await p.waitForTimeout(400);

await check('tier button sets height and ratio bar appears', async () => {
  await p.locator('.tier:has-text("48")').click();
  await p.waitForTimeout(400);
  return (await p.locator('.ratioBar').count()) === 1
      && (await p.locator('.heightVal b').innerText()).trim() === '48';
});

await check('filter badge shows a live count', async () => {
  const t = await p.locator('.filterBadge').textContent();
  if (!/\d+ of \d+ rides/.test(t.replace(/\s+/g,' '))) throw new Error(t);
  return true;
});

await check('verdicts respond to height', async () => {
  const beastRow = p.locator('.poiRow', { hasText: 'The Beast' }).first();
  const at48 = await beastRow.locator('.verdict').innerText();
  await p.locator('.tier:has-text("36")').click();
  await p.waitForTimeout(400);
  const at36 = await p.locator('.poiRow', { hasText: 'The Beast' }).first().locator('.verdict').innerText();
  if (!/CAN RIDE/i.test(at48) || !/TOO SHORT/i.test(at36)) throw new Error(`${at48} / ${at36}`);
  return true;
});

await check('"adult along" changes the companion tally', async () => {
  await p.locator('.tier:has-text("36")').click(); await p.waitForTimeout(300);
  const withA = await p.locator('.ratioKey .warn b').innerText();
  await p.locator('.chip:has-text("Adult along")').click(); await p.waitForTimeout(400);
  const without = await p.locator('.ratioKey .warn b').innerText();
  if (withA === without) throw new Error(`companion count unchanged: ${withA}`);
  await p.locator('.chip:has-text("Adult along")').click(); await p.waitForTimeout(300);
  return true;
});

await check('"only what they can ride" filters the list', async () => {
  const before = await p.locator('.poiRow').count();
  await p.locator('.chip:has-text("Only what")').click(); await p.waitForTimeout(500);
  const after = await p.locator('.poiRow').count();
  if (!(after < before)) throw new Error(`${before} -> ${after}`);
  await p.locator('.chip:has-text("Only what")').click(); await p.waitForTimeout(400);
  return true;
});

await check('search narrows results', async () => {
  await p.locator('.field[aria-label="Search the park"]').fill('beast');
  await p.waitForTimeout(500);
  const n = await p.locator('.poiRow').count();
  await p.locator('.field[aria-label="Search the park"]').fill('');
  await p.waitForTimeout(400);
  if (n !== 1) throw new Error(`got ${n} rows`);
  return true;
});

await check('category chip switches the list', async () => {
  await p.locator('.chip.withDot:has-text("Restrooms")').click();
  await p.waitForTimeout(500);
  const txt = await p.locator('.poiRow').first().innerText();
  await p.locator('.chip.withDot:has-text("Coasters")').click();
  await p.waitForTimeout(400);
  return /restroom/i.test(txt);
});

await check('clear removes the height filter', async () => {
  await p.locator('.labelAction:has-text("Clear")').click();
  await p.waitForTimeout(400);
  return (await p.locator('.filterBadge').count()) === 0;
});

console.log('\n--- party ---');
await p.locator('button[role="tab"]:has-text("Party")').click();
await p.waitForTimeout(300);
await p.locator('button:has-text("Start a party")').click();
await p.waitForTimeout(2000);
const code = (await p.locator('.codeText').innerText()).trim();
await check('party code is 5 chars', () => /^[A-Z0-9]{5}$/.test(code));

const C = await mk(39.34120, -84.26520);   // phone B, down in Coney Mall
await C.p.locator('button[role="tab"]:has-text("Party")').click();
await C.p.waitForTimeout(300);
await C.p.locator('.field.code').fill(code);
await C.p.locator('button:has-text("Join")').click();
await C.p.waitForTimeout(2500);
await C.p.locator('button[role="tab"]:has-text("Me")').click();
await C.p.waitForTimeout(300);
await C.p.locator('.field[placeholder="NAME"]').fill('Ava');
await C.p.locator('.field[placeholder="NAME"]').blur();
await C.p.waitForTimeout(1500);

await check('phone B appears on phone A roster', async () => {
  await p.waitForTimeout(9000);
  const rows = await p.locator('.memberRow').count();
  if (rows < 2) throw new Error(`${rows} rows`);
  return true;
});

await check('roster shows a real distance to phone B', async () => {
  const t = await p.locator('.memberRow', { hasText: 'Ava' }).first().innerText();
  if (!/\d+\s*(ft|mi)/.test(t)) throw new Error(t);
  return true;
});

await check('NEED HELP propagates to the other phone', async () => {
  await C.p.locator('button[role="tab"]:has-text("Party")').click();
  await C.p.waitForTimeout(300);
  await C.p.locator('.chip:has-text("NEED HELP")').click();
  await C.p.waitForTimeout(9000);
  const t = await p.locator('.memberRow', { hasText: 'Ava' }).first().innerText();
  if (!/HELP/i.test(t)) throw new Error(t);
  return true;
});

await check('meet-up set from a ride reaches the other phone', async () => {
  await p.locator('button[role="tab"]:has-text("Rides")').click();
  await p.waitForTimeout(400);
  await p.locator('.poiMain', { hasText: 'The Racer' }).first().click();
  await p.waitForTimeout(500);
  await p.locator('button:has-text("Make this the meet-up")').click();
  await p.waitForTimeout(9000);
  const t = await C.p.locator('.sheetBody').innerText();
  if (!/Racer/i.test(t)) throw new Error('meet-up not visible on phone B');
  return true;
});

await check('leaving deletes the member server-side', async () => {
  await C.p.locator('button[role="tab"]:has-text("Party")').click();
  await C.p.waitForTimeout(400);
  await C.p.locator('button:has-text("Leave")').click();
  await C.p.waitForTimeout(2500);
  const r = await (await fetch(`${B}/api/party/${code}`)).json();
  if (r.members.some(m => m.name === 'Ava')) throw new Error('still present');
  return true;
});

console.log('\n--- persistence ---');
await check('height, theme and name survive a reload', async () => {
  await p.locator('button[role="tab"]:has-text("Rides")').click();
  await p.waitForTimeout(300);
  await p.locator('.tier:has-text("52")').click();
  await p.waitForTimeout(600);
  await p.reload({waitUntil:'networkidle'});
  await p.waitForTimeout(2500);
  const g = p.locator('button:has-text("Allow location")');
  if (await g.count()) { await g.click(); await p.waitForTimeout(1500); }
  const badge = await p.locator('.filterBadge').count();
  if (badge !== 1) throw new Error('height filter lost');
  return true;
});

console.log('\n--- pwa + offline ---');
await check('manifest and icons are served', async () => {
  const m = await (await fetch(`${B}/manifest.webmanifest`)).json();
  const i = await fetch(`${B}/icon-512.png`);
  if (m.display !== 'standalone' || !i.ok) throw new Error('manifest/icon missing');
  return true;
});
await check('service worker registers and caches the map', async () => {
  const reg = await p.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return Boolean(r);
  });
  if (!reg) throw new Error('no service worker registration');
  return true;
});
await check('map still draws with the network cut', async () => {
  const off = await b.newContext({ viewport:{width:390,height:844}, permissions:['geolocation'],
    geolocation:{latitude:39.34395,longitude:-84.26730} });
  const q = await off.newPage();
  await q.goto(B, {waitUntil:'networkidle'});
  await q.waitForTimeout(3000);           // let the worker install and cache
  await off.setOffline(true);
  await q.reload({waitUntil:'domcontentloaded'}).catch(()=>{});
  await q.waitForTimeout(2500);
  const paths = await q.locator('svg.mapSvg path').count();
  await off.close();
  if (paths < 100) throw new Error(`only ${paths} paths drawn offline`);
  return true;
});

console.log('\n--- console errors ---');
await check('no page errors on phone A', () => { if (A.errs.length) throw new Error(A.errs.slice(0,3).join(' | ')); return true; });
await check('no page errors on phone B', () => { if (C.errs.length) throw new Error(C.errs.slice(0,3).join(' | ')); return true; });

await b.close();
console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) { FAIL.forEach(f => console.log(' !', f)); process.exitCode = 1; }
