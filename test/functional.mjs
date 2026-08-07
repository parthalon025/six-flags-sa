#!/usr/bin/env node
/**
 * Behavioural suite against a running app.
 *
 * Three phones in one browser: A hosts a party, B joins by typing the code, C
 * joins from the invite link. Then A's phone is taken away and the other two
 * have to keep the party alive between them.
 *
 *   npm run build && npm start &
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node test/functional.mjs
 */

import { BASE, launch, openPhone, rosterNames, tab, until } from './browser.mjs';

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
    bad(n, e.message.split('\n')[0]);
  }
};

/** A party is carried by the mailbox in a test browser, so joins are not quick. */
const JOIN_TIMEOUT = 45000;
/** Host timeout is 12 s plus a claim window plus the new host's first beacon. */
const MIGRATION_TIMEOUT = 75000;

const browser = await launch();

console.log(`\nfunctional suite against ${BASE}\n`);
console.log('--- phone A: core ---');

// The Beast's station.
const A = await openPhone(browser, { lat: 39.34395, lng: -84.2673, name: 'Justin', label: 'A' });
const a = A.page;

await check('GPS gate closes and position resolves', async () => {
  if (await a.locator('.gate').count()) throw new Error('gate still up');
  const brand = await a.locator('.brand span').innerText();
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
  await tab(a, 'Party');
  return (await a.locator('.glanceCard').count()) >= 2;
});

await check('theme toggle flips data-theme', async () => {
  const before = await a.evaluate(() => document.documentElement.dataset.theme);
  await a.locator('button[aria-label*="map"]').first().click();
  await a.waitForTimeout(300);
  const after = await a.evaluate(() => document.documentElement.dataset.theme);
  if (before === after) throw new Error('theme did not change');
  await a.locator('button[aria-label*="map"]').first().click();
  await a.waitForTimeout(300);
  return true;
});

await check('bearing tape toggles on', async () => {
  await a.locator('button[aria-label="Bearing tape"]').click();
  await a.waitForTimeout(400);
  const n = await a.locator('.tape canvas').count();
  await a.locator('button[aria-label="Bearing tape"]').click();
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
    await a.locator('.grab').click();
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

console.log('\n--- rides + heights ---');
await tab(a, 'Rides');
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
  const at48 = await a.locator('.poiRow', { hasText: 'The Beast' }).first().locator('.verdict').innerText();
  await a.locator('.tier:has-text("36")').click();
  await a.waitForTimeout(400);
  const at36 = await a.locator('.poiRow', { hasText: 'The Beast' }).first().locator('.verdict').innerText();
  if (!/CAN RIDE/i.test(at48) || !/TOO SHORT/i.test(at36)) throw new Error(`${at48} / ${at36}`);
  return true;
});

await check('"adult along" changes the companion tally', async () => {
  await a.locator('.tier:has-text("36")').click();
  await a.waitForTimeout(300);
  const withAdult = await a.locator('.ratioKey .warn b').innerText();
  await a.locator('.chip:has-text("Adult along")').click();
  await a.waitForTimeout(400);
  const without = await a.locator('.ratioKey .warn b').innerText();
  if (withAdult === without) throw new Error(`companion count unchanged: ${withAdult}`);
  await a.locator('.chip:has-text("Adult along")').click();
  await a.waitForTimeout(300);
  return true;
});

await check('"only what they can ride" filters the list', async () => {
  const before = await a.locator('.poiRow').count();
  await a.locator('.chip:has-text("Only what")').click();
  await a.waitForTimeout(500);
  const after = await a.locator('.poiRow').count();
  if (!(after < before)) throw new Error(`${before} -> ${after}`);
  await a.locator('.chip:has-text("Only what")').click();
  await a.waitForTimeout(400);
  return true;
});

await check('search narrows results', async () => {
  await a.locator('.field[aria-label="Search the park"]').fill('beast');
  await a.waitForTimeout(500);
  const n = await a.locator('.poiRow').count();
  await a.locator('.field[aria-label="Search the park"]').fill('');
  await a.waitForTimeout(400);
  if (n !== 1) throw new Error(`got ${n} rows`);
  return true;
});

