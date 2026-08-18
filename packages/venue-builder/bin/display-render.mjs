#!/usr/bin/env node
/**
 * Render display packs — MapLibre + PMTiles in headless Chromium, screenshotted
 * at the certification's fixed visual points. The builder-side descendant of
 * PR #447's visual matrix: every Skin renders the same truth-derived locations,
 * so visual drift is compared at gates, districts, and rides — not at one
 * convenient screenshot.
 *
 *   node packages/venue-builder/bin/display-render.mjs <venueId> [--skin id]…
 *     [--points N] [--out dir] [--size WxH] [--scale N]
 *
 * Dev-tooling only: maplibre-gl, pmtiles, and playwright are devDependencies;
 * nothing here ships to the phone.
 */

import http from 'node:http';
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { MONO_ROOT, VENUE_DIR, readJson, venueSidecar } from '../lib/venue-io.mjs';

const argv = process.argv.slice(2);
const ids = [];
const skins = [];
let points = 2;
let outRoot = path.join(MONO_ROOT, 'artifacts', 'display-render');
let size = { width: 960, height: 720 };
let scale = 2;
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--skin') skins.push(argv[++i]);
  else if (a === '--points') points = Number(argv[++i]);
  else if (a === '--out') outRoot = path.resolve(argv[++i]);
  else if (a === '--size') {
    const [w, h] = String(argv[++i]).split('x').map(Number);
    if (w && h) size = { width: w, height: h };
  } else if (a === '--scale') scale = Number(argv[++i]) || 2;
  else if (!a.startsWith('--')) ids.push(a);
}
if (!ids.length) {
  console.error('usage: display-render.mjs <venueId> [--skin id]… [--points N] [--out dir]');
  process.exit(2);
}

const VENDOR = {
  '/vendor/maplibre-gl.mjs': ['maplibre-gl/dist/maplibre-gl.mjs', 'text/javascript'],
  '/vendor/maplibre-gl-shared.mjs': ['maplibre-gl/dist/maplibre-gl-shared.mjs', 'text/javascript'],
  '/vendor/maplibre-gl-worker.mjs': ['maplibre-gl/dist/maplibre-gl-worker.mjs', 'text/javascript'],
  '/vendor/maplibre-gl.css': ['maplibre-gl/dist/maplibre-gl.css', 'text/css'],
  '/vendor/pmtiles.mjs': ['pmtiles/dist/esm/index.js', 'text/javascript'],
  '/vendor/fflate.mjs': ['fflate/esm/browser.js', 'text/javascript'],
};

const PAGE = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/vendor/maplibre-gl.css">
<style>html,body,#map{margin:0;height:100%;width:100%}</style>
<div id="map"></div>
<script type="importmap">{"imports":{"fflate":"/vendor/fflate.mjs"}}</script>
<script type="module">
import { Map as MapLibreMap, addProtocol } from '/vendor/maplibre-gl.mjs';
import { Protocol } from '/vendor/pmtiles.mjs';
addProtocol('pmtiles', new Protocol().tile);
const q = new URLSearchParams(location.search);
const style = await (await fetch('/pack/' + q.get('skin') + '.style.json')).json();
style.sources.park.url = 'pmtiles://' + location.origin + '/pack/base.pmtiles';
const meta = await (await fetch('/truth/meta.json')).json();
const b = meta.bounds;
const map = new MapLibreMap({
  container: 'map', style, attributionControl: false, fadeDuration: 0,
  bounds: [[b.west, b.south], [b.east, b.north]], fitBoundsOptions: { padding: 24 },
});
map.on('error', (e) => console.error('map error: ' + (e.error?.message || e.error)));
map.on('idle', () => { window.__idle = true; });
window.__go = (lng, lat, zoom) => new Promise((res) => {
  window.__idle = false;
  map.jumpTo({ center: [lng, lat], zoom });
  map.once('idle', () => { window.__idle = true; res(true); });
});
</script>`;

function serve(displayDir, mapFile) {
  return http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    try {
      if (url === '/' || url === '/index.html') {
        res.setHeader('content-type', 'text/html');
        return res.end(PAGE);
      }
      if (url === '/truth/meta.json') {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify(readJson(mapFile).meta));
      }
      if (VENDOR[url]) {
        res.setHeader('content-type', VENDOR[url][1]);
        return res.end(readFileSync(path.join(MONO_ROOT, 'node_modules', VENDOR[url][0])));
      }
      if (url.startsWith('/pack/')) {
        const file = path.join(displayDir, path.basename(url));
        const body = readFileSync(file);
        res.setHeader('content-type', url.endsWith('.json') ? 'application/json' : 'application/octet-stream');
        res.setHeader('accept-ranges', 'bytes');
        const range = /^bytes=(\d+)-(\d+)?$/.exec(req.headers.range || '');
        if (range) {
          const start = Number(range[1]);
          const end = Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1);
          res.statusCode = 206;
          res.setHeader('content-range', `bytes ${start}-${end}/${body.length}`);
          res.setHeader('content-length', end - start + 1);
          return res.end(body.subarray(start, end + 1));
        }
        res.setHeader('content-length', body.length);
        return res.end(body);
      }
      res.statusCode = 404;
      res.end('not found');
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err.message));
    }
  });
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: size, deviceScaleFactor: scale });
page.on('pageerror', (err) => console.error('  page error:', err.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/WebGL|GL Driver/.test(m.text())) console.error('  console:', m.text().slice(0, 200));
});

const shots = [];
for (const id of ids) {
  const displayDir = venueSidecar(id, 'display');
  const mapFile = path.join(VENUE_DIR, `${id}.map.json`);
  if (!existsSync(path.join(displayDir, 'base.pmtiles'))) {
    console.error(`${id}: no base.pmtiles — run venues:display -- ${id} --tiles first`);
    continue;
  }
  const cert = readJson(path.join(displayDir, 'display-certification.json'), { anchors: [], skins: {} });
  const skinIds = skins.length ? skins : Object.keys(cert.skins);
  const server = serve(displayDir, mapFile);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${server.address().port}`;
  const outDir = path.join(outRoot, id);
  mkdirSync(outDir, { recursive: true });

  for (const skinId of skinIds) {
    await page.goto(`${base}/?skin=${encodeURIComponent(skinId)}`);
    await page.waitForFunction('window.__idle === true', null, { timeout: 60000 });
    const overview = path.join(outDir, `${skinId}--overview.png`);
    await page.screenshot({ path: overview });
    shots.push(overview);
    for (const anchor of cert.anchors.slice(0, points)) {
      await page.evaluate(
        ([lng, lat]) => window.__go(lng, lat, 16.6),
        [anchor.lng, anchor.lat],
      );
      const file = path.join(outDir, `${skinId}--${anchor.id.replace(/[^a-z0-9-]+/gi, '-')}.png`);
      await page.screenshot({ path: file });
      shots.push(file);
    }
    console.log(`${id} × ${skinId}: ${1 + Math.min(points, cert.anchors.length)} shot(s)`);
  }
  server.close();
}

await browser.close();
console.log(`\n${shots.length} screenshot(s) under ${outRoot}`);
