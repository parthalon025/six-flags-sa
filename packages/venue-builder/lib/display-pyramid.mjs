/**
 * Display pyramid — a baked band raster becomes a PMTiles v3 raster archive.
 *
 * ADR-0021 fixes the three bands in ground sample distance; `display-bands`
 * turns a World's ground span into the pixel dimensions of each bake. What is
 * missing between a bake and a phone is the pyramid: the band cut into tiles,
 * with the coarser levels a client needs while it is still zooming out.
 *
 * The writer is hand-rolled on purpose, and it is the only honest option here:
 *
 *   - the installed `pmtiles` package is a *decoder*. It exports `PMTiles`,
 *     `bytesToHeader`, `findTile`, `readVarint`, `tileIdToZxy`, `zxyToTileId`
 *     and no serializer at all, so there is nothing to call.
 *   - go-pmtiles and tippecanoe are not installed, and shelling out to a binary
 *     nobody has is how this repo ended up with a module that recorded a
 *     permanent gap on every single call. `display-tiles` may wrap tippecanoe
 *     because vector tiling is genuinely someone else's algorithm; cutting a
 *     PNG into a quadtree is not.
 *   - `sharp` is a real dependency and does the resize/cut/encode in process.
 *
 * So this module writes the container itself, against the spec the shipped
 * reader implements — the format is small (a 127-byte header, varint
 * directories, a tile blob) and it is verified the only way that means
 * anything: `test/builder/display-pyramid.mjs` reads every tile back out with
 * the shipped `PMTiles` reader and matches it against known colours.
 *
 * Zoom levels here are pyramid-local, not Web Mercator slippy zooms: z0 is the
 * whole band in one tile and `maxzoom` is the bake at native resolution. The
 * band is an overlay placed by the `bounds` in the header, not a global tile
 * set, so there is nothing to align to and resampling onto mercator tile
 * edges would only throw away the bake's ground resolution.
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  closeSync, existsSync, mkdirSync, openSync, readSync, statSync, unlinkSync, writeSync,
} from 'node:fs';

/** MapLibre counts 512 px tiles, and so does the band table in `shared`. */
export const TILE_PIXELS = 512;

/** PMTiles v3 header is a fixed 127 bytes. */
const HEADER_BYTES = 127;

/** Compression and type enums, as the reader's `bytesToHeader` reads them. */
const COMPRESSION_NONE = 1;
const COMPRESSION_GZIP = 2;
const TILE_TYPE_PNG = 2;

/**
 * The reader fetches the first 16 KiB and slices the root directory out of it
 * without a second request, so the root has to fit inside that window. Past
 * this budget the directory spills into leaves.
 */
const MAX_ROOT_BYTES = 16384 - HEADER_BYTES;

/** Bytes copied per read when the tile blob is appended to the archive. */
const COPY_CHUNK_BYTES = 1 << 20;

/* ------------------------------------------------------------------ *
 * Hilbert tile ids
 * ------------------------------------------------------------------ */

function rotate(n, x, y, rx, ry) {
  if (ry === 0) {
    if (rx !== 0) return [n - 1 - y, n - 1 - x];
    return [y, x];
  }
  return [x, y];
}

/**
 * Z/X/Y to the Hilbert-curve tile id PMTiles orders its directories by. This
 * is the writer's half of the reader's `zxyToTileId`; the round-trip through
 * the shipped reader is what the suite checks, not agreement with a copy.
 */
