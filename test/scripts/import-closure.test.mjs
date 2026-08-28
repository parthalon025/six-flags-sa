#!/usr/bin/env node
/**
 * computeImportClosure — sanity-checked against small fixture module graphs
 * before trusting it for the venue-builder .vercelignore assertions
 * (test/scripts/vercelignore-venue-builder.test.mjs).
 *
 *   node test/scripts/import-closure.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeImportClosure } from '../../scripts/lib/import-closure.mjs';

const dir = mkdtempSync(join(tmpdir(), 'import-closure-'));
{
  writeFileSync(
    join(dir, 'a.mjs'),
    [
      "import { b } from './b.mjs';",
      "export { c } from './sub/c.mjs';",
      "import fs from 'node:fs';",
      "const dyn = () => import('./sub/d.mjs');",
      "const req = () => require('./e.mjs');",
      "import external from 'some-package';",
    ].join('\n'),
  );
  writeFileSync(join(dir, 'b.mjs'), "export const b = 1;\n");
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'sub/c.mjs'), "export const c = 1;\n");
  writeFileSync(join(dir, 'sub/d.mjs'), "export const d = 1;\n");
  writeFileSync(join(dir, 'e.mjs'), "module.exports = 1;\n");

  const closure = computeImportClosure({ root: dir, entries: ['a.mjs'] });

  assert.deepEqual(
    closure.files,
    ['a.mjs', 'b.mjs', 'e.mjs', 'sub/c.mjs', 'sub/d.mjs'],
    'must follow static import, export-from, dynamic import(), and require()',
  );
  assert.deepEqual(closure.external, ['some-package'], 'bare specifiers are reported, not followed');
  assert.deepEqual(closure.unresolved, [], 'every relative import here resolves');
}

{
  writeFileSync(join(dir, 'broken.mjs'), "import { x } from './does-not-exist.mjs';\n");
  const closure = computeImportClosure({ root: dir, entries: ['broken.mjs'] });
  assert.equal(closure.unresolved.length, 1, 'a dangling relative import must be reported, not silently dropped');
  assert.match(closure.unresolved[0], /does-not-exist\.mjs/);
}

{
  // A cycle must not hang the walker.
  writeFileSync(join(dir, 'cyc1.mjs'), "import './cyc2.mjs';\n");
  writeFileSync(join(dir, 'cyc2.mjs'), "import './cyc1.mjs';\n");
  const closure = computeImportClosure({ root: dir, entries: ['cyc1.mjs'] });
  assert.deepEqual(closure.files, ['cyc1.mjs', 'cyc2.mjs']);
}

{
  // A specifier that only appears inside a string literal (generated code,
  // not a real import) must not be treated as a resolution failure — it
  // lands in `external`, same as any other non-relative-looking text this
  // line-oriented scan cannot fully disambiguate from a real import.
  writeFileSync(
    join(dir, 'stringy.mjs'),
    "export const code = \"import manifest from '@/public/venues/manifest.json';\";\n",
  );
  const closure = computeImportClosure({ root: dir, entries: ['stringy.mjs'] });
  assert.deepEqual(closure.unresolved, []);
  assert.ok(closure.external.includes('@/public/venues/manifest.json'));
}

rmSync(dir, { recursive: true, force: true });

console.log('import-closure: ok');
