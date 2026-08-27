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
 *
 * `--band overview|mid|close` bakes one band of the World's zoom pyramid
 * (ADR-0021 clause 2). A band is a ground sample distance — 2.4, 0.6 or
 * 0.15 m per pixel — resolved against this venue's own span into a cell size
 * and a pixels-per-cell, so `close` means the same number of ground metres at
 * every park. It replaces `--max-cols`/`--px` rather than combining with them:
 * passing both is refused, because a band's cell size is often unreachable
 * from any integer column budget (lib/display-bands.mjs explains why).
 *
 *   npm run venues:bake -- kings-island --kit rpg-overworld --band overview
 *
 * `--target iso` renders the RCT-style isometric bake of the SAME model —
 * depth-sorted extrusions and lifted tracks (lib/display-iso.mjs), the
 * flat tier's kit palette, certified through the same style contract.
 * `--rotation 0..3` picks the quarter-turn view (iso only).
 *
 *   npm run venues:bake -- big-kahunas --kit rpg-overworld --target iso --rotation 2
 */

import http from 'node:http';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { parentOf } from '@party-tracker/shared/zoomBands.js';
import { chromium } from 'playwright';
import { MONO_ROOT, OVERRIDE_DIR, VENUE_DIR, readJson } from '../lib/venue-io.mjs';
import {
  DEFAULT_MAX_COLS, DEFAULT_PX, assertBakeGridFlags, bakeModel, boundaryDistanceField,
  kitAssetIds, resolveBakeGrid, resolveKit,
} from '../lib/display-bake.mjs';
import { kitBriefSystem, parseKitAnswer } from '../lib/display-kit-brief.mjs';
import {
  readAssetLedger, assetPath, assetsForTarget, creditsManifest,
} from '../lib/display-assets.mjs';
import { isoTemplateForKit, readMaterials, readSkinTemplates } from '../lib/display-pack.mjs';
import { ISO_MAP_TEMPLATES } from '@party-tracker/shared/isoWorld.js';
import { compiledPath, materialsCreditsManifest, verifyCompiledMaterials } from '../lib/display-materials.mjs';
import { dualGridIndices } from '../lib/display-autotile.mjs';
import { chatCompletion } from '../lib/venue-llm.mjs';
import { profileForKit, readReferenceProfiles } from '../lib/display-references.mjs';
import { ldtkProject } from '../lib/display-ldtk.mjs';
import {
  stylePoints, isoStylePoints, certifyStyleContract, harvestProfileDraft, signature,
} from '../lib/display-style-contract.mjs';
import { isoBakeGeometry } from '../lib/display-iso.mjs';

// Kits resolve against the flat/top-down ledger: iso-target variants stay
// out of every kit resolve, brief, and flat credits row. The iso render
// path serves iso-target art (a tree sprite's `-iso` sibling) from the
// iso slice and credits exactly the assets it painted.
const FULL_LEDGER = readAssetLedger();
const LEDGER = assetsForTarget(FULL_LEDGER, 'flat');
const ISO_LEDGER = assetsForTarget(FULL_LEDGER, 'iso');
// Kit material refs resolve against the MaterialSet ledger; only rows whose
// compiled textures verify on disk actually paint (a gap paints authored
// flat and the pack's material_textures_resolve row reports it).
const MATERIALS = readMaterials();
// SkinTemplate ledger — the bake reads it for one thing: which iso recipe the
// Skin bound to each kit declared (skins.json `isoTemplate`).
const SKIN_TEMPLATES = readSkinTemplates();
const MATERIAL_REPORT = verifyCompiledMaterials(MATERIALS);

const KITS_DIR = path.join(OVERRIDE_DIR, '..', 'display', 'kits');

