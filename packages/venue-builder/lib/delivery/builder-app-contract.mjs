/**
 * Builder ↔ app contract — bind generated venue output to a reindex stamp.
 *
 * Policy: docs/agents/policies/builder-app-contract.md
 *
 * Interface:
 *   collectGeneratedFileHashes(root)
 *   buildGeneratedBinding(root)
 *   bindingDecision({ binding, files })
 *   checkBuilderAppContract(root)
 *   builderAppContractFailureHint()
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MONO_ROOT } from '../../src/paths.mjs';

const ALGORITHM = 'sha256-aggregate-v1';
const VENUES_PUBLIC = join('apps', 'party-tracker', 'public', 'venues');
const INDEX_REL = join('apps', 'party-tracker', 'lib', 'venueIndex.js');
const MANIFEST_REL = join(VENUES_PUBLIC, 'manifest.json');

export const BUILDER_APP_CONTRACT_POLICY = 'docs/agents/policies/builder-app-contract.md';

/** Gate failure text — names the policy and legitimate regeneration commands. */
export function builderAppContractFailureHint() {
  return `generated venue output no longer matches its builder binding — run npm run venues:reindex, venues:build, or venues:rebuild (see ${BUILDER_APP_CONTRACT_POLICY})`;
}

const repoRoot = () => MONO_ROOT;

const sha256File = (abs) =>
  createHash('sha256').update(readFileSync(abs)).digest('hex');

const sha256ManifestSansBinding = (abs) => {
  const data = JSON.parse(readFileSync(abs, 'utf8'));
  const { generatedBinding: _drop, ...rest } = data;
  return createHash('sha256').update(`${JSON.stringify(rest)}\n`).digest('hex');
};

/** Every generated file the builder-app contract names, with per-file sha256. */
export function collectGeneratedFileHashes(root = repoRoot()) {
  const files = [];
  const venuesDir = join(root, VENUES_PUBLIC);
  if (!existsSync(venuesDir)) return files;

  for (const name of readdirSync(venuesDir).sort()) {
    if (!/\.(map|pois|gaps)\.json$/.test(name)) continue;
    const rel = join(VENUES_PUBLIC, name).replace(/\\/g, '/');
    files.push({ path: rel, sha256: sha256File(join(venuesDir, name)) });
  }

  const indexAbs = join(root, INDEX_REL);
  if (existsSync(indexAbs)) {
    files.push({ path: INDEX_REL.replace(/\\/g, '/'), sha256: sha256File(indexAbs) });
  }

  const manifestAbs = join(root, MANIFEST_REL);
  if (existsSync(manifestAbs)) {
    files.push({
      path: MANIFEST_REL.replace(/\\/g, '/'),
      sha256: sha256ManifestSansBinding(manifestAbs),
    });
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function aggregateBindingSha256(files) {
  const body = files
    .map((f) => `${f.path}\0${f.sha256}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(body).digest('hex');
}

/** Stamp written into manifest.json at reindex. */
export function buildGeneratedBinding(root = repoRoot()) {
  const files = collectGeneratedFileHashes(root);
  return {
    algorithm: ALGORITHM,
    sha256: aggregateBindingSha256(files),
    files,
  };
}

/** Pure. Does the stamped binding still describe the bytes on disk? */
export function bindingDecision({ binding, files }) {
  if (!binding?.sha256 || binding?.algorithm !== ALGORITHM) {
    return { ok: false, drifted: [], missing: [], unstamped: true };
  }
  const want = new Map((binding.files || []).map((f) => [f.path, f.sha256]));
  const drifted = [];
  const missing = [];
  for (const file of files) {
    const pinned = want.get(file.path);
    if (!pinned) {
      missing.push(file.path);
      continue;
    }
    if (pinned !== file.sha256) drifted.push(file.path);
  }
  for (const path of want.keys()) {
    if (!files.some((f) => f.path === path)) missing.push(path);
  }
  const aggregateOk = aggregateBindingSha256(files) === binding.sha256;
  return {
    ok: drifted.length === 0 && missing.length === 0 && aggregateOk,
    drifted,
    missing,
    unstamped: false,
  };
}

/** Whole gate — what CI asserts. */
export function checkBuilderAppContract(root = repoRoot()) {
  const files = collectGeneratedFileHashes(root);
  const manifestAbs = join(root, MANIFEST_REL);
  const manifest = existsSync(manifestAbs)
    ? JSON.parse(readFileSync(manifestAbs, 'utf8'))
    : null;
  const decision = bindingDecision({ binding: manifest?.generatedBinding, files });
  return { ...decision, files };
}
