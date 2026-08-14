#!/usr/bin/env node
/**
 * Encode the family-day recording into an App Store iPhone preview.
 *
 *   npm run store:app-preview
 *
 * Source defaults to fastlane/app_previews/src/family-day.webm (Playwright
 * 780×1688 canvas; UI is the top-left 390×844). Override with
 * STORE_APP_PREVIEW_SOURCE. Output is IPHONE_67_family-day.mp4 — 886×1920,
 * 15–30s, no device frame (Apple adds the bezel).
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPO_ROOT,
  assertAppleIphonePreview,
  encodeAppPreview,
  listingPreviewPath,
} from './lib/store-app-preview.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source =
  process.env.STORE_APP_PREVIEW_SOURCE ||
  join(root, 'fastlane/app_previews/src/family-day.webm');
const output = process.env.STORE_APP_PREVIEW_OUTPUT || listingPreviewPath(root);

/** Skip the glitchy first-load + map download; keep the in-park walkthrough. */
const TRIM_START = Number(process.env.STORE_APP_PREVIEW_START || 31.97);
const TRIM_END = Number(process.env.STORE_APP_PREVIEW_END || 60.9);

const FAMILY_DAY_CAPTIONS = [
  { start: 0.0, end: 2.9, text: 'You are on the map' },
  { start: 2.99, end: 4.15, text: 'Name this phone so the family can find you' },
  { start: 4.21, end: 6.65, text: 'Start a party — everyone stays together' },
  { start: 6.74, end: 8.45, text: 'How tall is the rider?' },
  { start: 8.54, end: 10.6, text: 'See which rides the kids can go on' },
  { start: 10.72, end: 12.85, text: 'Pick a ride' },
  { start: 12.93, end: 14.25, text: 'Meet-up · Plan · Walk' },
  { start: 14.33, end: 15.85, text: 'Drop a meet-up pin for the family' },
  { start: 15.95, end: 17.45, text: 'Add it to today’s Plan' },
  { start: 17.53, end: 20.0, text: 'Walk there on guest paths' },
  { start: 20.11, end: 21.9, text: 'Start walking — arrival time on screen' },
  { start: 21.99, end: 27.0, text: 'Follow the trail' },
  { start: 27.09, end: 28.9, text: 'Explore more. Stress less.' },
];

if (!existsSync(source)) {
  console.error(`Missing preview source: ${source}`);
  process.exit(1);
}

const probe = encodeAppPreview({
  source,
  output,
  trimStart: TRIM_START,
  trimEnd: TRIM_END,
  captions: FAMILY_DAY_CAPTIONS,
});
assertAppleIphonePreview(probe);
console.log(`Wrote ${output.replace(REPO_ROOT + '/', '')}`);
console.log(
  `${probe.width}x${probe.height} ${probe.duration.toFixed(2)}s ${probe.videoCodec}/${probe.profile} ${probe.fps.toFixed(2)}fps ${(probe.bytes / 1e6).toFixed(1)}MB`,
);
