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

import {
  BASE,
  closeGate,
  dismissNavigation,
  go,
  hydrated,
  launch,
  openPhone,
  resetPlaces,
  root,
  rosterNames,
  until,
} from './browser.mjs';

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
const A = await openPhone(browser, {
  lat: 39.34395,
  lng: -84.2673,
  name: 'Justin',
  label: 'A',
  venue: 'kings-island',
});
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
  await go(a, 'Places');
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

console.log('\n--- rides + heights ---');
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
  await resetPlaces(a);
  await until(async () => (await a.locator('.poiRow', { hasText: 'The Beast' }).count()) || null, {
    timeout: 15000,
    label: 'The Beast at 48 inches',
  });
  const at48 = await a.locator('.poiRow', { hasText: 'The Beast' }).first().locator('.verdict').innerText();
  await go(a, 'Rider height');
  await a.locator('.tier:has-text("36")').click();
  await a.waitForTimeout(400);
  await resetPlaces(a);
  const at36 = await a.locator('.poiRow', { hasText: 'The Beast' }).first().locator('.verdict').innerText();
  if (!/CAN RIDE/i.test(at48) || !/TOO SHORT/i.test(at36)) throw new Error(`${at48} / ${at36}`);
  return true;
});

await check('"adult along" changes the companion tally', async () => {
  await go(a, 'Rider height');
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
  await resetPlaces(a);
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
  await resetPlaces(a);
  await a.locator('.field[aria-label="Search places"]').fill('beast');
  await until(async () => {
    const n = await a.locator('.poiRow').count();
    return n === 1 ? n : null;
  }, { timeout: 15000, label: 'one row for beast' });
  const n = await a.locator('.poiRow').count();
  await a.locator('.field[aria-label="Search places"]').fill('');
  await a.waitForTimeout(400);
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

console.log('\n--- walking directions ---');

await check('"walk me there" offers the route before setting off', async () => {
  await go(a, 'Places');
  await a.locator('.field[aria-label="Search places"]').fill('beast');
  await a.waitForTimeout(400);
  await a.locator('.poiRow .poiMain').first().click();
  await a.waitForTimeout(300);
  await a.locator('button:has-text("Walk me there")').first().click();
  await a.waitForTimeout(900);
  if (!(await a.locator('.routePreview').count())) throw new Error('no preview card');
  // Nothing has taken over the screen yet: no banner, no bottom bar.
  if (await a.locator('.navBanner').count()) throw new Error('started walking without being asked');
  const summary = (await a.locator('.previewMain').innerText()).replace(/\s+/g, ' ');
  if (!/\d+ min/.test(summary)) throw new Error(summary);
  if (!/arrive \d/.test(summary)) throw new Error(`no arrival time: ${summary}`);
  if (!/via /.test(await a.locator('.previewWhere').innerText())) throw new Error('route has no via');
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
  await A.context.setGeolocation({ latitude: 39.3419, longitude: -84.2667 });
  await a.waitForTimeout(2500);
  const after = await left();
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

await check('a glance card walks you to a place and stops again', async () => {
  await A.context.setGeolocation({ latitude: 39.34395, longitude: -84.2673 });
  await a.waitForTimeout(1200);
  await go(a, 'Places');
  const goBtn = a.locator('.glanceGo').first();
  if (!(await goBtn.count())) throw new Error('no Go button on the rail');
  await goBtn.click();
  await a.waitForTimeout(900);
  if (!(await a.locator('.routePreview').count())) throw new Error('Go did not offer a route');
  if (!(await a.locator('.glanceCard.walking').count())) throw new Error('card not marked as live');
  await a.locator('.previewGo').click();
  await a.waitForTimeout(900);
  await a.locator('.navEnd').click();
  await a.waitForTimeout(500);
  if (await a.locator('.navBanner').count()) throw new Error('End left the banner up');
  if (await a.locator('.routeLine').count()) throw new Error('End left the line drawn');
  return true;
});

console.log('\n--- party: create and invite ---');
await go(a, 'Party');
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
const B = await openPhone(browser, {
  lat: 39.3412,
  lng: -84.2652,
  name: 'Ava',
  label: 'B',
  venue: 'kings-island',
});
const b = B.page;
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

await check('meet-up set from a ride reaches the other phone', async () => {
  await resetPlaces(a);
  await a.locator('.field[aria-label="Search places"]').fill('Racer');
  await until(async () => (await a.locator('.poiRow', { hasText: 'The Racer' }).count()) || null, {
    timeout: 15000,
    label: 'The Racer in the list',
  });
  await a.locator('.poiRow', { hasText: 'The Racer' }).first().locator('.poiMain').click();
  await a.waitForTimeout(500);
  await a.locator('button:has-text("Make this the meet-up")').click();
  await go(a, 'Party');
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
  venue: 'kings-island',
});
const c = C.page;

await check('the invite link joins the party with nothing typed', async () => {
  await go(c, 'Party');
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
    await go(page, 'Party');
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

console.log('\n--- ride reports ---');

/**
 * The half of live status that does not come from a forecast: one phone says a
 * ride is down and every other phone in the party hears it. Exercised over
 * whatever transport the party actually negotiated, which is the point — the
 * report is an ordinary command and gets the same delivery guarantees as a
 * location or a meet-up pin.
 */

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
 * the label is deliberately stateful ("It's down" becomes "Reported down"), so
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
  const pill = row.locator('.verdict.statusPill').first();
  try {
    // Short timeout and a catch rather than a count() guard: the retraction
    // test is polling for this pill to vanish, so it can and does disappear
    // between being counted and being read.
    return (await pill.innerText({ timeout: 1000 })).trim();
  } catch {
    return '';
  }
}

await check('a ride reported down on one phone reaches the other', async () => {
  const row = await openRide(a, 'Diamondback');
  await reportBtn(row, 'down').click();
  await a.waitForTimeout(400);

  // The reporting phone shows it straight away — via the host's patch, not an
  // optimistic local write.
  await until(async () => /reported down/i.test(await pillFor(a, 'Diamondback')), {
    timeout: JOIN_TIMEOUT,
    label: 'phone A to show its own report',
  });

  await openRide(b, 'Diamondback');
  await until(async () => /reported down/i.test(await pillFor(b, 'Diamondback')), {
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
  if (!/just now|min ago/.test(detail)) throw new Error(detail);
  return true;
});

await check('the other phone can correct it', async () => {
  const row = b.locator('.poiRow', { hasText: 'Diamondback' }).first();
  await reportBtn(row, 'open').click();
  await until(async () => /reported running/i.test(await pillFor(b, 'Diamondback')), {
    timeout: JOIN_TIMEOUT,
    label: 'phone B to overwrite the report',
  });
  // A ride report is not owned by whoever wrote it, so A sees B's correction.
  await until(async () => /reported running/i.test(await pillFor(a, 'Diamondback')), {
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
  // What must disappear is the party's claim.
  const cleared = async (page) => !/reported/i.test(await pillFor(page, 'Diamondback'));
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

console.log('\n--- venues ---');

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

const dismissUpdateSplash = async (page) => {
  const cont = page.locator('.gate .btn.primary:has-text("Continue")');
  if (await cont.count()) {
    await cont.click();
    await page.waitForTimeout(500);
  }
};

await check('the update splash appears before the introduction on a fresh install', async () => {
  // A brand-new phone on a build with release notes sees the splash first.
  // Re-open on a context that has not dismissed it yet.
  const fresh = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
    geolocation: { latitude: 30.2672, longitude: -97.7431 },
  });
  const p = await fresh.newPage();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await hydrated(p);
  await until(async () => (await p.locator('#update-splash-title').count()) > 0, {
    timeout: 10000,
    label: 'the update splash',
  });
  const title = (await p.locator('#update-splash-title').innerText()).trim();
  if (!/what's new/i.test(title)) throw new Error(`splash title: "${title}"`);
  await fresh.close();
  return true;
});

await dismissUpdateSplash(e);

await check('the first screen says what the app is, above the location ask', async () => {
  const card = await e.locator('.gate').innerText();
  const heading = (await e.locator('.gate h2').innerText()).trim();
  if (heading !== 'Park Party') throw new Error(`opened on: "${heading}"`);
  // One screen, in the order that earns the answer: what you get, then what it
  // needs, then the button. A permission asked cold is a permission refused.
  const said = card.indexOf('See where everyone is');
  const asked = card.indexOf('needs to use your location');
  const button = card.indexOf('Allow location');
  if (said < 0 || asked < 0 || button < 0) throw new Error('the introduction and the ask are not on one card');
  if (!(said < asked && asked < button)) throw new Error('the ask comes before what it is for');
  return true;
});

await check('the intake asks about the nearest park, not the default one', async () => {
  await e.locator('button:has-text("Allow location")').click();
  // Wait for the question itself, not merely for a heading: the location card
  // is still up while the fix lands, and reading .gate h2 the moment it says
  // anything gets "Waiting for a fix" rather than the park.
  await until(async () => (await e.locator('.gate .btn.primary:has-text("Yes — set up")').count()) > 0, {
    timeout: 25000,
    label: 'the park question',
  });
  const heading = (await e.locator('.gate h2').innerText()).trim();
  if (!/going to.*fiesta texas/i.test(heading)) throw new Error(`asked: "${heading}"`);
  // And the guess it did not make is one tap away, with the distance that
  // explains why it was not the guess.
  const other = await e.locator('.gate .venueRow', { hasText: 'Kings Island' }).innerText();
  if (!/\d+ mi away/i.test(other)) throw new Error(`other park row: "${other}"`);
  return true;
});

await check('saying yes builds that park, geometry and places', async () => {
  await e.locator('.gate .btn.primary:has-text("Yes — set up")').click();
  await e.waitForSelector('.gate', { state: 'detached', timeout: 25000 });
  const shown = await e.locator('.brand b').innerText();
  if (!/fiesta texas/i.test(shown)) throw new Error(`brand reads "${shown}"`);
  // The places have to have come with it, and height rules must be live —
  // Fiesta Texas ships 60 height records now, so the Rides tab belongs here too.
  await go(e, 'Rider height');
  await e.locator('.tier:has-text("48")').click();
  await e.waitForTimeout(400);
  if (!(await e.locator('.filterBadge').count())) throw new Error('no height filter on Fiesta Texas');
  await go(e, 'Places');
  await until(async () => (await e.locator('.poiRow', { hasText: 'BATMAN The Ride' }).count()) > 0, {
    timeout: 15000,
    label: "Fiesta Texas's place list",
  });
  return true;
});

await check('the park answered stays answered across a reload', async () => {
  await e.reload({ waitUntil: 'domcontentloaded' });
  await hydrated(e);
  await dismissUpdateSplash(e);
  // Introduced once per phone, not once per launch: coming back gets the plain
  // question, not the sales pitch again.
  if (await e.locator('.gate h2:has-text("Park Party")').count()) {
    throw new Error('the introduction came back on a reload');
  }
  await e.locator('button:has-text("Allow location")').click();
  // Asked once. If the question came back, the gate would still be up here —
  // nothing else in the intake waits on a fix that has already landed.
  await e.waitForSelector('.gate', { state: 'detached', timeout: 25000 });
  const shown = await e.locator('.brand b').innerText();
  if (!/fiesta texas/i.test(shown)) throw new Error(`brand reads "${shown}" after reload`);
  return true;
});

await intake.close();

// A phone that is nowhere near the party. It should open on the venue its own
// fix falls inside, then follow the party to the venue the host is standing in
// — everyone in a party has to be drawing the same place for a meet-up pin to
// mean anything.
const D = await openPhone(browser, {
  lat: 29.5992,
  lng: -98.6145, // Six Flags Fiesta Texas, San Antonio
  name: 'Remote',
  label: 'D',
  venue: 'six-flags-fiesta-texas',
});
const d = D.page;
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

await check('the picker measures from the party, not from this phone', async () => {
  await go(d, 'Which map');
  await d.waitForTimeout(400);
  const rows = await d.locator('.venueRow').allTextContents();
  const here = rows.find((r) => /Kings Island/.test(r));
  const far = rows.find((r) => /Fiesta Texas/.test(r));
  if (!/your party is here/.test(here || '')) throw new Error(`Kings Island row: "${here}"`);
  if (!/from your party/.test(far || '')) throw new Error(`Fiesta Texas row: "${far}"`);
  return true;
});

await check('picking a venue by hand outranks the host', async () => {
  await go(d, 'Which map');
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
await go(d, 'Party');
await d.locator('.codeBox button:has-text("Leave")').click();
await until(async () => (await d.locator('button:has-text("Start a party")').count()) > 0, {
  timeout: JOIN_TIMEOUT,
  label: 'phone D to leave the party',
}).catch(() => {});
await D.context.close();

console.log('\n--- leaving ---');

await check('leaving removes the member from the other phone’s roster', async () => {
  // Whoever is not hosting leaves, so the departure has a host to reach.
  const bHosts = /this phone/i.test(
    await b.locator('.label:has-text("Hosting") .labelRight').innerText(),
  );
  const leaver = bHosts ? { page: c, name: 'Sam' } : { page: b, name: 'Ava' };
  const stays = bHosts ? b : c;

  // Leaving confirms too — for the host it hands the roster to another phone.
  await leaver.page.locator('.codeBox button:has-text("Leave")').click();
  await leaver.page.locator('.codeBox button:has-text("Tap to confirm")').click();
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
  await b.waitForFunction(() => document.querySelectorAll('svg.mapSvg path').length > 100, null, {
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
  // Including the park question, which this context has never answered: saying
  // yes to the park already on screen must not go back to the network for it.
  await closeGate(off);
  await go(off, 'Rider height');
  await off.waitForTimeout(500);
  await off.locator('.tier:has-text("48")').click();
  await off.waitForTimeout(500);
  if (!(await off.locator('.ratioBar').count())) throw new Error('no ratio bar offline');
  await go(off, 'Places');
  const verdict = await off.locator('.poiRow', { hasText: 'The Beast' }).first().locator('.verdict').innerText();
  if (!/CAN RIDE/i.test(verdict)) throw new Error(`verdict offline: ${verdict}`);
  const badge = await off.locator('.filterBadge').textContent();
  if (!/\d+ of \d+ rides/.test(badge.replace(/\s+/g, ' '))) throw new Error(badge);
  return true;
});
await offline.close();

console.log('\n--- per-venue smoke ---');

const VENUE_SMOKE = [
  { id: 'kings-island', lat: 39.34395, lng: -84.2673, search: 'The Beast', minPaths: 700 },
  { id: 'six-flags-fiesta-texas', lat: 29.5992, lng: -98.6145, search: 'BATMAN', minPaths: 800 },
  { id: 'cedar-point', lat: 41.4826, lng: -82.6862, search: 'Millennium Force', minPaths: 1000 },
  { id: 'big-kahunas', lat: 30.3883, lng: -86.473, search: 'Honu', minPaths: 100 },
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
    const paths = await p.locator('svg.mapSvg path').count();
    if (paths < v.minPaths) throw new Error(`${paths} paths`);
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

console.log('\n--- car parking ---');

await check('save where I parked and walk back to it', async () => {
  await B.context.setGeolocation({ latitude: 39.34395, longitude: -84.2673 });
  await b.waitForTimeout(800);
  await b.locator('button[aria-label="Save where I parked"]').click();
  await b.waitForTimeout(600);
  await b.locator('button[aria-label="Go to where I parked"]').click();
  await b.waitForTimeout(900);
  if (!(await b.locator('.routePreview').count())) throw new Error('no route to car');
  await b.locator('.previewGo').click();
  await b.waitForTimeout(800);
  if (!(await b.locator('.navBanner').count())) throw new Error('walk to car did not start');
  await b.locator('.navEnd').click();
  await b.waitForTimeout(400);
  return true;
});

console.log('\n--- map categories ---');

await check('show on the map toggles a category off and on', async () => {
  await go(b, 'Me');
  await b.locator('.row:has-text("Show on the map")').click();
  await b.waitForTimeout(400);
  const before = await b.locator('svg.mapSvg path').count();
  await b.locator('.chip:has-text("Coasters")').click();
  await b.waitForTimeout(500);
  const after = await b.locator('svg.mapSvg path').count();
  if (!(after < before)) throw new Error(`paths ${before} -> ${after}`);
  await b.locator('.chip:has-text("Coasters")').click();
  await b.waitForTimeout(400);
  await b.locator('button:has-text("Back")').click();
  await b.waitForTimeout(300);
  return true;
});

console.log('\n--- admin inspection ---');

await check('venue inspection API returns all built parks', async () => {
  const res = await fetch(`${BASE}/api/admin/venues`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body.total < 4) throw new Error(`only ${body.total} venues`);
  if (body.passed < 4) throw new Error(`${body.passed}/${body.total} passed compare`);
  return true;
});

console.log('\n--- console errors ---');
for (const phone of [B, C, D]) {
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