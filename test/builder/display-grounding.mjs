#!/usr/bin/env node
/**
 * The grounding harvest — a World's real material and colour relationships,
 * read from openly licensed aerial imagery into its reference profile.
 *
 * ADR-0020 clauses 1, 2 and 4; ADR-0021 clause 8. The suite is built around
 * the four walls that separate grounding from everything next to it:
 *
 *   1. Licence — only derivation-licensed sources may be harvested from.
 *      Viewable is not derivable, and street-level share-alike reach is an
 *      un-reviewed owner decision, so both are refused here rather than
 *      guessed at.
 *   2. Band scope — grounding covers overview and mid. Never close.
 *   3. Truth — the record carries relationships, never geometry, positions or
 *      names. The Visual factory restyles; it never repositions.
 *   4. Palette — re-expression assigns the Skin's own declared colours. A
 *      harvested colour never reaches a bake.
 *
 * No network: the raster is a fake probe painting a synthetic orthophoto over
 * real ring geometry, which is exactly what a real one does.
 *
 *   node test/builder/display-grounding.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

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

const {
  GROUNDING_BANDS, GROUNDING_SOURCES, MAX_GROUPS,
  footprintKey, regionsFromMap, harvestGrounding,
} = await import('../../packages/venue-builder/lib/display-grounding.mjs');

const {
  validateGrounding, groundKit, readVenueGrounding, groundingFile,
} = await import('../../packages/venue-builder/lib/display-references.mjs');

const { impliedTerrainClasses } = await import('../../packages/venue-builder/lib/display-bake.mjs');
const { rgbToLab, hexToRgb, deltaE } = await import('../../packages/venue-builder/lib/display-style-contract.mjs');
const {
  geographicToPixel, naipProbe, rankItems, pickItem,
} = await import('../../packages/venue-builder/lib/adapters/naip-planetary.mjs');
const { pointInRing } = await import('../../packages/venue-builder/lib/geometry.mjs');

const readKit = (id) => JSON.parse(readFileSync(
  new URL(`../../packages/venue-builder/data/display/kits/${id}.json`, import.meta.url), 'utf8',
));

/* ---------------------------------------------------- a synthetic World */

const box = (w, e, s, n) => [[w, s], [e, s], [e, n], [w, n]];

const GRASS_RING = box(-84.270, -84.266, 39.340, 39.350);
const LOT_RING = box(-84.262, -84.260, 39.340, 39.350);
const ROAD_CORRIDOR = box(-84.266, -84.2655, 39.340, 39.350);
const ROOF_RINGS = [
  box(-84.2655, -84.2651, 39.3445, 39.3455),
  box(-84.2649, -84.2645, 39.3445, 39.3455),
  box(-84.2643, -84.2639, 39.3445, 39.3455),
  box(-84.2637, -84.2633, 39.3445, 39.3455),
];

const SYNTH_MAP = {
  meta: {
    id: 'synth-park',
    bounds: { north: 39.350, south: 39.340, east: -84.260, west: -84.270 },
  },
  grass: [{ r: GRASS_RING }],
  parking: [{ r: LOT_RING }],
  path: [{ r: [[-84.26575, 39.3405], [-84.26575, 39.3495]] }],
  building: ROOF_RINGS.map((r) => ({ r })),
};

const GRASS_PAINT = '#4E7A3C'; // L 46.8
const LOT_PAINT = '#B9B4A8'; //   L 73.4
const ROAD_PAINT = '#3F3F42'; //  L 26.0
const ROOF_BLUE = '#8FA8C8'; //   b* -19.2
const ROOF_BEIGE = '#C8B896'; //  b* +19.4

const insideBox = ([lng, lat], ring) => {
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return lng >= Math.min(...lngs) && lng <= Math.max(...lngs)
    && lat >= Math.min(...lats) && lat <= Math.max(...lats);
};

/** A fake orthophoto: painted rings, last one wins, grey everywhere else. */
function paintedProbe(roofPaints) {
  const layers = [
    { ring: GRASS_RING, color: GRASS_PAINT },
    { ring: LOT_RING, color: LOT_PAINT },
    { ring: ROAD_CORRIDOR, color: ROAD_PAINT },
    ...ROOF_RINGS.map((ring, i) => ({ ring, color: roofPaints[i] })),
  ];
  const asked = [];
  return {
    asked,
    at(lng, lat) {
      asked.push([lng, lat]);
      let hit = '#808080';
      for (const layer of layers) if (insideBox([lng, lat], layer.ring)) hit = layer.color;
      return hexToRgb(hit);
    },
  };
}

