#!/usr/bin/env node
/**
 * The grandma test.
 *
 * Not a regression suite. A regression suite asks whether the app still does
 * what it did; this asks whether a stranger can get anything out of it — a
 * non-technical, first-time, older visitor who has been handed a phone and has
 * no idea how any of it is meant to work.
 *
 * An actual grandma with no technical understanding needs:
 * 1. Zero mandatory search or typing: critical needs (toilets, food, family,
 *    Rally Points) must be reachable by tapping words she can read, never by
 *    typing. Explore is search -> context -> list now (D24 removed the glance
 *    rail), so the resting screen no longer *holds* the answer — it names the
 *    way to it. Checks that used to score 2 for "it was already on screen"
 *    score 1 for "one tap on words that say it", and that drop is the honest
 *    cost of the rail, not a bar that was lowered to fit.
 * 2. No deep scrolling: immediate amenities and nearby options must appear at
 *    the top of lists and cards.
 * 3. Outdoor readability: text font sizes, map labels, and marker icons
 *    must be large and legible at arm's length outdoors without squinting.
 * 4. Tap target accessibility: touch targets must meet the 44px floor for easy tapping.
 * 5. Plain-English clarity: simple words and single-tap actions for navigating,
 *    joining family, checking grandchildren's heights, and calling for help.
 *
 * Two people, scored separately:
 *
 *   B — Solo    needs a toilet, food, walking directions, easy reading & big tap targets
 *   A — Joiner  sent a link; joins family, finds grandchildren, sees Rally Points & calls for help
 *
 * Scored 0/1/2 rather than pass/fail, because "she got there after pulling the
 * sheet up" is a different result from "she got there first try", and a suite
 * that cannot tell them apart cannot tell you whether the app got better.
 *
 * The rule that makes it a grandma test and not a second functional suite:
 * **persona tasks may not use `go()`**. That helper knows the tab bar and pulls
 * the sheet open with `.grab`, which are the two things she does not know. She
 * taps things whose visible words she can read. If nothing on screen says it,
 * that is the finding — not a broken test.
 *
 *   npm run build && npm start &
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node test/grandma.mjs
 */

import { BASE, launch, until, closeGate } from './browser.mjs';
import { readFileSync } from 'node:fs';

const APP_VERSION = JSON.parse(readFileSync(new URL('../../apps/party-tracker/package.json', import.meta.url))).version;

const FIESTA = { latitude: 29.5985, longitude: -98.6107 }; // inside the park
const KI = { latitude: 39.34395, longitude: -84.2673 }; // The Beast's station
const KI_NEAR = { latitude: 39.3452, longitude: -84.2681 };

const JOIN_TIMEOUT = 45000;
const results = [];
const browser = await launch();

const score = async (persona, id, what, fn) => {
  let got = 0;
  let note = '';
  try {
    const r = await fn();
    got = typeof r === 'number' ? r : r ? 2 : 0;
    if (typeof r === 'object' && r) {
      got = r.score;
      note = r.note || '';
    }
  } catch (e) {
    note = e.message.split('\n')[0].slice(0, 90);
  }
  results.push({ persona, id, what, got, note });
  const mark = got === 2 ? '  ok  ' : got === 1 ? ' half ' : ' MISS ';
  console.log(`${mark}${id}  ${what}${note ? `  — ${note}` : ''}`);
  return got;
};

/**
 * Open the app the way she would: land on it, say yes to the questions it asks
 * in the words it asks them, and stop there.
 */
async function arrive(geo, { venue = null } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    permissions: ['geolocation', 'clipboard-read', 'clipboard-write'],
    geolocation: geo,
    colorScheme: 'light',
    locale: 'en-US',
  });
  // Persona B has to be standing in Fiesta Texas rather than answering an
  // intake question about it, so the choice is seeded rather than driven.
  // KI host/joiner seed the same way — grandma scores join UX, not intake.
  if (venue) {
    await ctx.addInitScript((id) => {
      localStorage.setItem('tracker-venue-confirmed', id);
    }, venue);
  }
  await ctx.addInitScript(() => {
    window.__PARTY_KEY_WINDOW_MS = 8000;
  });
  await ctx.addInitScript((version) => {
    localStorage.setItem('tracker-release-notes-seen', version);
    localStorage.setItem('tracker-intro-seen', '1');
  }, APP_VERSION);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    const where = `${m.text()} ${m.location()?.url ?? ''}`;
    if (
      m.type() === 'error' &&
      !/ERR_CERT|fonts\.|api\/weather|_vercel\/(insights|speed-insights)|favicon\.ico/i.test(where)
    ) {
      errors.push(where);
    }
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await closeGate(page);
  await until(async () => (await page.locator('.gate').count()) === 0, {
    timeout: 30000,
    label: 'grandma gate down',
  }).catch(() => {});
  await page.waitForTimeout(800);
  return { page, errors };
}

