/**
 * Drive the real app and record what it actually showed.
 *
 * This is the only file in the twin that opens a browser, and the only one that
 * writes app data into the record. Everything it writes was read off a screen
 * the app painted: the class names, the strings, the tokens the matching CSS
 * rules asked for, the Place names, the party code. Nothing is typed in here,
 * and a screen that cannot be reached is recorded as unreached with the reason
 * — an honest gap beats a plausible invention, which is the whole lesson of the
 * twin this one replaces.
 *
 * The harness is `test/app/browser.mjs`, unchanged and unwrapped: it already
 * knows how to get past the intake, wait for real map geometry rather than the
 * placeholder, and move between tabs. A second copy of that knowledge in this
 * file would be a second copy to keep right.
 *
 * Interface:
 *   captureTwin(options) → record   (the shape record.mjs persists)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../design-bundle/sources.mjs';
import {
  BASE,
  closeGate,
  dismissNavigation,
  go,
  launch,
  openPhone,
  until,
} from '../../../test/app/browser.mjs';
import { RECORD_VERSION, SHOT_DIR, componentIndex, fingerprint } from './record.mjs';
import { annotate, sourceIndex } from './resolve.mjs';
import { screenPlan } from './plan.mjs';

/* Kings Island is the manifest's own `default` venue — read, not chosen, so a
   change of default moves the capture with it. The fix is a real bench inside
   it; the app needs a position it can call "near" something to show the resting
   Explore screen at all. */
const MANIFEST = 'apps/party-tracker/public/venues/manifest.json';

export function defaultVenue() {
  const manifest = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'));
  return manifest.venues.find((v) => v.id === manifest.default) ?? manifest.venues[0];
}

/* Both palettes, by their shipped names. The keys are the values the app writes
   to `document.documentElement.dataset.theme`; the labels are read off the
   palette control's own aria-label at capture time, never typed here. */
export const PALETTES = ['day', 'night'];

/* ------------------------------------------------------------------
   The evidence collector
   ------------------------------------------------------------------ */

/**
 * Everything the twin knows about a screen, measured in the page.
 *
 * Runs in the browser, so it sees what a guest sees: the elements that are
 * actually on screen and actually visible, not the ones React happens to have
 * mounted off-canvas. Four things come back:
 *
 *   classes  the class names on visible elements — the evidence ownership is
 *            resolved from, because a class on screen was written by whoever
 *            wrote the class.
 *   tokens   every custom property named by a CSS rule that MATCHES a visible
 *            element. Not "tokens this component mentions" — tokens this screen
 *            is painted with, measured by the engine that painted it.
 *   strings  the copy, one visual line at a time. A string that is a substring
 *            of another is dropped, so "73" and "°" collapse into the "73°" the
 *            chip actually reads.
 *   labels   the accessible names, which are copy too and are the half a
 *            screenshot cannot show.
 */
/* eslint-disable no-undef -- this function body is serialised into the browser */
function collectEvidence() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const els = [...document.querySelectorAll(':is(html, body, body *)')].filter(visible);

  const classes = new Set();
  for (const el of els) for (const c of el.classList) classes.add(c);

  const tokens = new Set();
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a cross-origin sheet cannot be read; none of ours are
    }
    const walk = (list) => {
      for (const rule of list) {
        if (rule.selectorText && rule.style) {
          let hit = false;
          try {
            hit = els.some((el) => el.matches(rule.selectorText));
          } catch {
            hit = false; // a selector this engine will not parse cannot match
          }
          if (hit) {
            for (let i = 0; i < rule.style.length; i += 1) {
              const value = String(rule.style.getPropertyValue(rule.style.item(i)));
              for (const m of value.matchAll(/var\(\s*(--[\w-]+)/g)) tokens.add(m[1]);
            }
          }
        }
        if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules);
      }
    };
    walk(rules);
  }

  const lines = [];
  for (const el of els) {
    const t = (el.innerText || '').trim();
    if (!t || t.includes('\n') || t.length > 200) continue;
    lines.push(t);
  }
  const strings = [...new Set(lines)]
    .filter((a, _i, all) => !all.some((b) => b !== a && b.includes(a)))
    .sort();

  const labels = [...new Set(els.map((el) => el.getAttribute('aria-label')).filter(Boolean))].sort();

  return {
    classes: [...classes].sort(),
    tokens: [...tokens].sort(),
    strings,
    labels,
    theme: document.documentElement.dataset.theme || null,
  };
}
/* eslint-enable no-undef */