/** A row of roofs, one per colour, each on its own patch of ground. */
function roofRun(colors) {
  const regions = colors.map((_, i) => ({
    cls: 'structure',
    kind: 'area',
    key: `roof-${i}`,
    coords: box(-84.2700 + i * 0.0002, -84.2699 + i * 0.0002, 39.3440, 39.3450),
  }));
  const paint = new Map(regions.map((r, i) => [r.key, colors[i]]));
  const probe = {
    at(lng, lat) {
      for (const r of regions) if (insideBox([lng, lat], r.coords)) return hexToRgb(paint.get(r.key));
      return null;
    },
  };
  return { regions, probe };
}

const NAIP_PIN = {
  source: 'planetary-computer:naip',
  tile: 'oh_m_3908425_ne_17_060_20250714',
  href: 'https://naipeuwest.blob.core.windows.net/naip/v002/oh/x.tif',
  captured: '2025-07-14',
  gsd: 0.6,
  license: 'public-domain',
  attribution: 'USDA FPAC-BC-GEO NAIP via Microsoft Planetary Computer',
  sha256: 'a'.repeat(64),
};

const harvestSynth = (roofPaints = [ROOF_BLUE, ROOF_BLUE, ROOF_BEIGE, ROOF_BEIGE], over = {}) =>
  harvestGrounding({
    venue: 'synth-park',
    regions: regionsFromMap(SYNTH_MAP),
    probe: paintedProbe(roofPaints),
    provenance: NAIP_PIN,
    ...over,
  });

const harvestRoofs = (colors) => {
  const { regions, probe } = roofRun(colors);
  return harvestGrounding({ venue: 'roof-run', regions, probe, provenance: NAIP_PIN });
};

console.log('\ngrounding harvest — the licence wall\n');

await check('a viewable-but-not-derivable basemap is refused by source', () => {
  assert.throws(
    () => harvestSynth(undefined, { provenance: { ...NAIP_PIN, source: 'google-satellite' } }),
    /derivation/i,
  );
  return true;
});

await check('street-level stays out while its share-alike reach is an open owner decision', () => {
  assert.throws(
    () => harvestSynth(undefined, { provenance: { ...NAIP_PIN, source: 'mapillary', license: 'cc-by-sa' } }),
    /derivation/i,
  );
  assert.ok(!GROUNDING_SOURCES.includes('mapillary'), 'mapillary must not be in the allowlist');
  return true;
});

await check('an allowlisted source claiming a closed licence is still refused', () => {
  assert.throws(
    () => harvestSynth(undefined, { provenance: { ...NAIP_PIN, license: 'all-rights-reserved' } }),
    /licen/i,
  );
  return true;
});

await check('an unpinned read is refused — no sha256, no grounding', () => {
  assert.throws(() => harvestSynth(undefined, { provenance: { ...NAIP_PIN, sha256: null } }), /sha256/i);
  return true;
});

await check('the accepted pin rides into the record verbatim', () => {
  const rec = harvestSynth();
  for (const key of ['source', 'tile', 'captured', 'gsd', 'license', 'attribution', 'sha256']) {
    assert.equal(rec.source[key], NAIP_PIN[key], `source.${key} lost on the way into the record`);
  }
  return true;
});

console.log('\ngrounding harvest — the band wall\n');

await check('grounding scopes itself to overview and mid, never close', () => {
  assert.deepEqual(GROUNDING_BANDS, ['overview', 'mid']);
  assert.deepEqual(harvestSynth().bands, ['overview', 'mid']);
  return true;
});

console.log('\ngrounding harvest — the truth wall\n');

await check('the record carries relationships, never geometry or names', () => {
  const pois = JSON.parse(readFileSync(
    new URL('../../apps/party-tracker/public/venues/kings-island.pois.json', import.meta.url), 'utf8',
  ));
  const names = new Set((pois.pois || pois).map((p) => p.n || p.name).filter(Boolean));
  const banned = /^(r|ring|rings|coords|coordinates|points|line|lat|lng|geometry|centroid|center|bounds|bbox)$/i;
  const walk = (node, at) => {
    if (Array.isArray(node)) {
      const pair = node.length === 2 && node.every((v) => typeof v === 'number' && Number.isFinite(v));
      assert.ok(!pair, `${at} is a coordinate-shaped pair — grounding must carry no positions`);
      node.forEach((v, i) => walk(v, `${at}[${i}]`));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        assert.ok(!banned.test(k), `${at}.${k} is a geometry key — grounding must carry no truth`);
        walk(v, `${at}.${k}`);
      }
      return;
    }
    if (typeof node === 'string') {
      assert.ok(!names.has(node), `${at} is the Place name "${node}" — grounding must carry no names`);
    }
  };

  // The committed record for a real park, and one harvested in this process —
  // the first is what actually ships, the second covers the path that made it.
  const shipped = JSON.parse(readFileSync(
    new URL('../../packages/venue-builder/data/venues/kings-island/display/grounding.json', import.meta.url),
    'utf8',
  ));
  assert.ok(Object.keys(shipped.classes).length >= 4, 'the shipped record must have something in it');
  assert.ok(shipped.groups.structure.groups.length >= 1, 'and roof groups — the likeliest place to leak truth');
  walk(shipped, 'kings-island');
  walk(harvestSynth(), 'synth-park');
  return true;
});