const argv = process.argv.slice(2);
const ids = [];
const kitIdsArg = [];
let prompt = null;
// null means "not given on the command line" — `resolveBakeGrid` needs to tell
// an unset flag from one set to its default, so it can refuse a grid stated
// two ways at once rather than silently picking a winner.
let band = null;
let maxColsFlag = null;
let pxFlag = null;
let harvestProfile = false;
let ldtk = false;
let target = 'flat';
let rotation = 0;
let rotationSet = false;
let outRoot = path.join(MONO_ROOT, 'artifacts', 'display-bake');
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--kit') kitIdsArg.push(argv[++i]);
  else if (a === '--prompt') prompt = argv[++i];
  else if (a === '--band') band = argv[++i];
  else if (a === '--max-cols') maxColsFlag = Number(argv[++i]) || DEFAULT_MAX_COLS;
  else if (a === '--px') pxFlag = Number(argv[++i]) || DEFAULT_PX;
  else if (a === '--harvest-profile') harvestProfile = true;
  else if (a === '--ldtk') ldtk = true;
  else if (a === '--target') target = argv[++i];
  else if (a === '--rotation') { rotation = Number(argv[++i]); rotationSet = true; }
  else if (a === '--out') outRoot = path.resolve(argv[++i]);
  else if (!a.startsWith('--')) ids.push(a);
}
if (!ids.length || (!kitIdsArg.length && !prompt)) {
  console.error('usage: display-bake.mjs <venueId>… (--kit <id> [--kit <id>…] | --prompt "…") [--target flat|iso] [--rotation 0..3] [--band overview|mid|close | --max-cols N --px N] [--out dir]');
  const kits = existsSync(KITS_DIR) ? readdirSync(KITS_DIR).map((f) => f.replace(/\.json$/, '')) : [];
  if (kits.length) console.error(`kits on disk: ${kits.join(', ')}`);
  process.exit(2);
}
if (!['flat', 'iso'].includes(target)) {
  console.error(`unknown --target "${target}" (flat | iso)`);
  process.exit(2);
}
if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3) {
  console.error('--rotation must be an integer 0..3');
  process.exit(2);
}
if (rotationSet && target !== 'iso') console.error('--rotation only applies to --target iso — ignored');
// Before a map is read or a browser is launched: a grid stated two ways is a
// question, not a default. `--band` is per venue, so the plan itself resolves
// inside the loop — only the flags can be judged here.
try {
  assertBakeGridFlags({ band, maxCols: maxColsFlag, px: pxFlag });
} catch (err) {
  console.error(err.message);
  process.exit(2);
}

