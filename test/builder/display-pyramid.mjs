#!/usr/bin/env node
/**
 * Display pyramid — `buildPyramid` cuts a baked band raster into a PMTiles v3
 * raster archive, hand-rolled because the installed `pmtiles` package is a
 * decoder only (it exports PMTiles/bytesToHeader/findTile and no serializer)
 * and neither go-pmtiles nor tippecanoe is installed.
 *
 * The defect class this suite exists for is the one that survives every cheap
 * check: an archive of the right tile count, the right byte size and a stable
 * hash whose tiles are in the wrong cells — a map that renders scrambled. So
 * the fixture is four flat quadrants of known RGB, and every tile of the
 * native level is read back through the SHIPPED reader and matched against the
 * literal colour that belongs in that cell.
 *
 *   node test/builder/display-pyramid.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, openSync, readSync, fstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { PMTiles } from 'pmtiles';

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

console.log('\ndisplay-pyramid\n');

const { buildPyramid, TILE_PIXELS, pyramidLevels, packDirectories } = await import('../../packages/venue-builder/lib/display-pyramid.mjs');

/* ------------------------------------------------------------------ *
 * Known-answer fixture. These four RGB triples are literals chosen here,
 * never read back out of the module under test — the whole point is that a
 * tile can be checked against a colour the test decided on before the module
 * ran. Quadrant layout in image space, y increasing downward:
 *
 *     x 0..511   x 512..1023
 *   +-----------+-----------+  y 0..511
 *   |    TL     |    TR     |
 *   +-----------+-----------+  y 512..1023
 *   |    BL     |    BR     |
 *   +-----------+-----------+
 *
 * PMTiles addresses tiles ZXY with y increasing downward too, so at the native
 * level (z=1, two tiles across) BL is tile (1, 0, 1). Flip either axis and
 * that assertion is the one that catches it.
 * ------------------------------------------------------------------ */
const TL = [200, 30, 40];
const TR = [30, 200, 40];
const BL = [30, 40, 200];
const BR = [220, 200, 20];

const QUADRANT_AT = {
  '1/0/0': { name: 'TL', rgb: TL },
  '1/1/0': { name: 'TR', rgb: TR },
  '1/0/1': { name: 'BL', rgb: BL },
  '1/1/1': { name: 'BR', rgb: BR },
};

const BOUNDS = { west: -84.7, south: 39.32, east: -84.68, north: 39.34 };

/** A width x height RGB PNG whose pixel colour is chosen by `pick(x, y)`. */
async function paintPng(file, width, height, pick) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgb = pick(x, y);
      const o = (y * width + x) * 3;
      raw[o] = rgb[0];
      raw[o + 1] = rgb[1];
      raw[o + 2] = rgb[2];
    }
  }
  await sharp(raw, { raw: { width, height, channels: 3 } }).png().toFile(file);
  return file;
}

const quadrantPick = (x, y) => (y < 512 ? (x < 512 ? TL : TR) : (x < 512 ? BL : BR));

