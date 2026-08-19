#!/usr/bin/env node
/**
 * Renderer parity — display pipeline Phase 1 (issue #527).
 *
 * Three independent measurements of where each Big Kahuna's Place sits, all
 * in venue-local mercator metres, must agree:
 *
 *   A. Reference — lib/geo.js localMetres(lat, lng, origin), origin projected
 *      from the venue meta centre. Spherical R = 6371000.
 *   B. MapLibre — the flag-gated DisplayMap: map.project() screen deltas from
 *      the projected centre, scaled by mercator metres-per-pixel
 *      (2π·6378137 / worldSize), then ×(6371000/6378137) into geo.js's frame.
 *   C. SVG — the shipped ParkMap: each g.poiMarker's screen anchor pushed
 *      through the inverse of g.mapWorld's screen CTM. localViewTransform
 *      (lib/mapViewport.js) applies scale(z, -z), so mapWorld user space IS
 *      north-positive local metres — no extra y flip on this leg.
 *
 * Needs a running flag-on build:
 *   NEXT_PUBLIC_MAPLIBRE_DISPLAY=1 npm run build --workspace=@party-tracker/app
 *   NEXT_PUBLIC_MAPLIBRE_DISPLAY=1 npm run start --workspace=@party-tracker/app
 *   CHROMIUM_PATH=... BASE_URL=... node test/app/display-parity.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { launch, closeGate, BASE, until } from './browser.mjs';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const { project, localMetres } = await import('../../apps/party-tracker/lib/geo.js');
const { DISPLAY_SPIKE_VENUE } = await import('../../apps/party-tracker/lib/mapLibreConfigured.js');

const R_GEO = 6371000; // lib/geo.js spherical radius
const R_WGS = 6378137; // MapLibre's WGS84 mercator radius

// Leg B: map.project() is exact camera math; the only slack is float noise.
const TOL_B = 0.5;
// Leg C: marker translate()s are rounded to 0.1 px and localViewTransform
// snaps the world translate to whole device pixels while projectionFor does
// not — at the boot scale (~0.6 px/m) those two quantisations together stay
// under ~1.1 m per axis.
const TOL_C = 1.5;
// Strictly below TOL_B + TOL_C, or the triangle inequality would make this
// check a free rider on the other two — measured drift is under 0.3 m.
const TOL_CROSS = 1.5;
const MIN_SVG_MARKERS = 10; // declutter hides some; the pass must still be real

const VENUE_DIR = new URL('../../apps/party-tracker/public/venues/', import.meta.url);
const mapJson = JSON.parse(readFileSync(new URL(`${DISPLAY_SPIKE_VENUE}.map.json`, VENUE_DIR)));
const pois = JSON.parse(readFileSync(new URL(`${DISPLAY_SPIKE_VENUE}.pois.json`, VENUE_DIR)));
const center = mapJson.meta.center;
const ORIGIN = project(center.lat, center.lng);

const PASS = [];
const FAIL = [];
const check = (name, fn) => {
  try {
    fn();
    PASS.push(name);
    console.log('  PASS', name);
  } catch (err) {
    FAIL.push(`${name} :: ${err.message}`);
    console.log('  FAIL', name, '->', err.message);
  }
};

// The flag-on build is a precondition, not a finding — bail with instructions.
const probe = await fetch(`${BASE}/api/display-spike/base.pmtiles`, { method: 'HEAD' }).catch(() => null);
if (!probe || !probe.ok) {
  console.error(
    `display-parity: ${BASE}/api/display-spike/base.pmtiles is not serving ` +
      `(${probe ? `HTTP ${probe.status}` : 'no server'}).\n` +
      'Build and start with NEXT_PUBLIC_MAPLIBRE_DISPLAY=1:\n' +
      '  NEXT_PUBLIC_MAPLIBRE_DISPLAY=1 npm run build --workspace=@party-tracker/app\n' +
      '  NEXT_PUBLIC_MAPLIBRE_DISPLAY=1 npm run start --workspace=@party-tracker/app',
  );
  process.exit(1);
}

// Leg A — the reference frame both renderers are measured against.
const refByName = new Map();
for (const p of pois) {
  const [x, y] = localMetres(p.lat, p.lng, ORIGIN);
  refByName.set(p.n, { x, y });
}

const APP_VERSION = JSON.parse(
  readFileSync(new URL('../../apps/party-tracker/package.json', import.meta.url)),
).version;

const browser = await launch();

async function openLeg(url, label) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    geolocation: { latitude: center.lat, longitude: center.lng },
    permissions: ['geolocation'],
    locale: 'en-US',
  });
  // Skip the intake gates the way openPhone does — this harness measures
  // geometry, not onboarding.
  await context.addInitScript(({ version, venueId }) => {
    localStorage.setItem('tracker-release-notes-seen', version);
    localStorage.setItem('tracker-intro-seen', '1');
    localStorage.setItem('tracker-venue-confirmed', venueId);
  }, { version: APP_VERSION, venueId: DISPLAY_SPIKE_VENUE });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { context, page, errors };
}

/* ---------- Leg B: MapLibre ---------- */