/** Tap something by the words on it. Returns false if nothing says that. */
const tapText = async (page, text) => {
  const el = page.getByText(text, { exact: false }).first();
  if (!(await el.count())) return false;
  await el.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
  return true;
};

const typeSearch = async (page, q) => {
  const field = page.locator('.field[aria-label="Search places"]');
  if (!(await field.count())) return false;
  await field.fill(q);
  await page.waitForTimeout(800);
  return true;
};

/* ============================================================
   B — Solo, at Six Flags Fiesta Texas
   ============================================================ */

console.log(`\ngrandma test against ${BASE}`);
console.log('\n--- B, on her own at Six Flags Fiesta Texas ---');
const B = await arrive(FIESTA, { venue: 'six-flags-fiesta-texas' });
const b = B.page;

/**
 * The rail put "nearest restroom" and "nearest food" on the resting screen as
 * cards. It is gone, and what stands in its place is `.moreHint` — one line
 * that names those two needs in words and is itself the handle that opens the
 * list. So the task is still doable without typing, but it costs taps.
 *
 * The 2 is deliberately left where it was: an answer she does not have to open
 * anything for. Nothing scores it any more, and that is the finding. 1 is the
 * new best case — the resting screen says the word, and tapping the word gets
 * her there. 0 is what it always was: she would have to type.
 */
const restSheet = async (page) => {
  // Back to the height the app opens at, using the handle she is meant to use
  // rather than a helper that knows the tab bar. The tap cycle wraps, so six
  // taps reaches every stop from any of them.
  for (let i = 0; i < 6 && !(await page.locator('.moreHint').count()); i += 1) {
    await page.locator('.grab').click().catch(() => {});
    await page.waitForTimeout(400);
  }
};

const reachByWord = async (page, want, chip) => {
  await restSheet(page);
  const resting = await page.locator('.sheet').innerText().catch(() => '');
  const restingRows = await page.locator('.poiRow', { hasText: want }).count();
  if (restingRows) return { score: 2, note: 'offered on the resting screen' };
  const hint = page.locator('.moreHint');
  if (!(await hint.count())) {
    return { score: 0, note: `nothing on the resting screen names it: ${resting.split('\n')[0]}` };
  }
  const words = (await hint.innerText()).trim();
  if (!want.test(words)) return { score: 0, note: `the way in does not say it: ${words}` };
  await hint.click();
  await page.waitForTimeout(800);
  // The list opens on what is nearest, which on a midway is rarely a toilet, so
  // the second tap is the category chip wearing the same word.
  const catChip = page.locator(`.chip:has-text("${chip}")`).first();
  if (!(await catChip.count())) return { score: 0, note: `no ${chip} chip once the list is up` };
  await catChip.click();
  await page.waitForTimeout(700);
  const rows = await page.locator('.poiRow').allInnerTexts();
  const found = rows.some((r) => want.test(r));
  const allChip = page.locator('.chip:has-text("All")').first();
  if (await allChip.count()) await allChip.click();
  await page.waitForTimeout(300);
  return found
    ? { score: 1, note: `named on the resting screen, two taps to it (hint, ${chip})` }
    : { score: 0, note: `the ${chip} chip did not bring one up` };
};

await score('B', 'B1', 'finds a toilet without typing or searching', () =>
  reachByWord(b, /restroom|toilet/i, 'Restrooms'),
);

await score('B', 'B2', 'finds nearest food without typing or deep scrolling', () =>
  reachByWord(b, /food|cantina|grill|pizza|burger|snack/i, 'Food'),
);

await score('B', 'B3', 'tapping category chips filters places without typing', async () => {
  // Opening the panel to see the category chips
  const chipsCount = await b.locator('.chips .chip').count();
  if (!chipsCount) {
    await b.locator('.grab').click().catch(() => {});
    await b.waitForTimeout(500);
  }
  const restroomChip = b.locator('.chip:has-text("Restrooms")').first();
  if (!(await restroomChip.count())) return { score: 0, note: 'no visible Restrooms chip' };
  await restroomChip.click();
  await b.waitForTimeout(600);
  const rows = await b.locator('.poiRow').allInnerTexts();
  if (!rows.length || !/restroom/i.test(rows[0])) {
    return { score: 0, note: 'tapping Restrooms chip did not bring restrooms to top' };
  }
  const allChip = b.locator('.chip:has-text("All")').first();
  if (await allChip.count()) await allChip.click();
  await b.waitForTimeout(400);
  return 2;
});

await score('B', 'B4', 'searching "atm" does not offer her BATMAN The Ride', async () => {
  if (!(await typeSearch(b, 'atm'))) return 0;
  const rows = await b.locator('.poiRow').allInnerTexts();
  return rows.some((r) => /batman/i.test(r)) ? 0 : 2;
});

