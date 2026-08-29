// @ts-check
// Deep-module enforcement for dependency-cruiser.
//
// Each package under the packages root is a DEEP MODULE: a lot of behaviour
// behind a small interface. A package's PUBLIC SURFACE is its ENTRY POINTS —
// the files at the package root. Implementation lives in SUBFOLDERS and is
// private — by convention `lib/` for implementation and `tests/` for tests,
// though any subfolder is private. A package may expose several small entry
// points (index.ts, client.ts, server.ts, …) — prefer that over one giant
// barrel index.
//
// The only thing you should ever need to edit here is PACKAGES_ROOT.

/** Where packages live. One immediate child dir per package (flat, no nesting). */
const PACKAGES_ROOT = "packages";

// --- derived patterns (no need to edit) -------------------------------------
const R = PACKAGES_ROOT;
/**
 * A package's private internals: anything nested inside a package subfolder.
 * The package's root files are its entry points and are NOT matched here —
 * they stay importable from outside.
 */
const PACKAGE_INTERNALS = `^${R}/[^/]+/[^/]+/`;

/**
 * A package's `package.json` "exports" targets are entry points too, even
 * when they live in a subfolder (e.g. venue-builder's src/compare.mjs).
 * The documented interface is the exports map, not only the root files.
 * Logic lives (tested) in scripts/lib/dependency-boundaries.cjs.
 */
