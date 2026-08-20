import { BASE, go, launch, signIn } from './browser.mjs';
const B = BASE;
const b = await launch();
const c = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2,
  permissions:['geolocation'], geolocation:{latitude:39.34395,longitude:-84.26730} });
const p = await c.newPage();
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
await p.goto(B,{waitUntil:'networkidle'});
await p.waitForTimeout(1200);
// First run leads with "I'm ready"; the other labels are the states below idle.
const allow = p.locator('button:has-text("m ready"), button:has-text("Share my location"), button:has-text("Allow location")');
if (await allow.count()) { await allow.click(); await p.waitForTimeout(2500); }
const dis = p.locator('button:has-text("Just browsing"), button:has-text("Just show me"), button:has-text("Skip for now")');
if (await dis.count()) await dis.click();
await p.waitForTimeout(1200);

// the rider-height screen, with a tier picked
await go(p, 'Rider height');
await p.locator('.tier:has-text("46")').first().click();
await p.waitForTimeout(600);
await p.screenshot({ path:'test/shots/20-rides-redesign.png' });

// create a party, inject a second member server-side, then look at the rail
await signIn(p, 'ux@parkbound.example');
await go(p, 'Party');
await p.locator('button:has-text("Start a party")').click();
await p.waitForTimeout(1800);
const code = (await p.locator('.codeText').innerText()).trim();
console.log('code', code);
await fetch(`${B}/api/party/${code}`, {method:'PUT', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({id:'kid1',name:'Ava',lat:39.34120,lng:-84.26520,status:'In line'})});
await fetch(`${B}/api/party/${code}`, {method:'PUT', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({id:'kid2',name:'Sam',lat:39.34620,lng:-84.26640,status:'NEED HELP'})});
await fetch(`${B}/api/party/${code}/meet`, {method:'PUT', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({lat:39.34395,lng:-84.26730,label:'Royal Fountain',by:'Justin'})});
await p.waitForTimeout(9000);
await go(p, 'Places');             // the Explore tab, where the rail lives
// Down to the glance stop, which is the one this shot is of. Cycling a fixed
// number of times used to land there by luck; the handle now starts from
// wherever the sheet was left, so ask for the stop by name instead.
for (let i = 0; i < 4 && !(await p.locator('.sheet.peek').count()); i += 1) {
  await p.locator('.grab').click();
  await p.waitForTimeout(500);
}
await p.waitForTimeout(700);
await p.screenshot({ path:'test/shots/21-glance-rail.png' });
await b.close();
console.log('ux shots done');
