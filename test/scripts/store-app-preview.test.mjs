#!/usr/bin/env node
/**
 * App Store Connect iPhone preview: 886×1920, 15–30s, H.264 High, stereo AAC.
 *
 *   node test/scripts/store-app-preview.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IPHONE_PREVIEW,
  PREVIEW_DIR,
  assertAppleIphonePreview,
  encodeAppPreview,
  listingPreviewPath,
  previewFilename,
  previewIssues,
  probeVideo,
} from '../../scripts/lib/store-app-preview.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

assert.equal(IPHONE_PREVIEW.width, 886);
assert.equal(IPHONE_PREVIEW.height, 1920);
assert.equal(IPHONE_PREVIEW.minSeconds, 15);
assert.equal(IPHONE_PREVIEW.maxSeconds, 30);
assert.equal(previewFilename('family-day'), 'IPHONE_67_family-day.mp4');
assert.equal(
  listingPreviewPath(root).replace(/\\/g, '/').endsWith(
    'fastlane/app_previews/en-US/IPHONE_67_family-day.mp4',
  ),
  true,
);
assert.equal(PREVIEW_DIR.replace(/\\/g, '/').endsWith('fastlane/app_previews'), true);

const valid = {
  width: 886,
  height: 1920,
  duration: 24.5,
  fps: 30,
  videoCodec: 'h264',
  profile: 'High',
  audioCodec: 'aac',
  audioChannels: 2,
  bytes: 8_000_000,
};

assert.deepEqual(previewIssues(valid), []);
assert.equal(assertAppleIphonePreview(valid), valid);

assert.match(
  previewIssues({ ...valid, width: 780, height: 1688 }).join('\n'),
  /886×1920/,
);
assert.match(previewIssues({ ...valid, duration: 10 }).join('\n'), /15/);
assert.match(previewIssues({ ...valid, duration: 30.2 }).join('\n'), /30/);
assert.match(previewIssues({ ...valid, fps: 60 }).join('\n'), /30 fps/);
assert.match(previewIssues({ ...valid, videoCodec: 'vp8' }).join('\n'), /h264/i);
assert.match(previewIssues({ ...valid, audioChannels: 1 }).join('\n'), /stereo/i);
assert.match(previewIssues({ ...valid, audioCodec: null }).join('\n'), /aac/i);

const dir = mkdtempSync(join(tmpdir(), 'store-preview-'));
const source = join(dir, 'source.mp4');
const output = join(dir, previewFilename('unit'));
try {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x1a2744:s=780x1688:r=25:d=18',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      source,
    ],
    { stdio: 'ignore' },
  );
  encodeAppPreview({ source, output, trimStart: 0, trimEnd: 16, captions: [] });
  const probe = probeVideo(output);
  assert.deepEqual(previewIssues(probe), [], probe);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const listing = listingPreviewPath(root);
const listingProbe = probeVideo(listing);
assert.deepEqual(previewIssues(listingProbe), [], listingProbe);

const fastfile = readFileSync(join(root, 'fastlane/Fastfile'), 'utf8');
assert.match(fastfile, /app_previews_path/);
assert.match(fastfile, /preview_frame_time_code/);

const workflow = readFileSync(join(root, '.github/workflows/ios-app-store-metadata.yml'), 'utf8');
assert.match(workflow, /fastlane\/app_previews/);

console.log('store-app-preview tests ok');