await check('the harvest reads exactly the layers the painter paints from', () => {
  // Both tables are private to their own module, so ask each which layers it
  // consults rather than restating either here — a table this test spelled out
  // would drift with them instead of catching them.
  const layersRead = (fn) => {
    const seen = new Set();
    fn(new Proxy({}, { get(_t, key) { if (typeof key === 'string') seen.add(key); return []; } }));
    return seen;
  };
  const painter = layersRead(impliedTerrainClasses);
  const harvest = layersRead(regionsFromMap);
  assert.ok(painter.size >= 8, 'the painter reads more layers than that');
  assert.ok(harvest.delete('building'), 'buildings are a grounding class of their own');
  assert.deepEqual([...harvest].sort(), [...painter].sort(), 'the grounding layer table has drifted');
  return true;
});

await check('every class the painter implies is harvested, and nothing the painter does not paint', () => {
  const map = JSON.parse(readFileSync(
    new URL('../../apps/party-tracker/public/venues/kings-island.map.json', import.meta.url), 'utf8',
  ));
  const harvested = new Set(regionsFromMap(map).map((r) => r.cls));
  assert.ok(harvested.delete('structure'), 'buildings are a grounding class of their own');
  assert.deepEqual(
    [...harvested].sort(),
    [...impliedTerrainClasses(map)].sort(),
    'the grounding layer table has drifted from the painter\'s',
  );
  return true;
});

await check('one footprint is one region, however many times truth carries it', () => {
  // six-flags-fiesta-texas ships five ways with byte-identical geometry. Left
  // alone they sample the same ground twice, weight it twice in the World's
  // mean, and land the same key in two groups — a roof that is its own two
  // roof families.
  const twice = { ...SYNTH_MAP, grass: [{ r: GRASS_RING }, { r: GRASS_RING.map((p) => [...p]) }] };
  const grass = regionsFromMap(twice).filter((r) => r.cls === 'grass');
  assert.equal(grass.length, 1, 'the same ring came back as two regions');

  for (const venue of ['big-kahunas', 'cedar-point', 'kings-island', 'six-flags-fiesta-texas']) {
    const map = JSON.parse(readFileSync(
      new URL(`../../apps/party-tracker/public/venues/${venue}.map.json`, import.meta.url), 'utf8',
    ));
    const regions = regionsFromMap(map);
    const keys = new Set(regions.map((r) => `${r.cls}:${r.key}`));
    assert.equal(keys.size, regions.length, `${venue}: a footprint is in the harvest twice`);
  }
  return true;
});

await check('an area region is only ever sampled inside its own ring', () => {
  // A triangle, because half of its bounding box is somebody else's ground —
  // a rectangle cannot tell a ring test from a bounding-box test.
  const wedge = {
    cls: 'lot',
    kind: 'area',
    key: 'wedge',
    coords: [[-84.262, 39.340], [-84.260, 39.340], [-84.260, 39.350]],
  };
  const probe = paintedProbe([ROOF_BLUE, ROOF_BLUE, ROOF_BEIGE, ROOF_BEIGE]);
  harvestGrounding({ venue: 'synth-park', regions: [wedge], probe, provenance: NAIP_PIN });
  assert.ok(probe.asked.length >= 8, `the wedge was barely sampled at all (${probe.asked.length})`);
  for (const p of probe.asked) {
    assert.ok(pointInRing(p, wedge.coords), `sampled ${p} outside the ring it was meant to read`);
  }
  return true;
});

console.log('\ngrounding harvest — relationships, not colours\n');

await check('class lightness is stated relative to the World, not in absolute L*', () => {
  const rec = harvestSynth();
  const sum = Object.values(rec.classes).reduce((s, c) => s + c.sampleShare * c.lightness, 0);
  assert.ok(Math.abs(sum) < 1e-6, `share-weighted lightness is ${sum}, so it is absolute, not relative`);
  const shares = Object.values(rec.classes).reduce((s, c) => s + c.sampleShare, 0);
  assert.ok(Math.abs(shares - 1) < 1e-6, `shares sum to ${shares}`);
  return true;
});

