#!/usr/bin/env node
/**
 * Rasterise PARKBOUND brand icons from the SVG sources.
 *
 *   node scripts/build-icons.mjs
 *
 * Writes PWA icons under apps/party-tracker/public/, the iOS 1024 App Store
 * icon, Android launcher mipmaps, Play listing art, and Trail-coloured
 * splash screens. Requires Playwright Chromium (devDependency).
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'apps', 'party-tracker', 'public');
const TRAIL = '#F7F4EC';

async function rasteriseHtml(browser, html, width, height, outPath) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    const buf = await page.locator('#c').screenshot({ type: 'png', omitBackground: false });
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, buf);
    console.log(`wrote ${outPath} (${width}×${height})`);
  } finally {
    await page.close();
  }
}

function svgBox(svg, size) {
  return `<!doctype html><html><body style="margin:0;background:transparent">
    <div id="c" style="width:${size}px;height:${size}px">${svg
      .replace(/width="\d+"/, `width="${size}"`)
      .replace(/height="\d+"/, `height="${size}"`)}</div>
  </body></html>`;
}

function featureGraphic(svg) {
  const mark = svg
    .replace(/width="\d+"/, 'width="280"')
    .replace(/height="\d+"/, 'height="280"');
  return `<!doctype html><html><body style="margin:0">
    <div id="c" style="width:1024px;height:500px;background:${TRAIL};display:flex;align-items:center;gap:48px;padding:0 72px;box-sizing:border-box;font-family:ui-sans-serif,system-ui,sans-serif">
      ${mark}
      <div>
        <div style="font-size:72px;font-weight:700;letter-spacing:-0.03em;color:#1a1a1a">Park Bound</div>
        <div style="font-size:28px;margin-top:12px;color:#27B8B0">Explore more. Stress less.</div>
      </div>
    </div>
  </body></html>`;
}

function splashHtml(svg, width, height) {
  const mark = Math.round(Math.min(width, height) * 0.36);
  const inset = svg
    .replace(/width="\d+"/, `width="${mark}"`)
    .replace(/height="\d+"/, `height="${mark}"`);
  return `<!doctype html><html><body style="margin:0">
    <div id="c" style="width:${width}px;height:${height}px;background:${TRAIL};display:flex;align-items:center;justify-content:center">${inset}</div>
  </body></html>`;
}

const icon = join(publicDir, 'icon.svg');
const maskable = join(publicDir, 'icon-maskable.svg');
const svg = readFileSync(icon, 'utf8');
const mask = readFileSync(maskable, 'utf8');

const browser = await chromium.launch();
try {
  await rasteriseHtml(browser, svgBox(svg, 192), 192, 192, join(publicDir, 'icon-192.png'));
  await rasteriseHtml(browser, svgBox(svg, 512), 512, 512, join(publicDir, 'icon-512.png'));
  await rasteriseHtml(browser, svgBox(svg, 180), 180, 180, join(publicDir, 'apple-touch-icon.png'));
  await rasteriseHtml(browser, svgBox(mask, 512), 512, 512, join(publicDir, 'icon-maskable-512.png'));

  const iosIcon = join(root, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png');
  await rasteriseHtml(browser, svgBox(svg, 1024), 1024, 1024, iosIcon);

  const playImages = join(root, 'fastlane', 'metadata', 'android', 'en-US', 'images');
  await rasteriseHtml(browser, svgBox(svg, 512), 512, 512, join(playImages, 'icon.png'));
  await rasteriseHtml(browser, featureGraphic(svg), 1024, 500, join(playImages, 'featureGraphic.png'));

  const densities = [
    { name: 'mdpi', launcher: 48, foreground: 108 },
    { name: 'hdpi', launcher: 72, foreground: 162 },
    { name: 'xhdpi', launcher: 96, foreground: 216 },
    { name: 'xxhdpi', launcher: 144, foreground: 324 },
    { name: 'xxxhdpi', launcher: 192, foreground: 432 },
  ];
  for (const d of densities) {
    const dir = join(root, 'android', 'app', 'src', 'main', 'res', `mipmap-${d.name}`);
    await rasteriseHtml(browser, svgBox(svg, d.launcher), d.launcher, d.launcher, join(dir, 'ic_launcher.png'));
    await rasteriseHtml(browser, svgBox(svg, d.launcher), d.launcher, d.launcher, join(dir, 'ic_launcher_round.png'));
    await rasteriseHtml(browser, svgBox(svg, d.foreground), d.foreground, d.foreground, join(dir, 'ic_launcher_foreground.png'));
  }

  await rasteriseHtml(
    browser,
    splashHtml(svg, 1080, 1920),
    1080,
    1920,
    join(root, 'android', 'app', 'src', 'main', 'res', 'drawable', 'splash.png'),
  );
} finally {
  await browser.close();
}

const resRoot = join(root, 'android', 'app', 'src', 'main', 'res');
for (const name of readdirSync(resRoot)) {
  if (!/^drawable-(land|port)-/.test(name)) continue;
  const splash = join(resRoot, name, 'splash.png');
  copyFileSync(join(resRoot, 'drawable', 'splash.png'), splash);
  console.log(`copied splash → ${splash}`);
}
