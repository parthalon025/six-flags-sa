#!/usr/bin/env node
/**
 * Capture store listing screenshots from the production host.
 *
 *   npm run store:screenshots
 *
 * Viewport is CSS points × deviceScaleFactor = required store pixels, so the
 * layout stays a phone (tab bar visible) rather than a huge desktop canvas.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { go, launch, openPhone } from '../test/app/browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.env.STORE_SCREENSHOT_URL || 'https://parkbound.kurat0r.ai';
const KI = { lat: 39.343828, lng: -84.265811 };

const devices = [
  {
    dir: join(root, 'fastlane', 'screenshots', 'ios', 'en-US'),
    prefix: 'iPhone 16 Pro Max',
    width: 440,
    height: 956,
    dpr: 3,
    extra: true,
  },
  {
    dir: join(root, 'fastlane', 'screenshots', 'ios', 'en-US'),
    prefix: 'iPhone 16 Pro',
    width: 402,
    height: 874,
    dpr: 3,
    extra: false,
  },
  {
    dir: join(root, 'fastlane', 'screenshots', 'ios', 'en-US'),
    prefix: 'iPad Pro 13',
    width: 1032,
    height: 1376,
    dpr: 2,
    extra: false,
    tablet: true,
  },
  {
    dir: join(root, 'fastlane', 'metadata', 'android', 'en-US', 'images', 'phoneScreenshots'),
    prefix: '',
    width: 360,
    height: 780,
    dpr: 3,
    extra: true,
  },
  {
    dir: join(root, 'fastlane', 'metadata', 'android', 'en-US', 'images', 'sevenInchScreenshots'),
    prefix: '',
    width: 600,
    height: 960,
    dpr: 2,
    extra: false,
    tablet: true,
  },
  {
    dir: join(root, 'fastlane', 'metadata', 'android', 'en-US', 'images', 'tenInchScreenshots'),
    prefix: '',
    width: 800,
    height: 1280,
    dpr: 2,
    extra: false,
    tablet: true,
  },
];

function dest(dir, prefix, name) {
  const file = prefix ? `${prefix}-${name}.png` : `${name}.png`;
  return join(dir, file);
}

async function snap(page, file) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, await page.screenshot({ type: 'png', fullPage: false }));
  console.log(`wrote ${file}`);
}

const browser = await launch();
try {
  for (const d of devices) {
    console.log(`capturing ${d.prefix || d.dir} ${d.width}×${d.height}@${d.dpr}`);
    const { context, page } = await openPhone(browser, {
      ...KI,
      url: HOST,
      venue: 'kings-island',
      viewport: { width: d.width, height: d.height },
      deviceScaleFactor: d.dpr,
      isMobile: !d.tablet,
      label: d.prefix || d.dir,
    });
    try {
      await snap(page, dest(d.dir, d.prefix, '01_map'));
      if (d.extra) {
        await go(page, 'Party');
        await snap(page, dest(d.dir, d.prefix, '02_party'));
        await go(page, 'Plan');
        await snap(page, dest(d.dir, d.prefix, '03_plan'));
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log('Glance at the PNGs, then unset IOS_SKIP_SCREENSHOTS / ANDROID_SKIP_SCREENSHOTS / ANDROID_SKIP_IMAGES.');