await score('B', 'B5', 'starts walking with a clear route preview and simple stop button', async () => {
  await b.locator('button:has-text("Stop"), button:has-text("Cancel"), .navEnd').first().click().catch(() => {});
  await b.waitForTimeout(500);
  await typeSearch(b, '');
  /* The walk used to start from the rail's Go button. With the rail gone the
     list row is where a walk begins: open the row, and the row's own worded
     action starts it. `Walk me there` is the aria-label the button carries
     everywhere in the app (WORDS.navigation), so this asks for it by the
     words rather than by a class. */
  const restroomChip = b.locator('.chip:has-text("Restrooms")').first();
  if (await restroomChip.count()) {
    await restroomChip.click();
    await b.waitForTimeout(700);
  } else {
    await typeSearch(b, 'toilet');
  }
  if (!(await b.locator('.poiRow .poiMain').count())) return { score: 0, note: 'no place to walk to' };
  await b.locator('.poiRow .poiMain').first().click();
  await b.waitForTimeout(800);
  const goBtn = b.locator('.poiRow.open button[aria-label="Walk me there"]').first();
  if (await goBtn.count()) await goBtn.click();
  else if (!(await tapText(b, 'Walk me there'))) return { score: 0, note: 'the open row offers no walk' };
  await b.waitForTimeout(1000);
  const preview = b.locator('.routePreview');
  if (!(await preview.count())) return { score: 0, note: 'no route preview shown' };
  const startBtn = preview.locator('button:has-text("Start"), .previewGo').first();
  if (!(await startBtn.count())) return { score: 1, note: 'route preview has no start button' };
  await startBtn.click();
  await b.waitForTimeout(1200);
  const banner = await b.locator('.navBanner').count();
  const stopBtn = b.locator('.navEnd, button:has-text("Stop")').first();
  const hasStop = await stopBtn.count();
  if (!banner || !hasStop) return { score: 1, note: 'walk started but missing step banner or stop button' };
  // Tap Stop to return to map safely
  await stopBtn.click();
  await b.waitForTimeout(800);
  const stopped = (await b.locator('.navBanner').count()) === 0;
  return stopped ? 2 : { score: 1, note: 'stop button did not end walk' };
});

await score('B', 'B6', 'a dead-end search tells her in plain English what to do next', async () => {
  await b.locator('button:has-text("Stop"), button:has-text("Cancel")').first().click().catch(() => {});
  await b.waitForTimeout(600);
  if (!(await typeSearch(b, 'zzzzqq'))) return 0;
  const text = await b.locator('.poiList').innerText().catch(() => '');
  if (!text.trim()) return 0;
  const namesAWayOut = /try|instead|every place|called that/i.test(text);
  return namesAWayOut ? 2 : { score: 1, note: 'says nothing about what to do' };
});

await score('B', 'B7', 'the list says which part of the park things are in', async () => {
  await typeSearch(b, '');
  const rows = (await b.locator('.poiRow').allInnerTexts()).slice(0, 12);
  if (!rows.length) return 0;
  /* Somewhere that stands in no named district correctly falls back to the
     park's own name, so the question is not whether any row does that — it is
     whether the districts exist at all. Before the rebuild, every single row
     read "Six Flags Fiesta Texas" because the park had no districts mapped. */
  const named = rows.filter((r) => !/·\s*Six Flags Fiesta Texas/.test(r)).length;
  if (!named) return { score: 0, note: 'every row says only the park name' };
  return named >= rows.length / 2 ? 2 : { score: 1, note: `${named} of ${rows.length} name a Zone` };
});

await score('B', 'B8', 'the things she must tap are big enough to tap (44px target floor)', async () => {
  await typeSearch(b, '');
  /* The hint line is the resting screen's only worded way into the list, so it
     has to be measured in the state it appears in — typing in the search field
     grows the sheet past it, and a floor check that never sees the control is
     not a check. */
  await restSheet(b);
  const small = await b.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.chip, .navBack, .filterBadge, .btn.small')) {
      const r = el.getBoundingClientRect();
      if (!r.height) continue;
      const before = getComputedStyle(el, '::before');
      const grow = Math.abs(parseFloat(before.top || '0') || 0) + Math.abs(parseFloat(before.bottom || '0') || 0);
      if (r.height + grow < 44) out.push(`${el.className.split(' ')[0]} ${Math.round(r.height + grow)}px`);
    }
    /* Tab items and the map capsule's controls use centered ::after
       pseudo-elements with max(100%, 44px) — the selection capsule's
       Walk and Close, plus the hint line that is now the sheet's own handle,
       took the same treatment. */
    for (const el of document.querySelectorAll('.tabItem, .selWalk, .selClose, .moreHint, .fab')) {
      const r = el.getBoundingClientRect();
      if (!r.height) continue;
      const after = getComputedStyle(el, '::after');
      const hasAfterFloor = parseFloat(after.height || '0') >= 44 || parseFloat(after.width || '0') >= 44;
      const before = getComputedStyle(el, '::before');
      const grow = Math.abs(parseFloat(before.top || '0') || 0) + Math.abs(parseFloat(before.bottom || '0') || 0);
      if (r.height + grow < 44 && !hasAfterFloor) {
        out.push(`${el.className.split(' ')[0]} ${Math.round(r.height + grow)}px`);
      }
    }
    return out;
  });
  return small.length ? { score: 0, note: small.slice(0, 3).join(', ') } : 2;
});