export function tileId(z, x, y) {
  if (!Number.isInteger(z) || z < 0 || z > 26) throw new Error(`zoom out of range: ${z}`);
  if (x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new Error(`tile ${z}/${x}/${y} is outside its zoom`);
  let acc = ((1 << z) * (1 << z) - 1) / 3;
  let a = z - 1;
  let tx = x;
  let ty = y;
  for (let s = 1 << a; s > 0; s >>= 1) {
    const rx = tx & s;
    const ry = ty & s;
    acc += ((3 * rx) ^ ry) * (1 << a);
    [tx, ty] = rotate(s, tx, ty, rx, ry);
    a -= 1;
  }
  return acc;
}

/* ------------------------------------------------------------------ *
 * Varint directories
 * ------------------------------------------------------------------ */

/**
 * A growable byte buffer. A close band is hundreds of thousands of cells and
 * each contributes four varints, so the directory is built by appending single
 * bytes into a doubling buffer — `array.push(...bytes)` caps out near 125k
 * arguments in this engine and would throw on exactly the band that needs it.
 */
class ByteSink {
  constructor(capacity = 1024) {
    this.buf = Buffer.alloc(capacity);
    this.length = 0;
  }

  byte(value) {
    if (this.length === this.buf.length) {
      const grown = Buffer.alloc(this.buf.length * 2);
      this.buf.copy(grown, 0, 0, this.length);
      this.buf = grown;
    }
    this.buf[this.length] = value;
    this.length += 1;
  }

  varint(value) {
    let n = value;
    while (n >= 0x80) {
      this.byte((n & 0x7f) | 0x80);
      n = Math.floor(n / 128);
    }
    this.byte(n);
  }

  bytes() {
    return this.buf.subarray(0, this.length);
  }
}

/**
 * Serialize one directory: entry count, then delta-coded tile ids, run lengths,
 * lengths and offsets, each as its own varint column. An offset of 0 means
 * "immediately after the previous entry" — the reader relies on that, so the
 * elision is not an optimisation to skip.
 *
 * `entries` must be sorted by `tileId` ascending: the reader binary-searches.
 */
export function serializeDirectory(entries) {
  const sink = new ByteSink(Math.max(1024, entries.length * 8));
  sink.varint(entries.length);
  let last = 0;
  for (const entry of entries) {
    sink.varint(entry.tileId - last);
    last = entry.tileId;
  }
  for (const entry of entries) sink.varint(entry.runLength);
  for (const entry of entries) sink.varint(entry.length);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const previous = entries[i - 1];
    if (i > 0 && entry.offset === previous.offset + previous.length) sink.varint(0);
    else sink.varint(entry.offset + 1);
  }
  return sink.bytes();
}

/**
 * Fit the tile entries into a root directory, spilling into leaves when the
 * root would outgrow the reader's first-16-KiB read. Leaf sizes double until
 * the root fits, which is how go-pmtiles does it; the cost of guessing low is
 * one extra serialization pass, and the cost of not doing it at all is an
 * archive the reader silently cannot open past the first few thousand tiles.
 */
export function packDirectories(entries, maxRootBytes = MAX_ROOT_BYTES) {
  const rootOnly = gzipSync(serializeDirectory(entries));
  if (rootOnly.length <= maxRootBytes) {
    return { root: rootOnly, leaves: Buffer.alloc(0), numLeaves: 0 };
  }
  for (let leafSize = 4096; ; leafSize *= 2) {
    const rootEntries = [];
    const chunks = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const slice = entries.slice(i, i + leafSize);
      const leaf = gzipSync(serializeDirectory(slice));
      // runLength 0 is what tells the reader this entry points at a directory.
      rootEntries.push({ tileId: slice[0].tileId, offset, length: leaf.length, runLength: 0 });
      chunks.push(leaf);
      offset += leaf.length;
    }
    const root = gzipSync(serializeDirectory(rootEntries));
    if (root.length <= maxRootBytes) {
      return { root, leaves: Buffer.concat(chunks), numLeaves: rootEntries.length };
    }
    // One leaf holding everything is the smallest a root can get; past that
    // doubling only re-serializes the same single entry forever.
    if (leafSize >= entries.length) break;
  }
  throw new Error(`root directory cannot be packed into ${maxRootBytes} bytes for ${entries.length} tiles`);
}

/* ------------------------------------------------------------------ *
 * Header
 * ------------------------------------------------------------------ */

function putUint64(buf, offset, value) {
  buf.writeUInt32LE(value >>> 0, offset);
  buf.writeUInt32LE(Math.floor(value / 2 ** 32), offset + 4);
}

/** Longitude/latitude ride in the header as int32 at 1e-7 degrees. */
const e7 = (degrees) => Math.round(degrees * 1e7);

function serializeHeader(fields) {
  const header = Buffer.alloc(HEADER_BYTES);
  header.write('PMTiles', 0, 'ascii');
  header.writeUInt8(3, 7);
  putUint64(header, 8, fields.rootDirectoryOffset);
  putUint64(header, 16, fields.rootDirectoryLength);
  putUint64(header, 24, fields.jsonMetadataOffset);
  putUint64(header, 32, fields.jsonMetadataLength);
  putUint64(header, 40, fields.leafDirectoryOffset);
  putUint64(header, 48, fields.leafDirectoryLength);
  putUint64(header, 56, fields.tileDataOffset);
  putUint64(header, 64, fields.tileDataLength);
  putUint64(header, 72, fields.numAddressedTiles);
  putUint64(header, 80, fields.numTileEntries);
  putUint64(header, 88, fields.numTileContents);
  header.writeUInt8(1, 96); // clustered: tile blobs run in tile-id order
  header.writeUInt8(COMPRESSION_GZIP, 97);
  header.writeUInt8(COMPRESSION_NONE, 98); // a PNG is already compressed
  header.writeUInt8(TILE_TYPE_PNG, 99);
  header.writeUInt8(fields.minzoom, 100);
  header.writeUInt8(fields.maxzoom, 101);
  header.writeInt32LE(e7(fields.bounds.west), 102);
  header.writeInt32LE(e7(fields.bounds.south), 106);
  header.writeInt32LE(e7(fields.bounds.east), 110);
  header.writeInt32LE(e7(fields.bounds.north), 114);
  header.writeUInt8(fields.maxzoom, 118);
  header.writeInt32LE(e7((fields.bounds.west + fields.bounds.east) / 2), 119);
  header.writeInt32LE(e7((fields.bounds.south + fields.bounds.north) / 2), 123);
  return header;
}