function tmp(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** The shipped reader wants a Source; node needs one that reads a local file. */
class LocalFileSource {
  constructor(file) {
    this.file = file;
    this.fd = openSync(file, 'r');
    this.size = fstatSync(this.fd).size;
  }

  getKey() {
    return this.file;
  }

  async getBytes(offset, length) {
    const len = Math.max(0, Math.min(length, this.size - offset));
    const buf = Buffer.alloc(len);
    if (len) readSync(this.fd, buf, 0, len, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  }
}

const openArchive = (file) => new PMTiles(new LocalFileSource(file));

/** Decode a tile the reader handed back into raw RGBA plus its dimensions. */
async function decodeTile(range) {
  assert.ok(range, 'reader returned no tile');
  const png = Buffer.from(range.data);
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', 'tile bytes should be a PNG');
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** null when every pixel is `rgb`, else a description of the first that is not. */
function firstPixelUnlike(tile, rgb) {
  for (let y = 0; y < tile.height; y++) {
    for (let x = 0; x < tile.width; x++) {
      const o = (y * tile.width + x) * tile.channels;
      if (tile.data[o] !== rgb[0] || tile.data[o + 1] !== rgb[1] || tile.data[o + 2] !== rgb[2]) {
        return `(${x},${y}) is rgb(${tile.data[o]},${tile.data[o + 1]},${tile.data[o + 2]})`;
      }
    }
  }
  return null;
}

const alphaAt = (tile, x, y) => tile.data[(y * tile.width + x) * tile.channels + 3];

/* ---------------------------------------------------------------- */

await check('TILE_PIXELS is 512 and pyramidLevels halves to a single tile', () => {
  assert.equal(TILE_PIXELS, 512);
  const levels = pyramidLevels(1024, 1024);
  assert.equal(levels.length, 2, '1024px at 512px tiles is two levels');
  assert.deepEqual(
    levels.map((l) => [l.z, l.width, l.height, l.cols, l.rows]),
    [[0, 512, 512, 1, 1], [1, 1024, 1024, 2, 2]],
  );
  return true;
});

await check('a 1024x1024 band bakes 2 levels and exactly 5 tiles', async () => {
  const dir = tmp('pyramid-shape-');
  const bakePng = await paintPng(path.join(dir, 'close.png'), 1024, 1024, quadrantPick);
  const outDir = path.join(dir, 'out');
  const res = await buildPyramid({ id: 'kings-island', bandId: 'close', bakePng, bounds: BOUNDS, outDir });

  assert.equal(res.ok, true, `expected ok, got ${res.reason || ''}`);
  assert.equal(res.tiles, 5, 'one tile at z0 plus four at z1');
  assert.equal(res.minzoom, 0);
  assert.equal(res.maxzoom, 1);
  assert.ok(existsSync(res.file), 'archive should exist on disk');
  assert.match(res.sha256, /^[0-9a-f]{64}$/, 'sha256 should be 64 lowercase hex chars');
  assert.ok(res.sizeKb > 0, 'sizeKb should be non-zero');
  return true;
});

await check('the shipped reader parses the header we wrote', async () => {
  const dir = tmp('pyramid-header-');
  const bakePng = await paintPng(path.join(dir, 'close.png'), 1024, 1024, quadrantPick);
  const res = await buildPyramid({ id: 'kings-island', bandId: 'close', bakePng, bounds: BOUNDS, outDir: path.join(dir, 'out') });
  assert.equal(res.ok, true, `expected ok, got ${res.reason || ''}`);

  const header = await openArchive(res.file).getHeader();
  assert.equal(header.specVersion, 3);
  assert.equal(header.tileType, 2, 'tileType 2 is PNG');
  assert.equal(header.minZoom, 0);
  assert.equal(header.maxZoom, 1);
  assert.equal(header.numAddressedTiles, 5);
  assert.equal(header.clustered, true);
  // int32 * 1e7 is exact to 7 decimals; the fixture bounds have two.
  assert.equal(header.minLon, BOUNDS.west);
  assert.equal(header.minLat, BOUNDS.south);
  assert.equal(header.maxLon, BOUNDS.east);
  assert.equal(header.maxLat, BOUNDS.north);

  const meta = await openArchive(res.file).getMetadata();
  assert.equal(meta.name, 'kings-island');
  assert.equal(meta.band, 'close');
  assert.equal(meta.format, 'png');
  assert.deepEqual(meta.bounds, [BOUNDS.west, BOUNDS.south, BOUNDS.east, BOUNDS.north]);
  return true;
});

await check('every native-level tile holds the quadrant painted in that cell', async () => {
  const dir = tmp('pyramid-cells-');
  const bakePng = await paintPng(path.join(dir, 'close.png'), 1024, 1024, quadrantPick);
  const res = await buildPyramid({ id: 'kings-island', bandId: 'close', bakePng, bounds: BOUNDS, outDir: path.join(dir, 'out') });
  assert.equal(res.ok, true, `expected ok, got ${res.reason || ''}`);

  const archive = openArchive(res.file);
  for (const [key, want] of Object.entries(QUADRANT_AT)) {
    const [z, x, y] = key.split('/').map(Number);
    const tile = await decodeTile(await archive.getZxy(z, x, y));
    assert.equal(tile.width, 512, `tile ${key} should be 512 wide`);
    assert.equal(tile.height, 512, `tile ${key} should be 512 tall`);
    const wrong = firstPixelUnlike(tile, want.rgb);
    assert.equal(
      wrong,
      null,
      `tile (z${z}, x${x}, y${y}) should be all ${want.name} rgb(${want.rgb.join(',')}) but ${wrong}`,
    );
  }

  const top = await decodeTile(await archive.getZxy(0, 0, 0));
  assert.equal(top.width, 512, 'the overview level is one 512px tile');
  assert.equal(top.height, 512);
  return true;
});

await check('two builds into two temp dirs are byte-identical', async () => {
  const srcDir = tmp('pyramid-src-');
  const bakePng = await paintPng(path.join(srcDir, 'close.png'), 1024, 1024, quadrantPick);
  const args = { id: 'kings-island', bandId: 'close', bakePng, bounds: BOUNDS };

  const a = await buildPyramid({ ...args, outDir: path.join(tmp('pyramid-a-'), 'out') });
  const b = await buildPyramid({ ...args, outDir: path.join(tmp('pyramid-b-'), 'out') });
  assert.equal(a.ok, true, `expected ok, got ${a.reason || ''}`);
  assert.equal(b.ok, true, `expected ok, got ${b.reason || ''}`);
  assert.notEqual(a.file, b.file, 'the two builds must land in different directories');

  const bytesA = readFileSync(a.file);
  const bytesB = readFileSync(b.file);
  assert.equal(a.sha256, b.sha256, 'the same input must hash the same twice');
  assert.ok(
    bytesA.equals(bytesB),
    `archives differ at byte ${bytesA.findIndex ? [...bytesA].findIndex((v, i) => v !== bytesB[i]) : '?'} (lengths ${bytesA.length} vs ${bytesB.length})`,
  );
  return true;
});

await check('an edge tile is padded to a full tile with transparency', async () => {
  const dir = tmp('pyramid-edge-');
  // 600 wide: the right column of the native level carries 88 real pixels.
  const bakePng = await paintPng(path.join(dir, 'mid.png'), 600, 300, () => TR);
  const res = await buildPyramid({ id: 'kings-island', bandId: 'mid', bakePng, bounds: BOUNDS, outDir: path.join(dir, 'out') });
  assert.equal(res.ok, true, `expected ok, got ${res.reason || ''}`);
  assert.equal(res.maxzoom, 1);
  assert.equal(res.tiles, 3, '2 tiles at the native level plus 1 overview');

  const edge = await decodeTile(await openArchive(res.file).getZxy(1, 1, 0));
  assert.equal(edge.width, 512, 'a partial tile is still a full 512px tile');
  assert.equal(edge.height, 512);
  assert.equal(alphaAt(edge, 0, 0), 255, 'the left of the edge tile is real imagery');
  assert.equal(alphaAt(edge, 87, 0), 255, 'x=87 is the last real column (600 - 512 = 88 wide)');
  assert.equal(alphaAt(edge, 88, 0), 0, 'x=88 is past the raster and must be transparent');
  assert.equal(alphaAt(edge, 0, 299), 255, 'y=299 is the last real row of a 300px-tall raster');
  assert.equal(alphaAt(edge, 0, 300), 0, 'y=300 is past the raster and must be transparent');
  return true;
});

await check('spilling the root directory into leaves keeps every tile readable', async () => {
  const dir = tmp('pyramid-leaf-');
  const bakePng = await paintPng(path.join(dir, 'close.png'), 1024, 1024, quadrantPick);
  // Measured: a gzipped 5-entry root is 38 bytes and a gzipped 1-entry root is
  // 25, so a 32-byte budget is exactly the window that forces one leaf.
  const res = await buildPyramid({
    id: 'kings-island', bandId: 'close', bakePng, bounds: BOUNDS, outDir: path.join(dir, 'out'), maxRootBytes: 32,
  });
  assert.equal(res.ok, true, `expected ok, got ${res.reason || ''}`);
  assert.equal(res.tiles, 5);

  const archive = openArchive(res.file);
  const header = await archive.getHeader();
  assert.ok(header.leafDirectoryLength > 0, 'the leaf directory section should be non-empty');
  assert.ok(header.rootDirectoryLength <= 32, `root should fit the 32-byte budget, was ${header.rootDirectoryLength}`);

  for (const [key, want] of Object.entries(QUADRANT_AT)) {
    const [z, x, y] = key.split('/').map(Number);
    const tile = await decodeTile(await archive.getZxy(z, x, y));
    const wrong = firstPixelUnlike(tile, want.rgb);
    assert.equal(wrong, null, `through leaves, tile (z${z}, x${x}, y${y}) should be all ${want.name} but ${wrong}`);
  }
  assert.ok(await archive.getZxy(0, 0, 0), 'the overview tile should resolve through leaves too');
  return true;
});

await check('a close-band directory of 344,964 entries packs into leaves', () => {
  // The size that motivates leaves at all: a close band at kings-island scale.
  // It is also the size that breaks `array.push(...bytes)` — the spread caps
  // near 125,274 arguments in this engine — so this exercises the byte-at-a-
  // time varint sink on the only input where the difference shows.
  //
  // Tile lengths carry the entropy here, and they have to: a first attempt
  // used `4096 + (i % 97)` and gzip squeezed all 344,964 entries into a root
  // well under 16 KiB, so the leaf path never ran and the check was vacuous.
  // Real PNG tiles vary, so the lengths come off a fixed LCG instead.
  const entries = [];
  let seed = 20250821;
  let offset = 0;
  for (let i = 0; i < 344964; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const length = 20000 + (seed % 60000);
    entries.push({ tileId: i, offset, length, runLength: 1 });
    offset += length;
  }
  const packed = packDirectories(entries);
  assert.ok(packed.root.length <= 16384 - 127, `root must fit the reader's first read, was ${packed.root.length}`);
  assert.ok(packed.numLeaves > 1, `344,964 entries cannot live in one root, got ${packed.numLeaves} leaves`);
  assert.ok(packed.leaves.length > 0, 'leaf section must carry the entries the root does not');
  return true;
});

await check('an unwritable outDir fails WITHOUT the gap flag', async () => {
  const dir = tmp('pyramid-unwritable-');
  const bakePng = await paintPng(path.join(dir, 'close.png'), 1024, 1024, quadrantPick);
  // A regular file where a parent directory has to be: mkdir cannot proceed,
  // and that is this venue's failure, not a missing toolchain.
  const blocker = path.join(dir, 'blocked');
  writeFileSync(blocker, 'not a directory');
  const res = await buildPyramid({
    id: 'kings-island', bandId: 'close', bakePng, bounds: BOUNDS, outDir: path.join(blocker, 'tiles'),
  });

  assert.equal(res.ok, false, 'writing under a file must fail');
  assert.ok(!res.gap, `an unwritable outDir is a real failure, not a recorded gap (gap was ${res.gap})`);
  assert.equal(typeof res.reason, 'string');
  assert.ok(res.reason.length > 0, 'a failure must say why');
  return true;
});

await check('a missing bake fails WITHOUT the gap flag', async () => {
  const dir = tmp('pyramid-missing-');
  const res = await buildPyramid({
    id: 'kings-island', bandId: 'close', bakePng: path.join(dir, 'nope.png'), bounds: BOUNDS, outDir: path.join(dir, 'out'),
  });
  assert.equal(res.ok, false);
  assert.ok(!res.gap, 'an absent bake is a real failure, not a missing toolchain');
  assert.match(res.reason, /nope\.png/, 'the reason should name the file it could not read');
  return true;
});

await check('bounds outside the shipped {west,south,east,north} shape are rejected', async () => {
  const dir = tmp('pyramid-bounds-');
  const bakePng = await paintPng(path.join(dir, 'close.png'), 1024, 1024, quadrantPick);
  for (const bounds of [null, [1, 2, 3, 4], { west: -84.7, south: 39.32, east: -84.68 }]) {
    const res = await buildPyramid({ id: 'kings-island', bandId: 'close', bakePng, bounds, outDir: path.join(dir, 'out') });
    assert.equal(res.ok, false, `bounds ${JSON.stringify(bounds)} should be rejected`);
    assert.ok(!res.gap, 'bad bounds are a real failure, not a gap');
  }
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
