import { launch } from './browser.mjs';
const B='http://127.0.0.1:3000';
const b = await launch();
const c = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2,
  permissions:['geolocation'], geolocation:{latitude:39.34395,longitude:-84.26730} });
const p = await c.newPage();
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
await p.goto(B,{waitUntil:'networkidle'});
await p.waitForTimeout(1200);
const allow = p.locator('button:has-text("Allow location")');
if (await allow.count()) { await allow.click(); await p.waitForTimeout(2500); }
const dis = p.locator('button:has-text("Just show me")');
if (await dis.count()) await dis.click();
await p.waitForTimeout(1200);

// a second phone joins so the rail has a member to show
await p.locator('button:has-text("RIDES & HEIGHTS")').first().click();
await p.waitForTimeout(400);
await p.locator('button:has-text("46")').first().click();
await p.waitForTimeout(600);
await p.screenshot({ path:'test/shots/20-rides-redesign.png' });

// create a party, inject a second member server-side, then look at the rail
await p.locator('button[role="tab"]:has-text("PARTY")').click();
await p.waitForTimeout(300);
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
await p.locator('.grab').click();  // collapse toward peek
await p.waitForTimeout(500);
await p.locator('.grab').click();
await p.waitForTimeout(700);
await p.screenshot({ path:'test/shots/21-glance-rail.png' });
await b.close();
console.log('ux shots done');
