/**
 * Display factory — per-Skin visual specs and the display-certify gate.
 *
 * Truth (`map.json` / `pois.json`) is immutable input. This module compiles
 * a visual spec per Skin — surface → material bindings, land tones, tokens —
 * and certifies it. Skins restyle, never reposition: a spec carries no
 * coordinates and no clock, so a no-op rerun is byte-identical and the
 * certification proves the rule rather than promising it.
 *
 * Ledgers (committed, hand-reviewed — the writeback targets):
 *   data/display/materials.json  MaterialSet rows: license + provenance
 *   data/display/skins.json      SkinTemplate rows: surface bindings + tokens
 *
 * Design doc: docs/research/2026-08-18-custom-map-display-factory.md
 */

import path from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { MONO_ROOT, OVERRIDE_DIR, VENUE_DIR, readJson, writeJson, venueSidecar } from './venue-io.mjs';
import { readTruth } from './map-factory/map-io.mjs';
import { buildTiles } from './display-tiles.mjs';
import { buildWorldTier } from './display-world.mjs';
import { buildPyramid, pyramidFile } from './display-pyramid.mjs';
import { materialTexturesRow, verifyCompiledMaterials } from './display-materials.mjs';
import { crossRotationCoverageRow } from './display-style-contract.mjs';
import { writeBundleManifest } from './venue-bundle.mjs';
import { check } from './evidence.mjs';

export const DISPLAY_VERSION = 1;

/** Licenses a shipped material may carry. AGPL and unknown stay rejected. */
export const ALLOWED_LICENSES = ['CC0-1.0', 'original', 'licensed'];

/**
 * Surface classes — the display ontology. Each class claims map layers;
 * `lands` is deliberately absent (district washes are land tones, not
 * materials) and every claimed layer belongs to exactly one class.
 */
export const SURFACE_CLASSES = {
  walkway: { label: 'Walkways', layers: ['path'], token: 'path' },
  'service-road': { label: 'Service roads', layers: ['service'], token: 'path' },
  water: { label: 'Water', layers: ['water', 'sea'], token: 'water' },
  pool: { label: 'Pools', layers: ['pool'], token: 'water' },
  vegetation: { label: 'Vegetation', layers: ['grass', 'wood', 'park'], token: 'grass' },
  lot: { label: 'Parking lots', layers: ['parking'], token: 'building' },
  structure: { label: 'Structures', layers: ['building'], token: 'building' },
  'coaster-track': { label: 'Coaster track', layers: ['coaster'], token: 'label' },
  slide: { label: 'Slides', layers: ['slide'], token: 'path' },
};

/**
 * How far a surface is pulled from the skin's authored colour toward its
 * material's measured average. 0 keeps the skin exactly as authored; 1 paints
 * the photograph. Leaning low on purpose: a material average is what the stuff
 * really looks like, and four skins that all borrow it stop being four skins.
 */
export const DEFAULT_MATERIAL_MIX = 0.4;

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** #rrggbb → [r,g,b], or null for anything else (named colours, rgba()). */
function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Blend two hex colours. Returns `a` unchanged when either side is not a plain
 * hex, so a skin using an rgba() token degrades to its authored value.
 * @param {string} a
 * @param {string} b
 * @param {number} t 0 = all `a`, 1 = all `b`
 * @returns {string}
 */
