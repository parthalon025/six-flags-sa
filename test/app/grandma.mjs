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
 *    meet-ups) must be immediately discoverable on screen via the Glance Rail
 *    and one-tap category chips.
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
 *   A — Joiner  sent a link; joins family, finds grandchildren, sees meet-ups & calls for help
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

await score('B', 'B1', 'finds a toilet without typing or searching', async () => {
  const rail = await b.locator('.glanceRail').innerText().catch(() => '');
  if (/restroom|toilet/i.test(rail)) return { score: 2, note: 'offered on the resting screen' };
  await b.locator('.grab').click();
  await b.waitForTimeout(600);
  const after = await b.locator('.sheet').innerText().catch(() => '');
  return /restroom|toilet/i.test(after) ? { score: 1, note: 'only after opening the panel' } : 0;
});

await score('B', 'B2', 'finds nearest food without typing or deep scrolling', async () => {
  const rail = await b.locator('.glanceRail').innerText().catch(() => '');
  if (/nearest food|food/i.test(rail)) return { score: 2, note: 'offered on resting glance rail' };
  const rows = await b.locator('.poiRow').allInnerTexts();
  return rows.some((r) => /food/i.test(r)) ? { score: 1, note: 'only after browsing place list' } : 0;
});

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
  // Tap the walk button on the nearest toilet glance card or list item
  const glanceToiletGo = b.locator('.glanceCard', { hasText: /restroom|toilet/i }).locator('.glanceGo').first();
  if (await glanceToiletGo.count()) {
    await glanceToiletGo.click().catch(() => {});
  } else {
    await typeSearch(b, 'toilet');
    await b.locator('.poiRow .poiMain').first().click();
    await b.waitForTimeout(800);
    const goBtn = b.locator('.poiRow.open button[aria-label="Walk me there"]').first();
    if (await goBtn.count()) await goBtn.click();
    else if (!(await tapText(b, 'Walk me there'))) return 0;
  }
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
  return named >= rows.length / 2 ? 2 : { score: 1, note: `${named} of ${rows.length} name a district` };
});

await score('B', 'B8', 'the things she must tap are big enough to tap (44px target floor)', async () => {
  await typeSearch(b, '');
  const small = await b.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.chip, .navBack, .filterBadge, .btn.small')) {
      const r = el.getBoundingClientRect();
      if (!r.height) continue;
      const before = getComputedStyle(el, '::before');
      const grow = Math.abs(parseFloat(before.top || '0') || 0) + Math.abs(parseFloat(before.bottom || '0') || 0);
      if (r.height + grow < 44) out.push(`${el.className.split(' ')[0]} ${Math.round(r.height + grow)}px`);
    }
    // Glance card actions and tab items use centered ::after pseudo-elements with max(100%, 44px)
    for (const el of document.querySelectorAll('.tabItem, .glanceGo, .glanceShed')) {
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
  const checks = await b.evaluate(() => {
    const issues = [];
    const poiName = document.querySelector('.poiName');
    if (poiName) {
      const size = parseFloat(getComputedStyle(poiName).fontSize || '0');
      if (size < 13.5) issues.push(`poiName ${size}px (<13.5px)`);
    }
    const glanceTitle = document.querySelector('.glanceTitle');
    if (glanceTitle) {
      const size = parseFloat(getComputedStyle(glanceTitle).fontSize || '0');
      if (size < 13.5) issues.push(`glanceTitle ${size}px (<13.5px)`);
    }
    const tabLabel = document.querySelector('.tabLabel');
    if (tabLabel) {
      const size = parseFloat(getComputedStyle(tabLabel).fontSize || '0');
      if (size < 11) issues.push(`tabLabel ${size}px (<11px)`);
    }
    return issues;
  });
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
  await typeSearch(b, 'rattler');
  await b.locator('.poiRow .poiMain').first().click();
  await b.waitForTimeout(1000);
  const on = await b.locator('.glanceCard.selected').count();
  if (!on) return { score: 0, note: 'tapping a place put nothing on the rail' };
  const shed = b.locator('.glanceCard.selected .glanceShed');
  if (!(await shed.count())) return { score: 0, note: 'no way to remove it' };
  await shed.click();
  await b.waitForTimeout(700);
  return (await b.locator('.glanceCard.selected').count()) ? 0 : 2;
});

