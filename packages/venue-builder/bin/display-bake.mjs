#!/usr/bin/env node
/**
 * Skin bake, game tier — render a venue as a tile-and-sprite game map.
 *
 * The LOOK is prompt-driven; the GEOMETRY is not. `--prompt` asks the
 * configured LLM provider (inside an agent session that is the invoking
 * agent, via the briefs inbox) to author a kit spec — palette, textures,
 * sprite styling — which is saved to data/display/kits/<id>.json and
 * reused with `--kit`. The bake model itself (lib/display-bake.mjs) comes
 * only from truth: a prompt can repaint the park, never move it.
 *
 *   npm run venues:bake -- big-kahunas --kit rpg-overworld
 *   npm run venues:bake -- big-kahunas --prompt "sunny hand-drawn brochure"
 *   npm run venues:bake -- kings-island --kit rpg-overworld --max-cols 320
 */

import http from 'node:http';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { MONO_ROOT, OVERRIDE_DIR, VENUE_DIR, readJson } from '../lib/venue-io.mjs';
import { bakeModel, kitAssetIds, resolveKit } from '../lib/display-bake.mjs';
import { kitBriefSystem, parseKitAnswer } from '../lib/display-kit-brief.mjs';
import {
  readAssetLedger, assetPath, assetsForTarget, creditsManifest,
} from '../lib/display-assets.mjs';
import { dualGridIndices } from '../lib/display-autotile.mjs';
import { chatCompletion } from '../lib/venue-llm.mjs';
import { profileForKit, readReferenceProfiles } from '../lib/display-references.mjs';
import { ldtkProject } from '../lib/display-ldtk.mjs';
import {
  stylePoints, certifyStyleContract, harvestProfileDraft, signature,
} from '../lib/display-style-contract.mjs';

// This baker paints the flat/top-down tier: iso-target variants stay out of
// every kit resolve, brief, byte-serve, and credits row it produces.
const LEDGER = assetsForTarget(readAssetLedger(), 'flat');

const KITS_DIR = path.join(OVERRIDE_DIR, '..', 'display', 'kits');

const argv = process.argv.slice(2);
const ids = [];
const kitIdsArg = [];
let prompt = null;
let maxCols = 240;
let px = 16;
let harvestProfile = false;
let ldtk = false;
let outRoot = path.join(MONO_ROOT, 'artifacts', 'display-bake');
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--kit') kitIdsArg.push(argv[++i]);
  else if (a === '--prompt') prompt = argv[++i];
  else if (a === '--max-cols') maxCols = Number(argv[++i]) || 240;
  else if (a === '--px') px = Number(argv[++i]) || 16;
  else if (a === '--harvest-profile') harvestProfile = true;
  else if (a === '--ldtk') ldtk = true;
  else if (a === '--out') outRoot = path.resolve(argv[++i]);
  else if (!a.startsWith('--')) ids.push(a);
}
if (!ids.length || (!kitIdsArg.length && !prompt)) {
  console.error('usage: display-bake.mjs <venueId>… (--kit <id> [--kit <id>…] | --prompt "…") [--max-cols N] [--px N] [--out dir]');
  const kits = existsSync(KITS_DIR) ? readdirSync(KITS_DIR).map((f) => f.replace(/\.json$/, '')) : [];
  if (kits.length) console.error(`kits on disk: ${kits.join(', ')}`);
  process.exit(2);
}

function loadKit(id) {
  const file = path.join(KITS_DIR, `${id}.json`);
  const spec = readJson(file, null);
  if (!spec) throw new Error(`No kit "${id}" under data/display/kits/`);
  return resolveKit(spec, { assets: LEDGER });
}