await check('the World\'s real ordering and contrast survive the harvest', () => {
  const rec = harvestSynth();
  const order = rec.order.lightness;
  assert.ok(order.indexOf('grass') < order.indexOf('lot'), 'this park\'s lawn is darker than its lot');
  assert.ok(order.indexOf('road') < order.indexOf('grass'), 'and its asphalt is darker than its lawn');
  const pair = rec.contrasts.find((c) => c.a === 'grass' && c.b === 'lot');
  const painted = deltaE(hexToRgb(GRASS_PAINT), hexToRgb(LOT_PAINT));
  assert.ok(Math.abs(pair.deltaE - painted) < 1, `harvested ΔE ${pair.deltaE} ≠ painted ${painted}`);
  return true;
});

await check('roofs that really do differ split into groups, ranked along the axis they differ on', () => {
  const rec = harvestSynth();
  const structure = rec.groups.structure;
  assert.equal(structure.axis, 'warmth', 'blue-vs-beige is a warmth split, not a lightness one');
  assert.equal(structure.groups.length, 2, 'two roof families, two groups');
  const blueKeys = ROOF_RINGS.slice(0, 2).map(footprintKey).sort();
  const beigeKeys = ROOF_RINGS.slice(2).map(footprintKey).sort();
  assert.deepEqual([...structure.groups[0].members].sort(), blueKeys, 'rank 0 is the coolest group');
  assert.deepEqual([...structure.groups[1].members].sort(), beigeKeys);
  assert.ok(structure.groups[0].warmth < structure.groups[1].warmth);
  assert.equal(structure.groups[0].observed, ROOF_BLUE, 'a group must show the colour it was measured from');
  assert.equal(structure.groups[1].observed, ROOF_BEIGE);
  return true;
});

await check('roofs that do not differ are not split — the harvest invents no distinctions', () => {
  const rec = harvestSynth([ROOF_BEIGE, ROOF_BEIGE, ROOF_BEIGE, ROOF_BEIGE]);
  assert.equal(rec.groups.structure.groups.length, 1, 'one colour is one group');
  assert.equal(rec.groups.structure.groups[0].members.length, 4);
  const only = rec.groups.structure.groups[0];
  assert.equal(only.warmth, rec.classes.structure.warmth, 'one group is the class itself, not a sub-claim');
  assert.equal(only.sampleShare, 1);
  return true;
});

await check('a class that shades continuously still splits — real roofs leave no gaps', () => {
  // Measured at kings-island: 266 roofs spanning 43 L* points between the 5th
  // and 95th percentile, and not one gap of 8 anywhere in it. A splitter that
  // only cuts at holes calls that one roof family, which is the opposite of
  // what a guest sees.
  const ramp = ['#5A5A5A', '#646464', '#6E6E6E', '#7A7A7A', '#828282', '#909090'];
  const structure = harvestRoofs(ramp).groups.structure;
  assert.equal(structure.axis, 'lightness');
  assert.ok(structure.groups.length >= 2, `a 21-point lightness range came back as ${structure.groups.length} group(s)`);
  for (let i = 1; i < structure.groups.length; i += 1) {
    assert.ok(structure.groups[i - 1].lightness < structure.groups[i].lightness, 'groups rank along their axis');
  }
  assert.equal(structure.groups.flatMap((g) => g.members).length, ramp.length, 'every roof lands in one group');
  return true;
});

await check('one freak roof does not decide which axis a park varies on', () => {
  // Ten blue roofs, ten beige, and one nearly black. Widest-minus-narrowest
  // says this park's roofs vary by lightness, on the strength of a single
  // building; the park's own eye says blue against beige.
  const roofs = [...Array(10).fill(ROOF_BLUE), ...Array(10).fill(ROOF_BEIGE), '#101010'];
  const structure = harvestRoofs(roofs).groups.structure;
  assert.equal(structure.axis, 'warmth', 'the outlier captured the axis');
  assert.equal(structure.groups.length, 2);
  return true;
});

await check('a lone outlier cannot buy one of the Skin\'s slots', () => {
  const roofs = [...Array(24).fill('#828282'), '#EFEFEF'];
  const structure = harvestRoofs(roofs).groups.structure;
  assert.equal(structure.groups.length, 1, 'one roof in twenty-five is not a roof family');
  assert.equal(structure.groups[0].members.length, 25);
  return true;
});

await check('never more groups than a Skin has slots to spend on them', () => {
  assert.equal(MAX_GROUPS, 3);
  const paints = ['#8FA8C8', '#C8B896', '#4E7A3C', '#EFEFEF'];
  const rec = harvestSynth(paints);
  assert.ok(rec.groups.structure.groups.length <= MAX_GROUPS);
  const members = rec.groups.structure.groups.flatMap((g) => g.members);
  assert.equal(members.length, 4, 'every roof lands in exactly one group');
  assert.equal(new Set(members).size, 4);
  return true;
});