await score('B', 'B9', 'reading text and icon sizes are large enough for arm’s length outdoors', async () => {
  /* The capsule only exists once a Place is picked, and a size check that
     silently skips the element it is there to measure proves nothing — so this
     puts one on screen first, then reads every piece of type at once. */
  if (!(await b.locator('.selCapsule').count())) {
    if (!(await b.locator('.poiRow .poiMain').count()) && (await b.locator('.moreHint').count())) {
      await b.locator('.moreHint').click();
      await b.waitForTimeout(800);
    }
    if (await b.locator('.poiRow .poiMain').count()) {
      await b.locator('.poiRow .poiMain').first().click();
      await b.waitForTimeout(900);
    }
  }
  const checks = await b.evaluate(() => {
    const issues = [];
    const poiName = document.querySelector('.poiName');
    if (poiName) {
      const size = parseFloat(getComputedStyle(poiName).fontSize || '0');
      if (size < 13.5) issues.push(`poiName ${size}px (<13.5px)`);
    }
    /* The selection capsule's .selName is the place name read over the map
       after a tap — the same job the glance rail cards used to carry. */
    const selName = document.querySelector('.selName');
    if (selName) {
      const size = parseFloat(getComputedStyle(selName).fontSize || '0');
      if (size < 13.5) issues.push(`selName ${size}px (<13.5px)`);
    }
    const tabLabel = document.querySelector('.tabLabel');
    if (tabLabel) {
      const size = parseFloat(getComputedStyle(tabLabel).fontSize || '0');
      if (size < 11) issues.push(`tabLabel ${size}px (<11px)`);
    }
    return issues;
  });
  await b.locator('.selCapsule .selClose').click().catch(() => {});
  await b.waitForTimeout(400);
  return checks.length ? { score: 1, note: checks.join(', ') } : 2;
});

await score('B', 'B10', 'can get the panel out of the way to see the map, and get it back', async () => {
  const stop = () => b.locator('.sheet').evaluate((e) =>
    ['shut', 'peek', 'half', 'full'].find((s) => e.classList.contains(s)) || null);
  const tap = async () => {
    await b.locator('.grab').click();
    await b.waitForTimeout(500);
  };
  let taps = 0;
  while ((await stop()) !== 'shut' && taps < 5) {
    await tap();
    taps += 1;
  }
  if ((await stop()) !== 'shut') return { score: 0, note: 'never fully collapses' };
  const h = await b.locator('.sheet').evaluate((e) => e.getBoundingClientRect().height);
  if (h > 140) return { score: 1, note: `still ${Math.round(h)}px tall` };
  // The tabs have to survive it, or she is stranded on whichever screen she left open.
  const tabs = await b.locator('.tabItem:visible').count();
  await tap();
  const back = (await stop()) !== 'shut';
  if (!tabs) return { score: 1, note: 'collapses, but takes the tabs with it' };
  return back ? 2 : { score: 0, note: 'no way back' };
});

await score('B', 'B11', 'a place she taps can be un-tapped', async () => {
  // The selection capsule is the answer to a place tap now — said over the map
  // where the pin is, and it carries its own Close.
  await typeSearch(b, 'rattler');
  await b.locator('.poiRow .poiMain').first().click();
  await b.waitForTimeout(1000);
  if (!(await b.locator('.selCapsule').count())) {
    return { score: 0, note: 'tapping a place said nothing over the map' };
  }
  const name = (await b.locator('.selCapsule .selName').innerText().catch(() => '')).trim();
  const close = b.locator('.selCapsule .selClose');
  if (!(await close.count())) return { score: 0, note: `${name || 'the capsule'} has no way out` };
  await close.click();
  await b.waitForTimeout(700);
  return (await b.locator('.selCapsule').count()) ? 0 : 2;
});

