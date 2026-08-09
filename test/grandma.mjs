#!/usr/bin/env node
/**
 * The grandma test.
 *
 * Not a regression suite. A regression suite asks whether the app still does
 * what it did; this asks whether a stranger can get anything out of it — a
 * non-technical, first-time, older visitor who has been handed a phone and has
 * no idea how any of it is meant to work.
 *
 * Two people, scored separately:
 *
 *   B — Solo    she needs a toilet, then food, and to walk there
 *   A — Joiner  someone sent her a link; she must appear on the family's map,
 *               find a grandchild, and be able to call for help
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

import { BASE, launch, until } from './browser.mjs';
import { readFileSync } from 'node:fs';

const APP_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;

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
  if (venue) {
    await ctx.addInitScript((id) => {
      localStorage.setItem('tracker-venue', id);
      localStorage.setItem('tracker-venue-confirmed', id);
    }, venue);
  }
  await ctx.addInitScript(() => {
    window.__PARTY_KEY_WINDOW_MS = 8000;
  });
  await ctx.addInitScript((version) => {
    localStorage.setItem('tracker-release-notes-seen', version);
  }, APP_VERSION);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    const where = `${m.text()} ${m.location()?.url ?? ''}`;
    if (m.type() === 'error' && !/ERR_CERT|fonts\.|api\/weather/.test(where)) errors.push(where);
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.locator('.gate .btn.primary:has-text("Continue")').click().catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Allow location")').click().catch(() => {});
  await page.waitForTimeout(2500);
  await page.locator('.gate .btn.primary:has-text("Yes — set up")').click().catch(() => {});
  await page.waitForFunction(() => !document.querySelector('.gate'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
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

await score('B', 'B1', 'finds a toilet without typing anything', async () => {
  const rail = await b.locator('.glanceRail').innerText().catch(() => '');
  if (/restroom|toilet/i.test(rail)) return { score: 2, note: 'offered on the resting screen' };
  await b.locator('.grab').click();
  await b.waitForTimeout(600);
  const after = await b.locator('.sheet').innerText().catch(() => '');
  return /restroom|toilet/i.test(after) ? { score: 1, note: 'only after opening the panel' } : 0;
});

await score('B', 'B2', 'searching "toilet" finds toilets', async () => {
  if (!(await typeSearch(b, 'toilet'))) return 0;
  const rows = await b.locator('.poiRow').allInnerTexts();
  if (!rows.length) return 0;
  return /restroom/i.test(rows[0]) ? 2 : { score: 1, note: `first hit: ${rows[0].split('\n')[0]}` };
});

await score('B', 'B3', 'searching "food" finds food', async () => {
  if (!(await typeSearch(b, 'food'))) return 0;
  const rows = await b.locator('.poiRow').allInnerTexts();
  return rows.length >= 3 && /food/i.test(rows[0]) ? 2 : rows.length ? 1 : 0;
});

await score('B', 'B4', 'searching "atm" does not offer her BATMAN The Ride', async () => {
  if (!(await typeSearch(b, 'atm'))) return 0;
  const rows = await b.locator('.poiRow').allInnerTexts();
  return rows.some((r) => /batman/i.test(r)) ? 0 : 2;
});

await score('B', 'B5', 'a walk inside the park is not named after the mall next door', async () => {
  await typeSearch(b, 'toilet');
  await b.locator('.poiRow .poiMain').first().click();
  await b.waitForTimeout(1000);
  if (!(await tapText(b, 'Walk me there'))) return 0;
  await b.waitForTimeout(3500);
  const sheet = await b.locator('.sheet').innerText().catch(() => '');
  if (/La Cantera|Legend Hills/i.test(sheet)) return { score: 0, note: 'still routes "via" the mall' };
  const banner = await b.locator('.navBanner').count();
  const nav = await b.locator('.navBar').count();
  return banner || nav || /min/.test(sheet) ? 2 : { score: 1, note: 'no route drawn' };
});

await score('B', 'B6', 'a dead-end search tells her what to do next', async () => {
  await b.locator('button:has-text("Stop"), button:has-text("Cancel")').first().click().catch(() => {});
  await b.waitForTimeout(800);
  if (!(await typeSearch(b, 'zzzzqq'))) return 0;
  const text = await b.locator('.poiList').innerText().catch(() => '');
  if (!text.trim()) return 0;
  const namesAWayOut = /try|instead|every place/i.test(text);
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

await score('B', 'B8', 'the things she must tap are big enough to tap', async () => {
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
    return out;
  });
  return small.length ? { score: 0, note: small.slice(0, 3).join(', ') } : 2;
});

await score('B', 'B9', 'can get the panel out of the way, and get it back', async () => {
  const stop = () => b.locator('.sheet').evaluate((e) =>
    ['shut', 'peek', 'half', 'full'].find((s) => e.classList.contains(s)) || null);
  const tap = async () => {
    await b.locator('.grab').click();
    await b.waitForTimeout(500);
  };
  // Round the cycle until it is out of the way, which must not take for ever.
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

await score('B', 'B10', 'a place she taps can be un-tapped', async () => {
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

await score('B', 'B11', 'a card she removes stays removed, and Me can put it back', async () => {
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
  await b.locator('button:has-text("Allow location")').click().catch(() => {});
  await b.waitForTimeout(2500);
  await b.locator('.gate .btn.primary:has-text("Yes — set up")').click().catch(() => {});
  await b.waitForFunction(() => !document.querySelector('.gate'), null, { timeout: 25000 }).catch(() => {});
  await b.waitForTimeout(2000);
  if (await b.locator('.glanceCard', { hasText: 'Nearest food' }).count()) {
    return { score: 1, note: 'came back on its own after a reload' };
  }
  // …and it has to be findable again, or removing it was a one-way door.
  await b.locator('.tabItem[data-tab="settings"]').click();
  await b.waitForTimeout(800);
  const row = b.locator('.row', { hasText: 'Nearest food' });
  if (!(await row.count())) return { score: 1, note: 'hidden for good — Me does not list it' };
  await row.click();
  await b.waitForTimeout(600);
  await b.locator('.tabItem[data-tab="explore"]').click();
  await b.waitForTimeout(1200);
  return (await b.locator('.glanceCard', { hasText: 'Nearest food' }).count()) ? 2 : { score: 1, note: 'listed, but would not come back' };
});

/* ============================================================
   A — Joiner, at Kings Island
   ============================================================ */

