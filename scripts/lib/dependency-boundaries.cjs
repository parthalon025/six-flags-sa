/**
 * Exported-entry-point discovery for dependency-cruiser.
 *
 * A package's `package.json` "exports" targets are public interface even when
 * they live in a subfolder (e.g. venue-builder's src/compare.mjs) — the
 * documented interface is the exports map, not only the package root files.
 *
 * CommonJS so `.dependency-cruiser.cjs` can require it synchronously.
 *
 * Interface:
 *   escapeRegExpPath(p)
 *   exportTargetLeaves(exportsMap)
 *   exportedEntryPointPatterns(packagesRoot, { fs })
 */
const nodeFs = require("node:fs");
const nodePath = require("node:path");

/** Escape a file path for exact-match use inside a dependency-cruiser regex. */
function escapeRegExpPath(p) {
  return p.replace(/[.\\+*?^$()[\]{}|]/g, "\\$&");
}

/** Flatten an exports map's string targets (plain and conditional forms). */
function exportTargetLeaves(exportsMap) {
  const leaves = [];
  for (const value of Object.values(exportsMap || {})) {
    const candidates = typeof value === "string" ? [value] : Object.values(value || {});
    for (const leaf of candidates) {
      if (typeof leaf === "string") leaves.push(leaf.replace(/^\.\//, ""));
    }
  }
  return leaves;
}

/** Anchored regex patterns for every exports target of every package under packagesRoot. */
function exportedEntryPointPatterns(packagesRoot, { fs = nodeFs } = {}) {
  const patterns = [];
  for (const name of fs.readdirSync(packagesRoot)) {
    const pkgJson = nodePath.join(packagesRoot, name, "package.json");
    if (!fs.existsSync(pkgJson)) continue;
    const exportsMap = JSON.parse(fs.readFileSync(pkgJson, "utf8")).exports;
    for (const leaf of exportTargetLeaves(exportsMap)) {
      patterns.push(`^${escapeRegExpPath(`${packagesRoot}/${name}/${leaf}`)}$`);
    }
  }
  return patterns;
}

module.exports = { escapeRegExpPath, exportTargetLeaves, exportedEntryPointPatterns };