await check('category chip switches the list', async () => {
  await a.locator('.chip.withDot:has-text("Restrooms")').click();
  await a.waitForTimeout(500);
  const txt = await a.locator('.poiRow').first().innerText();
  await a.locator('.chip.withDot:has-text("Coasters")').click();
  await a.waitForTimeout(400);
  return /restroom/i.test(txt);
});

await check('clear removes the height filter', async () => {
  await a.locator('.labelAction:has-text("Clear")').click();
  await a.waitForTimeout(400);
  return (await a.locator('.filterBadge').count()) === 0;
});

console.log('\n--- walking directions ---');

await check('"walk me there" starts a route to a ride', async () => {
  await tab(a, 'Rides');
  await a.locator('.field[aria-label="Search the park"]').fill('beast');
  await a.waitForTimeout(400);
  await a.locator('.poiRow .poiMain').first().click();
  await a.waitForTimeout(300);
  await a.locator('button:has-text("Walk me there")').first().click();
  await a.waitForTimeout(800);
  if (!(await a.locator('.navBanner').count())) throw new Error('no banner');
  const instruction = (await a.locator('.navText b').innerText()).trim();
  if (!instruction) throw new Error('no instruction');
  const eta = (await a.locator('.navEta b').innerText()).trim();
  if (!/min/.test(eta)) throw new Error(`eta reads "${eta}"`);
  return true;
});

await check('the route is drawn along the paths, not as one straight hop', async () => {
  const d = await a.locator('.routeLine').getAttribute('d');
  if (!d) throw new Error('no route line');
  const corners = d.split('L').length - 1;
  // A straight-line fallback has exactly one segment; a walk has dozens.
  if (corners < 5) throw new Error(`${corners} segments — that is a bearing, not a walk`);
  if (await a.locator('.routeLine.direct').count()) throw new Error('fell back to a straight line');
  return true;
});

await check('the directions tab lists steps that end at the destination', async () => {
  await a.locator('.navLink').click();
  await a.waitForTimeout(500);
  const steps = await a.locator('.stepRow .stepText b').allInnerTexts();
  if (steps.length < 3) throw new Error(`${steps.length} steps`);
  if (!/^Head /.test(steps[0])) throw new Error(`starts with "${steps[0]}"`);
  if (!/^Arrive at /.test(steps[steps.length - 1])) throw new Error(`ends with "${steps.at(-1)}"`);
  return true;
});

await check('walking towards it shortens what is left', async () => {
  // The banner switches units on its own — "905 ft" becomes "0.35 mi" — so
  // compare feet, not the number printed next to whichever unit won.
  const left = async () => {
    const t = (await a.locator('.navEta em').innerText()).trim();
    const n = Number(t.replace(/[^\d.]/g, ''));
    return /mi/.test(t) ? n * 5280 : n;
  };
  const before = await left();
  // Halfway down International Street, on the way to Rivertown.
  await A.context.setGeolocation({ latitude: 39.3419, longitude: -84.2667 });
  await a.waitForTimeout(2500);
  const after = await left();
  if (!(after < before)) throw new Error(`${before} then ${after}`);
  return true;
});

await check('arriving ends the route on its own', async () => {
  await A.context.setGeolocation({ latitude: 39.340154, longitude: -84.266027 });
  await until(async () => (await a.locator('.navBanner').count()) === 0, {
    timeout: 20000,
    label: 'the banner to clear on arrival',
  });
  if (await a.locator('.routeLine').count()) throw new Error('route still drawn');
  return true;
});

await check('a glance card walks you to a place and stops again', async () => {
  await A.context.setGeolocation({ latitude: 39.34395, longitude: -84.2673 });
  await a.waitForTimeout(1200);
  await tab(a, 'Party');
  const go = a.locator('.glanceGo').first();
  if (!(await go.count())) throw new Error('no Go button on the rail');
  await go.click();
  await a.waitForTimeout(900);
  if (!(await a.locator('.navBanner').count())) throw new Error('Go did not start a route');
  if (!(await a.locator('.glanceCard.walking').count())) throw new Error('card not marked as live');
  await a.locator('.navStop').click();
  await a.waitForTimeout(500);
  if (await a.locator('.navBanner').count()) throw new Error('Stop left the banner up');
  if (await a.locator('.routeLine').count()) throw new Error('Stop left the line drawn');
  return true;
});

