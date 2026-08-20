#!/usr/bin/env node
/**
 * Compile material textures — fetch each MaterialSet row's real CC0 set and
 * place phone-budget copies where the bake can read them.
 *
 * Follows bin/vendor-assets.mjs / bin/display-swatches.mjs to the letter:
 * network runs once, by hand, never in CI — CI consumes the committed bytes
 * and verifies the sha256 pins (lib/display-materials.mjs). ambientCG rows
 * fetch the 1K-JPG set named by the API's downloadData, unzip it, and
 * compile Color/NormalGL/Roughness down to MATERIAL_COMPILE_PX in the same
 * headless browser the bake already pays for. Rows with no fetchable source
 * (authored material-maker graphs) record a compiled.gap — the
 * missing-tippecanoe pattern: a named factory gap, never a failure.
 *
 *   node packages/venue-builder/bin/display-materials.mjs           # verify
 *   node packages/venue-builder/bin/display-materials.mjs --fetch   # compile
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  COMPILED_DIR, MATERIAL_COMPILE_PX, compiledPath, verifyCompiledMaterials,
} from '../lib/display-materials.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_FILE = path.join(HERE, '..', 'data', 'display', 'materials.json');
const API = 'https://ambientcg.com/api/v2/full_json';

/** Zip member suffix → compiled map name. NormalGL, not NormalDX: the GL
 *  convention matches every other Y-up consumer in this repo. */
const MAP_SUFFIXES = { Color: 'basecolor', NormalGL: 'normal', Roughness: 'roughness' };

const fetchMode = process.argv.includes('--fetch');
const ledger = JSON.parse(readFileSync(LEDGER_FILE, 'utf8'));

const ambientId = (source) => /ambientcg\.com\/view\?id=([A-Za-z0-9]+)/.exec(source || '')?.[1] || null;

async function zipUrlFor(assetId) {
  const res = await fetch(`${API}?id=${encodeURIComponent(assetId)}&include=downloadData`);
  if (!res.ok) throw new Error(`ambientCG API ${res.status} for ${assetId}`);
  const asset = (await res.json()).foundAssets?.[0];
  const downloads = asset?.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads || [];
  const row = downloads.find((d) => d.attribute === '1K-JPG');
  if (!row) throw new Error(`no 1K-JPG set for ${assetId}`);
  return row.fullDownloadPath || row.downloadLink;
}

/** Downscale bytes to ≤ MATERIAL_COMPILE_PX (square sources stay square). */
async function compileJpeg(page, bytes) {
  const b64 = Buffer.from(bytes).toString('base64');
  const dataUrl = await page.evaluate(async ({ src, maxPx }) => {
    const img = new Image();
    await new Promise((ok, fail) => {
      img.onload = ok; img.onerror = () => fail(new Error('decode failed'));
      img.src = src;
    });
    const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }, { src: `data:image/jpeg;base64,${b64}`, maxPx: MATERIAL_COMPILE_PX });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

let changed = 0;

if (fetchMode) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');

  for (const [id, row] of Object.entries(ledger.materials)) {
    if (row.compiled && !row.compiled.gap) continue; // pinned bytes stand; delete the block to refetch
    const assetId = ambientId(row.source);
    if (!assetId) {
      const gap = `no fetchable source (${row.source}) — authored graphs render flat until exported by hand`;
      if (row.compiled?.gap !== gap) { row.compiled = { gap }; changed += 1; }
      console.log(`${id}: gap recorded — ${gap}`);
      continue;
    }
    const tmp = mkdtempSync(path.join(tmpdir(), 'material-'));
    try {
      const url = await zipUrlFor(assetId);
      console.error(`${id}: fetching ${url}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const zipBytes = Buffer.from(await res.arrayBuffer());
      const zipFile = path.join(tmp, 'set.zip');
      writeFileSync(zipFile, zipBytes);
      const unzip = spawnSync('unzip', ['-o', '-q', zipFile, '-d', tmp]);
      if (unzip.status !== 0) throw new Error('unzip failed');
      const members = readdirSync(tmp);
      const compiled = { source: url, sourceSha256: createHash('sha256').update(zipBytes).digest('hex') };
      for (const [suffix, map] of Object.entries(MAP_SUFFIXES)) {
        const member = members.find((f) => f.endsWith(`_${suffix}.jpg`));
        if (!member) continue;
        const out = await compileJpeg(page, readFileSync(path.join(tmp, member)));
        const rel = path.join(COMPILED_DIR, `${id}--${map}.jpg`);
        mkdirSync(path.dirname(compiledPath(rel)), { recursive: true });
        writeFileSync(compiledPath(rel), out);
        compiled[map] = {
          path: rel.replace(/\\/g, '/'),
          sha256: createHash('sha256').update(out).digest('hex'),
          px: MATERIAL_COMPILE_PX,
        };
        console.log(`${id}: ${map} → ${rel} (${out.length} bytes)`);
      }
      if (!compiled.basecolor) throw new Error(`zip carries no ${Object.keys(MAP_SUFFIXES).join('/')} member`);
      row.compiled = compiled;
      changed += 1;
    } catch (err) {
      // Network or source failure is a recorded factory gap, never a build
      // failure — the certification row reports it per venue.
      const gap = `fetch failed: ${err.message}`;
      row.compiled = { gap };
      changed += 1;
      console.error(`${id}: gap recorded — ${gap}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  await browser.close();
  if (changed) {
    writeFileSync(LEDGER_FILE, `${JSON.stringify(ledger, null, 2)}\n`);
    console.log(`display-materials: wrote ${changed} rows to ${path.relative(process.cwd(), LEDGER_FILE)}`);
  }
}

const report = verifyCompiledMaterials(ledger.materials);
for (const [id, reason] of Object.entries(report.gaps)) console.log(`  gap ${id}: ${reason}`);
if (report.problems.length) {
  for (const p of report.problems) console.error(`! ${p}`);
  process.exitCode = 1;
} else {
  console.log(`materials green: ${report.resolved.length} compiled, ${Object.keys(report.gaps).length} recorded gap(s)`);
}
