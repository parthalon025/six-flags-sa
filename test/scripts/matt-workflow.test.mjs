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

rmSync(scratch, { recursive: true, force: true });
console.log('matt-workflow tests ok');
