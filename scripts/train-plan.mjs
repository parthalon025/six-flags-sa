#!/usr/bin/env node
/**
 * Trains H and I — what is built, what is next, what is waiting on a person.
 *
 *   node scripts/train-plan.mjs                 # same as status
 *   node scripts/train-plan.mjs status [--json]
 *   node scripts/train-plan.mjs next   [--json] # slices startable right now
 *   node scripts/train-plan.mjs blocked         # slices waiting on an owner call
 *   node scripts/train-plan.mjs session         # the brief a fresh session follows
 *
 * `session` is the one that matters for cloud runs. A cloud session's container
 * is reclaimed when it ends, so the next session begins knowing nothing about
 * this one — no memory of which slices landed, no plan in context. It gets its
 * bearings by running this against the checkout it was handed. Everything it
 * prints is derived: the slice list from probes over the tree, the branch from
 * git. Nothing here is a claim a previous session had to remember to update.
 *
 * The plan itself is `scripts/lib/train-plan.mjs`; this file only formats it.
 */
import { execFileSync } from 'node:child_process';
import { scrubGitEnv } from './lib/git-env.mjs';
import {
  DECISIONS,
  REPO,
  blocked,
  next,
  progress,
  status,
  waiting,
} from './lib/train-plan.mjs';

const USAGE = `Usage:
  node scripts/train-plan.mjs status [--json]
  node scripts/train-plan.mjs next [--json]
  node scripts/train-plan.mjs blocked [--json]
  node scripts/train-plan.mjs session`;

/** Git, with the ambient GIT_DIR/GIT_WORK_TREE stripped.
 *
 *  A hook or a parent worktree exports those, and an inherited GIT_DIR makes
 *  `rev-parse` answer about a different checkout than the one `cwd` names. This
 *  brief exists to tell a session which branch it is on; getting that from the
 *  wrong repo is worse than not printing it. */
const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', env: scrubGitEnv() }).trim();
  } catch {
    return '';
  }
};

const label = (r) => `${r.id.padEnd(4)} ${r.train}  ${r.size.padEnd(1)}  ${r.title}`;

function printStatus(rows) {
  const p = progress(rows);
  const trains = p.trains.map((t) => `${t.train} ${t.done}/${t.total}`).join('   ');
  console.log(`Trains H+I — ${p.done}/${p.total} built    (${trains})\n`);

  const section = (heading, list, note) => {
    if (list.length === 0) return;
    console.log(`${heading} (${list.length})`);
    for (const r of list) {
      console.log(`  ${label(r)}${note ? note(r) : ''}`);
      if (r.probeError) console.log(`       probe error: ${r.probeError}`);
    }
    console.log('');
  };

  section('BUILT', rows.filter((r) => r.done));
  section('READY', next(rows));
  section('WAITING ON SLICES', waiting(rows), (r) => {
    const doneIds = new Set(rows.filter((x) => x.done).map((x) => x.id));
    return `  <- needs ${r.needs.filter((n) => !doneIds.has(n)).join(', ')}`;
  });
  section('BLOCKED ON AN OWNER DECISION', blocked(rows), (r) => `  <- decision ${r.blocked}`);
}

function printBlocked(rows) {
  const rowsBlocked = blocked(rows);
  const keys = [...new Set(rowsBlocked.map((r) => r.blocked))];
  if (keys.length === 0) {
    console.log('Nothing is waiting on a decision.');
    return;
  }
  for (const key of keys) {
    const d = DECISIONS[key];
    console.log(`(${key}) ${d.question}`);
    console.log(`     source: ${d.source}`);
    for (const opt of d.between ?? []) console.log(`     - ${opt}`);
    if (d.also) console.log(`     also: ${d.also}`);
    if (d.why) console.log(`     why it matters: ${d.why}`);
    console.log(`     gates: ${rowsBlocked.filter((r) => r.blocked === key).map((r) => r.id).join(', ')}`);
    console.log('');
  }
}

/** The standalone brief. Written for a session that has no context at all —
 *  which is every cloud session after the first. */
function printSession(rows) {
  const ready = next(rows);
  const p = progress(rows);
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD') || '(detached)';
  const head = git('rev-parse', '--short', 'HEAD');

  console.log(`# Train H/I session brief

Checkout: ${REPO}
Branch:   ${branch} @ ${head}
Progress: ${p.done}/${p.total} slices built${p.trains.map((t) => `, ${t.train} ${t.done}/${t.total}`).join('')}
`);

  if (ready.length === 0) {
    console.log(`No slice is startable. Either both trains are built, or everything
left is waiting on another slice or on an owner decision — run
\`node scripts/train-plan.mjs status\` and \`... blocked\` to see which, then stop.
Do not decide a blocked question on the owner's behalf.`);
    return;
  }

  console.log(`## Startable now

${ready.map((r) => `- **${r.id}** (${r.size}, train ${r.train}) — ${r.title}`).join('\n')}

## How to run this session

1. Take slices from the list above, smallest first. Take as many as fit the
   session; leaving some for the next one is fine and expected — the next
   session re-derives this list, so nothing is lost by stopping early.
2. Each slice gets its own worktree (\`npm run worktree:add -- <slug>\`) so
   parallel lanes cannot collide. Give each lane a disjoint file list; shared
   wiring — package.json scripts, manifests, registries — is yours to land,
   not a lane's. A lane that reports NEEDS WIRING is telling you it did its
   job; do the wiring yourself before the gate.
3. TDD, red before green: every assertion must be shown to fail on its own
   message before the code makes it pass. A probe or a test that cannot go
   false has proven nothing.
4. Gate with \`npm run test:pre-merge-vertical\`. Exit 0 does not mean it ran —
   confirm \`scripts/ci/local-ci-pass.json\`'s \`head\` equals
   \`git rev-parse HEAD\`. Anything else means the gate aborted early.
5. Commit to this branch and push it. Do not merge the PR: the standing
   instruction is one mega PR that merges only when both trains are complete.
6. Before you stop, re-run \`node scripts/train-plan.mjs status\`. The slices
   you built should now read BUILT. If one does not, either it is not finished
   or its probe is wrong — say which, in the PR, so the next session is not
   sent to rebuild it.

## Do not

- Do not answer a blocked decision. \`node scripts/train-plan.mjs blocked\`
  lists them; they are the owner's. Build around them.
- Do not merge the mega PR.
- Do not edit version files; they are bumped on merge.`);
}

function main(argv) {
  const args = argv.filter((a) => a !== '--json');
  const json = argv.includes('--json');
  const cmd = args[0] ?? 'status';

  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(USAGE);
    return 0;
  }

  const rows = status();
  const lists = { status: rows, next: next(rows), blocked: blocked(rows), waiting: waiting(rows) };

  if (cmd === 'session') {
    if (json) {
      console.log(JSON.stringify({ progress: progress(rows), next: lists.next }, null, 2));
    } else {
      printSession(rows);
    }
    return 0;
  }

  if (!(cmd in lists)) {
    console.error(`unknown command: ${cmd}\n\n${USAGE}`);
    return 2;
  }

  if (json) {
    console.log(JSON.stringify(cmd === 'status' ? { progress: progress(rows), rows } : lists[cmd], null, 2));
    return 0;
  }

  if (cmd === 'status') printStatus(rows);
  else if (cmd === 'blocked') printBlocked(rows);
  else {
    if (lists[cmd].length === 0) console.log(`nothing ${cmd}`);
    for (const r of lists[cmd]) console.log(label(r));
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