/* ------------------------------------------------------------------ *
 * The pyramid itself
 * ------------------------------------------------------------------ */

/**
 * Pure: a bake's pixel dimensions → one descriptor per level, coarsest first.
 * Levels halve until the whole band fits a single tile, so z0 is always the
 * one-tile overview and `maxzoom` is always the bake untouched.
 */
export function pyramidLevels(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`bake dimensions must be positive integers, got ${width}x${height}`);
  }
  const dims = [[width, height]];
  let w = width;
  let h = height;
  while (w > TILE_PIXELS || h > TILE_PIXELS) {
    w = Math.ceil(w / 2);
    h = Math.ceil(h / 2);
    dims.push([w, h]);
  }
  dims.reverse();
  return dims.map(([levelWidth, levelHeight], z) => ({
    z,
    width: levelWidth,
    height: levelHeight,
    cols: Math.ceil(levelWidth / TILE_PIXELS),
    rows: Math.ceil(levelHeight / TILE_PIXELS),
  }));
}

const BOUND_KEYS = ['west', 'south', 'east', 'north'];

function readBounds(bounds) {
  if (!bounds || Array.isArray(bounds) || typeof bounds !== 'object') {
    throw new Error('bounds must be a { west, south, east, north } object');
  }
  for (const key of BOUND_KEYS) {
    if (!Number.isFinite(bounds[key])) throw new Error(`bounds.${key} must be a finite number`);
  }
  return { west: bounds.west, south: bounds.south, east: bounds.east, north: bounds.north };
}

/**
 * Encode one 512x512 PNG from a raw RGBA level, padding the right and bottom
 * edges with transparency when the level does not divide evenly. The padding
 * is what keeps a partial edge tile the same size as every other tile, so a
 * client never has to special-case the last column.
 */