await check('a footprint keys to itself and to nothing else, run after run', () => {
  assert.equal(footprintKey(ROOF_RINGS[0]), footprintKey(ROOF_RINGS[0].map((p) => [...p])));
  assert.notEqual(footprintKey(ROOF_RINGS[0]), footprintKey(ROOF_RINGS[1]));
  assert.match(footprintKey(ROOF_RINGS[0]), /^[0-9a-f]{8,}$/);
  const a = harvestSynth().groups.structure.groups[0].members;
  const b = harvestSynth().groups.structure.groups[0].members;
  assert.deepEqual(a, b, 'two harvests of one World must agree on which roof is which');
  return true;
});

console.log('\nthe raster probe\n');

await check('the probe reads the pixel the item\'s own affine names, not a bbox guess', () => {
  const item = {
    id: 'synth',
    properties: { 'proj:shape': [200, 200] },
    geometry: {
      coordinates: [[
        [-84.2800, 39.3520], [-84.2560, 39.3560], [-84.2520, 39.3320], [-84.2760, 39.3280],
      ]],
    },
  };
  const window = { left: 40, top: 30, width: 64, height: 48 };
  const bands = [0, 1, 2].map((b) => Uint8Array.from(
    { length: window.width * window.height }, (_, i) => (i * 7 + b * 29) % 251,
  ));
  const probe = naipProbe({ item, window, bands });
  const { toPixel } = geographicToPixel(item);
  const [lng, lat] = [-84.2740, 39.34872];
  const [px, py] = toPixel(lng, lat).map(Math.floor);
  const idx = (py - window.top) * window.width + (px - window.left);
  assert.ok(idx >= 0 && idx < bands[0].length, 'the fixture point must land inside the window');
  assert.deepEqual(probe.at(lng, lat), [bands[0][idx], bands[1][idx], bands[2][idx]]);
  return true;
});

await check('ground the window does not cover reads as nothing, not as a colour', () => {
  const item = {
    id: 'synth',
    properties: { 'proj:shape': [200, 200] },
    geometry: {
      coordinates: [[
        [-84.2800, 39.3520], [-84.2560, 39.3560], [-84.2520, 39.3320], [-84.2760, 39.3280],
      ]],
    },
  };
  const window = { left: 40, top: 30, width: 8, height: 8 };
  const bands = [0, 1, 2].map(() => new Uint8Array(64).fill(9));
  const probe = naipProbe({ item, window, bands });
  assert.deepEqual(probe.at(-84.2740, 39.34872), [9, 9, 9], 'ground the window does cover must read');
  assert.equal(probe.at(-84.2790, 39.3510), null);
  return true;
});

await check('every usable frame is offered, best first — the best one is sometimes empty', () => {
  // big-kahunas' newest NAIP frame is nodata over the whole park while the
  // 2019 one reads fine. Coverage-then-recency picks the dead one, so a
  // harvest needs the rest of the shelf, not just the top of it.
  const ring = [[-84.2800, 39.3520], [-84.2560, 39.3560], [-84.2520, 39.3320], [-84.2760, 39.3280]];
  const frame = (id, datetime, over = {}) => ({
    id,
    properties: { 'proj:shape': [200, 200], datetime },
    geometry: { coordinates: [over.ring || ring] },
    assets: over.assets === null ? {} : { image: { href: `https://example.invalid/${id}.tif` } },
  });
  const elsewhere = [[10.0, 10.0], [10.1, 10.0], [10.1, 9.9], [10.0, 9.9]];
  const items = [
    frame('old', '2020-01-01T00:00:00Z'),
    frame('hrefless', '2026-01-01T00:00:00Z', { assets: null }),
    frame('newest', '2024-01-01T00:00:00Z'),
    frame('faraway', '2025-01-01T00:00:00Z', { ring: elsewhere }),
  ];
  const bounds = { north: 39.3487, south: 39.3420, east: -84.2660, west: -84.2740 };
  assert.deepEqual(rankItems(items, bounds).map((r) => r.item.id), ['newest', 'old']);
  assert.equal(pickItem(items, bounds).item.id, 'newest', 'pickItem is the head of the same ranking');
  assert.equal(pickItem([], bounds), null);
  return true;
});

