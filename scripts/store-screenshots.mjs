#!/usr/bin/env node
/**
 * Capture App Store / Play listing screenshots from production.
 *
 *   npm run store:screenshots
 *
 * iPhone frames use Apple 6.7" pixels (1290×2796) with marketing headlines.
 * Viewport is CSS points × deviceScaleFactor so layout stays phone-sized.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeMarketingFrame } from './lib/store-screenshot-compose.mjs';
import { go, launch, openPhone } from '../test/app/browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.env.STORE_SCREENSHOT_URL || 'https://parkbound.kurat0r.ai';
const KI = { lat: 39.343828, lng: -84.265811 };

/** @typedef {{ id: string; headline: string; subhead: string; capture: (page: import('playwright').Page) => Promise<void> }} Slide */

/** @type {Slide[]} */
const SLIDES = [
  {
    id: '01_explore',
    headline: 'Explore more. Stress less.',
    subhead: 'A drawn park map with toilets, food, and rides near you — live.',
    capture: async (page) => {
      await go(page, 'Places');
      await openSheet(page, 'full');
      await page.waitForTimeout(700);
    },
  },
  {
    id: '02_quests',
    headline: 'Side quests at every ride.',
    subhead: 'On-the-ground checks that keep heights, gaps, and wait vibes honest.',
    capture: async (page) => {
      await go(page, 'Side Quests');
      await page.waitForTimeout(900);
    },
  },
  {
    id: '03_plan',
    headline: 'Plan rides by height.',
    subhead: 'Pick a rider height and see what they can board before you walk.',
    capture: async (page) => {
      await go(page, 'Rider height');
      await openSheet(page, 'full');
      await page.locator('.tier', { hasText: '48' }).click();
      await page.waitForTimeout(700);
    },
  },
  {
    id: '04_party',
    headline: 'Keep your party together.',
    subhead: 'Share a code or QR. Everyone sees where the family is on the map.',
    capture: async (page) => {
      await go(page, 'Party');
      await openSheet(page, 'full');
      const name = page.locator('input[aria-label="Your name"], input[placeholder="Name"]');
      if (await name.count()) await name.fill('The Park Family');
      await page.waitForTimeout(600);
    },
  },
  {
    id: '05_rides',
    headline: 'Every ride. One glance.',
    subhead: 'Search the park, filter by height, and jump straight to the map.',
    capture: async (page) => {
      await go(page, 'Places');
      await openSheet(page, 'full');
      await page.locator('.chip:has-text("Rides")').first().click();
      await page.waitForTimeout(700);
    },
  },
];

const IOS_PHONE = {
  width: 430,
  height: 932,
  dpr: 3,
};

const IOS_DEVICES = ['iPhone 16 Pro Max', 'iPhone 15 Pro Max', 'iPhone 14 Pro Max'];

const IPAD = {
  prefix: 'iPad Pro 13',
  width: 1024,
  height: 1366,
  dpr: 2,
};

async function openSheet(page, stop = 'full') {
  for (let i = 0; i < 4; i += 1) {
    if (await page.locator(`.sheet.${stop}`).count()) return;
    const slider = page.getByRole('slider', { name: /Resize panel/ });
    if (await slider.count()) await slider.click();
    await page.waitForTimeout(350);
  }
}

function iosPath(prefix, slideId) {
  return join(root, 'fastlane', 'screenshots', 'ios', 'en-US', `${prefix}-${slideId}.png`);
}

function androidPath(dir, slideId) {
  return join(root, dir, `${slideId}.png`);
}

async function captureSlides(page, composePage, { marketing }) {
  /** @type {Map<string, Buffer>} */
  const raws = new Map();
  for (const slide of SLIDES) {
    await slide.capture(page);
    raws.set(slide.id, await page.screenshot({ type: 'png', fullPage: false }));
  }

  /** @type {Map<string, Buffer>} */
  const finals = new Map();
  for (const slide of SLIDES) {
    const raw = raws.get(slide.id);
    finals.set(
      slide.id,
      marketing
        ? await composeMarketingFrame(composePage, {
            rawPng: raw,
            headline: slide.headline,
            subhead: slide.subhead,
          })
        : raw,
    );
  }
  return finals;
}

function writePng(file, buf) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buf);
  console.log(`wrote ${file}`);
}

const browser = await launch();
const composePage = await browser.newPage();
try {
  console.log(`capturing from ${HOST}`);

  const { context, page } = await openPhone(browser, {
    ...KI,
    url: HOST,
    venue: 'kings-island',
    viewport: { width: IOS_PHONE.width, height: IOS_PHONE.height },
    deviceScaleFactor: IOS_PHONE.dpr,
    isMobile: true,
    label: 'store-ios',
  });

  try {
    const iosShots = await captureSlides(page, composePage, { marketing: true });
    for (const prefix of IOS_DEVICES) {
      for (const slide of SLIDES) {
        writePng(iosPath(prefix, slide.id), iosShots.get(slide.id));
      }
    }
  } finally {
    await context.close();
  }

  const { context: padCtx, page: padPage } = await openPhone(browser, {
    ...KI,
    url: HOST,
    venue: 'kings-island',
    viewport: { width: IPAD.width, height: IPAD.height },
    deviceScaleFactor: IPAD.dpr,
    isMobile: false,
    label: 'store-ipad',
  });

  try {
    const padShots = await captureSlides(padPage, composePage, { marketing: false });
    for (const slide of SLIDES.slice(0, 3)) {
      writePng(iosPath(IPAD.prefix, slide.id), padShots.get(slide.id));
    }
  } finally {
    await padCtx.close();
  }

  const { context: droidCtx, page: droidPage } = await openPhone(browser, {
    ...KI,
    url: HOST,
    venue: 'kings-island',
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 3,
    isMobile: true,
    label: 'store-android',
  });

  try {
    const androidShots = await captureSlides(droidPage, composePage, { marketing: false });
    const androidDirs = [
      join('fastlane', 'metadata', 'android', 'en-US', 'images', 'phoneScreenshots'),
      join('fastlane', 'metadata', 'android', 'en-US', 'images', 'sevenInchScreenshots'),
    ];
    for (const dir of androidDirs) {
      for (const slide of SLIDES) {
        writePng(androidPath(join(root, dir), slide.id), androidShots.get(slide.id));
      }
    }
  } finally {
    await droidCtx.close();
  }
} finally {
  await composePage.close();
  await browser.close();
}

console.log(
  `\nDone. ${SLIDES.length} iPhone marketing frames × ${IOS_DEVICES.length} device names, iPad + Android raw shots.`,
);
console.log('Upload: set IOS_SKIP_SCREENSHOTS=false and run the iOS App Store metadata workflow.');
