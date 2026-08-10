#!/usr/bin/env node
/**
 * Rasterise PARKBOUND brand icons from the SVG sources.
 *
 *   node scripts/build-icons.mjs
 *
 * Writes public/icon-192.png, icon-512.png, icon-maskable-512.png,
 * and apple-touch-icon.png from public/icon.svg (+ icon-maskable.svg).
 * Requires Playwright Chromium (devDependency).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');

async function rasterise(svgPath, size, outPath) {
  const svg = readFileSync(svgPath, 'utf8');
  const html = `<!doctype html><html><body style="margin:0;background:transparent">
    <div id="c" style="width:${size}px;height:${size}px">${svg.replace(
      /width="\d+"/,
      `width="${size}"`,
    ).replace(/height="\d+"/, `height="${size}"`)}</div>
  </body></html>`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(html, { waitUntil: 'load' });
    const buf = await page.locator('#c').screenshot({ type: 'png', omitBackground: false });
    writeFileSync(outPath, buf);
    console.log(`wrote ${outPath} (${size}×${size})`);
  } finally {
    await browser.close();
  }
}

const icon = join(publicDir, 'icon.svg');
const maskable = join(publicDir, 'icon-maskable.svg');

await rasterise(icon, 192, join(publicDir, 'icon-192.png'));
await rasterise(icon, 512, join(publicDir, 'icon-512.png'));
await rasterise(icon, 180, join(publicDir, 'apple-touch-icon.png'));
await rasterise(maskable, 512, join(publicDir, 'icon-maskable-512.png'));
