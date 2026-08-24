#!/usr/bin/env node
/**
 * GlanceRail cleanup — the unmounted component and its `.glance*` paint must
 * leave together so grep and the shipped bundle stop advertising dead UI.
 *
 *   node test/scripts/glance-rail-dead-code.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const appRoot = join(root, 'apps/party-tracker');
const componentPath = join(appRoot, 'components/GlanceRail.jsx');
const globalsCss = readFileSync(join(appRoot, 'app/globals.css'), 'utf8');

const GLANCE_CLASS_RE = /\.glance[A-Z][a-zA-Z]*/g;
const SOURCE_EXTS = new Set(['.js', '.jsx', '.mjs']);

/** Walk party-tracker source for import/mount references. */
function partyTrackerSources(dir = appRoot, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === 'node_modules' || name.name === '.next') continue;
    const path = join(dir, name.name);
    if (name.isDirectory()) partyTrackerSources(path, out);
    else if (SOURCE_EXTS.has(path.slice(path.lastIndexOf('.')))) out.push(path);
  }
  return out;
}

assert.equal(
  existsSync(componentPath),
  false,
  'GlanceRail.jsx must be deleted — Explore is search → context → list',
);

for (const path of partyTrackerSources()) {
  const text = readFileSync(path, 'utf8');
  assert.doesNotMatch(
    text,
    /\bGlanceRail\b/,
    `${path.replace(`${root}/`, '')} must not reference GlanceRail`,
  );
}

const cssWithoutComments = globalsCss.replace(/\/\*[\s\S]*?\*\//g, '');
const glanceClasses = [...cssWithoutComments.matchAll(GLANCE_CLASS_RE)].map((m) => m[0]);
assert.deepEqual(
  glanceClasses,
  [],
  'globals.css must not ship `.glance*` class rules',
);

console.log('glance-rail-dead-code: ok');
