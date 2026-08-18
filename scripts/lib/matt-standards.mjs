/**
 * Matt-standards mechanical checks — the enforceable half of
 * docs/agents/matt-standards.md, as policy-in-scripts.
 *
 * Interface:
 *   untestedScriptsLibModules({ libFiles, testSources, allowlist })
 *   functionalModulesDrift({ functionalSource, manifest })
 *   venueBuilderPathLiterals({ appSources, allowlist })
 *   runMattStandardsChecks({ cwd })
 *
 * Gate wiring: test/scripts/matt-standards.test.mjs asserts
 * runMattStandardsChecks() returns no violations for the repo.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModulesManifest } from '../../test/app/lib/module-select.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** scripts/lib modules with no direct test yet — backfill tracked in #474. */
export const SCRIPTS_LIB_TEST_ALLOWLIST = [
  'scripts/lib/app-store-connect.mjs',
  'scripts/lib/store-screenshot-compose.mjs',
];

/** App files allowed to reference packages/venue-builder by path literal — seam refactor tracked in #475. */
export const VENUE_BUILDER_PATH_ALLOWLIST = [
  'apps/party-tracker/lib/venueCompare.js',
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
      walk(abs, out);
    } else {
      out.push(abs);
    }
  }
  return out;
}

function rel(cwd, abs) {
  return relative(cwd, abs).replace(/\\/g, '/');
}

/**
 * Every scripts/lib module must be exercised by a test under test/scripts
 * (a test source referencing its `scripts/lib/<path>` import), unless
 * allowlisted. New seams cannot land untested.
 */
export function untestedScriptsLibModules({ libFiles, testSources, allowlist = [] }) {
  const testBlob = Object.values(testSources).join('\n');
  return libFiles.filter((libRel) => !allowlist.includes(libRel) && !testBlob.includes(libRel));
}

/**
 * The gated sections in functional.mjs (`want('<id>')`) and the functional
 * modules in modules.json must match in both directions — otherwise a new
 * e2e section silently never runs in CI's module selection.
 */
export function functionalModulesDrift({ functionalSource, manifest }) {
  const wantIds = new Set();
  for (const m of functionalSource.matchAll(/\bwant\(\s*['"]([a-z0-9-]+)['"]\s*\)/g)) {
    wantIds.add(m[1]);
  }
  const manifestIds = new Set(
    manifest.modules.filter((m) => m.kind === 'functional').map((m) => m.id),
  );
  return {
    unmapped: [...wantIds].filter((id) => !manifestIds.has(id)).sort(),
    unused: [...manifestIds].filter((id) => !wantIds.has(id)).sort(),
  };
}

/**
 * App code must not reach into packages/venue-builder via filesystem path
 * literals — dependency-cruiser cannot see string paths, so this closes the
 * boundary hole it structurally cannot cover.
 */
export function venueBuilderPathLiterals({ appSources, allowlist = [] }) {
  return Object.entries(appSources)
    .filter(([file, src]) => !allowlist.includes(file) && src.includes('packages/venue-builder'))
    .map(([file]) => file)
    .sort();
}

/** Run every check against the real repo. Returns violation strings (empty = ok). */
export function runMattStandardsChecks({ cwd = root } = {}) {
  const problems = [];

  const libFiles = walk(join(cwd, 'scripts/lib'))
    .filter((f) => /\.(mjs|cjs)$/.test(f))
    .map((f) => rel(cwd, f));
  const testSources = Object.fromEntries(
    readdirSync(join(cwd, 'test/scripts'))
      .filter((f) => f.endsWith('.test.mjs'))
      .map((f) => [`test/scripts/${f}`, readFileSync(join(cwd, 'test/scripts', f), 'utf8')]),
  );
  for (const libRel of untestedScriptsLibModules({
    libFiles,
    testSources,
    allowlist: SCRIPTS_LIB_TEST_ALLOWLIST,
  })) {
    problems.push(
      `untested scripts/lib seam: ${libRel} — add a test/scripts test importing it (policy lives in scripts, tested through exports)`,
    );
  }

  const functionalSource = readFileSync(join(cwd, 'test/app/functional.mjs'), 'utf8');
  const manifest = loadModulesManifest(join(cwd, 'test/app/modules.json'));
  const drift = functionalModulesDrift({ functionalSource, manifest });
  for (const id of drift.unmapped) {
    problems.push(
      `functional.mjs gates section '${id}' but test/app/modules.json has no functional module with that id — CI would never select it`,
    );
  }
  for (const id of drift.unused) {
    problems.push(
      `modules.json functional module '${id}' has no want('${id}') section in functional.mjs`,
    );
  }

  const appSources = Object.fromEntries(
    walk(join(cwd, 'apps'))
      .filter((f) => /\.(m?js|jsx|cjs|ts|tsx)$/.test(f))
      .map((f) => [rel(cwd, f), readFileSync(f, 'utf8')]),
  );
  for (const file of venueBuilderPathLiterals({
    appSources,
    allowlist: VENUE_BUILDER_PATH_ALLOWLIST,
  })) {
    problems.push(
      `app file ${file} references packages/venue-builder by path literal — import an entry point or move the seam (builder ↔ app contract)`,
    );
  }

  return problems;
}