console.log('\n--- party: create and invite ---');
await tab(a, 'Party');
await a.waitForTimeout(300);
await a.locator('button:has-text("Start a party")').click();
await a.waitForSelector('.codeText', { timeout: 20000 });
const code = (await a.locator('.codeText').innerText()).trim();
const session = JSON.parse(await a.evaluate(() => localStorage.getItem('ki-session-v3')));

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

// The Copy link button is the only way a visitor gets the invite out of the app.
await a.locator('.codeBox button:has-text("Copy link")').click();
await a.waitForTimeout(400);
const invite = await a.evaluate(() => navigator.clipboard.readText());

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

await check('the host phone says it is hosting', async () => {
  const label = await a.locator('.label:has-text("Hosting") .labelRight').innerText();
  if (!/this phone/i.test(label)) throw new Error(label);
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
const B = await openPhone(browser, { lat: 39.3412, lng: -84.2652, name: 'Ava', label: 'B' });
const b = B.page;
await tab(b, 'Party');
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
  await until(async () => (await rosterNames(a)).includes('Ava'), {
    timeout: JOIN_TIMEOUT,
    label: 'Ava on phone A',
  });
  await until(async () => (await rosterNames(b)).includes('Justin'), {
    timeout: JOIN_TIMEOUT,
    label: 'Justin on phone B',
  });
  const onA = await rosterNames(a);
  const onB = await rosterNames(b);
  if (onA.length !== 2 || onB.length !== 2) throw new Error(`A ${onA} / B ${onB}`);
  return true;
});

await check('the joining phone knows which phone is hosting', async () => {
  const label = await until(
    async () => {
      const t = await b.locator('.label:has-text("Hosting") .labelRight').innerText();
      return /justin/i.test(t) ? t : null;
    },
    { timeout: JOIN_TIMEOUT, label: 'phone B to name the host' },
  );
  if (/this phone/i.test(label)) throw new Error('two phones both think they host');
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
  await b.locator('.chip:has-text("NEED HELP")').click();
  await until(
    async () => a.locator('.memberRow', { hasText: 'Ava' }).locator('.chipTag.hot').count(),
    { timeout: JOIN_TIMEOUT, label: 'the help tag on phone A' },
  );
  return true;
});

await check('meet-up set from a ride reaches the other phone', async () => {
  await tab(a, 'Rides');
  await a.waitForTimeout(400);
  await a.locator('.poiMain', { hasText: 'The Racer' }).first().click();
  await a.waitForTimeout(500);
  await a.locator('button:has-text("Make this the meet-up")').click();
  await tab(a, 'Party');
  await until(async () => /Racer/i.test(await b.locator('.sheetBody').innerText()), {
    timeout: JOIN_TIMEOUT,
    label: 'the meet-up on phone B',
  });
  return true;
});

// Phone C, by the Eiffel Tower, opens the invite link instead of typing anything.
const C = await openPhone(browser, {
  lat: 39.343328,
  lng: -84.266981,
  name: 'Sam',
  url: invite,
  label: 'C',
});
const c = C.page;

await check('the invite link joins the party with nothing typed', async () => {
  await tab(c, 'Party');
  await until(async () => (await c.locator('.codeText').count()) > 0, {
    timeout: JOIN_TIMEOUT,
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
        const n = await rosterNames(page);
        return n.length === 3 ? n : null;
      },
      { timeout: JOIN_TIMEOUT, label: `three members on phone ${label}` },
    );
    for (const who of ['Justin', 'Ava', 'Sam']) {
      if (!names.includes(who)) throw new Error(`phone ${label} is missing ${who}: ${names}`);
    }
  }
  return true;
});

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
        [b, c].map(async (page) => {
          const t = await page
            .locator('.label:has-text("Hosting") .labelRight')
            .innerText()
            .catch(() => '');
          return /this phone/i.test(t);
        }),
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
    const shown = (await page.locator('.codeText').innerText()).trim();
    if (shown !== code) throw new Error(`phone ${label} shows ${shown}, was ${code}`);
  }
  return true;
});

