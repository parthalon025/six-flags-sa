#!/usr/bin/env node
/**
 * Asset ledger — license gate, pinned provenance, credits, cache keys.
 *
 *   node test/builder/display-assets.mjs
 */
import assert from 'node:assert/strict';

const PASS = [];
const FAIL = [];

async function check(name, fn) {
  try {
    const r = await fn();
    if (r === false) throw new Error('assertion false');
    PASS.push(name);
    console.log('  PASS', name);
  } catch (e) {
    FAIL.push(`${name} :: ${e.message.split('\n')[0]}`);
    console.log('  FAIL', name, '->', e.message.split('\n')[0]);
  }
}

console.log('\nasset ledger\n');

const { readAssetLedger, verifyAssetHashes, creditsManifest, assetContentHash } = await import(
  '../../packages/venue-builder/lib/display-assets.mjs'
);

await check('every ledger row is licensed, sourced, and byte-pinned', () => {
  const problems = verifyAssetHashes();
  assert.deepEqual(problems, []);
  const ledger = readAssetLedger();
  assert.ok(Object.keys(ledger).length >= 3, 'expected the vendored Kenney packs');
  for (const [id, row] of Object.entries(ledger)) {
    assert.match(id, /^[a-z][a-z0-9-]*$/, `asset id "${id}" is not a stable slug`);
    assert.ok(row.import, `${id} lacks import settings beside the asset`);
    if (row.kind === 'tilesheet') {
      assert.ok(row.import.tileSize >= 8, `${id} tilesheet lacks tile geometry`);
      assert.ok(row.source.commit, `${id} lacks a pinned mirror commit`);
    }
    if (row.license === 'original') {
      assert.match(row.path, /^assets\/custom\//, `${id}: original art lives under assets/custom/`);
    }
  }
  return true;
});

await check('a poisoned license or drifted byte fails the gate', () => {
  const ledger = readAssetLedger();
  const [id, row] = Object.entries(ledger)[0];
  const tainted = { [id]: { ...row, license: 'AGPL-3.0' } };
  assert.ok(verifyAssetHashes(tainted).some((p) => /license/.test(p)));
  const drifted = { [id]: { ...row, sha256: '0'.repeat(64) } };
  assert.ok(verifyAssetHashes(drifted).some((p) => /drift/.test(p)));
  return true;
});

await check('credits manifest names every used asset; unknown ids throw', () => {
  const ledger = readAssetLedger();
  const ids = Object.keys(ledger).slice(0, 2);
  const credits = creditsManifest([...ids, ids[0]], ledger);
  assert.equal(credits.assets.length, 2, 'deduped and complete');
  for (const row of credits.assets) {
    assert.ok(row.license && row.source, 'license + source ride every credit row');
  }
  assert.throws(() => creditsManifest(['not-an-asset'], ledger), /Unknown asset/);
  return true;
});

await check('content hash moves with import settings, not just bytes', () => {
  const ledger = readAssetLedger();
  const row = Object.values(ledger)[0];
  const a = assetContentHash(row, 1);
  const b = assetContentHash({ ...row, import: { ...row.import, tileSize: 32 } }, 1);
  const c = assetContentHash(row, 2);
  assert.notEqual(a, b, 'import settings are part of the key');
  assert.notEqual(a, c, 'baker version is part of the key');
  assert.equal(a, assetContentHash(row, 1), 'stable for identical inputs');
  return true;
});

console.log('\nbadge icons\n');

const { resolveKit, kitAssetIds } = await import('../../packages/venue-builder/lib/display-bake.mjs');

await check('every badge kind carries an original icon glyph by default', () => {
  const ledger = readAssetLedger();
  const kit = resolveKit({}, { assets: ledger });
  for (const kind of ['gate', 'food', 'restroom', 'shop', 'show', 'service']) {
    const ref = kit.sprites.badge.icons[kind];
    assert.ok(ref?.asset, `badge ${kind} has no icon ref`);
    assert.equal(ledger[ref.asset]?.kind, 'icon', `badge ${kind} icon is not ledger kind "icon"`);
  }
  return true;
});

await check('badge icon refs are validated against the ledger', () => {
  const ledger = readAssetLedger();
  assert.throws(
    () => resolveKit({ sprites: { badge: { icons: { gate: { asset: 'parkbound-palm-tree' } } } } }, { assets: ledger }),
    /not an icon/,
  );
  assert.throws(
    () => resolveKit({ sprites: { badge: { icons: { gate: { asset: 'nope' } } } } }, { assets: ledger }),
    /unknown asset/,
  );
  return true;
});

await check('kitAssetIds names every asset a resolved kit references', () => {
  const ledger = readAssetLedger();
  const overlay = { sprites: { tree: { sprite: { asset: 'parkbound-palm-tree' } } } };
  const kit = resolveKit(
    { terrain: { grass: { tiles: { asset: 'kenney-roguelike-sheet', tile: 'grass' } } } },
    { assets: ledger, overlay },
  );
  const ids = kitAssetIds(kit);
  assert.ok(ids.includes('kenney-roguelike-sheet'), 'tile sheet is referenced');
  assert.ok(ids.includes('parkbound-palm-tree'), 'tree sprite is referenced');
  assert.ok(ids.includes('parkbound-badge-gate'), 'badge icons are referenced');
  assert.deepEqual(ids, [...new Set(ids)].sort(), 'sorted and unique');
  assert.doesNotThrow(() => creditsManifest(ids, ledger), 'every id resolves to a credit row');
  return true;
});

await check('every kit on disk resolves against the ledger, bare and themed', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const ledger = readAssetLedger();
  const kitsDir = new URL('../../packages/venue-builder/data/display/kits/', import.meta.url);
  const themeUrl = new URL(
    '../../packages/venue-builder/data/venues/big-kahunas/display/theme.json',
    import.meta.url,
  );
  const overlay = JSON.parse(readFileSync(themeUrl, 'utf8'));
  const kits = readdirSync(kitsDir).filter((f) => f.endsWith('.json'));
  assert.ok(kits.length >= 3, 'expected the committed kits');
  for (const f of kits) {
    const spec = JSON.parse(readFileSync(new URL(f, kitsDir), 'utf8'));
    assert.doesNotThrow(() => resolveKit(spec, { assets: ledger }), `${f} does not resolve`);
    assert.doesNotThrow(() => resolveKit(spec, { assets: ledger, overlay }), `${f} + venue theme does not resolve`);
  }
  return true;
});