await check('nodata reads as nothing, not as black ground', () => {
  // A NAIP quarter-quad is rotated in WGS84, so the axis-aligned image has
  // zero-filled corners. A venue can sit inside the footprint — `complete` and
  // all — and still land in that collar. Measured: big-kahunas' best-covering
  // frame is nodata over the whole park. Black is not a colour aerial imagery
  // has; at 8 bits it is the absence of a reading.
  const item = {
    id: 'synth',
    properties: { 'proj:shape': [200, 200] },
    geometry: {
      coordinates: [[
        [-84.2800, 39.3520], [-84.2560, 39.3560], [-84.2520, 39.3320], [-84.2760, 39.3280],
      ]],
    },
  };
  const window = { left: 40, top: 30, width: 8, height: 8 };
  const dark = [0, 1, 2, 3].map(() => new Uint8Array(64));
  assert.equal(naipProbe({ item, window, bands: dark }).at(-84.2740, 39.34872), null);
  // One non-zero channel *of the three read* is a reading — very dark ground
  // is still ground.
  const lit = dark.map((b, c) => (c === 1 ? new Uint8Array(64).fill(3) : b));
  assert.deepEqual(naipProbe({ item, window, bands: lit }).at(-84.2740, 39.34872), [0, 3, 0]);
  // NAIP ships four bands and this probe returns three. Vegetation is bright
  // in NIR and can be dark in RGB, so a guard spanning all four bands lets
  // R=G=B=0 through as [0, 0, 0] the moment NIR is lit — pure black handed to
  // the harvest as a genuine reading. The guard must span what is returned.
  const nir = dark.map((b, c) => (c === 3 ? new Uint8Array(64).fill(120) : b));
  assert.equal(
    naipProbe({ item, window, bands: nir }).at(-84.2740, 39.34872),
    null,
    'RGB nodata with NIR lit read back as black ground',
  );
  return true;
});

await check('a frame that distinguishes nothing is refused, not shipped as grounding', () => {
  const flat = { at: () => [0, 0, 0] };
  assert.throws(
    () => harvestGrounding({
      venue: 'synth-park', regions: regionsFromMap(SYNTH_MAP), probe: flat, provenance: NAIP_PIN,
    }),
    /told this harvest nothing|no usable ground/i,
  );
  assert.throws(
    () => harvestGrounding({
      venue: 'synth-park', regions: regionsFromMap(SYNTH_MAP), probe: { at: () => null }, provenance: NAIP_PIN,
    }),
    /no usable ground/i,
  );
  return true;
});

console.log('\nthe grounding section of a reference profile\n');

await check('a World with no grounding harvested still reads clean', () => {
  assert.match(groundingFile('kings-island'), /kings-island[/\\]display[/\\]grounding\.json$/);
  assert.equal(readVenueGrounding('no-such-venue'), null);
  return true;
});

await check('validation refuses a record that is not grounding', () => {
  const good = harvestSynth();
  assert.deepEqual(validateGrounding(good), [], 'a harvested record must validate');
  const clone = () => JSON.parse(JSON.stringify(good));
  let bad = clone();
  bad.bands = ['overview', 'mid', 'close'];
  assert.ok(validateGrounding(bad).some((p) => /close/.test(p)), 'close band must be refused');
  bad = clone();
  bad.source.license = 'all-rights-reserved';
  assert.ok(validateGrounding(bad).some((p) => /licen/i.test(p)));
  bad = clone();
  bad.classes.lava = { share: 0.1, samples: 4, lightness: 0, redness: 0, warmth: 0 };
  assert.ok(validateGrounding(bad).some((p) => /unknown grounding class/.test(p)));
  bad = clone();
  bad.groups.structure.groups[0].members = [];
  assert.ok(validateGrounding(bad).some((p) => /no members/.test(p)));
  bad = clone();
  bad.source.sha256 = null;
  assert.ok(validateGrounding(bad).some((p) => /sha256/i.test(p)));
  // A footprint in two groups is a roof that is its own two roof families.
  // `regionsFromMap` dedupes so a fresh harvest cannot produce one, but a
  // record on disk outlives the run that made it and this is the shape a
  // hand-edit or an older harvest leaves behind.
  bad = clone();
  const twoGroups = { ...bad.groups.structure };
  twoGroups.groups = [
    { rank: 0, sampleShare: 0.5, samples: 1, lightness: 0, redness: 0, warmth: 0, observed: '#111111', members: ['abc123abc123'] },
    { rank: 1, sampleShare: 0.5, samples: 1, lightness: 9, redness: 0, warmth: 0, observed: '#222222', members: ['abc123abc123'] },
  ];
  bad.groups.structure = twoGroups;
  assert.ok(validateGrounding(bad).some((p) => /is in two groups/.test(p)));
  return true;
});

