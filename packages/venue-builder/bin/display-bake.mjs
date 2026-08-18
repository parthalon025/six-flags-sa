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
import { MONO_ROOT, OVERRIDE_DIR, VENUE_DIR, readJson, slugify } from '../lib/venue-io.mjs';
import {
  bakeModel, kitAssetIds, resolveKit,
  TERRAIN_PIECES, SPRITE_PIECES, TEXTURE_KINDS,
  BUILDING_STYLES, TREE_STYLES, TRACK_STYLES,
} from '../lib/display-bake.mjs';
import { readAssetLedger, assetPath, creditsManifest } from '../lib/display-assets.mjs';
import { dualGridIndices } from '../lib/display-autotile.mjs';
import { chatCompletion } from '../lib/venue-llm.mjs';
import { profileForKit, readReferenceProfiles } from '../lib/display-references.mjs';
import {
  stylePoints, certifyStyleContract, harvestProfileDraft, signature,
} from '../lib/display-style-contract.mjs';

const LEDGER = readAssetLedger();

const KITS_DIR = path.join(OVERRIDE_DIR, '..', 'display', 'kits');

// The asset menu the brief may reference — GUIDs from the license-gated
// ledger only; resolveKit rejects anything else before a kit is saved.
const assetMenu = () => {
  const rows = Object.values(LEDGER);
  const sheets = rows.filter((r) => r.kind === 'tilesheet')
    .map((r) => `${r.id} tiles: ${Object.keys(r.import.tiles).join(', ')}`);
  const sprites = rows.filter((r) => r.kind === 'sprite').map((r) => r.id);
  const icons = rows.filter((r) => r.kind === 'icon').map((r) => r.id);
  return { sheets, sprites, icons };
};

const KIT_BRIEF_SYSTEM = `You author map "kit specs" for a deterministic game-map baker.
The bake is composed of small pieces; you choose params per piece — presentation
only, never geometry. Reply with ONLY a JSON object:
{
  "id": "<kebab-case kit name>",
  "label": "<short human name>",
  "terrain": { any subset of ${Object.keys(TERRAIN_PIECES).join('|')}:
    { "base": "<css color>",
      "texture": { "kind": "${TEXTURE_KINDS.join('|')}", "color": "<css>", "density": 0..1 },
      "tiles": { "asset": "<tilesheet id>", "tile": "<tile name>", "tint": "<css, optional>" } } },
  "sprites": { any subset of:
    "tree": {"style":"${TREE_STYLES.join('|')}","canopy","highlight","shadow","scale","sprite":{"asset":"<sprite id>"}},
    "building": {"style":"${BUILDING_STYLES.join('|')}","roofs":[colors],"edge","wall","drop"},
    "slide": {"style":"${TRACK_STYLES.join('|')}","casing","colors":[colors],"width"},
    "coaster": {"style":"${TRACK_STYLES.join('|')}","rail","tie"},
    "badge": {"gate","food","restroom","shop","show","service","icons":{"<badge kind>":{"asset":"<icon id>"}}} } }
"tiles" paints that terrain with real dual-grid tile art; "style" switches how a
sprite is DRAWN (outline vs drop-shadowed buildings, tube vs mono tracks), not
just its colors. Asset ids must come from this ledger menu:
${JSON.stringify(assetMenu())}
Defaults fill anything you omit: ${JSON.stringify({ terrain: TERRAIN_PIECES, sprites: SPRITE_PIECES })}
Keep water readable as water and paths as paths, with outdoor-phone contrast.`;

const argv = process.argv.slice(2);
const ids = [];
let kitId = null;
let prompt = null;
let maxCols = 240;
let px = 16;
let harvestProfile = false;
let outRoot = path.join(MONO_ROOT, 'artifacts', 'display-bake');
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--kit') kitId = argv[++i];
  else if (a === '--prompt') prompt = argv[++i];
  else if (a === '--max-cols') maxCols = Number(argv[++i]) || 240;
  else if (a === '--px') px = Number(argv[++i]) || 16;
  else if (a === '--harvest-profile') harvestProfile = true;
  else if (a === '--out') outRoot = path.resolve(argv[++i]);
  else if (!a.startsWith('--')) ids.push(a);
}
if (!ids.length || (!kitId && !prompt)) {
  console.error('usage: display-bake.mjs <venueId>… (--kit <id> | --prompt "…") [--max-cols N] [--px N] [--out dir]');
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
      { role: 'system', content: KIT_BRIEF_SYSTEM },
      { role: 'user', content: `Map prompt: ${text}` },
    ],
    { jsonMode: true },
  );
  if (!content) {
    console.error('Kit brief filed — answer it, then rerun this command.');
    process.exit(3);
  }
  const spec = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
  if (!spec.id) throw new Error('Kit spec needs an id');
  resolveKit(spec, { assets: LEDGER }); // reject unknown pieces/kinds/tile refs before saving
  spec.id = slugify(spec.id);
  spec.prompt = text;
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