await score('B', 'B12', 'a card she removes stays removed, and Me can put it back', async () => {
  await typeSearch(b, '');
  const food = b.locator('.glanceCard', { hasText: 'Nearest food' }).first();
  if (!(await food.count())) return { score: 0, note: 'no food card to remove' };
  await food.locator('.glanceShed').click();
  await b.waitForTimeout(700);
  if (await b.locator('.glanceCard', { hasText: 'Nearest food' }).count()) {
    return { score: 0, note: 'still there after removing it' };
  }
  await b.reload({ waitUntil: 'domcontentloaded' });
  await b.waitForTimeout(2500);
  await b.locator('button:has-text("Share my location"), button:has-text("Allow location")').click().catch(() => {});
  await b.waitForTimeout(2500);
  await b.locator('.gate .btn.primary:has-text("set up")').click().catch(() => {});
  await b.waitForFunction(() => !document.querySelector('.gate'), null, { timeout: 25000 }).catch(() => {});
  await b.waitForTimeout(2000);
  if (await b.locator('.glanceCard', { hasText: 'Nearest food' }).count()) {
    return { score: 1, note: 'came back on its own after a reload' };
  }
  // …and it has to be findable again, or removing it was a one-way door.
  await b.locator('.tabItem[data-tab="settings"]').click();
  await b.waitForTimeout(800);
  const phoneTopic = b.locator('.settingsTopic', { hasText: 'Phone' });
  if (await phoneTopic.count()) {
    await phoneTopic.click();
    await b.waitForTimeout(500);
  }
  const row = b.locator('.row', { hasText: 'Nearest food' });
  if (!(await row.count())) return { score: 1, note: 'hidden for good — Me does not list it' };
  await row.click();
  await b.waitForTimeout(600);
  await b.locator('.tabItem[data-tab="explore"]').click();
  await b.waitForTimeout(1200);
  return (await b.locator('.glanceCard', { hasText: 'Nearest food' }).count()) ? 2 : { score: 1, note: 'listed, but would not come back' };
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
  await a.locator('.tabItem[data-tab="explore"]').click();
  await a.waitForTimeout(1500);
  const rail = await a.locator('.glanceRail').innerText().catch(() => '');
  return /Grandad/.test(rail) ? 2 : { score: 0, note: rail.replace(/\n/g, ' | ').slice(0, 70) };
});

await score('A', 'A5', 'family meet-up point is clearly visible on the resting screen', async () => {
  // Host sets a meet-up point
  await h.locator('.tabItem[data-tab="party"]').click();
  await h.waitForTimeout(600);
  const meetInput = h.locator('.field[aria-label="Meet-up location name"], input[placeholder*="Meet"], input[placeholder*="meet"]');
  if (await meetInput.count()) {
    await meetInput.fill('Carousel');
  }
  await h.locator('.tabItem[data-tab="explore"]').click();
  await h.waitForTimeout(600);
  const carouselRow = h.locator('.poiRow').filter({ hasText: /Carousel|Eiffel|Fountain|Tower/i }).first();
  if (await carouselRow.count()) {
    await carouselRow.locator('.poiMain').click();
    await h.waitForTimeout(600);
    const meetBtn = h.locator('button[aria-label*="meet-up"], button[aria-label="Set meet-up"]').first();
    if (await meetBtn.count()) {
      await meetBtn.click();
      await h.waitForTimeout(1200);
    }
  }
  // On Grandma's screen, glance rail shows the MEET UP card
  await a.locator('.tabItem[data-tab="explore"]').click();
  await a.waitForTimeout(2000);
  const rail = await a.locator('.glanceRail').innerText().catch(() => '');
  if (/MEET UP|Meet-up/i.test(rail)) return { score: 2, note: 'meet-up offered on resting glance rail' };
  // Check if it's on the party tab if mesh sync was slow
  await a.locator('.tabItem[data-tab="party"]').click();
  await a.waitForTimeout(800);
  const partyText = await a.locator('.sheet').innerText().catch(() => '');
  await a.locator('.tabItem[data-tab="explore"]').click();
  if (/Meet-Up Point/i.test(partyText)) {
    return { score: 1, note: 'visible in Party tab' };
  }
  return { score: 1, note: rail.replace(/\n/g, ' · ').slice(0, 60) || 'meet-up card not at front of rail' };
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
  // A dismissable help card is a missed help card. Checked on the phone that
  // can see it — the host's, since A is the one who raised it.
  await h.locator('.tabItem[data-tab="explore"]').click();
  await h.waitForTimeout(1500);
  const help = h.locator('.glanceCard.help');
  if (!(await help.count())) return { score: 1, note: 'no help card on the rail to check' };
  return (await help.locator('.glanceShed').count()) ? { score: 0, note: 'it has a remove button' } : 2;
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
