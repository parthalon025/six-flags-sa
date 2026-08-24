#!/usr/bin/env node
/**
 * Issue #571 — GlanceRail was unmounted; component and `.glance*` paint must not remain.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '../..');
const appRoot = join(root, 'apps/party-tracker');
const glanceRailPath = join(appRoot, 'components/GlanceRail.jsx');
const globalsCss = readFileSync(join(appRoot, 'app/globals.css'), 'utf8');
const navKeySource = readFileSync(join(appRoot, 'lib/navKey.js'), 'utf8');

assert.equal(existsSync(glanceRailPath), false, 'GlanceRail.jsx is deleted');

const grepGlanceRail = () => {
  try {
    return execFileSync(
      'grep',
      ['-rn', 'GlanceRail', appRoot, '--include=*.js', '--include=*.jsx'],
      { encoding: 'utf8' },
    ).trim();
  } catch (err) {
    if (err.status === 1) return '';
    throw err;
  }
};
assert.equal(grepGlanceRail(), '', 'no GlanceRail references remain in JS/JSX');

assert.doesNotMatch(navKeySource, /GlanceRail/, 'navKey.js does not mention GlanceRail');

for (const deadSelector of ['.glanceRail {', '.glanceCard {', '.glanceGo {', '.glanceHit {']) {
  assert.doesNotMatch(globalsCss, new RegExp(deadSelector.replace('.', '\\.')), `${deadSelector} CSS block removed`);
}

assert.doesNotMatch(globalsCss, /\.sheet\.full \.glanceCard/, 'orphan .sheet.full .glanceCard removed');
assert.doesNotMatch(globalsCss, /\.glanceGo::after/, '.glanceGo pruned from shared tap-target selectors');
assert.doesNotMatch(globalsCss, /\.glanceRail, \.previewAlts/, '.glanceRail pruned from scrollbar rule');

console.log('PASS glance-rail-cleanup');