const resolvedKitId = prompt ? await kitFromPrompt(prompt) : kitId;
const kitSpec = readJson(path.join(KITS_DIR, `${resolvedKitId}.json`), null);
if (!kitSpec) loadKit(resolvedKitId); // throws with the helpful message

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
  const kit = resolveKit(kitSpec, { assets: LEDGER, overlay });
  if (overlay) console.error(`  venue theme: data/venues/${id}/display/theme.json`);
  const model = bakeModel(map, pois, { maxCols });
  // Dual-grid corner masks for every kit-tiled terrain (ground uses full
  // tiles on its own cells) — computed once here so the lib stays the only
  // implementation.
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
  const file = path.join(outRoot, `${id}--${resolvedKitId}.png`);
  await page.locator('#c').screenshot({ path: file });
  // Credits ride every bake: each ledger asset the kit touched, with its
  // license and source — the audit trail the asset ledger promises.
  const credits = creditsManifest(kitAssetIds(kit), LEDGER);
  writeFileSync(path.join(outRoot, `${id}--${resolvedKitId}.credits.json`), `${JSON.stringify(credits, null, 2)}\n`);

  // Style contract: sample the painted canvas at the truth-derived points
  // and hold the pixels to the kit's reference profile.
  const samples = await page.evaluate('window.__samples');
  const samplesFile = path.join(outRoot, `${id}--${resolvedKitId}.samples.json`);
  writeFileSync(samplesFile, `${JSON.stringify({ signature: signature(samples), points, samples })}\n`);
  // True determinism proof: render the same model again in a fresh page
  // load and demand identical pixels — no comparison against stale runs
  // of older code, no clock to blame.
  await page.reload();
  await page.waitForFunction('window.__done === true', null, { timeout: 120000 });
  const rerun = await page.evaluate('window.__samples');
  if (harvestProfile) {
    const draftFile = path.join(outRoot, `${id}--${resolvedKitId}.profile-draft.json`);
    writeFileSync(draftFile, `${JSON.stringify(harvestProfileDraft({ points, samples }), null, 2)}\n`);
    console.error(`  profile draft (measured medians): ${draftFile}`);
  }
  const profile = profileForKit(resolvedKitId, readReferenceProfiles());
  let certLine = 'no reference profile — style uncertified';
  if (profile) {
    const cert = certifyStyleContract({ model, points, samples, profile, kit });
    cert.checks.push({
      key: 'style_bake_deterministic',
      claim: 'a fresh render of the same model samples byte-identical pixels',
      pass: signature(rerun) === cert.signature,
      evidence: `render ${cert.signature} vs rerender ${signature(rerun)}`,
      confidence: 1,
      falsifier: 'any clock or RNG sneaking into the compositor',
      soWhat: 'determinism is the bake’s core guarantee',
    });
    cert.certified = cert.checks.every((c) => c.pass);
    // Cross-kit distinctness: sibling kits of the same venue must not
    // collapse into one look (design languages, not palette swaps).
    const twins = readdirSync(outRoot)
      .filter((f) => f.startsWith(`${id}--`) && f.endsWith('.samples.json') && f !== path.basename(samplesFile))
      .map((f) => ({ f, sig: readJson(path.join(outRoot, f), {}).signature }))
      .filter((t) => t.sig);
    if (twins.length) {
      const clashes = twins.filter((t) => t.sig === cert.signature);
      cert.checks.push({
        key: 'style_cross_kit_distinct',
        claim: 'sibling kits of this venue sample distinct pixels',
        pass: clashes.length === 0,
        evidence: clashes.length ? `identical to ${clashes.map((t) => t.f).join(', ')}` : `distinct from ${twins.length} sibling bake(s)`,
        confidence: 0.9,
        falsifier: 'two kits that only differ in name',
        soWhat: 'the factory exists to make different-looking maps',
      });
      cert.certified = cert.checks.every((c) => c.pass);
    }
    writeFileSync(path.join(outRoot, `${id}--${resolvedKitId}.style-cert.json`), `${JSON.stringify(cert, null, 2)}\n`);
    const failing = cert.checks.filter((c) => !c.pass);
    certLine = cert.certified
      ? `style contract ok (${cert.checks.length} checks, ${cert.review.length} review items)`
      : `STYLE CONTRACT FAILING: ${failing.map((c) => c.key).join(', ')}`;
    if (!cert.certified) process.exitCode = 1;
  }
  console.log(`${id} × ${resolvedKitId}: ${model.cols}×${model.rows} tiles → ${file} (+credits; ${certLine})`);
  server.close();
}
await browser.close();
