/**
 * Universal factory route catalog — types drive which factory runs when.
 *
 * Two factories (Map + Visual), coupled only by artifacts (`basedOn` stamps,
 * repo-is-the-bus per ADR-0018). Each route declares typed inputs, typed
 * outputs, and a requirement level so validators and CLIs route work by
 * factory type instead of ad hoc script names.
 *
 * Interface:
 *   FACTORIES, ROUTES, getRoute, routesForFactory, entryForRoute
 *   resolveOutputPath, knownFactoryScripts, assertCatalogComplete, scriptsForRoute
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BUILDER_ROOT = path.dirname(fileURLToPath(import.meta.url));
const BUILDER_BIN = path.join(BUILDER_ROOT, '..', 'bin');

/** @typedef {'map' | 'visual' | 'delivery'} FactoryId */
/** @typedef {'required' | 'warn' | 'optional'} RequirementLevel */
/** @typedef {'bin' | 'lib' | 'cli'} EntryKind */

/**
 * A certifiable factory output — birth certificate or published artifact.
 * @typedef {object} CertifiableArtifact
 * @property {string} id route output id or artifact name
 * @property {'artifact' | 'certification' | 'stamp'} kind
 * @property {boolean} [certified] when kind is certification
 * @property {string} [path] absolute or repo-relative path on disk
 */

/**
 * Truth stamp a downstream pack pins — `basedOn` in visual specs and bundles.
 * @typedef {object} FreshnessPin
 * @property {string|null} map truth stamp (`map.meta.generated`) the pack was built on
 * @property {string|null} [revisionId] postdb truth revision (Slice 1+)
 */

/**
 * Map factory published truth — the trio the Visual factory reads.
 * @typedef {object} VenueTruthBundle
 * @property {string} venueId
 * @property {string|null} generated truth stamp
 * @property {object} map published geometry
 * @property {object[]} pois published places
 * @property {object} [gaps] published Gaps document
 */

/**
 * @typedef {object} RouteInput
 * @property {string} name
 * @property {'string' | 'boolean' | 'string[]'} type
 * @property {boolean} [required]
 */

/**
 * @typedef {object} RouteOutput
 * @property {string} id
 * @property {'artifact' | 'certification' | 'stamp'} kind
 * @property {(ctx: { venueId: string, skinId?: string }) => string} relPath
 * @property {string} [description]
 */

/**
 * @typedef {object} RouteEntry
 * @property {string} id
 * @property {FactoryId} factory
 * @property {{ kind: EntryKind, module: string, export?: string }} entry
 * @property {RouteInput[]} inputs
 * @property {RouteOutput[]} outputs
 * @property {RequirementLevel} requirement
 * @property {string} [description]
 */

export const FACTORIES = Object.freeze({
  map: 'Map factory — truth build, certify, route QA',
  visual: 'Visual factory — display pack, terrain, tiles, bake, certify',
  delivery: 'Delivery — bundle manifest and published display worlds',
});

/** Short id → display name for reports and CLI output. */
export const FACTORY_LABELS = Object.freeze({
  map: 'Map factory',
  visual: 'Visual factory',
  delivery: 'Delivery',
});

/** @param {FactoryId} factory */
export function factoryLabel(factory) {
  return FACTORY_LABELS[factory] || factory;
}