await check('the surviving phones agree on who is hosting', async () => {
  const labels = await Promise.all(
    [b, c].map((page) => page.locator('.label:has-text("Hosting") .labelRight').innerText()),
  );
  const claimants = labels.filter((t) => /this phone/i.test(t)).length;
  if (claimants !== 1) throw new Error(`hosting labels: ${labels.join(' | ')}`);
  const follower = labels.find((t) => !/this phone/i.test(t));
  if (!/Ava|Sam/i.test(follower)) throw new Error(`follower names "${follower}"`);
  return true;
});

await check('the roster never collapses while the host is replaced', async () => {
  await watching;
  if (rosterFloor.samples < 10) throw new Error(`only ${rosterFloor.samples} samples`);
  if (rosterFloor.min < 2) throw new Error(`roster fell to ${rosterFloor.min} rows`);
  return true;
});

console.log('\n--- leaving ---');

await check('leaving removes the member from the other phone’s roster', async () => {
  // Whoever is not hosting leaves, so the departure has a host to reach.
  const bHosts = /this phone/i.test(
    await b.locator('.label:has-text("Hosting") .labelRight').innerText(),
  );
  const leaver = bHosts ? { page: c, name: 'Sam' } : { page: b, name: 'Ava' };
  const stays = bHosts ? b : c;

  await leaver.page.locator('.codeBox button:has-text("Leave")').click();
  await until(async () => (await leaver.page.locator('button:has-text("Start a party")').count()) > 0, {
    timeout: JOIN_TIMEOUT,
    label: 'the leaver to be back on the start screen',
  });
  await until(async () => !(await rosterNames(stays)).includes(leaver.name), {
    timeout: JOIN_TIMEOUT,
    label: `${leaver.name} to disappear from the other roster`,
  });
  return true;
});

console.log('\n--- persistence ---');

await check('height, theme and party survive a reload', async () => {
  await tab(b, 'Rides');
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
  const gate = b.locator('button:has-text("Allow location")');
  if (await gate.count()) await gate.click();
  await b.waitForSelector('.gate', { state: 'detached', timeout: 15000 });

  if ((await b.locator('.filterBadge').count()) !== 1) throw new Error('height filter lost');
  if ((await b.evaluate(() => document.documentElement.dataset.theme)) !== theme) {
    throw new Error('theme reset on reload');
  }
  await tab(b, 'Me');
  const name = await b.locator('.field[placeholder="NAME"]').inputValue();
  if (name !== 'Ava') throw new Error(`name came back as "${name}"`);

  if (before) {
    await tab(b, 'Party');
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

console.log('\n--- pwa + offline ---');

await check('manifest and icons are served', async () => {
  const m = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
  const i = await fetch(`${BASE}/icon-512.png`);
  if (m.display !== 'standalone' || !i.ok) throw new Error('manifest/icon missing');
  return true;
});

await check('service worker registers', async () => {
  const reg = await b.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()));
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
await offline.setOffline(true);
await off.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});

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
  const gate = off.locator('button:has-text("Allow location")');
  if (await gate.count()) await gate.click();
  await off.waitForSelector('.gate', { state: 'detached', timeout: 15000 });
  await tab(off, 'Rides');
  await off.waitForTimeout(500);
  await off.locator('.tier:has-text("48")').click();
  await off.waitForTimeout(500);
  if (!(await off.locator('.ratioBar').count())) throw new Error('no ratio bar offline');
  const verdict = await off.locator('.poiRow', { hasText: 'The Beast' }).first().locator('.verdict').innerText();
  if (!/CAN RIDE/i.test(verdict)) throw new Error(`verdict offline: ${verdict}`);
  const badge = await off.locator('.filterBadge').textContent();
  if (!/\d+ of \d+ rides/.test(badge.replace(/\s+/g, ' '))) throw new Error(badge);
  return true;
});
await offline.close();

console.log('\n--- console errors ---');
for (const phone of [A, B, C]) {
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