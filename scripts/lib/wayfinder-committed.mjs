/**
 * Committed wayfinder efforts — allowlisted `.scratch/<slug>/` trees tracked in git
 * so macro / Cloud resume can see fog without session-local-only maps.
 *
 * Interface:
 *   listCommittedWayfinderSlugs() => string[]
 *   wayfinderEffortTracked(root, slug) => { ok: boolean, reason?: string }
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = join(here, '../..');

let config;
function loadConfig() {
  if (!config) {
    config = JSON.parse(readFileSync(join(here, 'wayfinder-committed.json'), 'utf8'));
  }
  return config;
}

export function listCommittedWayfinderSlugs() {
  return [...loadConfig().efforts];
}

export function wayfinderEffortTracked(root, slug) {
  const mapRel = join('.scratch', slug, 'map.md');
  const mapAbs = join(root, mapRel);
  if (!existsSync(mapAbs)) {
    return { ok: false, reason: `missing map: ${mapRel}` };
  }
  try {
    execFileSync('git', ['check-ignore', '-q', mapRel], { cwd: root });
    return { ok: false, reason: `${mapRel} is gitignored` };
  } catch {
    return { ok: true };
  }
}