/**
 * B12 has changed what it asks, and it has to be read knowing that.
 *
 * It used to test the rail's ✕: swipe a card away, and Me lists it so it can
 * come back. D24 removed the rail, and with it the only thing that ever wrote
 * to `hiddenCards` — so the task this scored no longer exists anywhere in the
 * app, and there is no successor gesture to re-aim it at. Scoring the old flow
 * would be a permanent 0 for a feature the product deliberately dropped, which
 * is a lie in the other direction.
 *
 * What survived the removal is the *surface*: Me -> Settings -> Phone still
 * offers "What the panel shows", which now governs only whatever a phone hid
 * before the change. So the question B12 asks now is the one that is left and
 * still matters to a first-time visitor: does Me tell her the truth about it,
 * or does it hand her instructions for a gesture the app cannot perform? A
 * control that describes a thing she cannot do is worse than no control.
 *
 * This is not the old score. Do not compare the two rows across the D24 merge.
 */
await score('B', 'B12', 'Me tells the truth about what it can put back', async () => {
  await typeSearch(b, '');
  await b.locator('.tabItem[data-tab="settings"]').click();
  await b.waitForTimeout(800);
  // Me is the tab root; preferences are a screen under it.
  const settingsRow = b.locator('.mePanel .row', { hasText: 'Settings' }).first();
  if (await settingsRow.count()) {
    await settingsRow.click();
    await b.waitForTimeout(600);
  }
  const phoneTopic = b.locator('.settingsTopic', { hasText: 'Phone' });
  if (!(await phoneTopic.count())) return { score: 0, note: 'no Phone screen under Me' };
  await phoneTopic.click();
  await b.waitForTimeout(500);
  const shownRow = b.locator('.settingsPanel .row', { hasText: 'What the panel shows' }).first();
  if (!(await shownRow.count())) {
    // Removing the surface with the rail is a legitimate answer to the same
    // question, and a better one than a row governing nothing.
    await b.locator('.tabItem[data-tab="explore"]').click();
    await b.waitForTimeout(600);
    return { score: 2, note: 'the surface went with the rail' };
  }
  const rowText = (await shownRow.innerText()).replace(/\n/g, ' · ');
  await shownRow.click();
  await b.waitForTimeout(700);
  const screen = await b.locator('.hiddenCards').innerText().catch(() => '');
  if (!screen.trim()) return { score: 0, note: 'the row leads nowhere' };
  await b.locator('.tabItem[data-tab="explore"]').click();
  await b.waitForTimeout(800);
  /* The rail is the only thing that ever put a card in this list, and it is
     gone. Anything telling her to swipe or ✕ a card is describing an app she
     does not have. */
  const promises = /swipe|tap its|✕/i.test(`${rowText} ${screen}`);
  if (promises) {
    return { score: 0, note: `tells her to do something the app cannot: ${screen.split('\n').pop().slice(0, 60)}` };
  }
  return /nothing hidden|all showing/i.test(`${rowText} ${screen}`)
    ? 2
    : { score: 1, note: rowText.slice(0, 60) };
});

await score('B', 'B13', 'checking rider height for a grandchild gives plain-English verdicts', async () => {
  const ridesTab = b.locator('.tabItem[data-tab="rides"]');
  if (!(await ridesTab.count())) return { score: 0, note: 'no visible Plan/Rides tab' };
  await ridesTab.click();
  await b.waitForTimeout(700);
  const heightsSubTab = b.locator('.settingsTopic', { hasText: 'Heights' });
  if (await heightsSubTab.count()) {
    await heightsSubTab.click();
    await b.waitForTimeout(500);
  }
  const tier48 = b.locator('.tier:has-text("48")').first();
  if (!(await tier48.count())) return { score: 0, note: 'no 48" tier button' };
  await tier48.click();
  await b.waitForTimeout(600);
  const ratioKey = await b.locator('.ratioKey').innerText().catch(() => '');
  const clearBtn = b.locator('.labelAction:has-text("Clear")');
  if (await clearBtn.count()) await clearBtn.click();
  await b.locator('.tabItem[data-tab="explore"]').click();
  await b.waitForTimeout(600);
  if (/can ride/i.test(ratioKey) && /with adult/i.test(ratioKey) && /too short/i.test(ratioKey)) {
    return 2;
  }
  return { score: 1, note: ratioKey.slice(0, 60) || 'missing ratio key' };
});

/* ============================================================
   A — Joiner, at Kings Island
   ============================================================ */

console.log('\n--- A, handed a phone at Kings Island ---');
const host = await arrive(KI, { venue: 'kings-island' });
const h = host.page;
await h.locator('.tabItem[data-tab="party"]').click({ force: true });
await h.waitForTimeout(600);
if (await h.locator('.signInCard input[type="email"]').count()) {
  await h.locator('.signInCard input[type="email"]').fill('grandad@parkbound.example');
  await h.locator('.signInCard button:has-text("Email me a link")').click();
  await h.waitForTimeout(800);
}
await h.locator('.field[aria-label="Your name"]').fill('Grandad');
await h.locator('.field[aria-label="Your name"]').blur();
await h.waitForTimeout(400);
await h.locator('button:has-text("Start a party")').click({ force: true });
await h.waitForTimeout(4000);
const code = (await h.locator('.codeText').innerText().catch(() => '')).trim();
console.log(`       (the family's party is ${code || 'UNKNOWN'})`);

