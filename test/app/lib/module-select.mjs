/**
 * Change-scoped test module selection.
 *
 * Pure helpers — used by select-modules.mjs, validate-ui.mjs, and CI.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = path.join(HERE, '../modules.json');

export function loadModulesManifest(manifestPath = DEFAULT_MANIFEST) {
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

/** Convert a simple glob (`**`, `*`) to a RegExp anchored to the full path. */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      const next = glob[i + 2];
      if (next === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') {
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else if ('\\.[]{}()+-^$|'.includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

export function pathMatches(file, pattern) {
  const norm = file.replace(/\\/g, '/').replace(/^\.\//, '');
  const pat = pattern.replace(/\\/g, '/');
  return globToRegExp(pat).test(norm);
}

export function pathMatchesAny(file, patterns = []) {
  return patterns.some((p) => pathMatches(file, p));
}

/**
 * Parse `--modules=a,b` / `--modules a,b` / env TEST_MODULES.
 * Empty / `all` → run everything.
 */
export function parseModulesArg(argv = process.argv.slice(2), env = process.env) {
  const fromEnv = (env.TEST_MODULES || '').trim();
  let raw = fromEnv;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--modules' || a === '--module') {
      raw = argv[i + 1] || '';
      break;
    }
    if (a.startsWith('--modules=')) {
      raw = a.slice('--modules='.length);
      break;
    }
    if (a.startsWith('--module=')) {
      raw = a.slice('--module='.length);
      break;
    }
  }
  if (!raw || raw === 'all' || raw === '*') return null; // null = all
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(ids);
}

export function wantModule(selected, id) {
  if (!selected) return true;
  if (selected.has('all') || selected.has('*')) return true;
  return selected.has(id);
}

export function listModuleIds(manifest, { kind } = {}) {
  return manifest.modules
    .filter((m) => (kind ? m.kind === kind : true))
    .map((m) => m.id);
}

/**
 * Select modules from a list of changed file paths.
 * Returns { modules: string[], reasons: Record<string,string>, fullSuite: boolean }
 */
export function selectModulesFromFiles(files, manifest = loadModulesManifest()) {
  const normFiles = files.map((f) => f.replace(/\\/g, '/').replace(/^\.\//, ''));
  const reasons = {};
  const selected = new Set();

  const fullHit = normFiles.find((f) => pathMatchesAny(f, manifest.fullSuitePaths || []));
  if (fullHit) {
    for (const m of manifest.modules) {
      selected.add(m.id);
      reasons[m.id] = `full suite trigger: ${fullHit}`;
    }
    return { modules: [...selected], reasons, fullSuite: true };
  }

  for (const m of manifest.modules) {
    if (m.always) {
      selected.add(m.id);
      reasons[m.id] = 'always';
      continue;
    }
    const hit = normFiles.find((f) => pathMatchesAny(f, m.paths || []));
    if (hit) {
      selected.add(m.id);
      reasons[m.id] = hit;
    }
  }

  // Broad app/test touch with no module-specific hit → run the UI default set.
  const ui = manifest.uiDefaultWhenAppTouches;
  if (ui?.paths?.length) {
    const appTouch = normFiles.find((f) => pathMatchesAny(f, ui.paths));
    if (appTouch) {
      const functionalOrGrandma = manifest.modules.filter(
        (m) => m.kind === 'functional' || m.kind === 'grandma',
      );
      const anySpecific = functionalOrGrandma.some((m) => selected.has(m.id));
      if (!anySpecific) {
        for (const id of ui.modules || []) {
          selected.add(id);
          reasons[id] = reasons[id] || `app touch default: ${appTouch}`;
        }
      }
    }
  }

  // Companion modules (e.g. party → grandma).
  let grew = true;
  while (grew) {
    grew = false;
    for (const m of manifest.modules) {
      if (!selected.has(m.id) || !m.pulls?.length) continue;
      for (const id of m.pulls) {
        if (!selected.has(id)) {
          selected.add(id);
          reasons[id] = reasons[id] || `pulled by ${m.id}`;
          grew = true;
        }
      }
    }
  }

  // Contract always.
  if (!selected.has('contract')) {
    selected.add('contract');
    reasons.contract = 'always';
  }

  return { modules: [...selected], reasons, fullSuite: false };
}

export function partitionModules(moduleIds, manifest = loadModulesManifest()) {
  const byId = new Map(manifest.modules.map((m) => [m.id, m]));
  const out = {
    contract: false,
    builder: false,
    functional: [],
    grandma: false,
    unknown: [],
  };
  for (const id of moduleIds) {
    const m = byId.get(id);
    if (!m) {
      out.unknown.push(id);
      continue;
    }
    if (m.kind === 'contract') out.contract = true;
    else if (m.kind === 'builder') out.builder = true;
    else if (m.kind === 'functional') out.functional.push(id);
    else if (m.kind === 'grandma') out.grandma = true;
  }
  return out;
}

/** GitHub Actions step outputs helper. */
export function toGithubOutputs(selection, manifest = loadModulesManifest()) {
  const parts = partitionModules(selection.modules, manifest);
  const uiMatrix = [...parts.functional];
  if (parts.grandma) uiMatrix.push('grandma');
  return {
    builder: parts.builder ? 'true' : 'false',
    contract: parts.contract ? 'true' : 'false',
    any_ui: uiMatrix.length ? 'true' : 'false',
    ui_matrix: JSON.stringify(uiMatrix),
    functional_modules: parts.functional.join(',') || '',
    modules: selection.modules.join(','),
    full_suite: selection.fullSuite ? 'true' : 'false',
  };
}