console.log('\n--- A, handed a phone at Kings Island ---');
const host = await arrive(KI);
const h = host.page;
await h.locator('.tabItem[data-tab="party"]').click();
await h.waitForTimeout(600);
await h.locator('.field[aria-label="Your name"]').fill('Grandad');
await h.locator('.field[aria-label="Your name"]').blur();
await h.waitForTimeout(400);
await h.locator('button:has-text("Start a party")').click();
await h.waitForTimeout(4000);
const code = (await h.locator('.codeText').innerText().catch(() => '')).trim();
console.log(`       (the family's party is ${code || 'UNKNOWN'})`);

// Let the host's key window lapse, then leave the Party tab so nothing reopens
// it by accident — this is the state a party is in an hour into the day.
await h.locator('.tabItem[data-tab="explore"]').click();
await h.waitForTimeout(12000);

const A = await arrive(KI_NEAR);
const a = A.page;

await score('A', 'A3', 'the code field explains itself', async () => {
  await a.locator('.tabItem[data-tab="party"]').click();
  await a.waitForTimeout(600);
  const idle = await a.locator('.sheet').innerText();
  if (!/read out loud/i.test(idle)) return { score: 0, note: 'says nothing about the alphabet' };
  await a.locator('.field.code').fill('ABC2');
  await a.waitForTimeout(400);
  const partial = await a.locator('.sheet').innerText();
  await a.locator('.field.code').fill('');
  return /to go/i.test(partial) ? 2 : { score: 1, note: 'no progress while typing' };
});

await score('A', 'A1', 'can still join by code an hour into the day', async () => {
  await a.locator('.tabItem[data-tab="party"]').click();
  await a.waitForTimeout(600);
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

await score('A', 'A2', 'appears as herself, not as "Guest"', async () => {
  const names = (await h.locator('.memberRow .memberText b').allInnerTexts()).join(' ');
  if (/Guest/i.test(names)) return { score: 0, note: names.replace(/\s+/g, ' ').slice(0, 60) };
  return /Grandma/.test(names) ? 2 : { score: 1, note: names.slice(0, 60) };
});

await score('A', 'A4', 'can see where a grandchild is', async () => {
  await a.locator('.tabItem[data-tab="explore"]').click();
  await a.waitForTimeout(1500);
  const rail = await a.locator('.glanceRail').innerText().catch(() => '');
  return /Grandad/.test(rail) ? 2 : { score: 0, note: rail.replace(/\n/g, ' | ').slice(0, 70) };
});

await score('A', 'A5', 'calling for help takes intent, and can be taken back', async () => {
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

await score('A', 'A9', 'a help alert cannot be swiped away', async () => {
  // A dismissable help card is a missed help card. Checked on the phone that
  // can see it — the host's, since A is the one who raised it.
  await h.locator('.tabItem[data-tab="explore"]').click();
  await h.waitForTimeout(1500);
  const help = h.locator('.glanceCard.help');
  if (!(await help.count())) return { score: 1, note: 'no help card on the rail to check' };
  return (await help.locator('.glanceShed').count()) ? { score: 0, note: 'it has a remove button' } : 2;
});

await score('A', 'A6', 'the host is told the invite was copied', async () => {
  await h.locator('.tabItem[data-tab="party"]').click();
  await h.waitForTimeout(600);
  await h.locator('button:has-text("Copy link"), button:has-text("Send invite")').first().click();
  await h.waitForTimeout(900);
  const toast = await h.locator('.toast').innerText().catch(() => '');
  return /copied|read the code/i.test(toast) ? 2 : 0;
});

await score('A', 'A7', 'the app explains what a "party" even is', async () => {
  await a.locator('.tabItem[data-tab="settings"]').click();
  await a.waitForTimeout(700);
  if (!(await tapText(a, 'What all this means'))) return 0;
  const text = await a.locator('.sheet').innerText();
  return /party is your group/i.test(text) ? 2 : { score: 1, note: 'opened, but says little' };
});

await score('A', 'A8', 'she is asked about notifications only once a party exists', async () => {
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