// Let the host's key window lapse, then leave the Party tab so nothing reopens
// it by accident — this is the state a party is in an hour into the day.
await h.locator('.tabItem[data-tab="explore"]').click({ force: true });
await h.waitForTimeout(12000);

const A = await arrive(KI_NEAR, { venue: 'kings-island' });
const a = A.page;

await score('A', 'A1', 'the code field explains itself and the safe alphabet', async () => {
  await a.locator('.tabItem[data-tab="party"]').click();
  await a.waitForTimeout(600);
  if (await a.locator('.signInCard input[type="email"]').count()) {
    await a.locator('.signInCard input[type="email"]').fill('grandma@parkbound.example');
    await a.locator('.signInCard button:has-text("Email me a link")').click();
    await a.waitForTimeout(900);
  }
  const idle = await a.locator('.sheet').innerText();
  if (!/read out loud/i.test(idle)) return { score: 0, note: 'says nothing about the alphabet' };
  await a.locator('.field.code').fill('ABC2');
  await a.waitForTimeout(400);
  const partial = await a.locator('.sheet').innerText();
  await a.locator('.field.code').fill('');
  return /to go/i.test(partial) ? 2 : { score: 1, note: 'no progress while typing' };
});

await score('A', 'A2', 'can still join by code an hour into the day', async () => {
  await a.locator('.tabItem[data-tab="party"]').click();
  await a.waitForTimeout(600);
  if (await a.locator('.signInCard input[type="email"]').count()) {
    await a.locator('.signInCard input[type="email"]').fill('grandma@parkbound.example');
    await a.locator('.signInCard button:has-text("Email me a link")').click();
    await a.waitForTimeout(900);
  }
  await a.locator('.field[aria-label="Your name"]').fill('Grandma');
  await a.locator('.field.code').fill(code);
  await a.locator('button:has-text("Join")').first().click();
  // Whatever it takes: the host is expected to notice and reopen.
  await h.locator('.tabItem[data-tab="party"]').click().catch(() => {});
  try {
    await until(async () => (await a.locator('.memberRow').count()) >= 2, {
      timeout: JOIN_TIMEOUT,
      label: 'the roster to fill',
    });
    return 2;
  } catch {
    return 0;
  }
});

await score('A', 'A3', 'appears as herself, not as "Guest"', async () => {
  const names = (await h.locator('.memberRow .memberText b').allInnerTexts()).join(' ');
  if (/Guest/i.test(names)) return { score: 0, note: names.replace(/\s+/g, ' ').slice(0, 60) };
  return /Grandma/.test(names) ? 2 : { score: 1, note: names.slice(0, 60) };
});

await score('A', 'A4', 'can see where a family member is on the resting screen', async () => {
  /* The rail carried a card per member, which said how far away they were but
     not where. The map has always drawn them by name, and with the rail gone
     the map is what the resting screen mostly is — so this asks the map, which
     is the better answer to "where" anyway. The tab bar's count is the
     fallback: it proves the app knows, but not where. */
  await a.locator('.tabItem[data-tab="explore"]').click();
  // The mesh has to land his position before the map can draw it, and a party
  // an hour old has no reason to be quick about it.
  const named = await until(
    async () => {
      // SVG <text> has no innerText, so textContent is the only way to read it.
      const txt = (await a.locator('svg.mapSvg .memMarker .memName').allTextContents()).join(' ');
      return /Grandad/.test(txt) ? txt : false;
    },
    { timeout: 25000, step: 1000, label: 'Grandad on the map' },
  ).catch(async () => (await a.locator('svg.mapSvg .memMarker .memName').allTextContents()).join(' '));
  if (/Grandad/.test(named)) return { score: 2, note: 'drawn on the map by name' };
  const badge = await a
    .locator('.tabItem[data-tab="party"] .tabBadge')
    .innerText()
    .catch(() => '');
  if (badge.trim()) return { score: 1, note: `only a count on the Party tab (${badge.trim()})` };
  return { score: 0, note: named ? `map shows: ${named.slice(0, 60)}` : 'nobody on the map' };
});

