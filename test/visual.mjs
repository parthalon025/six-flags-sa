#!/usr/bin/env node
/**
 * Visual inspection harness.
 *
 * Boots a real Chromium against a running app, fakes a GPS position inside the
 * park, walks the main flows and writes a PNG per step to test/shots/.
 * These are for a human to look at — the assertions here only catch hard
 * failures (console errors, missing map geometry).
 *
 *   npm run dev &            # or npm start after a build
 *   npm run test:visual
 */

import { dismissUpdateSplash, go, launch, openPhone, until } from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const OUT = path.join(process.cwd(), 'test', 'shots');
// The Beast's station, so the shots land somewhere recognisable.
const HOME = { latitude: 39.340154, longitude: -84.266027 };

fs.mkdirSync(OUT, { recursive: true });

const problems = [];
let step = 0;

async function shot(page, name) {
  step += 1;
  const file = path.join(OUT, `${String(step).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  shot  ${path.relative(process.cwd(), file)}`);
}

async function openSheet(page, stop = 'full') {
  for (let i = 0; i < 3; i += 1) {
    if (await page.locator(`.sheet.${stop}`).count()) return;
    // A slider, not a button: the sheet's height is a value on a range now
    // rather than a choice between four named stops. It still cycles on a tap.
    await page.getByRole('slider', { name: /Resize panel/ }).click();
    await page.waitForTimeout(400);
  }
}