/** @type {readonly RouteEntry[]} */
export const ROUTES = Object.freeze([
  /* ------------------------------- Map factory ------------------------------- */
  {
    id: 'map.truth',
    factory: 'map',
    entry: { kind: 'bin', module: 'build-venue.mjs' },
    inputs: [{ name: 'venueId', type: 'string', required: true }],
    outputs: [
      {
        id: 'map',
        kind: 'artifact',
        relPath: ({ venueId }) => path.join('apps', 'party-tracker', 'public', 'venues', `${venueId}.map.json`),
        description: 'Published geometry truth',
      },
      {
        id: 'pois',
        kind: 'artifact',
        relPath: ({ venueId }) => path.join('apps', 'party-tracker', 'public', 'venues', `${venueId}.pois.json`),
        description: 'Published places truth',
      },
      {
        id: 'gaps',
        kind: 'artifact',
        relPath: ({ venueId }) => path.join('apps', 'party-tracker', 'public', 'venues', `${venueId}.gaps.json`),
        description: 'Published Gaps the Map factory invented',
      },
      {
        id: 'truth-stamp',
        kind: 'stamp',
        relPath: ({ venueId }) => path.join('apps', 'party-tracker', 'public', 'venues', `${venueId}.map.json`),
        description: 'map.meta.generated — the stamp every display pack pins',
      },
    ],
    requirement: 'required',
    description: 'Truth build — map, pois, gaps published to public/venues',
  },
  {
    id: 'map.certify',
    factory: 'map',
    entry: { kind: 'lib', module: 'map-factory/build-truth.mjs', export: 'buildTruth' },
    inputs: [{ name: 'venueId', type: 'string', required: true }],
    outputs: [
      {
        id: 'certification',
        kind: 'certification',
        relPath: ({ venueId }) => path.join('packages', 'venue-builder', 'data', 'venues', venueId, 'certification.json'),
        description: 'Birth certificate — report + compare + route-qa + ask gates',
      },
    ],
    requirement: 'warn',
    description: 'Map factory certification — may warn when research gates are incomplete',
  },
  {
    id: 'map.route-qa',
    factory: 'map',
    entry: { kind: 'lib', module: 'venue-route-qa-core.mjs', export: 'qaVenueRouting' },
    inputs: [{ name: 'venueId', type: 'string', required: true }],
    outputs: [],
    requirement: 'required',
    description: 'Routing QA — path graph health and ride snap distance',
  },
  /* ----------------------------- Visual factory ------------------------------ */
  {
    id: 'visual.terrain',
    factory: 'visual',
    entry: { kind: 'lib', module: 'terrain/venue-terrain.mjs', export: 'prepareVenueTerrain' },
    inputs: [{ name: 'venueId', type: 'string', required: true }],
    outputs: [
      {
        id: 'hillshade',
        kind: 'artifact',
        relPath: ({ venueId }) => path.join('packages', 'venue-builder', 'data', 'venues', venueId, 'display', 'hillshade.png'),
        description: 'Terrain hillshade — flat venues record absence instead of faking DEM',
      },
    ],
    requirement: 'optional',
    description: 'Terrain prep — DEM hillshade or declared flat',
  },
  {
    id: 'visual.display-pack',
    factory: 'visual',
    entry: { kind: 'lib', module: 'visual-factory/compile-display.mjs', export: 'compileDisplay' },
    inputs: [
      { name: 'venueId', type: 'string', required: true },
      { name: 'skinIds', type: 'string[]', required: false },
    ],
    outputs: [
      {
        id: 'visual-spec',
        kind: 'artifact',
        relPath: ({ venueId, skinId = '*' }) => path.join(
          'packages', 'venue-builder', 'data', 'venues', venueId, 'display', `${skinId}.visual.json`,
        ),
        description: 'Per-Skin compiled visual spec (active skins)',
      },
      {
        id: 'style',
        kind: 'artifact',
        relPath: ({ venueId, skinId = '*' }) => path.join(
          'packages', 'venue-builder', 'data', 'venues', venueId, 'display', `${skinId}.style.json`,
        ),
        description: 'Per-Skin MapLibre style derived from the spec',
      },
    ],
    requirement: 'required',
    description: 'Display pack — compile + write visual specs for every active Skin',
  },
  {
    id: 'visual.tiles',
    factory: 'visual',
    entry: { kind: 'lib', module: 'display-tiles.mjs', export: 'buildTiles' },
    inputs: [{ name: 'venueId', type: 'string', required: true }],
    outputs: [
      {
        id: 'base-pmtiles',
        kind: 'artifact',
        relPath: ({ venueId }) => path.join('packages', 'venue-builder', 'data', 'venues', venueId, 'display', 'base.pmtiles'),
        description: 'Vector tile archive for the mid band',
      },
    ],
    requirement: 'warn',
    description: 'Tiles build — base.pmtiles or a recorded tiler gap in display-certification',
  },
  {
    id: 'visual.bake',
    factory: 'visual',
    entry: { kind: 'bin', module: 'display-bake.mjs' },
    inputs: [
      { name: 'venueId', type: 'string', required: true },
      { name: 'skinIds', type: 'string[]', required: false },
    ],
    outputs: [
      {
        id: 'world',
        kind: 'artifact',
        relPath: ({ venueId, skinId = '*' }) => path.join(
          'packages', 'venue-builder', 'data', 'venues', venueId, 'display', `${skinId}.world.png`,
        ),
        description: 'Baked world image per Skin (when --bake claims a tier)',
      },
    ],
    requirement: 'optional',
    description: 'Display bake — world tier images; optional until a Skin claims a bake lane',
  },
  {
    id: 'visual.display-certify',
    factory: 'visual',
    entry: { kind: 'lib', module: 'visual-factory/compile-display.mjs', export: 'compileDisplay' },
    inputs: [{ name: 'venueId', type: 'string', required: true }],
    outputs: [
      {
        id: 'display-certification',
        kind: 'certification',
        relPath: ({ venueId }) => path.join(
          'packages', 'venue-builder', 'data', 'venues', venueId, 'display', 'display-certification.json',
        ),
        description: 'Visual factory birth certificate',
      },
    ],
    requirement: 'required',
    description: 'Visual factory certification — geo-fidelity + distinctness gates',
  },
  {
    id: 'visual.publish',
    factory: 'visual',
    entry: { kind: 'lib', module: 'display-world.mjs', export: 'publishWorlds' },
    cli: 'display-publish.mjs',
    inputs: [
      { name: 'venueId', type: 'string', required: true },
      { name: 'skinIds', type: 'string[]', required: true },
    ],
    outputs: [
      {
        id: 'published-world',
        kind: 'artifact',
        relPath: ({ venueId, skinId = '*' }) => path.join(
          'apps', 'party-tracker', 'public', 'venues', venueId, 'display', `${skinId}.world.png`,
        ),
        description: 'Human-gated copy of baked worlds into public/venues',
      },
    ],
    requirement: 'warn',
    description: 'Publish worlds — only Skins the app consumes need copies in public/',
  },
  /* -------------------------------- Delivery --------------------------------- */
  {
    id: 'delivery.bundle',
    factory: 'delivery',
    entry: { kind: 'lib', module: 'delivery/publish-bundle.mjs', export: 'publishBundle' },
    cli: 'export-bundle.mjs',
    inputs: [{ name: 'venueId', type: 'string', required: true }],
    outputs: [
      {
        id: 'bundle',
        kind: 'artifact',
        relPath: ({ venueId }) => path.join('apps', 'party-tracker', 'public', 'venues', `${venueId}.bundle.json`),
        description: 'Download contract — truth trio + display tiers, hash-pinned',
      },
    ],
    requirement: 'required',
    description: 'Bundle manifest — ADR-0018 phone download contract',
  },
]);