async function kitFromPrompt(text) {
  const content = await chatCompletion(
    [
      { role: 'system', content: kitBriefSystem(LEDGER) },
      { role: 'user', content: `Map prompt: ${text}` },
    ],
    { jsonMode: true },
  );
  if (!content) {
    console.error('Kit brief filed — answer it, then rerun this command.');
    process.exit(3);
  }
  const spec = parseKitAnswer(content, { assets: LEDGER, prompt: text });
  mkdirSync(KITS_DIR, { recursive: true });
  const file = path.join(KITS_DIR, `${spec.id}.json`);
  writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`);
  console.error(`kit saved: ${file}`);
  return spec.id;
}

const PAGE = readFileSync(new URL('./display-bake-page.html', import.meta.url), 'utf8');

function serve(model, kit, points) {
  // Every asset the kit references — tile sheets (with import geometry for
  // dual-grid cutting) and standalone sprites — served from the ledger.
  const sheets = {};
  for (const piece of Object.values(kit.terrain)) {
    const ref = piece.tiles;
    if (!ref || sheets[ref.asset]) continue;
    const { tileSize, margin, spacing, tiles } = LEDGER[ref.asset].import;
    sheets[ref.asset] = { url: `/asset/${ref.asset}`, tileSize, margin, spacing, tiles };
  }
  const treeSprite = kit.sprites.tree?.sprite;
  if (treeSprite && !sheets[treeSprite.asset]) {
    sheets[treeSprite.asset] = { url: `/asset/${treeSprite.asset}`, sprite: true };
  }
  for (const ref of Object.values(kit.sprites.badge?.icons || {})) {
    if (ref?.asset && !sheets[ref.asset]) sheets[ref.asset] = { url: `/asset/${ref.asset}`, sprite: true };
  }
  return http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/') { res.setHeader('content-type', 'text/html'); return res.end(PAGE); }
    if (url === '/model.json') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ model, kit, px, sheets, points })); }
    if (url.startsWith('/asset/')) {
      const row = LEDGER[url.slice('/asset/'.length)];
      if (row) {
        res.setHeader('content-type', row.path.endsWith('.svg') ? 'image/svg+xml' : 'image/png');
        return res.end(readFileSync(assetPath(row)));
      }
    }
    res.statusCode = 404;
    return res.end('not found');
  });
}

const kitIds = prompt ? [await kitFromPrompt(prompt)] : kitIdsArg;
const kitSpecs = {};
for (const k of kitIds) {
  kitSpecs[k] = readJson(path.join(KITS_DIR, `${k}.json`), null);
  if (!kitSpecs[k]) loadKit(k); // throws with the helpful message
}
const profiles = readReferenceProfiles();

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', (err) => console.error('  page error:', err.message));

mkdirSync(outRoot, { recursive: true });
for (const id of ids) {
  const map = readJson(path.join(VENUE_DIR, `${id}.map.json`), null);
  const pois = readJson(path.join(VENUE_DIR, `${id}.pois.json`), []);
  if (!map) { console.error(`${id}: no map.json`); continue; }
  // Venue design theme: a partial spec overlaid on the kit for this World
  // only (custom quest-prize sprites, accent palettes) — never geometry.
  const overlay = readJson(path.join(OVERRIDE_DIR, id, 'display', 'theme.json'), null);
  if (overlay) console.error(`  venue theme: data/venues/${id}/display/theme.json`);

  if (ldtk) {
    // Kit-independent (the model is), so one file per venue suffices.
    const ldtkFile = path.join(outRoot, `${id}.ldtk`);
    writeFileSync(ldtkFile, `${JSON.stringify(ldtkProject(bakeModel(map, pois, { maxCols })), null, 2)}\n`);
    console.error(`  LDtk debug export: ${ldtkFile}`);
  }

  // Bake every requested kit first; certification runs after so the
  // cross-kit check compares this invocation's own bakes, never stale
  // files from an older code version.
  const results = [];
  for (const kitId of kitIds) {
    const kit = resolveKit(kitSpecs[kitId], { assets: LEDGER, overlay });
    const model = bakeModel(map, pois, { maxCols });
    // Dual-grid corner masks for every kit-tiled terrain (ground uses full
    // tiles on its own cells) — computed once here so the lib stays the
    // only implementation.
    const terrainId = Object.fromEntries(Object.entries(model.terrains).map(([v, n]) => [n, Number(v)]));
    model.autotile = {};
    for (const [name, piece] of Object.entries(kit.terrain)) {
      if (piece.tiles && name !== 'ground') {
        model.autotile[name] = Array.from(dualGridIndices(model.cells, model.cols, model.rows, terrainId[name]));
      }
    }
    const points = stylePoints(model);
    const server = serve(model, kit, points);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction('window.__done === true', null, { timeout: 120000 });
    const file = path.join(outRoot, `${id}--${kitId}.png`);
    await page.locator('#c').screenshot({ path: file });
    // Credits ride every bake: each ledger asset the kit touched, with its
    // license and source — the audit trail the asset ledger promises.
    const credits = creditsManifest(kitAssetIds(kit), LEDGER);
    writeFileSync(path.join(outRoot, `${id}--${kitId}.credits.json`), `${JSON.stringify(credits, null, 2)}\n`);
    const samples = await page.evaluate('window.__samples');
    writeFileSync(
      path.join(outRoot, `${id}--${kitId}.samples.json`),
      `${JSON.stringify({ signature: signature(samples), points, samples })}\n`,
    );
    if (harvestProfile) {
      const draftFile = path.join(outRoot, `${id}--${kitId}.profile-draft.json`);
      writeFileSync(draftFile, `${JSON.stringify(harvestProfileDraft({ points, samples }), null, 2)}\n`);
      console.error(`  profile draft (measured medians): ${draftFile}`);
    }
    const profile = profileForKit(kitId, profiles);
    let rerun = null;
    if (profile) {
      // True determinism proof: render the same model again in a fresh
      // page load and demand identical pixels. Only certified kits pay
      // for the second render — an ad-hoc prompt kit has no profile yet.
      await page.reload();
      await page.waitForFunction('window.__done === true', null, { timeout: 120000 });
      rerun = await page.evaluate('window.__samples');
    }
    server.close();
    results.push({ kitId, kit, model, points, samples, rerun, profile, file });
  }

  for (const r of results) {
    if (!r.profile) {
      console.log(`${id} × ${r.kitId}: ${r.model.cols}×${r.model.rows} tiles → ${r.file} (+credits; no reference profile — style uncertified)`);
      continue;
    }
    const siblings = results
      .filter((o) => o !== r)
      .map((o) => ({ kit: o.kitId, signature: signature(o.samples) }));
    const cert = certifyStyleContract({
      model: r.model,
      points: r.points,
      samples: r.samples,
      rerunSamples: r.rerun,
      siblings,
      profile: r.profile,
      kit: r.kit,
    });
    // Geo bounds ride the cert so the display stage can place the baked
    // image (and attempt the raster tier) without re-baking the model.
    cert.bounds = r.model.bounds ?? null;
    writeFileSync(path.join(outRoot, `${id}--${r.kitId}.style-cert.json`), `${JSON.stringify(cert, null, 2)}\n`);
    const failing = cert.checks.filter((c) => !c.pass);
    const certLine = cert.certified
      ? `style contract ok (${cert.checks.length} checks, ${cert.review.length} review items)`
      : `STYLE CONTRACT FAILING: ${failing.map((c) => c.key).join(', ')}`;
    if (!cert.certified) process.exitCode = 1;
    console.log(`${id} × ${r.kitId}: ${r.model.cols}×${r.model.rows} tiles → ${r.file} (+credits; ${certLine})`);
  }
}
await browser.close();
