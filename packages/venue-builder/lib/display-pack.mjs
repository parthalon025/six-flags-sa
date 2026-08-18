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
import { OVERRIDE_DIR, VENUE_DIR, readJson, writeJson, venueSidecar } from './venue-io.mjs';

export const DISPLAY_VERSION = 1;

/** Licenses a shipped material may carry. AGPL and unknown stay rejected. */
export const ALLOWED_LICENSES = ['CC0-1.0', 'original', 'licensed'];

/**
 * Surface classes — the display ontology. Each class claims map layers;
 * `lands` is deliberately absent (district washes are land tones, not
 * materials) and every claimed layer belongs to exactly one class.
 */
export const SURFACE_CLASSES = {
  walkway: { label: 'Walkways', layers: ['path'] },
  'service-road': { label: 'Service roads', layers: ['service'] },
  water: { label: 'Water', layers: ['water', 'sea'] },
  pool: { label: 'Pools', layers: ['pool'] },
  vegetation: { label: 'Vegetation', layers: ['grass', 'wood', 'park'] },
  lot: { label: 'Parking lots', layers: ['parking'] },
  structure: { label: 'Structures', layers: ['building'] },
  'coaster-track': { label: 'Coaster track', layers: ['coaster'] },
  slide: { label: 'Slides', layers: ['slide'] },
};

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

function landTonesFromMeta(meta) {
  const tones = {};
  for (const mode of ['day', 'night']) {
    for (const [land, tone] of Object.entries(meta?.lands?.[mode] || {})) {
      tones[land] = tones[land] || {};
      tones[land][mode] = tone;
    }
  }
  return tones;
}

/**
 * Compile one venue × Skin visual spec. Pure: no disk, no clock, no network.
 * Binds only surfaces whose layers the venue actually has; hand land tints
 * pass through and none are invented (unmapped lands fall back to the
 * renderer's deterministic name-hue).
 *
 * @param {{ map: object, pois: object[], template: object, materials: object }} deps
 */
export function compileVisualSpec({ map, pois = [], template, materials }) {
  const surfaces = {};
  for (const [surface, materialId] of Object.entries(template.surfaces || {})) {
    const layers = (SURFACE_CLASSES[surface]?.layers || []).filter((l) => map[l]?.length);
    if (!layers.length) continue;
    if (!materials[materialId]) continue; // certification reports it; compile stays total
    surfaces[surface] = { material: materialId, layers };
  }
  return {
    version: DISPLAY_VERSION,
    venue: map.meta?.id,
    skin: template.id,
    basedOn: { map: map.meta?.generated || null },
    tokens: template.tokens || {},
    surfaces,
    landTones: landTonesFromMeta(map.meta),
    fallback: { landTone: 'name-hue' },
  };
}

const COORDINATE_KEYS = new Set(['lat', 'lng', 'r']);

function findCoordinateKey(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findCoordinateKey(item);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (COORDINATE_KEYS.has(key)) return key;
      const hit = findCoordinateKey(inner);
      if (hit) return hit;
    }
  }
  return null;
}

const check = ({ key, claim, pass, evidence, confidence, falsifier, soWhat }) => ({
  key, claim, pass, evidence, confidence, falsifier, soWhat,
});

const SPEC_BUDGET_BYTES = 64 * 1024;
const MATERIAL_BUDGET_PX = 1024;

/**
 * Certify one compiled spec against truth, the template, and the ledger.
 * Pure — same claim/evidence/confidence/falsifier/so-what contract as
 * `venue-certify.mjs`.
 *
 * @param {{ spec: object, map: object, template: object, materials: object }} deps
 */
export function certifyDisplayPack({ spec, map, template, materials }) {
  const checks = [];

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

  const leaked = findCoordinateKey(spec);
  checks.push(check({
    key: 'no_repositioning',
    claim: 'the spec carries no coordinates — skins restyle, never reposition',
    pass: !leaked,
    evidence: leaked ? `coordinate-bearing key "${leaked}" found in spec` : 'no lat/lng/ring keys anywhere in the spec',
    confidence: 'high',
    falsifier: 'any lat, lng, or ring key appears anywhere in the spec',
    soWhat: 'a display file that can move a Place breaks the truth/display split',
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

function loadTruth(id) {
  const map = readJson(path.join(VENUE_DIR, `${id}.map.json`), null);
  const pois = readJson(path.join(VENUE_DIR, `${id}.pois.json`), null);
  if (!map || !pois) throw new Error(`Venue "${id}" is missing map.json or pois.json`);
  return { map, pois };
}

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
  const { map, pois } = opts.map ? { map: opts.map, pois: opts.pois || [] } : loadTruth(id);
  const materials = readMaterials();
  const templates = readSkinTemplates();
  const skinIds = opts.skinIds
    || Object.keys(templates).filter((skinId) => templates[skinId].status === 'active');
  const outDir = opts.outDir || venueSidecar(id, 'display');
  const write = opts.write !== false;

  const packs = {};
  const written = [];
  for (const skinId of skinIds) {
    const template = templates[skinId];
    if (!template) throw new Error(`Unknown skin "${skinId}"`);
    const spec = compileVisualSpec({ map, pois, template, materials });
    const certification = certifyDisplayPack({ spec, map, template, materials });
    packs[skinId] = { spec, certification };
    if (write) {
      const file = path.join(outDir, `${skinId}.visual.json`);
      writeJson(file, spec, true);
      written.push(file);
    }
  }

  const certified = Object.values(packs).every((p) => p.certification.certified);
  const summary = {
    version: DISPLAY_VERSION,
    venue: id,
    certified,
    skins: Object.fromEntries(
      Object.entries(packs).map(([skinId, p]) => [skinId, p.certification]),
    ),
  };
  if (write) {
    const file = path.join(outDir, 'display-certification.json');
    writeJson(file, summary, true);
    written.push(file);
  }

  return { venue: id, certified, packs, written };
}
