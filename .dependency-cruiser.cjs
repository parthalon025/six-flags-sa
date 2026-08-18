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
          // test/builder is the venue-builder's white-box unit suite and
          // predates the boundary; scoped exemption — #476 tracks moving it
          // into packages/venue-builder/tests behind seams, or blessing it.
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
      from: {
        // Known cycle: mailboxClient ↔ mailboxPoller (transport layer).
        // Allowlisted, not endorsed — #478 tracks extracting the shared
        // stream helpers.
        pathNot: "^apps/party-tracker/lib/transport/(mailboxClient|mailboxPoller)\\.js$",
      },
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
        "lib/adapters/ never imports agents/ or operators/ — adapters are wrap layers around external tools/services, not orchestration.",
      severity: "error",
      from: { path: "^packages/venue-builder/lib/adapters/" },
      to: { path: "^packages/venue-builder/lib/(agents|operators)/" },
    },
    {
      name: "venue-builder-core-orchestration-is-sanctioned",
      comment:
        "Core lib/*.mjs reaching into agents/, operators/, or adapters/ is an orchestration seam, not the default. Only the files listed here do it today (build-pipeline, venue-official-site, the external-*/venue-certify/venue-packet adapter consumers) — a new core file that needs the same reach adds itself here deliberately rather than importing silently.",
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
