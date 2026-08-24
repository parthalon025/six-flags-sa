#!/usr/bin/env node
/**
 * GlanceRail was unmounted when Explore became search → context → list (#571).
 * The component and its `.glance*` paint must not linger — dead code that still
 * ships misleads readers and future agents.
 *
 *   node test/scripts/glance-rail-cleanup.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = path.join(REPO, 'apps/party-tracker');
const GLANCE_RAIL = path.join(APP, 'components/GlanceRail.jsx');
const GLOBALS = path.join(APP, 'app/globals.css');

assert.equal(
  existsSync(GLANCE_RAIL),
  false,
  'GlanceRail.jsx must be deleted — nothing imports or mounts it',
);

const globals = readFileSync(GLOBALS, 'utf8');
const glanceSelectors = [...globals.matchAll(/^[ \t]*\.glance[A-Za-z][\w-]*/gm)].map((m) => m[0].trim());
assert.deepEqual(
  glanceSelectors,
  [],
  `globals.css must not ship dead .glance* selectors (found: ${[...new Set(glanceSelectors)].join(', ')})`,
);

const sourceFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') walk(full);
    else if (/\.(js|jsx|mjs)$/.test(entry.name)) sourceFiles.push(full);
  }
};
walk(APP);

const importers = sourceFiles.filter((file) => {
  const text = readFileSync(file, 'utf8');
  return /\bGlanceRail\b/.test(text);
});
assert.deepEqual(
  importers,
  [],
  `no source file may reference GlanceRail (found in: ${importers.map((f) => path.relative(REPO, f)).join(', ')})`,
);

console.log('glance-rail-cleanup: ok');
