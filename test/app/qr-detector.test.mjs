#!/usr/bin/env node
/**
 * Issue #310 — QR decoder seam for pairing mode on browsers without BarcodeDetector.
 *
 * Seams: createQrDetector (platform vs jsQR vs unsupported), lazy jsQR load,
 * and QrScanner source guard (no static jsqr import on the join path).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APP = '../../apps/party-tracker/';
const { createQrDetector } = await import(`${APP}lib/qr/createQrDetector.js`);

const PASS = [];
const FAIL = [];
const check = async (name, fn) => {
  try {
    await fn();
    PASS.push(name);
    console.log('  PASS', name);
  } catch (err) {
    FAIL.push(`${name} :: ${err.message}`);
    console.log('  FAIL', name, '->', err.message);
  }
};

/** Minimal fake BarcodeDetector for the platform path. */
function fakePlatformDetector(detectResult = 'party:ABCDEF') {
  return class BarcodeDetector {
    static async getSupportedFormats() {
      return ['qr_code'];
    }
    constructor() {
      this.formats = ['qr_code'];
    }
    async detect() {
      return [{ rawValue: detectResult }];
    }
  };
}

await check('join path without BarcodeDetector is unsupported', async () => {
  const result = await createQrDetector({
    pairingMode: false,
    BarcodeDetector: undefined,
    loadJsQr: async () => {
      throw new Error('jsQR must not load on the join path');
    },
  });
  assert.equal(result.kind, 'unsupported');
});

await check('pairing mode without BarcodeDetector selects jsQR', async () => {
  let loaded = false;
  const result = await createQrDetector({
    pairingMode: true,
    BarcodeDetector: undefined,
    loadJsQr: async () => {
      loaded = true;
      const mod = await import('jsqr');
      return mod.default || mod;
    },
  });
  assert.equal(result.kind, 'jsqr');
  assert.ok(result.detector);
  assert.equal(loaded, true);
});

await check('platform BarcodeDetector is preferred when present', async () => {
  let loaded = false;
  const result = await createQrDetector({
    pairingMode: true,
    BarcodeDetector: fakePlatformDetector('pair:answer'),
    loadJsQr: async () => {
      loaded = true;
      return null;
    },
  });
  assert.equal(result.kind, 'platform');
  const hit = await result.detector.detect({});
  assert.equal(hit, 'pair:answer');
  assert.equal(loaded, false);
});

await check('jsQR decoder reads a known QR payload from ImageData', async () => {
  const QRCode = await import('qrcode');
  const { PNG } = await import('pngjs');
  const payload = 'https://example.test/pair#Zo8fGh2k';
  const pngBuffer = await QRCode.default.toBuffer(payload, { type: 'png', margin: 0, width: 64 });
  const png = PNG.sync.read(pngBuffer);

  const result = await createQrDetector({
    pairingMode: true,
    BarcodeDetector: undefined,
    loadJsQr: async () => {
      const mod = await import('jsqr');
      return mod.default || mod;
    },
  });
  assert.equal(result.kind, 'jsqr');
  const decoded = result.detector.decodeImageData({
    data: png.data,
    width: png.width,
    height: png.height,
  });
  assert.equal(decoded, payload);
});

await check('QrScanner has no static jsqr import', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, APP, 'components/QrScanner.jsx'), 'utf8');
  assert.match(src, /pairingMode/);
  assert.doesNotMatch(src, /import\s+.*['"]jsqr['"]/);
  assert.doesNotMatch(src, /from\s+['"]jsqr['"]/);
});

await check('createQrDetector lazy-loads jsqr only via dynamic import', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, APP, 'lib/qr/createQrDetector.js'), 'utf8');
  assert.match(src, /import\('jsqr'\)/);
  assert.doesNotMatch(src, /^import\s+.*['"]jsqr['"]/m);
});

await check('QrScanner stops camera tracks on teardown', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, APP, 'components/QrScanner.jsx'), 'utf8');
  assert.match(src, /track\.stop\(\)/);
  assert.match(src, /cancelled = true;\s*\n\s*stop\(\)/);
});

console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) {
  for (const f of FAIL) console.error('  ', f);
  process.exit(1);
}