await score('A', 'A5', 'family Rally Point is clearly visible on the resting screen', async () => {
  // Host sets a Rally Point.
  await h.locator('.tabItem[data-tab="party"]').click();
  await h.waitForTimeout(600);
  const meetInput = h.locator('.field[aria-label="Rally Point location name"], input[placeholder*="Rally"], input[placeholder*="rally"]');
  if (await meetInput.count()) {
    await meetInput.fill('Carousel');
  }
  await h.locator('.tabItem[data-tab="explore"]').click();
  await h.waitForTimeout(600);
  /* Explore rests below the height the place list earns its room at, so the
     list has to be asked for before there is a row to rally on. This used to
     work by accident because the rail sat above the list and the sheet came to
     rest higher; the hint line is the way up now. */
  await restSheet(h);
  if (await h.locator('.moreHint').count()) {
    await h.locator('.moreHint').click();
    await h.waitForTimeout(900);
  }
  /* The list opens on what is nearest and virtualises the rest, so a landmark
     across the park is not in the DOM to be filtered for. The host is stage
     dressing rather than a persona, so he is allowed to type for it. */
  let carouselRow = h.locator('.poiRow').filter({ hasText: /Carousel|Eiffel|Fountain|Tower/i }).first();
  for (const term of ['Eiffel', 'Carousel', 'Tower', 'Fountain']) {
    if (await carouselRow.count()) break;
    if (!(await typeSearch(h, term))) break;
    carouselRow = h.locator('.poiRow').filter({ hasText: /Carousel|Eiffel|Fountain|Tower/i }).first();
  }
  if (!(await carouselRow.count())) return { score: 0, note: 'the host could not find a place to rally on' };
  await carouselRow.locator('.poiMain').click();
  await h.waitForTimeout(800);
  const meetBtn = h.locator('.poiRow.open button[aria-label="Rally the Party"]').first();
  if (!(await meetBtn.count())) return { score: 0, note: 'the open row offers no Rally action' };
  await meetBtn.click();
  await h.waitForTimeout(1500);
  /* On Grandma's screen the rail used to carry a Rally card, in words. What is
     left is the map's `.meetPin` — which shows her where, but says nothing, and
     the word "Rally" is a tab away. That is the honest 1: the resting screen
     points at it without naming it. 2 is reserved for a resting screen that
     both shows it and says what it is, and nothing does that now. */
  await a.locator('.tabItem[data-tab="explore"]').click();
  const pinned = await until(
    async () => (await a.locator('svg.mapSvg .meetPin').count()) > 0,
    { timeout: 25000, step: 1000, label: 'the Rally pin on the map' },
  ).catch(() => false);
  const resting = await a.locator('.sheet').innerText().catch(() => '');
  if (pinned && /RALLY|Rally Point/i.test(resting)) {
    return { score: 2, note: 'pinned on the map and named on the resting screen' };
  }
  // Check if it's on the party tab if mesh sync was slow
  await a.locator('.tabItem[data-tab="party"]').click();
  await a.waitForTimeout(800);
  const partyText = await a.locator('.sheet').innerText().catch(() => '');
  await a.locator('.tabItem[data-tab="explore"]').click();
  await a.waitForTimeout(400);
  if (pinned) {
    return { score: 1, note: 'pinned on the map, but the word is only in the Party tab' };
  }
  /* Nothing on her map. The Party tab always carries the words "Rally Point"
     — it is the label on the control that sets one — so reading them there is
     not evidence that one exists. The host's own map is: if the pin is not on
     his either, the Rally was never set and this is a broken step rather than
     a screen that failed to show it. */
  const onHost = await h.locator('svg.mapSvg .meetPin').count();
  if (!onHost) return { score: 0, note: 'no Rally pin on either phone — none was ever set' };
  return { score: 0, note: 'set on the host, never reached her map' };
});

await score('A', 'A6', 'calling for help takes intent, and can be taken back', async () => {
  await a.locator('.tabItem[data-tab="party"]').click();
  await a.waitForTimeout(700);
  const help = a.locator('button:has-text("I need help")');
  if (!(await help.count())) return 0;
  await help.click();
  await a.waitForTimeout(400);
  const armed = await a.locator('button:has-text("Tap again")').count();
  if (!armed) return { score: 1, note: 'fires on a single tap' };
  await a.locator('button:has-text("Tap again")').click();
  await a.waitForTimeout(2500);
  const back = await a.locator("button:has-text(\"I'm OK now\")").count();
  return back ? 2 : { score: 1, note: 'no way back' };
});

await score('A', 'A7', 'a help alert cannot be swiped away by others', async () => {
  /* A dismissable help card is a missed help card. The rail's help card was the
     signal; D24 made the Party tab's badge the primary one, and the whole point
     of putting it there is that a tab bar cannot be swiped away — so this now
     asks whether the badge fires at all, and whether anything on it offers a
     way to make it go away. Checked on the phone that can see it: the host's,
     since A is the one who raised it. */
  await h.locator('.tabItem[data-tab="explore"]').click();
  await h.waitForTimeout(2000);
  const tab = h.locator('.tabItem[data-tab="party"]');
  const badge = tab.locator('.tabBadge.alert');
  if (!(await badge.count())) {
    const said = (await tab.getAttribute('aria-label')) || '';
    return { score: 0, note: `the Party tab never raised the alert (${said})` };
  }
  const said = (await tab.getAttribute('aria-label')) || '';
  if (!/needs help/i.test(said)) return { score: 1, note: `alert shown but unlabelled: ${said}` };
  // Nothing inside the badge may be its own dismiss, and the map's help ring
  // is not dismissable either — the tab is the whole control.
  const dismiss = await badge.locator('button, [role="button"]').count();
  return dismiss ? { score: 0, note: 'the alert carries its own dismiss' } : 2;
});