console.log(`\nrenderer parity against ${BASE}\n`);
console.log('leg B: MapLibre DisplayMap at /');

const legB = await openLeg(BASE, 'maplibre');
await until(
  () => legB.page.evaluate(() => Boolean(window.__parkboundDisplayMap)),
  { timeout: 30000, label: 'DisplayMap onMapReady handle' },
);
await until(
  () => legB.page.evaluate(() => window.__parkboundDisplayMap.loaded() === true),
  { timeout: 30000, label: 'MapLibre tiles loaded' },
);

const bRaw = await legB.page.evaluate(
  ({ pois: list, center: c }) => {
    const map = window.__parkboundDisplayMap;
    // maplibre-gl 6.x exposes no map.transform in the shipped bundle, so read
    // worldSize (tileSize·2^zoom) off the projection itself: ±360° of
    // longitude are exactly two world widths apart in screen px.
    const worldSize =
      (map.project([c.lng + 360, c.lat]).x - map.project([c.lng - 360, c.lat]).x) / 2;
    const mpp = (2 * Math.PI * 6378137) / worldSize;
    const origin = map.project([c.lng, c.lat]);
    return {
      worldSize,
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      points: list.map((p) => {
        const s = map.project([p.lng, p.lat]);
        // Screen y grows down, north is up.
        return { name: p.n, x: (s.x - origin.x) * mpp, y: -(s.y - origin.y) * mpp };
      }),
    };
  },
  { pois, center },
);
await legB.context.close();

check('leg B: bearing and pitch are 0', () => {
  assert.equal(bRaw.bearing, 0, `bearing ${bRaw.bearing}`);
  assert.equal(bRaw.pitch, 0, `pitch ${bRaw.pitch}`);
});
check('leg B: no page errors', () => {
  assert.deepEqual(legB.errors, []);
});

// WGS84 mercator → geo.js's mean-radius frame: a uniform scale.
const bByName = new Map(
  bRaw.points.map((p) => [p.name, { x: (p.x * R_GEO) / R_WGS, y: (p.y * R_GEO) / R_WGS }]),
);

let maxB = { d: 0, name: null, axis: null };
check(`leg B: all ${pois.length} POIs within ${TOL_B} m of localMetres per axis`, () => {
  assert.equal(bByName.size, pois.length, `projected ${bByName.size} of ${pois.length}`);
  for (const [name, b] of bByName) {
    const a = refByName.get(name);
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx > maxB.d) maxB = { d: dx, name, axis: 'x' };
    if (dy > maxB.d) maxB = { d: dy, name, axis: 'y' };
    assert.ok(dx <= TOL_B, `${name}: |dx| ${dx.toFixed(3)} m`);
    assert.ok(dy <= TOL_B, `${name}: |dy| ${dy.toFixed(3)} m`);
  }
});

/* ---------- Leg C: SVG ---------- */

console.log('\nleg C: ParkMap SVG at /?displayMap=svg');

const legC = await openLeg(`${BASE}/?displayMap=svg`, 'svg');
await closeGate(legC.page);
await until(async () => (await legC.page.locator('g.poiMarker').count()) >= 1, {
  timeout: 30000,
  label: 'SVG poi markers',
});
// Let the declutter/label pass settle before reading the CTM.
await legC.page.waitForTimeout(1500);

