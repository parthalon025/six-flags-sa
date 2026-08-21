/**
 * Compose the generated front-end map.
 *
 * Sources of truth: apps/party-tracker/app/page.js, components/*.jsx,
 * app/globals.css, lib/*.js, docs/agents/policies/builder-app-contract.md.
 * Generated output: docs/agents/frontend-map.md
 *
 * Same shape as scripts/lib/design-bundle/compose.mjs and
 * scripts/lib/agent-docs/compose.mjs — compose to a Map<relPath, contents>,
 * then write it or diff it — so `frontend:map:check` behaves the way
 * `design:check` and `agent-docs:check` already do.
 *
 * The one difference is what a failure means. `design:check` fails only when
 * the committed bundle is stale, and echoes the app's own problems without
 * failing on them, because it is a mirror. This one is a gate as well as a
 * mirror: a diverged constant fails it. `--peek` at 308 against a
 * SHEET_PEEK_PX of 236 shipped once and no test noticed, which is the argument
 * for the difference.
 *
 * Interface:
 *   buildModel()      → everything the page is rendered from
 *   composeMap()      → { outputs: Map<relPath, contents>, model }
 *   writeMap()        → { written, model }
 *   checkMap()        → { drift, model }  (drift empty when fresh)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import {
  root,
  SOURCES,
  readScreens,
  readClasses,
  readPairs,
  readFactory,
  readOrphans,
} from './sources.mjs';
import { measureContrast } from './contrast.mjs';
import { renderMap } from './render.mjs';

export const OUT_PATH = 'docs/agents/frontend-map.md';

export async function buildModel() {
  const screens = readScreens();
  const classes = readClasses();
  const pairs = await readPairs();
  const factory = readFactory();
  const orphans = readOrphans();
  const contrast = measureContrast();

  /* One list of everything that could not be derived, gathered from the
     readers rather than restated. The design import's screen map had no such
     list, which is exactly why nobody could tell it had gone stale. */
  const gaps = [...screens.gaps, ...pairs.gaps];

  return {
    screens,
    classes,
    pairs,
    factory,
    orphans,
    contrast,
    gaps,
    page: SOURCES.page,
    sources: Object.values(SOURCES),
    /* Links are written relative to where the page lands, not to the repo
       root, so a reader following one in a Markdown viewer arrives at the
       policy rather than at a 404. */
    link: (rel) => relative(dirname(OUT_PATH), rel),
  };
}

export async function composeMap() {
  const model = await buildModel();
  return { outputs: new Map([[OUT_PATH, renderMap(model)]]), model };
}

export async function writeMap() {
  const { outputs, model } = await composeMap();
  for (const [rel, contents] of outputs) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), contents, 'utf8');
  }
  return { written: [...outputs.keys()], model };
}

export async function checkMap() {
  const { outputs, model } = await composeMap();
  const drift = [];
  /* Line endings, not content: a Windows checkout would otherwise report every
     line of the file as drift. Same normalisation design-bundle uses. */
  const normalize = (s) => s.replace(/\r\n/g, '\n');

  for (const [rel, expected] of outputs) {
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      drift.push({ path: rel, reason: 'missing' });
      continue;
    }
    if (normalize(readFileSync(abs, 'utf8')) !== normalize(expected)) {
      drift.push({ path: rel, reason: 'content drift' });
    }
  }
  return { drift, model };
}
