#!/usr/bin/env node
/**
 * Stamp package.json's version into the files the phone reads offline:
 *   - public/app-version.json  (client + service worker)
 *   - public/sw.js             (CACHE name placeholder)
 *
 * Runs on prebuild and predev so dev and production agree on the cache key.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version || '0.0.0';

const { PROTOCOL_VERSION } = await import('../lib/core/protocol.js');

const versionDoc = {
  version,
  protocol: PROTOCOL_VERSION,
  built: new Date().toISOString(),
};

fs.writeFileSync(
  path.join(root, 'public/app-version.json'),
  `${JSON.stringify(versionDoc, null, 2)}\n`,
);

const swPath = path.join(root, 'public/sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
const marker = "const CACHE = 'tracker-__APP_VERSION__';";
const replacement = `const CACHE = 'tracker-${version}';`;
if (!sw.includes(marker) && !sw.includes(`const CACHE = 'tracker-${version}';`)) {
  if (/const CACHE = 'tracker-[^']+';/.test(sw)) {
    sw = sw.replace(/const CACHE = 'tracker-[^']+';/, replacement);
  } else {
    console.error('inject-version: could not find CACHE line in public/sw.js');
    process.exitCode = 1;
    process.exit(1);
  }
} else if (sw.includes(marker)) {
  sw = sw.replace(marker, replacement);
}
fs.writeFileSync(swPath, sw);

console.log(`inject-version: stamped ${version} (protocol ${PROTOCOL_VERSION})`);