function loadKit(id) {
  const file = path.join(KITS_DIR, `${id}.json`);
  const spec = readJson(file, null);
  if (!spec) throw new Error(`No kit "${id}" under data/display/kits/`);
  return resolveKit(spec, { assets: LEDGER, materials: MATERIALS });
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
const ISO_PAGE = readFileSync(new URL('./display-iso-page.html', import.meta.url), 'utf8');

// Every asset the flat painter needs — tile sheets (with import geometry
// for dual-grid cutting) and standalone sprites — from the flat ledger.
function flatSheets(kit) {
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
  return sheets;
}

/** Material refs a kit binds — terrain pieces plus building roofs. */
function kitMaterialRefs(kit) {
  const refs = [
    ...Object.values(kit.terrain).map((p) => p.material),
    kit.sprites.building?.material,
  ].filter(Boolean);
  return [...new Map(refs.map((r) => [r.id, r])).values()];
}

// Compiled albedos ride the sheet list (flagged `material`) so the painter
// loads them like any art; unresolved ones paint authored flat, on the record.
function materialSheets(kit) {
  const sheets = {};
  for (const ref of kitMaterialRefs(kit)) {
    if (MATERIAL_REPORT.resolved.includes(ref.id)) {
      sheets[ref.id] = { url: `/material/${ref.id}`, material: true };
    } else {
      console.error(`  material gap: ${ref.id} — ${MATERIAL_REPORT.gaps[ref.id] || 'compiled bytes unverified'}; painting authored flat`);
    }
  }
  return sheets;
}

// The iso painter uses no terrain tiles (diamonds are flat fills): only
// badge icon glyphs plus the tree sprite's iso sibling when one exists.
function isoSheets(kit, treeAsset) {
  const sheets = {};
  for (const ref of Object.values(kit.sprites.badge?.icons || {})) {
    if (ref?.asset && !sheets[ref.asset]) sheets[ref.asset] = { url: `/asset/${ref.asset}`, sprite: true };
  }
  if (treeAsset) sheets[treeAsset] = { url: `/asset/${treeAsset}`, sprite: true };
  return sheets;
}

function serve(payload, { page = PAGE, ledger = LEDGER } = {}) {
  return http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/') { res.setHeader('content-type', 'text/html'); return res.end(page); }
    if (url === '/model.json') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(payload)); }
    if (url.startsWith('/asset/')) {
      const row = ledger[url.slice('/asset/'.length)];
      if (row) {
        res.setHeader('content-type', row.path.endsWith('.svg') ? 'image/svg+xml' : 'image/png');
        return res.end(readFileSync(assetPath(row)));
      }
    }
    if (url.startsWith('/material/')) {
      const row = MATERIALS[url.slice('/material/'.length)];
      if (row?.compiled?.basecolor) {
        res.setHeader('content-type', 'image/jpeg');
        return res.end(readFileSync(compiledPath(row.compiled.basecolor.path)));
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

  // How big a cell is, for THIS venue. A band is a ground resolution
  // (ADR-0021 clause 2), so the cell count it implies depends on the park's
  // own span and has to be planned per venue, not once per invocation.
  let grid;
  try {
    grid = resolveBakeGrid(map.meta, { band, maxCols: maxColsFlag, px: pxFlag });
  } catch (err) {
    // A venue whose bounds cannot carry this band is a real failure, but not
    // one worth stranding the open browser over: say so, fail the run, move on.
    console.error(`${id}: ${err.message}`);
    process.exitCode = 1;
    continue;
  }
  const { px } = grid;
  // Exactly one of the two is set; both spread into bakeModel unchanged. The
  // band rides along so `bakeModel` generalizes the content to it — a band is
  // what a picture leaves out as much as what resolution it draws at.
  const gridOpts = {
    ...(grid.tileMetres != null ? { tileMetres: grid.tileMetres } : { maxCols: grid.maxCols }),
    ...(band ? { band } : {}),
  };
  if (band) console.error(`  band ${band}: ${grid.tileMetres.toFixed(4)} m a cell, ${px} px a cell`);

  // The band above this one, as a MODEL only — `bakeModel` is pure and never
  // paints, so this costs no browser and no PNG. It is the witness ADR-0021
  // clause 3 needs: nothing inside a single bake can tell a mark that sits
  // where Truth put it from a mark that was nudged, because the model is the
  // bake's own account of where things are. Kit-independent, like the model
  // itself, so it is built once per venue rather than once per kit. Null at the
  // coarsest band, which the cert records rather than dropping the row.
  const coarserBand = band ? parentOf(band) : null;
  const coarserModel = coarserBand ? bakeModel(map, pois, { ...gridOpts, band: coarserBand }) : null;
  if (band) console.error(`  ${coarserBand ? `nests in the ${coarserBand} band above it` : 'the coarsest band — nothing above it to nest in'}`);

  if (ldtk) {
    // Kit-independent (the model is), so one file per venue suffices.
    const ldtkFile = path.join(outRoot, `${id}.ldtk`);
    writeFileSync(ldtkFile, `${JSON.stringify(ldtkProject(bakeModel(map, pois, gridOpts)), null, 2)}\n`);
    console.error(`  LDtk debug export: ${ldtkFile}`);
  }

  // Bake every requested kit first; certification runs after so the
  // cross-kit check compares this invocation's own bakes, never stale
  // files from an older code version.
  const results = [];
  for (const kitId of kitIds) {
    const kit = resolveKit(kitSpecs[kitId], { assets: LEDGER, overlay, materials: MATERIALS });
    const model = bakeModel(map, pois, gridOpts);
    let base;
    let server;
    let points;
    let skips = null;
    let credits;
    if (target === 'iso') {
      // The iso variant convention: a flat sprite's `-iso` sibling in the
      // iso ledger slice serves the iso tier under the same label.
      const flatTree = kit.sprites.tree?.sprite?.asset;
      const treeAsset = flatTree && ISO_LEDGER[`${flatTree}-iso`] ? `${flatTree}-iso` : null;
      // The recipe this kit's Skin actually asked for (skins.json
      // `isoTemplate`), not display-iso's default. An unbound kit keeps the
      // default; a bound one that declares nothing a recipe answers to throws.
      const isoTemplate = isoTemplateForKit(SKIN_TEMPLATES, kitId, ISO_MAP_TEMPLATES);
      if (isoTemplate) console.error(`  iso recipe: ${isoTemplate} (declared by the Skin bound to ${kitId})`);
      const isoOpts = { rotation, px, ...(isoTemplate ? { template: isoTemplate } : {}) };
      const geometry = isoBakeGeometry(model, kit, { ...isoOpts, treeAsset });
      const plan = isoStylePoints(model, stylePoints(model), isoOpts);
      points = plan.points;
      skips = plan.skips;
      const sheets = isoSheets(kit, treeAsset);
      base = `${id}--${kitId}--iso-r${rotation}`;
      // Credits list exactly what the iso painter fetched: badge glyphs
      // plus the iso tree sprite — iso assets never leak into flat credits.
      credits = creditsManifest(Object.keys(sheets), FULL_LEDGER);
      server = serve({ model, kit, px, sheets, geometry, points }, { page: ISO_PAGE, ledger: FULL_LEDGER });
    } else {
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
      // Pigment-pooling rims read a lib-computed distance field, like
      // autotile masks — the painter page stays a consumer.
      const rim = {};
      for (const [name, piece] of Object.entries(kit.terrain)) {
        if (piece.rim) {
          rim[name] = boundaryDistanceField(model.cells, model.cols, model.rows, terrainId[name], piece.rim.reach);
        }
      }
      if (Object.keys(rim).length) model.rim = rim;
      points = stylePoints(model);
      base = `${id}--${kitId}`;
      // Credits ride every bake: each ledger asset the kit touched, with its
      // license and source — the audit trail the asset ledger promises.
      // Material refs credit their own ledger (data/display/materials.json).
      credits = creditsManifest(kitAssetIds(kit), LEDGER);
      const materialCredits = materialsCreditsManifest(
        kitMaterialRefs(kit).map(({ id: mid }) => mid),
        MATERIALS,
      );
      if (materialCredits.length) credits.materials = materialCredits;
      server = serve({ model, kit, px, sheets: { ...flatSheets(kit), ...materialSheets(kit) }, points });
    }
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction('window.__done === true', null, { timeout: 120000 });
    const file = path.join(outRoot, `${base}.png`);
    await page.locator('#c').screenshot({ path: file });
    writeFileSync(path.join(outRoot, `${base}.credits.json`), `${JSON.stringify(credits, null, 2)}\n`);
    const samples = await page.evaluate('window.__samples');
    writeFileSync(
      path.join(outRoot, `${base}.samples.json`),
      `${JSON.stringify({ signature: signature(samples), points, samples })}\n`,
    );
    if (harvestProfile) {
      const draftFile = path.join(outRoot, `${base}.profile-draft.json`);
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
    results.push({ kitId, kit, model, points, skips, samples, rerun, profile, file, base });
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
      target,
      skips: r.skips,
      map,
      pois,
      px,
      // Which band this bake is, so style_world_geo asserts the alignment
      // budget ADR-0021 clause 3 sets for it rather than a pixel count.
      band,
      coarserModel,
    });
    // Geo bounds ride the cert so the display stage can place the baked
    // image as the world tier without re-baking the model.
    cert.bounds = r.model.bounds ?? null;
    writeFileSync(path.join(outRoot, `${r.base}.style-cert.json`), `${JSON.stringify(cert, null, 2)}\n`);
    const failing = cert.checks.filter((c) => !c.pass);
    // Skip-disclosure rows are decisions on the record, not passed checks:
    // the summary tallies them apart so "N checks" means gated rows.
    const skipRows = cert.checks.filter((c) => c.key.startsWith('style_skip_')).length;
    const certLine = cert.certified
      ? `style contract ok (${cert.checks.length - skipRows} checks, ${skipRows ? `${skipRows} skips listed, ` : ''}${cert.review.length} review items)`
      : `STYLE CONTRACT FAILING: ${failing.map((c) => c.key).join(', ')}`;
    if (!cert.certified) process.exitCode = 1;
    console.log(`${id} × ${r.kitId}: ${r.model.cols}×${r.model.rows} tiles → ${r.file} (+credits; ${certLine})`);
  }
}
await browser.close();
