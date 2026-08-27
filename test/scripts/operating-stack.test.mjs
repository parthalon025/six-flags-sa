#!/usr/bin/env node
/**
 * Operating stack — factory-epic NOW + operate/park lists.
 *
 *   node test/scripts/operating-stack.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  doNotAddIds,
  epicNowCli,
  epicNowLine,
  factoryEpicNow,
  loadOperatingStack,
  parkedIds,
  shouldPrintEpicNow,
} from '../../scripts/lib/operating-stack.mjs';
import { sessionBrief } from '../../scripts/lib/matt-workflow.mjs';

const spec = loadOperatingStack();

assert.equal(spec.effort, 'factories-to-app');
assert.equal(spec.adr, 'docs/adr/0024-postdb-factory-bus.md');

const now = factoryEpicNow(spec);
assert.equal(now.ticket, '21');
assert.equal(now.stackedOn, '15');
assert.deepEqual(now.then, []);
assert.equal(now.status, 'resolved');
assert.deepEqual(now.mergePending, []);
assert.ok(now.doNotStart.includes('train-h'));
assert.ok(now.doNotStart.includes('train-i'));
assert.match(epicNowLine(spec), /ticket 21/);
assert.match(epicNowLine(spec), /merged to main/);

assert.equal(shouldPrintEpicNow('factories-to-app', spec), true);
assert.equal(shouldPrintEpicNow(null, spec), true);
assert.equal(shouldPrintEpicNow('other-effort', spec), false);
assert.match(epicNowCli(spec), /^epic:    ticket 21/);
assert.match(epicNowCli(spec), /operating-stack\.json/);

const parked = parkedIds(spec);
assert.ok(parked.includes('databricks'));
assert.ok(parked.includes('cloudflare-r2'));
assert.ok(!parked.includes('docker-postgres'));

const blocked = doNotAddIds(spec);
assert.ok(blocked.includes('openai-api'));
assert.ok(blocked.includes('lakebase'));
assert.ok(blocked.includes('resend'));

assert.ok(spec.operate.some((row) => row.id === 'docker-postgres'));
assert.ok(spec.operate.some((row) => row.id === 'vercel-neon'));
assert.ok(spec.attachOnce.some((row) => row.id === 'neon-marketplace'));

const scratch = mkdtempSync(join(tmpdir(), 'op-stack-'));
const root = join(scratch, 'repo');
mkdirSync(join(root, '.scratch', 'factories-to-app', 'issues'), { recursive: true });
writeFileSync(join(root, '.scratch/factories-to-app/spec.md'), '# Spec\n');
writeFileSync(
  join(root, '.scratch/factories-to-app/issues/16-delivery.md'),
  `# 16: Delivery export

**What to build:** export
**Blocked by:** None
**Status:** claimed
`,
);
const brief = sessionBrief({ cwd: root, effort: 'factories-to-app' });
assert.match(brief, /ticket 21/);
assert.match(brief, /operating-stack\.json/);
assert.match(brief, /Do not start Trains H\/I/);

mkdirSync(join(root, '.scratch', 'other-effort', 'issues'), { recursive: true });
writeFileSync(join(root, '.scratch/other-effort/spec.md'), '# Spec\n');
writeFileSync(
  join(root, '.scratch/other-effort/issues/11-first.md'),
  `# 11: First

**What to build:** slice
**Blocked by:** None
**Status:** ready-for-agent
`,
);
const other = sessionBrief({ cwd: root, effort: 'other-effort' });
assert.doesNotMatch(other, /operating-stack\.json/);

const emptyRoot = join(scratch, 'empty');
mkdirSync(emptyRoot, { recursive: true });
const emptyBrief = sessionBrief({ cwd: emptyRoot });
assert.match(emptyBrief, /ticket 21/);
assert.match(emptyBrief, /operating-stack\.json/);

rmSync(scratch, { recursive: true, force: true });
console.log('operating-stack tests ok');