await check('validation re-checks the two walls a record on disk can outlive', () => {
  // `harvestGrounding` refuses both of these on the way in. The on-disk gate
  // has to refuse them too: a hand-edit, a truncated write or an older
  // harvest can put either shape on disk long after that run is gone.
  const good = harvestSynth();
  const clone = () => JSON.parse(JSON.stringify(good));
  let bad = clone();
  bad.classes = {};
  bad.groups = {};
  assert.ok(
    validateGrounding(bad).some((p) => /no usable ground/i.test(p)),
    'a record that measured nothing validated',
  );
  // big-kahunas' newest NAIP quarter-quad is nodata over the whole park: six
  // classes of pure black, every relationship zero. It validated against every
  // other wall in the file and would have grounded every Skin in nothing.
  bad = clone();
  for (const row of Object.values(bad.classes)) {
    Object.assign(row, { lightness: 0, redness: 0, warmth: 0, observed: '#000000' });
  }
  bad.contrasts = [];
  assert.ok(
    validateGrounding(bad).some((p) => /told the harvest nothing/i.test(p)),
    'a record of classes that all read the same validated',
  );
  return true;
});

await check('re-expression refuses an out-of-vocabulary split axis', () => {
  // `axisValue` reads Lab at `AXES.indexOf(axis)`; an unknown axis indexes at
  // -1, every comparison is NaN, and the Skin's roof colours land on the
  // park's roof families in arbitrary order. groundKit is callable on a record
  // that never went through validateGrounding, so it has to refuse this itself.
  const grounding = harvestSynth();
  grounding.groups.structure.axis = 'chroma';
  assert.throws(
    () => groundKit({ kit: readKit('rpg-overworld'), grounding }),
    /unknown axis "chroma"/,
    'an unknown split axis was re-expressed instead of refused',
  );
  return true;
});

await check('re-expression assigns the Skin\'s own colours and never a harvested one', () => {
  const kit = readKit('rpg-overworld');
  const grounded = groundKit({ kit, grounding: harvestSynth() });
  const declared = new Set(kit.sprites.building.roofs);
  const assigned = grounded.grounding.slots.structure.groups.map((g) => g.color);
  assert.ok(assigned.length > 0, 'nothing was assigned at all');
  for (const color of assigned) assert.ok(declared.has(color), `${color} is not a colour this Skin declares`);
  const flat = JSON.stringify(grounded.grounding);
  for (const paint of [ROOF_BLUE, ROOF_BEIGE, GRASS_PAINT, LOT_PAINT]) {
    assert.ok(!flat.includes(paint), `the harvested colour ${paint} reached the Skin`);
  }
  return true;
});

await check('the venue owns relationships: two Skins group the same roofs the same way', () => {
  const grounding = harvestSynth();
  const a = groundKit({ kit: readKit('rpg-overworld'), grounding }).grounding.slots.structure;
  const b = groundKit({ kit: readKit('island-brochure'), grounding }).grounding.slots.structure;
  assert.deepEqual(
    a.groups.map((g) => [...g.members].sort()),
    b.groups.map((g) => [...g.members].sort()),
    'the same park grouped differently by a change of Skin',
  );
  assert.notDeepEqual(a.groups.map((g) => g.color), b.groups.map((g) => g.color));
  const warmth = (hex) => rgbToLab(hexToRgb(hex))[2];
  for (const [kitId, slots] of [['rpg-overworld', a], ['island-brochure', b]]) {
    assert.ok(
      warmth(slots.groups[0].color) < warmth(slots.groups[1].color),
      `${kitId} paints this park's cooler roofs in its warmer slot — the relationship did not survive`,
    );
  }
  return true;
});

await check('the Skin owns treatment: two Worlds spend the same palette', () => {
  const kit = readKit('rpg-overworld');
  const one = harvestSynth([ROOF_BLUE, ROOF_BLUE, ROOF_BEIGE, ROOF_BEIGE]);
  const other = harvestSynth([ROOF_BEIGE, ROOF_BLUE, ROOF_BEIGE, ROOF_BLUE]);
  const a = groundKit({ kit, grounding: one }).grounding.slots.structure;
  const b = groundKit({ kit, grounding: other }).grounding.slots.structure;
  assert.deepEqual(a.groups.map((g) => g.color), b.groups.map((g) => g.color), 'the palette moved with the park');
  assert.notDeepEqual(
    a.groups.map((g) => [...g.members].sort()),
    b.groups.map((g) => [...g.members].sort()),
    'a different park grouped identically',
  );
  return true;
});

await check('a Skin with no roofs to spend is grounded without inventing any', () => {
  const kit = readKit('blueprint-survey');
  assert.equal(kit.sprites?.building?.roofs, undefined, 'blueprint-survey is the linework case');
  const grounded = groundKit({ kit, grounding: harvestSynth() });
  assert.equal(grounded.grounding.venue, 'synth-park', 'the World is still grounded');
  assert.ok(grounded.grounding.disagreements.length >= 0);
  assert.deepEqual(grounded.grounding.slots.structure, undefined, 'but no roof slot was invented for it');
  return true;
});

