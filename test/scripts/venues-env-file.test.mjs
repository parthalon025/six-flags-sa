#!/usr/bin/env node
/**
 * venues:* npm scripts must load .env — regression guard for #464.
 *
 *   node test/scripts/venues-env-file.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '../../..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const venuesScripts = Object.entries(pkg.scripts).filter(([name]) => name.startsWith('venues:'));

assert.ok(venuesScripts.length > 0, 'expected at least one venues:* script in package.json');

for (const [name, command] of venuesScripts) {
  assert.match(
    command,
    /^node --env-file-if-exists=\.env /,
    `"${name}" must run via "node --env-file-if-exists=.env ..." so adapters see .env-provided secrets (MAPILLARY_TOKEN, ORS_API_KEY, ...) — got: ${command}`,
  );
}

console.log(`venues-env-file: ok (${venuesScripts.length} venues:* scripts load .env)`);
