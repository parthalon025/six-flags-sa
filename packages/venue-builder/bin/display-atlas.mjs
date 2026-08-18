#!/usr/bin/env node
/**
 * Sprite atlas build — ledger icons → one MapLibre-ready sheet, cached.
 *
 * Atlases are artifacts, never sources: output lands in a gitignored cache
 * directory named by content key (lib/display-atlas.mjs#atlasCacheKey), so
 * an unchanged ledger is a cache hit and a changed byte is a new key. Each
 * build writes sprite.png / sprite.json (and @2x pair), credits.json, and
 * an atlas.json manifest naming its inputs.
 *
 *   npm run venues:atlas             # all ledger icons at 32px
 *   npm run venues:atlas -- --px 24
 */

import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { OVERRIDE_DIR } from '../lib/venue-io.mjs';
import { readAssetLedger, assetPath, creditsManifest } from '../lib/display-assets.mjs';
import { atlasPlan, mapLibreSpriteJson, atlasCacheKey, ATLAS_VERSION } from '../lib/display-atlas.mjs';

const argv = process.argv.slice(2);
let px = 32;
let outRoot = path.join(OVERRIDE_DIR, '..', 'display', 'atlas');
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--px') px = Number(argv[++i]) || 32;
  else if (argv[i] === '--out') outRoot = path.resolve(argv[++i]);
}

const ledger = readAssetLedger();
const ids = Object.values(ledger).filter((r) => r.kind === 'icon').map((r) => r.id);
if (!ids.length) {
  console.error('no icon rows in the asset ledger — nothing to pack');
  process.exit(2);
}

const key = atlasCacheKey(ids, { ledger, px });
const outDir = path.join(outRoot, key);
const OUTPUTS = ['atlas.json', 'sprite.png', 'sprite.json', 'sprite@2x.png', 'sprite@2x.json', 'credits.json'];
if (OUTPUTS.every((f) => existsSync(path.join(outDir, f)))) {
  console.log(`atlas cache hit: ${outDir} (${ids.length} icons @ ${px}px, v${ATLAS_VERSION})`);
  process.exit(0);
}

const plan = atlasPlan(ids, { px });

// One transparent canvas per pixel ratio, icons composited at plan frames.
const page = (ratio) => `<!doctype html><body style="margin:0">
<canvas id="c" width="${plan.width * ratio}" height="${plan.height * ratio}"></canvas>
<script>
(async () => {
  const g = document.getElementById('c').getContext('2d');
  const frames = ${JSON.stringify(plan.frames)};
  const urls = ${JSON.stringify(Object.fromEntries(ids.map((id) => {
    const bytes = readFileSync(assetPath(ledger[id]));
    return [id, `data:image/svg+xml;base64,${bytes.toString('base64')}`];
  })))};
  for (const [id, f] of Object.entries(frames)) {
    const im = new Image();
    await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = urls[id]; });
    g.drawImage(im, f.x * ${ratio}, f.y * ${ratio}, f.w * ${ratio}, f.h * ${ratio});
  }
  window.__done = true;
})().catch((e) => { window.__error = String(e); window.__done = true; });
</script></body>`;

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
mkdirSync(outDir, { recursive: true });
for (const [suffix, ratio] of [['', 1], ['@2x', 2]]) {
  const tab = await browser.newPage({ viewport: { width: plan.width * ratio, height: plan.height * ratio } });
  await tab.setContent(page(ratio));
  await tab.waitForFunction('window.__done === true', null, { timeout: 60000 });
  const err = await tab.evaluate('window.__error');
  if (err) throw new Error(`atlas render failed: ${err}`);
  await tab.locator('#c').screenshot({ path: path.join(outDir, `sprite${suffix}.png`), omitBackground: true });
  writeFileSync(
    path.join(outDir, `sprite${suffix}.json`),
    `${JSON.stringify(mapLibreSpriteJson(plan, { pixelRatio: ratio }), null, 2)}\n`,
  );
  await tab.close();
}
await browser.close();

writeFileSync(path.join(outDir, 'credits.json'), `${JSON.stringify(creditsManifest(ids, ledger), null, 2)}\n`);
writeFileSync(
  path.join(outDir, 'atlas.json'),
  `${JSON.stringify({ version: ATLAS_VERSION, key, px, ids: [...ids].sort() }, null, 2)}\n`,
);
console.log(`atlas built: ${outDir} (${ids.length} icons @ ${px}px + @2x)`);