const routeById = new Map(ROUTES.map((r) => [r.id, r]));

/** @param {string} id */
export function getRoute(id) {
  return routeById.get(id) ?? null;
}

/** @param {FactoryId} factory */
export function routesForFactory(factory) {
  return ROUTES.filter((r) => r.factory === factory);
}

/**
 * Resolve a route's module path on disk.
 * @param {RouteEntry} route
 */
export function entryForRoute(route) {
  const base = route.entry.kind === 'bin' ? BUILDER_BIN : BUILDER_ROOT;
  return path.join(base, route.entry.module);
}

/**
 * Absolute path for one route output under the mono root.
 * @param {RouteOutput} output
 * @param {{ venueId: string, skinId?: string, root: string }} ctx
 */
export function resolveOutputPath(output, ctx) {
  return path.join(ctx.root, output.relPath(ctx));
}

/**
 * Factory scripts that must appear in the catalog (no orphan scripts).
 * Scripts listed here but absent from ROUTES.entry.module fail assertCatalogComplete.
 */
export const knownFactoryScripts = () => [
  'build-venue.mjs',
  'build-truth.mjs',
  'compile-display.mjs',
  'publish-bundle.mjs',
  'export-bundle.mjs',
  'display-bake.mjs',
  'display-publish.mjs',
  'display-tiles.mjs', // lib module; bin is display-pack orchestration
];

/**
 * Assert every known factory script is referenced by at least one route entry,
 * and every route entry points at a real module file.
 *
 * @param {string} [root] mono root — only used to resolve relative paths for existence
 */
/** @returns {string[]} script basenames for a route (lib/bin module + optional CLI wrapper). */
export function scriptsForRoute(route) {
  const names = [path.basename(route.entry.module)];
  if (route.cli) names.push(route.cli);
  return names;
}

export function assertCatalogComplete() {
  const referenced = new Set(ROUTES.flatMap((r) => scriptsForRoute(r)));
  const orphans = knownFactoryScripts().filter((s) => !referenced.has(s));
  if (orphans.length) {
    throw new Error(`factory route catalog missing entries for: ${orphans.join(', ')}`);
  }
  const missing = ROUTES
    .map((r) => ({ id: r.id, file: entryForRoute(r) }))
    .filter(({ file }) => !existsSync(file));
  if (missing.length) {
    throw new Error(
      `factory route catalog points at missing modules: ${
        missing.map((m) => `${m.id} → ${m.file}`).join('; ')}`,
    );
  }
  return { routes: ROUTES.length, scripts: referenced.size };
}