const collectSvgMarkers = () => {
  const svg = document.querySelector('svg.mapSvg');
  const world = svg?.querySelector('g.mapWorld');
  if (!svg || !world) return { error: 'no svg.mapSvg / g.mapWorld' };
  const svgCTM = svg.getScreenCTM();
  const inv = world.getScreenCTM().inverse();
  const counts = new Map();
  const markers = [...document.querySelectorAll('g.poiMarker')];
  for (const g of markers) {
    const n = g.querySelector('title')?.textContent || '';
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  const points = [];
  let ambiguous = 0;
  for (const g of markers) {
    const name = g.querySelector('title')?.textContent || '';
    if (!name) continue;
    if (counts.get(name) > 1) {
      // Repeated names cannot be matched to one Place — skip, never guess.
      ambiguous += 1;
      continue;
    }
    // The marker g's translate(sx sy) is its anchor in the svg root's user
    // space; the svg's own CTM carries it to client px. More faithful than a
    // bounding-box centre, whose glyph extents need not straddle the anchor.
    const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(g.getAttribute('transform') || '');
    let client;
    if (m) {
      client = new DOMPoint(Number(m[1]), Number(m[2])).matrixTransform(svgCTM);
    } else {
      const r = g.getBoundingClientRect();
      client = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    // Inverse of the venue-local -> screen CTM: an independent path from the
    // app's own projectionFor math back to mapWorld user space, which is
    // localMetres with y north-positive (scale(z, -z) in localViewTransform).
    const local = new DOMPoint(client.x, client.y).matrixTransform(inv);
    points.push({ name, x: local.x, y: local.y });
  }
  return { points, ambiguous, total: markers.length };
};

// Declutter only lets ~9 markers win at the boot fit — collect across zoom
// steps as well (the CTM inversion is view-independent), unioning by name.
// Later (higher-zoom) measurements overwrite: the px quantisations shrink as
// the scale grows.
const cRaw = { points: [], ambiguous: 0, total: 0, error: null };
const cSeen = new Map();
for (let step = 0; step < 3; step += 1) {
  if (step > 0) {
    await legC.page.locator('button[aria-label="Zoom in"]').click();
    await legC.page.waitForTimeout(900);
  }
  const got = await legC.page.evaluate(collectSvgMarkers);
  if (got.error) {
    cRaw.error = got.error;
    break;
  }
  cRaw.ambiguous += got.ambiguous;
  cRaw.total += got.total;
  for (const p of got.points) cSeen.set(p.name, p);
}
cRaw.points = [...cSeen.values()];
await legC.context.close();

check('leg C: no page errors', () => {
  assert.deepEqual(legC.errors, []);
});
check('leg C: mapWorld transform recovered', () => {
  assert.ok(!cRaw.error, cRaw.error);
});

const cByName = new Map((cRaw.points || []).map((p) => [p.name, p]));

let maxC = { d: 0, name: null, axis: null };
check(`leg C: >= ${MIN_SVG_MARKERS} rendered markers within ${TOL_C} m of localMetres per axis`, () => {
  assert.ok(
    cByName.size >= MIN_SVG_MARKERS,
    `only ${cByName.size} unambiguous markers rendered (${cRaw.ambiguous} ambiguous of ${cRaw.total})`,
  );
  for (const [name, c] of cByName) {
    const a = refByName.get(name);
    assert.ok(a, `marker "${name}" is not in pois.json`);
    const dx = Math.abs(c.x - a.x);
    const dy = Math.abs(c.y - a.y);
    if (dx > maxC.d) maxC = { d: dx, name, axis: 'x' };
    if (dy > maxC.d) maxC = { d: dy, name, axis: 'y' };
    assert.ok(dx <= TOL_C, `${name}: |dx| ${dx.toFixed(3)} m`);
    assert.ok(dy <= TOL_C, `${name}: |dy| ${dy.toFixed(3)} m`);
  }
});

let maxX = { d: 0, name: null, axis: null };
check(`cross-check: POIs in both legs within ${TOL_CROSS} m of each other per axis`, () => {
  let both = 0;
  for (const [name, c] of cByName) {
    const b = bByName.get(name);
    if (!b) continue;
    both += 1;
    const dx = Math.abs(b.x - c.x);
    const dy = Math.abs(b.y - c.y);
    if (dx > maxX.d) maxX = { d: dx, name, axis: 'x' };
    if (dy > maxX.d) maxX = { d: dy, name, axis: 'y' };
    assert.ok(dx <= TOL_CROSS, `${name}: |B-C| x ${dx.toFixed(3)} m`);
    assert.ok(dy <= TOL_CROSS, `${name}: |B-C| y ${dy.toFixed(3)} m`);
  }
  assert.ok(both >= MIN_SVG_MARKERS, `only ${both} POIs present in both legs`);
});

await browser.close();

// The asserted output: per-leg max deltas, so a drift shows up as a number.
const fmt = (m) => (m.name ? `${m.d.toFixed(3)} m (${m.name}, ${m.axis})` : 'n/a');
console.log(
  `\nparity max deltas: B-A ${fmt(maxB)} | C-A ${fmt(maxC)} | B-C ${fmt(maxX)} | ` +
    `legB ${bByName.size}/${pois.length} POIs, legC ${cByName.size} markers`,
);

if (FAIL.length) {
  console.error(`display-parity: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`display-parity: ${PASS.length} passed`);
}
