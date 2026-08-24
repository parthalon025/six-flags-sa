#!/usr/bin/env node
/**
 * Issue #571 — GlanceRail was unmounted; component and dead `.glance*` CSS go together.
 *
 * Seam: repo hygiene (file absent, no imports, no dead selectors in globals.css).
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNMOUNTED } from '../../scripts/lib/design-bundle/sources.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const app = join(root, 'apps/party-tracker');
const glanceRail = join(app, 'components/GlanceRail.jsx');
const globalsCss = join(app, 'app/globals.css');

assert.equal(existsSync(glanceRail), false, 'GlanceRail.jsx should be deleted (#571)');

let imports = '';
try {
  imports = execFileSync(
    'grep',
    ['-rn', 'GlanceRail', app, '--include=*.js', '--include=*.jsx'],
    { encoding: 'utf8' },
  ).trim();
} catch (err) {
  if (err.status !== 1) throw err;
}
assert.equal(imports, '', 'no GlanceRail references should remain in app source');

const css = readFileSync(globalsCss, 'utf8');
const deadSelectors = css.match(/^\.glance[A-Z][\w-]*/gm) ?? [];
assert.deepEqual(
  deadSelectors,
  [],
  `globals.css should have no .glance* selector rules; found: ${deadSelectors.join(', ')}`,
);

assert.equal(
  UNMOUNTED.some(([file]) => file.includes('GlanceRail')),
  false,
  'UNMOUNTED should not list a deleted component',
);

console.log('glance-rail-removal: ok');