console.log('\nsprite atlas\n');

const { atlasPlan, mapLibreSpriteJson, atlasCacheKey } = await import(
  '../../packages/venue-builder/lib/display-atlas.mjs'
);

await check('atlas plan is deterministic and order-insensitive', () => {
  const ids = ['parkbound-badge-shop', 'parkbound-badge-gate', 'parkbound-badge-food'];
  const a = atlasPlan(ids, { px: 32 });
  const b = atlasPlan([...ids].reverse(), { px: 32 });
  assert.deepEqual(a, b, 'same frames whatever the input order');
  const frames = Object.values(a.frames);
  assert.equal(frames.length, 3);
  for (const f of frames) {
    assert.ok(f.x >= 0 && f.y >= 0 && f.x + f.w <= a.width && f.y + f.h <= a.height, 'frame inside canvas');
  }
  const seen = new Set(frames.map((f) => `${f.x},${f.y}`));
  assert.equal(seen.size, frames.length, 'no two frames share an origin');
  return true;
});

await check('MapLibre sprite json rides the plan', () => {
  const plan = atlasPlan(['parkbound-badge-gate', 'parkbound-badge-food'], { px: 24 });
  const json = mapLibreSpriteJson(plan, { pixelRatio: 2 });
  assert.ok(json['badge-gate'], 'parkbound- prefix stripped for style names');
  const e = json['badge-gate'];
  assert.deepEqual(Object.keys(e).sort(), ['height', 'pixelRatio', 'width', 'x', 'y']);
  assert.equal(e.pixelRatio, 2);
  return true;
});

await check('atlas cache key moves with content, size, and version', () => {
  const ledger = readAssetLedger();
  const ids = ['parkbound-badge-gate', 'parkbound-badge-food'];
  const a = atlasCacheKey(ids, { ledger, px: 32, version: 1 });
  assert.equal(a, atlasCacheKey([...ids].reverse(), { ledger, px: 32, version: 1 }), 'order-insensitive');
  assert.notEqual(a, atlasCacheKey(ids, { ledger, px: 48, version: 1 }), 'px is part of the key');
  assert.notEqual(a, atlasCacheKey(ids, { ledger, px: 32, version: 2 }), 'version is part of the key');
  return true;
});

await check('display-stage adapters never masquerade as truth evidence', async () => {
  // The PR #480 firewall: display art rows may feed kits and packs, but
  // evidence_sources stays Truth-only — an empty list, mechanically.
  const { adaptersByStage } = await import('../../packages/venue-builder/lib/adapters/registry.mjs');
  const displayRows = adaptersByStage('display');
  assert.ok(displayRows.length >= 1, 'expected the material-library row');
  for (const row of displayRows) {
    assert.deepEqual(row.evidence_sources, [], `${row.id} leaks display art into evidence`);
  }
  return true;
});

await check('a real bake writes a credits manifest naming its assets', async () => {
  // Integration over the wire the unit tests can't see: bin/display-bake.mjs
  // → credits.json beside the PNG. Chromium-gated like CI's visual jobs —
  // recorded as a skip, never a silent pass, where no browser exists.
  const { existsSync, mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const os = await import('node:os');
  const chromium = process.env.CHROMIUM_PATH
    || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);
  if (!chromium) {
    console.log('       (skipped: no Chromium in this environment)');
    return true;
  }
  const out = mkdtempSync(`${os.tmpdir()}/bake-credits-`);
  try {
    execFileSync(
      'node',
      ['packages/venue-builder/bin/display-bake.mjs', 'big-kahunas', '--kit', 'island-brochure', '--out', out],
      { env: { ...process.env, CHROMIUM_PATH: chromium }, stdio: 'pipe', timeout: 180000 },
    );
    const credits = JSON.parse(readFileSync(`${out}/big-kahunas--island-brochure.credits.json`, 'utf8'));
    const ids = credits.assets.map((a) => a.id);
    assert.ok(ids.includes('parkbound-badge-gate'), 'badge icons ride the credits');
    assert.ok(ids.includes('parkbound-palm-tree'), 'venue-theme sprite rides the credits');
    for (const row of credits.assets) assert.ok(row.license && row.source, 'license + source on every row');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