const check = (ok, label) => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}`);
  if (!ok) problems.push(label);
};

async function main() {
  const browser = await launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 15 class
    deviceScaleFactor: 2,
    locale: 'en-US',
  });
  await context.addInitScript(() => {
    localStorage.removeItem('tracker-intro-seen');
    localStorage.removeItem('tracker-release-notes-seen');
  });
  await context.setGeolocation(HOME);

  const errors = [];
  const page = await context.newPage();
  const ignorable = /ERR_CERT|fonts\.(googleapis|gstatic)|net::ERR_(FAILED|BLOCKED)/;
  page.on('console', (m) => {
    // A blocked resource logs "Failed to load resource: …" with no URL in the
    // text — the URL is on the message location, so test both.
    const where = `${m.text()} ${m.location()?.url ?? ''}`;
    if (m.type() === 'error' && !ignorable.test(where)) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  console.log(`\nvisual inspection against ${BASE}\n`);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await dismissUpdateSplash(page);
  await page.waitForSelector('.gate', { timeout: 10000 });
  await shot(page, 'gps-gate');
  const first = await page.locator('.gate').innerText();
  check(
    /Park Party/i.test(first) && /see where everyone is/i.test(first),
    'the first screen introduces the app',
  );
  check(/Allow location/i.test(first), 'the first screen asks for location on the same card');

  await context.grantPermissions(['geolocation']);
  await page.getByRole('button', { name: 'Allow location' }).click();
  await page.waitForTimeout(2000);

  // The second half of the intake. Numbered off the step it belongs to rather
  // than taking a step of its own, so adding it does not renumber every shot
  // taken after it.
  const intakeShot = path.join(OUT, '01b-park-intake.png');
  await page.screenshot({ path: intakeShot });
  console.log(`  shot  ${path.relative(process.cwd(), intakeShot)}`);
  const asked = await page.locator('.gate h2').innerText().catch(() => '');
  check(/kings island/i.test(asked), `intake asks which park: "${asked.replace(/\n/g, ' ')}"`);

  await page.getByRole('button', { name: /Yes — set up/ }).click();
  await page.waitForTimeout(1800);
  await shot(page, 'map-located');

  const paths = await page.locator('.mapSvg path').count();
  check(paths > 800, `park geometry drawn (${paths} vector paths)`);
  const meDot = await page.locator('.mePulse').count();
  check(meDot > 0, 'own position marker rendered from mocked GPS');

  // Rides + height filter
  await go(page, 'Rider height');
  await openSheet(page, 'full');
  await page.waitForTimeout(700);
  await shot(page, 'rides-panel');

  const tier46 = page.locator('.tier', { hasText: '46' });
  await tier46.click();
  await page.waitForTimeout(500);
  await shot(page, 'height-46in');
  const tally = await page.locator('.ratioKey').innerText();
  // The key is uppercased in CSS, so innerText comes back as "34 CAN RIDE".
  // Deliberately not "open" — that word belongs to whether a ride is running.
  check(/\d+ can ride/i.test(tally), `height tally computed: ${tally.replace(/\n/g, ' ')}`);

  await page.locator('.tier', { hasText: '54' }).click();
  await page.waitForTimeout(500);
  await shot(page, 'height-54in');
  const tally54 = await page.locator('.ratioKey').innerText();
  check(tally54 !== tally, 'tally changes between 46in and 54in');

  // The list, and the filter that lives with it, are the root screen.
  await go(page, 'Places');
  await openSheet(page, 'full');
  await page.getByRole('button', { name: /Only what they can ride/ }).click();
  await page.waitForTimeout(500);
  await shot(page, 'height-filtered-list');

  // Party flow
  await go(page, 'Party');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Start a party' }).click();
  await page.waitForTimeout(1800);
  await shot(page, 'party-created');
  const code = (await page.locator('.codeText').innerText().catch(() => '')).trim();
  check(/^[A-HJ-NP-Z2-9]{6}$/.test(code), `party code issued: ${code || 'none'}`);

  // A second phone joins the same party from across the park
  if (code) {
    const { context: other, page: page2 } = await openPhone(browser, {
      lat: 39.343328,
      lng: -84.266981, // Eiffel Tower
      label: 'B',
    });
    await go(page2, 'Party');
    await openSheet(page2, 'full');
    await page2.locator('input.code').fill(code);
    await page2.getByRole('button', { name: 'Join' }).click();
    // Poll for the roster rather than sleeping on a number picked here. A
    // status set before the transport is actually up is applied locally and
    // never sent, and nothing re-sends it — so a fixed wait that lands short
    // leaves this phone shouting NEED HELP at a party that cannot hear it.
    // The other phone appearing in the roster is the proof the link is live.
    await until(() => page2.locator('.memberRow').count().then((n) => n >= 2), {
      timeout: 30000,
      label: 'phone two joined and linked',
    }).catch(() => {});
    await page2.getByRole('button', { name: 'I need help' }).click();
    await page2.getByRole('button', { name: 'Tap again to alert everyone' }).click();
    await page2.waitForTimeout(1500);
    await shot(page2, 'second-phone-joined');

    // Back to phone one: the other member should appear on the roster and map.
    // Poll rather than sleeping a fixed interval — a party carried by the
    // mailbox converges on its polling cadence, not on a number picked here,
    // and a fixed wait turns a slow round trip into a failed assertion.
    await until(() => page.locator('.memberRow').count().then((n) => n >= 2), {
      timeout: 45000,
      label: 'both phones on the roster',
    }).catch(() => {});
    await shot(page, 'roster-two-members');
    const rows = await page.locator('.memberRow').count();
    check(rows >= 2, `roster shows both phones (${rows} rows)`);
    const range = await page.locator('.memberRange b').nth(1).innerText().catch(() => '');
    check(/ft|mi/.test(range), `range to the other phone computed: ${range}`);
    const helpTag = await until(() => page.locator('.chipTag.hot').count(), {
      timeout: 45000,
      label: 'the help tag',
    }).catch(() => 0);
    check(helpTag > 0, 'NEED HELP status propagated between devices');

    await page.locator('.grab').click();
    await page.waitForTimeout(600);
    await shot(page, 'map-with-party');
    await other.close();
  }

  check(errors.length === 0, `no console errors (${errors.length})`);
  errors.slice(0, 5).forEach((e) => console.log(`        ! ${e.slice(0, 160)}`));

  await browser.close();

  console.log(`\n${problems.length ? `${problems.length} FAILED` : 'all checks passed'}`);
  console.log(`shots in ${path.relative(process.cwd(), OUT)}\n`);
  process.exit(problems.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