async function encodeTile(sharpLib, level, raw, col, row) {
  const left = col * TILE_PIXELS;
  const top = row * TILE_PIXELS;
  const width = Math.min(TILE_PIXELS, level.width - left);
  const height = Math.min(TILE_PIXELS, level.height - top);
  let pipeline = sharpLib(raw.data, { raw: { width: level.width, height: level.height, channels: raw.channels } })
    .extract({ left, top, width, height });
  if (width < TILE_PIXELS || height < TILE_PIXELS) {
    pipeline = pipeline.extend({
      top: 0,
      left: 0,
      right: TILE_PIXELS - width,
      bottom: TILE_PIXELS - height,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }
  // Every encoder knob is pinned: two builds of one bake must be byte-identical
  // or a content hash cannot tell a rebuild from a change.
  return pipeline.png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
}

/**
 * The pyramid-build stage: a baked band PNG → `{bandId}.pmtiles` in `outDir`.
 *
 * Returns `{ ok, file, tiles, minzoom, maxzoom, sizeKb, sha256 }`, or a failure
 * — never throws.
 *
 * The two failure shapes are not the same thing, exactly as in `display-tiles`.
 * `gap: true` means the *toolchain* is absent: `sharp` is a native module that
 * can fail to load on a platform nobody promised to support, and the honest
 * record is a named gap. No `gap` means sharp ran and this venue's pyramid is
 * genuinely broken — a missing bake, bounds that are not bounds, an outDir that
 * cannot be written — which is a real failure and must fail the gate.
 */
export async function buildPyramid({ id, bandId, bakePng, bounds, outDir, maxRootBytes = MAX_ROOT_BYTES } = {}) {
  let sharpLib;
  try {
    sharpLib = (await import('sharp')).default;
  } catch (cause) {
    return {
      ok: false,
      gap: true,
      reason: `sharp not installed — cannot cut the ${bandId} band into tiles: ${cause.message}`,
    };
  }

  let scratch = null;
  try {
    const box = readBounds(bounds);
    if (!bakePng || !existsSync(bakePng)) throw new Error(`bake not found: ${bakePng}`);
    mkdirSync(outDir, { recursive: true });

    const meta = await sharpLib(bakePng).metadata();
    const levels = pyramidLevels(meta.width, meta.height);
    const maxzoom = levels.length - 1;

    const file = path.join(outDir, `${bandId}.pmtiles`);
    scratch = `${file}.tiledata`;
    const scratchFd = openSync(scratch, 'w');
    const entries = [];
    let tileDataLength = 0;
    try {
      for (const level of levels) {
        const source = sharpLib(bakePng).ensureAlpha();
        const sized = level.z === maxzoom
          ? source
          : source.resize(level.width, level.height, { fit: 'fill', kernel: 'lanczos3' });
        const { data, info } = await sized.raw().toBuffer({ resolveWithObject: true });
        const raw = { data, channels: info.channels };
        for (let row = 0; row < level.rows; row++) {
          for (let col = 0; col < level.cols; col++) {
            const png = await encodeTile(sharpLib, level, raw, col, row);
            // One at a time: a close band is hundreds of thousands of cells.
            entries.push({
              tileId: tileId(level.z, col, row),
              offset: tileDataLength,
              length: png.length,
              runLength: 1,
            });
            writeSync(scratchFd, png);
            tileDataLength += png.length;
          }
        }
      }
    } finally {
      closeSync(scratchFd);
    }

    // The reader binary-searches the directory, and the header claims the blob
    // is clustered — both need tile-id order, and the write order above is
    // level-then-row-then-column, which is not it.
    entries.sort((a, b) => a.tileId - b.tileId);
    const ordered = [];
    const offsets = new Map();
    let clusteredOffset = 0;
    for (const entry of entries) {
      offsets.set(entry.tileId, { from: entry.offset, length: entry.length });
      ordered.push({ tileId: entry.tileId, offset: clusteredOffset, length: entry.length, runLength: 1 });
      clusteredOffset += entry.length;
    }

    const { root, leaves } = packDirectories(ordered, maxRootBytes);
    const metadata = Buffer.from(JSON.stringify({
      name: id,
      band: bandId,
      format: 'png',
      type: 'overlay',
      tileSize: TILE_PIXELS,
      width: meta.width,
      height: meta.height,
      minzoom: 0,
      maxzoom,
      bounds: [box.west, box.south, box.east, box.north],
    }));
    const metadataGz = gzipSync(metadata);

    const rootDirectoryOffset = HEADER_BYTES;
    const jsonMetadataOffset = rootDirectoryOffset + root.length;
    const leafDirectoryOffset = jsonMetadataOffset + metadataGz.length;
    const tileDataOffset = leafDirectoryOffset + leaves.length;
    const header = serializeHeader({
      rootDirectoryOffset,
      rootDirectoryLength: root.length,
      jsonMetadataOffset,
      jsonMetadataLength: metadataGz.length,
      leafDirectoryOffset,
      leafDirectoryLength: leaves.length,
      tileDataOffset,
      tileDataLength,
      numAddressedTiles: ordered.length,
      numTileEntries: ordered.length,
      numTileContents: ordered.length,
      minzoom: 0,
      maxzoom,
      bounds: box,
    });

    const hash = createHash('sha256');
    const outFd = openSync(file, 'w');
    try {
      for (const part of [header, root, metadataGz, leaves]) {
        if (part.length) {
          writeSync(outFd, part);
          hash.update(part);
        }
      }
      // Re-read the scratch blob in tile-id order, so the archive's tile
      // section matches the directory it was just given.
      const scratchRead = openSync(scratch, 'r');
      try {
        const chunk = Buffer.alloc(COPY_CHUNK_BYTES);
        for (const entry of ordered) {
          const src = offsets.get(entry.tileId);
          let copied = 0;
          while (copied < src.length) {
            const want = Math.min(chunk.length, src.length - copied);
            const got = readSync(scratchRead, chunk, 0, want, src.from + copied);
            if (got <= 0) throw new Error(`short read of tile blob at ${src.from + copied}`);
            const slice = chunk.subarray(0, got);
            writeSync(outFd, slice);
            hash.update(slice);
            copied += got;
          }
        }
      } finally {
        closeSync(scratchRead);
      }
    } finally {
      closeSync(outFd);
    }
    unlinkSync(scratch);
    scratch = null;

    return {
      ok: true,
      file,
      tiles: ordered.length,
      minzoom: 0,
      maxzoom,
      sizeKb: Math.round(statSync(file).size / 1024),
      sha256: hash.digest('hex'),
    };
  } catch (cause) {
    if (scratch && existsSync(scratch)) unlinkSync(scratch);
    return { ok: false, reason: `${bandId} pyramid failed: ${cause.message}` };
  }
}

/** The archive a packer should ship for this band, or null when it is absent. */
export const pyramidFile = (outDir, bandId) => {
  const file = path.join(outDir, `${bandId}.pmtiles`);
  return existsSync(file) ? file : null;
};