/* ------------------------------------------------------------------
   Shots
   ------------------------------------------------------------------ */

/* The per-file ceiling the twin holds itself to.
 *
 * DesignSync's own cap is 256 KiB (DESIGN_SYNC_LIMITS in the design bundle) and
 * that is the hard wall. This is lower on purpose: a shot that lands at 250 KiB
 * passes today and fails the first time a screen gains a busier map, and a push
 * that fails on file 31 of 46 is a bad way to find out. Half the cap leaves
 * room for the app to get more detailed without anybody having to come back
 * here.
 */
export const SHOT_MAX_BYTES = 128 * 1024;

/* WebP quality ladder. The first rung that fits under the ceiling wins, so an
   ordinary screen is stored at 0.72 and only a genuinely dense one pays for it.
   A PNG of this app is ~900 KB and a JPEG is ~130 KB with visible ringing on
   13px type, which is the one thing a design reference must not add. */
const QUALITY_LADDER = [0.72, 0.6, 0.5, 0.4];

/**
 * Encode a screenshot as WebP — in the browser that took it.
 *
 * Playwright writes PNG or JPEG and nothing else, and a PNG of a phone screen
 * at 2× is ~900 KB, over any per-file cap worth having. Rather than add an
 * image library as a dependency of a design script, the encode is handed back
 * to Chromium, which has a WebP encoder and is already running. No new
 * dependency, no native build, and the file that ships is the same pixels the
 * capture saw.
 */
async function encodeWebp(scratch, png) {
  for (const quality of QUALITY_LADDER) {
    const b64 = await scratch.evaluate(
      async ({ source, q }) => {
        /* eslint-disable no-undef -- browser context */
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${source}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        const blob = await canvas.convertToBlob({ type: 'image/webp', quality: q });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
        /* eslint-enable no-undef */
      },
      { source: png.toString('base64'), q: quality },
    );
    const buffer = Buffer.from(b64, 'base64');
    if (buffer.length <= SHOT_MAX_BYTES) return { buffer, quality };
  }
  throw new Error(
    `design-twin: a shot would not compress under ${SHOT_MAX_BYTES} bytes at any quality on the ladder`,
  );
}

