/**
 * Relief shading — the one thing terrain buys a flat map.
 *
 * A park map with no height reads as a diagram. Shading the ground by the
 * angle between its surface and a low sun is enough to make a berm look like a
 * berm and a valley like a valley, and it needs no isometric tier, no mesh and
 * no extrusion: it is a multiply over the ground the renderer already paints.
 * That makes it the first terrain feature worth shipping and, for a top-down
 * map, most of the value.
 *
 * (GameRealisticMap, which has far more terrain machinery than this, never
 * built relief shading — two TODOs in its satellite renderer and nothing
 * behind them. There was nothing to port; this is written from the standard
 * formulation.)
 *
 * The mean-centred falloff below is mirrored by the canvas compositor in
 * bin/display-bake-page.html, which shades from the model's `shade` channel
 * rather than this PNG. Change one, change the other.
 *
 * PNG encoding is done here rather than by a library because the only thing
 * needed is a single-image, no-filter, RGBA write, and node's zlib already
 * does the hard part.
 */

import { deflateSync } from 'node:zlib';

/** Sun position. Low and from the north-west, the cartographic convention. */
export const DEFAULT_LIGHT = { azimuth: 315, altitude: 45 };

/**
 * Per-cell shade in 0..1, where 1 is fully lit.
 * @param {import('./elevation-grid.mjs').ElevationGrid} grid
 * @param {{azimuth?: number, altitude?: number, exaggeration?: number}} [opts]
 * @returns {Float32Array} length cols*rows
 */
export function shadeField(grid, opts = {}) {
  const azimuth = ((opts.azimuth ?? DEFAULT_LIGHT.azimuth) * Math.PI) / 180;
  const altitude = ((opts.altitude ?? DEFAULT_LIGHT.altitude) * Math.PI) / 180;
  const exaggeration = opts.exaggeration ?? 1;
  // Light direction, y increasing southward to match the raster.
  const lx = Math.sin(azimuth) * Math.cos(altitude);
  const ly = -Math.cos(azimuth) * Math.cos(altitude);
  const lz = Math.sin(altitude);
  const out = new Float32Array(grid.cols * grid.rows);
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      const n = grid.normalAt(col + 0.5, row + 0.5);
      // Exaggeration steepens the normal without touching the heightfield.
      const nx = n.x * exaggeration;
      const ny = n.y * exaggeration;
      const len = Math.hypot(nx, ny, n.z);
      const dot = (nx * lx + ny * ly + n.z * lz) / len;
      out[row * grid.cols + col] = Math.max(0, Math.min(1, dot));
    }
  }
  return out;
}

/**
 * Shade as a per-cell byte, 0..255, for the bake model. 128 is "unlit ground",
 * so the compositor can multiply-blend around a neutral midpoint.
 * @param {Float32Array} field
 * @returns {number[]}
 */
export function shadeBytes(field) {
  return Array.from(field, (v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
}

/**
 * Hillshade as a translucent black/white overlay, ready to composite over the
 * map. Lit slopes lighten, shadowed slopes darken, flat ground is transparent.
 *
 * @param {Float32Array} field
 * @param {number} cols
 * @param {number} rows
 * @param {{ strength?: number }} [opts]
 * @returns {Uint8Array} RGBA, length cols*rows*4
 */
export function shadeRgba(field, cols, rows, { strength = 0.55, flatEpsilon = 0.004 } = {}) {
  const rgba = new Uint8Array(cols * rows * 4);
  // Mean shade is the "flat" reference; deviation from it is what we draw, so
  // a uniformly-lit park does not come out uniformly grey.
  let mean = 0;
  for (const v of field) mean += v;
  mean /= field.length || 1;

  // Scale by the venue's own spread rather than a fixed factor. Parks differ
  // by an order of magnitude in relief — Kings Island has 48 m of it, Big
  // Kahuna's is a sand flat — and a constant multiplier either washes the
  // gentle one out or blows the steep one to soot. Two standard deviations
  // maps the bulk of the range into the alpha channel either way.
  let variance = 0;
  for (const v of field) variance += (v - mean) ** 2;
  const spread = 2 * Math.sqrt(variance / (field.length || 1));

  // Genuinely flat ground: emit nothing rather than amplify DEM noise into
  // a texture that looks like terrain and is not.
  if (!(spread > flatEpsilon)) return rgba;

  for (let i = 0; i < field.length; i += 1) {
    const delta = field[i] - mean;
    const a = Math.min(1, (Math.abs(delta) / spread) * strength);
    const lit = delta >= 0;
    rgba[i * 4] = lit ? 255 : 0;
    rgba[i * 4 + 1] = lit ? 255 : 0;
    rgba[i * 4 + 2] = lit ? 255 : 0;
    rgba[i * 4 + 3] = Math.round(a * 255);
  }
  return rgba;
}

/* ------------------------------------------------------------------ PNG -- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * Encode 8-bit RGBA as a PNG. No filtering, no interlacing — deterministic
 * bytes for the same input, which the display certification depends on.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba
 * @returns {Buffer}
 */
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
