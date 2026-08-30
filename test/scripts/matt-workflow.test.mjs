#!/usr/bin/env node
/**
 * Matt workflow probes — phase derives from scratch artifacts.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkIntent,
  effortPhase,
  frontier,
  listEfforts,
  workflowBlockReason,
  loadTickets,
  parseTicket,
  sessionBrief,
} from '../../scripts/lib/matt-workflow.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'matt-wf-'));
const root = join(scratch, 'repo');
mkdirSync(join(root, '.scratch', 'fog-effort', 'issues'), { recursive: true });
mkdirSync(join(root, '.scratch', 'ready-effort', 'issues'), { recursive: true });

writeFileSync(
  join(root, '.scratch/fog-effort/map.md'),
  '# Map\n\n## Not yet specified\n\n- **Open question**\n',
);
writeFileSync(
  join(root, '.scratch/fog-effort/issues/01-grill.md'),
  '# 01: Open grill\n\n**Type:** grilling\n**Blocked by:** None\n**Status:** open\n',
);

writeFileSync(join(root, '.scratch/ready-effort/spec.md'), '# Spec\n');
writeFileSync(
  join(root, '.scratch/ready-effort/issues/11-first.md'),
  `# 11: First slice

**What to build:** end-to-end slice
**Blocked by:** None
**Status:** ready-for-agent

- [ ] done
`,
);

assert.equal(listEfforts(root).length, 2);

const fog = effortPhase('fog-effort', root);
assert.equal(fog.phase, 'wayfinder');

const ready = effortPhase('ready-effort', root);
assert.equal(ready.phase, 'implement');
assert.equal(ready.frontier?.id, '11');

const blocked = checkIntent({ cwd: root, effort: 'fog-effort', intent: 'implement' });
assert.equal(blocked.ok, false);
assert.match(blocked.message, /wayfinder/i);

const allowed = checkIntent({ cwd: root, effort: 'ready-effort', intent: 'implement' });
assert.equal(allowed.ok, true);

const brief = sessionBrief({ cwd: root, effort: 'ready-effort' });
assert.match(brief, /implement/);
assert.match(brief, /wayfinder/); // flow section

const ticket = parseTicket(join(root, '.scratch/ready-effort/issues/11-first.md'));
assert.equal(ticket.status, 'ready-for-agent');
assert.deepEqual(ticket.blockedBy, []);

const tickets = loadTickets(join(root, '.scratch/ready-effort'));
assert.equal(frontier(tickets)?.id, '11');

/* The pre-merge gate. It exists so builder code cannot be implemented while the
   effort driving it is still foggy — not so that one parked effort freezes every
   other. The tree here holds both: fog-effort forbids implement, ready-effort
   allows it. */
const builder = ['packages/venue-builder/lib/venue-io.mjs'];

// A diff that touches no builder code is none of this gate's business.
assert.equal(workflowBlockReason({ files: ['apps/party-tracker/lib/mapView.js'], cwd: root }), null);

// The bug: an effort parked at an early phase blocked builder work belonging to a
// different effort that was ready. With a ready effort in the tree, do not block.
assert.equal(
  workflowBlockReason({ files: builder, cwd: root }),
  null,
  'builder work must not be frozen by some other effort still at an early phase — '
    + 'ready-effort allows implement, so there is an effort this change can belong to',
);

// The guarantee that must survive: when nothing is ready, the gate still blocks.
const onlyFog = mkdtempSync(join(tmpdir(), 'matt-wf-fog-'));
mkdirSync(join(onlyFog, '.scratch', 'fog-effort', 'issues'), { recursive: true });
writeFileSync(join(onlyFog, '.scratch', 'fog-effort', 'map.md'), '# Map\n');
const fogOnly = workflowBlockReason({ files: builder, cwd: onlyFog });
assert.ok(
  fogOnly,
  'with every effort at an early phase the gate must still block builder work — '
    + 'if this is null the fix defanged the gate instead of narrowing it',
);
assert.match(fogOnly, /fog-effort/);
rmSync(onlyFog, { recursive: true, force: true });

// A diff that edits one effort's own files names the effort it belongs to; judge
// that one, not whichever happens to be ready elsewhere in the tree.
assert.ok(
  workflowBlockReason({ files: [...builder, '.scratch/fog-effort/map.md'], cwd: root }),
  'a diff advancing fog-effort itself is judged on fog-effort, not excused by ready-effort',
);

rmSync(scratch, { recursive: true, force: true });
console.log('matt-workflow tests ok');
