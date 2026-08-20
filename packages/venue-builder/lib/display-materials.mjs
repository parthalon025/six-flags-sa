/**
 * Compiled material textures — the visual factory's first real PBR pass
 * (ADR-0016 amendment: bake-side textures now, the runtime three.js/KTX2
 * tier stays deferred per ADR-0013 item 4).
 *
 * The MaterialSet ledger (data/display/materials.json) has always described
 * texture sets it never fetched. bin/display-materials.mjs fetches each
 * row's real CC0 set from its declared source (ambientCG today), compiles
 * the albedo (plus normal/roughness when the source ships them) down to
 * MATERIAL_COMPILE_PX, and writes the bytes under assets/vendor/materials/
 * with sha256 pins in the ledger row's `compiled` block — the exact
 * fetch-once-by-hand, verify-in-CI discipline of bin/vendor-assets.mjs.
 *
 * A source that cannot be fetched (authored material-maker graphs, an
 * unreachable mirror) records a `compiled.gap` reason instead — the
 * missing-tippecanoe pattern: a named factory gap, never a failed build.
 * Certification's material_textures_resolve row keeps the distinction
 * honest: a recorded gap passes with the gap on the record; bytes that a
 * row claims but that are missing or drifted fail.
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { BUILDER_ROOT } from './venue-io.mjs';
import { check } from './evidence.mjs';

/** Committed compile budget, px. The ledger's declared `resolution` keeps
 *  its own ≤1024 gate; compiled bytes stay small enough to vendor. */
export const MATERIAL_COMPILE_PX = 512;

/** Maps that compile when the source ships them; basecolor is the floor. */
export const COMPILED_MAPS = ['basecolor', 'normal', 'roughness'];

/** Where compiled bytes live, relative to the builder package root. */
export const COMPILED_DIR = path.join('assets', 'vendor', 'materials');

export const compiledPath = (rel) => path.join(BUILDER_ROOT, rel);

/**
 * Verify every ledger row's compiled block. Returns
 *   resolved: ids whose basecolor bytes are on disk and match their pin
 *   gaps:     id → recorded reason (never compiled, or a compiled.gap row)
 *   problems: rows that CLAIM bytes which are missing or drifted
 */
export function verifyCompiledMaterials(materials) {
  const resolved = [];
  const gaps = {};
  const problems = [];
  for (const [id, row] of Object.entries(materials)) {
    const compiled = row.compiled;
    if (!compiled) {
      gaps[id] = 'never compiled — run venues:materials --fetch';
      continue;
    }
    if (compiled.gap) {
      gaps[id] = compiled.gap;
      continue;
    }
    if (!compiled.basecolor?.path) {
      problems.push(`${id}: compiled block carries no basecolor map`);
      continue;
    }
    let ok = true;
    for (const map of COMPILED_MAPS) {
      const entry = compiled[map];
      if (!entry) continue;
      const file = compiledPath(entry.path);
      if (!existsSync(file)) {
        problems.push(`${id}: compiled ${map} missing at ${entry.path} — run venues:materials --fetch`);
        ok = false;
        continue;
      }
      const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
      if (sha !== entry.sha256) {
        problems.push(`${id}: compiled ${map} sha256 drift (${sha.slice(0, 12)}… ≠ pinned)`);
        ok = false;
      }
    }
    if (ok) resolved.push(id);
  }
  return { resolved, gaps, problems };
}

/**
 * The certification row: every material a spec binds either resolves its
 * compiled textures on disk (pin-verified) or carries a recorded factory
 * gap. license_gate's neighborhood — provenance on pixels, not promises.
 *
 * @param {{ spec: object, report: {resolved: string[], gaps: object, problems: string[]} }} deps
 */
export function materialTexturesRow({ spec, report }) {
  const bound = [...new Set(Object.values(spec.surfaces || {}).map((row) => row.material))];
  const broken = report.problems.filter((p) => bound.some((id) => p.startsWith(`${id}:`)));
  const gapped = bound.filter((id) => report.gaps[id]);
  const resolvedCount = bound.filter((id) => report.resolved.includes(id)).length;
  return check({
    key: 'material_textures_resolve',
    claim: 'every bound material’s compiled textures resolve on disk (pin-verified), or the gap is recorded',
    pass: broken.length === 0,
    evidence: broken.length
      ? broken.join('; ')
      : `${resolvedCount}/${bound.length} bound materials compiled${gapped.length ? `; recorded gaps: ${gapped.map((id) => `${id} (${report.gaps[id]})`).join(', ')}` : ''}`,
    confidence: 'high',
    falsifier: 'a ledger row claiming compiled bytes that are missing or sha-drifted',
    soWhat: 'a bake told to tile a texture that is not there paints the authored flat and silently stops matching its certified look',
  });
}