await check('re-expression refuses the close band', () => {
  assert.throws(
    () => groundKit({ kit: readKit('rpg-overworld'), grounding: harvestSynth(), band: 'close' }),
    /close/,
  );
  return true;
});

await check('where a Skin inverts the World\'s real ordering, that is disclosed, not overridden', () => {
  const grounding = harvestSynth();
  const rpg = readKit('rpg-overworld');
  const inverted = groundKit({ kit: rpg, grounding }).grounding.disagreements;
  const hit = inverted.find((d) => d.pair.join('/') === 'grass/lot');
  assert.ok(hit, 'rpg-overworld paints lawn lighter than lot; this park is the other way round');
  assert.equal(hit.axis, 'lightness');
  const atlas = groundKit({ kit: readKit('layered-atlas'), grounding }).grounding.disagreements;
  assert.ok(
    !atlas.some((d) => d.pair.join('/') === 'grass/lot'),
    'layered-atlas agrees with this park and must not be reported',
  );
  const grounded = groundKit({ kit: rpg, grounding });
  assert.equal(grounded.terrain.grass.base, rpg.terrain.grass.base, 'a disagreement must not repaint the Skin');
  assert.equal(grounded.terrain.lot.base, rpg.terrain.lot.base);
  return true;
});

await check('a grounded profile still carries its Skin whole', () => {
  const kit = readKit('rpg-overworld');
  const grounded = groundKit({ kit, grounding: harvestSynth() });
  const { grounding: _dropped, ...rest } = grounded;
  assert.deepEqual(rest, kit, 'grounding must add a section, never edit the Skin');
  assert.equal(grounded.grounding.band, 'mid');
  assert.equal(grounded.grounding.venue, 'synth-park');
  assert.equal(grounded.grounding.source.tile, NAIP_PIN.tile);
  assert.ok(
    grounded.grounding.review.some((r) => /roof/i.test(r.prompt)),
    'the split the harvest found must reach the reviewer as a question',
  );
  return true;
});

console.log('\ncommitted grounding records\n');

await check('every committed record validates and still matches the truth it was measured on', () => {
  const dir = new URL('../../packages/venue-builder/data/venues/', import.meta.url);
  const venues = readdirSync(dir).filter(
    (v) => existsSync(new URL(`${v}/display/grounding.json`, dir)),
  );
  assert.ok(venues.length >= 1, 'no World has been grounded yet');
  for (const venue of venues) {
    const record = JSON.parse(readFileSync(new URL(`${venue}/display/grounding.json`, dir), 'utf8'));
    assert.deepEqual(validateGrounding(record), [], `${venue}: committed grounding does not validate`);
    assert.equal(record.venue, venue, `${venue}: record names a different World`);

    // Grounding is keyed to footprints. If truth moved, the record is stale —
    // a Skin would paint a roof family that is no longer there.
    const map = JSON.parse(readFileSync(
      new URL(`../../apps/party-tracker/public/venues/${venue}.map.json`, import.meta.url), 'utf8',
    ));
    const live = new Set(regionsFromMap(map).map((r) => r.key));
    for (const [cls, block] of Object.entries(record.groups)) {
      for (const group of block.groups) {
        for (const key of group.members) {
          assert.ok(live.has(key), `${venue}: ${cls} member ${key} is no longer in this World's truth`);
        }
      }
    }
  }
  return true;
});

await check('every committed record re-expresses in every shipped Skin', () => {
  const dir = new URL('../../packages/venue-builder/data/venues/', import.meta.url);
  const kitsDir = new URL('../../packages/venue-builder/data/display/kits/', import.meta.url);
  const kits = readdirSync(kitsDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  let grounded = 0;
  for (const venue of readdirSync(dir)) {
    const file = new URL(`${venue}/display/grounding.json`, dir);
    if (!existsSync(file)) continue;
    const grounding = JSON.parse(readFileSync(file, 'utf8'));
    for (const kitId of kits) {
      const kit = readKit(kitId);
      const out = groundKit({ kit, grounding });
      const declared = new Set(kit.sprites?.building?.roofs || []);
      for (const group of out.grounding.slots.structure?.groups || []) {
        assert.ok(declared.has(group.color), `${venue} x ${kitId}: ${group.color} is not this Skin's`);
      }
      grounded += 1;
    }
  }
  assert.ok(grounded >= kits.length, 'no World x Skin pair was actually resolved');
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