export function mixHex(a, b, t) {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const out = ca.map((v, i) => clamp255(v + (cb[i] - v) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

const DISPLAY_DATA_DIR = path.join(OVERRIDE_DIR, '..', 'display');

/** MaterialSet ledger, keyed by `<family>--<variant>`. */
export function readMaterials() {
  return readJson(path.join(DISPLAY_DATA_DIR, 'materials.json'), { materials: {} }).materials;
}

/** SkinTemplate ledger, keyed by Skin id (ids match `world.js`). */
export function readSkinTemplates() {
  const skins = readJson(path.join(DISPLAY_DATA_DIR, 'skins.json'), { skins: {} }).skins;
  for (const [id, skin] of Object.entries(skins)) skin.id = id;
  return skins;
}

/**
 * Kit id → the iso recipe the Skin bound to that kit declared.
 *
 * `isoTemplate` sat on every skins.json row with no reader for its whole
 * life: the bake took its recipe from `display-iso.mjs`'s own default chain,
 * so layered-atlas asked for `frisco-fields` and silently got `rct-classic`
 * geometry. A declaration nothing reads is worse than no declaration, so the
 * bake reads it here — and an id no recipe answers to throws, because the
 * shared renderer's tolerant fallback (`resolveIsoMapTemplate`) is the right
 * behaviour for a phone handed an unknown Skin and the wrong behaviour for a
 * committed ledger row.
 *
 * @param {object} templates the SkinTemplate ledger
 * @param {string} kitId
 * @param {object} recipes registered iso recipes, keyed by id (ISO_MAP_TEMPLATES)
 * @returns {string|null} the declared recipe id, or null when no Skin binds the kit
 */
export function isoTemplateForKit(templates, kitId, recipes) {
  const known = new Set(Object.keys(recipes || {}));
  for (const skinId of Object.keys(templates).sort()) {
    const skin = templates[skinId];
    if (skin.bakeKit !== kitId || !skin.isoTemplate) continue;
    if (!known.has(skin.isoTemplate)) {
      throw new Error(
        `Skin "${skinId}" declares iso template "${skin.isoTemplate}", which is not a registered recipe `
        + `(known: ${[...known].sort().join(', ')})`,
      );
    }
    return skin.isoTemplate;
  }
  return null;
}

/**
 * ESA WorldCover class → the relationship a Zone has with the ground.
 *
 * The land-cover analogue of SURFACE_CLASSES, and deliberately hex-free: a
 * row says what a Zone IS — the ledger material a guest actually stands on
 * there, and the surface class whose token the Skin already owns — never
 * what colour it should be. Treatment is the Skin's (ADR-0020 grounding
 * rule: design owns treatment, the venue owns relationships).
 *
 * Classes with no real analogue among shipped materials (bare/sparse,
 * snow/ice, cropland, …) are deliberately absent — an unmapped class
 * invents no tone, see `zoneToneTable`.
 */
export const LAND_COVER_STYLE = {
  built_up: { material: 'roofing--shingle', surface: 'structure' },
  tree_cover: { material: 'grass--meadow', surface: 'vegetation' },
  grassland: { material: 'grass--meadow', surface: 'vegetation' },
  permanent_water: { material: 'water--calm', surface: 'water' },
};

/**
 * Zone character — the second relationship a World may state about a Zone,
 * beside its land cover: what the place is *about*. Rivertown is the wooded
 * one, Soak City is the water one, Action Zone is the steel one.
 *
 * A character never carries a colour. It names one of the Skin's OWN palette
 * tokens for that Zone to lean toward, so the same relationship reads as a
 * pale wash under Trail, a deep one under Park Midnight, and a saturated
 * plate under Layered atlas. This is where hand-picked per-park tints go
 * after they stop being treatment in truth: as the relationship they always
 * really encoded.
 *
 * Closed vocabulary on purpose — an unknown character is a loud failure at
 * the grounding seam, never a silent no-op.
 */
export const LAND_CHARACTERS = {
  woodland: { token: 'grass' },
  water: { token: 'water' },
  steel: { token: 'structureEdge' },
  midway: { token: 'path' },
  built: { token: 'building' },
  civic: { token: 'label' },
  open: { token: 'ground' },
};

/**
 * The Skin's Zone-wash recipe, declared under `tokens.landTones`.
 *
 *   cover   how far a Zone's wash travels from this Skin's own ground toward
 *           what its land cover looks like here
 *   lean    how far it then leans toward the token its character names
 *   spread  how far the ramp separating same-character Zones may travel
 *   steps   how many rungs that ramp has — what makes the emittable palette
 *           finite, and therefore checkable (see `allowedLandTones`)
 *
 * All four are treatment, so all four belong to the Skin. The defaults are
 * deliberately timid: a ledger row that says nothing still gets Zones a guest
 * can tell apart, and says so quietly.
 */
export const DEFAULT_LAND_TONES = { cover: 0.25, lean: 0, spread: 0.08, steps: 5 };

/** How far a Zone's stroke is pulled from its fill toward the Skin's edge ink. */
export const ZONE_EDGE_MIX = 0.35;

/** The Skin's declared Zone-tone ramp, clamped to a sane, finite envelope. */
export function landToneRamp(template) {
  const d = template?.tokens?.landTones || {};
  const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
  const unit = (v, fallback) => Math.max(0, Math.min(0.9, num(v, fallback)));
  return {
    cover: unit(d.cover, DEFAULT_LAND_TONES.cover),
    lean: unit(d.lean, DEFAULT_LAND_TONES.lean),
    spread: Math.max(0, Math.min(0.5, num(d.spread, DEFAULT_LAND_TONES.spread))),
    steps: Math.max(1, Math.min(9, Math.round(num(d.steps, DEFAULT_LAND_TONES.steps)))),
  };
}

/** Mix toward white (positive) or black (negative) — the ramp's one move. */
function shadeHex(hex, delta) {
  if (!delta) return hex;
  return delta > 0 ? mixHex(hex, '#FFFFFF', delta) : mixHex(hex, '#000000', -delta);
}

/** Rung `step` of a `steps`-rung ramp, as a signed fraction of `spread`. */
function rampDelta(step, { spread, steps }) {
  if (steps <= 1 || !spread) return 0;
  return spread * ((2 * step) / (steps - 1) - 1);
}

/** A Skin token, with the label ink as the one always-present fallback. */
const tokenColor = (template, token) => template?.tokens?.colors?.[token]
  ?? template?.tokens?.colors?.label
  ?? null;

/**
 * One Zone tone, entirely from this Skin's own palette.
 *
 * A Zone wash is ground — the paper the whole map is drawn on — so it starts
 * at this Skin's `ground` token and never at the token for whatever is built
 * on top. From there:
 *
 * cover  toward what this Zone's land cover looks like in this Skin: the
 *        Skin's token for that surface class, pulled toward the bound
 *        material's measured average by exactly the mix surfaces already use
 * lean   toward the Skin's token for the Zone's declared character
 * step   a rung on the Skin's declared ramp, so Zones that share a class and
 *        a character still read apart
 *
 * Returns null when the World says nothing about this Zone — the renderer's
 * deterministic name-hue takes over, which is what an un-harvested World is
 * supposed to look like.
 */
function zoneTone({ template, materials, cover, character, step, ramp }) {
  const ground = tokenColor(template, 'ground');
  if (!ground) return null;
  const style = cover ? LAND_COVER_STYLE[cover] : null;
  let base = null;
  if (style && materials[style.material]) {
    const authored = tokenColor(template, SURFACE_CLASSES[style.surface]?.token);
    const avg = materials[style.material].avgColor;
    const mix = template.materialMix ?? DEFAULT_MATERIAL_MIX;
    const coverColor = authored && avg ? mixHex(authored, avg, mix) : authored;
    base = coverColor ? mixHex(ground, coverColor, ramp.cover) : ground;
  } else if (character) {
    // No usable cover class, but the World still stated what this Zone is
    // about: the Skin's own ground is the honest base to lean off.
    base = ground;
  }
  if (!base) return null;
  const leanToken = character ? LAND_CHARACTERS[character]?.token : null;
  const leaned = leanToken && ramp.lean
    ? mixHex(base, tokenColor(template, leanToken), ramp.lean)
    : base;
  const fill = shadeHex(leaned, rampDelta(step, ramp));
  const edge = template?.tokens?.colors?.groundEdge
    ?? template?.tokens?.colors?.structureEdge
    ?? template?.tokens?.colors?.label;
  return {
    fill,
    stroke: edge ? mixHex(fill, edge, ZONE_EDGE_MIX) : fill,
    label: template?.tokens?.colors?.label || fill,
  };
}

/**
 * Pure: (World relationships × Skin palette) → one tone per Zone.
 *
 * The World contributes which Zones group together (same cover class, same
 * declared character) and which of a group is the biggest — WorldCover's own
 * sample `count`, with the Zone name as the tie-break so the answer never
 * depends on object order. The Skin contributes every colour and the size of
 * the visual gap between neighbours. Neither invents a Zone the other did
 * not name.
 *
 * @param {{ landCover?: object, grounding?: object, materials: object, template: object }} deps
 * @returns {Record<string, {fill: string, stroke: string, label: string}>}
 */
export function zoneToneTable({ landCover, grounding, materials, template }) {
  const ramp = landToneRamp(template);
  const zones = grounding?.zones || {};
  const names = [...new Set([...Object.keys(landCover || {}), ...Object.keys(zones)])].sort();
  const rows = names.map((name) => ({
    name,
    cover: LAND_COVER_STYLE[landCover?.[name]?.name] ? landCover[name].name : null,
    character: LAND_CHARACTERS[zones[name]?.character] ? zones[name].character : null,
    count: Number.isFinite(landCover?.[name]?.count) ? landCover[name].count : 0,
  }));
  // Rank inside the bucket that would otherwise collide: same cover class,
  // same character. Biggest Zone first, name as the deterministic tie-break.
  const buckets = new Map();
  for (const row of rows) {
    const key = `${row.cover || '-'}|${row.character || '-'}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  const stepOf = new Map();
  for (const bucket of buckets.values()) {
    const ordered = [...bucket].sort((a, b) => (b.count - a.count) || (a.name < b.name ? -1 : 1));
    for (let i = 0; i < ordered.length; i += 1) {
      const step = ordered.length > 1
        ? Math.round((i * (ramp.steps - 1)) / (ordered.length - 1))
        : Math.floor((ramp.steps - 1) / 2);
      stepOf.set(ordered[i].name, step);
    }
  }
  const tones = {};
  for (const row of rows) {
    const tone = zoneTone({
      template,
      materials,
      cover: row.cover,
      character: row.character,
      step: stepOf.get(row.name) || 0,
      ramp,
    });
    if (tone) tones[row.name] = tone;
  }
  return tones;
}

/**
 * Every colour this Skin can put on a Zone — the palette sibling of
 * `allowedCoordinates`.
 *
 * `allowedCoordinates` works because the set of positions a display file may
 * repeat is finite and published by truth. The same argument holds for
 * colour once a Skin's ramp has a declared number of rungs: cover classes ×
 * characters × rungs is a finite, enumerable palette, so "this hex came from
 * this Skin" stops being a promise and becomes a membership test. A hand hex
 * smuggled in from a World then fails exactly the way a smuggled coordinate
 * does.
 *
 * @param {object} template SkinTemplate row
 * @param {object} materials MaterialSet ledger
 * @returns {Set<string>} every fill, stroke and label the Skin can emit
 */
export function allowedLandTones(template, materials) {
  const ramp = landToneRamp(template);
  const allowed = new Set();
  const covers = [null, ...Object.keys(LAND_COVER_STYLE)];
  const characters = [null, ...Object.keys(LAND_CHARACTERS)];
  for (const cover of covers) {
    for (const character of characters) {
      for (let step = 0; step < ramp.steps; step += 1) {
        const tone = zoneTone({ template, materials, cover, character, step, ramp });
        if (!tone) continue;
        allowed.add(tone.fill);
        allowed.add(tone.stroke);
        allowed.add(tone.label);
      }
    }
  }
  return allowed;
}

/** Per-venue land-patch classification cache written by `venues:worldcover-lands`. */
export function readLandCover(id) {
  return readJson(venueSidecar(id, 'esa-worldcover-lands-cache.json'), { lands: {} }).lands;
}

/**
 * One World's grounding harvest — the Visual factory's per-World relationship
 * input (ADR-0020 clauses 1 and 4), living beside the WorldCover cache in the
 * World's own display pack rather than in `map.json`.
 *
 * It states what each Zone IS, never what colour it should be: this is where
 * a park's hand-tuned character goes once treatment leaves truth. An unknown
 * character throws here rather than resolving to nothing, so a typo in a
 * committed harvest is a build failure and not a Zone that quietly stops
 * looking like itself.
 */
export function readGrounding(id) {
  const file = path.join(venueSidecar(id, 'display'), 'grounding.json');
  const grounding = readJson(file, null);
  if (!grounding) return null;
  for (const [zone, row] of Object.entries(grounding.zones || {})) {
    if (row?.character && !LAND_CHARACTERS[row.character]) {
      throw new Error(
        `${id}: Zone "${zone}" declares unknown character "${row.character}" — `
        + `known: ${Object.keys(LAND_CHARACTERS).sort().join(', ')}`,
      );
    }
  }
  return grounding;
}

/**
 * Compile one venue × Skin visual spec. Pure: no disk, no clock, no network.
 * Binds only surfaces whose layers the venue actually has.
 *
 * Zone tones are the Skin's, derived here and nowhere else. The World
 * contributes relationships only — ESA WorldCover classification
 * (`landCover`) and its grounding harvest (`grounding`, per-Zone character)
 * — and every colour comes out of `template.tokens`. `map.meta` contributes
 * nothing: truth carries geometry, Places and Gaps, never treatment. A Zone
 * the World says nothing about gets no tone at all and falls back to the
 * renderer's deterministic name-hue, same as before this existed.
 *
 * @param {{ map: object, pois: object[], template: object, materials: object,
 *           landCover?: object, grounding?: object }} deps
 */
export function compileVisualSpec({
  map, pois = [], template, materials, landCover, grounding = null, terrain = null,
}) {
  const surfaces = {};
  for (const [surface, materialId] of Object.entries(template.surfaces || {})) {
    const layers = (SURFACE_CLASSES[surface]?.layers || []).filter((l) => map[l]?.length);
    if (!layers.length) continue;
    if (!materials[materialId]) continue; // certification reports it; compile stays total
    // Pull the authored token toward the material's measured average, so the
    // ledger's textures actually reach the renderer instead of being metadata
    // a budget gate polices and nothing paints.
    const token = SURFACE_CLASSES[surface]?.token;
    const authored = template.tokens?.colors?.[token];
    const avg = materials[materialId].avgColor;
    const mix = template.materialMix ?? DEFAULT_MATERIAL_MIX;
    const color = authored && avg ? mixHex(authored, avg, mix) : authored || null;
    surfaces[surface] = { material: materialId, layers, ...(color ? { color } : {}) };
  }
  const mode = template.tokens?.mode === 'night' ? 'night' : 'day';
  return {
    version: DISPLAY_VERSION,
    venue: map.meta?.id,
    skin: template.id,
    basedOn: { map: map.meta?.generated || null },
    tokens: template.tokens || {},
    surfaces,
    // One half only: the half this Skin paints. A day Skin shipping a night
    // hex it can never draw was how every Skin came to emit the same block.
    landTones: Object.fromEntries(
      Object.entries(zoneToneTable({ landCover, grounding, materials, template }))
        .map(([zone, tone]) => [zone, { [mode]: tone }]),
    ),
    fallback: { landTone: 'name-hue' },
    ...(terrain ? { terrain } : {}),
  };
}

const line = (id, sourceLayer, color, width, opts = {}) => ({
  id,
  type: 'line',
  source: 'park',
  'source-layer': sourceLayer,
  paint: {
    'line-color': color,
    'line-width': ['interpolate', ['linear'], ['zoom'], 14, width, 18, width * 2.6],
    ...opts,
  },
});

const fill = (id, sourceLayer, color, opts = {}) => ({
  id,
  type: 'fill',
  source: 'park',
  'source-layer': sourceLayer,
  paint: { 'fill-color': color, ...opts },
});

/**
 * Compile a spec into a MapLibre style. Colors come from the Skin's tokens
 * (palettes harvested from `world.js` and PR #447's reference skins); Zone
 * washes come from the spec's own derived tones, matched by Zone name. The
 * style carries no coordinates — the renderer sets its own camera from truth.
 * Labels are deliberately absent: annotation is the phone's overlay layer.
 */
export function styleFromSpec(spec) {
  const c = spec.tokens?.colors || {};
  const mode = spec.tokens?.mode === 'night' ? 'night' : 'day';
  // Surfaces carry a material-blended colour; fall back to the raw token for
  // any layer no surface claims.
  const byLayer = new Map();
  for (const surface of Object.values(spec.surfaces || {})) {
    if (!surface.color) continue;
    for (const layer of surface.layers || []) byLayer.set(layer, surface.color);
  }
  const paintOf = (layer, fallback) => byLayer.get(layer) || fallback;
  // The overlay is placed by truth's own bounds — echoed, never invented.
  const hs = spec.terrain?.hillshade || null;
  const tb = spec.terrain?.bounds;
  const hsCoords = tb
    ? [[tb.west, tb.north], [tb.east, tb.north], [tb.east, tb.south], [tb.west, tb.south]]
    : null;
  const tones = Object.entries(spec.landTones || {})
    .filter(([, t]) => t[mode]?.fill)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const landFill = tones.length
    ? ['match', ['get', 'name'], ...tones.flatMap(([name, t]) => [name, t[mode].fill]), 'rgba(0,0,0,0)']
    : 'rgba(0,0,0,0)';
  return {
    version: 8,
    name: `${spec.venue} — ${spec.skin}`,
    sources: {
      park: { type: 'vector', url: 'pmtiles://base.pmtiles' },
      ...(hs ? { hillshade: { type: 'image', url: hs.file, coordinates: hsCoords } } : {}),
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': c.ground } },
      fill('sea-under', 'sea', paintOf('sea', c.water)),
      fill('venue', 'venue', c.ground),
      fill('park', 'park', paintOf('park', c.grass), { 'fill-opacity': 0.35 }),
      fill('lands', 'lands', landFill, { 'fill-opacity': 0.45 }),
      fill('grass', 'grass', paintOf('grass', c.grass)),
      fill('wood', 'wood', paintOf('wood', c.grass), { 'fill-opacity': 0.8 }),
      // Relief sits over the ground and under everything built on it.
      ...(hs ? [{ id: 'hillshade', type: 'raster', source: 'hillshade', paint: { 'raster-opacity': 0.45 } }] : []),
      fill('parking', 'parking', paintOf('parking', c.building), { 'fill-opacity': 0.6 }),
      fill('water', 'water', paintOf('water', c.water)),
      fill('pool', 'pool', paintOf('pool', c.water)),
      fill('building', 'building', paintOf('building', c.building)),
      line('building-edge', 'building', c.structureEdge || c.path, 0.6),
      line('service', 'service', paintOf('service', c.path), 0.8, { 'line-opacity': 0.55 }),
      line('path-casing', 'path', c.pathCasing || c.ground, 3),
      line('path', 'path', paintOf('path', c.path), 1.6),
      line('slide', 'slide', paintOf('slide', c.path), 1.2, { 'line-opacity': 0.9 }),
      line('coaster', 'coaster', paintOf('coaster', c.structureEdge || c.label), 1.2, { 'line-opacity': 0.85 }),
    ],
  };
}

/**
 * Fixed visual points, derived from truth — the builder-side harvest of
 * PR #447's 20-point matrix. Gates first, then district anchors, then the
 * first coasters; deterministic order, capped at twenty.
 */
export function anchorsFromTruth(map, pois = []) {
  const anchors = [];
  const byKey = (a, b) => ((a.i || a.n || '') < (b.i || b.n || '') ? -1 : 1);
  for (const p of pois.filter((x) => x.c === 'gate').sort(byKey)) {
    anchors.push({ id: `gate:${p.i}`, name: p.n, lat: p.lat, lng: p.lng });
  }
  for (const [name, at] of Object.entries(map.landAnchors || {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    anchors.push({ id: `land:${name}`, name, lat: at[0], lng: at[1] });
  }
  const rideable = pois.filter((x) => x.c === 'coaster' || x.c === 'ride').sort(byKey);
  for (const p of rideable.slice(0, 6)) {
    anchors.push({ id: `${p.c}:${p.i}`, name: p.n, lat: p.lat, lng: p.lng });
  }
  return anchors.slice(0, 20);
}

/**
 * Keys that can carry a position. Deliberately wider than lat/lng: a spec that
 * smuggled a `center` or a `bbox` past a three-name blacklist would move a map
 * just as effectively.
 */
const COORDINATE_KEYS = new Set([
  'lat', 'lng', 'lon', 'r', 'x', 'y', 'center', 'centre', 'at', 'anchor',
  'coordinates', 'bbox', 'bounds', 'north', 'south', 'east', 'west',
]);

function numericLeaves(value, out = []) {
  if (typeof value === 'number') out.push(value);
  else if (Array.isArray(value)) for (const v of value) numericLeaves(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) numericLeaves(v, out);
  return out;
}

/**
 * Find a coordinate the display layer invented.
 *
 * The rule is not "no coordinates" — terrain has to say which rectangle its
 * hillshade covers, and refusing that would just push the number somewhere
 * less honest. The rule is that every coordinate a display file carries must
 * be one truth already published. Echoing a bound is fine; nudging it by a
 * hair is exactly the failure this gate exists to catch.
 *
 * @param {unknown} value
 * @param {Set<number>} allowed truth-derived coordinate values
 * @param {string} [pathHint]
 * @returns {string|null} description of the first offender
 */
function findCoordinateKey(value, allowed = new Set(), pathHint = '') {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findCoordinateKey(value[i], allowed, `${pathHint}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      const here = pathHint ? `${pathHint}.${key}` : key;
      if (COORDINATE_KEYS.has(key)) {
        const strayed = numericLeaves(inner).find((n) => !allowed.has(n));
        if (strayed !== undefined) return `${here} = ${strayed}`;
        continue;
      }
      const hit = findCoordinateKey(inner, allowed, here);
      if (hit) return hit;
    }
  }
  return null;
}

/** The only coordinates a display file may repeat: the venue's own bounds. */
export function allowedCoordinates(map) {
  const b = map?.meta?.bounds || {};
  return new Set(
    [b.n ?? b.north, b.s ?? b.south, b.e ?? b.east, b.w ?? b.west].filter(Number.isFinite),
  );
}


const SPEC_BUDGET_BYTES = 64 * 1024;
const MATERIAL_BUDGET_PX = 1024;
const TILES_BUDGET_KB = 15 * 1024;

/**
 * Does a tiles result clear the gate?
 *
 * Exported because the gap-vs-failure distinction is the whole reason tiles can
 * default on, and a test that restates the rule locally proves nothing about
 * the rule the pack actually applies — it just drifts, budget constant and all.
 *
 * @param {{ ok?: boolean, gap?: boolean, sizeKb?: number }} tiles
 */
export const tilesGatePasses = (tiles) => Boolean(
  tiles.gap || (tiles.ok && tiles.sizeKb <= TILES_BUDGET_KB),
);

/** A pyramid result clears the gate when sharp is a recorded gap or the archive wrote. */
export const pyramidGatePasses = (pyramid) => Boolean(
  pyramid?.gap || pyramid?.ok,
);

/**
 * The crop window a pyramid may georeference against.
 *
 * ADR-0021 crop: the plan describes the World; the pyramid places the cropped
 * PNG against `cert.bounds`. A caller that hands map/plan bounds here is the
 * bug that decision named — refuse anything that is not the bake cert.
 *
 * @param {{ bounds?: { west: number, south: number, east: number, north: number } }|null} cert
 */
export function pyramidBoundsFromCert(cert) {
  const bounds = cert?.bounds;
  if (!bounds || typeof bounds !== 'object') {
    throw new Error('pyramid georeferences against cert.bounds — the plan does not place the crop');
  }
  for (const key of ['west', 'south', 'east', 'north']) {
    if (!Number.isFinite(bounds[key])) {
      throw new Error(`cert.bounds.${key} must be a finite number`);
    }
  }
  return {
    west: bounds.west,
    south: bounds.south,
    east: bounds.east,
    north: bounds.north,
  };
}

/**
 * Cut one band's baked PNG into a raster PMTiles archive.
 *
 * @param {{ id: string, bandId?: string, bakePng: string, cert: object, outDir: string }} deps
 */
export async function buildBandPyramidTier({
  id,
  bandId = 'mid',
  bakePng,
  cert,
  outDir,
} = {}) {
  return buildPyramid({
    id,
    bandId,
    bakePng,
    bounds: pyramidBoundsFromCert(cert),
    outDir,
  });
}

/**
 * Cut the packed mid band after a display stage, if a bake PNG and its cert
 * are both on disk. The stage itself stays sync (its tests and the pipeline
 * call it as a function); the CLI and the pipeline await this.
 *
 * @param {{ id: string, bakeCerts?: { kit: string, cert: object }[], bakeDir: string, outDir: string, primaryKit?: string|null }} deps
 */
export async function cutPackedMidPyramid({
  id,
  bakeCerts = [],
  bakeDir,
  outDir,
  primaryKit = null,
} = {}) {
  const row = bakeCerts.find((r) => r.kit === primaryKit) || bakeCerts[0];
  if (!row?.cert || !bakeDir) {
    return { gap: true, reason: 'no bake cert — run venues:bake first' };
  }
  const bakePng = path.join(bakeDir, `${id}--${row.kit}.png`);
  if (!existsSync(bakePng)) {
    return { gap: true, reason: 'mid bake PNG missing' };
  }
  return buildBandPyramidTier({ id, cert: row.cert, bakePng, outDir });
}

/**
 * Certify one compiled spec against truth, the template, and the ledger.
 * Pure — same claim/evidence/confidence/falsifier/so-what contract as
 * `venue-certify.mjs`. `textures` is verifyCompiledMaterials' report,
 * injected (disk truth stays the caller's job); absent, the row is absent
 * — runDisplayStage always injects it, so shipped packs always carry it.
 *
 * @param {{ spec: object, map: object, template: object, materials: object, textures?: object }} deps
 */
export function certifyDisplayPack({ spec, map, template, materials, textures = null }) {
  const checks = [];
  if (textures) checks.push(materialTexturesRow({ spec, report: textures }));

  const unresolved = Object.entries(spec.surfaces || {})
    .filter(([surface, row]) => !materials[row.material] || !SURFACE_CLASSES[surface])
    .map(([surface, row]) => `${surface}→${row.material}`);
  const templateUnbound = Object.entries(template.surfaces || {})
    .filter(([, materialId]) => !materials[materialId])
    .map(([surface, materialId]) => `${surface}→${materialId}`);
  const missing = [...new Set([...unresolved, ...templateUnbound])];
  checks.push(check({
    key: 'bindings_resolve',
    claim: 'every bound surface resolves to a ledger material',
    pass: missing.length === 0,
    evidence: missing.length ? `unresolved: ${missing.join(', ')}` : `${Object.keys(spec.surfaces || {}).length} bindings resolve`,
    confidence: 'high',
    falsifier: 'a binding names a material absent from data/display/materials.json',
    soWhat: 'an unresolved binding renders as a hole in the ground on every phone',
  }));

  const badLicense = Object.values(spec.surfaces || {})
    .map((row) => materials[row.material])
    .filter((m) => m && !ALLOWED_LICENSES.includes(m.license))
    .map((m) => `${m.label}: ${m.license}`);
  checks.push(check({
    key: 'license_gate',
    claim: 'every shipped material carries an allowed license with provenance',
    pass: badLicense.length === 0,
    evidence: badLicense.length ? badLicense.join('; ') : `licenses ⊆ {${ALLOWED_LICENSES.join(', ')}}`,
    confidence: 'high',
    falsifier: 'a ledger row carries a license outside the allowed set',
    soWhat: 'license before embed — an AGPL texture in the bundle is a shipping bug',
  }));

  const leaked = findCoordinateKey(spec, allowedCoordinates(map));
  checks.push(check({
    key: 'no_repositioning',
    claim: 'every coordinate in the spec is one truth already published — skins restyle, never reposition',
    pass: !leaked,
    evidence: leaked ? `spec coordinate not found in truth bounds: ${leaked}` : 'every coordinate in the spec matches a published bound',
    confidence: 'high',
    falsifier: 'a spec carries any position value the truth bounds do not already contain',
    soWhat: 'a display file that can move a Place breaks the truth/display split',
  }));

  // The palette sibling of no_repositioning. Same shape of argument, applied
  // to colour: every value the display layer carries must already be one its
  // own declared source publishes. A hex from a World's hand-tint table is
  // not on this Skin's ramp, so it fails here exactly as a nudged coordinate
  // fails above.
  const allowedTones = allowedLandTones(template, materials);
  const strayTone = Object.entries(spec.landTones || {}).flatMap(([zone, byMode]) => Object
    .entries(byMode || {})
    .flatMap(([mode, tone]) => Object.entries(tone || {})
      .filter(([, hex]) => !allowedTones.has(hex))
      .map(([key, hex]) => `${zone}.${mode}.${key} = ${hex}`)))[0] || null;
  checks.push(check({
    key: 'palette_derives_tones',
    claim: "every Zone colour in the spec is one this Skin's own palette can make — Skins restyle from their own paint",
    pass: !strayTone,
    evidence: strayTone
      ? `spec colour outside the Skin's declared palette: ${strayTone}`
      : `${allowedTones.size} colour(s) reachable from ${spec.skin}'s tokens; every Zone tone is one of them`,
    confidence: 'high',
    falsifier: "a Zone tone carries a hex the Skin's tokens, bound materials and declared ramp cannot produce",
    soWhat: 'a colour from outside the Skin is a World repainting a Skin — the inversion this gate exists to catch',
  }));

  const landNames = new Set((map.lands || []).map((l) => l.n).filter(Boolean));
  const orphanTones = Object.keys(spec.landTones || {}).filter((name) => !landNames.has(name));
  checks.push(check({
    key: 'references_resolve',
    claim: 'every styled land exists in truth geometry',
    pass: orphanTones.length === 0,
    evidence: orphanTones.length ? `unknown lands: ${orphanTones.join(', ')}` : `${Object.keys(spec.landTones || {}).length} land tone(s) resolve`,
    confidence: 'high',
    falsifier: 'a land tone names a district the map does not have',
    soWhat: 'styling a district that does not exist means a tint silently never draws',
  }));

  const specBytes = Buffer.byteLength(JSON.stringify(spec));
  const overBudget = Object.values(spec.surfaces || {})
    .map((row) => materials[row.material])
    .filter((m) => m && m.resolution > MATERIAL_BUDGET_PX)
    .map((m) => m.label);
  checks.push(check({
    key: 'budget',
    claim: `spec ≤ ${SPEC_BUDGET_BYTES / 1024} KB and materials ≤ ${MATERIAL_BUDGET_PX}px`,
    pass: specBytes <= SPEC_BUDGET_BYTES && overBudget.length === 0,
    evidence: `spec ${specBytes} bytes${overBudget.length ? `; over-resolution: ${overBudget.join(', ')}` : ''}`,
    confidence: 'high',
    falsifier: 'a spec or bound material exceeds the phone budget',
    soWhat: 'display packs ride the venue download budget; an oversized pack blocks the gate download',
  }));

  return {
    version: DISPLAY_VERSION,
    venue: spec.venue,
    skin: spec.skin,
    certified: checks.every((c) => c.pass),
    checks,
  };
}

export function loadTruthFor(id) {
  const { map, pois } = readTruth(id);
  return { map, pois };
}

/**
 * Fold baked-kit style certifications into the venue's certification rows.
 * Pure: takes [{kit, cert}] (a kit's style-cert.json content) and returns
 * every row re-keyed `bake:<kit>:<key>` plus one gate row over the set —
 * the pack certifies only when every requested bake did.
 */
/**
 * One place understands the bake cert filename convention
 * `<id>--<kit>.style-cert.json` / `<id>--<kit>--iso-r<N>.style-cert.json`.
 * Returns { kit, rotation } with rotation null for flat certs. The greedy
 * kit capture deliberately claims everything before the LAST `--iso-r<N>`,
 * so a kit id that itself contains the marker still parses.
 */
export function parseCertFilename(id, f) {
  const stem = f.slice(id.length + 2, -'.style-cert.json'.length);
  const m = /^(.+)--iso-r(\d+)$/.exec(stem);
  return m ? { kit: m[1], rotation: Number(m[2]) } : { kit: stem, rotation: null };
}

export function defaultBakeDir() {
  return path.join(MONO_ROOT, 'artifacts', 'display-bake');
}

/** Flat (non-iso) bake certs on disk for one venue. Empty when none exist. */
export function loadBakeCerts(id, bakeDir = defaultBakeDir()) {
  const allCertFiles = (existsSync(bakeDir)
    ? readdirSync(bakeDir).filter((f) => f.startsWith(`${id}--`) && f.endsWith('.style-cert.json'))
    : []).sort();
  return allCertFiles
    .map((f) => ({ f, ...parseCertFilename(id, f) }))
    .filter(({ rotation }) => rotation === null)
    .map(({ f, kit }) => ({
      kit,
      cert: readJson(path.join(bakeDir, f), { checks: [], certified: false }),
    }));
}

/** Pass `{ bake }` into the display stage only when certs are actually there. */
export function bakeOptsForVenue(id, bakeDir = defaultBakeDir()) {
  return loadBakeCerts(id, bakeDir).length ? { bake: { dir: bakeDir } } : {};
}

/**
 * After an async mid-pyramid cut, rewrite the sealed pack contract so
 * `band:mid` names the file that now exists instead of the pre-cut gap.
 */
export function applyMidPyramidToManifest(outDir, { primaryKit = null } = {}) {
  const manifestFile = path.join(outDir, 'manifest.json');
  const mid = pyramidFile(outDir, 'mid');
  if (!existsSync(manifestFile) || !mid) return { updated: false };
  const manifest = readJson(manifestFile, null);
  if (!manifest?.tiers) return { updated: false };
  manifest.tiers['band:mid'] = {
    file: path.basename(mid),
    bytes: statSync(mid).size,
    band: 'mid',
    kit: primaryKit,
  };
  writeJson(manifestFile, manifest, true);
  return { updated: true };
}

export function foldBakeCerts(bakeCerts) {
  const rows = [];
  for (const { kit, cert } of bakeCerts) {
    for (const row of cert.checks || []) rows.push({ ...row, key: `bake:${kit}:${row.key}` });
  }
  rows.push(check({
    key: 'bake_certs',
    claim: 'every baked kit passes its reference-profile style contract',
    pass: bakeCerts.length > 0 && bakeCerts.every(({ cert }) => cert.certified),
    evidence: bakeCerts.length
      ? bakeCerts.map(({ kit, cert }) => `${kit}:${cert.certified ? 'ok' : 'FAILING'}`).join(', ')
      : 'no bake certifications found — run venues:bake before the display stage',
    confidence: 'high',
    falsifier: 'a kit whose style-cert.json reports certified:false, or no bakes at all',
    soWhat: 'an uncertified look must not ride the venue download',
  }));
  return rows;
}

/**
 * The pack's tier list — what a renderer can actually load, sizes and gaps
 * included. Pure: entries are {name, file?, bytes?, gap?, reason?, meta?}.
 */
export function tierManifest(entries) {
  const tiers = {};
  for (const e of entries) {
    tiers[e.name] = e.gap
      ? { gap: true, reason: e.reason }
      : { file: e.file, bytes: e.bytes, ...(e.meta || {}) };
  }
  return { version: DISPLAY_VERSION, tiers };
}

const fileEntry = (name, file, meta) => (existsSync(file)
  ? { name, file: path.basename(file), bytes: statSync(file).size, meta }
  : { name, gap: true, reason: `${path.basename(file)} not built` });

/**
 * The pipeline stage: compile + certify every active Skin for one venue and
 * write the pack sidecars. Publishing to `public/venues` stays a separate,
 * human-gated step — this writes builder data only.
 *
 * @param {string} id venue id
 * @param {{ map?: object, pois?: object[], skinIds?: string[], outDir?: string, write?: boolean }} opts
 *   map/pois inject truth (tests); outDir overrides data/venues/<id>/display/.
 */
export function runDisplayStage(id, opts = {}) {
  const { map, pois } = opts.map ? { map: opts.map, pois: opts.pois || [] } : loadTruthFor(id);
  const materials = readMaterials();
  const templates = readSkinTemplates();
  const landCover = opts.landCover || readLandCover(id);
  const grounding = opts.grounding !== undefined ? opts.grounding : readGrounding(id);
  const skinIds = opts.skinIds
    || Object.keys(templates).filter((skinId) => templates[skinId].status === 'active');
  const outDir = opts.outDir || venueSidecar(id, 'display');
  const write = opts.write !== false;

  const packs = {};
  const written = [];
  const textures = verifyCompiledMaterials(materials);
  for (const skinId of skinIds) {
    const template = templates[skinId];
    if (!template) throw new Error(`Unknown skin "${skinId}"`);
    const spec = compileVisualSpec({
      map, pois, template, materials, landCover, grounding, terrain: opts.terrain || null,
    });
    const certification = certifyDisplayPack({ spec, map, template, materials, textures });
    const style = styleFromSpec(spec);
    packs[skinId] = { spec, certification, style };
    if (write) {
      const specFile = path.join(outDir, `${skinId}.visual.json`);
      writeJson(specFile, spec, true);
      written.push(specFile);
      const styleFile = path.join(outDir, `${skinId}.style.json`);
      writeJson(styleFile, style, true);
      written.push(styleFile);
    }
  }

  const anchors = anchorsFromTruth(map, pois);
  const venueChecks = [check({
    key: 'visual_points',
    claim: 'truth yields fixed visual points for every future render matrix',
    pass: anchors.length >= 3,
    evidence: `${anchors.length} anchor(s): ${anchors.slice(0, 3).map((a) => a.id).join(', ')}…`,
    confidence: 'high',
    falsifier: 'a venue with no gates, no district anchors, and no coasters',
    soWhat: 'without fixed points, visual drift is compared at one convenient screenshot',
  })];

  const terrain = opts.terrain || null;
  venueChecks.push(check({
    key: 'terrain_source_resolves',
    claim: 'the ground under this venue comes from a named DEM, or is declared flat',
    pass: true,
    evidence: terrain
      ? `${terrain.source} @ ${terrain.resolution}m (${terrain.fitness} against ${terrain.cellMetres}m cells), relief ${(terrain.relief.max - terrain.relief.min).toFixed(1)}m`
      : 'no DEM coverage — venue renders flat, which is recorded rather than faked',
    confidence: terrain ? 'high' : 'moderate',
    falsifier: 'a heightfield appears with no source recorded',
    soWhat: 'a fabricated heightfield looks convincing and is wrong everywhere',
  }));
  if (terrain) {
    const b = terrain.bounds;
    const tb = map.meta?.bounds || {};
    const same = (a, c) => Number.isFinite(a) && Number.isFinite(c) && a === c;
    const aligned = same(b.north, tb.n ?? tb.north) && same(b.south, tb.s ?? tb.south)
      && same(b.east, tb.e ?? tb.east) && same(b.west, tb.w ?? tb.west);
    venueChecks.push(check({
      key: 'terrain_within_bounds',
      claim: 'the hillshade covers exactly the venue truth already published',
      pass: aligned,
      evidence: aligned ? 'terrain bounds equal map.meta.bounds' : 'terrain bounds differ from truth',
      confidence: 'high',
      falsifier: 'the overlay is placed on a rectangle truth did not publish',
      soWhat: 'an overlay on the wrong rectangle shades the wrong ground',
    }));
    venueChecks.push(check({
      key: 'terrain_surface_model',
      claim: 'a radar surface model is labelled as one, not passed off as ground',
      pass: !terrain.surfaceModel || terrain.fitness !== 'resolves',
      evidence: terrain.surfaceModel
        ? `${terrain.source} is a surface model (canopy and rooflines included) at ${terrain.resolution}m`
        : `${terrain.source} is bare-earth`,
      confidence: 'high',
      falsifier: 'a DSM is reported as resolving bare ground',
      soWhat: 'at 30m over a park one sample blends canopy, roof and ride structure',
    }));
  }

  let tiles = null;
  if (opts.tiles) {
    tiles = buildTiles({ id, map, pois, outDir });
    if (tiles.ok) written.push(tiles.file);
    // A gate can only assert what its toolchain can answer. tippecanoe is a
    // `wrap` dependency and is not installed in CI, so failing certification on
    // its absence would fail every venue on most machines the moment tiles stop
    // being opt-in — while saying nothing about this venue. An absent binary is
    // therefore a recorded gap (the sibling raster tier already works this way);
    // a tippecanoe that ran and produced a broken or oversized archive is still
    // a hard failure, because that is a fact about this venue.
    venueChecks.push(check({
      key: 'tiles',
      claim: `base.pmtiles builds and fits the ${TILES_BUDGET_KB / 1024} MB pack budget, or the tiler is a recorded gap`,
      pass: tilesGatePasses(tiles),
      evidence: tiles.ok ? `base.pmtiles ${tiles.sizeKb} KB` : tiles.reason,
      confidence: tiles.gap ? 'low' : 'high',
      falsifier: 'tippecanoe runs and the archive is broken or exceeds the download budget',
      soWhat: 'the display pack rides the venue download; an oversized or broken archive blocks it, and a missing tiler leaves the vector tier unbuilt',
    }));
  }

  // Bake integration: fold each baked kit's style contract into this
  // venue's certification (rows namespaced bake:<kit>:*), place each
  // bakeKit-bound Skin's world into the pack (ADR-0016 world tier), and
  // write the pack manifest naming every tier — present ones with sizes,
  // absent ones as recorded gaps.
  let bakes = null;
  let worlds = null;
  let bakeCerts = [];
  let primaryKit = null;
  let bakeDir = null;
  if (opts.bake) {
    bakeDir = opts.bake.dir || path.join(MONO_ROOT, 'artifacts', 'display-bake');
    // Iso-tier bakes (`<id>--<kit>--iso-r<N>.*`) stay out of the pack: they
    // would fold as a pseudo-kit otherwise. Iso pack-tier integration is
    // Phase C work.
    const allCertFiles = (existsSync(bakeDir)
      ? readdirSync(bakeDir).filter((f) => f.startsWith(`${id}--`) && f.endsWith('.style-cert.json'))
      : []).sort();
    bakeCerts = loadBakeCerts(id, bakeDir);
    venueChecks.push(...foldBakeCerts(bakeCerts));

    // The iso sweep's one venue-level demand (issue #521): per-rotation
    // certs withdraw occlusion-starved classes rather than failing, so the
    // fold is where "every class certifies somewhere in the sweep" can be
    // held at all. This consumes only the iso certs' structured skips —
    // their rows still do not fold as pack tiers (Phase C, above).
    const isoSweeps = {};
    for (const f of allCertFiles) {
      const { kit, rotation } = parseCertFilename(id, f);
      if (rotation === null) continue;
      const cert = readJson(path.join(bakeDir, f), null);
      (isoSweeps[kit] = isoSweeps[kit] || []).push({ rotation, skips: cert?.skips || [] });
    }
    for (const [kitId, sweep] of Object.entries(isoSweeps).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const row = crossRotationCoverageRow(sweep);
      venueChecks.push({ ...row, key: `bake:${kitId}:${row.key}` });
    }
    bakes = Object.fromEntries(bakeCerts.map(({ kit, cert }) => [
      kit, {
        certified: cert.certified,
        signature: cert.signature,
        // px rides the committed row so the bake-drift watch reproduces the
        // signature at the resolution that made it, not its own default.
        ...(cert.px ? { px: cert.px } : {}),
      },
    ]));

    // The venue's primary bake is a meaningful choice, not directory order:
    // the first active Skin's bakeKit binding (skins.json) wins — which kit
    // fronts the credits carries real attribution weight — with the sorted
    // first bake as the deterministic fallback.
    const boundKits = Object.keys(templates).sort()
      .map((skinId) => templates[skinId])
      .filter((t) => t.status === 'active' && t.bakeKit && bakes[t.bakeKit])
      .map((t) => t.bakeKit);
    primaryKit = boundKits[0] || bakeCerts[0]?.kit || null;
    // World tier (ADR-0016): each bakeKit-bound Skin's bake lands in the
    // pack as an image-on-truth-bounds world. This is what retired the
    // raster-PMTiles seam (lib/display-raster.mjs): that path recorded a
    // permanent gap on every call, and direct placement needs no tiler.
    const worldTier = buildWorldTier({ id, templates, bakeDir, bakeCerts, outDir, write });
    worlds = worldTier.worlds;
    written.push(...worldTier.written);
    const midPyramid = pyramidFile(outDir, 'mid');
    const manifest = tierManifest([
      fileEntry('vector', path.join(outDir, 'base.pmtiles')),
      ...worldTier.entries,
      ...bakeCerts.map(({ kit }) => fileEntry(`bake:${kit}`, path.join(bakeDir, `${id}--${kit}.png`), { kit })),
      primaryKit
        ? fileEntry('credits', path.join(bakeDir, `${id}--${primaryKit}.credits.json`), { kit: primaryKit })
        : { name: 'credits', gap: true, reason: 'no baked kits — run venues:bake first' },
      midPyramid
        ? fileEntry('band:mid', midPyramid, { band: 'mid', kit: primaryKit })
        : { name: 'band:mid', gap: true, reason: 'mid pyramid not cut — run buildBandPyramidTier' },
    ]);
    if (write) {
      const manifestFile = path.join(outDir, 'manifest.json');
      writeJson(manifestFile, manifest, true);
      written.push(manifestFile);
    }
  }

  const certified = Object.values(packs).every((p) => p.certification.certified)
    && venueChecks.every((c) => c.pass);
  const summary = {
    version: DISPLAY_VERSION,
    venue: id,
    certified,
    anchors,
    checks: venueChecks,
    ...(bakes ? { bakes } : {}),
    ...(worlds && Object.keys(worlds).length ? { worlds } : {}),
    skins: Object.fromEntries(
      Object.entries(packs).map(([skinId, p]) => [skinId, p.certification]),
    ),
  };
  if (write) {
    const file = path.join(outDir, 'display-certification.json');
    writeJson(file, summary, true);
    written.push(file);
    // The pack's download contract (ADR-0018): every shipped file of this
    // pack, hash-pinned, enumerated from the tier manifest and the stage's
    // own outputs — written last so it hashes what this run actually wrote.
    const bundleFile = path.join(outDir, 'bundle.json');
    writeBundleManifest(id, {
      venueDir: VENUE_DIR,
      displayDir: outDir,
      outFile: bundleFile,
      generated: map.meta?.generated ?? null,
    });
    written.push(bundleFile);
  }

  return {
    venue: id,
    certified,
    packs,
    anchors,
    tiles,
    bakes,
    worlds,
    written,
    outDir,
    bakeDir,
    bakeCerts,
    primaryKit,
  };
}
