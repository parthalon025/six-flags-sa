/**
 * Static + dynamic relative-import closure walker.
 *
 * Given one or more entry files, follows every relative `import ... from`,
 * `export ... from`, dynamic `import(...)`, `require(...)` and
 * `require.resolve(...)` specifier transitively, returning every file the
 * entry points actually need on disk. This is the ground truth for what a
 * runtime import of an entry point needs — not a hand-maintained list, which
 * silently drifts the next time someone adds an import.
 *
 * Bare specifiers (`node:*`, a package name, a workspace package like
 * `@party-tracker/shared`) resolve through node_modules, which a path-based
 * ignore file does not touch, so they are reported in `external` rather than
 * followed. Anything relative (`./` or `../`) that fails to resolve on disk
 * is reported in `unresolved` — a non-empty `unresolved` means the trace
 * itself is broken (or the source has a real dangling import) and callers
 * should treat that as a hard failure, not a file to skip.
 *
 * The regex scan is line/string oriented, so a specifier that only exists
 * inside a string literal (code the source writes out, not an import it
 * makes) can appear in `external` as a false positive — that is fine, since
 * `external` is not resolved further and not asserted against.
 *
 * Interface:
 *   computeImportClosure({ root, entries }) -> {
 *     files: string[]      repo-relative to `root`, sorted, entries included
 *     external: string[]   bare/alias specifiers referenced, sorted, deduped
 *     unresolved: string[] relative specifiers that did not resolve on disk
 *   }
 */
import fs from 'node:fs';
import path from 'node:path';

const IMPORT_RE = /\bimport\s+(?:[\w*\s{},]+\s+from\s+)?['"]([^'"]+)['"]/g;
const EXPORT_RE = /\bexport\s+(?:[\w*\s{},]+\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_RESOLVE_RE = /\brequire\.resolve\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractSpecs(src) {
  const specs = [];
  for (const re of [IMPORT_RE, EXPORT_RE, DYNAMIC_IMPORT_RE, REQUIRE_RE, REQUIRE_RESOLVE_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) specs.push(m[1]);
  }
  return specs;
}

function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.mjs`,
    `${base}.js`,
    `${base}.json`,
    path.join(base, 'index.mjs'),
    path.join(base, 'index.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * @param {{root: string, entries: string[]}} opts `entries` are paths relative to `root`
 */
export function computeImportClosure({ root, entries }) {
  const seen = new Set();
  const external = new Set();
  const unresolved = new Set();

  function visit(absFile) {
    if (seen.has(absFile)) return;
    seen.add(absFile);
    let src;
    try {
      src = fs.readFileSync(absFile, 'utf8');
    } catch {
      unresolved.add(path.relative(root, absFile));
      return;
    }
    for (const spec of extractSpecs(src)) {
      if (spec.startsWith('.')) {
        const resolved = resolveRelative(absFile, spec);
        if (resolved) {
          visit(resolved);
        } else {
          unresolved.add(`${spec}  (from ${path.relative(root, absFile)})`);
        }
      } else if (!spec.startsWith('node:')) {
        external.add(spec);
      }
    }
  }

  for (const entry of entries) visit(path.resolve(root, entry));

  return {
    files: [...seen].map((f) => path.relative(root, f)).sort(),
    external: [...external].sort(),
    unresolved: [...unresolved].sort(),
  };
}
