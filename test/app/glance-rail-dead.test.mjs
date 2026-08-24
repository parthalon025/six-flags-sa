#!/usr/bin/env node
/**
 * GlanceRail was unmounted from Explore; the component and its CSS must not
 * ship. Issue #571 — one revert should not leave half the corpse behind.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const app = join(root, 'apps/party-tracker');
const component = join(app, 'components/GlanceRail.jsx');
const css = readFileSync(join(app, 'app/globals.css'), 'utf8');

const PASS = [];
const FAIL = [];
const check = (name, fn) => {
  try {
    fn();
    PASS.push(name);
    console.log('  PASS', name);
  } catch (err) {
    FAIL.push(`${name} :: ${err.message}`);
    console.log('  FAIL', name, '->', err.message);
  }
};

console.log('\n--- glance-rail dead ---');

check('GlanceRail.jsx is deleted', () => {
  assert.equal(existsSync(component), false, component);
});

check('no app import mounts GlanceRail', () => {
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.name === 'node_modules' || name.name === '.next') continue;
      const path = join(dir, name.name);
      if (name.isDirectory()) walk(path);
      else if (/\.(js|jsx|mjs)$/.test(name.name)) {
        const src = readFileSync(path, 'utf8');
        if (/GlanceRail/.test(src)) hits.push(path.slice(root.length + 1));
      }
    }
  };
  walk(app);
  assert.deepEqual(hits, [], `GlanceRail still referenced in: ${hits.join(', ')}`);
});

check('globals.css has no live .glance* selectors', () => {
  const rules = [...css.matchAll(/^\s*(\.glance[A-Za-z][\w-]*)/gm)].map((m) => m[1]);
  assert.deepEqual(rules, [], `dead glance selectors remain: ${[...new Set(rules)].join(', ')}`);
});

check('orphan glance keyframes are gone', () => {
  assert.doesNotMatch(css, /@keyframes railIn/);
  assert.doesNotMatch(css, /@keyframes alertRing/);
});

check('shared tap-target rules no longer mention glanceGo', () => {
  assert.doesNotMatch(css, /\.glanceGo/);
  assert.doesNotMatch(css, /\.glanceRail/);
});

console.log(`\nglance-rail-dead: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) {
  console.error(FAIL.join('\n'));
  process.exit(1);
}