const { exportedEntryPointPatterns } = require("./scripts/lib/dependency-boundaries.cjs");
const EXPORTED_ENTRY_POINTS = exportedEntryPointPatterns(R);

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "entrypoint-boundary-from-app",
      comment:
        "App/root code may import a package's entry points (its root files), but nothing inside its subfolders.",
      severity: "error",
      from: {
        pathNot: [
          `^${R}/`, // importer is NOT inside any package
          // test/builder/*.mjs is the repo's sanctioned white-box
          // integration suite: it deliberately exercises both
          // packages/venue-builder and apps/party-tracker/lib/core
          // internals together, because it tests the builder-output/
          // app-consumption contract directly. That's a permanent,
          // documented exception (see packages/README.md), not a gap
          // pending a move — see #476.
          "^test/builder/",
        ],
      },
      to: { path: PACKAGE_INTERNALS, pathNot: EXPORTED_ENTRY_POINTS },
    },
    {
      name: "entrypoint-boundary-across-packages",
      comment:
        "A package's own files import each other freely, but may reach OTHER packages only through their entry points — never their internals.",
      severity: "error",
      // importer is inside a package ($1), but is not a test file
      from: { path: `^${R}/([^/]+)/`, pathNot: `^${R}/[^/]+/tests/` },
      to: {
        path: PACKAGE_INTERNALS,
        pathNot: [`^${R}/$1/`, ...EXPORTED_ENTRY_POINTS], // same package → intra-package freedom
      },
    },
    {
      name: "tests-through-entrypoints",
      comment:
        "A package's tests exercise it through its entry points like everyone else: they may import any package's entry points and their own tests/ fixtures, but never any package's internals — not even their own.",
      severity: "error",
      from: { path: `^${R}/([^/]+)/tests/` }, // a test file, in package $1
      to: {
        path: PACKAGE_INTERNALS,
        pathNot: `^${R}/$1/tests/`, // own tests/ fixtures → allowed
      },
    },
    {
      name: "tests-folder-is-private",
      comment:
        "A package's tests/ folder is reachable only from tests — nothing else may import fixtures.",
      severity: "error",
      from: { pathNot: `^${R}/[^/]+/tests/` }, // importer is not itself a test
      to: { path: `^${R}/[^/]+/tests/` },
    },
    {
      name: "no-circular",
      comment: "No dependency cycles. Scope to `^${R}/` if you want to allow cycles outside packages.",
      severity: "error",
      from: {},
      to: { circular: true },
    },

    // --- Layering (optional, off by default) ----------------------------------
    // Interface-hiding controls HOW you import (through the entry points).
    // Layering controls WHICH packages may depend on which. Add your own rules
    // here, e.g.:
    //
    // {
    //   name: "ui-may-not-depend-on-billing",
    //   severity: "error",
    //   from: { path: `^${R}/ui/` },
    //   to:   { path: `^${R}/billing/` },
    // },

    // venue-builder/lib/ internal layering. Grounded in the real import graph
    // (surveyed 2026-08-18, zero cycles): operators/ and adapters/ are strict
    // leaves that never import agents/ or each other's sibling, and only a
    // named set of core files are allowed to reach down into agents/,
    // operators/, or adapters/ at all — everything else in core lib/ stays a
    // base layer. See docs/agents/policies/venue-builder-lib-boundaries.md.
    {
      name: "venue-builder-operators-are-leaf",
      comment:
        "lib/operators/ never imports agents/ or adapters/ — it's the deepest leaf in the builder's lib/ layering (park-chain listing parsers only).",
      severity: "error",
      from: { path: "^packages/venue-builder/lib/operators/" },
      to: { path: "^packages/venue-builder/lib/(agents|adapters)/" },
    },
    {
      name: "venue-builder-adapters-are-leaf",
      comment:
        "lib/adapters/ never imports agents/, operators/ or terrain/ — adapters are wrap layers around external tools/services, not orchestration, and not consumers of the display maths built on top of them.",
      severity: "error",
      from: { path: "^packages/venue-builder/lib/adapters/" },
      to: { path: "^packages/venue-builder/lib/(agents|operators|terrain)/" },
    },
    {
      name: "venue-builder-terrain-is-display-only",
      comment:
        "lib/terrain/ is Display-layer maths (elevation, hillshade, constraints, mesh). It may read adapters/ for a DEM, but it must never reach agents/ or operators/, and — the rule that matters — never the evidence engine: height is not evidence, and a terrain module that imports evidence.mjs has started fusing it as if it were. See ADR-0015.",
      severity: "error",
      from: { path: "^packages/venue-builder/lib/terrain/" },
      to: { path: "^packages/venue-builder/lib/(agents|operators|evidence|evidence-graph)" },
    },
    {
      name: "venue-builder-visual-factory-truth-read-seam",
      comment:
        "lib/visual-factory/ reads map truth only through map-factory/map-io.mjs — the artifact read interface — never other map-factory internals.",
      severity: "error",
      from: { path: "^packages/venue-builder/lib/visual-factory/" },
      to: {
        path: "^packages/venue-builder/lib/map-factory/",
        pathNot: "^packages/venue-builder/lib/map-factory/map-io\\.mjs$",
      },
    },
    {
      name: "venue-builder-delivery-no-map-internals",
      comment:
        "lib/delivery/ publishes bundles and runs freshness gates — it must not reach map-factory or visual-factory orchestration, only shared I/O kernels.",
      severity: "error",
      from: { path: "^packages/venue-builder/lib/delivery/" },
      to: { path: "^packages/venue-builder/lib/(map-factory|visual-factory)/" },
    },
    {
      name: "venue-builder-core-orchestration-is-sanctioned",
      comment:
        "Core lib/*.mjs reaching into agents/, operators/, or adapters/ is an orchestration seam, not the default. Only the files listed here do it today (build-pipeline, venue-official-site, the external-*/venue-certify/venue-packet adapter consumers, venue-io) — a new core file that needs the same reach adds itself here deliberately rather than importing silently.",
      severity: "error",
      from: {
        path: "^packages/venue-builder/lib/[^/]+\\.mjs$",
        pathNot: [
          "^packages/venue-builder/lib/build-pipeline\\.mjs$",
          "^packages/venue-builder/lib/venue-official-site\\.mjs$",
          "^packages/venue-builder/lib/external-claims\\.mjs$",
          "^packages/venue-builder/lib/external-research\\.mjs$",
          "^packages/venue-builder/lib/venue-certify\\.mjs$",
          "^packages/venue-builder/lib/venue-packet\\.mjs$",
          // venue-io.mjs's gapsDocumentFor reads each declared adapter's cache
          // file (adapters/_cache.mjs:adapterCacheFile) to fold adapter-sourced
          // gap notes into the shipped gaps document — the same adapter-cache
          // read venue-certify.mjs (already sanctioned above) does for its own
          // brief. Genuine orchestration, not an accidental import: it is the
          // step that gathers sidecar + adapter data before handing off to
          // ship-gaps.mjs, which deliberately does not import venue-io.mjs
          // (see ship-gaps.mjs's header) to keep that handoff one-directional.
          "^packages/venue-builder/lib/venue-io\\.mjs$",
        ],
      },
      to: { path: "^packages/venue-builder/lib/(agents|operators|adapters)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"],
    },
  },
};
