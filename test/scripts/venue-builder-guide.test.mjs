/**
 * venue-builder.md must stay aligned with build-pipeline.mjs stage names and flags (#431).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGES } from '../../packages/venue-builder/lib/build-pipeline.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..', '..');
const guide = readFileSync(join(root, 'docs/guide/venue-builder.md'), 'utf8');

assert.match(guide, /### Unified pipeline stages/);

for (const stage of STAGES) {
  assert.match(
    guide,
    new RegExp(`\\|\\s*${stage}\\s*\\|`),
    `venue-builder guide table missing stage row: ${stage}`,
  );
}

assert.match(guide, /--allow-no-heights/);
assert.match(guide, /--no-certify/);
assert.match(guide, /--display/);
assert.match(guide, /build-top-parks/);
assert.match(guide, /Build a venue/);

console.log('venue-builder-guide.test: ok');