/** Freeze everything that moves, so a shot is of a screen and not of a frame. */
async function stillCss(page) {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation: none !important; transition: none !important;
      caret-color: transparent !important;
    }`,
  });
}

/**
 * Put the app in one palette and PROVE it.
 *
 * The control cycles auto → Trail → Park Midnight, and `auto` resolves from the
 * clock — so asking for Trail at 2am and assuming you got it is how a page ends
 * up captioned with the palette it is not showing. The loop reads
 * `documentElement.dataset.theme` back after every press and stops when the app
 * agrees, and the caller throws if it never does.
 */
async function setPalette(page, want) {
  const button = page.getByRole('button', { name: /switch to (Trail|Park Midnight)/i }).first();
  if (!(await button.isVisible().catch(() => false))) {
    /* The control lives in the map's top bar. Every screen in the tour leaves
       that bar showing, but a mode that covers it (the walking chrome) would
       not — so fall back to the one screen the control is certainly on. */
    await go(page, 'Explore');
    await button.waitFor({ state: 'visible', timeout: 20000 });
  }
  for (let i = 0; i < 4; i += 1) {
    const got = await page.evaluate(() => document.documentElement.dataset.theme);
    if (got === want) return;
    await button.click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  const got = await page.evaluate(() => document.documentElement.dataset.theme);
  throw new Error(`design-twin: asked for the ${want} palette, the app is showing ${got}`);
}

/* ------------------------------------------------------------------
   The signed-in half, as far as this machine can reach it
   ------------------------------------------------------------------ */

/* A Profile the app will accept, and NOTHING that pretends to be a person.
 *
 * There are no Clerk keys on the machines these captures run on, so a real
 * sign-in is unreachable — the OAuth screens genuinely cannot be photographed
 * and the twin says so rather than drawing them. What CAN be reached is the
 * app's own signed-in rendering, by writing a session into the key
 * `lib/auth/session.js` reads (the same mechanism `test/app/functional.mjs`
 * uses, and for the same reason: without a Profile, WorldMarks answers
 * "Sign in" before it ever reaches the screen being examined).
 *
 * The two fields written here are deliberately NOT plausible. A twin whose
 * signed-in screens show a convincing name and a convincing Title is a twin
 * that has invented a person, and every page carrying one of these shots says
 * on its face that the session was seeded. Rank, Title and XP are left out
 * entirely so the app derives them with its own `rankFromXp` / `titleFromXp`
 * rather than being handed numbers by this file.
 */
const SEEDED_PROFILE = {
  userId: 'usr_design_twin_seeded',
  displayName: 'Seeded Profile',
  email: 'seeded@design-twin.invalid',
  xp: 0,
};

/** The session key, read from the module that owns it rather than retyped. */
function sessionKey(index) {
  const src = index.read('apps/party-tracker/lib/auth/session.js');
  const m = src.match(/SESSION_KEY\s*=\s*'([^']+)'/);
  if (!m) {
    throw new Error(
      'design-twin: lib/auth/session.js no longer declares SESSION_KEY — the seeded-Profile ' +
        'leg reads the key from there so the two cannot drift apart.',
    );
  }
  return m[1];
}

/**
 * What a Profile changes on a screen — everything that differed, unfiltered.
 *
 * `changed` here is deliberately generous: it means "not literally identical",
 * and it only decides whether a shot is TAKEN. Whether that shot is worth
 * SHOWING is `profileShown` in resolve.mjs, which is a judgement about copy and
 * branches rather than about pixels, and which therefore belongs on the pure
 * side of the line, where it can be re-run without a browser.
 *
 * Splitting it that way is what lets the rule be revised. The first version
 * filtered here, at capture time, and getting it wrong meant a thirteen-minute
 * re-photograph to find out. Now the raw diff is in the record and
 * `design:twin resolve` re-decides in seconds.
 */
function evidenceDiff(before, after) {
  const gained = (a, b) => b.filter((x) => !a.includes(x));
  const classesGained = gained(before.classes, after.classes);
  const classesLost = gained(after.classes, before.classes);
  return {
    stringsGained: gained(before.strings, after.strings),
    stringsLost: gained(after.strings, before.strings),
    classesGained,
    classesLost,
    changed:
      classesGained.length > 0 ||
      classesLost.length > 0 ||
      gained(before.strings, after.strings).length > 0 ||
      gained(after.strings, before.strings).length > 0,
  };
}

/**
 * Walk the tour once more with a session seeded, and record what changed.
 *
 * One palette only. The question it answers is "what does a Profile change
 * here", which is about content rather than colour, and a second palette would
 * double the walk to say nothing new.
 *
 * Exported because it is worth running on its own: the signed-out evidence is
 * already in the committed record, so `design-twin profile` re-runs just this
 * leg in a few minutes instead of re-photographing everything. Returns an error
 * message, or null — the leg is an extra, and losing it must never cost the
 * seventeen screens the main tour already took.
 */
export async function walkSeededProfile({ page, scratch, plan, index, venue, signedOut, onShot, onLog = () => {} }) {
  try {
    await setPalette(page, PALETTES[0]);
    await page.evaluate(
      ([key, profile]) => sessionStorage.setItem(key, JSON.stringify(profile)),
      [sessionKey(index), SEEDED_PROFILE],
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await closeGate(page);
    await stillCss(page);
    onLog('seeded Profile: re-walking the tour to see what changes');

    for (const screen of plan) {
      const before = signedOut.get(screen.id);
      if (!before) continue; // never reached signed out; nothing to compare
      try {
        await screen.reach(page, { venue, palette: PALETTES[0] });
        await page.waitForTimeout(screen.settle ?? 600);
      } catch (err) {
        onLog(`  ${screen.id} (profile): unreached — ${err.message}`);
        continue;
      }
      const after = await page.evaluate(collectEvidence);
      const diff = evidenceDiff(before, after);
      if (!diff.changed) continue;

      const png = await page.screenshot({ type: 'png' });
      const { buffer, quality } = await encodeWebp(scratch, png);
      const file = `${screen.id}-profile.webp`;
      writeFileSync(join(root, SHOT_DIR, file), buffer);
      const box = page.viewportSize();
      onShot(screen.id, {
        shot: { file, bytes: buffer.length, quality, width: box.width, height: box.height },
        palette: PALETTES[0],
        ...diff,
      });
      onLog(
        `  ${screen.id} (profile) — ${(buffer.length / 1024).toFixed(1)} KiB, ` +
          `${diff.stringsGained.length} strings gained, ${diff.stringsLost.length} lost`,
      );
    }
    return null;
  } catch (err) {
    onLog(`seeded Profile: leg abandoned — ${err.message}`);
    return err.message;
  }
}

/** The browser, opened the way the harness opens it (CHROMIUM_PATH honoured). */
export const launchForCapture = launch;

/**
 * Open one phone on the app, ready to be driven. Shared by the full tour and by
 * the seeded-Profile leg, so the two cannot open the app in two different ways.
 */
export async function openTwinPhone(browser, { baseUrl, venue }) {
  const { context, page } = await openPhone(browser, {
    lat: venue.center.lat,
    lng: venue.center.lng,
    url: baseUrl,
    venue: venue.id,
    label: 'twin',
  });
  await stillCss(page);
  const scratch = await context.newPage();
  await scratch.goto('about:blank');
  return { context, page, scratch };
}

/* ------------------------------------------------------------------
   The tour
   ------------------------------------------------------------------ */

export async function captureTwin({
  baseUrl = BASE,
  venue = defaultVenue(),
  onLog = () => {},
} = {}) {
  const index = sourceIndex();
  const plan = screenPlan(index);
  const browser = await launch();
  const started = new Date().toISOString();

  mkdirSync(join(root, SHOT_DIR), { recursive: true });

  const { context, page, scratch } = await openTwinPhone(browser, { baseUrl, venue });

  /* One entry per screen, filled in across both palette passes. A screen that
     is never reached keeps its `unreached` reason and no shots — which is what
     the page then says about it. */
  const screens = new Map(
    plan.map((s) => [
      s.id,
      { id: s.id, title: s.title, intent: s.intent, shots: {}, evidence: null, unreached: null, profile: null },
    ]),
  );
  /* The palettes' names, from the app's own function.
   *
   * The obvious source is the toggle's `aria-label`, and it is the wrong one:
   * in manual mode it reads "Switch to Trail map", so the name comes back with
   * the control's object stuck to it and the pages caption a palette "Trail
   * map". `paletteModeLabel` is what the app calls each palette when it has to
   * name one, so it is called here — the same move the design bundle makes when
   * it calls `mapPaint()` instead of parsing a hex table. `Trail` and
   * `Park Midnight` are written nowhere in the twin. */
  const { paletteModeLabel } = await import(join(root, 'apps/party-tracker/lib/mapVisual.js'));
  const paletteLabels = Object.fromEntries(PALETTES.map((p) => [p, paletteModeLabel(p)]));
  let profileLegError = null;

  /* Screen-major, not palette-major.
   *
   * The obvious tour is two passes — the whole app in Trail, then the whole app
   * in Park Midnight — and it is wrong here, because some screens are one-way.
   * Starting a party really starts one, so a Party-before / Party-after pair
   * photographed on opposite passes puts "Not started" beside a live roster and
   * calls them the same screen in two palettes. Taking both palettes of a screen
   * before moving on keeps each pair a pair.
   */
  for (const screen of plan) {
    const entry = screens.get(screen.id);
    for (const palette of PALETTES) {
      try {
        await setPalette(page, palette);
        await stillCss(page);
        await screen.reach(page, { venue, palette });
        await page.waitForTimeout(screen.settle ?? 600);
      } catch (err) {
        entry.unreached = err.message;
        onLog(`  ${screen.id} (${palette}): unreached — ${err.message}`);
        continue;
      }
      entry.unreached = null;

      const evidence = await page.evaluate(collectEvidence);
      if (evidence.theme !== palette) {
        throw new Error(
          `design-twin: ${screen.id} was captured with data-theme="${evidence.theme}" ` +
            `while the ${palette} shot was being taken`,
        );
      }
      /* Union across palettes: the same screen in two palettes is the same
         screen, and a string only one shot happened to catch is still real. */
      entry.evidence = mergeEvidence(entry.evidence, evidence);

      const png = await page.screenshot({ type: 'png' });
      const { buffer, quality } = await encodeWebp(scratch, png);
      const file = `${screen.id}-${palette}.webp`;
      writeFileSync(join(root, SHOT_DIR, file), buffer);
      const box = page.viewportSize();
      entry.shots[palette] = {
        file,
        bytes: buffer.length,
        quality,
        width: box.width,
        height: box.height,
      };
      onLog(`  ${screen.id} (${palette}) — ${(buffer.length / 1024).toFixed(1)} KiB`);
    }
  }

  /* ---- the seeded-Profile leg ---- */
  profileLegError = await walkSeededProfile({
    page,
    scratch,
    plan,
    index,
    venue,
    onLog,
    signedOut: new Map([...screens].map(([id, e]) => [id, e.evidence])),
    onShot: (id, profile) => {
      screens.get(id).profile = profile;
    },
  });

  await context.close();
  await browser.close();

  /* ---- resolve the evidence against the code, once, here ----
     Done at capture time so the record carries the attribution it was made
     with. `design:build` then renders a record rather than re-deriving one,
     and the staleness check has a concrete list of files to watch. */
  const inputPaths = new Set([
    'apps/party-tracker/app/globals.css',
    'apps/party-tracker/app/page.js',
    MANIFEST,
  ]);

  const { annotated, sources } = annotate([...screens.values()], index);
  for (const rel of sources) inputPaths.add(rel);

  return {
    recordVersion: RECORD_VERSION,
    capturedAt: started,
    baseUrl,
    venue: { id: venue.id, name: venue.name, locality: venue.locality },
    palettes: PALETTES,
    paletteLabels,
    seededProfile: { ...SEEDED_PROFILE, key: sessionKey(index), error: profileLegError },
    viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
    shotMaxBytes: SHOT_MAX_BYTES,
    screens: annotated,
    componentIndex: componentIndex(),
    inputs: fingerprint([...inputPaths]),
  };
}

function mergeEvidence(a, b) {
  if (!a) return { ...b, theme: undefined };
  const union = (x, y) => [...new Set([...x, ...y])].sort();
  return {
    classes: union(a.classes, b.classes),
    tokens: union(a.tokens, b.tokens),
    strings: union(a.strings, b.strings),
    labels: union(a.labels, b.labels),
  };
}

export { collectEvidence, setPalette, stillCss, until, closeGate, dismissNavigation };