await score('A', 'A8', 'the host is told the invite was copied', async () => {
  await h.locator('.tabItem[data-tab="party"]').click();
  await h.waitForTimeout(600);
  await h.locator('button:has-text("Copy link"), button:has-text("Send invite")').first().click();
  await h.waitForTimeout(900);
  const toast = await h.locator('.toast').innerText().catch(() => '');
  return /copied|read the code/i.test(toast) ? 2 : 0;
});

await score('A', 'A9', 'the app explains what a "party" even is in plain English', async () => {
  await a.locator('.tabItem[data-tab="settings"]').click();
  await a.waitForTimeout(700);
  const settingsRow = a.locator('.mePanel .row', { hasText: 'Settings' }).first();
  if (await settingsRow.count()) {
    await settingsRow.click();
    await a.waitForTimeout(600);
  }
  if (!(await tapText(a, 'What all this means'))) return 0;
  const text = await a.locator('.sheet').innerText();
  return /party is optional|stick together|party is your group/i.test(text)
    ? 2
    : { score: 1, note: 'opened, but says little' };
});

await score('A', 'A10', 'she is asked about notifications only once a party exists', async () => {
  // Nothing should have prompted before there was a party to prompt about.
  const settings = await a.locator('.sheet').innerText();
  const offered = /Turn on notifications|Tell me on this phone/i.test(settings);
  await a.locator('.tabItem[data-tab="party"]').click();
  await a.waitForTimeout(700);
  const inParty = await a.locator('.sheet').innerText();
  const asked = /Tell me on this phone/i.test(inParty);
  if (!asked && !offered) return { score: 0, note: 'never offered anywhere' };
  return asked ? 2 : { score: 1, note: 'only in settings' };
});

await score('A', 'A11', 'device-less grandchild appears clearly on the family roster', async () => {
  // Host adds Mia (a 40" device-less grandchild)
  await h.locator('.tabItem[data-tab="party"]').click();
  await h.waitForTimeout(600);
  const nameField = h.locator('.field[aria-label="Device-less member name"]');
  const heightField = h.locator('.field[aria-label="Height in inches"]');
  if (await nameField.count()) {
    await nameField.fill('Mia');
    if (await heightField.count()) await heightField.fill('40');
    await h.locator('button:has-text("Add")').click();
    await h.waitForTimeout(1000);
  }
  // Grandma checks party roster
  await a.locator('.tabItem[data-tab="party"]').click();
  await a.waitForTimeout(1200);
  const rosterText = await a.locator('.roster').innerText().catch(() => '');
  if (/Mia/i.test(rosterText) && /no phone/i.test(rosterText)) {
    return 2;
  }
  return { score: 1, note: rosterText.replace(/\n/g, ' · ').slice(0, 60) || 'Mia not on roster' };
});

/* ---------------------------------------------------------------- tally -- */

console.log('\n--- console errors ---');
for (const [who, ctx] of [['B', B], ['host', host], ['A', A]]) {
  if (ctx.errors.length) console.log(`  ! ${who}: ${ctx.errors.slice(0, 2).join(' | ').slice(0, 200)}`);
  else console.log(`  ok ${who}: none`);
}
const errored = [B, host, A].some((c) => c.errors.length);

console.log('\n============================================');
for (const p of ['B', 'A']) {
  const rows = results.filter((r) => r.persona === p);
  const got = rows.reduce((n, r) => n + r.got, 0);
  const max = rows.length * 2;
  const misses = rows.filter((r) => r.got === 0).map((r) => r.id);
  console.log(
    `  ${p === 'B' ? 'Solo  ' : 'Joiner'}  ${got}/${max}` +
      (misses.length ? `   failed outright: ${misses.join(', ')}` : '   nothing failed outright'),
  );
}
const total = results.reduce((n, r) => n + r.got, 0);
const max = results.length * 2;
console.log(`  overall ${total}/${max} (${Math.round((total / max) * 100)}%)`);
console.log('============================================\n');

await browser.close();
// A single 0 fails the run: these are not nice-to-haves, they are the tasks the
// app exists to do.
if (results.some((r) => r.got === 0) || total < max * 0.85 || errored) process.exitCode = 1;
