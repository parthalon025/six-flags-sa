#!/usr/bin/env node
/**
 * Harvest material swatches — turn a URL in the ledger into pixels we can paint.
 *
 * The materials ledger has always described textures it never fetched: rows
 * declaring `maps: ["basecolor","normal","orm"]` at 1024px, a budget gate
 * policing that number, and a style compiler painting flat hex regardless.
 * Wiring a full PBR pipeline to fix that is a large piece of work with a
 * texture cache, an atlas, and a phone-side cost.
 *
 * There is a much cheaper trick, borrowed from how GameRealisticMap builds its
 * "fake satellite" image: take the texture's smallest mip and tile *that*. An
 * 8x8 average carries the material's colour and a hint of its grain, costs
 * ~200 bytes committed, needs no runtime fetch, and is enough for a stylised
 * park map that is never zoomed to grain level.
 *
 * So this fetches each CC0 material's 64px preview once, downsamples it to 8x8
 * in a headless browser (which already ships for the bake — no image library
 * added), and writes `avgColor` + `swatch8` back into the ledger with the
 * source URL and a sha256 of the bytes it read. CI never runs this; it
 * consumes the committed values, exactly like the asset pins.
 *
 *   node packages/venue-builder/bin/display-swatches.mjs          # report
 *   node packages/venue-builder/bin/display-swatches.mjs --fetch  # harvest
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEDGER = path.join(HERE, '..', 'data', 'display', 'materials.json');
const API = 'https://ambientcg.com/api/v2/full_json';
/** Preferred thumbnail sizes, smallest first — not every asset publishes all. */
const THUMBS = ['64-PNG', '128-PNG', '256-PNG', '512-PNG'];

/** Colours for materials that are our own procedural graphs, not a download. */
const AUTHORED = {
  'water--calm': '#58AEDC',
  'water--pool': '#4FC3E8',
  'fiberglass--flume': '#E8834A',
};

const fetchMode = process.argv.includes('--fetch');
const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));

const ambientId = (source) => /ambientcg\.com\/view\?id=([A-Za-z0-9]+)/.exec(source || '')?.[1] || null;

async function previewUrlFor(assetId) {
  const res = await fetch(`${API}?id=${encodeURIComponent(assetId)}&include=previewData`);
  if (!res.ok) throw new Error(`ambientCG API ${res.status} for ${assetId}`);
  const json = await res.json();
  const asset = json.foundAssets?.[0];
  if (!asset) throw new Error(`ambientCG has no asset "${assetId}" — the ledger cites a dead source`);
  for (const size of THUMBS) {
    const url = asset.previewImage?.[size];
    if (url) return url;
  }
  throw new Error(`no preview in ${THUMBS.join('/')} for ${assetId}`);
}

/** Downsample to 8x8 in the browser; the box filter is the renderer's. */
async function swatchFromPng(page, bytes) {
  const b64 = Buffer.from(bytes).toString('base64');
  return page.evaluate(async (dataUri) => {
    const img = new Image();
    await new Promise((ok, fail) => {
      img.onload = ok; img.onerror = () => fail(new Error('decode failed'));
      img.src = dataUri;
    });
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, 8, 8);
    const { data } = ctx.getImageData(0, 0, 8, 8);
    const rgb = [];
    let r = 0; let g = 0; let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      rgb.push(data[i], data[i + 1], data[i + 2]);
      r += data[i]; g += data[i + 1]; b += data[i + 2];
    }
    const n = data.length / 4;
    const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
    return { avgColor: `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase(), rgb };
  }, `data:image/png;base64,${b64}`);
}

let changed = 0;
const missing = [];

if (!fetchMode) {
  for (const [id, row] of Object.entries(ledger.materials)) {
    if (!row.avgColor) missing.push(id);
  }
  console.log(`display-swatches: ${Object.keys(ledger.materials).length} materials, ${missing.length} without a swatch`);
  if (missing.length) {
    console.log(`  missing: ${missing.join(', ')}`);
    console.log('  run with --fetch to harvest (network, run by hand, never in CI)');
  }
  process.exit(0);
}

const { chromium } = await import('playwright');
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');

for (const [id, row] of Object.entries(ledger.materials)) {
  if (AUTHORED[id]) {
    if (row.avgColor === AUTHORED[id] && row.swatchSource === 'authored') continue;
    row.avgColor = AUTHORED[id];
    row.swatchSource = 'authored';
    delete row.swatch8;
    changed += 1;
    console.log(`${id}: authored ${row.avgColor}`);
    continue;
  }
  const assetId = ambientId(row.source);
  if (!assetId) {
    console.error(`${id}: no ambientCG id in source — author it in AUTHORED or vendor by hand`);
    process.exitCode = 1;
    continue;
  }
  try {
    const url = await previewUrlFor(assetId);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const { avgColor, rgb } = await swatchFromPng(page, bytes);
    row.avgColor = avgColor;
    row.swatch8 = Buffer.from(rgb).toString('base64');
    row.swatchSource = url;
    row.swatchSha256 = createHash('sha256').update(bytes).digest('hex');
    changed += 1;
    console.log(`${id}: ${avgColor} from ${assetId}`);
  } catch (err) {
    console.error(`${id}: ${err.message}`);
    process.exitCode = 1;
  }
}

await browser.close();

if (changed) {
  writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(`display-swatches: wrote ${changed} rows to ${path.relative(process.cwd(), LEDGER)}`);
}
